// Inactive UGL query module - pure functions and DynamoDB query for computing inactive User Group Leaders
// See design.md Components section 2 and 3 for full interface definitions

import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { parseQuarter, getCurrentQuarter, quarterToDateRange } from './quarter-utils';

// ============================================================
// Interfaces
// ============================================================

/** 用户记录（从 Users 表查询后的精简结构） */
export interface EligibleUser {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
  status: string;
  createdAt: string;
}

/** Inactive UGL 记录（已关联 UG 名称和最后活跃日期） */
export interface InactiveUGLRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  createdAt: string;
  lastActiveDate: string | null;
}

/** Inactive UGL 查询筛选条件 */
export interface InactiveUGLFilter {
  quarter?: string;
}

/** Inactive UGL 查询结果 */
export interface InactiveUGLResult {
  success: boolean;
  records?: InactiveUGLRecord[];
  quarter?: string;
  totalCount?: number;
  error?: { code: string; message: string };
}

// ============================================================
// Pure Functions
// ============================================================

/**
 * 从用户列表中筛选 eligible UGLs：
 * - roles 包含 'UserGroupLeader'
 * - status === 'active'
 * - createdAt < quarterStart
 */
export function filterEligibleUGLs(
  users: EligibleUser[],
  _quarterStart: string,
): EligibleUser[] {
  return users.filter(
    (user) =>
      user.roles.includes('UserGroupLeader') &&
      user.status === 'active',
  );
}

/**
 * 从 PointsRecords 中提取 active userId 集合：
 * - 仅保留 targetRole 为 'UserGroupLeader' 或 'SpecialActivity' 的记录
 * - 返回去重的 userId Set
 */
export function extractActiveUserIds(
  records: Array<{ userId: string; targetRole?: string }>,
): Set<string> {
  const activeIds = new Set<string>();
  for (const record of records) {
    if (
      record.targetRole === 'UserGroupLeader' ||
      record.targetRole === 'SpecialActivity'
    ) {
      activeIds.add(record.userId);
    }
  }
  return activeIds;
}

/**
 * 计算 inactive UGL 列表 = eligible - active。
 */
export function computeInactiveUGLs(
  eligibleUsers: EligibleUser[],
  activeUserIds: Set<string>,
): EligibleUser[] {
  return eligibleUsers.filter((user) => !activeUserIds.has(user.userId));
}

/**
 * 从 qualifying records 中找到指定用户的最近一条记录的 createdAt。
 * 仅考虑 targetRole 为 'UserGroupLeader' 或 'SpecialActivity' 的记录。
 * 如果没有匹配记录，返回 null。
 */
export function findLastActiveDate(
  userId: string,
  records: Array<{ userId: string; createdAt: string; targetRole?: string }>,
): string | null {
  let maxDate: string | null = null;

  for (const record of records) {
    if (
      record.userId === userId &&
      (record.targetRole === 'UserGroupLeader' ||
        record.targetRole === 'SpecialActivity')
    ) {
      if (maxDate === null || record.createdAt > maxDate) {
        maxDate = record.createdAt;
      }
    }
  }

  return maxDate;
}

// ============================================================
// DynamoDB Query Function
// ============================================================

/**
 * 查询指定季度的不活跃 UGL 列表。
 *
 * 步骤：
 * 1. 解析并验证 quarter 参数（缺省为当前季度）
 * 2. 查询所有 active UGL 用户（entityType-createdAt-index + filter）
 * 3. 过滤掉 createdAt >= quarterStart 的用户
 * 4. 查询季度内 earn 记录（type-createdAt-index + targetRole filter）
 * 5. 计算 inactive 集合 = eligible - active
 * 6. Scan UGs 表获取 leaderId → ugName 映射
 * 7. 为每个 inactive UGL 查询 lastActiveDate
 * 8. 返回结果
 */
export async function queryInactiveUGLs(
  filter: InactiveUGLFilter,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    usersTable: string;
    pointsRecordsTable: string;
    ugsTable: string;
  },
): Promise<InactiveUGLResult> {
  try {
    // Step 1: Parse and validate quarter
    const quarterStr = filter.quarter || getCurrentQuarter();
    const parsed = parseQuarter(quarterStr);
    if (!parsed.valid) {
      return { success: false, error: parsed.error };
    }
    const { year, quarter } = parsed;
    const resolvedQuarter = `${year}-Q${quarter}`;
    const { start: quarterStart, end: quarterEnd } = quarterToDateRange(year, quarter);

    // Step 2: Query Users table — all active UGL users
    const users = await queryAllUGLUsers(dynamoClient, tables.usersTable);

    // Step 3: Filter eligible UGLs (createdAt < quarterStart)
    const eligibleUsers = filterEligibleUGLs(users, quarterStart);

    // Step 4: Query PointsRecords — earn records in quarter with targetRole filter
    const earnRecords = await queryQuarterEarnRecords(
      dynamoClient,
      tables.pointsRecordsTable,
      quarterStart,
      quarterEnd,
    );

    // Step 5: Compute inactive set
    const activeUserIds = extractActiveUserIds(earnRecords);
    const inactiveUsers = computeInactiveUGLs(eligibleUsers, activeUserIds);

    // Step 6: Scan UGs table to build leaderId → ugName mapping
    const leaderUGMap = await buildLeaderUGMap(dynamoClient, tables.ugsTable);

    // Step 7: For each inactive UGL, query lastActiveDate
    const records: InactiveUGLRecord[] = [];
    for (const user of inactiveUsers) {
      const lastActiveDate = await queryLastActiveDate(
        dynamoClient,
        tables.pointsRecordsTable,
        user.userId,
      );
      records.push({
        userId: user.userId,
        nickname: user.nickname,
        email: user.email,
        ugName: leaderUGMap.get(user.userId) ?? '',
        createdAt: user.createdAt,
        lastActiveDate,
      });
    }

    // Step 8: Return result
    return {
      success: true,
      records,
      quarter: resolvedQuarter,
      totalCount: records.length,
    };
  } catch (err) {
    console.error('queryInactiveUGLs error:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

// ============================================================
// Internal DynamoDB helpers
// ============================================================

/**
 * Query all users with UGL role and active status from Users table.
 * Uses entityType-createdAt-index GSI (PK='user') with FilterExpression.
 * Paginates through all results.
 */
async function queryAllUGLUsers(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<EligibleUser[]> {
  const users: EligibleUser[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: 'entityType-createdAt-index',
        KeyConditionExpression: 'entityType = :entityType',
        FilterExpression: 'contains(#roles, :ugl) AND #status = :active',
        ExpressionAttributeNames: {
          '#roles': 'roles',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':entityType': 'user',
          ':ugl': 'UserGroupLeader',
          ':active': 'active',
        },
        ProjectionExpression: 'userId, nickname, email, #roles, #status, createdAt',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      users.push({
        userId: item.userId as string,
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
        roles: (item.roles as string[]) ?? [],
        status: (item.status as string) ?? '',
        createdAt: (item.createdAt as string) ?? '',
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return users;
}

/**
 * Query earn records whose activityDate falls within the quarter, with targetRole = UGL or SpecialActivity.
 * Uses type-createdAt-index GSI (PK='earn') — we cannot filter by activityDate in the key condition,
 * so we use a broad createdAt range (quarter start - 60 days to quarter end + 30 days) to capture
 * records that may have been created before/after the activity date, then filter by activityDate
 * in the FilterExpression on the DynamoDB side.
 * Paginates through all results.
 */
async function queryQuarterEarnRecords(
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  quarterStart: string,
  quarterEnd: string,
): Promise<Array<{ userId: string; targetRole?: string }>> {
  const records: Array<{ userId: string; targetRole?: string }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Widen the createdAt range to capture records created before/after the activity date
  // (e.g., activity in March but points distributed in April)
  const createdAtStart = new Date(new Date(quarterStart).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const createdAtEnd = new Date(new Date(quarterEnd).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // activityDate is stored as YYYY-MM-DD; extract date-only boundaries for comparison
  const activityDateStart = quarterStart.substring(0, 10); // "YYYY-MM-DD"
  const activityDateEnd = quarterEnd.substring(0, 10);     // "YYYY-MM-DD"

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'type-createdAt-index',
        KeyConditionExpression: '#type = :type AND createdAt BETWEEN :start AND :end',
        FilterExpression: 'targetRole IN (:ugl, :sa) AND activityDate BETWEEN :adStart AND :adEnd',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'earn',
          ':start': createdAtStart,
          ':end': createdAtEnd,
          ':ugl': 'UserGroupLeader',
          ':sa': 'SpecialActivity',
          ':adStart': activityDateStart,
          ':adEnd': activityDateEnd,
        },
        ProjectionExpression: 'userId, targetRole',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      records.push({
        userId: item.userId as string,
        targetRole: item.targetRole as string | undefined,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}

/**
 * Scan UGs table to build leaderId → ugName mapping.
 * UGs table is small (< 50 records), so Scan is acceptable.
 */
async function buildLeaderUGMap(
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: ugsTable,
        ProjectionExpression: 'leaderId, #name',
        ExpressionAttributeNames: { '#name': 'name' },
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      const leaderId = item.leaderId as string | undefined;
      const ugName = item.name as string | undefined;
      if (leaderId && ugName) {
        map.set(leaderId, ugName);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return map;
}

/**
 * Query the most recent qualifying PointsRecord for a user.
 * Uses userId-createdAt-index GSI (PK=userId, ScanIndexForward=false, Limit=10)
 * with FilterExpression for targetRole IN (UGL, SpecialActivity).
 * Returns the createdAt of the first matching record, or null if none found.
 */
async function queryLastActiveDate(
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  userId: string,
): Promise<string | null> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Query in reverse chronological order with a small page size.
  // Since FilterExpression is applied after Limit, we may need multiple pages
  // to find a matching record. Limit attempts to avoid infinite loops.
  const MAX_PAGES = 5;
  let pages = 0;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: 'targetRole IN (:ugl, :sa)',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':ugl': 'UserGroupLeader',
          ':sa': 'SpecialActivity',
        },
        ScanIndexForward: false,
        Limit: 10,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    const items = result.Items ?? [];
    if (items.length > 0) {
      // Items are sorted by createdAt desc (ScanIndexForward=false),
      // so the first matching item is the most recent.
      return items[0].createdAt as string;
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    pages++;
  } while (lastEvaluatedKey && pages < MAX_PAGES);

  return null;
}
