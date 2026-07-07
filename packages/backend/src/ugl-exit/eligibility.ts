// UGL exit eligibility & inactivity determination module — pure functions + DynamoDB queries.
// See design.md Components and Interfaces section 2 ("eligibility.ts") for full interface definitions.
//
// This module is self-contained and intentionally does NOT import from
// `../reports/inactive-ugl-query.ts` — this feature's Qualifying_Points_Record criterion
// (targetRole === 'UserGroupLeader' only) is narrower than that report's (UGL OR SpecialActivity),
// per requirements.md Assumption 1. The two query functions below mirror that report's
// pagination shape and widened-createdAt-range pattern, but are independent implementations.

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

/** User record shape used by Eligible_UGL filtering (Req 2.1, 2.2). */
export interface ExitEligibleUser {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
  status: string;
  createdAt: string;
  uglExitStatus?: 'pending_exit';
}

/** Qualifying_Points_Record shape used by activity/makeup-record determination (Req 3.1, 3.2, 3.3). */
export interface ExitQualifyingRecord {
  recordId: string;
  userId: string;
  targetRole?: string;
  activityDate?: string;
  createdAt: string;
  consumedForQuarter?: string;
}

// ============================================================
// Pure Functions
// ============================================================

/** Extracts a record's effective activity date: activityDate if present, else createdAt's date part (YYYY-MM-DD). */
function effectiveActivityDate(record: { createdAt?: string; activityDate?: string }): string | null {
  if (record.activityDate && record.activityDate.trim()) return record.activityDate.trim();
  if (record.createdAt && record.createdAt.length >= 10) return record.createdAt.substring(0, 10);
  return null;
}

/**
 * Eligible_UGL filter (Req 2.1, 2.2, 7.1):
 * roles contains 'UserGroupLeader' AND status === 'active' AND createdAt < quarterStart
 * AND uglExitStatus !== 'pending_exit' (snapshot at call time — a later status change is
 * not retroactively applied to this computation).
 */
export function filterEligibleUGLsForExit(
  users: ExitEligibleUser[],
  quarterStart: string,
): ExitEligibleUser[] {
  return users.filter(
    (user) =>
      user.roles.includes('UserGroupLeader') &&
      user.status === 'active' &&
      user.createdAt < quarterStart &&
      user.uglExitStatus !== 'pending_exit',
  );
}

/**
 * Extracts the set of userIds with >=1 qualifying record in the quarter window.
 *
 * A record counts only when:
 * - targetRole === 'UserGroupLeader' (Assumption 1 — narrower than the existing report's
 *   UGL+SpecialActivity criterion), AND
 * - consumedForQuarter is unset (Req 3.3), AND
 * - its effective date (activityDate, falling back to createdAt's date part — Assumption 2)
 *   falls within [quarterStart, quarterEnd] (compared as date-only YYYY-MM-DD strings, since
 *   quarterStart/quarterEnd are full ISO 8601 timestamps and activityDate is date-only).
 */
export function extractActiveUserIdsForQuarter(
  records: ExitQualifyingRecord[],
  quarterStart: string,
  quarterEnd: string,
): Set<string> {
  const activeIds = new Set<string>();
  const windowStart = quarterStart.substring(0, 10);
  const windowEnd = quarterEnd.substring(0, 10);

  for (const record of records) {
    if (record.targetRole !== 'UserGroupLeader') continue;
    if (record.consumedForQuarter) continue;

    const eff = effectiveActivityDate(record);
    if (eff === null) continue;
    if (eff >= windowStart && eff <= windowEnd) {
      activeIds.add(record.userId);
    }
  }

  return activeIds;
}

/**
 * Fully_Inactive_UGL determination (Req 3.1, 3.2): set difference of eligible users
 * minus users with at least one qualifying active record in the quarter window.
 */
export function computeFullyInactiveUGLs(
  eligibleUsers: ExitEligibleUser[],
  activeUserIds: Set<string>,
): ExitEligibleUser[] {
  return eligibleUsers.filter((user) => !activeUserIds.has(user.userId));
}

// ============================================================
// DynamoDB Query Functions
// ============================================================

/**
 * Queries the Users table for all users with the UGL role, via the
 * entityType-createdAt-index GSI (PK='user') with a FilterExpression on
 * `roles contains 'UserGroupLeader'`. Paginated — aggregates all pages.
 *
 * Mirrors the pagination/query shape of the existing report's `queryAllUGLUsers`
 * internal helper, but is an independent implementation (not imported).
 */
export async function queryAllUGLUsersForExit(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<ExitEligibleUser[]> {
  const users: ExitEligibleUser[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: 'entityType-createdAt-index',
        KeyConditionExpression: 'entityType = :entityType',
        FilterExpression: 'contains(#roles, :ugl)',
        ExpressionAttributeNames: {
          '#roles': 'roles',
        },
        ExpressionAttributeValues: {
          ':entityType': 'user',
          ':ugl': 'UserGroupLeader',
        },
        ProjectionExpression: 'userId, nickname, email, #roles, #status, createdAt, uglExitStatus',
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
        ...(item.uglExitStatus === 'pending_exit' && { uglExitStatus: 'pending_exit' as const }),
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return users;
}

/**
 * Queries PointsRecords in a createdAt window widened around [quarterStart, quarterEnd]
 * (60 days before / 30 days after) via the type-createdAt-index GSI (PK='earn'), filtered
 * to `targetRole = 'UserGroupLeader'` (narrower than the existing report's UGL-or-SpecialActivity
 * filter, per Assumption 1). Paginated — aggregates all pages.
 *
 * The DB-side range only needs to be wide enough to not miss any record whose effective date
 * (activityDate, falling back to createdAt) could fall within [quarterStart, quarterEnd] —
 * the precise date-window filtering happens client-side in `extractActiveUserIdsForQuarter`.
 * Unlike the existing report's query, this does NOT need an activityDate FilterExpression
 * component, since that client-side filtering already handles it.
 *
 * Mirrors the pagination/widened-range shape of the existing report's `queryQuarterEarnRecords`
 * internal helper, but is an independent implementation (not imported).
 */
export async function queryQuarterQualifyingRecords(
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  quarterStart: string,
  quarterEnd: string,
): Promise<ExitQualifyingRecord[]> {
  const records: ExitQualifyingRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Widen the createdAt range to capture records created before/after the activity date
  // (e.g., activity in March but points distributed in April) — mirrors the existing report's pattern.
  const createdAtStart = new Date(new Date(quarterStart).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const createdAtEnd = new Date(new Date(quarterEnd).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'type-createdAt-index',
        KeyConditionExpression: '#type = :type AND createdAt BETWEEN :start AND :end',
        FilterExpression: 'targetRole = :ugl',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'earn',
          ':start': createdAtStart,
          ':end': createdAtEnd,
          ':ugl': 'UserGroupLeader',
        },
        ProjectionExpression: 'recordId, userId, targetRole, activityDate, createdAt, consumedForQuarter',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      records.push({
        recordId: item.recordId as string,
        userId: item.userId as string,
        targetRole: item.targetRole as string | undefined,
        activityDate: item.activityDate as string | undefined,
        createdAt: (item.createdAt as string) ?? '',
        consumedForQuarter: item.consumedForQuarter as string | undefined,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}
