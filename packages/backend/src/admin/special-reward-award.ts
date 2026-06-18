/**
 * 特殊奖励积分颁发 — 独立发放路径
 *
 * 与 `executeBatchDistribution`（身份分批量发放）**以及**
 * `executeSpecialActivityDistribution`（特殊活动积分发放）严格隔离，仅写入：
 *   - Users.points
 *   - Users.earnTotal
 *   - Users.earnTotalSpecialReward
 *
 * **不**写入 `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer`
 * 任何身份分字段，**也不**写入 `earnTotalSpecialActivity`。
 *
 * 本文件分两部分：
 *   1. 输入类型 / 校验 / 去重查询（task 4.1，本提交）
 *   2. `executeSpecialRewardDistribution` 主流程编排（task 4.2，后续提交）
 *
 * 设计依据：
 *   - `.kiro/specs/special-reward-award/design.md`
 *   - `.kiro/specs/special-reward-award/requirements.md`（6.11 ~ 6.17, 8.1）
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  PutCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { DistributionRecord } from '@points-mall/shared';
import { validateRewardTagName, upsertRewardTagUsage } from './reward-tags';
import { chunkArray } from './batch-points';

// ============================================================
// 接口定义
// ============================================================

/**
 * 特殊奖励积分发放请求输入。
 *
 * 注：`rewardTagName` 为用户原文（未归一化），由 `executeSpecialRewardDistribution`
 * 在落库前调用 `normalizeTagName` 进行归一化。`validateSpecialRewardInput`
 * 仅校验合法性，不做归一化。
 */
export interface SpecialRewardAwardInput {
  /** 每人积分数（正整数） */
  points: number;
  /** 奖励标签名（用户原文，1~30 字符，不含禁止符号） */
  rewardTagName: string;
  /** 获奖用户 ID 列表（非空字符串数组） */
  userIds: string[];
  /** 发放日期，格式 `YYYY-MM-DD` */
  awardDate: string;
  /** 操作发放的 SuperAdmin userId */
  distributorId: string;
  /** 操作发放的 SuperAdmin 昵称 */
  distributorNickname: string;
}

/**
 * 特殊奖励积分发放结果。
 *
 * 成功：返回 distributionId、successCount、totalPoints、rewardTagId、rewardTagName（归一化）
 * 失败：在 error 中携带 code/message；DUPLICATE_REWARD_TAG_DISTRIBUTION 时附加 duplicateUserIds
 */
export interface SpecialRewardAwardResult {
  success: boolean;
  distributionId?: string;
  successCount?: number;
  totalPoints?: number;
  rewardTagId?: string;
  /** 归一化后的 rewardTagName（落库值） */
  rewardTagName?: string;
  error?: {
    code: string;
    message: string;
    /** 仅 DUPLICATE_REWARD_TAG_DISTRIBUTION 时存在 */
    duplicateUserIds?: string[];
  };
}

// ============================================================
// 输入校验（task 4.1）
// ============================================================

/** awardDate 必须是 `YYYY-MM-DD` 形态（不校验真实日期，仅形态匹配，与 design.md 一致） */
const AWARD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** 校验结果：合法返回 `{ valid: true }`，否则返回带 error 详情的 `{ valid: false, error }` */
export type SpecialRewardValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string } };

/**
 * 校验 `SpecialRewardAwardInput` 的字段合法性。
 *
 * 顺序：基础类型 → userIds 非空字符串数组 → points 正整数 → awardDate 形态 → rewardTagName 校验。
 * 校验顺序设计：先廉价的字段类型检查，最后一个最复杂的 rewardTagName。
 *
 * 依据：requirements 6.11 (userIds), 6.12 (points), 6.13 (date 形态),
 *      6.14 (rewardTagName 必填), 6.15 (长度 1~30), 6.16 (禁止字符), 6.17 (先校验后写入).
 */
export function validateSpecialRewardInput(
  input: unknown,
): SpecialRewardValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: '请求体无效' },
    };
  }

  const {
    points,
    rewardTagName,
    userIds,
    awardDate,
  } = input as Record<string, unknown>;

  // userIds：非空字符串数组（requirements 6.11）
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'userIds 必须为非空数组' },
    };
  }
  for (const id of userIds) {
    if (typeof id !== 'string' || id.length === 0) {
      return {
        valid: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'userIds 中每个元素必须为非空字符串',
        },
      };
    }
  }

  // points：正整数（requirements 6.12）
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 1) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'points 必须为正整数' },
    };
  }

  // awardDate：YYYY-MM-DD 形态（requirements 6.13；design.md "Backend API Contract"）
  if (typeof awardDate !== 'string' || !AWARD_DATE_REGEX.test(awardDate)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'awardDate 必须为 YYYY-MM-DD 格式',
      },
    };
  }

  // rewardTagName：必填 + 长度 + 字符白名单（requirements 6.14 / 6.15 / 6.16）
  // 委托 `validateRewardTagName`（来自 `./reward-tags`，内部复用 `@points-mall/shared`
  // 的 `validateAwardTagName`），保证前后端及与 AwardTag 规则语义一致、存储互相隔离。
  if (typeof rewardTagName !== 'string' || rewardTagName.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'rewardTagName 必填' },
    };
  }
  const tagValidation = validateRewardTagName(rewardTagName);
  if (!tagValidation.valid) {
    return {
      valid: false,
      error: {
        code: tagValidation.code ?? 'INVALID_REQUEST',
        message: tagValidation.message ?? '奖励标签校验失败',
      },
    };
  }

  return { valid: true };
}

// ============================================================
// 去重查询（task 4.1）
// ============================================================

/**
 * 查询某 `rewardTagName`（再加上 targetRole='SpecialReward'）下已经领取过特殊奖励积分
 * 的用户 ID 集合。去重粒度为 `(rewardTagName, userId)`（全局，不再关联活动）。
 *
 * 实现思路：
 *  - 复用 BatchDistributions 表的 `createdAt-index` GSI（partition key `pk='ALL'`）
 *  - 使用 FilterExpression 过滤 `rewardTagName / targetRole`
 *  - 对每条命中记录的 `recipientIds` 数组做 flatten 合并
 *
 * @param rewardTagName 归一化后的奖励 tag 名
 * @param dynamoClient DynamoDB 客户端（依赖注入便于测试）
 * @param batchDistributionsTable BatchDistributions 表名
 * @returns 已领取用户 ID 集合
 */
export async function getRewardedUserIdsByTag(
  rewardTagName: string,
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
): Promise<Set<string>> {
  const rewarded = new Set<string>();

  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: batchDistributionsTable,
        IndexName: 'createdAt-index',
        KeyConditionExpression: 'pk = :pk',
        FilterExpression:
          'rewardTagName = :tag AND targetRole = :role',
        ExpressionAttributeValues: {
          ':pk': 'ALL',
          ':tag': rewardTagName,
          ':role': 'SpecialReward',
        },
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      const recipientIds = item.recipientIds as string[] | undefined;
      if (Array.isArray(recipientIds)) {
        for (const id of recipientIds) {
          if (typeof id === 'string' && id.length > 0) {
            rewarded.add(id);
          }
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return rewarded;
}

// ============================================================
// 主流程编排：executeSpecialRewardDistribution（task 4.2 — 占位）
// ============================================================
//
// 与 `executeBatchDistribution` 及 `executeSpecialActivityDistribution` 严格隔离：
//   - 仅写入 Users.points / earnTotal / earnTotalSpecialReward 三个字段
//   - 绝不写入 earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer / earnTotalSpecialActivity
//   - DistributionRecord 不写 speakerType / skillClaims / awardTagId / awardTagName 字段
//   - PointsRecord targetRole 固定为 'SpecialReward'，并写 rewardTagId / rewardTagName
//
// 步骤（与 design.md 时序图一致，task 4.2 实现）：
//   1. 校验入参（validateSpecialRewardInput）
//   2. GetCommand Activities 表（确保关联活动存在）
//   3. upsertRewardTagUsage 在 RewardTags 表上原子 upsert（取得 tagId / 归一化 tagName）
//   4. getRewardedUserIdsByTag → 与 input.userIds 求交集 → 重复则返回 DUPLICATE_REWARD_TAG_DISTRIBUTION
//   5. 预检事务大小（userIds.length * 2 ≤ 100，否则 BATCH_TOO_LARGE）
//   6. 构造 TransactWriteCommand（每用户 Update + Put 两条）
//   7. 执行事务，失败 → INTERNAL_ERROR
//   8. PutCommand BatchDistributions 落库 DistributionRecord
//
// 设计依据：requirements.md 6.x / 7.x / 8.x / 9.x；design.md "发放流程时序图" 与 "字段写入矩阵"

/** 调用 `executeSpecialRewardDistribution` 时由 handler 注入的表名 */
export interface SpecialRewardAwardTables {
  usersTable: string;
  pointsRecordsTable: string;
  batchDistributionsTable: string;
  rewardTagsTable: string;
}

/**
 * 执行特殊奖励积分发放（独立路径，不复用 executeBatchDistribution / executeSpecialActivityDistribution）。
 *
 * 错误码（与 design.md "Backend API Contract" 一致）：
 *  - INVALID_REQUEST                  入参校验失败（来自 validateSpecialRewardInput）
 *  - ACTIVITY_NOT_FOUND               activityId 在 Activities 表中不存在
 *  - DUPLICATE_REWARD_TAG_DISTRIBUTION 同 (activityId, rewardTagName) 下已发放过的用户被再次包含
 *  - BATCH_TOO_LARGE                  事务操作数 > 100（即 userIds.length > 50）
 *  - INTERNAL_ERROR                   TransactWrite 或其他 DDB 调用失败
 *
 * 注意：RewardTag 的 usageCount upsert 在主事务**之前**完成（design.md "Error Handling §3"
 * 已说明此最终一致折衷）。若主事务失败，usageCount 多算 1，可由后台校对脚本修复。
 */
export async function executeSpecialRewardDistribution(
  input: SpecialRewardAwardInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: SpecialRewardAwardTables,
): Promise<SpecialRewardAwardResult> {
  // ── Step 1: 入参校验（在任何写入之前，含 RewardTags upsert — Requirement 6.17） ──
  const validation = validateSpecialRewardInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // ── Step 2: RewardTag upsert（取得 tagId 与归一化 tagName） ───
  let upsertResult: { tagId: string; tagName: string };
  try {
    const upserted = await upsertRewardTagUsage(
      input.rewardTagName,
      input.distributorId,
      dynamoClient,
      tables.rewardTagsTable,
    );
    upsertResult = { tagId: upserted.tagId, tagName: upserted.tagName };
  } catch (err) {
    console.error('[SpecialRewardAward] RewardTag upsert failed:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '奖励标签更新失败' },
    };
  }
  const { tagId: rewardTagId, tagName: normalizedTagName } = upsertResult;

  // ── Step 3: 去重检查（去重粒度 (rewardTagName, userId)，全局，不关联活动） ──
  // 先去重 input.userIds（防止前端误传重复 ID 导致事务计算放大）
  const uniqueUserIds = [...new Set(input.userIds)];

  const rewardedSet = await getRewardedUserIdsByTag(
    normalizedTagName,
    dynamoClient,
    tables.batchDistributionsTable,
  );
  const duplicateUserIds = uniqueUserIds.filter((id) => rewardedSet.has(id));
  if (duplicateUserIds.length > 0) {
    return {
      success: false,
      error: {
        code: 'DUPLICATE_REWARD_TAG_DISTRIBUTION',
        message: '以下用户已在该奖励标签下获得过特殊奖励积分',
        duplicateUserIds,
      },
    };
  }

  // ── Step 4: 事务大小预检（DynamoDB TransactWrite 限制 100 ops） ──
  // 每用户 2 op（Users Update + PointsRecords Put），总 ops = userIds * 2
  if (uniqueUserIds.length * 2 > 100) {
    return {
      success: false,
      error: {
        code: 'BATCH_TOO_LARGE',
        message: '事务操作数超过 DynamoDB 上限 100',
      },
    };
  }

  // ── 拉取用户昵称 / 邮箱（仅用于 DistributionRecord.recipientDetails） ──
  // 与 executeSpecialActivityDistribution 一致，使用 BatchGetCommand 分块读取
  const userDetails: { userId: string; nickname: string; email: string }[] = [];
  const batchGetChunks = chunkArray(uniqueUserIds, 100);
  for (const chunk of batchGetChunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map((userId) => ({ userId })),
            ProjectionExpression: 'userId, nickname, email',
          },
        },
      }),
    );
    const items = result.Responses?.[tables.usersTable] ?? [];
    for (const item of items) {
      userDetails.push({
        userId: item.userId as string,
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
      });
    }
  }

  // ── Step 5: 构造 TransactWrite items ─────────────────────────
  const now = new Date().toISOString();
  const distributionId = ulid();
  const points = input.points; // 已在 validateSpecialRewardInput 中校验为正整数

  // PointsRecord.source 格式：'特殊奖励:{normalizedTagName}|{awardDate}'（不关联活动）
  const source = `特殊奖励:${normalizedTagName}|${input.awardDate}`;

  const transactItems: any[] = [];
  for (const userId of uniqueUserIds) {
    // a. Update Users — 仅写 points / earnTotal / earnTotalSpecialReward
    //    `if_not_exists(pk, :ALL)` 保证用户首次接收特殊奖励积分时进入排行榜 GSI 分区
    //    （design.md "数据模型 - Users 表" 注释）
    transactItems.push({
      Update: {
        TableName: tables.usersTable,
        Key: { userId },
        UpdateExpression:
          'SET points = if_not_exists(points, :zero) + :pv, ' +
          'earnTotal = if_not_exists(earnTotal, :zero) + :pv, ' +
          'earnTotalSpecialReward = if_not_exists(earnTotalSpecialReward, :zero) + :pv, ' +
          '#pk = if_not_exists(#pk, :ALL), ' +
          'updatedAt = :now',
        ExpressionAttributeNames: { '#pk': 'pk' },
        ExpressionAttributeValues: {
          ':pv': points,
          ':zero': 0,
          ':ALL': 'ALL',
          ':now': now,
        },
      },
    });

    // b. Put PointsRecords — targetRole='SpecialReward'，含 rewardTagId / rewardTagName
    transactItems.push({
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: {
          recordId: ulid(),
          userId,
          type: 'earn',
          amount: points,
          source,
          createdAt: now,
          targetRole: 'SpecialReward',
          rewardTagId,
          rewardTagName: normalizedTagName,
        },
      },
    });
  }

  // ── Step 7: 执行原子事务 ─────────────────────────────────────
  try {
    await dynamoClient.send(
      new TransactWriteCommand({ TransactItems: transactItems }),
    );
  } catch (err: any) {
    // 详细记录 CancellationReasons 便于运维诊断
    const reasons = err?.CancellationReasons;
    console.error(
      '[SpecialRewardAward] TransactWrite failed:',
      err?.name ?? err,
      reasons ? `Reasons=${JSON.stringify(reasons)}` : '',
    );
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '特殊奖励积分发放事务执行失败' },
    };
  }

  // ── Step 8: 写 DistributionRecord（事务外，最终一致即可） ────
  const successCount = uniqueUserIds.length;
  const totalPoints = points * successCount;

  // 注意：targetRole='SpecialReward'，**不**包含 speakerType / skillClaims 字段，
  // **也不**写 awardTagId / awardTagName（特殊活动专用，与本路径严格隔离，
  // design.md "字段写入矩阵"）。reason 字段保留 rewardTagDisplayName 作历史可读性。
  const distributionRecord: DistributionRecord & { pk: string } = {
    distributionId,
    pk: 'ALL', // GSI partition key for createdAt-index
    distributorId: input.distributorId,
    distributorNickname: input.distributorNickname,
    targetRole: 'SpecialReward',
    recipientIds: uniqueUserIds,
    recipientDetails: userDetails,
    points,
    reason: input.rewardTagName, // 保留用户原文作 reason，便于既有历史 UI 展示
    successCount,
    totalPoints,
    createdAt: now,
    // 特殊奖励不再关联活动：仅保留 activityType 供发放历史按类型筛选，
    // activityDate 记发放日期；不写 activityId / activityUG / activityTopic（历史"关联活动"列留空）
    activityType: '特殊奖励',
    activityDate: input.awardDate,
    rewardTagId,
    rewardTagName: normalizedTagName,
    rewardTagDisplayName: input.rewardTagName,
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
    rewardTagId,
    rewardTagName: normalizedTagName,
  };
}
