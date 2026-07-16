// UGL awaiting-reminder list query module — SuperAdmin Awaiting_Reminder_List data source.
// See design.md Components and Interfaces section 6 ("awaiting-reminder-list.ts") for full
// interface definitions.
//
// This module is self-contained and intentionally does NOT import from
// `../reports/inactive-ugl-query.ts` — the leaderId -> ugName mapping helper is
// reimplemented locally below, mirroring `pending-exit-list.ts`'s
// `buildLeaderUGMapForPendingExit` Scan shape but as an independent implementation, per
// design.md's Overview stating each module reimplements this pattern independently.

import { DynamoDBDocumentClient, BatchGetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { queryAwaitingReminderRecords } from './reminder-tracking';

// ============================================================
// Interfaces
// ============================================================

/** A single row of the SuperAdmin-facing Awaiting_Reminder_List (Req 5.1). */
export interface AwaitingReminderRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  quarter: string;
  recordedAt: string;
}

// ============================================================
// DynamoDB Query Functions
// ============================================================

/**
 * Batch-loads nickname/email for the given userIds from the Users table.
 * BatchGetCommand supports up to 100 keys per request, so requests are chunked.
 * Same batching pattern as other admin list endpoints (e.g. `leaderboard/announcements.ts`).
 */
async function batchLoadUsers(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
  userIds: string[],
): Promise<Map<string, { nickname: string; email: string }>> {
  const map = new Map<string, { nickname: string; email: string }>();
  if (userIds.length === 0) {
    return map;
  }

  const chunks = chunkArray(userIds, 100);
  for (const chunk of chunks) {
    const result = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: chunk.map((userId) => ({ userId })),
            ProjectionExpression: 'userId, nickname, email',
          },
        },
      }),
    );

    const items = result.Responses?.[usersTable] ?? [];
    for (const item of items) {
      map.set(item.userId as string, {
        nickname: (item.nickname as string) ?? '',
        email: (item.email as string) ?? '',
      });
    }
  }

  return map;
}

/**
 * Scan UGs table to build leaderId -> ugName mapping.
 * UGs table is small (< 50 records), so Scan is acceptable.
 *
 * Mirrors the Scan shape of `pending-exit-list.ts`'s `buildLeaderUGMapForPendingExit`
 * (which itself mirrors the existing report's `buildLeaderUGMap` internal helper) exactly,
 * but is an independent local reimplementation — not imported — per design.md's stated
 * design boundary keeping each module independent.
 */
async function buildLeaderUGMapForAwaitingReminder(
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
 * Queries all current Awaiting_Reminder_UGL tracking records (reminder-tracking.ts's
 * `queryAwaitingReminderRecords`), then joins against the Users table (batch-loaded
 * nickname/email) and the UGs table (leaderId -> ugName map) to produce the
 * SuperAdmin-facing Awaiting_Reminder_List (Req 5.1). A user leading no UG gets
 * `ugName: ''`; a user record that is somehow missing defaults nickname/email to ''.
 */
export async function queryAwaitingReminderUGLs(
  dynamoClient: DynamoDBDocumentClient,
  tables: { trackingTable: string; usersTable: string; ugsTable: string },
): Promise<AwaitingReminderRecord[]> {
  const trackingRecords = await queryAwaitingReminderRecords(dynamoClient, tables.trackingTable);

  if (trackingRecords.length === 0) {
    return [];
  }

  const userIds = [...new Set(trackingRecords.map((r) => r.userId))];

  const [userMap, leaderUGMap] = await Promise.all([
    batchLoadUsers(dynamoClient, tables.usersTable, userIds),
    buildLeaderUGMapForAwaitingReminder(dynamoClient, tables.ugsTable),
  ]);

  return trackingRecords.map((record) => {
    const user = userMap.get(record.userId);
    return {
      userId: record.userId,
      nickname: user?.nickname ?? '',
      email: user?.email ?? '',
      ugName: leaderUGMap.get(record.userId) ?? '',
      quarter: record.quarter,
      recordedAt: record.createdAt,
    };
  });
}

// ============================================================
// Utility
// ============================================================

/** Split an array into chunks of the given size (BatchGet limit is 100 keys per table). */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
