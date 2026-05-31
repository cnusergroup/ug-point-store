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
import type { SkillClaimInput, SkillType } from './skill-claims';
import { validateSkillClaimsInput, buildSkillClaimTransactItems, getSkillClaimsForActivity } from './skill-claims';

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
  /** 技能认领列表（仅 UGL 角色适用） */
  skillClaims?: SkillClaimInput[];
}

/** 批量发放结果 */
export interface BatchDistributionResult {
  success: boolean;
  distributionId?: string;
  successCount?: number;
  totalPoints?: number;
  /** 实际写入的技能认领列表 */
  skillClaims?: Array<{ skill: SkillType; userId: string; userNickname: string; pointsAwarded: number }>;
  /** 技能分总额 */
  totalSkillPoints?: number;
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

  // 0d. Skill claims validation (early return if invalid)
  const hasSkillClaims = input.skillClaims && input.skillClaims.length > 0;
  if (hasSkillClaims) {
    const skillValidation = validateSkillClaimsInput(input.skillClaims!, input.targetRole);
    if (skillValidation) {
      return {
        success: false,
        error: skillValidation,
      };
    }

    // Validate each userId in skillClaims: must exist, be active, have UGL role
    const skillUserIds = [...new Set(input.skillClaims!.map(c => c.userId))];

    // Fetch all skill claim users to validate existence, status, and role
    const skillUserChunks = chunkArray(skillUserIds, 100);
    for (const chunk of skillUserChunks) {
      const result = await dynamoClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tables.usersTable]: {
              Keys: chunk.map(userId => ({ userId })),
              ProjectionExpression: 'userId, #s',
              ExpressionAttributeNames: { '#s': 'status' },
            },
          },
        }),
      );

      const items = result.Responses?.[tables.usersTable] ?? [];
      const foundIds = new Set(items.map(item => item.userId as string));

      // Check all skill claim users exist
      for (const uid of chunk) {
        if (!foundIds.has(uid)) {
          return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: `skillClaims 中的用户 ${uid} 不存在` },
          };
        }
      }

      // Check each user is active (skill claims allowed for any role)
      for (const item of items) {
        const userStatus = (item.status as string) ?? 'active';
        if (userStatus !== 'active') {
          return {
            success: false,
            error: { code: 'INVALID_REQUEST', message: `skillClaims 中的用户 ${item.userId} 不是活跃状态` },
          };
        }
      }
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

  // 1c. Build union of all unique users: userIds ∪ skillClaims.userIds
  const skillClaims = input.skillClaims ?? [];
  const activityUserSet = new Set(uniqueUserIds);
  const skillClaimUserIds = skillClaims.map(sc => sc.userId);
  const allUniqueUserIds = [...new Set([...uniqueUserIds, ...skillClaimUserIds])];

  // 1d. Build skill map: userId → list of skills claimed
  const userSkillsMap = new Map<string, SkillType[]>();
  for (const claim of skillClaims) {
    const existing = userSkillsMap.get(claim.userId) ?? [];
    existing.push(claim.skill);
    userSkillsMap.set(claim.userId, existing);
  }

  const distributionId = ulid();
  const now = new Date().toISOString();

  // 2. Fetch current points balances via BatchGetCommand (max 100 keys per call)
  const userBalances = new Map<string, number>();
  const userDetails: { userId: string; nickname: string; email: string }[] = [];

  const batchGetChunks = chunkArray(allUniqueUserIds, 100);
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

  // 3. Calculate merged points per user and build transaction items
  const transactItems: any[] = [];

  for (const userId of allUniqueUserIds) {
    const isActivityUser = activityUserSet.has(userId);
    const userSkills = userSkillsMap.get(userId);
    const isSkillUser = userSkills && userSkills.length > 0;

    // Calculate activityPoints (if in userIds)
    const activityPoints = isActivityUser ? input.points : 0;

    // Calculate skillPoints (sum of applicable skill config values)
    let skillPoints = 0;
    if (isSkillUser) {
      for (const skill of userSkills) {
        if (skill === 'liveSupport') {
          skillPoints += config.liveSupportPoints;
        } else if (skill === 'posterDesign') {
          skillPoints += config.posterDesignPoints;
        } else if (skill === 'articleEditing') {
          skillPoints += config.articleEditingPoints;
        }
      }
    }

    // Total = activityPoints + skillPoints
    const totalUserPoints = activityPoints + skillPoints;
    const currentBalance = userBalances.get(userId) ?? 0;
    const newBalance = currentBalance + totalUserPoints;
    const recordId = ulid();

    // Build source string based on scenario
    const source = buildMergedSource(
      isActivityUser,
      isSkillUser ? userSkills : undefined,
      input.targetRole,
      input.activityUG,
      input.activityTopic,
      input.activityDate,
    );

    // a. Update user points — increment points, earnTotal, earnTotalLeader by total amount
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
        UpdateExpression: `SET points = points + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, #rf = if_not_exists(#rf, :zero) + :pv, updatedAt = :now`,
        ExpressionAttributeNames: { '#rf': roleField },
        ExpressionAttributeValues: {
          ':pv': totalUserPoints,
          ':zero': 0,
          ':now': now,
        },
      },
    });

    // b. Write single merged PointsRecord
    transactItems.push({
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: {
          recordId,
          userId,
          type: 'earn',
          amount: totalUserPoints,
          source,
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

  // 3b. Build skill claim transact items and append to the same transaction
  const skillClaimTableName = process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';
  if (hasSkillClaims && skillClaimTableName) {
    // Build nickname map from fetched user details
    const userNicknameMap: Record<string, string> = {};
    for (const detail of userDetails) {
      userNicknameMap[detail.userId] = detail.nickname;
    }

    const skillClaimItems = buildSkillClaimTransactItems(skillClaims, {
      activityId: input.activityId,
      claimedBy: input.distributorId,
      distributionId,
      tableName: skillClaimTableName,
      userNicknameMap,
      pointsConfig: {
        liveSupportPoints: config.liveSupportPoints,
        posterDesignPoints: config.posterDesignPoints,
        articleEditingPoints: config.articleEditingPoints,
      },
    });

    transactItems.push(...skillClaimItems);
  }

  // 3c. Check total operation count ≤ 100 (DynamoDB TransactWrite limit)
  if (transactItems.length > 100) {
    return {
      success: false,
      error: {
        code: 'BATCH_TOO_LARGE',
        message: `事务操作数 ${transactItems.length} 超过 DynamoDB 上限 100`,
      },
    };
  }

  // 3d. Execute the single atomic transaction
  try {
    await dynamoClient.send(
      new TransactWriteCommand({ TransactItems: transactItems }),
    );
  } catch (err: any) {
    // Handle TransactionCanceledException with ConditionalCheckFailed reasons
    // This indicates a skill lock conflict (skill already claimed by someone else)
    if (
      hasSkillClaims &&
      skillClaimTableName &&
      (err.name === 'TransactionCanceledException' || err.name === 'ConditionalCheckFailedException')
    ) {
      const cancellationReasons = err.CancellationReasons as Array<{ Code?: string }> | undefined;
      const hasConditionalCheckFailed =
        err.name === 'ConditionalCheckFailedException' ||
        (cancellationReasons && cancellationReasons.some(r => r.Code === 'ConditionalCheckFailed'));

      if (hasConditionalCheckFailed) {
        // Re-read existing claims to find the occupant
        try {
          const existingClaims = await getSkillClaimsForActivity(
            input.activityId,
            dynamoClient,
            skillClaimTableName,
          );

          // Find which skill was already claimed
          const requestedSkills = skillClaims.map(sc => sc.skill);
          const conflictingClaim = existingClaims.find(c => requestedSkills.includes(c.skill));
          const occupantNickname = conflictingClaim?.userNickname ?? '未知用户';
          const conflictSkill = conflictingClaim?.skill ?? requestedSkills[0];

          return {
            success: false,
            error: {
              code: 'SKILL_ALREADY_CLAIMED',
              message: `技能 ${conflictSkill} 已被 ${occupantNickname} 占用`,
            },
          };
        } catch {
          // If re-read fails, still return SKILL_ALREADY_CLAIMED with generic message
          return {
            success: false,
            error: {
              code: 'SKILL_ALREADY_CLAIMED',
              message: '技能已被他人占用',
            },
          };
        }
      }
    }

    console.error('Batch transaction failed:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '批量发放事务执行失败' },
    };
  }

  // 4. All batches succeeded — write Distribution_Record
  const successCount = allUniqueUserIds.length;
  const totalPoints = allUniqueUserIds.reduce((sum, userId) => {
    const isActivityUser = activityUserSet.has(userId);
    const userSkills = userSkillsMap.get(userId);
    let userTotal = isActivityUser ? input.points : 0;
    if (userSkills) {
      for (const skill of userSkills) {
        if (skill === 'liveSupport') userTotal += config.liveSupportPoints;
        else if (skill === 'posterDesign') userTotal += config.posterDesignPoints;
        else if (skill === 'articleEditing') userTotal += config.articleEditingPoints;
      }
    }
    return sum + userTotal;
  }, 0);

  // Helper: get configured points for a skill type
  const skillPointsFor = (skill: SkillType): number =>
    skill === 'liveSupport' ? config.liveSupportPoints
    : skill === 'posterDesign' ? config.posterDesignPoints
    : config.articleEditingPoints;

  const distributionRecord: DistributionRecord & { pk: string } = {
    distributionId,
    pk: 'ALL', // GSI partition key for createdAt-index
    distributorId: input.distributorId,
    distributorNickname: input.distributorNickname,
    targetRole: input.targetRole,
    recipientIds: uniqueUserIds, // Only activity participants (not only-skill users)
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
    ...(skillClaims.length > 0 && {
      skillClaims: skillClaims.map(sc => ({
        skill: sc.skill,
        userId: sc.userId,
        userNickname: userDetails.find(u => u.userId === sc.userId)?.nickname ?? '',
        pointsAwarded: skillPointsFor(sc.skill),
      })),
    }),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.batchDistributionsTable,
      Item: distributionRecord,
    }),
  );

  // 4b. Build skill claims summary for response
  const skillClaimsSummary = skillClaims.length > 0
    ? skillClaims.map(sc => ({
        skill: sc.skill,
        userId: sc.userId,
        userNickname: userDetails.find(u => u.userId === sc.userId)?.nickname ?? '',
        pointsAwarded: skillPointsFor(sc.skill),
      }))
    : undefined;

  const totalSkillPoints = skillClaims.length > 0
    ? skillClaims.reduce((sum, sc) => sum + skillPointsFor(sc.skill), 0)
    : undefined;

  return {
    success: true,
    distributionId,
    successCount,
    totalPoints,
    ...(skillClaimsSummary && { skillClaims: skillClaimsSummary }),
    ...(totalSkillPoints !== undefined && { totalSkillPoints }),
  };
}

// ============================================================
// Source string builder for merged PointsRecord
// ============================================================

/**
 * Build the `source` field for a merged PointsRecord.
 *
 * Scenarios:
 * - Only activity: "批量发放:{targetRole}|{ugName}|{topic}|{date}"
 * - Only skill: "批量发放:技能:{skills joined by +}|{ugName}|{topic}|{date}"
 * - Both: "批量发放:{targetRole}+技能:{skills joined by +}|{ugName}|{topic}|{date}"
 */
export function buildMergedSource(
  isActivityUser: boolean,
  skills: SkillType[] | undefined,
  targetRole: string,
  activityUG: string,
  activityTopic: string,
  activityDate: string,
): string {
  const suffix = `|${activityUG}|${activityTopic}|${activityDate}`;
  const hasSkills = skills && skills.length > 0;
  const skillPart = hasSkills ? `技能:${skills.join('+')}` : '';

  if (isActivityUser && hasSkills) {
    // Both activity + skill
    return `批量发放:${targetRole}+${skillPart}${suffix}`;
  } else if (isActivityUser) {
    // Only activity
    return `批量发放:${targetRole}${suffix}`;
  } else {
    // Only skill
    return `批量发放:${skillPart}${suffix}`;
  }
}

// ============================================================
// History query
// ============================================================

export interface ListDistributionHistoryOptions {
  pageSize?: number;
  lastKey?: string;
  distributorId?: string;
  /** Optional filter on activityType (e.g. '特殊活动', '线上活动', '线下活动', '季度贡献奖') */
  activityType?: string;
  /** Optional filter on normalized awardTagName; only meaningful for SpecialActivity records */
  awardTagName?: string;
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
 *
 * When distributorId filter is applied, the function loops querying additional
 * pages until enough items match the filter (or no more data), so the caller
 * always sees pageSize items per page (when available).
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

  const collected: DistributionRecord[] = [];
  let cursor = exclusiveStartKey;
  // Loop until we collect pageSize items or run out of data.
  // Cap at 10 iterations to avoid runaway scans.
  const MAX_ITERATIONS = 10;
  let iterations = 0;

  // Compose optional FilterExpression clauses for distributorId / activityType / awardTagName
  const filterClauses: string[] = [];
  const filterValues: Record<string, unknown> = { ':pk': 'ALL' };
  if (options.distributorId) {
    filterClauses.push('distributorId = :did');
    filterValues[':did'] = options.distributorId;
  }
  if (options.activityType) {
    filterClauses.push('activityType = :atype');
    filterValues[':atype'] = options.activityType;
  }
  if (options.awardTagName) {
    filterClauses.push('awardTagName = :atag');
    filterValues[':atag'] = options.awardTagName;
  }
  const filterExpression = filterClauses.length > 0 ? filterClauses.join(' AND ') : undefined;

  while (collected.length < pageSize && iterations < MAX_ITERATIONS) {
    iterations++;
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: batchDistributionsTable,
        IndexName: 'createdAt-index',
        KeyConditionExpression: 'pk = :pk',
        ...(filterExpression && { FilterExpression: filterExpression }),
        ExpressionAttributeValues: filterValues,
        ScanIndexForward: false,
        Limit: pageSize,
        ...(cursor && { ExclusiveStartKey: cursor }),
      }),
    );

    const items = (result.Items ?? []) as DistributionRecord[];
    collected.push(...items);
    cursor = result.LastEvaluatedKey;

    // No more data available
    if (!cursor) break;
  }

  // Truncate to pageSize and update cursor accordingly
  let distributions = collected;
  let lastKey: string | undefined;
  if (collected.length > pageSize) {
    distributions = collected.slice(0, pageSize);
    // Build cursor from the last returned item to allow continuation
    const lastItem = distributions[distributions.length - 1];
    lastKey = Buffer.from(JSON.stringify({
      distributionId: lastItem.distributionId,
      pk: 'ALL',
      createdAt: lastItem.createdAt,
    })).toString('base64');
  } else if (cursor) {
    lastKey = Buffer.from(JSON.stringify(cursor)).toString('base64');
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
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
