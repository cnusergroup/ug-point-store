import { describe, it, expect, vi } from 'vitest';
import type { ReminderOutcome } from './reminder-tracking';
import type { UGLExitServiceContext } from './detection-job';

// ============================================================
// Mock '../email/notifications' — controllable per-call sent/failed outcome, following
// reminder-tracking.test.ts's vi.fn mocking style adapted for the email-sending dependency.
// vi.hoisted is required since vi.mock's factory is hoisted above regular top-level
// const declarations (mirrors detection-job.property.test.ts's established pattern).
// ============================================================
const { sendUGLExitReminderEmailMock } = vi.hoisted(() => ({
  sendUGLExitReminderEmailMock: vi.fn(),
}));

vi.mock('../email/notifications', () => ({
  sendUGLExitReminderEmail: sendUGLExitReminderEmailMock,
}));

import { sendReminderAction } from './send-reminder-action';

// ============================================================
// In-memory mock DynamoDB table — same shape as reminder-tracking.property.test.ts's
// createMockDynamoTable helper (multi-item, keyed store), adapted here for standard unit
// tests against a fixed, hand-authored set of tracking records.
// ============================================================

interface MockTrackingItem {
  userId: string;
  quarter: string;
  outcome: ReminderOutcome;
  reminderSentAt?: string;
  gracePeriodDeadline?: string;
  createdAt: string;
  updatedAt: string;
}

function throwConditionalCheckFailed(): never {
  const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
  err.name = 'ConditionalCheckFailedException';
  throw err;
}

function createMockDynamoTable(initialItems: MockTrackingItem[] = []) {
  const store = new Map<string, MockTrackingItem>();
  for (const item of initialItems) {
    store.set(`${item.userId}#${item.quarter}`, { ...item });
  }

  const send = vi.fn(async (command: any) => {
    const input = command.input ?? command;

    // ScanCommand path (queryAwaitingReminderRecords)
    if (input.FilterExpression) {
      const wanted = input.ExpressionAttributeValues[':awaitingReminder'];
      const items = Array.from(store.values()).filter((item) => item.outcome === wanted);
      return { Items: items.map((i) => ({ ...i })) };
    }

    // UpdateCommand path (claimAndStartGracePeriod / revertToAwaitingReminder)
    if (input.UpdateExpression) {
      const key = `${input.Key.userId}#${input.Key.quarter}`;
      const current = store.get(key);
      const cond: string = input.ConditionExpression;
      const vals = input.ExpressionAttributeValues;

      if (cond === '#outcome = :awaitingReminder') {
        if (!current || current.outcome !== vals[':awaitingReminder']) throwConditionalCheckFailed();
      } else if (cond === '#outcome = :pending AND reminderSentAt = :expected') {
        if (!current || current.outcome !== vals[':pending'] || current.reminderSentAt !== vals[':expected']) {
          throwConditionalCheckFailed();
        }
      } else {
        throw new Error(`Unsupported condition in mock: ${cond}`);
      }

      let updated: MockTrackingItem = { ...(current as MockTrackingItem) };

      if (input.UpdateExpression.includes('gracePeriodDeadline = :deadline')) {
        updated = {
          ...updated,
          outcome: vals[':pending'],
          reminderSentAt: vals[':now'],
          gracePeriodDeadline: vals[':deadline'],
          updatedAt: vals[':now'],
        };
      } else if (input.UpdateExpression.includes('REMOVE reminderSentAt, gracePeriodDeadline')) {
        updated = {
          ...updated,
          outcome: vals[':awaitingReminder'],
          updatedAt: vals[':updatedAt'],
        };
        delete updated.reminderSentAt;
        delete updated.gracePeriodDeadline;
      } else {
        throw new Error('Unsupported update expression in mock');
      }

      store.set(key, updated);
      return { Attributes: updated };
    }

    throw new Error('Unsupported command in mock');
  });

  return {
    client: { send } as any,
    send,
    getItem: (userId: string, quarter: string) => store.get(`${userId}#${quarter}`),
  };
}

function buildContext(dynamoClient: any): UGLExitServiceContext {
  return {
    dynamoClient,
    sesClient: {} as any,
    usersTable: 'UsersTable',
    pointsRecordsTable: 'PointsRecordsTable',
    trackingTable: 'TrackingTable',
    senderEmail: 'noreply@example.com',
    emailTemplatesTable: 'EmailTemplatesTable',
  };
}

const QUARTER = '2025-Q2';

describe('sendReminderAction', () => {
  it('skips a userId with no matching awaiting_reminder entry without error, incrementing no counter', async () => {
    sendUGLExitReminderEmailMock.mockReset();
    sendUGLExitReminderEmailMock.mockResolvedValue({ sent: true });

    // No tracking records at all -> userId has no 'awaiting_reminder' entry.
    const { client: dynamoClient, send } = createMockDynamoTable([]);
    const ctx = buildContext(dynamoClient);

    const summary = await sendReminderAction(['u-unknown'], ctx);

    expect(summary).toEqual({ sentCount: 0, alreadySentCount: 0, sendFailedCount: 0, errors: 0 });
    expect(sendUGLExitReminderEmailMock).not.toHaveBeenCalled();

    // Only the initial ScanCommand (queryAwaitingReminderRecords) was issued — no
    // claimAndStartGracePeriod UpdateCommand attempted for the unknown user.
    expect(send).toHaveBeenCalledTimes(1);
    const scanArg = send.mock.calls[0][0];
    expect(scanArg.input.FilterExpression).toBe('#outcome = :awaitingReminder');
  });

  it('matches summary counts for a mixed batch: success, skip (no entry), already-claimed, and send-failure-with-revert', async () => {
    const initialItems: MockTrackingItem[] = [
      {
        userId: 'u-success',
        quarter: QUARTER,
        outcome: 'awaiting_reminder',
        createdAt: '2025-04-01T00:00:00.000Z',
        updatedAt: '2025-04-01T00:00:00.000Z',
      },
      // u-skip has no tracking record at all.
      {
        userId: 'u-already-claimed',
        quarter: QUARTER,
        // Already 'pending' -> claimAndStartGracePeriod's condition will fail (claimed: false),
        // simulating a concurrent Send_Reminder_Action call that already claimed it.
        outcome: 'pending',
        reminderSentAt: '2025-05-01T00:00:00.000Z',
        gracePeriodDeadline: '2025-05-31T00:00:00.000Z',
        createdAt: '2025-04-01T00:00:00.000Z',
        updatedAt: '2025-05-01T00:00:00.000Z',
      },
      {
        userId: 'u-send-fails',
        quarter: QUARTER,
        outcome: 'awaiting_reminder',
        createdAt: '2025-04-01T00:00:00.000Z',
        updatedAt: '2025-04-01T00:00:00.000Z',
      },
    ];

    // Note: queryAwaitingReminderRecords only returns outcome='awaiting_reminder' records,
    // so u-already-claimed (outcome='pending') will NOT appear in the userId->quarter map
    // built from that query. To exercise claimAndStartGracePeriod's claimed:false path (a
    // genuine concurrent-claim race) rather than the "no entry" skip path, we seed the query
    // results directly by also including a matching awaiting_reminder-shaped entry the mock
    // will report, while the underlying store item is already 'pending' so the subsequent
    // UpdateCommand's condition fails. We simulate this by pre-seeding the store with the
    // 'pending' item but manually re-adding it to the Scan's FilterExpression results via a
    // second table that reports it as awaiting_reminder for the query step only.
    const { client: dynamoClient, getItem } = createMockDynamoTable(initialItems);

    // Patch the mock's Scan behavior for this test: report u-already-claimed as if it were
    // still 'awaiting_reminder' in the query results (simulating the query having run
    // slightly before a concurrent claim completed), while the UpdateCommand condition check
    // still operates against the real (already 'pending') stored state.
    const originalSend = dynamoClient.send;
    dynamoClient.send = vi.fn(async (command: any) => {
      const input = command.input ?? command;
      if (input.FilterExpression) {
        const result = await originalSend(command);
        result.Items.push({
          userId: 'u-already-claimed',
          quarter: QUARTER,
          outcome: 'awaiting_reminder',
          createdAt: '2025-04-01T00:00:00.000Z',
          updatedAt: '2025-04-01T00:00:00.000Z',
        });
        return result;
      }
      return originalSend(command);
    });

    sendUGLExitReminderEmailMock.mockReset();
    sendUGLExitReminderEmailMock.mockImplementation(async (_ctx: any, userId: string) => ({
      sent: userId !== 'u-send-fails',
    }));

    const ctx = buildContext(dynamoClient);

    const summary = await sendReminderAction(
      ['u-success', 'u-skip', 'u-already-claimed', 'u-send-fails'],
      ctx,
    );

    expect(summary.sentCount).toBe(1);
    expect(summary.alreadySentCount).toBe(1);
    expect(summary.sendFailedCount).toBe(1);
    expect(summary.errors).toBe(0);

    // u-success: claimed and emailed successfully.
    const successItem = getItem('u-success', QUARTER);
    expect(successItem?.outcome).toBe('pending');
    expect(successItem?.reminderSentAt).toBeDefined();
    expect(successItem?.gracePeriodDeadline).toBeDefined();

    // u-skip: no tracking record ever existed, and none was created.
    expect(getItem('u-skip', QUARTER)).toBeUndefined();

    // u-already-claimed: claim failed (already 'pending') — left untouched, no email sent for it.
    const alreadyClaimedItem = getItem('u-already-claimed', QUARTER);
    expect(alreadyClaimedItem?.outcome).toBe('pending');
    expect(alreadyClaimedItem?.reminderSentAt).toBe('2025-05-01T00:00:00.000Z');
    const emailCallsForAlreadyClaimed = sendUGLExitReminderEmailMock.mock.calls.filter(
      (c: any[]) => c[1] === 'u-already-claimed',
    );
    expect(emailCallsForAlreadyClaimed.length).toBe(0);

    // u-send-fails: claimed, email failed, reverted back to 'awaiting_reminder'.
    const sendFailsItem = getItem('u-send-fails', QUARTER);
    expect(sendFailsItem?.outcome).toBe('awaiting_reminder');
    expect(sendFailsItem?.reminderSentAt).toBeUndefined();
    expect(sendFailsItem?.gracePeriodDeadline).toBeUndefined();
    expect(sendFailsItem?.createdAt).toBe('2025-04-01T00:00:00.000Z');
  });
});
