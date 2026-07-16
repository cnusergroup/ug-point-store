// UGL reminder tracking module — the per-user-per-quarter idempotency backbone.
// See design.md Components and Interfaces section 3 ("reminder-tracking.ts") and
// Data Models ("New Table: PointsMall-UGLReminderTracking") for full interface definitions.
//
// The tracking record for a (userId, quarter) pair is a 4-state machine:
//   'awaiting_reminder' -> 'pending' -> ('remedied' | 'exited')
//
// - recordAwaitingReminder uses a conditional PutCommand (attribute_not_exists) as the dedup
//   mechanism for "has this user already been recorded this quarter?" (Req 4.3, 15.1). It does
//   NOT set reminderSentAt/gracePeriodDeadline and never sends an email — those are set only by
//   a subsequent SuperAdmin-initiated Send_Reminder_Action.
// - claimAndStartGracePeriod uses a conditional UpdateCommand (outcome = :awaitingReminder) as
//   the atomic claim for the Send_Reminder_Action — this is what makes a duplicate/retried call
//   idempotent (Req 15.4) and is the only place that computes gracePeriodDeadline for a real send
//   (Req 5.3).
// - revertToAwaitingReminder is the compensating action when a claimed send's email delivery
//   fails, restoring the pre-claim state so the entry reappears in the Awaiting_Reminder_List
//   with no Grace_Period started (Req 5.8).
// - transitionOutcome uses a conditional UpdateCommand (outcome = :pending) as the
//   idempotency mechanism guaranteeing at most one Exit_Notification per user per
//   quarter (Req 15.3).

import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

export type ReminderOutcome = 'awaiting_reminder' | 'pending' | 'remedied' | 'exited';

export interface ReminderTrackingRecord {
  userId: string;
  quarter: string;
  outcome: ReminderOutcome;
  reminderSentAt?: string; // ISO — absent while outcome='awaiting_reminder'; set at Send_Reminder_Action time (Req 5.3)
  gracePeriodDeadline?: string; // ISO — reminderSentAt + 30 days; absent while outcome='awaiting_reminder'
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
 * Atomically creates the tracking record for (userId, quarter) in outcome='awaiting_reminder',
 * using ConditionExpression attribute_not_exists(userId). Does NOT set reminderSentAt/
 * gracePeriodDeadline and does not send any email. Returns recorded=false (no write) when a
 * record already exists for this (userId, quarter) in ANY outcome state — this IS the dedup
 * mechanism for Req 4.3, 15.1. Called only from the detection job.
 */
export async function recordAwaitingReminder(
  userId: string,
  quarter: string,
  now: string,
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<{ recorded: boolean; record?: ReminderTrackingRecord }> {
  const record: ReminderTrackingRecord = {
    userId,
    quarter,
    outcome: 'awaiting_reminder',
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
    return { recorded: true, record };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    return { recorded: false };
  }
}

/**
 * Queries all tracking records with outcome='awaiting_reminder' for use by the
 * Awaiting_Reminder_List. Paginated. Uses a Scan+FilterExpression rather than the
 * outcome-gracePeriodDeadline-index GSI, since gracePeriodDeadline is absent for
 * awaiting_reminder records and therefore cannot be indexed by that GSI.
 */
export async function queryAwaitingReminderRecords(
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<ReminderTrackingRecord[]> {
  const records: ReminderTrackingRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: trackingTable,
        FilterExpression: '#outcome = :awaitingReminder',
        ExpressionAttributeNames: {
          '#outcome': 'outcome',
        },
        ExpressionAttributeValues: {
          ':awaitingReminder': 'awaiting_reminder',
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
 * Atomically claims the entry for the Send_Reminder_Action: transitions outcome
 * 'awaiting_reminder' -> 'pending' using ConditionExpression outcome = :awaitingReminder,
 * computing and setting reminderSentAt=now and gracePeriodDeadline=computeGracePeriodDeadline(now)
 * in the same UpdateCommand. Returns claimed=false when the condition fails — either because
 * the entry doesn't exist, or (more commonly) because it has already moved past
 * 'awaiting_reminder' (already sent, or never was in awaiting_reminder) — this IS the
 * idempotency mechanism for Req 15.4. This is the ONLY function in the codebase that computes
 * gracePeriodDeadline for a real send.
 */
export async function claimAndStartGracePeriod(
  userId: string,
  quarter: string,
  now: string,
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<{ claimed: boolean; record?: ReminderTrackingRecord }> {
  const gracePeriodDeadline = computeGracePeriodDeadline(now);

  try {
    const result = await dynamoClient.send(
      new UpdateCommand({
        TableName: trackingTable,
        Key: { userId, quarter },
        UpdateExpression:
          'SET #outcome = :pending, reminderSentAt = :now, gracePeriodDeadline = :deadline, #updatedAt = :now',
        ConditionExpression: '#outcome = :awaitingReminder',
        ExpressionAttributeNames: {
          '#outcome': 'outcome',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':awaitingReminder': 'awaiting_reminder',
          ':now': now,
          ':deadline': gracePeriodDeadline,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return { claimed: true, record: result.Attributes as ReminderTrackingRecord };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    return { claimed: false };
  }
}

/**
 * Compensating action for a failed send immediately after claimAndStartGracePeriod succeeded:
 * atomically transitions outcome 'pending' -> 'awaiting_reminder' using
 * ConditionExpression outcome = :pending AND reminderSentAt = :expected (the exact
 * timestamp this call's own claim just set, so it can never revert a different, later-claimed
 * attempt), clearing reminderSentAt/gracePeriodDeadline. Implements Req 5.8.
 */
export async function revertToAwaitingReminder(
  userId: string,
  quarter: string,
  expectedReminderSentAt: string,
  dynamoClient: DynamoDBDocumentClient,
  trackingTable: string,
): Promise<{ reverted: boolean }> {
  const now = new Date().toISOString();

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: trackingTable,
        Key: { userId, quarter },
        UpdateExpression: 'SET #outcome = :awaitingReminder, #updatedAt = :updatedAt REMOVE reminderSentAt, gracePeriodDeadline',
        ConditionExpression: '#outcome = :pending AND reminderSentAt = :expected',
        ExpressionAttributeNames: {
          '#outcome': 'outcome',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':awaitingReminder': 'awaiting_reminder',
          ':pending': 'pending',
          ':expected': expectedReminderSentAt,
          ':updatedAt': now,
        },
      }),
    );
    return { reverted: true };
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    return { reverted: false };
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
