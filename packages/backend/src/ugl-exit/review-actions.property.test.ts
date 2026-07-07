import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { confirmExit, restoreTracking } from './review-actions';
import { filterEligibleUGLsForExit } from './eligibility';
import type { ExitEligibleUser } from './eligibility';

// ============================================================
// In-memory mock DynamoDB client
// ============================================================
//
// Simulates a single-item Users table keyed by userId, supporting:
// - GetCommand -> returns the current item (or undefined if "deleted")
// - UpdateCommand -> applies either the setUserStatus SET expression or the
//   review-actions REMOVE expression, honoring ConditionExpression semantics
//   (uglExitStatus = :pendingExit) exactly like real DynamoDB.

interface MockUserRecord {
  userId: string;
  roles: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  nickname: string;
  email: string;
  uglExitStatus?: 'pending_exit';
  uglExitTriggeredQuarter?: string;
  uglExitMarkedAt?: string;
}

function createMockDynamoClient(initial: MockUserRecord) {
  let item: MockUserRecord | undefined = { ...initial };

  return {
    send: async (command: any) => {
      const name = command.constructor.name;
      const input = command.input ?? command;

      if (name === 'GetCommand') {
        return { Item: item ? { ...item } : undefined };
      }

      if (name === 'UpdateCommand') {
        if (!item) {
          const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }

        // review-actions.ts clearUglExitFields: REMOVE uglExitStatus, uglExitTriggeredQuarter, uglExitMarkedAt
        if (input.UpdateExpression?.startsWith('REMOVE uglExitStatus')) {
          const conditionValue = input.ExpressionAttributeValues?.[':pendingExit'];
          if (item.uglExitStatus !== conditionValue) {
            const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
          delete item.uglExitStatus;
          delete item.uglExitTriggeredQuarter;
          delete item.uglExitMarkedAt;
          return {};
        }

        // admin/users.ts setUserStatus (disable branch): SET #status = :status, updatedAt = :now
        if (input.UpdateExpression?.startsWith('SET #status')) {
          item.status = input.ExpressionAttributeValues[':status'];
          return {};
        }

        throw new Error(`Unsupported UpdateExpression in mock: ${input.UpdateExpression}`);
      }

      throw new Error(`Unsupported command in mock: ${name}`);
    },
    // test helper — not part of the DynamoDBDocumentClient interface
    __getItem: () => item,
  };
}

// ============================================================
// Generators
// ============================================================

/** Non-elevated roles only, so setUserStatus's Admin/OrderAdmin/SuperAdmin guards never trigger. */
const nonElevatedRolesArb = fc.subarray(['UserGroupLeader', 'Volunteer', 'Speaker'], { minLength: 1 });
const quarterArb = fc.constantFrom('2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2');
const isoTimestampArb = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-01-01T00:00:00.000Z'), noInvalidDate: true })
  .map((d) => d.toISOString());
const userIdArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).filter((s) => s.length > 0);

function pendingExitUserArb() {
  return fc.record({
    userId: userIdArb,
    roles: nonElevatedRolesArb,
    createdAt: isoTimestampArb,
    triggeredQuarter: quarterArb,
    markedAt: isoTimestampArb,
  });
}

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 13: Confirm exit action correctness
//
// For any user currently in Pending_Exit_UGL state (uglExitStatus === 'pending_exit')
// whose roles do not block disabling (non-SuperAdmin/Admin/OrderAdmin), confirmExit
// disables the account (status -> 'disabled') AND clears all three uglExit* tracking
// fields, and reports success.
//
// **Validates: Requirements 10.2**
// ============================================================

describe('Property 13: Confirm exit action correctness', () => {
  it('disables the account and clears uglExit* fields on a Pending_Exit_UGL', async () => {
    await fc.assert(
      fc.asyncProperty(pendingExitUserArb(), async ({ userId, roles, createdAt, triggeredQuarter, markedAt }) => {
        const initial: MockUserRecord = {
          userId,
          roles,
          status: 'active',
          createdAt,
          nickname: 'nick',
          email: 'a@b.com',
          uglExitStatus: 'pending_exit',
          uglExitTriggeredQuarter: triggeredQuarter,
          uglExitMarkedAt: markedAt,
        };
        const dynamoClient = createMockDynamoClient(initial) as any;

        const result = await confirmExit(userId, 'caller1', ['SuperAdmin'], dynamoClient, 'usersTable');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        const finalItem = dynamoClient.__getItem();
        expect(finalItem.status).toBe('disabled');
        expect(finalItem.uglExitStatus).toBeUndefined();
        expect(finalItem.uglExitTriggeredQuarter).toBeUndefined();
        expect(finalItem.uglExitMarkedAt).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 14: Restore tracking action correctness
//
// For any user currently in Pending_Exit_UGL state, restoreTracking clears all three
// uglExit* tracking fields WITHOUT touching `status`, and reports success. Feeding the
// resulting user record into filterEligibleUGLsForExit for the next quarter includes
// that user (given the other Eligible_UGL criteria hold: roles contains UserGroupLeader,
// status active, createdAt before the next quarter's start).
//
// **Validates: Requirements 10.3, 10.4**
// ============================================================

describe('Property 14: Restore tracking action correctness', () => {
  it('clears uglExit* fields without touching status', async () => {
    await fc.assert(
      fc.asyncProperty(pendingExitUserArb(), async ({ userId, roles, createdAt, triggeredQuarter, markedAt }) => {
        const initial: MockUserRecord = {
          userId,
          roles,
          status: 'active',
          createdAt,
          nickname: 'nick',
          email: 'a@b.com',
          uglExitStatus: 'pending_exit',
          uglExitTriggeredQuarter: triggeredQuarter,
          uglExitMarkedAt: markedAt,
        };
        const dynamoClient = createMockDynamoClient(initial) as any;

        const result = await restoreTracking(userId, dynamoClient, 'usersTable');

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        const finalItem = dynamoClient.__getItem();
        // status must be untouched (still 'active' — restoreTracking never writes it)
        expect(finalItem.status).toBe('active');
        expect(finalItem.uglExitStatus).toBeUndefined();
        expect(finalItem.uglExitTriggeredQuarter).toBeUndefined();
        expect(finalItem.uglExitMarkedAt).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('the restored user is included by filterEligibleUGLsForExit for the next quarter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: userIdArb,
          roles: fc.subarray(['UserGroupLeader', 'Volunteer', 'Speaker'], { minLength: 1 }).map((rs) =>
            rs.includes('UserGroupLeader') ? rs : [...rs, 'UserGroupLeader'],
          ),
          triggeredQuarter: quarterArb,
          markedAt: isoTimestampArb,
        }),
        async ({ userId, roles, triggeredQuarter, markedAt }) => {
          // createdAt fixed well before any nextQuarterStart used below
          const createdAt = '2019-01-01T00:00:00.000Z';
          const nextQuarterStart = '2030-01-01T00:00:00.000Z';

          const initial: MockUserRecord = {
            userId,
            roles,
            status: 'active',
            createdAt,
            nickname: 'nick',
            email: 'a@b.com',
            uglExitStatus: 'pending_exit',
            uglExitTriggeredQuarter: triggeredQuarter,
            uglExitMarkedAt: markedAt,
          };
          const dynamoClient = createMockDynamoClient(initial) as any;

          const result = await restoreTracking(userId, dynamoClient, 'usersTable');
          expect(result.success).toBe(true);

          const finalItem = dynamoClient.__getItem();
          const eligibleUser: ExitEligibleUser = {
            userId: finalItem.userId,
            nickname: finalItem.nickname,
            email: finalItem.email,
            roles: finalItem.roles,
            status: finalItem.status,
            createdAt: finalItem.createdAt,
            uglExitStatus: finalItem.uglExitStatus,
          };

          const eligible = filterEligibleUGLsForExit([eligibleUser], nextQuarterStart);
          expect(eligible.map((u) => u.userId)).toContain(userId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 15: Non-pending-exit rejection for review actions
//
// For any user whose uglExitStatus is not 'pending_exit' (including absent, or any other
// value), both confirmExit and restoreTracking return success: false with error code
// NOT_PENDING_EXIT, and perform no writes — the user's record (status and uglExit* fields)
// remains exactly unchanged.
//
// **Validates: Requirements 10.6**
// ============================================================

const notPendingExitStatusArb = fc.constantFrom<undefined | 'other'>(undefined, 'other' as any);

describe('Property 15: Non-pending-exit rejection for review actions', () => {
  it('confirmExit rejects a non-pending-exit user without writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        pendingExitUserArb(),
        notPendingExitStatusArb,
        async ({ userId, roles, createdAt }, uglExitStatus) => {
          const initial: MockUserRecord = {
            userId,
            roles,
            status: 'active',
            createdAt,
            nickname: 'nick',
            email: 'a@b.com',
            ...(uglExitStatus ? { uglExitStatus: uglExitStatus as any } : {}),
          };
          const dynamoClient = createMockDynamoClient(initial) as any;

          const result = await confirmExit(userId, 'caller1', ['SuperAdmin'], dynamoClient, 'usersTable');

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('NOT_PENDING_EXIT');

          const finalItem = dynamoClient.__getItem();
          expect(finalItem.status).toBe('active');
          expect(finalItem.uglExitStatus).toBe(uglExitStatus);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('restoreTracking rejects a non-pending-exit user without writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        pendingExitUserArb(),
        notPendingExitStatusArb,
        async ({ userId, roles, createdAt }, uglExitStatus) => {
          const initial: MockUserRecord = {
            userId,
            roles,
            status: 'active',
            createdAt,
            nickname: 'nick',
            email: 'a@b.com',
            ...(uglExitStatus ? { uglExitStatus: uglExitStatus as any } : {}),
          };
          const dynamoClient = createMockDynamoClient(initial) as any;

          const result = await restoreTracking(userId, dynamoClient, 'usersTable');

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('NOT_PENDING_EXIT');

          const finalItem = dynamoClient.__getItem();
          expect(finalItem.status).toBe('active');
          expect(finalItem.uglExitStatus).toBe(uglExitStatus);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns USER_NOT_FOUND when the user does not exist, without writes', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        // Simulate no user existing at all — any write would be a test failure.
        const dynamoClient = {
          send: async (command: any) => {
            if (command.constructor.name === 'GetCommand') {
              return { Item: undefined };
            }
            throw new Error('No writes expected for a missing user');
          },
        } as any;

        const confirmResult = await confirmExit(userId, 'caller1', ['SuperAdmin'], dynamoClient, 'usersTable');
        expect(confirmResult.success).toBe(false);
        expect(confirmResult.error?.code).toBe('USER_NOT_FOUND');

        const restoreResult = await restoreTracking(userId, dynamoClient, 'usersTable');
        expect(restoreResult.success).toBe(false);
        expect(restoreResult.error?.code).toBe('USER_NOT_FOUND');
      }),
      { numRuns: 100 },
    );
  });
});
