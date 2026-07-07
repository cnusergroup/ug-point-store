// UGL pending-exit list query module — SuperAdmin Pending_Exit_List data source.
// See design.md Components and Interfaces section 7 ("pending-exit-list.ts") for full interface definitions.
//
// This module is self-contained and intentionally does NOT import from
// `../reports/inactive-ugl-query.ts` — the leaderId -> ugName mapping helper is
// reimplemented locally below, mirroring that report's `buildLeaderUGMap` Scan shape
// but as an independent implementation, per design.md's explicit instruction to keep
// this module independent of inactive-ugl-query.ts.

import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

/** A single row of the SuperAdmin-facing Pending_Exit_List (Req 9.1). */
export interface PendingExitRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  triggeredQuarter: string;
  markedAt: string;
}

// ============================================================
// DynamoDB Query Functions
// ============================================================

/**
 * Queries the Users table for all current Pending_Exit_UGL users via the
 * entityType-createdAt-index GSI (PK='user') with a FilterExpression on
 * `uglExitStatus = 'pending_exit'` — same GSI/query shape as `listUsers` in
 * `admin/users.ts`. Paginated — aggregates all pages.
 */
async function queryPendingExitUsers(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<Array<{ userId: string; nickname: string; email: string; triggeredQuarter: string; markedAt: string }>> {
  const results: Array<{
    userId: string;
    nickname: string;
    email: string;
    triggeredQuarter: string;
    markedAt: string;
  }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: usersTable,
        IndexName: 'entityType-createdAt-index',
        KeyConditionExpression: 'entityType = :entityType',
        FilterExpression: 'uglExitStatus = :pendingExit',
        ExpressionAttributeValues: {
          ':entityType': 'user',
          ':pendingExit': 'pending_exit',
        },
        ProjectionExpression: 'userId, nickname, email, uglExitTriggeredQuarter, uglExitMarkedAt',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      results.push({
        userId: item.userId as string,
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
        triggeredQuarter: (item.uglExitTriggeredQuarter as string) ?? '',
        markedAt: (item.uglExitMarkedAt as string) ?? '',
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return results;
}

/**
 * Scan UGs table to build leaderId -> ugName mapping.
 * UGs table is small (< 50 records), so Scan is acceptable.
 *
 * Mirrors the Scan shape of the existing report's `buildLeaderUGMap` internal helper
 * (`packages/backend/src/reports/inactive-ugl-query.ts`) exactly, but is an independent
 * reimplementation — not imported — per design.md's explicit instruction.
 */
async function buildLeaderUGMapForPendingExit(
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
 * Queries all current Pending_Exit_UGL users and enriches each with its UG name
 * (Req 9.1). A user leading no UG gets `ugName: ''`.
 */
export async function queryPendingExitUGLs(
  dynamoClient: DynamoDBDocumentClient,
  tables: { usersTable: string; ugsTable: string },
): Promise<PendingExitRecord[]> {
  const [pendingUsers, leaderUGMap] = await Promise.all([
    queryPendingExitUsers(dynamoClient, tables.usersTable),
    buildLeaderUGMapForPendingExit(dynamoClient, tables.ugsTable),
  ]);

  return pendingUsers.map((user) => ({
    userId: user.userId,
    nickname: user.nickname,
    email: user.email,
    ugName: leaderUGMap.get(user.userId) ?? '',
    triggeredQuarter: user.triggeredQuarter,
    markedAt: user.markedAt,
  }));
}
