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

// ============================================================
// Interfaces
// ============================================================

/** 批量发放请求输入 */
export interface BatchDistributionInput {
  userIds: string[];
  points: number;
  reason: string;
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer';
  distributorId: string;
  distributorNickname: string;
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

  return { valid: true };
}

// ============================================================
// Core batch distribution logic
// ============================================================

/** Max users per DynamoDB transaction batch (100 ops / 2 ops per user = 50, but design says 25) */
const BATCH_SIZE = 25;

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
  },
): Promise<BatchDistributionResult> {
  // 1. Deduplicate userIds
  const uniqueUserIds = [...new Set(input.userIds)];
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

      // a. Update user points
      transactItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId },
          UpdateExpression: 'SET points = points + :pv, updatedAt = :now',
          ExpressionAttributeValues: {
            ':pv': input.points,
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
            source: `管理员批量发放:${distributionId}`,
            balanceAfter: newBalance,
            createdAt: now,
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
      ExpressionAttributeValues: { ':pk': 'ALL' },
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
