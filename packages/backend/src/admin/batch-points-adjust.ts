import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  TransactWriteCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { DistributionRecord } from '@points-mall/shared';
import { getFeatureToggles, DEFAULT_POINTS_RULE_CONFIG } from '../settings/feature-toggles';
import type { PointsRuleConfig } from '../settings/feature-toggles';
import { calculateExpectedPoints, chunkArray } from './batch-points';
import type { SkillType, SkillClaimRecord } from './skill-claims';
import { getSkillClaimsForActivity } from './skill-claims';

// ============================================================
// Interfaces
// ============================================================

/** 调整请求输入 */
export interface AdjustmentInput {
  distributionId: string;
  recipientIds: string[];
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer' | 'SpecialActivity' | 'SpecialReward';
  speakerType?: 'typeA' | 'typeB' | 'roundtable';
  adjustedBy: string;
  /** Caller's roles — used for SuperAdmin validation on skill lock operations */
  callerRoles?: string[];
  /** Release existing skill locks (SuperAdmin only) */
  releaseSkills?: Array<{ skill: SkillType }>;
  /** Add new skill lock claims (SuperAdmin only) */
  addSkillClaims?: Array<{ skill: SkillType; userId: string }>;
  /** Free Amount Mode: 特殊类型调整时由 SuperAdmin 指定的每人积分值（正整数） */
  adjustedPoints?: number;
}

/** 单用户调整金额 */
export interface UserAdjustment {
  userId: string;
  delta: number;
}

/** 调整差异 */
export interface AdjustmentDiff {
  addedUserIds: string[];
  removedUserIds: string[];
  retainedUserIds: string[];
  originalPoints: number;
  newPoints: number;
  pointsDelta: number;
  /** Per-user adjustment amounts for all affected users */
  userAdjustments: UserAdjustment[];
}

/** 调整结果 */
export interface AdjustmentResult {
  success: boolean;
  deleted?: boolean;
  distributionId?: string;
  reversedCount?: number;
  error?: { code: string; message: string };
}

// ============================================================
// Diff Computation
// ============================================================

/**
 * Compute the diff between the original distribution and the adjustment input.
 *
 * - Added users: in new recipientIds but not in original
 * - Removed users: in original but not in new recipientIds
 * - Retained users: in both
 * - newPoints recalculated from config (never client-provided)
 * - Per-user deltas computed for all affected users
 */
export function computeAdjustmentDiff(
  original: DistributionRecord,
  input: AdjustmentInput,
  config: PointsRuleConfig,
): AdjustmentDiff {
  const originalSet = new Set(original.recipientIds);
  const newSet = new Set(input.recipientIds);

  const addedUserIds = input.recipientIds.filter(id => !originalSet.has(id));
  const removedUserIds = original.recipientIds.filter(id => !newSet.has(id));
  const retainedUserIds = original.recipientIds.filter(id => newSet.has(id));

  const originalPoints = original.points;

  // Free Amount Mode: 特殊类型使用 adjustedPoints，否则从 config 计算
  const isFreeAmountMode = input.targetRole === 'SpecialActivity' || input.targetRole === 'SpecialReward';
  const newPoints = isFreeAmountMode
    ? input.adjustedPoints!  // 已在 validate 中确保为正整数
    : calculateExpectedPoints(input.targetRole, input.speakerType, config);

  const pointsDelta = newPoints - originalPoints;

  const userAdjustments: UserAdjustment[] = [];

  // Removed users get negative adjustment equal to original points
  for (const userId of removedUserIds) {
    userAdjustments.push({ userId, delta: -originalPoints });
  }

  // Added users get positive adjustment equal to new points
  for (const userId of addedUserIds) {
    userAdjustments.push({ userId, delta: newPoints });
  }

  // Retained users get delta only if points changed
  if (pointsDelta !== 0) {
    for (const userId of retainedUserIds) {
      userAdjustments.push({ userId, delta: pointsDelta });
    }
  }

  return {
    addedUserIds,
    removedUserIds,
    retainedUserIds,
    originalPoints,
    newPoints,
    pointsDelta,
    userAdjustments,
  };
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate an adjustment input against the original distribution and config.
 *
 * Returns `{ valid: true }` or `{ valid: false, error }` with appropriate error codes:
 * - INVALID_REQUEST: Speaker without speakerType, or invalid speakerType value
 * - VOLUNTEER_LIMIT_EXCEEDED: volunteer count exceeds config limit
 * - NO_CHANGES: no actual changes detected
 *
 * When recipientIds is empty, returns `{ valid: true, isDeletion: true }` to signal
 * the deletion flow (skips speakerType, volunteer limit, and NO_CHANGES checks).
 */
export type AdjustmentValidationResult =
  | { valid: true; isDeletion?: boolean }
  | { valid: false; error: { code: string; message: string } };

const VALID_SPEAKER_TYPES: ReadonlySet<string> = new Set(['typeA', 'typeB', 'roundtable']);

/** All valid targetRole values accepted by the adjustment service */
export const VALID_TARGET_ROLES: ReadonlySet<string> = new Set([
  'UserGroupLeader', 'Speaker', 'Volunteer', 'SpecialActivity', 'SpecialReward',
]);

export function validateAdjustmentInput(
  original: DistributionRecord,
  input: AdjustmentInput,
  config: PointsRuleConfig,
): AdjustmentValidationResult {
  // 1. Empty recipientIds → deletion mode, skip all other validations
  if (!input.recipientIds || input.recipientIds.length === 0) {
    return { valid: true, isDeletion: true };
  }

  // 2. Reject invalid targetRole early
  if (!VALID_TARGET_ROLES.has(input.targetRole)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: `无效的 targetRole: ${input.targetRole}` },
    };
  }

  // 3. For special types (SpecialActivity/SpecialReward), validate adjustedPoints
  if (
    (input.targetRole === 'SpecialActivity' || input.targetRole === 'SpecialReward') &&
    input.recipientIds.length > 0
  ) {
    if (!input.adjustedPoints || !Number.isInteger(input.adjustedPoints) || input.adjustedPoints <= 0) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: '特殊类型调整必须提供有效的积分金额' },
      };
    }
  }

  // 4. Reject Speaker without speakerType
  if (input.targetRole === 'Speaker' && !input.speakerType) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'Speaker 角色必须指定 speakerType' },
    };
  }

  // 5. Reject Speaker with invalid speakerType value
  if (input.targetRole === 'Speaker' && input.speakerType && !VALID_SPEAKER_TYPES.has(input.speakerType)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: `无效的 speakerType: ${input.speakerType}，必须为 typeA、typeB 或 roundtable` },
    };
  }

  // 6. Reject volunteer count exceeding limit
  if (input.targetRole === 'Volunteer') {
    const uniqueCount = new Set(input.recipientIds).size;
    if (uniqueCount > config.volunteerMaxPerEvent) {
      return {
        valid: false,
        error: {
          code: 'VOLUNTEER_LIMIT_EXCEEDED',
          message: `每场活动最多选择 ${config.volunteerMaxPerEvent} 位志愿者，当前选择 ${uniqueCount} 位`,
        },
      };
    }
  }

  // 7. Reject if no actual changes detected
  const originalSorted = [...original.recipientIds].sort();
  const newSorted = [...new Set(input.recipientIds)].sort();
  const sameRecipients =
    originalSorted.length === newSorted.length &&
    originalSorted.every((id, i) => id === newSorted[i]);
  const sameRole = input.targetRole === original.targetRole;
  const sameSpeakerType = input.speakerType === original.speakerType;
  // Skill lock release/assign are standalone changes: releasing or assigning a skill
  // must be allowed even when recipients/role/speakerType are unchanged, otherwise a
  // skill-only adjustment is wrongly rejected as NO_CHANGES.
  const hasSkillOps =
    (input.releaseSkills?.length ?? 0) > 0 || (input.addSkillClaims?.length ?? 0) > 0;

  // 7a. Special type NO_CHANGES detection: check adjustedPoints === original.points alongside recipients
  if (input.targetRole === 'SpecialActivity' || input.targetRole === 'SpecialReward') {
    const samePoints = input.adjustedPoints === original.points;
    if (sameRecipients && samePoints && !hasSkillOps) {
      return { valid: false, error: { code: 'NO_CHANGES', message: '未检测到任何变更' } };
    }
  }

  // 7b. Traditional role NO_CHANGES detection
  if (
    (input.targetRole === 'UserGroupLeader' || input.targetRole === 'Speaker' || input.targetRole === 'Volunteer') &&
    sameRecipients && sameRole && sameSpeakerType && !hasSkillOps
  ) {
    return {
      valid: false,
      error: { code: 'NO_CHANGES', message: '未检测到任何变更' },
    };
  }

  return { valid: true };
}

// ============================================================
// Execution
// ============================================================

// ============================================================
// Deletion
// ============================================================

/** 删除结果 */
export interface DeletionResult {
  success: boolean;
  deleted?: boolean;
  distributionId?: string;
  reversedCount?: number;
  error?: { code: string; message: string };
}

/** Max items per DynamoDB TransactWriteCommand for deletion batches */
const DELETION_USERS_PER_BATCH = 12; // 12 users × 2 items = 24 items (within 25 limit)

/**
 * Execute a full distribution deletion — reverse all awarded points for every
 * original recipient (including skill-claim points), write correction records,
 * and hard-delete the Distribution_Record.
 */
export async function executeDeletion(
  input: AdjustmentInput,
  original: DistributionRecord,
  client: DynamoDBDocumentClient,
  tables: {
    usersTable: string;
    pointsRecordsTable: string;
    batchDistributionsTable: string;
    activitySkillClaimsTable?: string;
  },
): Promise<AdjustmentResult> {
  const now = new Date().toISOString();
  const activityId = original.activityId ?? '';
  // Distribution deletion reverses ONLY this distribution's own role points.
  // Skill-claim points (技能分) are a separate award and are intentionally left
  // untouched here: deleting a role distribution must not remove a user's skill
  // points. Reversing them here also produced two Update operations on the same
  // user inside one DynamoDB transaction whenever a recipient was also a
  // skill-claim holder for the activity, which DynamoDB rejects (causing the
  // "删除事务执行失败" error). Skill points are managed separately via releaseSkills.

  // 1. Compute reversal per user (this distribution's role points only)
  const originalPoints = original.points;
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
    SpecialActivity: 'earnTotalSpecialActivity',
    SpecialReward: 'earnTotalSpecialReward',
  };
  const roleField = roleFieldMap[original.targetRole] ?? 'earnTotalSpeaker';

  // 2. Pre-check all users have sufficient balance
  const allUserIds = [...new Set(original.recipientIds)];
  const balanceChunks = chunkArray(allUserIds, 100);
  const balanceMap = new Map<string, number>();

  for (const chunk of balanceChunks) {
    const batchResult = await client.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, points',
          },
        },
      }),
    );
    const items = batchResult.Responses?.[tables.usersTable] ?? [];
    for (const item of items) {
      balanceMap.set(item.userId as string, (item.points as number) ?? 0);
    }
  }

  // Check each user's balance against the distribution reversal amount
  for (const userId of allUserIds) {
    const currentBalance = balanceMap.get(userId) ?? 0;
    if (currentBalance < originalPoints) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `用户 ${userId} 积分余额不足，当前 ${currentBalance}，需扣减 ${originalPoints}`,
        },
      };
    }
  }

  // 4. Build user transaction items (2 items per user: Update + Put correction).
  //    Skill claims are intentionally NOT reversed or deleted during a
  //    distribution deletion (see note above).
  const userTransactItems: any[] = [];
  for (const userId of allUserIds) {
    const recordId = ulid();

    // Update user: reverse points, earnTotal, and role-specific field
    userTransactItems.push({
      Update: {
        TableName: tables.usersTable,
        Key: { userId },
        UpdateExpression: `SET points = points - :pts, earnTotal = if_not_exists(earnTotal, :zero) - :pts, #rf = if_not_exists(#rf, :zero) - :pts, updatedAt = :now`,
        ExpressionAttributeNames: { '#rf': roleField },
        ExpressionAttributeValues: {
          ':pts': originalPoints,
          ':zero': 0,
          ':now': now,
        },
      },
    });

    // Put correction record
    userTransactItems.push({
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: {
          recordId,
          userId,
          type: 'adjust',
          amount: -originalPoints,
          source: `发放删除:${original.targetRole}|${original.activityUG ?? ''}|${original.activityTopic ?? ''}|${original.activityDate ?? ''}`,
          createdAt: now,
          activityId,
          activityUG: original.activityUG ?? '',
          activityTopic: original.activityTopic ?? '',
          activityDate: original.activityDate ?? '',
          targetRole: original.targetRole,
          distributionId: input.distributionId,
        },
      },
    });
  }

  // 5. Batch transaction items into groups of ≤24 items (12 users × 2 items)
  const allBatches = chunkArray(userTransactItems, DELETION_USERS_PER_BATCH * 2);

  // 6. Execute batches sequentially
  for (const batch of allBatches) {
    try {
      await client.send(
        new TransactWriteCommand({ TransactItems: batch }),
      );
    } catch (err: any) {
      console.error('Deletion transaction batch failed:', err);
      return {
        success: false,
        error: { code: 'ADJUSTMENT_FAILED', message: '删除事务执行失败' },
      };
    }
  }

  // 7. Hard-delete the Distribution_Record
  try {
    await client.send(
      new DeleteCommand({
        TableName: tables.batchDistributionsTable,
        Key: { distributionId: input.distributionId },
      }),
    );
  } catch (err: any) {
    console.error('Failed to delete Distribution_Record:', err);
    return {
      success: false,
      error: { code: 'ADJUSTMENT_FAILED', message: '删除发放记录失败' },
    };
  }

  // 8. Return success
  return {
    success: true,
    deleted: true,
    distributionId: input.distributionId,
    reversedCount: allUserIds.length,
  };
}

// ============================================================
// Adjustment Execution
// ============================================================

/** Max items per DynamoDB TransactWriteCommand (each user = 2 items: Update + earn Put/Update/Delete) */
const USERS_PER_BATCH = 12; // 12 users × 2 items = 24 items (within 25 limit)

/**
 * Build the exact `source` string of a distribution's base (non-skill) `earn`
 * PointsRecord for a given role. Mirrors `buildMergedSource(true, undefined, ...)`
 * in `batch-points.ts` (prefix `批量发放:{role}|{ug}|{topic}|{date}`), so it can be
 * used both to locate the original earn record and to write the corrected one.
 *
 * For special types:
 * - SpecialActivity: `特殊活动:{topic}|{ug}|{awardDate}|{normalizedTagName}`
 * - SpecialReward: `特殊奖励:{tagName}|{awardDate}`
 */
export function buildBaseEarnSource(
  role: string,
  activityUG?: string,
  activityTopic?: string,
  activityDate?: string,
  original?: DistributionRecord,
): string {
  if (role === 'SpecialActivity') {
    // 格式：特殊活动:{topic}|{ug}|{awardDate}|{normalizedTagName}
    const tagName = original?.awardTagName ?? '';
    return `特殊活动:${activityTopic ?? ''}|${activityUG ?? ''}|${activityDate ?? ''}|${tagName}`;
  }
  if (role === 'SpecialReward') {
    // 格式：特殊奖励:{tagName}|{awardDate}
    const tagName = original?.rewardTagName ?? '';
    return `特殊奖励:${tagName}|${activityDate ?? ''}`;
  }
  // 现有角色格式不变
  return `批量发放:${role}|${activityUG ?? ''}|${activityTopic ?? ''}|${activityDate ?? ''}`;
}

/**
 * Locate a recipient's base (non-skill) `earn` PointsRecord for a distribution so
 * it can be modified in place (role/points correction) or deleted (recipient
 * removed). Matches by `userId` (via the `userId-createdAt-index` GSI) + `type='earn'`
 * + `activityId` + exact base `source`, which uniquely identifies the base award
 * (skill records carry a `技能` source and are intentionally excluded). Returns the
 * earliest-created match's `recordId`, or `undefined` when none is found (e.g. a
 * historical record whose source shape differs — the caller then adjusts counters
 * only and skips the ledger op rather than failing).
 */
async function findBaseEarnRecordId(
  client: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  userId: string,
  activityId: string,
  baseSource: string,
): Promise<string | undefined> {
  let earliest: Record<string, any> | undefined;
  let startKey: Record<string, any> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#type = :earn AND activityId = :aid AND #src = :src',
        ExpressionAttributeNames: { '#type': 'type', '#src': 'source' },
        ExpressionAttributeValues: { ':uid': userId, ':earn': 'earn', ':aid': activityId, ':src': baseSource },
        ...(startKey && { ExclusiveStartKey: startKey }),
      }),
    );
    for (const item of res.Items ?? []) {
      if (!earliest || String(item.createdAt ?? '') < String(earliest.createdAt ?? '')) {
        earliest = item;
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return earliest?.recordId as string | undefined;
}

/**
 * Locate a recipient's `技能认领` (skill-claim) earn PointsRecord for an activity so it
 * can be edited in place when skills are released or assigned. batch-points merges all
 * of a user's skills for one activity into a single record, so there is at most one.
 * Matches by userId (GSI) + type='earn' + activityId + source begins_with '技能认领:'.
 * Returns the earliest-created matching item (with recordId/amount/source), or undefined.
 */
async function findSkillEarnRecord(
  client: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  userId: string,
  activityId: string,
): Promise<Record<string, any> | undefined> {
  let earliest: Record<string, any> | undefined;
  let startKey: Record<string, any> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#type = :earn AND activityId = :aid AND begins_with(#src, :pfx)',
        ExpressionAttributeNames: { '#type': 'type', '#src': 'source' },
        ExpressionAttributeValues: { ':uid': userId, ':earn': 'earn', ':aid': activityId, ':pfx': '技能认领:' },
        ...(startKey && { ExclusiveStartKey: startKey }),
      }),
    );
    for (const item of res.Items ?? []) {
      if (!earliest || String(item.createdAt ?? '') < String(earliest.createdAt ?? '')) {
        earliest = item;
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return earliest;
}

/** Skill-claim earn record source marker separating activity fields from the skill list. */
const SKILL_SOURCE_MARKER = '|技能:';

/** Build the `技能认领` earn source for a given skill set. */
function buildSkillClaimSource(activityUG: string, activityTopic: string, activityDate: string, skills: string[]): string {
  return `技能认领:Volunteer|${activityUG}|${activityTopic}|${activityDate}${SKILL_SOURCE_MARKER}${skills.join('+')}`;
}

/**
 * Execute a batch points adjustment.
 *
 * 1. Fetch original DistributionRecord
 * 2. Fetch PointsRuleConfig via getFeatureToggles
 * 3. Validate input and compute diff
 * 4. Check for negative balances on users with negative deltas
 * 5. Build and execute TransactWriteCommand batches (Update User + Put Correction per user)
 * 6. Handle role changes for retained users (decrease old role earnTotal, increase new)
 * 7. Update DistributionRecord with adjusted state
 */
export async function executeAdjustment(
  input: AdjustmentInput,
  client: DynamoDBDocumentClient,
  tables: {
    usersTable: string;
    pointsRecordsTable: string;
    batchDistributionsTable: string;
    activitySkillClaimsTable?: string;
  },
): Promise<AdjustmentResult> {
  // 1. Fetch original DistributionRecord
  const distResult = await client.send(
    new GetCommand({
      TableName: tables.batchDistributionsTable,
      Key: { distributionId: input.distributionId },
    }),
  );

  if (!distResult.Item) {
    return {
      success: false,
      error: { code: 'DISTRIBUTION_NOT_FOUND', message: '发放记录不存在' },
    };
  }

  const original = distResult.Item as DistributionRecord;

  // 1b. Validate SuperAdmin role for skill lock operations
  const hasSkillOps =
    (input.releaseSkills && input.releaseSkills.length > 0) ||
    (input.addSkillClaims && input.addSkillClaims.length > 0);
  if (hasSkillOps) {
    const isSuperAdminCaller = input.callerRoles?.includes('SuperAdmin') ?? false;
    if (!isSuperAdminCaller) {
      return {
        success: false,
        error: { code: 'FORBIDDEN', message: '仅超级管理员可执行技能锁释放或指派操作' },
      };
    }
  }

  // 2. Fetch PointsRuleConfig
  const toggles = await getFeatureToggles(client, tables.usersTable);
  const config = toggles.pointsRuleConfig ?? { ...DEFAULT_POINTS_RULE_CONFIG };

  // 3. Validate input
  const validation = validateAdjustmentInput(original, input, config);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // 3b. If deletion mode, delegate to executeDeletion
  if (validation.valid && 'isDeletion' in validation && validation.isDeletion) {
    return executeDeletion(input, original, client, tables);
  }

  // 4. Compute diff
  const diff = computeAdjustmentDiff(original, input, config);

  // 5. Check for negative balances — fetch current points for users with negative deltas
  const negativeUsers = diff.userAdjustments.filter(ua => ua.delta < 0);
  if (negativeUsers.length > 0) {
    const negativeUserIds = negativeUsers.map(u => u.userId);
    const balanceChunks = chunkArray(negativeUserIds, 100);
    const balanceMap = new Map<string, number>();

    for (const chunk of balanceChunks) {
      const batchResult = await client.send(
        new BatchGetCommand({
          RequestItems: {
            [tables.usersTable]: {
              Keys: chunk.map(userId => ({ userId })),
              ProjectionExpression: 'userId, points',
            },
          },
        }),
      );
      const items = batchResult.Responses?.[tables.usersTable] ?? [];
      for (const item of items) {
        balanceMap.set(item.userId as string, (item.points as number) ?? 0);
      }
    }

    // Check each negative-delta user
    for (const ua of negativeUsers) {
      const currentBalance = balanceMap.get(ua.userId) ?? 0;
      if (currentBalance + ua.delta < 0) {
        return {
          success: false,
          error: {
            code: 'INSUFFICIENT_BALANCE',
            message: `用户 ${ua.userId} 积分余额不足，当前 ${currentBalance}，需扣减 ${Math.abs(ua.delta)}`,
          },
        };
      }
    }
  }

  // 6. Fetch user details for new recipients (for recipientDetails update + balanceAfter on newly-added earn records)
  const allNewUserIds = [...new Set(input.recipientIds)];
  const userDetailsMap = new Map<string, { userId: string; nickname: string; email: string }>();
  const balanceByUser = new Map<string, number>();
  const detailChunks = chunkArray(allNewUserIds, 100);
  for (const chunk of detailChunks) {
    const batchResult = await client.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname, email, points',
          },
        },
      }),
    );
    const items = batchResult.Responses?.[tables.usersTable] ?? [];
    for (const item of items) {
      userDetailsMap.set(item.userId as string, {
        userId: item.userId as string,
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
      });
      balanceByUser.set(item.userId as string, (item.points as number) ?? 0);
    }
  }

  // 7. Build and execute transaction batches
  const now = new Date().toISOString();
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
    SpecialActivity: 'earnTotalSpecialActivity',
    SpecialReward: 'earnTotalSpecialReward',
  };
  const originalRoleField = roleFieldMap[original.targetRole] ?? 'earnTotalSpeaker';
  const newRoleField = roleFieldMap[input.targetRole] ?? 'earnTotalSpeaker';
  const roleChanged = original.targetRole !== input.targetRole;

  // 7a. Build releaseSkills transaction items (if any)
  const releaseSkillItems: any[] = [];
  if (input.releaseSkills && input.releaseSkills.length > 0) {
    const activityId = original.activityId ?? '';
    const skillClaimsTableName = tables.activitySkillClaimsTable ?? process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';

    if (!activityId || !skillClaimsTableName) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: '缺少 activityId 或技能认领表配置' },
      };
    }

    // Fetch existing skill claims for this activity
    const existingClaims = await getSkillClaimsForActivity(activityId, client, skillClaimsTableName);
    const claimsBySkill = new Map<string, SkillClaimRecord>();
    for (const claim of existingClaims) {
      claimsBySkill.set(claim.skill, claim);
    }

    for (const releaseItem of input.releaseSkills) {
      const existingClaim = claimsBySkill.get(releaseItem.skill);
      if (!existingClaim) {
        // Skill not currently claimed — skip silently or return error
        continue;
      }

      const { userId, pointsAwarded } = existingClaim;

      // a. Delete the SkillClaim record
      releaseSkillItems.push({
        Delete: {
          TableName: skillClaimsTableName,
          Key: { activityId, skill: releaseItem.skill },
        },
      });

      // b. Update user's balance: decrease points, earnTotal, and earnTotalVolunteer
      //    by pointsAwarded. Skill points are Volunteer-classified (that's how they are
      //    awarded in batch-points), so the role counter to decrement is earnTotalVolunteer.
      releaseSkillItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId },
          UpdateExpression: `SET points = points - :pts, earnTotal = if_not_exists(earnTotal, :zero) - :pts, earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) - :pts, updatedAt = :now`,
          ExpressionAttributeValues: {
            ':pts': pointsAwarded,
            ':zero': 0,
            ':now': now,
          },
        },
      });

      // c. Directly edit the original 技能认领 earn record instead of writing a
      //    技能释放 correction record: drop this skill from it (reduce amount + remove
      //    the skill token), or delete the record entirely if it was the only skill.
      const skillEarn = await findSkillEarnRecord(client, tables.pointsRecordsTable, userId, activityId);
      if (skillEarn) {
        const src = String(skillEarn.source ?? '');
        const mi = src.indexOf(SKILL_SOURCE_MARKER);
        const remaining = mi >= 0
          ? src.slice(mi + SKILL_SOURCE_MARKER.length).split('+').filter(s => s && s !== releaseItem.skill)
          : [];
        if (remaining.length === 0) {
          releaseSkillItems.push({
            Delete: { TableName: tables.pointsRecordsTable, Key: { recordId: skillEarn.recordId } },
          });
        } else {
          const newAmount = (typeof skillEarn.amount === 'number' ? skillEarn.amount : 0) - pointsAwarded;
          const newSource = src.slice(0, mi) + SKILL_SOURCE_MARKER + remaining.join('+');
          releaseSkillItems.push({
            Update: {
              TableName: tables.pointsRecordsTable,
              Key: { recordId: skillEarn.recordId },
              UpdateExpression: `SET #amt = :amt, #src = :src`,
              ExpressionAttributeNames: { '#amt': 'amount', '#src': 'source' },
              ExpressionAttributeValues: { ':amt': newAmount, ':src': newSource },
            },
          });
        }
      }
    }
  }

  // 7b. Build addSkillClaims transaction items (if any)
  const addSkillClaimItems: any[] = [];
  if (input.addSkillClaims && input.addSkillClaims.length > 0) {
    const activityId = original.activityId ?? '';
    const skillClaimsTableName = tables.activitySkillClaimsTable ?? process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';

    if (!activityId || !skillClaimsTableName) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: '缺少 activityId 或技能认领表配置' },
      };
    }

    // Fetch user nicknames for the skill claim targets
    const addSkillUserIds = [...new Set(input.addSkillClaims.map(sc => sc.userId))];
    const skillUserNicknameMap = new Map<string, string>();

    // Check if we already have nicknames from the userDetailsMap
    for (const uid of addSkillUserIds) {
      const existing = userDetailsMap.get(uid);
      if (existing) {
        skillUserNicknameMap.set(uid, existing.nickname);
      }
    }

    // Fetch any missing nicknames
    const missingNicknameUserIds = addSkillUserIds.filter(uid => !skillUserNicknameMap.has(uid));
    if (missingNicknameUserIds.length > 0) {
      const nicknameChunks = chunkArray(missingNicknameUserIds, 100);
      for (const chunk of nicknameChunks) {
        const batchResult = await client.send(
          new BatchGetCommand({
            RequestItems: {
              [tables.usersTable]: {
                Keys: chunk.map(userId => ({ userId })),
                ProjectionExpression: 'userId, nickname',
              },
            },
          }),
        );
        const items = batchResult.Responses?.[tables.usersTable] ?? [];
        for (const item of items) {
          skillUserNicknameMap.set(item.userId as string, (item.nickname as string) ?? '');
        }
      }
    }

    for (const addItem of input.addSkillClaims) {
      const pointsAwarded =
        addItem.skill === 'liveSupport' ? config.liveSupportPoints
        : addItem.skill === 'posterDesign' ? config.posterDesignPoints
        : config.articleEditingPoints;
      const userNickname = skillUserNicknameMap.get(addItem.userId) ?? '';

      // a. Put new SkillClaim with attribute_not_exists(activityId) condition
      addSkillClaimItems.push({
        Put: {
          TableName: skillClaimsTableName,
          Item: {
            activityId,
            skill: addItem.skill,
            userId: addItem.userId,
            userNickname,
            claimedAt: now,
            claimedBy: input.adjustedBy,
            distributionId: input.distributionId,
            pointsAwarded,
          },
          ConditionExpression: 'attribute_not_exists(activityId)',
        },
      });

      // b. Update user's balance: increase points, earnTotal, and earnTotalVolunteer
      //    by pointsAwarded (skill points are Volunteer-classified, matching batch-points).
      addSkillClaimItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId: addItem.userId },
          UpdateExpression: `SET points = points + :pts, earnTotal = if_not_exists(earnTotal, :zero) + :pts, earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) + :pts, updatedAt = :now`,
          ExpressionAttributeValues: {
            ':pts': pointsAwarded,
            ':zero': 0,
            ':now': now,
          },
        },
      });

      // c. Directly add this skill to the recipient's 技能认领 earn record instead of
      //    writing a 技能指派 correction record: merge into the existing record (amount +
      //    skill token), or create a fresh one when the user has no skill record yet.
      const existingSkillEarn = await findSkillEarnRecord(client, tables.pointsRecordsTable, addItem.userId, activityId);
      if (existingSkillEarn) {
        const src = String(existingSkillEarn.source ?? '');
        const mi = src.indexOf(SKILL_SOURCE_MARKER);
        const skills = mi >= 0 ? src.slice(mi + SKILL_SOURCE_MARKER.length).split('+').filter(Boolean) : [];
        if (!skills.includes(addItem.skill)) skills.push(addItem.skill);
        const base = mi >= 0 ? src.slice(0, mi) : src;
        const newAmount = (typeof existingSkillEarn.amount === 'number' ? existingSkillEarn.amount : 0) + pointsAwarded;
        addSkillClaimItems.push({
          Update: {
            TableName: tables.pointsRecordsTable,
            Key: { recordId: existingSkillEarn.recordId },
            UpdateExpression: `SET #amt = :amt, #src = :src`,
            ExpressionAttributeNames: { '#amt': 'amount', '#src': 'source' },
            ExpressionAttributeValues: { ':amt': newAmount, ':src': base + SKILL_SOURCE_MARKER + skills.join('+') },
          },
        });
      } else {
        addSkillClaimItems.push({
          Put: {
            TableName: tables.pointsRecordsTable,
            Item: {
              recordId: ulid(),
              userId: addItem.userId,
              type: 'earn',
              amount: pointsAwarded,
              source: buildSkillClaimSource(original.activityUG ?? '', original.activityTopic ?? '', original.activityDate ?? '', [addItem.skill]),
              balanceAfter: (balanceByUser.get(addItem.userId) ?? 0) + pointsAwarded,
              createdAt: now,
              activityId,
              activityType: original.activityType,
              activityUG: original.activityUG ?? '',
              activityTopic: original.activityTopic ?? '',
              activityDate: original.activityDate ?? '',
              targetRole: 'Volunteer',
            },
          },
        });
      }
    }
  }

  // Build the per-user operations. This feature edits the original distribution's
  // `earn` PointsRecords directly instead of writing `adjust` correction history:
  //   - remove  → decrement counters + DELETE the recipient's base earn record
  //   - add     → increment counters + PUT a new base earn record
  //   - modify  → adjust counters + UPDATE the recipient's base earn record in place
  //               (new role / new points / new source), preserving its recordId and
  //               createdAt so the award keeps its original position on the timeline.
  // No `adjust` records are produced here. Skill lock release/assign (handled above)
  // likewise edit the recipient's 技能认领 earn record directly instead of writing
  // 技能释放/技能指派 correction records.
  const originalBaseSource = buildBaseEarnSource(
    original.targetRole,
    original.activityUG,
    original.activityTopic,
    original.activityDate,
    original,
  );
  const newBaseSource = buildBaseEarnSource(
    input.targetRole,
    original.activityUG,
    original.activityTopic,
    original.activityDate,
    original,
  );

  interface UserOp {
    userId: string;
    kind: 'add' | 'remove' | 'modify';
    delta: number;
    earnRecordId?: string;
  }
  const userOps: UserOp[] = [];
  for (const userId of diff.removedUserIds) {
    userOps.push({ userId, kind: 'remove', delta: -diff.originalPoints });
  }
  for (const userId of diff.addedUserIds) {
    userOps.push({ userId, kind: 'add', delta: diff.newPoints });
  }
  // Retained recipients only need a ledger edit when the role changed or the points value changed.
  for (const userId of diff.retainedUserIds) {
    if (roleChanged || diff.pointsDelta !== 0) {
      userOps.push({ userId, kind: 'modify', delta: diff.pointsDelta });
    }
  }

  // Resolve the recordId of the base earn record for remove/modify ops (needed to
  // Delete/Update by primary key inside the transaction). The original earn record
  // still carries the ORIGINAL role, so it is located via originalBaseSource.
  for (const op of userOps) {
    if (op.kind === 'remove' || op.kind === 'modify') {
      op.earnRecordId = await findBaseEarnRecordId(
        client,
        tables.pointsRecordsTable,
        op.userId,
        original.activityId ?? '',
        originalBaseSource,
      );
    }
  }

  const userBatches = chunkArray(userOps, USERS_PER_BATCH);

  // Include releaseSkillItems and addSkillClaimItems in the first transaction batch for atomicity
  // Per requirement 12.9: releaseSkills first, then addSkillClaims
  let skillItemsIncluded = false;

  // If there are no user adjustments but there are skill items, execute them in a standalone transaction
  if (userBatches.length === 0 && (releaseSkillItems.length > 0 || addSkillClaimItems.length > 0)) {
    const transactItems: any[] = [...releaseSkillItems, ...addSkillClaimItems];
    skillItemsIncluded = true;

    try {
      await client.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (err: any) {
      // Handle TransactionCanceledException with ConditionalCheckFailed for addSkillClaims
      if (
        addSkillClaimItems.length > 0 &&
        (err.name === 'TransactionCanceledException' || err.name === 'ConditionalCheckFailedException')
      ) {
        const cancellationReasons = err.CancellationReasons as Array<{ Code?: string }> | undefined;
        const hasConditionalCheckFailed =
          err.name === 'ConditionalCheckFailedException' ||
          (cancellationReasons && cancellationReasons.some((r: { Code?: string }) => r.Code === 'ConditionalCheckFailed'));

        if (hasConditionalCheckFailed) {
          const activityId = original.activityId ?? '';
          const skillClaimsTableName = tables.activitySkillClaimsTable ?? process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';

          try {
            const existingClaims = await getSkillClaimsForActivity(activityId, client, skillClaimsTableName);
            const requestedSkills = input.addSkillClaims!.map(sc => sc.skill);
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

      console.error('Skill operations transaction failed:', err);
      return {
        success: false,
        error: { code: 'ADJUSTMENT_FAILED', message: '调整事务执行失败' },
      };
    }
  }

  for (const batch of userBatches) {
    const transactItems: any[] = [];

    // Prepend releaseSkillItems and addSkillClaimItems to the first batch (release first, then add)
    if (!skillItemsIncluded && (releaseSkillItems.length > 0 || addSkillClaimItems.length > 0)) {
      transactItems.push(...releaseSkillItems);
      transactItems.push(...addSkillClaimItems);
      skillItemsIncluded = true;
    }

    for (const op of batch) {
      if (op.kind === 'add') {
        // Newly-added recipient: increment counters and write a fresh base earn record.
        transactItems.push({
          Update: {
            TableName: tables.usersTable,
            Key: { userId: op.userId },
            UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #rf = if_not_exists(#rf, :zero) + :delta, updatedAt = :now`,
            ExpressionAttributeNames: { '#rf': newRoleField },
            ExpressionAttributeValues: { ':delta': op.delta, ':zero': 0, ':now': now },
          },
        });
        const currentBalance = balanceByUser.get(op.userId) ?? 0;
        const earnItem: Record<string, any> = {
          recordId: ulid(),
          userId: op.userId,
          type: 'earn',
          amount: diff.newPoints,
          source: newBaseSource,
          balanceAfter: currentBalance + diff.newPoints,
          createdAt: now,
          activityId: original.activityId ?? '',
          activityType: original.activityType,
          activityUG: original.activityUG ?? '',
          activityTopic: original.activityTopic ?? '',
          activityDate: original.activityDate ?? '',
          targetRole: input.targetRole,
        };
        // Special types carry tag-specific fields on their earn records
        if (input.targetRole === 'SpecialActivity') {
          earnItem.awardTagId = original.awardTagId ?? '';
          earnItem.awardTagName = original.awardTagName ?? '';
        }
        if (input.targetRole === 'SpecialReward') {
          earnItem.rewardTagId = original.rewardTagId ?? '';
          earnItem.rewardTagName = original.rewardTagName ?? '';
        }
        transactItems.push({
          Put: {
            TableName: tables.pointsRecordsTable,
            Item: earnItem,
          },
        });
      } else if (op.kind === 'remove') {
        // Removed recipient: decrement counters (original role) and delete the base earn record.
        transactItems.push({
          Update: {
            TableName: tables.usersTable,
            Key: { userId: op.userId },
            UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #rf = if_not_exists(#rf, :zero) + :delta, updatedAt = :now`,
            ExpressionAttributeNames: { '#rf': originalRoleField },
            ExpressionAttributeValues: { ':delta': op.delta, ':zero': 0, ':now': now },
          },
        });
        if (op.earnRecordId) {
          transactItems.push({
            Delete: {
              TableName: tables.pointsRecordsTable,
              Key: { recordId: op.earnRecordId },
            },
          });
        }
      } else {
        // Retained recipient with a role and/or points change: adjust counters and
        // UPDATE the original base earn record in place (recordId + createdAt preserved).
        if (roleChanged) {
          transactItems.push({
            Update: {
              TableName: tables.usersTable,
              Key: { userId: op.userId },
              UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #origRole = if_not_exists(#origRole, :zero) - :origPts, #newRole = if_not_exists(#newRole, :zero) + :newPts, updatedAt = :now`,
              ExpressionAttributeNames: { '#origRole': originalRoleField, '#newRole': newRoleField },
              ExpressionAttributeValues: {
                ':delta': op.delta,
                ':origPts': diff.originalPoints,
                ':newPts': diff.newPoints,
                ':zero': 0,
                ':now': now,
              },
            },
          });
        } else {
          transactItems.push({
            Update: {
              TableName: tables.usersTable,
              Key: { userId: op.userId },
              UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #rf = if_not_exists(#rf, :zero) + :delta, updatedAt = :now`,
              ExpressionAttributeNames: { '#rf': newRoleField },
              ExpressionAttributeValues: { ':delta': op.delta, ':zero': 0, ':now': now },
            },
          });
        }
        if (op.earnRecordId) {
          transactItems.push({
            Update: {
              TableName: tables.pointsRecordsTable,
              Key: { recordId: op.earnRecordId },
              UpdateExpression: `SET #tr = :tr, #amt = :amt, #src = :src`,
              ExpressionAttributeNames: { '#tr': 'targetRole', '#amt': 'amount', '#src': 'source' },
              ExpressionAttributeValues: {
                ':tr': input.targetRole,
                ':amt': diff.newPoints,
                ':src': newBaseSource,
              },
            },
          });
        }
      }
    }

    try {
      await client.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (err: any) {
      // Handle TransactionCanceledException with ConditionalCheckFailed for addSkillClaims
      if (
        addSkillClaimItems.length > 0 &&
        (err.name === 'TransactionCanceledException' || err.name === 'ConditionalCheckFailedException')
      ) {
        const cancellationReasons = err.CancellationReasons as Array<{ Code?: string }> | undefined;
        const hasConditionalCheckFailed =
          err.name === 'ConditionalCheckFailedException' ||
          (cancellationReasons && cancellationReasons.some((r: { Code?: string }) => r.Code === 'ConditionalCheckFailed'));

        if (hasConditionalCheckFailed) {
          const activityId = original.activityId ?? '';
          const skillClaimsTableName = tables.activitySkillClaimsTable ?? process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';

          // Re-read existing claims to find the occupant
          try {
            const existingClaims = await getSkillClaimsForActivity(activityId, client, skillClaimsTableName);
            const requestedSkills = input.addSkillClaims!.map(sc => sc.skill);
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

      console.error('Adjustment transaction batch failed:', err);
      return {
        success: false,
        error: { code: 'ADJUSTMENT_FAILED', message: '调整事务执行失败' },
      };
    }
  }

  // 8. Update DistributionRecord
  const newPoints = diff.newPoints;
  const successCount = allNewUserIds.length;
  const totalPoints = successCount * newPoints;
  const newRecipientDetails = allNewUserIds.map(id => userDetailsMap.get(id) ?? { userId: id, nickname: '', email: '' });

  try {
    await client.send(
      new UpdateCommand({
        TableName: tables.batchDistributionsTable,
        Key: { distributionId: input.distributionId },
        UpdateExpression: `SET recipientIds = :rids, recipientDetails = :rdetails, targetRole = :tr, points = :pts, successCount = :sc, totalPoints = :tp, adjustedAt = :aat, adjustedBy = :aby${input.speakerType ? ', speakerType = :st' : ''}`,
        ExpressionAttributeValues: {
          ':rids': allNewUserIds,
          ':rdetails': newRecipientDetails,
          ':tr': input.targetRole,
          ':pts': newPoints,
          ':sc': successCount,
          ':tp': totalPoints,
          ':aat': now,
          ':aby': input.adjustedBy,
          ...(input.speakerType && { ':st': input.speakerType }),
        },
      }),
    );
  } catch (err) {
    console.error('Failed to update DistributionRecord:', err);
    return {
      success: false,
      error: { code: 'ADJUSTMENT_FAILED', message: '更新发放记录失败' },
    };
  }

  return { success: true };
}
