// Insight report query module - handles DynamoDB queries and in-memory aggregation for insight report types
// See design.md for full interface definitions and query strategies

import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================
// 人气商品排行（Popular Products Ranking）
// ============================================================

/** 人气商品排行筛选条件 */
export interface PopularProductsFilter {
  startDate?: string;   // 按 Orders 的 createdAt 筛选
  endDate?: string;
  productType?: 'points' | 'code_exclusive' | 'all'; // 默认 all
}

/** 人气商品排行记录 */
export interface PopularProductRecord {
  productId: string;
  productName: string;
  productType: 'points' | 'code_exclusive';
  redemptionCount: number;
  totalPointsSpent: number;
  currentStock: number;
  stockConsumptionRate: number; // 百分比，保留一位小数
}

/** 人气商品排行查询结果 */
export interface PopularProductsResult {
  success: boolean;
  records?: PopularProductRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// 热门内容排行（Hot Content Ranking）
// ============================================================

/** 热门内容排行筛选条件 */
export interface HotContentFilter {
  categoryId?: string;
  startDate?: string;
  endDate?: string;
}

/** 热门内容排行记录 */
export interface HotContentRecord {
  contentId: string;
  title: string;
  uploaderNickname: string;
  categoryName: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  engagementScore: number; // likeCount + commentCount + reservationCount
}

/** 热门内容排行查询结果 */
export interface HotContentResult {
  success: boolean;
  records?: HotContentRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// 内容贡献者排行（Content Contributor Ranking）
// ============================================================

/** 内容贡献者排行筛选条件 */
export interface ContentContributorFilter {
  startDate?: string;
  endDate?: string;
}

/** 内容贡献者排行记录 */
export interface ContentContributorRecord {
  rank: number;
  userId: string;
  nickname: string;
  approvedCount: number;
  totalLikes: number;
  totalComments: number;
}

/** 内容贡献者排行查询结果 */
export interface ContentContributorResult {
  success: boolean;
  records?: ContentContributorRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// 库存预警（Inventory Alert）
// ============================================================

/** 库存预警筛选条件 */
export interface InventoryAlertFilter {
  stockThreshold?: number;  // 默认 5
  productType?: 'points' | 'code_exclusive' | 'all'; // 默认 all
  productStatus?: 'active' | 'inactive' | 'all'; // 默认 all
}

/** 库存预警记录 */
export interface InventoryAlertRecord {
  productId: string;
  productName: string;
  productType: 'points' | 'code_exclusive';
  currentStock: number;
  totalStock: number;    // 含尺码选项时为所有尺码 stock 之和
  productStatus: 'active' | 'inactive';
  sizeOptions?: { name: string; stock: number }[];  // 尺码库存明细
}

/** 库存预警查询结果 */
export interface InventoryAlertResult {
  success: boolean;
  records?: InventoryAlertRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// 差旅申请统计（Travel Application Statistics）
// ============================================================

/** 差旅申请统计筛选条件 */
export interface TravelStatisticsFilter {
  periodType?: 'month' | 'quarter'; // 默认 month
  startDate?: string;
  endDate?: string;
  category?: 'domestic' | 'international' | 'all'; // 默认 all
}

/** 差旅申请统计记录 */
export interface TravelStatisticsRecord {
  period: string;              // YYYY-MM 或 YYYY-QN
  totalApplications: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  approvalRate: number;        // 百分比，保留一位小数
  totalSponsoredAmount: number;
}

/** 差旅申请统计查询结果 */
export interface TravelStatisticsResult {
  success: boolean;
  records?: TravelStatisticsRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// 邀请转化率（Invite Conversion Rate）
// ============================================================

/** 邀请转化率筛选条件 */
export interface InviteConversionFilter {
  startDate?: string;
  endDate?: string;
}

/** 邀请转化率汇总记录 */
export interface InviteConversionRecord {
  totalInvites: number;
  usedCount: number;
  expiredCount: number;
  pendingCount: number;
  conversionRate: number; // 百分比，保留一位小数
}

/** 邀请转化率查询结果 */
export interface InviteConversionResult {
  success: boolean;
  record?: InviteConversionRecord; // 单条汇总记录
  error?: { code: string; message: string };
}


// ============================================================
// 纯函数（导出供属性测试使用）
// ============================================================

/**
 * 按 productId 聚合兑换记录。
 * 返回 Map: productId → { redemptionCount, totalPointsSpent }
 */
export function aggregateRedemptionsByProduct(
  redemptions: { productId: string; pointsSpent?: number }[],
): Map<string, { redemptionCount: number; totalPointsSpent: number }> {
  const map = new Map<string, { redemptionCount: number; totalPointsSpent: number }>();

  for (const r of redemptions) {
    const existing = map.get(r.productId);
    if (existing) {
      existing.redemptionCount += 1;
      existing.totalPointsSpent += r.pointsSpent ?? 0;
    } else {
      map.set(r.productId, {
        redemptionCount: 1,
        totalPointsSpent: r.pointsSpent ?? 0,
      });
    }
  }

  return map;
}

/**
 * 计算库存消耗率。
 * 公式: redemptionCount / (stock + redemptionCount) × 100，保留一位小数。
 * 当分母为 0 时返回 0。
 */
export function calculateStockConsumptionRate(stock: number, redemptionCount: number): number {
  const denominator = stock + redemptionCount;
  if (denominator === 0) return 0;
  return Math.round((redemptionCount / denominator) * 1000) / 10;
}

/**
 * 计算互动总分。
 * 公式: likeCount + commentCount + reservationCount
 */
export function calculateEngagementScore(
  likeCount: number,
  commentCount: number,
  reservationCount: number,
): number {
  return likeCount + commentCount + reservationCount;
}

/**
 * 按 uploaderId 聚合内容贡献数据。
 * 返回 Map: uploaderId → { approvedCount, totalLikes, totalComments }
 */
export function aggregateContentByUploader(
  items: { uploaderId: string; likeCount: number; commentCount: number }[],
): Map<string, { approvedCount: number; totalLikes: number; totalComments: number }> {
  const map = new Map<string, { approvedCount: number; totalLikes: number; totalComments: number }>();

  for (const item of items) {
    const existing = map.get(item.uploaderId);
    if (existing) {
      existing.approvedCount += 1;
      existing.totalLikes += item.likeCount;
      existing.totalComments += item.commentCount;
    } else {
      map.set(item.uploaderId, {
        approvedCount: 1,
        totalLikes: item.likeCount,
        totalComments: item.commentCount,
      });
    }
  }

  return map;
}

/**
 * 从 ISO 日期字符串提取季度标签。
 * Q1=1-3月, Q2=4-6月, Q3=7-9月, Q4=10-12月
 * 返回格式: YYYY-QN
 */
function getQuarterLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed → 1-indexed
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

/**
 * 从 ISO 日期字符串提取月份标签。
 * 返回格式: YYYY-MM
 */
function getMonthLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 按时间周期聚合差旅申请。
 * periodType: 'month' → YYYY-MM, 'quarter' → YYYY-QN
 * 返回 TravelStatisticsRecord[]（未排序）。
 */
export function aggregateTravelByPeriod(
  applications: { createdAt: string; status: string; totalCost: number }[],
  periodType: 'month' | 'quarter',
): TravelStatisticsRecord[] {
  const map = new Map<string, {
    totalApplications: number;
    approvedCount: number;
    rejectedCount: number;
    pendingCount: number;
    totalSponsoredAmount: number;
  }>();

  for (const app of applications) {
    const period = periodType === 'month'
      ? getMonthLabel(app.createdAt)
      : getQuarterLabel(app.createdAt);

    if (!map.has(period)) {
      map.set(period, {
        totalApplications: 0,
        approvedCount: 0,
        rejectedCount: 0,
        pendingCount: 0,
        totalSponsoredAmount: 0,
      });
    }
    const entry = map.get(period)!;
    entry.totalApplications += 1;

    switch (app.status) {
      case 'approved':
        entry.approvedCount += 1;
        entry.totalSponsoredAmount += app.totalCost;
        break;
      case 'rejected':
        entry.rejectedCount += 1;
        break;
      case 'pending':
        entry.pendingCount += 1;
        break;
    }
  }

  const result: TravelStatisticsRecord[] = [];
  for (const [period, data] of map) {
    const approvalRate = data.totalApplications === 0
      ? 0
      : Math.round((data.approvedCount / data.totalApplications) * 1000) / 10;
    result.push({
      period,
      totalApplications: data.totalApplications,
      approvedCount: data.approvedCount,
      rejectedCount: data.rejectedCount,
      pendingCount: data.pendingCount,
      approvalRate,
      totalSponsoredAmount: data.totalSponsoredAmount,
    });
  }

  return result;
}

/**
 * 聚合邀请转化率。
 * 统计 totalInvites、usedCount、expiredCount、pendingCount、conversionRate。
 */
export function aggregateInviteConversion(
  invites: { status: string }[],
): InviteConversionRecord {
  const totalInvites = invites.length;
  let usedCount = 0;
  let expiredCount = 0;
  let pendingCount = 0;

  for (const invite of invites) {
    switch (invite.status) {
      case 'used':
        usedCount += 1;
        break;
      case 'expired':
        expiredCount += 1;
        break;
      case 'pending':
        pendingCount += 1;
        break;
    }
  }

  const conversionRate = totalInvites === 0
    ? 0
    : Math.round((usedCount / totalInvites) * 1000) / 10;

  return {
    totalInvites,
    usedCount,
    expiredCount,
    pendingCount,
    conversionRate,
  };
}

/**
 * 计算商品总库存（含尺码选项）。
 * 含尺码选项时为所有尺码 stock 之和，否则为 stock 字段值。
 */
export function calculateTotalStock(
  stock: number,
  sizeOptions?: { name: string; stock: number }[],
): number {
  if (sizeOptions && sizeOptions.length > 0) {
    return sizeOptions.reduce((sum, opt) => sum + opt.stock, 0);
  }
  return stock;
}

/**
 * 判断商品是否低库存（含尺码选项逻辑）。
 * 含尺码选项时：任一尺码 stock < threshold 即为低库存。
 * 无尺码选项时：stock < threshold 即为低库存。
 */
export function isLowStock(
  stock: number,
  sizeOptions: { name: string; stock: number }[] | undefined,
  threshold: number,
): boolean {
  if (sizeOptions && sizeOptions.length > 0) {
    return sizeOptions.some(opt => opt.stock < threshold);
  }
  return stock < threshold;
}


// ============================================================
// DynamoDB 辅助函数
// ============================================================

/** Split an array into chunks of the given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Scan a DynamoDB table with optional FilterExpression, handling pagination.
 * Returns all matching items.
 */
async function scanAll(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  options?: {
    filterExpression?: string;
    expressionAttributeValues?: Record<string, unknown>;
    expressionAttributeNames?: Record<string, string>;
  },
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: tableName,
        ...(options?.filterExpression && { FilterExpression: options.filterExpression }),
        ...(options?.expressionAttributeValues && { ExpressionAttributeValues: options.expressionAttributeValues }),
        ...(options?.expressionAttributeNames && { ExpressionAttributeNames: options.expressionAttributeNames }),
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
}

/**
 * Query a GSI with pagination, returning all matching items.
 */
async function queryAll(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  indexName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  options?: {
    filterExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    additionalExpressionAttributeValues?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  const mergedValues = {
    ...expressionAttributeValues,
    ...options?.additionalExpressionAttributeValues,
  };

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: mergedValues,
        ...(options?.filterExpression && { FilterExpression: options.filterExpression }),
        ...(options?.expressionAttributeNames && { ExpressionAttributeNames: options.expressionAttributeNames }),
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return allItems;
}

/**
 * BatchGet items from a DynamoDB table, chunking by 100.
 * Returns all retrieved items.
 */
async function batchGetItems(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  keys: Record<string, unknown>[],
  projectionExpression?: string,
): Promise<Record<string, unknown>[]> {
  if (keys.length === 0) return [];

  const allItems: Record<string, unknown>[] = [];
  const chunks = chunkArray(keys, 100);

  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: chunk,
            ...(projectionExpression && { ProjectionExpression: projectionExpression }),
          },
        },
      }),
    );
    allItems.push(...(result.Responses?.[tableName] ?? []));
  }

  return allItems;
}


// ============================================================
// 查询函数（DynamoDB queries）
// ============================================================

/**
 * 查询人气商品排行报表。
 * Scan Redemptions → 内存聚合 → BatchGet Products → 计算消耗率 → 排序
 */
export async function queryPopularProducts(
  filter: PopularProductsFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { ordersTable: string; productsTable: string },
): Promise<PopularProductsResult> {
  try {
    const productType = filter.productType ?? 'all';

    // 1. Scan Products table to get all products with their redemptionCount
    const productItems = await scanAll(dynamoClient, tables.productsTable);

    // 2. If date range is specified, scan Orders table and aggregate by productId
    let orderAggregation: Map<string, { redemptionCount: number; totalPointsSpent: number }> | null = null;

    if (filter.startDate || filter.endDate) {
      const filterExpressions: string[] = [];
      const expressionAttributeValues: Record<string, unknown> = {};

      if (filter.startDate) {
        filterExpressions.push('createdAt >= :startDate');
        expressionAttributeValues[':startDate'] = filter.startDate;
      }
      if (filter.endDate) {
        filterExpressions.push('createdAt <= :endDate');
        expressionAttributeValues[':endDate'] = filter.endDate;
      }

      const orderItems = await scanAll(dynamoClient, tables.ordersTable, {
        filterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        expressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
      });

      // Aggregate orders by productId (each order may contain multiple items)
      orderAggregation = new Map();
      for (const order of orderItems) {
        const items = (order.items as { productId: string; quantity: number; subtotal: number }[]) ?? [];
        const totalPoints = (order.totalPoints as number) ?? 0;
        for (const item of items) {
          const pid = item.productId;
          const existing = orderAggregation.get(pid);
          const qty = item.quantity ?? 1;
          const spent = item.subtotal ?? totalPoints;
          if (existing) {
            existing.redemptionCount += qty;
            existing.totalPointsSpent += spent;
          } else {
            orderAggregation.set(pid, { redemptionCount: qty, totalPointsSpent: spent });
          }
        }
      }
    }

    // 3. Build records
    const records: PopularProductRecord[] = [];

    for (const item of productItems) {
      const pid = (item.productId as string) ?? '';
      const type = (item.type as 'points' | 'code_exclusive') ?? 'points';
      const stock = (item.stock as number) ?? 0;
      const name = (item.name as string) ?? '';

      // Optional filter by productType
      if (productType !== 'all' && type !== productType) continue;

      let redemptionCount: number;
      let totalPointsSpent: number;

      if (orderAggregation) {
        // Use date-filtered order aggregation
        const agg = orderAggregation.get(pid);
        if (!agg || agg.redemptionCount === 0) continue; // Skip products with no orders in date range
        redemptionCount = agg.redemptionCount;
        totalPointsSpent = agg.totalPointsSpent;
      } else {
        // No date filter: use Products table's redemptionCount (all-time total)
        redemptionCount = (item.redemptionCount as number) ?? 0;
        totalPointsSpent = redemptionCount * ((item.pointsCost as number) ?? 0);
        if (redemptionCount === 0) continue; // Skip products with no redemptions
      }

      const stockConsumptionRate = calculateStockConsumptionRate(stock, redemptionCount);

      records.push({
        productId: pid,
        productName: name,
        productType: type,
        redemptionCount,
        totalPointsSpent,
        currentStock: stock,
        stockConsumptionRate,
      });
    }

    // 4. Sort by redemptionCount desc
    records.sort((a, b) => b.redemptionCount - a.redemptionCount);

    return { success: true, records };
  } catch (err) {
    console.error('queryPopularProducts error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * 查询热门内容排行报表。
 * Query ContentItems GSI (status=approved) → Scan ContentCategories → BatchGet Users → 计算互动分 → 排序
 */
export async function queryHotContent(
  filter: HotContentFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentItemsTable: string; contentCategoriesTable: string; usersTable: string },
): Promise<HotContentResult> {
  try {
    // 1. Query ContentItems using status-createdAt-index GSI
    let keyCondition = '#status = :status';
    const expressionAttributeValues: Record<string, unknown> = { ':status': 'approved' };
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };

    if (filter.startDate && filter.endDate) {
      keyCondition += ' AND createdAt BETWEEN :startDate AND :endDate';
      expressionAttributeValues[':startDate'] = filter.startDate;
      expressionAttributeValues[':endDate'] = filter.endDate;
    } else if (filter.startDate) {
      keyCondition += ' AND createdAt >= :startDate';
      expressionAttributeValues[':startDate'] = filter.startDate;
    } else if (filter.endDate) {
      keyCondition += ' AND createdAt <= :endDate';
      expressionAttributeValues[':endDate'] = filter.endDate;
    }

    // Optional FilterExpression for categoryId
    let filterExpression: string | undefined;
    const additionalValues: Record<string, unknown> = {};
    if (filter.categoryId) {
      filterExpression = 'categoryId = :categoryId';
      additionalValues[':categoryId'] = filter.categoryId;
    }

    const contentItems = await queryAll(
      dynamoClient,
      tables.contentItemsTable,
      'status-createdAt-index',
      keyCondition,
      expressionAttributeValues,
      {
        filterExpression,
        expressionAttributeNames,
        additionalExpressionAttributeValues: Object.keys(additionalValues).length > 0 ? additionalValues : undefined,
      },
    );

    // 2. Scan ContentCategories table for categoryId → name mapping
    const categoryItems = await scanAll(dynamoClient, tables.contentCategoriesTable);
    const categoryMap = new Map<string, string>();
    for (const item of categoryItems) {
      categoryMap.set(item.categoryId as string, (item.name as string) ?? '');
    }

    // 3. BatchGet Users table for uploaderNickname
    const uploaderIds = [...new Set(contentItems.map(item => item.uploaderId as string).filter(Boolean))];
    const userKeys = uploaderIds.map(id => ({ userId: id }));
    const userItems = await batchGetItems(dynamoClient, tables.usersTable, userKeys);
    const userMap = new Map<string, string>();
    for (const item of userItems) {
      userMap.set(item.userId as string, (item.nickname as string) ?? '');
    }

    // 4. Build records with engagement score
    const records: HotContentRecord[] = contentItems.map(item => {
      const likeCount = (item.likeCount as number) ?? 0;
      const commentCount = (item.commentCount as number) ?? 0;
      const reservationCount = (item.reservationCount as number) ?? 0;
      const engagementScore = calculateEngagementScore(likeCount, commentCount, reservationCount);

      return {
        contentId: (item.contentId as string) ?? '',
        title: (item.title as string) ?? '',
        uploaderNickname: userMap.get(item.uploaderId as string) ?? '',
        categoryName: categoryMap.get(item.categoryId as string) ?? '',
        likeCount,
        commentCount,
        reservationCount,
        engagementScore,
      };
    });

    // 5. Sort by engagementScore desc
    records.sort((a, b) => b.engagementScore - a.engagementScore);

    return { success: true, records };
  } catch (err) {
    console.error('queryHotContent error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * 查询内容贡献者排行报表。
 * Query ContentItems GSI (status=approved) → 内存聚合 → BatchGet Users → 排序 + 排名
 */
export async function queryContentContributors(
  filter: ContentContributorFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentItemsTable: string; usersTable: string },
): Promise<ContentContributorResult> {
  try {
    // 1. Query ContentItems using status-createdAt-index GSI
    let keyCondition = '#status = :status';
    const expressionAttributeValues: Record<string, unknown> = { ':status': 'approved' };
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };

    if (filter.startDate && filter.endDate) {
      keyCondition += ' AND createdAt BETWEEN :startDate AND :endDate';
      expressionAttributeValues[':startDate'] = filter.startDate;
      expressionAttributeValues[':endDate'] = filter.endDate;
    } else if (filter.startDate) {
      keyCondition += ' AND createdAt >= :startDate';
      expressionAttributeValues[':startDate'] = filter.startDate;
    } else if (filter.endDate) {
      keyCondition += ' AND createdAt <= :endDate';
      expressionAttributeValues[':endDate'] = filter.endDate;
    }

    const contentItems = await queryAll(
      dynamoClient,
      tables.contentItemsTable,
      'status-createdAt-index',
      keyCondition,
      expressionAttributeValues,
      { expressionAttributeNames },
    );

    // 2. Aggregate by uploaderId
    const items = contentItems.map(item => ({
      uploaderId: (item.uploaderId as string) ?? '',
      likeCount: (item.likeCount as number) ?? 0,
      commentCount: (item.commentCount as number) ?? 0,
    }));
    const aggregated = aggregateContentByUploader(items);

    // 3. BatchGet Users table for nickname
    const userIds = [...aggregated.keys()];
    const userKeys = userIds.map(id => ({ userId: id }));
    const userItems = await batchGetItems(dynamoClient, tables.usersTable, userKeys);
    const userMap = new Map<string, string>();
    for (const item of userItems) {
      userMap.set(item.userId as string, (item.nickname as string) ?? '');
    }

    // 4. Build records, sort by approvedCount desc, assign rank
    const unsorted: Omit<ContentContributorRecord, 'rank'>[] = [];
    for (const [userId, data] of aggregated) {
      unsorted.push({
        userId,
        nickname: userMap.get(userId) ?? '',
        approvedCount: data.approvedCount,
        totalLikes: data.totalLikes,
        totalComments: data.totalComments,
      });
    }

    unsorted.sort((a, b) => b.approvedCount - a.approvedCount);

    const records: ContentContributorRecord[] = unsorted.map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

    return { success: true, records };
  } catch (err) {
    console.error('queryContentContributors error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * 查询库存预警报表。
 * Scan Products → 内存筛选（productType, productStatus, stockThreshold） → 排序
 */
export async function queryInventoryAlert(
  filter: InventoryAlertFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { productsTable: string },
): Promise<InventoryAlertResult> {
  try {
    const threshold = filter.stockThreshold ?? 5;
    const productType = filter.productType ?? 'all';
    const productStatus = filter.productStatus ?? 'all';

    // 1. Scan Products table
    const productItems = await scanAll(dynamoClient, tables.productsTable);

    // 2. Filter in-memory
    const records: InventoryAlertRecord[] = [];

    for (const item of productItems) {
      const type = (item.type as 'points' | 'code_exclusive') ?? 'points';
      const status = (item.status as string) ?? 'active';
      const stock = (item.stock as number) ?? 0;
      const sizeOptions = item.sizeOptions as { name: string; stock: number }[] | undefined;

      // Filter by productType
      if (productType !== 'all' && type !== productType) continue;

      // Filter by productStatus
      if (productStatus !== 'all' && status !== productStatus) continue;

      // Filter by stock threshold using isLowStock
      if (!isLowStock(stock, sizeOptions, threshold)) continue;

      const totalStock = calculateTotalStock(stock, sizeOptions);

      // For sized products, currentStock = minimum size stock (most urgent)
      const effectiveCurrentStock = sizeOptions && sizeOptions.length > 0
        ? Math.min(...sizeOptions.map(opt => opt.stock))
        : stock;

      records.push({
        productId: (item.productId as string) ?? '',
        productName: (item.name as string) ?? '',
        productType: type,
        currentStock: effectiveCurrentStock,
        totalStock,
        productStatus: status as 'active' | 'inactive',
        ...(sizeOptions && sizeOptions.length > 0 ? { sizeOptions } : {}),
      });
    }

    // 3. Sort by currentStock asc
    records.sort((a, b) => a.currentStock - b.currentStock);

    return { success: true, records };
  } catch (err) {
    console.error('queryInventoryAlert error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * 查询差旅申请统计报表。
 * Scan TravelApplications → 内存聚合（按月/季度） → 排序
 */
export async function queryTravelStatistics(
  filter: TravelStatisticsFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { travelApplicationsTable: string },
): Promise<TravelStatisticsResult> {
  try {
    const periodType = filter.periodType ?? 'month';
    const category = filter.category ?? 'all';

    // Default to last 12 months when no date range provided
    let startDate = filter.startDate;
    let endDate = filter.endDate;
    if (!startDate && !endDate) {
      const now = new Date();
      endDate = now.toISOString();
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      startDate = twelveMonthsAgo.toISOString();
    }

    // 1. Scan TravelApplications table with optional filters
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};

    if (startDate) {
      filterExpressions.push('createdAt >= :startDate');
      expressionAttributeValues[':startDate'] = startDate;
    }
    if (endDate) {
      filterExpressions.push('createdAt <= :endDate');
      expressionAttributeValues[':endDate'] = endDate;
    }
    if (category !== 'all') {
      filterExpressions.push('category = :category');
      expressionAttributeValues[':category'] = category;
    }

    const applicationItems = await scanAll(dynamoClient, tables.travelApplicationsTable, {
      filterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
      expressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
    });

    // 2. Aggregate using aggregateTravelByPeriod
    const applications = applicationItems.map(item => ({
      createdAt: (item.createdAt as string) ?? '',
      status: (item.status as string) ?? '',
      totalCost: (item.totalCost as number) ?? 0,
    }));
    const aggregated = aggregateTravelByPeriod(applications, periodType);

    // 3. Sort by period desc
    aggregated.sort((a, b) => b.period.localeCompare(a.period));

    return { success: true, records: aggregated };
  } catch (err) {
    console.error('queryTravelStatistics error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * 查询邀请转化率报表。
 * Scan Invites → 聚合 → 返回单条汇总记录
 */
export async function queryInviteConversion(
  filter: InviteConversionFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { invitesTable: string },
): Promise<InviteConversionResult> {
  try {
    // 1. Scan Invites table with optional date range filter
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};

    if (filter.startDate) {
      filterExpressions.push('createdAt >= :startDate');
      expressionAttributeValues[':startDate'] = filter.startDate;
    }
    if (filter.endDate) {
      filterExpressions.push('createdAt <= :endDate');
      expressionAttributeValues[':endDate'] = filter.endDate;
    }

    const inviteItems = await scanAll(dynamoClient, tables.invitesTable, {
      filterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
      expressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
    });

    // 2. Aggregate using aggregateInviteConversion
    const invites = inviteItems.map(item => ({
      status: (item.status as string) ?? '',
    }));
    const record = aggregateInviteConversion(invites);

    return { success: true, record };
  } catch (err) {
    console.error('queryInviteConversion error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}
