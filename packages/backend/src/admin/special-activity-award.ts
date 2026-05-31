/**
 * 特殊活动积分颁发 — 独立发放路径
 *
 * 与 `executeBatchDistribution`（身份分批量发放）严格隔离，仅写入：
 *   - Users.points
 *   - Users.earnTotal
 *   - Users.earnTotalSpecialActivity
 *
 * **不**写入 `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer` 任何身份分字段。
 *
 * 本文件分两部分：
 *   1. 输入类型 / 校验 / 去重查询（task 4.1，本提交）
 *   2. `executeSpecialActivityDistribution` 主流程编排（task 4.2，后续提交）
 *
 * 设计依据：
 *   - `.kiro/specs/special-activity-award/design.md`
 *   - `.kiro/specs/special-activity-award/requirements.md`（6.11 ~ 6.16, 8.1）
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  PutCommand,
  GetCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { ActivityRecord, DistributionRecord } from '@points-mall/shared';
import { validateAwardTagName } from '@points-mall/shared';
import { upsertAwardTagUsage } from './award-tags';
import { chunkArray } from './batch-points';

// ============================================================
// 接口定义
// ============================================================

/**
 * 特殊活动积分发放请求输入。
 *
 * 注：`awardTagName` 为用户原文（未归一化），由 `executeSpecialActivityDistribution`
 * 在落库前调用 `normalizeAwardTagName` 进行归一化。`validateSpecialActivityInput`
 * 仅校验合法性，不做归一化。
 */
export interface SpecialActivityAwardInput {
  /** 关联活动 ID（必须存在于 PointsMall-Activities 表） */
  activityId: string;
  /** 每人积分数（正整数） */
  points: number;
  /** 奖项标签名（用户原文，1~30 字符，不含禁止符号） */
  awardTagName: string;
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
 * 特殊活动积分发放结果。
 *
 * 成功：返回 distributionId、successCount、totalPoints、awardTagId、awardTagName（归一化）
 * 失败：在 error 中携带 code/message；DUPLICATE_AWARD_TAG_DISTRIBUTION 时附加 duplicateUserIds
 */
export interface SpecialActivityAwardResult {
  success: boolean;
  distributionId?: string;
  successCount?: number;
  totalPoints?: number;
  awardTagId?: string;
  /** 归一化后的 awardTagName（落库值） */
  awardTagName?: string;
  error?: {
    code: string;
    message: string;
    /** 仅 DUPLICATE_AWARD_TAG_DISTRIBUTION 时存在 */
    duplicateUserIds?: string[];
  };
}

// ============================================================
// 输入校验（task 4.1）
// ============================================================

/** awardDate 必须是 `YYYY-MM-DD` 形态（不校验真实日期，仅形态匹配，与 design.md 一致） */
const AWARD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** 校验结果：合法返回 `{ valid: true }`，否则返回带 error 详情的 `{ valid: false, error }` */
export type SpecialActivityValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string } };

/**
 * 校验 `SpecialActivityAwardInput` 的字段合法性。
 *
 * 顺序：基础类型 → userIds 非空字符串数组 → points 正整数 → awardDate 形态 → awardTagName 校验。
 * 校验顺序设计：先廉价的字段类型检查，最后一个最复杂的 awardTagName。
 *
 * 依据：requirements 6.11 (userIds), 6.12 (points), 6.13 (date 形态),
 *      6.14 (awardTagName 必填), 6.15 (长度 1~30), 6.16 (禁止字符).
 */
export function validateSpecialActivityInput(
  input: unknown,
): SpecialActivityValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: '请求体无效' },
    };
  }

  const {
    activityId,
    points,
    awardTagName,
    userIds,
    awardDate,
  } = input as Record<string, unknown>;

  // activityId 非空字符串（去重 / 落库 / 关联活动检查的关键键）
  if (typeof activityId !== 'string' || activityId.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'activityId 为必填字段' },
    };
  }

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

  // awardTagName：必填 + 长度 + 字符白名单（requirements 6.14 / 6.15 / 6.16）
  // 委托共享 `validateAwardTagName`（来自 `@points-mall/shared`），保证前后端语义一致。
  if (typeof awardTagName !== 'string' || awardTagName.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'awardTagName 必填' },
    };
  }
  const tagValidation = validateAwardTagName(awardTagName);
  if (!tagValidation.valid) {
    return {
      valid: false,
      error: {
        code: tagValidation.code ?? 'INVALID_REQUEST',
        message: tagValidation.message ?? '奖项标签校验失败',
      },
    };
  }

  return { valid: true };
}

// ============================================================
// 去重查询（task 4.1）
// ============================================================

/**
 * 查询某 `(activityId, awardTagName)` 三元组（再加上 targetRole='SpecialActivity'）
 * 下已经领取过特殊活动积分的用户 ID 集合。
 *
 * 实现思路：
 *  - 复用 BatchDistributions 表的 `createdAt-index` GSI（partition key `pk='ALL'`）
 *  - 使用 FilterExpression 过滤 `activityId / awardTagName / targetRole`
 *  - 对每条命中记录的 `recipientIds` 数组做 flatten 合并
 *
 * 返回 Set<string> 便于调用方在主流程中做 O(1) 交集判定（design.md 时序图步骤 9~10）。
 *
 * 注意：
 *  - GSI 是最终一致读，存在 <1s 窗口可能漏判（design.md "Error Handling §5"），对人工
 *    SuperAdmin 操作可接受。
 *  - awardTagName 调用方传入**归一化后**的 tag 名（与 PointsRecord/DistributionRecord
 *    中 `awardTagName` 字段值的归一化形态保持一致）。
 *
 * @param activityId 关联活动 ID
 * @param awardTagName 归一化后的奖项 tag 名
 * @param dynamoClient DynamoDB 客户端（依赖注入便于测试）
 * @param batchDistributionsTable BatchDistributions 表名
 * @returns 已领取用户 ID 集合
 */
export async function getAwardedUserIdsByTag(
  activityId: string,
  awardTagName: string,
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
): Promise<Set<string>> {
  const awarded = new Set<string>();

  // 由于 BatchDistributions 表上没有 (activityId, awardTagName) 联合 GSI，借用现有
  // `createdAt-index` GSI（pk='ALL'）拉取后用 FilterExpression 过滤。SuperAdmin
  // 操作的频次低，命中数量小，性能可接受。
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: batchDistributionsTable,
        IndexName: 'createdAt-index',
        KeyConditionExpression: 'pk = :pk',
        FilterExpression:
          'activityId = :aid AND awardTagName = :tag AND targetRole = :role',
        ExpressionAttributeValues: {
          ':pk': 'ALL',
          ':aid': activityId,
          ':tag': awardTagName,
          ':role': 'SpecialActivity',
        },
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      const recipientIds = item.recipientIds as string[] | undefined;
      if (Array.isArray(recipientIds)) {
        for (const id of recipientIds) {
          if (typeof id === 'string' && id.length > 0) {
            awarded.add(id);
          }
        }
      }
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return awarded;
}

// ============================================================
// 主流程编排：executeSpecialActivityDistribution（task 4.2）
// ============================================================
//
// 与 `executeBatchDistribution` 严格隔离：
//   - 仅写入 Users.points / earnTotal / earnTotalSpecialActivity 三个字段
//   - 绝不写入 earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer
//   - DistributionRecord 不写 speakerType / skillClaims 字段
//   - PointsRecord targetRole 固定为 'SpecialActivity'
//
// 步骤（与 design.md 时序图一致）：
//   1. 校验入参
//   2. GetCommand Activities 表（确保关联活动存在）
//   3. upsertAwardTagUsage 在 AwardTags 表上原子 upsert（取得 tagId / 归一化 tagName）
//   4. getAwardedUserIdsByTag → 与 input.userIds 求交集 → 重复则返回 DUPLICATE_AWARD_TAG_DISTRIBUTION
//   5. 预检事务大小（userIds.length * 2 ≤ 100）
//   6. 构造 TransactWriteCommand（每用户 Update + Put 两条）
//   7. 执行事务，失败 → INTERNAL_ERROR
//   8. PutCommand BatchDistributions 落库 DistributionRecord
//
// 设计依据：requirements.md 6.x / 7.x / 8.x / 9.x；design.md "发放流程时序图" 与 "字段写入矩阵"

/** 调用 `executeSpecialActivityDistribution` 时由 handler 注入的表名 */
export interface SpecialActivityAwardTables {
  usersTable: string;
  pointsRecordsTable: string;
  batchDistributionsTable: string;
  activitiesTable: string;
  awardTagsTable: string;
}

/**
 * 执行特殊活动积分发放（独立路径，不复用 executeBatchDistribution）。
 *
 * 错误码（与 design.md "Backend API Contract" 一致）：
 *  - INVALID_REQUEST                 入参校验失败（来自 validateSpecialActivityInput）
 *  - ACTIVITY_NOT_FOUND              activityId 在 Activities 表中不存在
 *  - DUPLICATE_AWARD_TAG_DISTRIBUTION 同 (activityId, awardTagName) 下已发放过的用户被再次包含
 *  - BATCH_TOO_LARGE                 事务操作数 > 100（即 userIds.length > 50）
 *  - INTERNAL_ERROR                  TransactWrite 或其他 DDB 调用失败
 *
 * 注意：AwardTag 的 usageCount upsert 在主事务**之前**完成（design.md "Error Handling §3"
 * 已说明此最终一致折衷）。若主事务失败，usageCount 多算 1，可由后台校对脚本修复。
 */
export async function executeSpecialActivityDistribution(
  input: SpecialActivityAwardInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: SpecialActivityAwardTables,
): Promise<SpecialActivityAwardResult> {
  // ── Step 1: 入参校验 ─────────────────────────────────────────
  const validation = validateSpecialActivityInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // ── Step 2: 校验关联活动存在 ─────────────────────────────────
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
  const activity = activityResult.Item as ActivityRecord;

  // ── Step 3: AwardTag upsert（取得 tagId 与归一化 tagName） ────
  let upsertResult: { tagId: string; tagName: string };
  try {
    const upserted = await upsertAwardTagUsage(
      input.awardTagName,
      input.distributorId,
      dynamoClient,
      tables.awardTagsTable,
    );
    upsertResult = { tagId: upserted.tagId, tagName: upserted.tagName };
  } catch (err) {
    console.error('[SpecialActivityAward] AwardTag upsert failed:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '奖项标签更新失败' },
    };
  }
  const { tagId: awardTagId, tagName: normalizedTagName } = upsertResult;

  // ── Step 4: 去重检查（基于 (activityId, awardTagName) 三元组） ──
  // 先去重 input.userIds（防止前端误传重复 ID 导致事务计算放大）
  const uniqueUserIds = [...new Set(input.userIds)];

  const awardedSet = await getAwardedUserIdsByTag(
    input.activityId,
    normalizedTagName,
    dynamoClient,
    tables.batchDistributionsTable,
  );
  const duplicateUserIds = uniqueUserIds.filter((id) => awardedSet.has(id));
  if (duplicateUserIds.length > 0) {
    return {
      success: false,
      error: {
        code: 'DUPLICATE_AWARD_TAG_DISTRIBUTION',
        message: '以下用户已在此活动的该奖项标签下获得过特殊活动积分',
        duplicateUserIds,
      },
    };
  }

  // ── Step 5: 事务大小预检（DynamoDB TransactWrite 限制 100 ops） ──
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
  // 与 executeBatchDistribution 一致，使用 BatchGetCommand 分块读取
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

  // ── Step 6: 构造 TransactWrite items ─────────────────────────
  const now = new Date().toISOString();
  const distributionId = ulid();
  const points = input.points; // 已在 validateSpecialActivityInput 中校验为正整数

  // PointsRecord.source 格式：'特殊活动:{topic}|{ug}|{awardDate}|{normalizedTagName}'
  // （requirements 6.4，design.md "Property 6"）
  const sourcePrefix = '特殊活动:';
  const sourceSuffix = `${activity.topic}|${activity.ugName}|${input.awardDate}|${normalizedTagName}`;
  const source = `${sourcePrefix}${sourceSuffix}`;

  const transactItems: any[] = [];
  for (const userId of uniqueUserIds) {
    // a. Update Users — 仅写 points / earnTotal / earnTotalSpecialActivity
    //    `if_not_exists(pk, :ALL)` 保证用户首次接收特殊活动积分时进入排行榜 GSI 分区
    //    （design.md "数据模型 - Users 表" 注释）
    transactItems.push({
      Update: {
        TableName: tables.usersTable,
        Key: { userId },
        UpdateExpression:
          'SET points = if_not_exists(points, :zero) + :pv, ' +
          'earnTotal = if_not_exists(earnTotal, :zero) + :pv, ' +
          'earnTotalSpecialActivity = if_not_exists(earnTotalSpecialActivity, :zero) + :pv, ' +
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

    // b. Put PointsRecords — targetRole='SpecialActivity'，含 awardTagId / awardTagName
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
          activityId: input.activityId,
          targetRole: 'SpecialActivity',
          awardTagId,
          awardTagName: normalizedTagName,
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
      '[SpecialActivityAward] TransactWrite failed:',
      err?.name ?? err,
      reasons ? `Reasons=${JSON.stringify(reasons)}` : '',
    );
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '特殊活动积分发放事务执行失败' },
    };
  }

  // ── Step 8: 写 DistributionRecord（事务外，最终一致即可） ────
  const successCount = uniqueUserIds.length;
  const totalPoints = points * successCount;

  // 注意：targetRole='SpecialActivity'，**不**包含 speakerType / skillClaims 字段
  // （design.md "字段写入矩阵"）。reason 字段保留 awardTagDisplayName 作历史可读性。
  const distributionRecord: DistributionRecord & { pk: string } = {
    distributionId,
    pk: 'ALL', // GSI partition key for createdAt-index
    distributorId: input.distributorId,
    distributorNickname: input.distributorNickname,
    targetRole: 'SpecialActivity',
    recipientIds: uniqueUserIds,
    recipientDetails: userDetails,
    points,
    reason: input.awardTagName, // 保留用户原文作 reason，便于既有历史 UI 展示
    successCount,
    totalPoints,
    createdAt: now,
    activityId: input.activityId,
    activityType: '特殊活动',
    activityUG: activity.ugName,
    activityTopic: activity.topic,
    activityDate: input.awardDate,
    awardTagId,
    awardTagName: normalizedTagName,
    awardTagDisplayName: input.awardTagName,
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
    awardTagId,
    awardTagName: normalizedTagName,
  };
}
