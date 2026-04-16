// Report export module - handles file generation (CSV/Excel), S3 upload, and presigned URL creation
// See design.md for full interface definitions

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { ReportType, ExportFormat } from './formatters';
import {
  getColumnDefs,
  generateCSV,
  generateExcel,
  formatPointsDetailForExport,
  formatUGSummaryForExport,
  formatUserRankingForExport,
  formatActivitySummaryForExport,
  formatPopularProductsForExport,
  formatHotContentForExport,
  formatContentContributorsForExport,
  formatInventoryAlertForExport,
  formatTravelStatisticsForExport,
  formatInviteConversionForExport,
} from './formatters';
import type {
  PointsDetailRecord,
  UGActivitySummaryRecord,
  UserRankingRecord,
  ActivitySummaryRecord,
  RawPointsRecord,
} from './query';
import {
  applyDefaultDateRange,
  aggregateByUG,
  aggregateByUser,
  aggregateByActivity,
  sortRecords,
} from './query';
import {
  queryPopularProducts,
  queryHotContent,
  queryContentContributors,
  queryInventoryAlert,
  queryTravelStatistics,
  queryInviteConversion,
} from './insight-query';

// ============================================================
// Constants
// ============================================================

const MAX_EXPORT_RECORDS = 50_000;
const SCAN_PAGE_SIZE = 1_000;
const TIMEOUT_BUFFER_MS = 60_000; // 1 minute buffer
const PRESIGNED_URL_EXPIRY = 30 * 60; // 30 minutes in seconds

const VALID_REPORT_TYPES: ReportType[] = [
  'points-detail',
  'ug-activity-summary',
  'user-points-ranking',
  'activity-points-summary',
  'popular-products',
  'hot-content',
  'content-contributors',
  'inventory-alert',
  'travel-statistics',
  'invite-conversion',
];

const VALID_FORMATS: ExportFormat[] = ['csv', 'xlsx'];

// ============================================================
// Interfaces
// ============================================================

/** 导出请求输入 */
export interface ExportInput {
  reportType: ReportType;
  format: ExportFormat;
  filters: Record<string, string>;
}

/** 导出结果 */
export interface ExportResult {
  success: boolean;
  downloadUrl?: string;
  error?: { code: string; message: string };
}

// ============================================================
// Timeout detection
// ============================================================

/**
 * Check if the Lambda execution is approaching the 15-minute timeout.
 * Returns true if elapsed time is within TIMEOUT_BUFFER_MS of the max duration.
 */
export function isApproachingTimeout(startTime: number): boolean {
  const elapsed = Date.now() - startTime;
  const maxDuration = 15 * 60 * 1000; // 15 minutes
  return elapsed >= maxDuration - TIMEOUT_BUFFER_MS;
}

// ============================================================
// Input validation
// ============================================================

/**
 * Validate export request input.
 * Returns { valid: true } or { valid: false, error: { code, message } }.
 */
export function validateExportInput(body: unknown): { valid: boolean; error?: { code: string; message: string } } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: '请求体不能为空' } };
  }

  const input = body as Record<string, unknown>;

  // Validate reportType
  if (!input.reportType || typeof input.reportType !== 'string') {
    return { valid: false, error: { code: 'INVALID_REPORT_TYPE', message: '不支持的报表类型' } };
  }
  if (!VALID_REPORT_TYPES.includes(input.reportType as ReportType)) {
    return { valid: false, error: { code: 'INVALID_REPORT_TYPE', message: '不支持的报表类型' } };
  }

  // Validate format
  if (!input.format || typeof input.format !== 'string') {
    return { valid: false, error: { code: 'INVALID_EXPORT_FORMAT', message: '不支持的导出格式' } };
  }
  if (!VALID_FORMATS.includes(input.format as ExportFormat)) {
    return { valid: false, error: { code: 'INVALID_EXPORT_FORMAT', message: '不支持的导出格式' } };
  }

  // Validate filters (optional, but must be an object if provided)
  if (input.filters !== undefined && input.filters !== null) {
    if (typeof input.filters !== 'object' || Array.isArray(input.filters)) {
      return { valid: false, error: { code: 'INVALID_REQUEST', message: 'filters 必须是对象' } };
    }
  }

  return { valid: true };
}

// ============================================================
// Export execution
// ============================================================

/**
 * Query all records from type-createdAt-index GSI for export (paginated, max SCAN_PAGE_SIZE per page).
 * Enforces MAX_EXPORT_RECORDS limit and timeout detection.
 */
async function queryAllRecordsForExport(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  type: 'earn' | 'spend',
  startDate: string,
  endDate: string,
  filterExpressions?: string[],
  expressionAttributeValues?: Record<string, unknown>,
  expressionAttributeNames?: Record<string, string>,
  lambdaStartTime?: number,
): Promise<{ items: Record<string, unknown>[]; error?: { code: string; message: string } }> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  const filterExpr = filterExpressions && filterExpressions.length > 0
    ? filterExpressions.join(' AND ')
    : undefined;

  do {
    // Check timeout
    if (lambdaStartTime && isApproachingTimeout(lambdaStartTime)) {
      return { items: allItems, error: { code: 'EXPORT_TIMEOUT', message: '导出超时，请缩小筛选范围后重试' } };
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'type-createdAt-index',
        KeyConditionExpression: '#type = :type AND createdAt BETWEEN :start AND :end',
        ExpressionAttributeNames: {
          '#type': 'type',
          ...expressionAttributeNames,
        },
        ExpressionAttributeValues: {
          ':type': type,
          ':start': startDate,
          ':end': endDate,
          ...expressionAttributeValues,
        },
        ...(filterExpr && { FilterExpression: filterExpr }),
        ScanIndexForward: false,
        Limit: SCAN_PAGE_SIZE,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;

    // Check record limit
    if (allItems.length > MAX_EXPORT_RECORDS) {
      return {
        items: allItems,
        error: { code: 'EXPORT_LIMIT_EXCEEDED', message: '导出数据量超过限制，请缩小筛选范围' },
      };
    }
  } while (lastEvaluatedKey);

  return { items: allItems };
}

/**
 * BatchGet user nicknames from Users table for export.
 */
async function batchGetNicknamesForExport(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const { BatchGetCommand } = await import('@aws-sdk/lib-dynamodb');
  const nicknameMap = new Map<string, string>();
  if (userIds.length === 0) return nicknameMap;

  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    chunks.push(userIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname',
          },
        },
      }),
    );
    const items = result.Responses?.[usersTable] ?? [];
    for (const item of items) {
      nicknameMap.set(item.userId as string, (item.nickname as string) ?? '');
    }
  }
  return nicknameMap;
}

/**
 * Execute a full report export:
 * 1. Query full dataset (paginated DynamoDB reads)
 * 2. Enforce 50,000 record limit
 * 3. Detect timeout
 * 4. Format records
 * 5. Generate CSV or Excel buffer
 * 6. Upload to S3
 * 7. Generate presigned download URL
 */
export async function executeExport(
  input: ExportInput,
  dynamoClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  tables: {
    pointsRecordsTable: string;
    usersTable: string;
    batchDistributionsTable: string;
    productsTable?: string;
    redemptionsTable?: string;
    contentItemsTable?: string;
    contentCategoriesTable?: string;
    travelApplicationsTable?: string;
    invitesTable?: string;
  },
  bucket: string,
  lambdaStartTime?: number,
): Promise<ExportResult> {
  try {
    const { reportType, format, filters } = input;
    const { startDate, endDate } = applyDefaultDateRange(filters.startDate, filters.endDate);

    // Build filter expressions based on report type
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};

    if (filters.ugName) {
      filterExpressions.push('activityUG = :ugName');
      expressionAttributeValues[':ugName'] = filters.ugName;
    }
    if (filters.targetRole && filters.targetRole !== 'all') {
      filterExpressions.push('targetRole = :targetRole');
      expressionAttributeValues[':targetRole'] = filters.targetRole;
    }
    if (filters.activityId) {
      filterExpressions.push('activityId = :activityId');
      expressionAttributeValues[':activityId'] = filters.activityId;
    }

    let fileBuffer: Buffer;
    const columns = getColumnDefs(reportType);

    if (reportType === 'points-detail') {
      // Query both earn and spend for points detail
      const filterType = filters.type as 'earn' | 'spend' | 'all' | undefined;
      let allRawItems: Record<string, unknown>[] = [];

      if (!filterType || filterType === 'all') {
        const [earnResult, spendResult] = await Promise.all([
          queryAllRecordsForExport(
            dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
            filterExpressions.length > 0 ? filterExpressions : undefined,
            Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
            undefined, lambdaStartTime,
          ),
          queryAllRecordsForExport(
            dynamoClient, tables.pointsRecordsTable, 'spend', startDate, endDate,
            filterExpressions.length > 0 ? filterExpressions : undefined,
            Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
            undefined, lambdaStartTime,
          ),
        ]);

        if (earnResult.error) return { success: false, error: earnResult.error };
        if (spendResult.error) return { success: false, error: spendResult.error };

        allRawItems = [...earnResult.items, ...spendResult.items];
        if (allRawItems.length > MAX_EXPORT_RECORDS) {
          return { success: false, error: { code: 'EXPORT_LIMIT_EXCEEDED', message: '导出数据量超过限制，请缩小筛选范围' } };
        }
      } else {
        const result = await queryAllRecordsForExport(
          dynamoClient, tables.pointsRecordsTable, filterType, startDate, endDate,
          filterExpressions.length > 0 ? filterExpressions : undefined,
          Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
          undefined, lambdaStartTime,
        );
        if (result.error) return { success: false, error: result.error };
        allRawItems = result.items;
      }

      // Sort by createdAt desc
      allRawItems.sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));

      // Get user nicknames
      const uniqueUserIds = [...new Set(allRawItems.map(r => r.userId as string))];
      const nicknameMap = await batchGetNicknamesForExport(dynamoClient, tables.usersTable, uniqueUserIds);

      // Get distributor nicknames
      const distributorMap = new Map<string, string>();
      // Query BatchDistributions for distributor info
      let lastKey: Record<string, unknown> | undefined;
      do {
        const result = await dynamoClient.send(
          new QueryCommand({
            TableName: tables.batchDistributionsTable,
            IndexName: 'createdAt-index',
            KeyConditionExpression: 'pk = :pk AND createdAt BETWEEN :start AND :end',
            ExpressionAttributeValues: { ':pk': 'ALL', ':start': startDate, ':end': endDate },
            ProjectionExpression: 'activityId, targetRole, distributorNickname',
            ScanIndexForward: false,
            ...(lastKey && { ExclusiveStartKey: lastKey }),
          }),
        );
        for (const item of result.Items ?? []) {
          const aid = item.activityId as string;
          const role = item.targetRole as string;
          const nickname = (item.distributorNickname as string) ?? '';
          if (aid) {
            distributorMap.set(`${aid}#${role}`, nickname);
            if (!distributorMap.has(aid)) distributorMap.set(aid, nickname);
          }
        }
        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      // Map to PointsDetailRecord
      const records: PointsDetailRecord[] = allRawItems.map(r => {
        const activityId = (r.activityId as string) ?? '';
        const targetRole = (r.targetRole as string) ?? '';
        return {
          recordId: (r.recordId as string) ?? '',
          createdAt: (r.createdAt as string) ?? '',
          userId: (r.userId as string) ?? '',
          nickname: nicknameMap.get(r.userId as string) ?? '',
          amount: (r.amount as number) ?? 0,
          type: (r.type as 'earn' | 'spend') ?? 'earn',
          source: (r.source as string) ?? '',
          activityUG: (r.activityUG as string) ?? '',
          activityTopic: (r.activityTopic as string) ?? '',
          activityId,
          targetRole,
          distributorNickname: distributorMap.get(`${activityId}#${targetRole}`) ?? distributorMap.get(activityId) ?? '',
        };
      });

      const formatted = formatPointsDetailForExport(records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'ug-activity-summary') {
      const result = await queryAllRecordsForExport(
        dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
        undefined, undefined, undefined, lambdaStartTime,
      );
      if (result.error) return { success: false, error: result.error };

      const rawRecords = result.items as unknown as RawPointsRecord[];
      const aggregated = aggregateByUG(rawRecords);
      const sorted = sortRecords(aggregated, 'totalPoints', 'desc');
      const formatted = formatUGSummaryForExport(sorted);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'user-points-ranking') {
      const rankFilterExpressions: string[] = [];
      const rankExprValues: Record<string, unknown> = {};
      if (filters.targetRole && filters.targetRole !== 'all') {
        rankFilterExpressions.push('targetRole = :targetRole');
        rankExprValues[':targetRole'] = filters.targetRole;
      }

      const result = await queryAllRecordsForExport(
        dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
        rankFilterExpressions.length > 0 ? rankFilterExpressions : undefined,
        Object.keys(rankExprValues).length > 0 ? rankExprValues : undefined,
        undefined, lambdaStartTime,
      );
      if (result.error) return { success: false, error: result.error };

      const rawRecords = result.items as unknown as RawPointsRecord[];
      const aggregated = aggregateByUser(rawRecords);
      const sorted = aggregated.sort((a, b) => b.totalEarnPoints - a.totalEarnPoints);

      // Get nicknames
      const uniqueUserIds = sorted.map(r => r.userId);
      const nicknameMap = await batchGetNicknamesForExport(dynamoClient, tables.usersTable, uniqueUserIds);

      const records: UserRankingRecord[] = sorted.map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        nickname: nicknameMap.get(r.userId) ?? '',
        totalEarnPoints: r.totalEarnPoints,
        targetRole: r.targetRole,
      }));

      const formatted = formatUserRankingForExport(records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'activity-points-summary') {
      const actFilterExpressions: string[] = [];
      const actExprValues: Record<string, unknown> = {};
      if (filters.ugName) {
        actFilterExpressions.push('activityUG = :ugName');
        actExprValues[':ugName'] = filters.ugName;
      }

      const result = await queryAllRecordsForExport(
        dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
        actFilterExpressions.length > 0 ? actFilterExpressions : undefined,
        Object.keys(actExprValues).length > 0 ? actExprValues : undefined,
        undefined, lambdaStartTime,
      );
      if (result.error) return { success: false, error: result.error };

      const rawRecords = result.items as unknown as RawPointsRecord[];
      const aggregated = aggregateByActivity(rawRecords);
      const sorted = sortRecords(aggregated, 'activityDate', 'desc');
      const formatted = formatActivitySummaryForExport(sorted);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'popular-products') {
      const queryResult = await queryPopularProducts(
        { startDate, endDate, productType: filters.productType as 'points' | 'code_exclusive' | 'all' | undefined },
        dynamoClient,
        { redemptionsTable: tables.redemptionsTable!, productsTable: tables.productsTable! },
      );
      if (!queryResult.success || !queryResult.records) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatPopularProductsForExport(queryResult.records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'hot-content') {
      const queryResult = await queryHotContent(
        { startDate, endDate, categoryId: filters.categoryId },
        dynamoClient,
        { contentItemsTable: tables.contentItemsTable!, contentCategoriesTable: tables.contentCategoriesTable!, usersTable: tables.usersTable },
      );
      if (!queryResult.success || !queryResult.records) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatHotContentForExport(queryResult.records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'content-contributors') {
      const queryResult = await queryContentContributors(
        { startDate, endDate },
        dynamoClient,
        { contentItemsTable: tables.contentItemsTable!, usersTable: tables.usersTable },
      );
      if (!queryResult.success || !queryResult.records) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatContentContributorsForExport(queryResult.records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'inventory-alert') {
      const queryResult = await queryInventoryAlert(
        { stockThreshold: Number(filters.stockThreshold) || 5, productType: filters.productType as 'points' | 'code_exclusive' | 'all' | undefined, productStatus: filters.productStatus as 'active' | 'inactive' | 'all' | undefined },
        dynamoClient,
        { productsTable: tables.productsTable! },
      );
      if (!queryResult.success || !queryResult.records) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatInventoryAlertForExport(queryResult.records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else if (reportType === 'travel-statistics') {
      const queryResult = await queryTravelStatistics(
        { startDate, endDate, periodType: filters.periodType as 'month' | 'quarter' | undefined, category: filters.category as 'domestic' | 'international' | 'all' | undefined },
        dynamoClient,
        { travelApplicationsTable: tables.travelApplicationsTable! },
      );
      if (!queryResult.success || !queryResult.records) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatTravelStatisticsForExport(queryResult.records);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);

    } else {
      // invite-conversion
      const queryResult = await queryInviteConversion(
        { startDate, endDate },
        dynamoClient,
        { invitesTable: tables.invitesTable! },
      );
      if (!queryResult.success || !queryResult.record) {
        return { success: false, error: queryResult.error ?? { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
      }
      const formatted = formatInviteConversionForExport([queryResult.record]);
      fileBuffer = format === 'csv' ? generateCSV(formatted, columns) : generateExcel(formatted, columns);
    }

    // Upload to S3
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const randomId = ulid();
    const extension = format === 'csv' ? 'csv' : 'xlsx';
    const s3Key = `exports/${reportType}/${timestamp}_${randomId}.${extension}`;
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
      }),
    );

    // Generate presigned download URL
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
      { expiresIn: PRESIGNED_URL_EXPIRY },
    );

    return { success: true, downloadUrl };
  } catch (err) {
    console.error('executeExport error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}
