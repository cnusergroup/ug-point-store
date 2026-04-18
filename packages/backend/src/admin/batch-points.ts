import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  TransactWriteCommand,
  PutCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { DistributionRecord } from '@points-mall/shared';
import { getFeatureToggles, DEFAULT_POINTS_RULE_CONFIG } from '../settings/feature-toggles';
import type { PointsRuleConfig } from '../settings/feature-toggles';

// ============================================================
// Interfaces
// ============================================================

/** 批量发放请求输入 */
export interface BatchDistributionInput {
  userIds: string[];
  points: number;
  reason: string;
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer';
  speakerType?: 'typeA' | 'typeB' | 'roundtable';
  distributorId: string;
  distributorNickname: string;
  // 活动关联字段
  activityId: string;
  activityType: string;
  activityUG: string;
  activityTopic: string;
  activityDate: string;
  /** When true, skip POINTS_MISMATCH validation (used by SuperAdmin quarterly award) */
  skipPointsValidation?: boolean;
}

/** 批量发放结果 */
export interface BatchDistributionResult {
  success: boolean;
  distributionId?: string;
  successCount?: number;
  totalPoints?: number;
  error?: { code: string; message: string };
}

/** 输入验证结果 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string } };

// ============================================================
// Validation
// ============================================================

const VALID_TARGET_ROLES = ['UserGroupLeader', 'Speaker', 'Volunteer'] as const;

/**
 * Validate batch distribution request body.
 */
export function validateBatchDistributionInput(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: '请求体无效' } };
  }

  const { userIds, points, reason, targetRole } = body as Record<string, unknown>;

  // Validate userIds: non-empty string array
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'userIds 必须为非空数组' } };
  }
  if (!userIds.every(id => typeof id === 'string' && id.length > 0)) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'userIds 中每个元素必须为非空字符串' } };
  }

  // Validate points: positive integer >= 1
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 1) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'points 必须为正整数且不小于 1' } };
  }

  // Validate reason: 1~200 character string
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 200) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'reason 必须为 1~200 字符的字符串' } };
  }

  // Validate targetRole
  if (typeof targetRole !== 'string' || !(VALID_TARGET_ROLES as readonly string[]).includes(targetRole)) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'targetRole 必须为 UserGroupLeader、Speaker 或 Volunteer' } };
  }

  // Validate activityId: required non-empty string
  const { activityId } = body as Record<string, unknown>;
  if (typeof activityId !== 'string' || activityId.length === 0) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'activityId 为必填字段' } };
  }

  // Validate speakerType when targetRole is Speaker
  const { speakerType } = body as Record<string, unknown>;
  if (targetRole === 'Speaker') {
    const validSpeakerTypes = ['typeA', 'typeB', 'roundtable'];
    if (!speakerType || typeof speakerType !== 'string' || !validSpeakerTypes.includes(speakerType)) {
      return { valid: false, error: { code: 'INVALID_REQUEST', message: 'Speaker 角色必须指定 speakerType（typeA/typeB/roundtable）' } };
    }
  }

  return { valid: true };
}

// ============================================================
// Core batch distribution logic
// ============================================================

/** Max users per DynamoDB transaction batch (100 ops / 2 ops per user = 50, but design says 25) */
const BATCH_SIZE = 25;

/**
 * Calculate expected points per person based on role, speakerType, and config.
 */
export function calculateExpectedPoints(
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer',
  speakerType: 'typeA' | 'typeB' | 'roundtable' | undefined,
  config: PointsRuleConfig,
): number {
  switch (targetRole) {
    case 'UserGroupLeader':
      return config.uglPointsPerEvent;
    case 'Volunteer':
      return config.volunteerPointsPerEvent;
    case 'Speaker':
      switch (speakerType) {
        case 'typeA': return config.speakerTypeAPoints;
        case 'typeB': return config.speakerTypeBPoints;
        case 'roundtable': return config.speakerRoundtablePoints;
        default: return config.speakerTypeAPoints;
      }
    default:
      return 0;
  }
}

/**
 * Query awarded user IDs for a given activity + role combination.
 */
export async function getAwardedUserIds(
  activityId: string,
  targetRole: string,
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
): Promise<string[]> {
  // Scan all distributions and filter by activityId + targetRole
  // Since there's no GSI on activityId, we query all records and filter
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: batchDistributionsTable,
      IndexName: 'createdAt-index',
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'activityId = :aid AND targetRole = :tr',
      ExpressionAttributeValues: {
        ':pk': 'ALL',
        ':aid': activityId,
        ':tr': targetRole,
      },
    }),
  );

  const userIds = new Set<string>();
  for (const item of result.Items ?? []) {
    const recipientIds = item.recipientIds as string[] | undefined;
    if (recipientIds) {
      for (const id of recipientIds) {
        userIds.add(id);
      }
    }
  }
  return [...userIds];
}

/**
 * Execute batch points distribution.
 * - Deduplicates userIds
 * - Fetches current balances via BatchGetCommand
 * - Splits into batches of 25 users for TransactWriteCommand
 * - Writes Distribution_Record on success
 */
export async function executeBatchDistribution(
  input: BatchDistributionInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    usersTable: string;
    pointsRecordsTable: string;
    batchDistributionsTable: string;
    activitiesTable?: string;
  },
): Promise<BatchDistributionResult> {
  // 0. Verify activityId exists in Activities table (if activitiesTable provided)
  if (tables.activitiesTable) {
    const activityResult = await dynamoClient.send(
      new GetCommand({
        TableName: tables.activitiesTable,
        Key: { activityId: input.activityId },
      }),
    );
    if (!activityResult.Item) {
      return {
        success: false,
        error: { code: 'ACTIVITY_NOT_FOUND', message: '关联活动不存在' },
      };
    }
  }

  // 0b. Read pointsRuleConfig from settings and validate points
  const toggles = await getFeatureToggles(dynamoClient, tables.usersTable);
  const config = toggles.pointsRuleConfig ?? { ...DEFAULT_POINTS_RULE_CONFIG };
  const expectedPoints = calculateExpectedPoints(input.targetRole, input.speakerType, config);

  if (!input.skipPointsValidation && input.points !== expectedPoints) {
    return {
      success: false,
      error: {
        code: 'POINTS_MISMATCH',
        message: `积分值不匹配，${input.targetRole}${input.speakerType ? `(${input.speakerType})` : ''} 应为 ${expectedPoints} 分`,
      },
    };
  }

  // 0c. Volunteer count limit check
  if (input.targetRole === 'Volunteer') {
    const uniqueCount = new Set(input.userIds).size;
    if (uniqueCount > config.volunteerMaxPerEvent) {
      return {
        success: false,
        error: {
          code: 'VOLUNTEER_LIMIT_EXCEEDED',
          message: `每场活动最多选择 ${config.volunteerMaxPerEvent} 位志愿者，当前选择 ${uniqueCount} 位`,
        },
      };
    }
  }

  // 1. Deduplicate userIds
  const uniqueUserIds = [...new Set(input.userIds)];

  // 1b. Duplicate check: same activity + same role + same user
  const awardedUserIds = await getAwardedUserIds(
    input.activityId,
    input.targetRole,
    dynamoClient,
    tables.batchDistributionsTable,
  );
  const awardedSet = new Set(awardedUserIds);
  const duplicateUserIds = uniqueUserIds.filter(id => awardedSet.has(id));
  if (duplicateUserIds.length > 0) {
    return {
      success: false,
      error: {
        code: 'DUPLICATE_DISTRIBUTION',
        message: `以下用户已在此活动中以 ${input.targetRole} 身份获得积分`,
        duplicateUserIds,
      } as any,
    };
  }

  const distributionId = ulid();
  const now = new Date().toISOString();

  // 2. Fetch current points balances via BatchGetCommand (max 100 keys per call)
  const userBalances = new Map<string, number>();
  const userDetails: { userId: string; nickname: string; email: string }[] = [];

  const batchGetChunks = chunkArray(uniqueUserIds, 100);
  for (const chunk of batchGetChunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, points, nickname, email',
          },
        },
      }),
    );

    const items = result.Responses?.[tables.usersTable] ?? [];
    for (const item of items) {
      userBalances.set(item.userId as string, (item.points as number) ?? 0);
      userDetails.push({
        userId: item.userId as string,
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
      });
    }
  }

  // 3. Split into batches of BATCH_SIZE and execute transactions
  const transactionBatches = chunkArray(uniqueUserIds, BATCH_SIZE);

  for (const batch of transactionBatches) {
    const transactItems: any[] = [];

    for (const userId of batch) {
      const currentBalance = userBalances.get(userId) ?? 0;
      const newBalance = currentBalance + input.points;
      const recordId = ulid();

      // a. Update user points — also increment earnTotal (all roles) and the role-specific earnTotal field
      const roleFieldMap: Record<string, string> = {
        Speaker: 'earnTotalSpeaker',
        UserGroupLeader: 'earnTotalLeader',
        Volunteer: 'earnTotalVolunteer',
      };
      const roleField = roleFieldMap[input.targetRole] ?? 'earnTotalSpeaker';

      transactItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId },
          UpdateExpression: `SET points = points + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, #rf = if_not_exists(#rf, :zero) + :pv, pk = :pk, updatedAt = :now`,
          ExpressionAttributeNames: { '#rf': roleField },
          ExpressionAttributeValues: {
            ':pv': input.points,
            ':zero': 0,
            ':pk': 'ALL',
            ':now': now,
          },
        },
      });

      // b. Write points record
      transactItems.push({
        Put: {
          TableName: tables.pointsRecordsTable,
          Item: {
            recordId,
            userId,
            type: 'earn',
            amount: input.points,
            source: `批量发放:${input.targetRole}|${input.activityUG}|${input.activityTopic}|${input.activityDate}`,
            balanceAfter: newBalance,
            createdAt: now,
            activityId: input.activityId,
            activityType: input.activityType,
            activityUG: input.activityUG,
            activityTopic: input.activityTopic,
            activityDate: input.activityDate,
            targetRole: input.targetRole,
          },
        },
      });
    }

    try {
      await dynamoClient.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (err) {
      console.error('Batch transaction failed:', err);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '批量发放事务执行失败' },
      };
    }
  }

  // 4. All batches succeeded — write Distribution_Record
  const successCount = uniqueUserIds.length;
  const totalPoints = successCount * input.points;

  const distributionRecord: DistributionRecord & { pk: string } = {
    distributionId,
    pk: 'ALL', // GSI partition key for createdAt-index
    distributorId: input.distributorId,
    distributorNickname: input.distributorNickname,
    targetRole: input.targetRole,
    recipientIds: uniqueUserIds,
    recipientDetails: userDetails,
    points: input.points,
    reason: input.reason,
    successCount,
    totalPoints,
    createdAt: now,
    activityId: input.activityId,
    activityType: input.activityType,
    activityUG: input.activityUG,
    activityTopic: input.activityTopic,
    activityDate: input.activityDate,
    ...(input.speakerType && { speakerType: input.speakerType }),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.batchDistributionsTable,
      Item: distributionRecord,
    }),
  );

  return {
    success: true,
    distributionId,
    successCount,
    totalPoints,
  };
}

// ============================================================
// History query
// ============================================================

export interface ListDistributionHistoryOptions {
  pageSize?: number;
  lastKey?: string;
  distributorId?: string;
}

export interface ListDistributionHistoryResult {
  success: boolean;
  distributions?: DistributionRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/**
 * Clamp pageSize to [1, 100], default 20.
 */
export function clampPageSize(pageSize?: number): number {
  if (pageSize === undefined || pageSize === null) return 20;
  if (pageSize < 1) return 1;
  if (pageSize > 100) return 100;
  return Math.floor(pageSize);
}

/**
 * List distribution history, sorted by createdAt descending.
 * Uses GSI createdAt-index (PK='ALL', SK=createdAt, ScanIndexForward=false).
 */
export async function listDistributionHistory(
  options: ListDistributionHistoryOptions,
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
): Promise<ListDistributionHistoryResult> {
  const pageSize = clampPageSize(options.pageSize);

  let exclusiveStartKey: Record<string, any> | undefined;
  if (options.lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'));
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: batchDistributionsTable,
      IndexName: 'createdAt-index',
      KeyConditionExpression: 'pk = :pk',
      ...(options.distributorId && {
        FilterExpression: 'distributorId = :did',
      }),
      ExpressionAttributeValues: {
        ':pk': 'ALL',
        ...(options.distributorId && { ':did': options.distributorId }),
      },
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const distributions = (result.Items ?? []) as DistributionRecord[];
  let lastKey: string | undefined;
  if (result.LastEvaluatedKey) {
    lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return { success: true, distributions, lastKey };
}

// ============================================================
// Detail query
// ============================================================

export interface GetDistributionDetailResult {
  success: boolean;
  distribution?: DistributionRecord;
  error?: { code: string; message: string };
}

/**
 * Get a single distribution record by distributionId.
 */
export async function getDistributionDetail(
  distributionId: string,
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
): Promise<GetDistributionDetailResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: batchDistributionsTable,
      Key: { distributionId },
    }),
  );

  if (!result.Item) {
    return {
      success: false,
      error: { code: 'DISTRIBUTION_NOT_FOUND', message: '发放记录不存在' },
    };
  }

  return {
    success: true,
    distribution: result.Item as DistributionRecord,
  };
}

// ============================================================
// Client-side search filter
// ============================================================

export interface SearchableUser {
  userId: string;
  nickname: string;
  email: string;
  [key: string]: unknown;
}

/**
 * Filter users by nickname or email (case-insensitive substring match).
 * Used by the frontend for client-side search filtering.
 */
export function filterUsersBySearch<T extends SearchableUser>(users: T[], query: string): T[] {
  if (!query || query.length === 0) return users;
  const lowerQuery = query.toLowerCase();
  return users.filter(
    user =>
      (user.nickname && user.nickname.toLowerCase().includes(lowerQuery)) ||
      (user.email && user.email.toLowerCase().includes(lowerQuery)),
  );
}

// ============================================================
// Utility
// ============================================================

/** Split an array into chunks of the given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
