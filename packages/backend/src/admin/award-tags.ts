/**
 * AwardTag — 奖项标签元数据模块（special-activity-award 功能专用）
 *
 * 本文件提供 AwardTag 的 CRUD/IO 函数，供：
 *  - admin handler 路由（POST /api/admin/special-activity-award、/api/admin/award-tags 系列）
 *  - executeSpecialActivityDistribution 入参校验
 *  - 属性测试（PBT）
 *
 * 归一化与校验**纯函数**已迁移到 `packages/shared/src/award-tag.ts`，
 * 由前后端共享（设计文档要求前后端校验语义严格一致）。本文件以
 * `normalizeTagName`（向后兼容别名，指向 shared 的 `normalizeAwardTagName`）
 * 与 `validateAwardTagName` 重导出，保持既有调用点（含本文件下方 CRUD
 * 函数与 handler / PBT 等外部调用方）无需变更。
 *
 * 归一化与校验规则严格对齐 design.md / requirements.md：
 *  - normalizeAwardTagName: trim 前后空白 + 折叠中间连续空白为单个空格 + 转为小写
 *    （与 ContentTags 的 `normalizeTagName` 不同：后者不折叠空白；special-activity-award
 *     需要更强的归一化以避免“主讲奖” / “主讲  奖”等输入被识别为不同 tag）
 *  - validateAwardTagName: 归一化后长度 1~30；不含禁止符号 `<>"'/\|*?:&`；
 *    仅由中文、英文（大小写）、数字、空格组成。
 */

import {
  normalizeAwardTagName,
  validateAwardTagName,
} from '@points-mall/shared';
import type { AwardTagValidationResult } from '@points-mall/shared';

/**
 * 向后兼容别名：保留 `normalizeTagName` 导出名以支持本模块下方 CRUD 函数
 * 与已有调用点的引用，避免在迁移到 shared 之后大范围改动。
 */
export const normalizeTagName = normalizeAwardTagName;
export { normalizeAwardTagName, validateAwardTagName };
export type { AwardTagValidationResult };

// ============================================================
// CRUD 函数（task 3.3）
// ============================================================
//
// 这些函数操作 PointsMall-AwardTags 表（与 ContentTags 表完全隔离），
// 借鉴 packages/backend/src/content/tags.ts 的结构与 GSI 查询模式。
// 调用方负责传入 dynamoClient 与 awardTagsTable 名（依赖注入便于测试）。

import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AwardTag } from '@points-mall/shared';
import { ulid } from 'ulid';

/** AwardTags 表上 tagName 索引名（与 CDK 定义保持一致） */
const TAG_NAME_INDEX = 'tagName-index';

/** searchAwardTags 默认 / 上限 */
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;

/** getHotAwardTags 取前 N 条 */
const HOT_LIMIT = 10;

// ─── searchAwardTags（前缀模糊匹配，自动补全用） ──────────────

export interface SearchAwardTagsResult {
  success: boolean;
  tags: AwardTag[];
}

/**
 * 按归一化 prefix 在 `tagName-index` GSI 上 `begins_with` 模糊匹配，
 * 按 `usageCount` 降序返回前 N 条（默认 10、上限 50）。
 *
 * - 空字符串或归一化后长度为 0 的 prefix 直接返回 `[]`，避免全表扫描
 *   （需求 14.11、design.md 第 2 节 "GET /api/admin/award-tags"）。
 * - GSI partition key 是 `tagName` 本身，故使用 `KeyConditionExpression: begins_with(tagName, :p)`
 *   而非 FilterExpression，可直接利用索引高效查询。
 */
export async function searchAwardTags(
  prefix: string,
  limit: number,
  dynamoClient: DynamoDBDocumentClient,
  awardTagsTable: string,
): Promise<SearchAwardTagsResult> {
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
      TableName: awardTagsTable,
      IndexName: TAG_NAME_INDEX,
      KeyConditionExpression: 'begins_with(tagName, :p)',
      ExpressionAttributeValues: { ':p': normalized },
    }),
  );

  const tags = (result.Items ?? []) as AwardTag[];
  tags.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));

  return { success: true, tags: tags.slice(0, cappedLimit) };
}

// ─── getHotAwardTags（按 usageCount 降序返回前 10） ───────────

export interface GetHotAwardTagsResult {
  success: boolean;
  tags: AwardTag[];
}

/**
 * 返回 usageCount 降序的前 10 条 AwardTag。
 * AwardTags 表预期数据量较小（人工创建的奖项标签），Scan 即可。
 */
export async function getHotAwardTags(
  dynamoClient: DynamoDBDocumentClient,
  awardTagsTable: string,
): Promise<GetHotAwardTagsResult> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: awardTagsTable }),
  );

  const tags = (result.Items ?? []) as AwardTag[];
  tags.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));

  return { success: true, tags: tags.slice(0, HOT_LIMIT) };
}

// ─── createAwardTag（显式创建，POST /api/admin/award-tags） ───

export interface CreateAwardTagInput {
  /** 用户原文 displayName，落库时保留原始大小写与空白形态 */
  displayName: string;
  /** 创建者 userId */
  createdBy: string;
}

export interface CreateAwardTagResult {
  success: boolean;
  tag?: AwardTag;
  error?: { code: string; message: string };
}

/**
 * 显式创建 AwardTag。
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
export async function createAwardTag(
  input: CreateAwardTagInput,
  dynamoClient: DynamoDBDocumentClient,
  awardTagsTable: string,
): Promise<CreateAwardTagResult> {
  const { displayName, createdBy } = input;

  const validation = validateAwardTagName(displayName);
  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: validation.code ?? 'INVALID_REQUEST',
        message: validation.message ?? '奖项标签校验失败',
      },
    };
  }

  const tagName = normalizeTagName(displayName);

  // GSI 查重（最终一致读，与 ContentTags 同模式）
  const existing = await dynamoClient.send(
    new QueryCommand({
      TableName: awardTagsTable,
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
        message: '该奖项 Tag 已存在',
      },
    };
  }

  const now = new Date().toISOString();
  const tag: AwardTag = {
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
        TableName: awardTagsTable,
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
          message: '该奖项 Tag 已存在',
        },
      };
    }
    throw err;
  }

  return { success: true, tag };
}

// ─── deleteAwardTag（受限删除：仅 usageCount === 0） ───────────

export interface DeleteAwardTagResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * 删除 AwardTag。
 *
 * 仅当目标记录存在 **且** `usageCount === 0` 时才允许删除（需求 14.6 / 14.7）。
 * 使用 `DeleteCommand` + `ConditionExpression: attribute_exists(tagId) AND usageCount = :zero`
 * 原子保证检查与删除在单次 DDB 调用中完成。
 *
 * 失败码：
 *  - `TAG_NOT_FOUND` 记录不存在
 *  - `TAG_IN_USE` 记录存在但 usageCount > 0
 */
export async function deleteAwardTag(
  tagId: string,
  dynamoClient: DynamoDBDocumentClient,
  awardTagsTable: string,
): Promise<DeleteAwardTagResult> {
  try {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: awardTagsTable,
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
        TableName: awardTagsTable,
        Key: { tagId },
      }),
    );

    if (!probe.Item) {
      return {
        success: false,
        error: {
          code: 'TAG_NOT_FOUND',
          message: '该奖项 Tag 不存在',
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'TAG_IN_USE',
        message: '该奖项 Tag 已被使用，无法删除',
      },
    };
  }
}

// ─── upsertAwardTagUsage（special-activity-award 发放主流程使用） ───

export interface UpsertAwardTagUsageResult {
  tagId: string;
  tagName: string;
  displayName: string;
}

/**
 * 在特殊活动积分发放主事务**之前**调用：
 *  1. 在 `tagName-index` GSI 上按归一化 tagName 查重
 *  2. 已存在 → `UpdateCommand ADD usageCount :one SET updatedAt = :now`
 *  3. 不存在 → `PutCommand` 创建新记录（usageCount = 1）；
 *             `ConditionExpression: attribute_not_exists(tagId)` 防 ULID 碰撞
 *
 * 设计取舍（design.md "Error Handling §3"）：
 *  - 不放进主 TransactWrite：跨表条件检查会让事务复杂度激增。
 *  - 若主事务后续失败，usageCount 多算 1 —— 接受为最终一致折衷，
 *    可由后台校对脚本修复。
 *
 * @param displayName 用户原文（首次创建时落库为 displayName 字段）
 * @param createdBy 创建者 userId（仅在新建时写入）
 */
export async function upsertAwardTagUsage(
  displayName: string,
  createdBy: string,
  dynamoClient: DynamoDBDocumentClient,
  awardTagsTable: string,
): Promise<UpsertAwardTagUsageResult> {
  const tagName = normalizeTagName(displayName);
  const now = new Date().toISOString();

  // 查重（GSI 最终一致读）
  const existing = await dynamoClient.send(
    new QueryCommand({
      TableName: awardTagsTable,
      IndexName: TAG_NAME_INDEX,
      KeyConditionExpression: 'tagName = :t',
      ExpressionAttributeValues: { ':t': tagName },
      Limit: 1,
    }),
  );

  const found = existing.Items && existing.Items.length > 0 ? (existing.Items[0] as AwardTag) : null;

  if (found) {
    // 原子加 1（attribute_exists 防止并发被删后仍写入）
    await dynamoClient.send(
      new UpdateCommand({
        TableName: awardTagsTable,
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
  const newTag: AwardTag = {
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
        TableName: awardTagsTable,
        Item: newTag,
        ConditionExpression: 'attribute_not_exists(tagId)',
      }),
    );
  } catch (err: any) {
    // ULID 碰撞极罕见；若发生重试 upsert（最多一次）以避免无限循环
    if (err?.name === 'ConditionalCheckFailedException') {
      const retryTag: AwardTag = { ...newTag, tagId: ulid() };
      await dynamoClient.send(
        new PutCommand({
          TableName: awardTagsTable,
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
