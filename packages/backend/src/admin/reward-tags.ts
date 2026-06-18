/**
 * RewardTag — 奖励标签元数据模块（special-reward-award 功能专用）
 *
 * 本文件提供 RewardTag 的归一化 / 校验复用与（task 3.3）CRUD/IO 函数，供：
 *  - admin handler 路由（GET/POST /api/admin/reward-tags 系列、DELETE /{tagId}）
 *  - executeSpecialRewardDistribution 入参校验与 usageCount upsert
 *  - 属性测试（PBT）
 *
 * 归一化与校验**纯函数**复用 `@points-mall/shared`（`normalizeAwardTagName` /
 * `validateAwardTagName`）。设计文档明确：RewardTag 的名校验规则与 AwardTag
 * **完全一致**（trim + 折叠连续空白为单个空格 + toLowerCase；归一化后长度
 * 1~30；禁止符号 `<>"'/\|*?:&`；仅中文 / 英文 / 数字 / 空格），故直接复用同一
 * 套纯函数即可保证前后端校验语义严格一致（需求 14.9、14.10）。
 *
 * **存储隔离（关键架构约束）**：本模块只操作 `PointsMall-RewardTags` 表
 * （由调用方通过 `rewardTagsTable` 参数注入，handler 从环境变量
 * `REWARD_TAGS_TABLE` 读取并传入），**绝不**读取或写入 `PointsMall-AwardTags`
 * 或 `PointsMall-ContentTags`（需求 14.1、14.9、16.2）。这与 award-tags.ts
 * 操作 `PointsMall-AwardTags` 的方式镜像对称、但键空间与写入路径完全独立。
 */

import {
  normalizeAwardTagName,
  validateAwardTagName,
} from '@points-mall/shared';
import type { AwardTagValidationResult } from '@points-mall/shared';

/**
 * 向后兼容 / 一致性别名：保留 `normalizeTagName` 导出名，使本模块下方
 * （task 3.3）CRUD 函数与 handler / PBT 等调用方与 award-tags.ts 的引用模式
 * 保持一致。归一化规则与 AwardTag 完全相同。
 */
export const normalizeTagName = normalizeAwardTagName;
export { normalizeAwardTagName };
export type { AwardTagValidationResult };

/**
 * RewardTag 名校验包装器（语义清晰化）。
 *
 * 直接委托给共享的 `validateAwardTagName`——RewardTag 与 AwardTag 的名校验
 * 规则在设计上完全一致（需求 14.10）。提供独立命名的 `validateRewardTagName`
 * 是为了让 special-reward-award 的调用点（handler、executeSpecialRewardDistribution、
 * 前端 RewardTagPicker）语义自描述，而非直接引用 “award” 命名造成混淆。
 *
 * @param s 用户原始输入（未归一化）
 * @returns AwardTagValidationResult（`valid` / `code` / `message`）
 */
export function validateRewardTagName(s: string): AwardTagValidationResult {
  return validateAwardTagName(s);
}

// ============================================================
// CRUD 函数（task 3.3）
// ============================================================
//
// 以下常量为 task 3.3 的 RewardTag CRUD 函数（searchRewardTags /
// getHotRewardTags / createRewardTag / deleteRewardTag /
// upsertRewardTagUsage）预留。这些函数将操作 `PointsMall-RewardTags` 表
// （与 AwardTags / ContentTags 完全隔离），借鉴 award-tags.ts 的结构与
// GSI 查询模式，并由调用方注入 dynamoClient 与 rewardTagsTable 表名
// （依赖注入，便于测试）。

/** RewardTags 表上 tagName 索引名（与 CDK 定义保持一致） */
export const TAG_NAME_INDEX = 'tagName-index';

/** searchRewardTags 默认 / 上限（与 AwardTags 一致） */
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

/**
 * getHotRewardTags 取前 N 条。
 * 注意：RewardTags 为 **20**（需求 14.13），与 AwardTags 的 10 条不同。
 */
export const HOT_LIMIT = 20;

// ============================================================
// CRUD 实现（task 3.3）
// ============================================================
//
// 以下函数严格镜像 award-tags.ts 的结构与 DynamoDB 命令模式，但 **只操作**
// 调用方注入的 `rewardTagsTable`（PointsMall-RewardTags 表），与 AwardTags /
// ContentTags 完全隔离。依赖注入 dynamoClient 与表名以便测试。

import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { RewardTag } from '@points-mall/shared';
import { ulid } from 'ulid';

// ─── searchRewardTags（前缀模糊匹配，自动补全用） ──────────────

export interface SearchRewardTagsResult {
  success: boolean;
  tags: RewardTag[];
}

/**
 * 按归一化 prefix 在 `tagName-index` GSI 上 `begins_with` 模糊匹配，
 * 按 `usageCount` 降序返回前 N 条（默认 10、上限 50）。
 *
 * - 空字符串或归一化后长度为 0 的 prefix 直接返回 `[]`，避免全表扫描
 *   （需求 14.11）。
 * - limit 越界则就近收敛到边界：< 1 取 1（再按 cap 处理），> 50 取 50；
 *   非有限数 / NaN 回落默认 10。
 * - GSI partition key 是 `tagName` 本身，故使用
 *   `KeyConditionExpression: begins_with(tagName, :p)` 直接利用索引高效查询。
 */
export async function searchRewardTags(
  prefix: string,
  limit: number,
  dynamoClient: DynamoDBDocumentClient,
  rewardTagsTable: string,
): Promise<SearchRewardTagsResult> {
  const normalized = normalizeTagName(prefix ?? '');

  if (normalized.length < 1) {
    return { success: true, tags: [] };
  }

  const cappedLimit = Math.min(
    Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : SEARCH_DEFAULT_LIMIT),
    SEARCH_MAX_LIMIT,
  );

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: rewardTagsTable,
      IndexName: TAG_NAME_INDEX,
      KeyConditionExpression: 'begins_with(tagName, :p)',
      ExpressionAttributeValues: { ':p': normalized },
    }),
  );

  const tags = (result.Items ?? []) as RewardTag[];
  tags.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));

  return { success: true, tags: tags.slice(0, cappedLimit) };
}

// ─── getHotRewardTags（按 usageCount 降序返回前 20） ──────────

export interface GetHotRewardTagsResult {
  success: boolean;
  tags: RewardTag[];
}

/**
 * 返回 usageCount 降序的前 **20** 条 RewardTag（需求 14.13；注意此处为 20，
 * 与 AwardTags 的 10 条不同）。RewardTags 表预期数据量较小，Scan 即可。
 */
export async function getHotRewardTags(
  dynamoClient: DynamoDBDocumentClient,
  rewardTagsTable: string,
): Promise<GetHotRewardTagsResult> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: rewardTagsTable }),
  );

  const tags = (result.Items ?? []) as RewardTag[];
  tags.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));

  return { success: true, tags: tags.slice(0, HOT_LIMIT) };
}

// ─── createRewardTag（显式创建，POST /api/admin/reward-tags） ──

export interface CreateRewardTagInput {
  /** 用户原文 displayName，落库时保留原始大小写与空白形态（max 30） */
  displayName: string;
  /** 创建者 userId */
  createdBy: string;
}

export interface CreateRewardTagResult {
  success: boolean;
  tag?: RewardTag;
  error?: { code: string; message: string };
}

/**
 * 显式创建 RewardTag。
 *
 * 流程：
 *  1. 校验 displayName（含归一化后长度 / 字符白名单）
 *  2. 在 `tagName-index` GSI 上查重，已存在 → `TAG_ALREADY_EXISTS`
 *  3. 使用 `PutCommand` + `ConditionExpression: attribute_not_exists(tagId)`
 *     原子写入新记录（usageCount = 0，displayName 取原文）
 *
 * 失败码：
 *  - `INVALID_REQUEST` 校验失败
 *  - `TAG_ALREADY_EXISTS` 归一化后 tagName 重复（HTTP 409）
 */
export async function createRewardTag(
  input: CreateRewardTagInput,
  dynamoClient: DynamoDBDocumentClient,
  rewardTagsTable: string,
): Promise<CreateRewardTagResult> {
  const { displayName, createdBy } = input;

  const validation = validateRewardTagName(displayName);
  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: validation.code ?? 'INVALID_REQUEST',
        message: validation.message ?? '奖励标签校验失败',
      },
    };
  }

  const tagName = normalizeTagName(displayName);

  // GSI 查重（最终一致读）
  const existing = await dynamoClient.send(
    new QueryCommand({
      TableName: rewardTagsTable,
      IndexName: TAG_NAME_INDEX,
      KeyConditionExpression: 'tagName = :t',
      ExpressionAttributeValues: { ':t': tagName },
      Limit: 1,
    }),
  );

  if (existing.Items && existing.Items.length > 0) {
    return {
      success: false,
      error: {
        code: 'TAG_ALREADY_EXISTS',
        message: '该奖励 Tag 已存在',
      },
    };
  }

  const now = new Date().toISOString();
  const tag: RewardTag = {
    tagId: ulid(),
    tagName,
    displayName,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: rewardTagsTable,
        Item: tag,
        ConditionExpression: 'attribute_not_exists(tagId)',
      }),
    );
  } catch (err: any) {
    // 极小概率 ulid 碰撞或并发同名 PUT；按已存在处理
    if (err?.name === 'ConditionalCheckFailedException') {
      return {
        success: false,
        error: {
          code: 'TAG_ALREADY_EXISTS',
          message: '该奖励 Tag 已存在',
        },
      };
    }
    throw err;
  }

  return { success: true, tag };
}

// ─── deleteRewardTag（受限删除：仅 usageCount === 0） ──────────

export interface DeleteRewardTagResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * 删除 RewardTag。
 *
 * 仅当目标记录存在 **且** `usageCount === 0` 时才允许删除（需求 14.6 / 14.7）。
 * 使用 `DeleteCommand` + `ConditionExpression: attribute_exists(tagId) AND usageCount = :zero`
 * 原子保证检查与删除在单次 DDB 调用中完成。条件失败时再 GET 探测以区分
 * “不存在” 与 “在用”。
 *
 * 失败码：
 *  - `TAG_NOT_FOUND` 记录不存在
 *  - `TAG_IN_USE` 记录存在但 usageCount > 0
 */
export async function deleteRewardTag(
  tagId: string,
  dynamoClient: DynamoDBDocumentClient,
  rewardTagsTable: string,
): Promise<DeleteRewardTagResult> {
  try {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: rewardTagsTable,
        Key: { tagId },
        ConditionExpression: 'attribute_exists(tagId) AND usageCount = :zero',
        ExpressionAttributeValues: { ':zero': 0 },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return { success: true };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    // 条件失败 → 区分"不存在"与"在用"：再读一次确定原因
    const probe = await dynamoClient.send(
      new GetCommand({
        TableName: rewardTagsTable,
        Key: { tagId },
      }),
    );

    if (!probe.Item) {
      return {
        success: false,
        error: {
          code: 'TAG_NOT_FOUND',
          message: '该奖励 Tag 不存在',
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'TAG_IN_USE',
        message: '该奖励 Tag 已被使用，无法删除',
      },
    };
  }
}

// ─── upsertRewardTagUsage（special-reward-award 发放主流程使用） ───

export interface UpsertRewardTagUsageResult {
  tagId: string;
  tagName: string;
  displayName: string;
}

/**
 * 在特殊奖励积分发放主事务**之前**调用：
 *  1. 在 `tagName-index` GSI 上按归一化 tagName 查重
 *  2. 已存在 → `UpdateCommand ADD usageCount :one SET updatedAt = :now`
 *  3. 不存在 → `PutCommand` 创建新记录（usageCount = 1）；
 *             `ConditionExpression: attribute_not_exists(tagId)` 防 ULID 碰撞
 *
 * 设计取舍与 award-tags.ts 一致：不放进主 TransactWrite，若主事务后续失败
 * usageCount 多算 1，接受为最终一致折衷。
 *
 * @param displayName 用户原文（首次创建时落库为 displayName 字段）
 * @param createdBy 创建者 userId（仅在新建时写入）
 */
export async function upsertRewardTagUsage(
  displayName: string,
  createdBy: string,
  dynamoClient: DynamoDBDocumentClient,
  rewardTagsTable: string,
): Promise<UpsertRewardTagUsageResult> {
  const tagName = normalizeTagName(displayName);
  const now = new Date().toISOString();

  // 查重（GSI 最终一致读）
  const existing = await dynamoClient.send(
    new QueryCommand({
      TableName: rewardTagsTable,
      IndexName: TAG_NAME_INDEX,
      KeyConditionExpression: 'tagName = :t',
      ExpressionAttributeValues: { ':t': tagName },
      Limit: 1,
    }),
  );

  const found = existing.Items && existing.Items.length > 0 ? (existing.Items[0] as RewardTag) : null;

  if (found) {
    // 原子加 1（attribute_exists 防止并发被删后仍写入）
    await dynamoClient.send(
      new UpdateCommand({
        TableName: rewardTagsTable,
        Key: { tagId: found.tagId },
        UpdateExpression: 'ADD usageCount :one SET updatedAt = :now',
        ConditionExpression: 'attribute_exists(tagId)',
        ExpressionAttributeValues: {
          ':one': 1,
          ':now': now,
        },
      }),
    );

    return {
      tagId: found.tagId,
      tagName: found.tagName,
      displayName: found.displayName,
    };
  }

  // 新建（usageCount = 1）
  const newTag: RewardTag = {
    tagId: ulid(),
    tagName,
    displayName,
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: rewardTagsTable,
        Item: newTag,
        ConditionExpression: 'attribute_not_exists(tagId)',
      }),
    );
  } catch (err: any) {
    // ULID 碰撞极罕见；若发生重试一次以避免无限循环
    if (err?.name === 'ConditionalCheckFailedException') {
      const retryTag: RewardTag = { ...newTag, tagId: ulid() };
      await dynamoClient.send(
        new PutCommand({
          TableName: rewardTagsTable,
          Item: retryTag,
          ConditionExpression: 'attribute_not_exists(tagId)',
        }),
      );
      return {
        tagId: retryTag.tagId,
        tagName: retryTag.tagName,
        displayName: retryTag.displayName,
      };
    }
    throw err;
  }

  return {
    tagId: newTag.tagId,
    tagName: newTag.tagName,
    displayName: newTag.displayName,
  };
}
