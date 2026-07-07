// UGL reminder tracking module — the per-user-per-quarter idempotency backbone.
// See design.md Components and Interfaces section 3 ("reminder-tracking.ts") and
// Data Models ("New Table: PointsMall-UGLReminderTracking") for full interface definitions.
//
// Both the quarterly detection job and the daily grace-period evaluation job read/write
// the SAME tracking record for a (userId, quarter) pair:
// - claimReminderSlot uses a conditional PutCommand (attribute_not_exists) as the dedup
//   mechanism for "has this user already been reminded this quarter?" (Req 4.5, 12.1) and
//   to timestamp the start of the Grace_Period (Req 4.4).
// - transitionOutcome uses a conditional UpdateCommand (outcome = :pending) as the
//   idempotency mechanism guaranteeing at most one Exit_Notification per user per
//   quarter (Req 12.3).

import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

export type ReminderOutcome = 'pending' | 'remedied' | 'exited';

export interface ReminderTrackingRecord {
  userId: string;
  quarter: string;
  reminderSentAt: string; // ISO — start of Grace_Period (Req 4.4)
  gracePeriodDeadline: string; // ISO — reminderSentAt + 30 days
  outcome: ReminderOutcome;
  consumedRecordId?: string; // set when outcome transitions to 'remedied'
  createdAt: string;
  updatedAt: string;
}

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================
// Pure Functions
// ============================================================

/**
 * Pure: computes the Grace_Period_Deadline as exactly `sentAt + 30*24h` (Req 4.4).
 */
export function computeGracePeriodDeadline(sentAt: string): string {
  return new Date(new Date(sentAt).getTime() + GRACE_PERIOD_MS).toISOString();
}

// ============================================================
// DynamoDB Functions
// ============================================================

/**
 * Atomically creates the tracking record for (userId, quarter) using
 * ConditionExpression attribute_not_exists(userId). Returns claimed=false
 * (no write) when a record already exists — this IS the dedup mechanism
 * for Req 4.5 / 12.1.
 */
export async function claimReminderSlot(
  userId: string,
  quarter: string,
  now: string,
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<{ claimed: boolean; record?: ReminderTrackingRecord }> {
  const gracePeriodDeadline = computeGracePeriodDeadline(now);
  const record: ReminderTrackingRecord = {
    userId,
    quarter,
    reminderSentAt: now,
    gracePeriodDeadline,
    outcome: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: trackingTable,
        Item: record,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
    return { claimed: true, record };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    return { claimed: false };
  }
}

/**
 * Queries tracking records with outcome='pending' AND gracePeriodDeadline <= now,
 * via the outcome-gracePeriodDeadline-index GSI. Paginated.
 */
export async function queryDueReminderRecords(
  now: string,
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<ReminderTrackingRecord[]> {
  const records: ReminderTrackingRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: trackingTable,
        IndexName: 'outcome-gracePeriodDeadline-index',
        KeyConditionExpression: '#outcome = :pending AND gracePeriodDeadline <= :now',
        ExpressionAttributeNames: {
          '#outcome': 'outcome',
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':now': now,
        },
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      records.push(item as ReminderTrackingRecord);
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}

/**
 * Atomically transitions outcome 'pending' -> target ('remedied' | 'exited') using
 * ConditionExpression outcome = :pending. Returns transitioned=false when the
 * condition fails (already transitioned by a prior/concurrent run) — this IS the
 * idempotency mechanism for Req 12.3.
 */
export async function transitionOutcome(
  userId: string,
  quarter: string,
  target: 'remedied' | 'exited',
  extra: { consumedRecordId?: string },
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<{ transitioned: boolean }> {
  const now = new Date().toISOString();

  const expressionAttributeNames: Record<string, string> = {
    '#outcome': 'outcome',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':pending': 'pending',
    ':target': target,
    ':updatedAt': now,
  };

  let updateExpression = 'SET #outcome = :target, #updatedAt = :updatedAt';
  if (extra.consumedRecordId !== undefined) {
    expressionAttributeNames['#consumedRecordId'] = 'consumedRecordId';
    expressionAttributeValues[':consumedRecordId'] = extra.consumedRecordId;
    updateExpression += ', #consumedRecordId = :consumedRecordId';
  }

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: trackingTable,
        Key: { userId, quarter },
        UpdateExpression: updateExpression,
        ConditionExpression: '#outcome = :pending',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );
    return { transitioned: true };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    return { transitioned: false };
  }
}
