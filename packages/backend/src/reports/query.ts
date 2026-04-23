// Report query module - handles DynamoDB queries and in-memory aggregation for all report types
// See design.md for full interface definitions and query strategies

import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

/** 积分明细筛选条件 */
export interface PointsDetailFilter {
  startDate?: string;   // ISO 8601
  endDate?: string;     // ISO 8601
  ugName?: string;      // activityUG
  targetRole?: string;  // UserGroupLeader | Speaker | Volunteer
  activityId?: string;
  type?: 'earn' | 'spend' | 'all'; // 默认 all
  pageSize?: number;    // 默认 20，最大 100
  lastKey?: string;     // base64 编码的分页游标
}

/** 积分明细记录（已关联用户昵称和发放者昵称） */
export interface PointsDetailRecord {
  recordId: string;
  createdAt: string;
  userId: string;
  nickname: string;
  amount: number;
  type: 'earn' | 'spend';
  source: string;
  activityUG: string;
  activityTopic: string;
  activityId: string;
  targetRole: string;
  distributorNickname: string;
  isEmployee?: boolean;
}

/** 积分明细查询结果 */
export interface PointsDetailResult {
  success: boolean;
  records?: PointsDetailRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/** UG 活跃度汇总筛选条件 */
export interface UGActivityFilter {
  startDate?: string;
  endDate?: string;
}

/** UG 活跃度汇总记录 */
export interface UGActivitySummaryRecord {
  ugName: string;
  activityCount: number;
  totalPoints: number;
  participantCount: number;
}

/** UG 活跃度汇总查询结果 */
export interface UGActivitySummaryResult {
  success: boolean;
  records?: UGActivitySummaryRecord[];
  error?: { code: string; message: string };
}

/** 用户积分排行筛选条件 */
export interface UserRankingFilter {
  startDate?: string;
  endDate?: string;
  targetRole?: string; // UserGroupLeader | Speaker | Volunteer | all
  pageSize?: number;   // 默认 50，最大 100
  lastKey?: string;    // base64 编码的 offset 值
}

/** 用户积分排行记录 */
export interface UserRankingRecord {
  rank: number;
  userId: string;
  nickname: string;
  totalEarnPoints: number;
  targetRole: string;
  isEmployee?: boolean;
}

/** 用户积分排行查询结果 */
export interface UserRankingResult {
  success: boolean;
  records?: UserRankingRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/** 活动积分汇总筛选条件 */
export interface ActivitySummaryFilter {
  startDate?: string;
  endDate?: string;
  ugName?: string;
}

/** 活动积分汇总记录 */
export interface ActivitySummaryRecord {
  activityId: string;
  activityTopic: string;
  activityDate: string;
  activityUG: string;
  totalPoints: number;
  participantCount: number;
  uglCount: number;
  speakerCount: number;
  volunteerCount: number;
}

/** 活动积分汇总查询结果 */
export interface ActivitySummaryResult {
  success: boolean;
  records?: ActivitySummaryRecord[];
  error?: { code: string; message: string };
}

// ============================================================
// Raw record type from DynamoDB
// ============================================================

/** Raw PointsRecord from DynamoDB (used internally and for pure function testing) */
export interface RawPointsRecord {
  recordId: string;
  userId: string;
  type: 'earn' | 'spend';
  amount: number;
  source: string;
  balanceAfter: number;
  createdAt: string;
  activityId?: string;
  activityType?: string;
  activityUG?: string;
  activityTopic?: string;
  activityDate?: string;
  targetRole?: string;
}

// ============================================================
// Utility functions
// ============================================================

/**
 * Clamp pageSize to [1, 100], default 20.
 * For user ranking, pass defaultSize=50.
 */
export function clampPageSize(pageSize?: number, defaultSize: number = 20): number {
  if (pageSize === undefined || pageSize === null) return defaultSize;
  if (pageSize < 1) return 1;
  if (pageSize > 100) return 100;
  return Math.floor(pageSize);
}

/**
 * Apply default date range (30 days) when no dates provided.
 * Returns { startDate, endDate } with ISO 8601 strings.
 */
export function applyDefaultDateRange(startDate?: string, endDate?: string): { startDate: string; endDate: string } {
  const now = new Date();
  const resolvedEnd = endDate || now.toISOString();
  if (!startDate) {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { startDate: thirtyDaysAgo.toISOString(), endDate: resolvedEnd };
  }
  return { startDate, endDate: resolvedEnd };
}

/** Split an array into chunks of the given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================================
// Pure aggregation / filter / sort functions (exported for property testing)
// ============================================================

/**
 * Filter raw points records by the given criteria.
 * Returns only records matching ALL active filter criteria.
 */
export function filterPointsRecords(
  records: RawPointsRecord[],
  filter: {
    startDate?: string;
    endDate?: string;
    ugName?: string;
    targetRole?: string;
    activityId?: string;
    type?: 'earn' | 'spend' | 'all';
  },
): RawPointsRecord[] {
  return records.filter(r => {
    if (filter.startDate && r.createdAt < filter.startDate) return false;
    if (filter.endDate && r.createdAt > filter.endDate) return false;
    if (filter.ugName && r.activityUG !== filter.ugName) return false;
    if (filter.targetRole && filter.targetRole !== 'all' && r.targetRole !== filter.targetRole) return false;
    if (filter.activityId && r.activityId !== filter.activityId) return false;
    if (filter.type && filter.type !== 'all' && r.type !== filter.type) return false;
    return true;
  });
}

/**
 * Sort records by a given key in descending order.
 * Returns a new sorted array (does not mutate input).
 */
export function sortRecords<T>(records: T[], key: keyof T, direction: 'asc' | 'desc' = 'desc'): T[] {
  return [...records].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal < bVal) return direction === 'desc' ? 1 : -1;
    if (aVal > bVal) return direction === 'desc' ? -1 : 1;
    return 0;
  });
}

/**
 * Aggregate raw earn records by activityUG.
 * Returns UGActivitySummaryRecord[] (unsorted).
 */
export function aggregateByUG(records: RawPointsRecord[]): UGActivitySummaryRecord[] {
  const map = new Map<string, {
    activityIds: Set<string>;
    totalPoints: number;
    userIds: Set<string>;
  }>();

  for (const r of records) {
    const ug = r.activityUG ?? '';
    if (!ug) continue; // Skip records without UG association
    if (!map.has(ug)) {
      map.set(ug, { activityIds: new Set(), totalPoints: 0, userIds: new Set() });
    }
    const entry = map.get(ug)!;
    if (r.activityId) entry.activityIds.add(r.activityId);
    entry.totalPoints += r.amount;
    entry.userIds.add(r.userId);
  }

  const result: UGActivitySummaryRecord[] = [];
  for (const [ugName, data] of map) {
    result.push({
      ugName,
      activityCount: data.activityIds.size,
      totalPoints: data.totalPoints,
      participantCount: data.userIds.size,
    });
  }
  return result;
}

/**
 * Aggregate raw earn records by userId.
 * Returns { userId, totalEarnPoints }[] (unsorted, no rank yet).
 */
export function aggregateByUser(records: RawPointsRecord[]): { userId: string; totalEarnPoints: number; targetRole: string }[] {
  const map = new Map<string, { totalEarnPoints: number; targetRole: string }>();

  for (const r of records) {
    if (!map.has(r.userId)) {
      map.set(r.userId, { totalEarnPoints: 0, targetRole: r.targetRole ?? '' });
    }
    const entry = map.get(r.userId)!;
    entry.totalEarnPoints += r.amount;
    // Keep the most recent targetRole (last seen)
    if (r.targetRole) entry.targetRole = r.targetRole;
  }

  const result: { userId: string; totalEarnPoints: number; targetRole: string }[] = [];
  for (const [userId, data] of map) {
    result.push({ userId, totalEarnPoints: data.totalEarnPoints, targetRole: data.targetRole });
  }
  return result;
}

/**
 * Aggregate raw earn records by activityId.
 * Returns ActivitySummaryRecord[] (unsorted).
 */
export function aggregateByActivity(records: RawPointsRecord[]): ActivitySummaryRecord[] {
  const map = new Map<string, {
    activityTopic: string;
    activityDate: string;
    activityUG: string;
    totalPoints: number;
    userIds: Set<string>;
    uglUserIds: Set<string>;
    speakerUserIds: Set<string>;
    volunteerUserIds: Set<string>;
  }>();

  for (const r of records) {
    const aid = r.activityId ?? '';
    if (!map.has(aid)) {
      map.set(aid, {
        activityTopic: r.activityTopic ?? '',
        activityDate: r.activityDate ?? '',
        activityUG: r.activityUG ?? '',
        totalPoints: 0,
        userIds: new Set(),
        uglUserIds: new Set(),
        speakerUserIds: new Set(),
        volunteerUserIds: new Set(),
      });
    }
    const entry = map.get(aid)!;
    entry.totalPoints += r.amount;
    entry.userIds.add(r.userId);
    // Update metadata from records (take latest non-empty values)
    if (r.activityTopic) entry.activityTopic = r.activityTopic;
    if (r.activityDate) entry.activityDate = r.activityDate;
    if (r.activityUG) entry.activityUG = r.activityUG;
    // Role-specific counts
    switch (r.targetRole) {
      case 'UserGroupLeader':
        entry.uglUserIds.add(r.userId);
        break;
      case 'Speaker':
        entry.speakerUserIds.add(r.userId);
        break;
      case 'Volunteer':
        entry.volunteerUserIds.add(r.userId);
        break;
    }
  }

  const result: ActivitySummaryRecord[] = [];
  for (const [activityId, data] of map) {
    result.push({
      activityId,
      activityTopic: data.activityTopic,
      activityDate: data.activityDate,
      activityUG: data.activityUG,
      totalPoints: data.totalPoints,
      participantCount: data.userIds.size,
      uglCount: data.uglUserIds.size,
      speakerCount: data.speakerUserIds.size,
      volunteerCount: data.volunteerUserIds.size,
    });
  }
  return result;
}

// ============================================================
// DynamoDB query helpers
// ============================================================

/**
 * Query all records from type-createdAt-index GSI for a given type and date range.
 * Handles DynamoDB pagination internally, returning all matching records.
 * Optional FilterExpression for additional filtering.
 */
async function queryByTypeAndDateRange(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  type: 'earn' | 'spend',
  startDate: string,
  endDate: string,
  filterExpressions?: string[],
  expressionAttributeValues?: Record<string, unknown>,
  expressionAttributeNames?: Record<string, string>,
  options?: { limit?: number; exclusiveStartKey?: Record<string, unknown> },
): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const allItems: Record<string, unknown>[] = [];
  let lastEvaluatedKey = options?.exclusiveStartKey;
  const pageLimit = options?.limit;

  const filterExpr = filterExpressions && filterExpressions.length > 0
    ? filterExpressions.join(' AND ')
    : undefined;

  do {
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
        ...(pageLimit && { Limit: pageLimit }),
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    allItems.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;

    // If we have a page limit for cursor pagination, return after first query
    if (pageLimit) {
      return { items: allItems, lastEvaluatedKey: lastEvaluatedKey as Record<string, unknown> | undefined };
    }
  } while (lastEvaluatedKey);

  return { items: allItems };
}

/**
 * BatchGet user nicknames from Users table.
 * Returns a Map of userId → nickname.
 */
async function batchGetUserNicknames(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const nicknameMap = new Map<string, string>();
  if (userIds.length === 0) return nicknameMap;

  const chunks = chunkArray(userIds, 100);
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
 * BatchGet user nicknames AND roles from Users table.
 * Returns a Map of userId → { nickname, roles }.
 */
async function batchGetUserDetails(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
  userIds: string[],
): Promise<Map<string, { nickname: string; roles: string[]; isEmployee?: boolean }>> {
  const map = new Map<string, { nickname: string; roles: string[]; isEmployee?: boolean }>();
  if (userIds.length === 0) return map;

  const chunks = chunkArray(userIds, 100);
  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname, #r, isEmployee',
            ExpressionAttributeNames: { '#r': 'roles' },
          },
        },
      }),
    );
    const items = result.Responses?.[usersTable] ?? [];
    for (const item of items) {
      map.set(item.userId as string, {
        nickname: (item.nickname as string) ?? '',
        roles: (item.roles as string[]) ?? [],
        isEmployee: item.isEmployee as boolean | undefined,
      });
    }
  }
  return map;
}

/**
 * Query BatchDistributions table to get distributorNickname for given activityIds.
 * Returns a Map of `${activityId}#${targetRole}` → distributorNickname.
 */
async function getDistributorNicknames(
  dynamoClient: DynamoDBDocumentClient,
  batchDistributionsTable: string,
  activityIds: string[],
  dateRange: { startDate: string; endDate: string },
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (activityIds.length === 0) return map;

  // Query BatchDistributions by createdAt-index
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: batchDistributionsTable,
        IndexName: 'createdAt-index',
        KeyConditionExpression: 'pk = :pk AND createdAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': 'ALL',
          ':start': dateRange.startDate,
          ':end': dateRange.endDate,
        },
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
        // Store by activityId#targetRole for precise lookup
        map.set(`${aid}#${role}`, nickname);
        // Also store by activityId alone as fallback
        if (!map.has(aid)) {
          map.set(aid, nickname);
        }
      }
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return map;
}

// ============================================================
// Query functions
// ============================================================

/**
 * Query points detail report.
 * Uses type-createdAt-index GSI: query earn and spend separately when type=all,
 * merge and sort by createdAt desc.
 */
export async function queryPointsDetail(
  filter: PointsDetailFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { pointsRecordsTable: string; usersTable: string; batchDistributionsTable: string },
): Promise<PointsDetailResult> {
  try {
    const { startDate, endDate } = applyDefaultDateRange(filter.startDate, filter.endDate);
    const pageSize = clampPageSize(filter.pageSize, 20);
    const type = filter.type ?? 'all';

    // Build filter expressions
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};
    const expressionAttributeNames: Record<string, string> = {};

    if (filter.ugName) {
      filterExpressions.push('activityUG = :ugName');
      expressionAttributeValues[':ugName'] = filter.ugName;
    }
    if (filter.targetRole && filter.targetRole !== 'all') {
      filterExpressions.push('targetRole = :targetRole');
      expressionAttributeValues[':targetRole'] = filter.targetRole;
    }
    if (filter.activityId) {
      filterExpressions.push('activityId = :activityId');
      expressionAttributeValues[':activityId'] = filter.activityId;
    }

    // Decode pagination cursor
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (filter.lastKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(filter.lastKey, 'base64').toString('utf-8'));
      } catch {
        return { success: false, error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' } };
      }
    }

    let allRecords: Record<string, unknown>[] = [];
    let nextLastKey: Record<string, unknown> | undefined;

    if (type === 'all') {
      // For type=all, decode separate cursors for earn and spend
      let earnStartKey: Record<string, unknown> | undefined;
      let spendStartKey: Record<string, unknown> | undefined;
      if (exclusiveStartKey) {
        earnStartKey = (exclusiveStartKey as any).earnKey;
        spendStartKey = (exclusiveStartKey as any).spendKey;
      }

      // Query earn and spend separately, merge and sort
      const [earnResult, spendResult] = await Promise.all([
        earnStartKey !== null ? queryByTypeAndDateRange(
          dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
          filterExpressions.length > 0 ? filterExpressions : undefined,
          Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
          Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
          { limit: pageSize, exclusiveStartKey: earnStartKey },
        ) : Promise.resolve({ items: [] as Record<string, unknown>[], lastEvaluatedKey: undefined }),
        spendStartKey !== null ? queryByTypeAndDateRange(
          dynamoClient, tables.pointsRecordsTable, 'spend', startDate, endDate,
          filterExpressions.length > 0 ? filterExpressions : undefined,
          Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
          Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
          { limit: pageSize, exclusiveStartKey: spendStartKey },
        ) : Promise.resolve({ items: [] as Record<string, unknown>[], lastEvaluatedKey: undefined }),
      ]);

      // Merge and sort by createdAt desc
      const merged = [...earnResult.items, ...spendResult.items]
        .sort((a, b) => {
          const aDate = a.createdAt as string;
          const bDate = b.createdAt as string;
          return bDate.localeCompare(aDate);
        });
      allRecords = merged.slice(0, pageSize);

      // Build separate cursors for earn and spend based on which records were consumed
      const hasMore = merged.length > pageSize || earnResult.lastEvaluatedKey || spendResult.lastEvaluatedKey;
      if (allRecords.length === pageSize && hasMore) {
        // Find the last consumed earn and spend records to build per-type cursors
        const consumedEarn = allRecords.filter(r => r.type === 'earn');
        const consumedSpend = allRecords.filter(r => r.type === 'spend');

        // For earn: if we consumed all fetched earn items and there's more, use DynamoDB's key;
        // otherwise use the last consumed earn record as cursor
        let nextEarnKey: Record<string, unknown> | null | undefined;
        if (consumedEarn.length < earnResult.items.length) {
          // Not all earn items were consumed — use the last consumed earn record as cursor
          const lastEarn = consumedEarn[consumedEarn.length - 1];
          if (lastEarn) {
            nextEarnKey = { type: 'earn', createdAt: lastEarn.createdAt as string, recordId: lastEarn.recordId as string };
          }
        } else if (earnResult.lastEvaluatedKey) {
          nextEarnKey = earnResult.lastEvaluatedKey;
        } else if (consumedEarn.length > 0) {
          // All earn items consumed and no more pages — mark earn as exhausted
          nextEarnKey = null;
        }

        let nextSpendKey: Record<string, unknown> | null | undefined;
        if (consumedSpend.length < spendResult.items.length) {
          const lastSpend = consumedSpend[consumedSpend.length - 1];
          if (lastSpend) {
            nextSpendKey = { type: 'spend', createdAt: lastSpend.createdAt as string, recordId: lastSpend.recordId as string };
          }
        } else if (spendResult.lastEvaluatedKey) {
          nextSpendKey = spendResult.lastEvaluatedKey;
        } else if (consumedSpend.length > 0) {
          nextSpendKey = null;
        }

        // Only set nextLastKey if at least one type has more data
        if (nextEarnKey !== undefined || nextSpendKey !== undefined) {
          nextLastKey = {
            earnKey: nextEarnKey ?? null,
            spendKey: nextSpendKey ?? null,
          };
        }
      }
    } else {
      // Query single type
      const result = await queryByTypeAndDateRange(
        dynamoClient, tables.pointsRecordsTable, type, startDate, endDate,
        filterExpressions.length > 0 ? filterExpressions : undefined,
        Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
        Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        { limit: pageSize, exclusiveStartKey },
      );
      allRecords = result.items;
      nextLastKey = result.lastEvaluatedKey;
    }

    // BatchGet user details (nickname + isEmployee)
    const uniqueUserIds = [...new Set(allRecords.map(r => r.userId as string))];
    const userDetailsMap = await batchGetUserDetails(dynamoClient, tables.usersTable, uniqueUserIds);

    // Get distributor nicknames
    const uniqueActivityIds = [...new Set(allRecords.map(r => r.activityId as string).filter(Boolean))];
    const distributorMap = await getDistributorNicknames(
      dynamoClient, tables.batchDistributionsTable, uniqueActivityIds, { startDate, endDate },
    );

    // Map to PointsDetailRecord
    const records: PointsDetailRecord[] = allRecords.map(r => {
      const activityId = (r.activityId as string) ?? '';
      const targetRole = (r.targetRole as string) ?? '';
      const userInfo = userDetailsMap.get(r.userId as string);
      return {
        recordId: (r.recordId as string) ?? '',
        createdAt: (r.createdAt as string) ?? '',
        userId: (r.userId as string) ?? '',
        nickname: userInfo?.nickname ?? '',
        amount: (r.amount as number) ?? 0,
        type: (r.type as 'earn' | 'spend') ?? 'earn',
        source: (r.source as string) ?? '',
        activityUG: (r.activityUG as string) ?? '',
        activityTopic: (r.activityTopic as string) ?? '',
        activityId,
        targetRole,
        distributorNickname: distributorMap.get(`${activityId}#${targetRole}`) ?? distributorMap.get(activityId) ?? '',
        isEmployee: userInfo?.isEmployee ?? false,
      };
    });

    // Encode lastKey
    let lastKeyStr: string | undefined;
    if (nextLastKey) {
      lastKeyStr = Buffer.from(JSON.stringify(nextLastKey)).toString('base64');
    }

    return { success: true, records, lastKey: lastKeyStr };
  } catch (err) {
    console.error('queryPointsDetail error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * Query UG activity summary report.
 * Queries type='earn' records and aggregates in-memory by activityUG.
 */
export async function queryUGActivitySummary(
  filter: UGActivityFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { pointsRecordsTable: string },
): Promise<UGActivitySummaryResult> {
  try {
    const { startDate, endDate } = applyDefaultDateRange(filter.startDate, filter.endDate);

    // Query all earn records in date range (no page limit — full scan for aggregation)
    const { items } = await queryByTypeAndDateRange(
      dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
    );

    // Aggregate by UG using pure function
    const rawRecords = items as unknown as RawPointsRecord[];
    const aggregated = aggregateByUG(rawRecords);

    // Sort by totalPoints descending
    const sorted = sortRecords(aggregated, 'totalPoints', 'desc');

    return { success: true, records: sorted };
  } catch (err) {
    console.error('queryUGActivitySummary error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * Query user points ranking report.
 * Queries type='earn' records, aggregates by userId, sorts by totalEarnPoints desc,
 * assigns sequential rank, and applies in-memory offset-based pagination.
 */
export async function queryUserPointsRanking(
  filter: UserRankingFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { pointsRecordsTable: string; usersTable: string },
): Promise<UserRankingResult> {
  try {
    const { startDate, endDate } = applyDefaultDateRange(filter.startDate, filter.endDate);
    const pageSize = clampPageSize(filter.pageSize, 50);

    // Build optional filter for targetRole
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};

    if (filter.targetRole && filter.targetRole !== 'all') {
      filterExpressions.push('targetRole = :targetRole');
      expressionAttributeValues[':targetRole'] = filter.targetRole;
    }

    // Query all earn records in date range (full scan for aggregation)
    const { items } = await queryByTypeAndDateRange(
      dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
      filterExpressions.length > 0 ? filterExpressions : undefined,
      Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
    );

    // Aggregate by user using pure function
    const rawRecords = items as unknown as RawPointsRecord[];
    const aggregated = aggregateByUser(rawRecords);

    // Sort by totalEarnPoints descending
    const sorted = aggregated.sort((a, b) => b.totalEarnPoints - a.totalEarnPoints);

    // Determine offset from lastKey (base64 encoded offset number)
    let offset = 0;
    if (filter.lastKey) {
      try {
        offset = parseInt(Buffer.from(filter.lastKey, 'base64').toString('utf-8'), 10);
        if (isNaN(offset) || offset < 0) offset = 0;
      } catch {
        return { success: false, error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' } };
      }
    }

    // Apply pagination
    const page = sorted.slice(offset, offset + pageSize);

    // BatchGet user details (nickname + roles)
    const uniqueUserIds = page.map(r => r.userId);
    const userDetailsMap = await batchGetUserDetails(dynamoClient, tables.usersTable, uniqueUserIds);

    // Assign rank and build result records
    const isAllRoles = !filter.targetRole || filter.targetRole === 'all';
    const records: UserRankingRecord[] = page.map((r, i) => ({
      rank: offset + i + 1,
      userId: r.userId,
      nickname: userDetailsMap.get(r.userId)?.nickname ?? '',
      totalEarnPoints: r.totalEarnPoints,
      targetRole: isAllRoles
        ? (userDetailsMap.get(r.userId)?.roles?.filter(role => role !== 'Admin' && role !== 'SuperAdmin').join(', ') || r.targetRole)
        : r.targetRole,
      isEmployee: userDetailsMap.get(r.userId)?.isEmployee ?? false,
    }));

    // Encode next offset as lastKey
    let lastKeyStr: string | undefined;
    const nextOffset = offset + pageSize;
    if (nextOffset < sorted.length) {
      lastKeyStr = Buffer.from(String(nextOffset)).toString('base64');
    }

    return { success: true, records, lastKey: lastKeyStr };
  } catch (err) {
    console.error('queryUserPointsRanking error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * Query activity points summary report.
 * Queries type='earn' records, aggregates by activityId, sorts by activityDate desc.
 */
export async function queryActivityPointsSummary(
  filter: ActivitySummaryFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: { pointsRecordsTable: string },
): Promise<ActivitySummaryResult> {
  try {
    const { startDate, endDate } = applyDefaultDateRange(filter.startDate, filter.endDate);

    // Build optional filter for activityUG
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {};

    if (filter.ugName) {
      filterExpressions.push('activityUG = :ugName');
      expressionAttributeValues[':ugName'] = filter.ugName;
    }

    // Query all earn records in date range (full scan for aggregation)
    const { items } = await queryByTypeAndDateRange(
      dynamoClient, tables.pointsRecordsTable, 'earn', startDate, endDate,
      filterExpressions.length > 0 ? filterExpressions : undefined,
      Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
    );

    // Aggregate by activity using pure function
    const rawRecords = items as unknown as RawPointsRecord[];
    const aggregated = aggregateByActivity(rawRecords);

    // Sort by activityDate descending
    const sorted = sortRecords(aggregated, 'activityDate', 'desc');

    return { success: true, records: sorted };
  } catch (err) {
    console.error('queryActivityPointsSummary error:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}
