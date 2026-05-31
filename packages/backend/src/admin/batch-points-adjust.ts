import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  TransactWriteCommand,
  UpdateCommand,
  DeleteCommand,
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
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer';
  speakerType?: 'typeA' | 'typeB' | 'roundtable';
  adjustedBy: string;
  /** Caller's roles — used for SuperAdmin validation on skill lock operations */
  callerRoles?: string[];
  /** Release existing skill locks (SuperAdmin only) */
  releaseSkills?: Array<{ skill: SkillType }>;
  /** Add new skill lock claims (SuperAdmin only) */
  addSkillClaims?: Array<{ skill: SkillType; userId: string }>;
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
  const newPoints = calculateExpectedPoints(input.targetRole, input.speakerType, config);
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

export function validateAdjustmentInput(
  original: DistributionRecord,
  input: AdjustmentInput,
  config: PointsRuleConfig,
): AdjustmentValidationResult {
  // 1. Empty recipientIds → deletion mode, skip all other validations
  if (!input.recipientIds || input.recipientIds.length === 0) {
    return { valid: true, isDeletion: true };
  }

  // 2. Reject Speaker without speakerType
  if (input.targetRole === 'Speaker' && !input.speakerType) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'Speaker 角色必须指定 speakerType' },
    };
  }

  // 3. Reject Speaker with invalid speakerType value
  if (input.targetRole === 'Speaker' && input.speakerType && !VALID_SPEAKER_TYPES.has(input.speakerType)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: `无效的 speakerType: ${input.speakerType}，必须为 typeA、typeB 或 roundtable` },
    };
  }

  // 4. Reject volunteer count exceeding limit
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

  // 5. Reject if no actual changes detected
  const originalSorted = [...original.recipientIds].sort();
  const newSorted = [...new Set(input.recipientIds)].sort();
  const sameRecipients =
    originalSorted.length === newSorted.length &&
    originalSorted.every((id, i) => id === newSorted[i]);
  const sameRole = input.targetRole === original.targetRole;
  const sameSpeakerType = input.speakerType === original.speakerType;

  if (sameRecipients && sameRole && sameSpeakerType) {
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
  const skillClaimsTableName = tables.activitySkillClaimsTable ?? process.env.ACTIVITY_SKILL_CLAIMS_TABLE ?? '';

  // 1. Fetch skill claims for the activity
  let skillClaims: SkillClaimRecord[] = [];
  if (activityId && skillClaimsTableName) {
    skillClaims = await getSkillClaimsForActivity(activityId, client, skillClaimsTableName);
  }

  // 2. Compute total reversal per user: originalPoints + any skill-claim pointsAwarded
  const originalPoints = original.points;
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
  };
  const roleField = roleFieldMap[original.targetRole] ?? 'earnTotalSpeaker';

  // Build a map of userId → total skill claim points for that user
  const skillClaimPointsByUser = new Map<string, number>();
  for (const claim of skillClaims) {
    const current = skillClaimPointsByUser.get(claim.userId) ?? 0;
    skillClaimPointsByUser.set(claim.userId, current + claim.pointsAwarded);
  }

  // Total reversal per user = originalPoints + skill claim points for that user
  const totalReversalByUser = new Map<string, number>();
  for (const userId of original.recipientIds) {
    const skillPts = skillClaimPointsByUser.get(userId) ?? 0;
    totalReversalByUser.set(userId, originalPoints + skillPts);
  }

  // 3. Pre-check all users have sufficient balance
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

  // Check each user's balance against total reversal
  for (const userId of allUserIds) {
    const currentBalance = balanceMap.get(userId) ?? 0;
    const totalReversal = totalReversalByUser.get(userId) ?? originalPoints;
    if (currentBalance < totalReversal) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: `用户 ${userId} 积分余额不足，当前 ${currentBalance}，需扣减 ${totalReversal}`,
        },
      };
    }
  }

  // 4. Build transaction items

  // 4a. Build skill claim transaction items (3 items per claim: Delete + Update user + Put correction)
  const skillClaimTransactItems: any[] = [];
  for (const claim of skillClaims) {
    const recordId = ulid();

    // Delete the skill claim record
    skillClaimTransactItems.push({
      Delete: {
        TableName: skillClaimsTableName,
        Key: { activityId: claim.activityId, skill: claim.skill },
      },
    });

    // Update user: reverse skill points from points, earnTotal, earnTotalLeader
    skillClaimTransactItems.push({
      Update: {
        TableName: tables.usersTable,
        Key: { userId: claim.userId },
        UpdateExpression: `SET points = points - :pts, earnTotal = if_not_exists(earnTotal, :zero) - :pts, earnTotalLeader = if_not_exists(earnTotalLeader, :zero) - :pts, updatedAt = :now`,
        ExpressionAttributeValues: {
          ':pts': claim.pointsAwarded,
          ':zero': 0,
          ':now': now,
        },
      },
    });

    // Put correction record for skill claim reversal
    skillClaimTransactItems.push({
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: {
          recordId,
          userId: claim.userId,
          type: 'adjust',
          amount: -claim.pointsAwarded,
          source: `技能释放(删除):${claim.skill}|${original.activityUG ?? ''}|${original.activityTopic ?? ''}|${original.activityDate ?? ''}`,
          createdAt: now,
          activityId,
          activityUG: original.activityUG ?? '',
          activityTopic: original.activityTopic ?? '',
          activityDate: original.activityDate ?? '',
          targetRole: 'UserGroupLeader',
          distributionId: input.distributionId,
        },
      },
    });
  }

  // 4b. Build user transaction items (2 items per user: Update + Put correction)
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

  // 5. Batch transaction items into groups of ≤25 items
  // Strategy: skill claim items (3 each) prepended to first user batch;
  // if they overflow, they get their own batch(es)
  const allBatches: any[][] = [];

  // Split user items into batches of 12 users (24 items)
  const userBatches = chunkArray(userTransactItems, DELETION_USERS_PER_BATCH * 2); // 2 items per user

  if (skillClaimTransactItems.length === 0) {
    // No skill claims — just user batches
    allBatches.push(...userBatches);
  } else if (userBatches.length > 0) {
    // Try to prepend skill claim items to the first user batch
    const firstUserBatch = userBatches[0];
    const combined = [...skillClaimTransactItems, ...firstUserBatch];

    if (combined.length <= 25) {
      // Fits in one batch
      allBatches.push(combined);
      // Add remaining user batches
      for (let i = 1; i < userBatches.length; i++) {
        allBatches.push(userBatches[i]);
      }
    } else {
      // Skill claims overflow — put them in their own batch(es)
      const skillBatches = chunkArray(skillClaimTransactItems, 25);
      allBatches.push(...skillBatches);
      allBatches.push(...userBatches);
    }
  } else {
    // No users but have skill claims (edge case)
    const skillBatches = chunkArray(skillClaimTransactItems, 25);
    allBatches.push(...skillBatches);
  }

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

/** Max items per DynamoDB TransactWriteCommand (each user = 2 items: Update + Put) */
const USERS_PER_BATCH = 12; // 12 users × 2 items = 24 items (within 25 limit)

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

  // 6. Fetch user details for new recipients (for recipientDetails update)
  const allNewUserIds = [...new Set(input.recipientIds)];
  const userDetailsMap = new Map<string, { userId: string; nickname: string; email: string }>();
  const detailChunks = chunkArray(allNewUserIds, 100);
  for (const chunk of detailChunks) {
    const batchResult = await client.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname, email',
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
    }
  }

  // 7. Build and execute transaction batches
  const now = new Date().toISOString();
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
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
      const recordId = ulid();

      // a. Delete the SkillClaim record
      releaseSkillItems.push({
        Delete: {
          TableName: skillClaimsTableName,
          Key: { activityId, skill: releaseItem.skill },
        },
      });

      // b. Update user's balance: decrease points, earnTotal, earnTotalLeader by pointsAwarded
      releaseSkillItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId },
          UpdateExpression: `SET points = points - :pts, earnTotal = if_not_exists(earnTotal, :zero) - :pts, earnTotalLeader = if_not_exists(earnTotalLeader, :zero) - :pts, updatedAt = :now`,
          ExpressionAttributeValues: {
            ':pts': pointsAwarded,
            ':zero': 0,
            ':now': now,
          },
        },
      });

      // c. Put a new PointsRecord with type: 'adjust', amount: -pointsAwarded
      releaseSkillItems.push({
        Put: {
          TableName: tables.pointsRecordsTable,
          Item: {
            recordId,
            userId,
            type: 'adjust',
            amount: -pointsAwarded,
            source: `技能释放:${releaseItem.skill}|${original.activityUG ?? ''}|${original.activityTopic ?? ''}|${original.activityDate ?? ''}`,
            createdAt: now,
            activityId,
            activityUG: original.activityUG ?? '',
            activityTopic: original.activityTopic ?? '',
            activityDate: original.activityDate ?? '',
            targetRole: 'UserGroupLeader',
            distributionId: input.distributionId,
          },
        },
      });
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
      const recordId = ulid();
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

      // b. Update user's balance: increase points, earnTotal, earnTotalLeader by pointsAwarded
      addSkillClaimItems.push({
        Update: {
          TableName: tables.usersTable,
          Key: { userId: addItem.userId },
          UpdateExpression: `SET points = points + :pts, earnTotal = if_not_exists(earnTotal, :zero) + :pts, earnTotalLeader = if_not_exists(earnTotalLeader, :zero) + :pts, updatedAt = :now`,
          ExpressionAttributeValues: {
            ':pts': pointsAwarded,
            ':zero': 0,
            ':now': now,
          },
        },
      });

      // c. Put a new PointsRecord with type: 'adjust', amount: +pointsAwarded
      addSkillClaimItems.push({
        Put: {
          TableName: tables.pointsRecordsTable,
          Item: {
            recordId,
            userId: addItem.userId,
            type: 'adjust',
            amount: pointsAwarded,
            source: `技能指派:${addItem.skill}|${original.activityUG ?? ''}|${original.activityTopic ?? ''}|${original.activityDate ?? ''}`,
            createdAt: now,
            activityId,
            activityUG: original.activityUG ?? '',
            activityTopic: original.activityTopic ?? '',
            activityDate: original.activityDate ?? '',
            targetRole: 'UserGroupLeader',
            distributionId: input.distributionId,
          },
        },
      });
    }
  }

  // Build transaction items for all affected users
  const affectedUsers = diff.userAdjustments;
  const userBatches = chunkArray(affectedUsers, USERS_PER_BATCH);

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

    for (const ua of batch) {
      const recordId = ulid();
      const isRetained = diff.retainedUserIds.includes(ua.userId);
      const isAdded = diff.addedUserIds.includes(ua.userId);
      const isRemoved = diff.removedUserIds.includes(ua.userId);

      // Determine which role fields to update
      if (roleChanged && isRetained) {
        // Role change for retained users: decrease original role earnTotal, increase new role earnTotal
        transactItems.push({
          Update: {
            TableName: tables.usersTable,
            Key: { userId: ua.userId },
            UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #origRole = if_not_exists(#origRole, :zero) - :origPts, #newRole = if_not_exists(#newRole, :zero) + :newPts, updatedAt = :now`,
            ExpressionAttributeNames: {
              '#origRole': originalRoleField,
              '#newRole': newRoleField,
            },
            ExpressionAttributeValues: {
              ':delta': ua.delta,
              ':origPts': diff.originalPoints,
              ':newPts': diff.newPoints,
              ':zero': 0,
              ':now': now,
            },
          },
        });
      } else {
        // Normal case: adjust points, earnTotal, and the appropriate role field
        const roleField = isRemoved ? originalRoleField : newRoleField;
        transactItems.push({
          Update: {
            TableName: tables.usersTable,
            Key: { userId: ua.userId },
            UpdateExpression: `SET points = points + :delta, earnTotal = if_not_exists(earnTotal, :zero) + :delta, #rf = if_not_exists(#rf, :zero) + :delta, updatedAt = :now`,
            ExpressionAttributeNames: { '#rf': roleField },
            ExpressionAttributeValues: {
              ':delta': ua.delta,
              ':zero': 0,
              ':now': now,
            },
          },
        });
      }

      // Put Correction_Record
      transactItems.push({
        Put: {
          TableName: tables.pointsRecordsTable,
          Item: {
            recordId,
            userId: ua.userId,
            type: 'adjust',
            amount: ua.delta,
            source: `积分调整:${input.targetRole}|${original.activityUG ?? ''}|${original.activityTopic ?? ''}|${original.activityDate ?? ''}`,
            createdAt: now,
            activityId: original.activityId ?? '',
            activityUG: original.activityUG ?? '',
            activityTopic: original.activityTopic ?? '',
            activityDate: original.activityDate ?? '',
            targetRole: isRemoved ? original.targetRole : input.targetRole,
            distributionId: input.distributionId,
          },
        },
      });
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
