import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  transitionOutcome,
  recordAwaitingReminder,
  claimAndStartGracePeriod,
  revertToAwaitingReminder,
  computeGracePeriodDeadline,
  ReminderTrackingRecord,
} from './reminder-tracking';

// ============================================================
// In-memory mock DynamoDB client (single-item, transitionOutcome only)
// ============================================================
//
// Simulates a single-item table keyed by (userId, quarter) supporting UpdateCommand
// with a ConditionExpression check on `outcome = :pending`, mirroring real DynamoDB's
// atomic conditional-write semantics (only one caller can "win" a given transition).

function createMockDynamoClient(initial: ReminderTrackingRecord) {
  let item: ReminderTrackingRecord = { ...initial };

  return {
    send: async (command: any) => {
      const input = command.input ?? command;

      if (input.UpdateExpression) {
        // Evaluate the ConditionExpression "#outcome = :pending" against current state.
        const conditionOutcome = input.ExpressionAttributeValues[':pending'];
        if (item.outcome !== conditionOutcome) {
          const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }

        // Apply the update.
        item = {
          ...item,
          outcome: input.ExpressionAttributeValues[':target'],
          updatedAt: input.ExpressionAttributeValues[':updatedAt'],
          ...(input.ExpressionAttributeValues[':consumedRecordId'] !== undefined
            ? { consumedRecordId: input.ExpressionAttributeValues[':consumedRecordId'] }
            : {}),
        };
        return {};
      }

      throw new Error('Unsupported command in mock');
    },
  };
}

// ============================================================
// In-memory mock DynamoDB table (multi-item, keyed store) —
// supports PutCommand (attribute_not_exists dedup) and the three UpdateCommand
// ConditionExpression shapes used by claimAndStartGracePeriod, revertToAwaitingReminder,
// and transitionOutcome, mirroring real DynamoDB's atomic conditional-write semantics.
// ============================================================

function throwConditionalCheckFailed(): never {
  const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
  err.name = 'ConditionalCheckFailedException';
  throw err;
}

function createMockDynamoTable(initialItems: ReminderTrackingRecord[] = []) {
  const store = new Map<string, ReminderTrackingRecord>();
  for (const item of initialItems) {
    store.set(`${item.userId}#${item.quarter}`, { ...item });
  }

  return {
    send: async (command: any) => {
      const input = command.input ?? command;

      // PutCommand path (recordAwaitingReminder)
      if (input.Item) {
        const itemKey = `${input.Item.userId}#${input.Item.quarter}`;
        if (input.ConditionExpression === 'attribute_not_exists(userId)' && store.has(itemKey)) {
          throwConditionalCheckFailed();
        }
        store.set(itemKey, { ...input.Item });
        return {};
      }

      // UpdateCommand path (claimAndStartGracePeriod / revertToAwaitingReminder / transitionOutcome)
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
        } else if (cond === '#outcome = :pending') {
          if (!current || current.outcome !== vals[':pending']) throwConditionalCheckFailed();
        } else {
          throw new Error(`Unsupported condition in mock: ${cond}`);
        }

        let updated: ReminderTrackingRecord = { ...(current as ReminderTrackingRecord) };

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
          // transitionOutcome
          updated = {
            ...updated,
            outcome: vals[':target'],
            updatedAt: vals[':updatedAt'],
            ...(vals[':consumedRecordId'] !== undefined ? { consumedRecordId: vals[':consumedRecordId'] } : {}),
          };
        }

        store.set(key, updated);
        return { Attributes: updated };
      }

      throw new Error('Unsupported command in mock');
    },
    _getItem: (userId: string, quarter: string) => store.get(`${userId}#${quarter}`),
  };
}

// ============================================================
// Arbitraries
// ============================================================

const userIdArb = fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0);
const quarterArb = fc.constantFrom('2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1');
const isoArb = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-01-01T00:00:00.000Z'), noInvalidDate: true })
  .map((d) => d.toISOString());

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 10: Grace-period evaluation idempotency
//
// For any tracking record and any number of times runGracePeriodEvaluationJob processes it
// (simulating repeated/overlapping executions for the same due record), transitionOutcome
// succeeds (transitioned: true) on at most one of those invocations; every subsequent
// invocation for the same (userId, quarter) returns transitioned: false, and consequently
// at most one Exit_Notification is ever sent and at most one Consumed_Quarter_Marker is
// ever set for that (userId, quarter) pair, regardless of how many times evaluation runs.
//
// **Validates: Requirements 15.3**
// ============================================================

const targetArb = fc.constantFrom<'remedied' | 'exited'>('remedied', 'exited');
const callCountArb = fc.integer({ min: 1, max: 10 });

describe('Property 10: Grace-period evaluation idempotency', () => {
  it('at most one transitionOutcome call succeeds for a repeatedly-processed (userId, quarter) pair', async () => {
    await fc.assert(
      fc.asyncProperty(targetArb, callCountArb, async (target, callCount) => {
        const userId = 'u1';
        const quarter = '2025-Q2';
        const initial: ReminderTrackingRecord = {
          userId,
          quarter,
          reminderSentAt: '2025-04-01T00:00:00.000Z',
          gracePeriodDeadline: '2025-05-01T00:00:00.000Z',
          outcome: 'pending',
          createdAt: '2025-04-01T00:00:00.000Z',
          updatedAt: '2025-04-01T00:00:00.000Z',
        };
        const dynamoClient = createMockDynamoClient(initial) as any;

        const results: Array<{ transitioned: boolean }> = [];
        for (let i = 0; i < callCount; i++) {
          const result = await transitionOutcome(userId, quarter, target, {}, dynamoClient, 'trackingTable');
          results.push(result);
        }

        const successCount = results.filter((r) => r.transitioned).length;
        expect(successCount).toBeLessThanOrEqual(1);
        // Simulating repeated/overlapping executions for a pending record: the first call
        // always succeeds (record starts as 'pending'), and every subsequent call fails.
        expect(successCount).toBe(1);
        expect(results[0].transitioned).toBe(true);
        for (let i = 1; i < results.length; i++) {
          expect(results[i].transitioned).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('mixed concurrent-style calls with different targets still allow only one winner', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(targetArb, { minLength: 2, maxLength: 8 }), async (targets) => {
        const userId = 'u2';
        const quarter = '2025-Q3';
        const initial: ReminderTrackingRecord = {
          userId,
          quarter,
          reminderSentAt: '2025-07-01T00:00:00.000Z',
          gracePeriodDeadline: '2025-07-31T00:00:00.000Z',
          outcome: 'pending',
          createdAt: '2025-07-01T00:00:00.000Z',
          updatedAt: '2025-07-01T00:00:00.000Z',
        };
        const dynamoClient = createMockDynamoClient(initial) as any;

        const results = await Promise.all(
          targets.map((target) => transitionOutcome(userId, quarter, target, {}, dynamoClient, 'trackingTable')),
        );

        const successCount = results.filter((r) => r.transitioned).length;
        expect(successCount).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  // ==========================================================
  // recordAwaitingReminder dedup — supports Requirement 15.1: repeated UGL_Detection_Job
  // executions for the same Detection_Quarter must never record a duplicate
  // Awaiting_Reminder_UGL entry for the same (userId, quarter).
  // ==========================================================

  it('recordAwaitingReminder creates at most one record per (userId, quarter) across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        quarterArb,
        fc.array(isoArb, { minLength: 1, maxLength: 10 }),
        async (userId, quarter, nows) => {
          const dynamoClient = createMockDynamoTable() as any;

          const results: Array<{ recorded: boolean; record?: ReminderTrackingRecord }> = [];
          for (const now of nows) {
            const result = await recordAwaitingReminder(userId, quarter, now, dynamoClient, 'trackingTable');
            results.push(result);
          }

          const recordedCount = results.filter((r) => r.recorded).length;
          expect(recordedCount).toBe(1);
          expect(results[0].recorded).toBe(true);
          for (let i = 1; i < results.length; i++) {
            expect(results[i].recorded).toBe(false);
            expect(results[i].record).toBeUndefined();
          }

          const stored = dynamoClient._getItem(userId, quarter);
          expect(stored).toEqual(results[0].record);
          expect(stored?.outcome).toBe('awaiting_reminder');
          expect(stored?.reminderSentAt).toBeUndefined();
          expect(stored?.gracePeriodDeadline).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  // ==========================================================
  // claimAndStartGracePeriod / revertToAwaitingReminder round-tripping — supports
  // Requirement 15.4: a failed Send_Reminder_Action send must restore the entry to
  // byte-for-byte its pre-claim 'awaiting_reminder' state.
  // ==========================================================

  it('claimAndStartGracePeriod then revertToAwaitingReminder restores the exact pre-claim state', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, quarterArb, isoArb, isoArb, async (userId, quarter, createdAt, claimNow) => {
        const preClaim: ReminderTrackingRecord = {
          userId,
          quarter,
          outcome: 'awaiting_reminder',
          createdAt,
          updatedAt: createdAt,
        };
        const dynamoClient = createMockDynamoTable([preClaim]) as any;

        const claimResult = await claimAndStartGracePeriod(userId, quarter, claimNow, dynamoClient, 'trackingTable');
        expect(claimResult.claimed).toBe(true);
        expect(claimResult.record?.outcome).toBe('pending');
        expect(claimResult.record?.reminderSentAt).toBe(claimNow);
        expect(claimResult.record?.gracePeriodDeadline).toBe(computeGracePeriodDeadline(claimNow));

        const revertResult = await revertToAwaitingReminder(
          userId,
          quarter,
          claimNow,
          dynamoClient,
          'trackingTable',
        );
        expect(revertResult.reverted).toBe(true);

        const finalItem = dynamoClient._getItem(userId, quarter);
        expect(finalItem?.outcome).toBe('awaiting_reminder');
        expect(finalItem?.reminderSentAt).toBeUndefined();
        expect(finalItem?.gracePeriodDeadline).toBeUndefined();
        expect(finalItem?.userId).toBe(userId);
        expect(finalItem?.quarter).toBe(quarter);
        expect(finalItem?.createdAt).toBe(createdAt);
      }),
      { numRuns: 100 },
    );
  });

  it('revertToAwaitingReminder fails and leaves state untouched when expectedReminderSentAt is stale', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        quarterArb,
        isoArb,
        isoArb,
        isoArb,
        async (userId, quarter, createdAt, claimNow, staleExpected) => {
          fc.pre(staleExpected !== claimNow);

          const preClaim: ReminderTrackingRecord = {
            userId,
            quarter,
            outcome: 'awaiting_reminder',
            createdAt,
            updatedAt: createdAt,
          };
          const dynamoClient = createMockDynamoTable([preClaim]) as any;

          const claimResult = await claimAndStartGracePeriod(
            userId,
            quarter,
            claimNow,
            dynamoClient,
            'trackingTable',
          );
          expect(claimResult.claimed).toBe(true);

          const revertResult = await revertToAwaitingReminder(
            userId,
            quarter,
            staleExpected,
            dynamoClient,
            'trackingTable',
          );
          expect(revertResult.reverted).toBe(false);

          // State must remain exactly as the successful claim left it — the revert must not
          // have applied any part of its update on a failed condition check.
          const afterFailedRevert = dynamoClient._getItem(userId, quarter);
          expect(afterFailedRevert?.outcome).toBe('pending');
          expect(afterFailedRevert?.reminderSentAt).toBe(claimNow);
          expect(afterFailedRevert?.gracePeriodDeadline).toBe(computeGracePeriodDeadline(claimNow));
        },
      ),
      { numRuns: 100 },
    );
  });
});
