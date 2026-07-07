/**
 * 员工活动参与度查询：DynamoDB 查询编排模块。
 *
 * 负责从 PointsRecords（type-createdAt-index，过滤 targetRole in ['Speaker','Volunteer']）
 * 与 BatchDistributions（createdAt-index）拉取全部历史记录，归一化为 SupportRecord[]，
 * 并通过 BatchGetCommand 从 Users 表批量获取 EmployeeDirectoryEntry、从 Activities 表批量
 * 获取 ActivityMeta，然后调用 aggregate.ts 中的纯函数完成计算。
 *
 * See design.md "6. DynamoDB 查询编排" for full interface definitions.
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SupportRecord,
  SupportRole,
  EmployeeDirectoryEntry,
  ActivityMeta,
  SupportCountRow,
  TotalCountRow,
  EmployeeActivityDetailRow,
  ActivityDetailRow,
  filterCurrentEmployeeRecords,
  aggregateSupportCount,
  aggregateTotalCount,
  aggregateEmployeeActivityDetail,
  aggregateActivityDetail,
  filterActivities,
  paginateActivities,
  filterByKeyword,
  validateKeyword,
  validateDateRange,
  filterRecordsByDateRange,
} from './aggregate';

// ============================================================
// Interfaces
// ============================================================

/** Speaker/志愿者支持次数视图与员工活动支持总计视图的筛选条件 */
export interface ViewFilter {
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

/** 活动支持记录明细视图的筛选条件 */
export interface ActivityViewFilter {
  activityId?: string;
  topicKeyword?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
}

/** 查询编排所需的 DynamoDB 客户端与表名上下文 */
export interface QueryContext {
  dynamoClient: DynamoDBDocumentClient;
  usersTable: string;
  pointsRecordsTable: string;
  batchDistributionsTable: string;
  activitiesTable: string;
}

/** 查询结果通用结构 */
export interface QueryResult<T> {
  success: boolean;
  rows?: T[];
  error?: { code: string; message: string };
}

const INTERNAL_ERROR = { code: 'INTERNAL_ERROR', message: 'Internal server error' };

// ============================================================
// Utility functions
// ============================================================

/** Split an array into chunks of the given size (BatchGet limit is 100 keys per table). */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================================
// DynamoDB query helpers — raw record retrieval
// ============================================================

/**
 * 查询 PointsRecords 表 type-createdAt-index GSI 中 type='earn' 且
 * targetRole in ['Speaker','Volunteer'] 的全部历史记录（不设时间下限）。
 * 内部处理 DynamoDB 分页，返回全部匹配的原始 item。
 */
async function queryAllPointsSupportRecords(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'type-createdAt-index',
        KeyConditionExpression: '#type = :type',
        FilterExpression: 'targetRole = :speaker OR targetRole = :volunteer',
        ExpressionAttributeNames: { '#type': 'type' },
        ExpressionAttributeValues: {
          ':type': 'earn',
          ':speaker': 'Speaker',
          ':volunteer': 'Volunteer',
        },
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
}

/**
 * 查询 BatchDistributions 表 createdAt-index GSI（分区键固定为 'ALL'）中
 * targetRole in ['Speaker','Volunteer'] 的全部历史记录（不设时间下限）。
 * 内部处理 DynamoDB 分页，返回全部匹配的原始 item。
 */
async function queryAllBatchDistributionSupportRecords(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'createdAt-index',
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'targetRole = :speaker OR targetRole = :volunteer',
        ExpressionAttributeValues: {
          ':pk': 'ALL',
          ':speaker': 'Speaker',
          ':volunteer': 'Volunteer',
        },
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
}

/**
 * "批量发放"来源前缀 —— 与 `reports/insight-query.ts` 中活跃员工报表
 * `aggregateEmployeeEngagement` 使用的 `record.source?.startsWith('批量发放')`
 * 判定条件保持一致，确保两处"活动支持/参与活动数"的统计口径统一。
 * 排除内容预约审批奖励（`预约审批:`/`预约审批通过:`）、积分申请审批（`积分申请审批:`）、
 * 特殊活动/奖励、季度贡献奖、技能认领等其他来源的 earn 记录——这些即使
 * targetRole 恰好为 Speaker/Volunteer，语义上也不是"参与/支持了某场活动"。
 */
const BATCH_DISTRIBUTION_SOURCE_PREFIX = '批量发放';

/** 判断 source 是否为批量发放来源的记录（真正代表活动支持） */
function isBatchDistributionSource(source: string): boolean {
  return source.startsWith(BATCH_DISTRIBUTION_SOURCE_PREFIX);
}

/**
 * 将 PointsRecords 原始 item 归一化为 SupportRecord[]，缺失 userId/activityId 的记录被跳过。
 * 仅保留 source 以"批量发放"开头的记录（与活跃员工报表口径一致），其他来源
 * （预约审批奖励、积分申请审批、特殊活动/奖励、季度贡献奖、技能认领等）不代表活动支持，会被排除。
 */
function normalizePointsRecords(items: Record<string, unknown>[]): SupportRecord[] {
  const records: SupportRecord[] = [];
  for (const item of items) {
    const userId = (item.userId as string) ?? '';
    const activityId = (item.activityId as string) ?? '';
    const targetRole = item.targetRole as SupportRole | undefined;
    const source = (item.source as string) ?? '';
    if (!userId || !activityId || (targetRole !== 'Speaker' && targetRole !== 'Volunteer')) continue;
    if (!isBatchDistributionSource(source)) continue;
    records.push({ userId, activityId, targetRole });
  }
  return records;
}

/**
 * 将 BatchDistributions 原始 item 归一化为 SupportRecord[]：每个 recipientId
 * 展开为一条独立的 SupportRecord（Requirement 6.2, 7.2 的"来自 BatchDistributions"部分）。
 */
function normalizeBatchDistributionRecords(items: Record<string, unknown>[]): SupportRecord[] {
  const records: SupportRecord[] = [];
  for (const item of items) {
    const activityId = (item.activityId as string) ?? '';
    const targetRole = item.targetRole as SupportRole | undefined;
    const recipientIds = (item.recipientIds as string[]) ?? [];
    if (!activityId || (targetRole !== 'Speaker' && targetRole !== 'Volunteer')) continue;
    for (const userId of recipientIds) {
      if (!userId) continue;
      records.push({ userId, activityId, targetRole });
    }
  }
  return records;
}

/**
 * 从 PointsRecords 与 BatchDistributions 拉取全部历史 Speaker/Volunteer 支持记录，
 * 归一化并合并为统一的 SupportRecord[]。Requirement 6.1, 7.1, 12.3。
 */
async function fetchAllSupportRecords(ctx: QueryContext): Promise<SupportRecord[]> {
  const [pointsItems, distributionItems] = await Promise.all([
    queryAllPointsSupportRecords(ctx.dynamoClient, ctx.pointsRecordsTable),
    queryAllBatchDistributionSupportRecords(ctx.dynamoClient, ctx.batchDistributionsTable),
  ]);

  return [
    ...normalizePointsRecords(pointsItems),
    ...normalizeBatchDistributionRecords(distributionItems),
  ];
}

// ============================================================
// DynamoDB query helpers — BatchGet directory / activity metadata
// ============================================================

/**
 * 通过 BatchGetCommand 从 Users 表批量获取 EmployeeDirectoryEntry（userId → 当前
 * 花名/邮箱/isEmployee），按 100 条分块请求。
 */
async function batchGetEmployeeDirectory(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
  userIds: string[],
): Promise<Map<string, EmployeeDirectoryEntry>> {
  const directory = new Map<string, EmployeeDirectoryEntry>();
  if (userIds.length === 0) return directory;

  const chunks = chunkArray(userIds, 100);
  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname, email, isEmployee',
          },
        },
      }),
    );

    const items = result.Responses?.[usersTable] ?? [];
    for (const item of items) {
      directory.set(item.userId as string, {
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
        isEmployee: (item.isEmployee as boolean) ?? false,
      });
    }
  }

  return directory;
}

/**
 * 通过 BatchGetCommand 从 Activities 表批量获取 ActivityMeta（activityId → 主题/UG/日期），
 * 按 100 条分块请求。
 */
async function batchGetActivityMeta(
  dynamoClient: DynamoDBDocumentClient,
  activitiesTable: string,
  activityIds: string[],
): Promise<Map<string, ActivityMeta>> {
  const activityMeta = new Map<string, ActivityMeta>();
  if (activityIds.length === 0) return activityMeta;

  const chunks = chunkArray(activityIds, 100);
  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [activitiesTable]: {
            Keys: chunk.map(activityId => ({ activityId })),
            ProjectionExpression: 'activityId, topic, ugName, activityDate',
          },
        },
      }),
    );

    const items = result.Responses?.[activitiesTable] ?? [];
    for (const item of items) {
      activityMeta.set(item.activityId as string, {
        topic: (item.topic as string) ?? '',
        ugName: (item.ugName as string) ?? '',
        activityDate: (item.activityDate as string) ?? '',
      });
    }
  }

  return activityMeta;
}

/** 拉取原始支持记录并关联 Users/Activities 表数据，供四个视图查询函数复用 */
async function fetchQueryData(ctx: QueryContext): Promise<{
  records: SupportRecord[];
  directory: Map<string, EmployeeDirectoryEntry>;
  activityMeta: Map<string, ActivityMeta>;
}> {
  const records = await fetchAllSupportRecords(ctx);

  const userIds = [...new Set(records.map(r => r.userId))];
  const activityIds = [...new Set(records.map(r => r.activityId))];

  const [directory, activityMeta] = await Promise.all([
    batchGetEmployeeDirectory(ctx.dynamoClient, ctx.usersTable, userIds),
    batchGetActivityMeta(ctx.dynamoClient, ctx.activitiesTable, activityIds),
  ]);

  return { records, directory, activityMeta };
}

// ============================================================
// Query functions
// ============================================================

/**
 * 通用角色支持次数查询管道：取数 → 关联 → filterCurrentEmployeeRecords →
 * 日期范围过滤 → aggregateSupportCount → 关键字过滤。
 */
async function queryRoleSupport(
  role: SupportRole,
  filter: ViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<SupportCountRow>> {
  const keywordValidation = validateKeyword(filter.keyword);
  if (!keywordValidation.valid) {
    return { success: false, error: keywordValidation.error };
  }

  const dateValidation = validateDateRange(filter.startDate, filter.endDate);
  if (!dateValidation.valid) {
    return { success: false, error: dateValidation.error };
  }

  try {
    const { records, directory, activityMeta } = await fetchQueryData(ctx);
    const employeeRecords = filterCurrentEmployeeRecords(records, directory);
    const dateFilteredRecords = filterRecordsByDateRange(
      employeeRecords,
      activityMeta,
      filter.startDate,
      filter.endDate,
    );
    const aggregated = aggregateSupportCount(dateFilteredRecords, role, directory);
    const rows = filterByKeyword(aggregated, filter.keyword);

    return { success: true, rows };
  } catch (err) {
    console.error(`query${role}Support error:`, err);
    return { success: false, error: INTERNAL_ERROR };
  }
}

/**
 * Speaker 支持次数视图查询。Requirements: 6.1, 10.1, 11.1, 12.1, 12.2, 12.3。
 */
export async function querySpeakerSupport(
  filter: ViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<SupportCountRow>> {
  return queryRoleSupport('Speaker', filter, ctx);
}

/**
 * 志愿者支持次数视图查询。Requirements: 7.1, 10.1, 11.1, 12.1, 12.2, 12.3。
 */
export async function queryVolunteerSupport(
  filter: ViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<SupportCountRow>> {
  return queryRoleSupport('Volunteer', filter, ctx);
}

/**
 * 员工总次数视图查询：取数 → 关联 → filterCurrentEmployeeRecords →
 * 日期范围过滤 → aggregateTotalCount（Speaker 与志愿者按 activityId 去重合并）→ 关键字过滤。
 */
export async function queryTotalCount(
  filter: ViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<TotalCountRow>> {
  const keywordValidation = validateKeyword(filter.keyword);
  if (!keywordValidation.valid) {
    return { success: false, error: keywordValidation.error };
  }

  const dateValidation = validateDateRange(filter.startDate, filter.endDate);
  if (!dateValidation.valid) {
    return { success: false, error: dateValidation.error };
  }

  try {
    const { records, directory, activityMeta } = await fetchQueryData(ctx);
    const employeeRecords = filterCurrentEmployeeRecords(records, directory);
    const dateFilteredRecords = filterRecordsByDateRange(
      employeeRecords,
      activityMeta,
      filter.startDate,
      filter.endDate,
    );
    const aggregated = aggregateTotalCount(dateFilteredRecords, directory);
    const rows = filterByKeyword(aggregated, filter.keyword);

    return { success: true, rows };
  } catch (err) {
    console.error('queryTotalCount error:', err);
    return { success: false, error: INTERNAL_ERROR };
  }
}

/**
 * 员工支持活动明细视图查询：取数 → 关联 → filterCurrentEmployeeRecords →
 * 日期范围过滤 → aggregateEmployeeActivityDetail → 关键字过滤。
 * Requirements: 8.1, 10.1, 11.1, 12.1, 12.2, 12.3。
 */
export async function queryEmployeeActivityDetail(
  filter: ViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<EmployeeActivityDetailRow>> {
  const keywordValidation = validateKeyword(filter.keyword);
  if (!keywordValidation.valid) {
    return { success: false, error: keywordValidation.error };
  }

  const dateValidation = validateDateRange(filter.startDate, filter.endDate);
  if (!dateValidation.valid) {
    return { success: false, error: dateValidation.error };
  }

  try {
    const { records, directory, activityMeta } = await fetchQueryData(ctx);
    const employeeRecords = filterCurrentEmployeeRecords(records, directory);
    const dateFilteredRecords = filterRecordsByDateRange(
      employeeRecords,
      activityMeta,
      filter.startDate,
      filter.endDate,
    );
    const aggregated = aggregateEmployeeActivityDetail(dateFilteredRecords, directory, activityMeta);
    const rows = filterByKeyword(aggregated, filter.keyword);

    return { success: true, rows };
  } catch (err) {
    console.error('queryEmployeeActivityDetail error:', err);
    return { success: false, error: INTERNAL_ERROR };
  }
}

/**
 * 活动支持记录明细视图查询管道（取数 → 关联 → filterCurrentEmployeeRecords →
 * 日期范围过滤 → aggregateActivityDetail → filterActivities），但不分页，返回
 * 全部匹配的活动。供 `queryActivityDetail`（分页展示）与导出模块（全量导出）共用。
 * Requirements: 9.1, 11.1, 12.1, 12.2, 12.3, 13.1, 13.3。
 */
export async function queryActivityDetailAll(
  filter: ActivityViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<ActivityDetailRow>> {
  const dateValidation = validateDateRange(filter.startDate, filter.endDate);
  if (!dateValidation.valid) {
    return { success: false, error: dateValidation.error };
  }

  try {
    const { records, directory, activityMeta } = await fetchQueryData(ctx);
    const employeeRecords = filterCurrentEmployeeRecords(records, directory);
    const dateFilteredRecords = filterRecordsByDateRange(
      employeeRecords,
      activityMeta,
      filter.startDate,
      filter.endDate,
    );
    const activities = aggregateActivityDetail(dateFilteredRecords, directory, activityMeta);
    const filteredActivities = filterActivities(activities, {
      activityId: filter.activityId,
      topicKeyword: filter.topicKeyword,
      startDate: filter.startDate,
      endDate: filter.endDate,
    });

    return { success: true, rows: filteredActivities };
  } catch (err) {
    console.error('queryActivityDetailAll error:', err);
    return { success: false, error: INTERNAL_ERROR };
  }
}

/**
 * 活动支持记录明细视图查询：复用 `queryActivityDetailAll` 的取数/聚合/过滤管道后分页。
 * Requirements: 9.1, 9.7, 11.1, 12.1, 12.2, 12.3。
 */
export async function queryActivityDetail(
  filter: ActivityViewFilter,
  ctx: QueryContext,
): Promise<QueryResult<ActivityDetailRow> & { page: number; totalPages: number; total: number }> {
  const page = filter.page ?? 1;
  const result = await queryActivityDetailAll(filter, ctx);

  if (!result.success || !result.rows) {
    return { success: false, error: result.error, page, totalPages: 0, total: 0 };
  }

  const paginated = paginateActivities(result.rows, page);

  return {
    success: true,
    rows: paginated.items,
    page: paginated.page,
    totalPages: paginated.totalPages,
    total: paginated.total,
  };
}
