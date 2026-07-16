import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// ============================================================
// Mock './reminder-tracking' — queryAwaitingReminderUGLs's own correctness (the join
// against Users/UGs) is what this file tests, not reminder-tracking.ts's Scan+
// FilterExpression outcome-filtering logic (which already has its own property tests
// in reminder-tracking.property.test.ts). Mirrors the vi.hoisted + vi.mock convention
// used by detection-job.property.test.ts for mocking a sibling ugl-exit module.
// ============================================================
const { queryAwaitingReminderRecordsMock } = vi.hoisted(() => ({
  queryAwaitingReminderRecordsMock: vi.fn(),
}));

vi.mock('./reminder-tracking', () => ({
  queryAwaitingReminderRecords: queryAwaitingReminderRecordsMock,
}));

import { queryAwaitingReminderUGLs } from './awaiting-reminder-list';

// ============================================================
// Types mirroring reminder-tracking.ts's ReminderTrackingRecord (only the fields this
// module reads: userId, quarter, outcome, createdAt).
// ============================================================

interface MockTrackingRecord {
  userId: string;
  quarter: string;
  outcome: 'awaiting_reminder' | 'pending' | 'remedied' | 'exited';
  createdAt: string;
}

interface MockUser {
  userId: string;
  nickname: string;
  email: string;
}

interface MockUG {
  leaderId: string;
  name: string;
}

// ============================================================
// Mock DynamoDB client — BatchGetCommand (Users) and ScanCommand (UGs), single page each.
// ============================================================

function createMockDynamoClient(usersTable: string, ugsTable: string, users: MockUser[], ugs: MockUG[]) {
  return {
    send: vi.fn(async (command: any) => {
      const name = command.constructor.name;

      if (name === 'BatchGetCommand') {
        const requested = command.input.RequestItems[usersTable];
        const items = requested.Keys.map((k: { userId: string }) => users.find((u) => u.userId === k.userId))
          .filter((u: MockUser | undefined): u is MockUser => u !== undefined)
          .map((u: MockUser) => ({ userId: u.userId, nickname: u.nickname, email: u.email }));
        return { Responses: { [usersTable]: items } };
      }

      if (name === 'ScanCommand') {
        expect(command.input.TableName).toBe(ugsTable);
        return { Items: ugs.map((ug) => ({ leaderId: ug.leaderId, name: ug.name })) };
      }

      throw new Error(`Unexpected command: ${name}`);
    }),
  };
}

// ============================================================
// Arbitraries
// ============================================================

const userIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `u_${s}`);
const quarterArb = fc.constantFrom('2025-Q1', '2025-Q2', '2025-Q3');
const outcomeArb = fc.constantFrom<MockTrackingRecord['outcome']>('awaiting_reminder', 'pending', 'remedied', 'exited');
const createdAtArb = fc.constantFrom(
  '2025-01-01T00:00:00.000Z',
  '2025-02-15T12:30:00.000Z',
  '2025-06-01T08:00:00.000Z',
);

const trackingRecordArb: fc.Arbitrary<MockTrackingRecord> = fc.record({
  userId: userIdArb,
  quarter: quarterArb,
  outcome: outcomeArb,
  createdAt: createdAtArb,
});

// Dedupe by (userId, quarter) — that's the tracking table's key, so a generated batch
// must not contain two records sharing a key.
const trackingRecordsArb = fc.array(trackingRecordArb, { minLength: 0, maxLength: 15 }).map((records) => {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.userId}#${r.quarter}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const userArb: fc.Arbitrary<MockUser> = fc.record({
  userId: userIdArb,
  nickname: fc.string({ maxLength: 10 }),
  email: fc.string({ maxLength: 10 }),
});

const usersArb = fc.array(userArb, { minLength: 0, maxLength: 15 }).map((users) => {
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
// Feature: ugl-inactivity-exit-flow, Property (list correctness, supports Requirement 5.1)
//
// For any set of tracking records (mixed outcomes), any set of Users records (some
// missing for userIds referenced by a tracking record), and any set of UGs records
// (leaderId -> name, where some awaiting-reminder userIds lead no UG):
// queryAwaitingReminderUGLs returns exactly the 'awaiting_reminder' tracking records
// (by userId+quarter — never a non-awaiting_reminder entry), each joined with the
// correct nickname/email (or '' when the Users record is missing) and the correct
// ugName (or '' when the user leads no UG), with recordedAt exactly equal to the
// source tracking record's createdAt.
//
// **Validates: Requirements 5.1**
// ============================================================
describe('Property: awaiting reminder list correctness', () => {
  it('returns exactly the awaiting_reminder entries with correct joined fields', async () => {
    await fc.assert(
      fc.asyncProperty(trackingRecordsArb, usersArb, ugsArb, async (trackingRecords, users, ugs) => {
        const expected = trackingRecords.filter((r) => r.outcome === 'awaiting_reminder');
        queryAwaitingReminderRecordsMock.mockReset();
        queryAwaitingReminderRecordsMock.mockResolvedValue(expected);

        const usersTable = 'UsersTable';
        const ugsTable = 'UGsTable';
        const dynamoClient = createMockDynamoClient(usersTable, ugsTable, users, ugs) as any;

        const result = await queryAwaitingReminderUGLs(dynamoClient, {
          trackingTable: 'TrackingTable',
          usersTable,
          ugsTable,
        });

        const userMap = new Map(users.map((u) => [u.userId, u]));
        const ugMap = new Map(ugs.map((ug) => [ug.leaderId, ug.name]));

        // Exactly the awaiting_reminder entries — by userId+quarter — never a
        // non-awaiting_reminder entry.
        expect(result.length).toBe(expected.length);
        expect(new Set(result.map((r) => `${r.userId}#${r.quarter}`))).toEqual(
          new Set(expected.map((r) => `${r.userId}#${r.quarter}`)),
        );

        for (const record of result) {
          const source = expected.find((r) => r.userId === record.userId && r.quarter === record.quarter);
          expect(source).toBeDefined();

          const user = userMap.get(record.userId);
          expect(record.nickname).toBe(user?.nickname ?? '');
          expect(record.email).toBe(user?.email ?? '');
          expect(record.ugName).toBe(ugMap.get(record.userId) ?? '');
          expect(record.recordedAt).toBe(source!.createdAt);
        }

        // Never any entry sourced from a non-awaiting_reminder tracking record.
        const nonAwaiting = trackingRecords.filter((r) => r.outcome !== 'awaiting_reminder');
        for (const r of nonAwaiting) {
          const found = result.find((res) => res.userId === r.userId && res.quarter === r.quarter);
          // Only fails to be "not found" if some other awaiting_reminder record happens
          // to share the same userId+quarter — impossible since keys are deduped above.
          expect(found).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
