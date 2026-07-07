import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { queryPendingExitUGLs } from './pending-exit-list';

// ============================================================
// Mock DynamoDB client
// ============================================================

interface MockUser {
  userId: string;
  nickname: string;
  email: string;
  uglExitStatus?: 'pending_exit';
  uglExitTriggeredQuarter?: string;
  uglExitMarkedAt?: string;
}

interface MockUG {
  leaderId: string;
  name: string;
}

function createMockDynamoClient(users: MockUser[], ugs: MockUG[]) {
  return {
    send: vi.fn(async (command: any) => {
      const commandName = command.constructor.name;

      if (commandName === 'QueryCommand') {
        // Users table query — filter to uglExitStatus = 'pending_exit'
        const pending = users.filter((u) => u.uglExitStatus === 'pending_exit');
        return {
          Items: pending.map((u) => ({
            userId: u.userId,
            nickname: u.nickname,
            email: u.email,
            uglExitTriggeredQuarter: u.uglExitTriggeredQuarter,
            uglExitMarkedAt: u.uglExitMarkedAt,
          })),
        };
      }

      if (commandName === 'ScanCommand') {
        // UGs table scan — leaderId -> ugName
        return {
          Items: ugs.map((ug) => ({ leaderId: ug.leaderId, name: ug.name })),
        };
      }

      throw new Error(`Unexpected command: ${commandName}`);
    }),
  };
}

// ============================================================
// Arbitraries
// ============================================================

const userIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `u_${s}`);

const mockUserArb: fc.Arbitrary<MockUser> = fc.record({
  userId: userIdArb,
  nickname: fc.string({ maxLength: 10 }),
  email: fc.string({ maxLength: 10 }),
  uglExitStatus: fc.option(fc.constantFrom('pending_exit' as const), { nil: undefined }),
  uglExitTriggeredQuarter: fc.constantFrom('2025-Q1', '2025-Q2', '2025-Q3'),
  uglExitMarkedAt: fc.constant('2025-05-01T00:00:00.000Z'),
});

// Ensure unique userIds within a generated set to keep the mapping deterministic.
const usersArb = fc
  .array(mockUserArb, { minLength: 0, maxLength: 15 })
  .map((users) => {
    const seen = new Set<string>();
    return users.filter((u) => {
      if (seen.has(u.userId)) return false;
      seen.add(u.userId);
      return true;
    });
  });

const ugArb: fc.Arbitrary<MockUG> = fc.record({
  leaderId: userIdArb,
  name: fc.string({ minLength: 1, maxLength: 10 }),
});

const ugsArb = fc.array(ugArb, { minLength: 0, maxLength: 10 });

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 11: Pending exit list correctness
//
// For any set of user records (with randomly varying uglExitStatus, uglExitTriggeredQuarter,
// uglExitMarkedAt) and any set of UG records (leaderId -> name), queryPendingExitUGLs returns
// exactly one PendingExitRecord per user whose uglExitStatus === 'pending_exit', with
// nickname/email/triggeredQuarter/markedAt carried through from the user record, and ugName
// set to the matching UG's name when the user leads a UG, or '' when the user leads no UG.
//
// **Validates: Requirements 9.1**
// ============================================================
describe('Property 11: Pending exit list correctness', () => {
  it('returns exactly the pending-exit users with correct field mapping and UG name lookup', async () => {
    await fc.assert(
      fc.asyncProperty(usersArb, ugsArb, async (users, ugs) => {
        const dynamoClient = createMockDynamoClient(users, ugs) as any;
        const result = await queryPendingExitUGLs(dynamoClient, {
          usersTable: 'UsersTable',
          ugsTable: 'UGsTable',
        });

        const expectedPending = users.filter((u) => u.uglExitStatus === 'pending_exit');
        const ugMap = new Map(ugs.map((ug) => [ug.leaderId, ug.name]));

        expect(result.length).toBe(expectedPending.length);
        expect(new Set(result.map((r) => r.userId))).toEqual(new Set(expectedPending.map((u) => u.userId)));

        for (const record of result) {
          const sourceUser = expectedPending.find((u) => u.userId === record.userId);
          expect(sourceUser).toBeDefined();
          expect(record.nickname).toBe(sourceUser!.nickname);
          expect(record.email).toBe(sourceUser!.email);
          expect(record.triggeredQuarter).toBe(sourceUser!.uglExitTriggeredQuarter);
          expect(record.markedAt).toBe(sourceUser!.uglExitMarkedAt);
          expect(record.ugName).toBe(ugMap.get(record.userId) ?? '');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a non-pending-exit user is never included in the result', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(undefined), async (exitStatus) => {
        const user: MockUser = {
          userId: 'u1',
          nickname: 'n',
          email: 'e',
          uglExitStatus: exitStatus,
          uglExitTriggeredQuarter: '2025-Q1',
          uglExitMarkedAt: '2025-05-01T00:00:00.000Z',
        };
        const dynamoClient = createMockDynamoClient([user], []) as any;
        const result = await queryPendingExitUGLs(dynamoClient, {
          usersTable: 'UsersTable',
          ugsTable: 'UGsTable',
        });
        expect(result).toEqual([]);
      }),
      { numRuns: 10 },
    );
  });
});
