import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { computeGracePeriodDeadline, ReminderOutcome, ReminderTrackingRecord } from './reminder-tracking';
import type { UGLExitServiceContext } from './detection-job';

// ============================================================
// Mock '../email/notifications' — spies on sendUGLExitReminderEmail so we can control
// per-userId success/failure and assert call counts/arguments directly, mirroring the
// approach detection-job.property.test.ts already established for this exact
// email-sending dependency chain (vi.hoisted + vi.mock, hoisted above the import of the
// module under test). The default implementation always succeeds ({ sent: true }) —
// Property 6 (below) relies on this default; Property 7 overrides it per-test via
// mockImplementation to simulate per-userId failures.
// ============================================================
const { sendUGLExitReminderEmailMock } = vi.hoisted(() => ({
  sendUGLExitReminderEmailMock: vi.fn(
    async (_ctx: any, _userId: string, ..._rest: any[]) => ({ sent: true }),
  ),
}));

vi.mock('../email/notifications', () => ({
  sendUGLExitReminderEmail: sendUGLExitReminderEmailMock,
}));

import { sendReminderAction } from './send-reminder-action';

// ============================================================
// In-memory mock DynamoDB table (multi-item, keyed store) — adapted from
// reminder-tracking.property.test.ts's createMockDynamoTable helper (not exported there,
// so copied/adapted here). Supports the ScanCommand shape used by
// queryAwaitingReminderRecords (FilterExpression outcome=:awaitingReminder) and the two
// UpdateCommand ConditionExpression shapes used by claimAndStartGracePeriod and
// revertToAwaitingReminder, mirroring real DynamoDB's atomic conditional-write semantics.
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
        // claimAndStartGracePeriod
        updated = {
          ...updated,
          outcome: vals[':pending'],
          reminderSentAt: vals[':now'],
          gracePeriodDeadline: vals[':deadline'],
          updatedAt: vals[':now'],
        };
      } else if (input.UpdateExpression.includes('REMOVE reminderSentAt, gracePeriodDeadline')) {
        // revertToAwaitingReminder
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

// ============================================================
// Arbitraries
// ============================================================

const userIdArb = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0);

/** createdAt values are deliberately kept in a range well before the fake claim times used
 * below, so that a passing assertion of "gracePeriodDeadline derived from claim time, not
 * from createdAt" can never accidentally coincide. */
const createdAtArb = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2024-12-31T00:00:00.000Z'), noInvalidDate: true })
  .map((d) => d.toISOString());

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 6: Send_Reminder_Action dispatch, grace-period start timing, and idempotency
//
// For any set of Awaiting_Reminder_UGL entries and any sequence of sendReminderAction
// invocations with overlapping/repeated userIds selections covering those entries: exactly
// one Reminder_Email is sent per entry across ALL invocations combined; the entry's
// gracePeriodDeadline is computed from the successful claim's OWN timestamp (verified via
// computeGracePeriodDeadline), never from the entry's original createdAt; and once an entry
// has been claimed, every subsequent duplicate call for that same entry leaves its
// gracePeriodDeadline byte-identical to the first successful claim (no recomputation).
//
// Validates: Requirements 5.3, 5.5, 5.6, 5.7, 15.4
// ============================================================

const entryArb = fc.record({ userId: userIdArb, createdAt: createdAtArb });
const entriesArb = fc.uniqueArray(entryArb, { selector: (e) => e.userId, minLength: 1, maxLength: 5 });

const property6Arb = entriesArb.chain((entries) => {
  const userIds = entries.map((e) => e.userId);
  const idArb = fc.constantFrom(...userIds);
  const invocationsArb = fc.array(fc.array(idArb, { minLength: 0, maxLength: userIds.length * 2 }), {
    minLength: 1,
    maxLength: 4,
  });
  return fc.tuple(fc.constant(entries), invocationsArb);
});

describe('Property 6: Send_Reminder_Action dispatch, grace-period start timing, and idempotency', () => {
  it('sends exactly one email per entry across overlapping/repeated invocations, computes gracePeriodDeadline from the claim time (not createdAt), and never recomputes it on duplicate calls', async () => {
    await fc.assert(
      fc.asyncProperty(property6Arb, async ([entries, invocationSelections]) => {
        sendUGLExitReminderEmailMock.mockClear();
        sendUGLExitReminderEmailMock.mockImplementation(async () => ({ sent: true }));

        const initialItems: MockTrackingItem[] = entries.map((e) => ({
          userId: e.userId,
          quarter: QUARTER,
          outcome: 'awaiting_reminder',
          createdAt: e.createdAt,
          updatedAt: e.createdAt,
        }));
        const { client: dynamoClient, getItem } = createMockDynamoTable(initialItems);
        const ctx = buildContext(dynamoClient);

        const firstClaimReminderSentAt = new Map<string, string>();
        const firstClaimGracePeriodDeadline = new Map<string, string>();

        vi.useFakeTimers();
        try {
          let t = new Date('2025-06-01T00:00:00.000Z').getTime();
          for (const selection of invocationSelections) {
            vi.setSystemTime(new Date(t));
            t += 1000;

            await sendReminderAction(selection, ctx);

            for (const e of entries) {
              const item = getItem(e.userId, QUARTER);
              if (item?.outcome !== 'pending') continue;

              if (!firstClaimGracePeriodDeadline.has(e.userId)) {
                firstClaimReminderSentAt.set(e.userId, item.reminderSentAt as string);
                firstClaimGracePeriodDeadline.set(e.userId, item.gracePeriodDeadline as string);
              } else {
                // Duplicate call for an already-claimed entry: byte-identical, no recomputation.
                expect(item.reminderSentAt).toBe(firstClaimReminderSentAt.get(e.userId));
                expect(item.gracePeriodDeadline).toBe(firstClaimGracePeriodDeadline.get(e.userId));
              }
            }
          }
        } finally {
          vi.useRealTimers();
        }

        const selectedUserIds = new Set(invocationSelections.flat());

        for (const e of entries) {
          const emailCallsForUser = sendUGLExitReminderEmailMock.mock.calls.filter((c) => c[1] === e.userId);

          if (selectedUserIds.has(e.userId)) {
            // Exactly one email sent per entry across all invocations combined.
            expect(emailCallsForUser.length).toBe(1);

            const item = getItem(e.userId, QUARTER);
            expect(item?.outcome).toBe('pending');
            const reminderSentAt = item?.reminderSentAt as string;
            expect(reminderSentAt).toBeDefined();
            // gracePeriodDeadline is computed from the claim's own timestamp.
            expect(item?.gracePeriodDeadline).toBe(computeGracePeriodDeadline(reminderSentAt));
            // ...and NOT from the entry's original createdAt.
            expect(item?.gracePeriodDeadline).not.toBe(computeGracePeriodDeadline(e.createdAt));
          } else {
            expect(emailCallsForUser.length).toBe(0);
            const item = getItem(e.userId, QUARTER);
            expect(item?.outcome).toBe('awaiting_reminder');
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 7: Send_Reminder_Action failure isolation, revert, and empty-selection no-op
//
// For any batch of Awaiting_Reminder_UGL entries where an arbitrary subset's simulated email
// send fails: every failed entry's tracking record is left byte-for-byte identical to its
// pre-call 'awaiting_reminder' state (same outcome, createdAt, no reminderSentAt/
// gracePeriodDeadline), while every succeeding entry transitions to 'pending' with both
// fields set; one entry's failure never blocks another entry's processing (all entries in
// the batch are attempted); and an empty userIds array produces zero DynamoDB calls, zero
// email sends, and an all-zero summary.
//
// Validates: Requirements 5.8, 5.9
// ============================================================

const batchEntryArb = fc.record({ userId: userIdArb, createdAt: createdAtArb, shouldFail: fc.boolean() });
const batchArb = fc.uniqueArray(batchEntryArb, { selector: (e) => e.userId, minLength: 1, maxLength: 6 });

describe('Property 7: Send_Reminder_Action failure isolation, revert, and empty-selection no-op', () => {
  it('reverts failed entries to their exact pre-call awaiting_reminder state, transitions succeeding entries to pending, and attempts every entry in the batch regardless of failures', async () => {
    await fc.assert(
      fc.asyncProperty(batchArb, async (batch) => {
        sendUGLExitReminderEmailMock.mockClear();
        const failingUserIds = new Set(batch.filter((b) => b.shouldFail).map((b) => b.userId));
        sendUGLExitReminderEmailMock.mockImplementation(async (_ctx: any, userId: string) => ({
          sent: !failingUserIds.has(userId),
        }));

        const initialItems: MockTrackingItem[] = batch.map((b) => ({
          userId: b.userId,
          quarter: QUARTER,
          outcome: 'awaiting_reminder',
          createdAt: b.createdAt,
          updatedAt: b.createdAt,
        }));
        const preCallSnapshot = new Map(initialItems.map((i) => [i.userId, { ...i }]));

        const { client: dynamoClient, getItem } = createMockDynamoTable(initialItems);
        const ctx = buildContext(dynamoClient);

        const userIds = batch.map((b) => b.userId);
        const summary = await sendReminderAction(userIds, ctx);

        // Every entry in the batch was attempted exactly once — one failure never blocks
        // another entry's processing.
        for (const b of batch) {
          const calls = sendUGLExitReminderEmailMock.mock.calls.filter((c) => c[1] === b.userId);
          expect(calls.length).toBe(1);
        }

        for (const b of batch) {
          const item = getItem(b.userId, QUARTER);
          const pre = preCallSnapshot.get(b.userId)!;

          if (b.shouldFail) {
            // Reverted: byte-for-byte identical to the pre-call 'awaiting_reminder' state —
            // the revert fully undid the claim.
            expect(item?.outcome).toBe('awaiting_reminder');
            expect(item?.userId).toBe(pre.userId);
            expect(item?.quarter).toBe(pre.quarter);
            expect(item?.createdAt).toBe(pre.createdAt);
            expect(item?.reminderSentAt).toBeUndefined();
            expect(item?.gracePeriodDeadline).toBeUndefined();
          } else {
            expect(item?.outcome).toBe('pending');
            expect(item?.reminderSentAt).toBeDefined();
            expect(item?.gracePeriodDeadline).toBe(computeGracePeriodDeadline(item!.reminderSentAt as string));
          }
        }

        const successCount = batch.filter((b) => !b.shouldFail).length;
        const failCount = batch.filter((b) => b.shouldFail).length;
        expect(summary.sentCount).toBe(successCount);
        expect(summary.sendFailedCount).toBe(failCount);
        expect(summary.alreadySentCount).toBe(0);
        expect(summary.errors).toBe(0);
      }),
      { numRuns: 50 },
    );
  });

  it('an empty userIds array produces zero DynamoDB calls, zero email sends, and an all-zero summary', async () => {
    sendUGLExitReminderEmailMock.mockClear();
    sendUGLExitReminderEmailMock.mockImplementation(async () => ({ sent: true }));

    const { client: dynamoClient, send } = createMockDynamoTable([]);
    const ctx = buildContext(dynamoClient);

    const summary = await sendReminderAction([], ctx);

    expect(summary).toEqual({ sentCount: 0, alreadySentCount: 0, sendFailedCount: 0, errors: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(sendUGLExitReminderEmailMock).not.toHaveBeenCalled();
  });
});
