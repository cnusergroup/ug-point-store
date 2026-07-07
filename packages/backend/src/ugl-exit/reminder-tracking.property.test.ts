import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { transitionOutcome, ReminderTrackingRecord } from './reminder-tracking';

// ============================================================
// In-memory mock DynamoDB client
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
// Feature: ugl-inactivity-exit-flow, Property 8: Grace-period evaluation idempotency
//
// For any tracking record and any number of times runGracePeriodEvaluationJob processes it
// (simulating repeated/overlapping executions for the same due record), transitionOutcome
// succeeds (transitioned: true) on at most one of those invocations; every subsequent
// invocation for the same (userId, quarter) returns transitioned: false, and consequently
// at most one Exit_Notification is ever sent and at most one Consumed_Quarter_Marker is
// ever set for that (userId, quarter) pair, regardless of how many times evaluation runs.
//
// **Validates: Requirements 12.3**
// ============================================================

const targetArb = fc.constantFrom<'remedied' | 'exited'>('remedied', 'exited');
const callCountArb = fc.integer({ min: 1, max: 10 });

describe('Property 8: Grace-period evaluation idempotency', () => {
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
});
