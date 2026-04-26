import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { DistributionRecord } from '@points-mall/shared';
import { getFeatureToggles, DEFAULT_POINTS_RULE_CONFIG } from '../settings/feature-toggles';
import type { PointsRuleConfig } from '../settings/feature-toggles';
import { calculateExpectedPoints, chunkArray } from './batch-points';

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
 * - INVALID_REQUEST: empty recipientIds or Speaker without speakerType
 * - VOLUNTEER_LIMIT_EXCEEDED: volunteer count exceeds config limit
 * - NO_CHANGES: no actual changes detected
 */
export type AdjustmentValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string } };

export function validateAdjustmentInput(
  original: DistributionRecord,
  input: AdjustmentInput,
  config: PointsRuleConfig,
): AdjustmentValidationResult {
  // 1. Reject empty recipientIds
  if (!input.recipientIds || input.recipientIds.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: '调整后的接收人列表不能为空' },
    };
  }

  // 2. Reject Speaker without speakerType
  if (input.targetRole === 'Speaker' && !input.speakerType) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'Speaker 角色必须指定 speakerType' },
    };
  }

  // 3. Reject volunteer count exceeding limit
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

  // 4. Reject if no actual changes detected
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

  // 2. Fetch PointsRuleConfig
  const toggles = await getFeatureToggles(client, tables.usersTable);
  const config = toggles.pointsRuleConfig ?? { ...DEFAULT_POINTS_RULE_CONFIG };

  // 3. Validate input
  const validation = validateAdjustmentInput(original, input, config);
  if (!validation.valid) {
    return { success: false, error: validation.error };
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

  // Build transaction items for all affected users
  const affectedUsers = diff.userAdjustments;
  const userBatches = chunkArray(affectedUsers, USERS_PER_BATCH);

  for (const batch of userBatches) {
    const transactItems: any[] = [];

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
    } catch (err) {
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
