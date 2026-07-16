import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  filterEligibleUGLsForExit,
  extractActiveUserIdsForQuarter,
  computeFullyInactiveUGLs,
  ExitEligibleUser,
  ExitQualifyingRecord,
} from './eligibility';

// ============================================================
// Arbitraries
// ============================================================

const roleArb = fc.constantFrom('UserGroupLeader', 'Employee', 'SuperAdmin', 'Admin');
const rolesArb = fc.array(roleArb, { minLength: 0, maxLength: 4 });
const statusArb = fc.constantFrom('active', 'disabled', 'pending');
const uglExitStatusArb = fc.option(fc.constantFrom('pending_exit' as const), { nil: undefined });

/** Arbitrary ISO date string within a wide range, used for createdAt / quarterStart comparisons. */
const isoDateArb = fc
  .integer({ min: new Date('2015-01-01').getTime(), max: new Date('2035-12-31').getTime() })
  .map((ts) => new Date(ts).toISOString());

const userIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `u_${s}`);

const userArb: fc.Arbitrary<ExitEligibleUser> = fc.record({
  userId: userIdArb,
  nickname: fc.string({ maxLength: 10 }),
  email: fc.string({ maxLength: 10 }),
  roles: rolesArb,
  status: statusArb,
  createdAt: isoDateArb,
  uglExitStatus: uglExitStatusArb,
});

const usersArb = fc.array(userArb, { minLength: 0, maxLength: 15 });

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 2: Eligible UGL determination correctness
//
// For any list of user records with randomly generated roles, status, createdAt, and
// uglExitStatus values, and any quarterStart boundary, filterEligibleUGLsForExit returns
// exactly those users where roles contains 'UserGroupLeader' AND status === 'active' AND
// uglExitStatus !== 'pending_exit'. The createdAt condition has been removed (all UGLs are
// eligible regardless of account age).
//
// **Validates: Requirements 2.1, 2.2, 7.1**
// ============================================================
describe('Property 2: Eligible UGL determination correctness', () => {
  it('returns exactly the users satisfying eligibility conditions (no createdAt check)', () => {
    fc.assert(
      fc.property(usersArb, isoDateArb, (users, quarterStart) => {
        const result = filterEligibleUGLsForExit(users, quarterStart);

        const expected = users.filter(
          (u) =>
            u.roles.includes('UserGroupLeader') &&
            u.status === 'active' &&
            u.uglExitStatus !== 'pending_exit',
        );

        expect(new Set(result.map((u) => u.userId))).toEqual(new Set(expected.map((u) => u.userId)));
        expect(result.length).toBe(expected.length);
      }),
      { numRuns: 100 },
    );
  });

  it('every returned user satisfies all conditions individually', () => {
    fc.assert(
      fc.property(usersArb, isoDateArb, (users, quarterStart) => {
        const result = filterEligibleUGLsForExit(users, quarterStart);
        for (const u of result) {
          expect(u.roles.includes('UserGroupLeader')).toBe(true);
          expect(u.status).toBe('active');
          expect(u.uglExitStatus).not.toBe('pending_exit');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('excludes only uglExitStatus === "pending_exit"', () => {
    fc.assert(
      fc.property(isoDateArb, fc.constantFrom(undefined, 'pending_exit' as const), (quarterStart, exitStatus) => {
        const createdAt = new Date(new Date(quarterStart).getTime() + 86400000).toISOString(); // even after quarterStart
        const user: ExitEligibleUser = {
          userId: 'u1',
          nickname: 'n',
          email: 'e',
          roles: ['UserGroupLeader'],
          status: 'active',
          createdAt,
          uglExitStatus: exitStatus,
        };
        const result = filterEligibleUGLsForExit([user], quarterStart);
        if (exitStatus === 'pending_exit') {
          expect(result).toEqual([]);
        } else {
          expect(result).toEqual([user]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 3: Fully inactive UGL classification correctness
//
// For any set of eligible users and any set of ExitQualifyingRecords (with randomly varying
// targetRole, consumedForQuarter, activityDate/createdAt, and quarter-window placement),
// computeFullyInactiveUGLs(eligibleUsers, extractActiveUserIdsForQuarter(records, quarterStart,
// quarterEnd)) returns exactly the eligible users for whom zero records satisfy all of:
// targetRole === 'UserGroupLeader', consumedForQuarter is unset, and the effective date falls
// within [quarterStart, quarterEnd]. Records with any other targetRole, an already-set
// consumedForQuarter, or a date outside the window never count as evidence of activity.
//
// **Validates: Requirements 3.1, 3.2, 3.3**
// ============================================================

const targetRoleArb = fc.constantFrom('UserGroupLeader', 'SpecialActivity', 'Employee', undefined);
const consumedForQuarterArb = fc.option(fc.constantFrom('2025-Q1', '2025-Q2'), { nil: undefined });

// Quarter window fixed for these tests: 2025-Q2 -> [2025-04-01, 2025-06-30]
const QUARTER_START = '2025-04-01T00:00:00.000Z';
const QUARTER_END = '2025-06-30T23:59:59.999Z';

/** Arbitrary date string, some inside the window, some outside, both as full ISO timestamps. */
const anyDateArb = fc
  .integer({ min: new Date('2025-01-01').getTime(), max: new Date('2025-12-31').getTime() })
  .map((ts) => new Date(ts).toISOString());

const recordIdArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `r_${s}`);

const recordArb: fc.Arbitrary<ExitQualifyingRecord> = fc.record({
  recordId: recordIdArb,
  userId: userIdArb,
  targetRole: targetRoleArb,
  activityDate: fc.option(anyDateArb.map((d) => d.substring(0, 10)), { nil: undefined }),
  createdAt: anyDateArb,
  consumedForQuarter: consumedForQuarterArb,
  // Signed amount: positive earn awards and negative adjust corrections both occur, so a
  // user's activity is decided by the NET sum of their qualifying records (net > 0 = active).
  amount: fc.integer({ min: -100, max: 100 }),
});

const recordsArb = fc.array(recordArb, { minLength: 0, maxLength: 20 });

function effectiveDate(record: ExitQualifyingRecord): string | null {
  if (record.activityDate && record.activityDate.trim()) return record.activityDate.trim();
  if (record.createdAt && record.createdAt.length >= 10) return record.createdAt.substring(0, 10);
  return null;
}

function isQualifyingInWindow(record: ExitQualifyingRecord, start: string, end: string): boolean {
  if (record.targetRole !== 'UserGroupLeader') return false;
  if (record.consumedForQuarter) return false;
  const eff = effectiveDate(record);
  if (eff === null) return false;
  return eff >= start.substring(0, 10) && eff <= end.substring(0, 10);
}

/** Oracle: a user is active iff the NET sum of their qualifying-in-window records is > 0. */
function expectedActiveUserIds(records: ExitQualifyingRecord[], start: string, end: string): Set<string> {
  const netByUser = new Map<string, number>();
  for (const r of records) {
    if (!isQualifyingInWindow(r, start, end)) continue;
    netByUser.set(r.userId, (netByUser.get(r.userId) ?? 0) + (r.amount ?? 0));
  }
  const active = new Set<string>();
  for (const [userId, net] of netByUser) {
    if (net > 0) active.add(userId);
  }
  return active;
}

describe('Property 3: Fully inactive UGL classification correctness', () => {
  it('returns exactly the eligible users whose net qualifying points in the window are not positive', () => {
    fc.assert(
      fc.property(usersArb, recordsArb, (users, records) => {
        // Treat all input users as the "eligible" set for this property (eligibility
        // filtering itself is covered by Property 2) — only userId/roles/status matter here.
        const eligibleUsers = users;

        const activeUserIds = extractActiveUserIdsForQuarter(records, QUARTER_START, QUARTER_END);
        const result = computeFullyInactiveUGLs(eligibleUsers, activeUserIds);

        const expectedActiveIds = expectedActiveUserIds(records, QUARTER_START, QUARTER_END);
        const expectedFullyInactive = eligibleUsers.filter((u) => !expectedActiveIds.has(u.userId));

        expect(new Set(result.map((u) => u.userId))).toEqual(new Set(expectedFullyInactive.map((u) => u.userId)));
        expect(result.length).toBe(expectedFullyInactive.length);
      }),
      { numRuns: 100 },
    );
  });

  it('a record with non-UGL targetRole never counts as evidence of activity', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SpecialActivity', 'Employee', undefined),
        (nonUglRole) => {
          const record: ExitQualifyingRecord = {
            recordId: 'r1',
            userId: 'u1',
            targetRole: nonUglRole,
            activityDate: '2025-05-15',
            createdAt: '2025-05-15T00:00:00.000Z',
          };
          const activeUserIds = extractActiveUserIdsForQuarter([record], QUARTER_START, QUARTER_END);
          expect(activeUserIds.has('u1')).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('a record with consumedForQuarter set never counts as evidence of activity', () => {
    const record: ExitQualifyingRecord = {
      recordId: 'r1',
      userId: 'u1',
      targetRole: 'UserGroupLeader',
      activityDate: '2025-05-15',
      createdAt: '2025-05-15T00:00:00.000Z',
      consumedForQuarter: '2025-Q2',
    };
    const activeUserIds = extractActiveUserIdsForQuarter([record], QUARTER_START, QUARTER_END);
    expect(activeUserIds.has('u1')).toBe(false);
  });

  it('a record with an effective date outside the window never counts as evidence of activity', () => {
    fc.assert(
      fc.property(fc.constantFrom('2025-03-31', '2025-07-01', '2024-12-01'), (dateOutside) => {
        const record: ExitQualifyingRecord = {
          recordId: 'r1',
          userId: 'u1',
          targetRole: 'UserGroupLeader',
          activityDate: dateOutside,
          createdAt: `${dateOutside}T00:00:00.000Z`,
        };
        const activeUserIds = extractActiveUserIdsForQuarter([record], QUARTER_START, QUARTER_END);
        expect(activeUserIds.has('u1')).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('a qualifying record (UGL, unconsumed, in-window) with positive net does count as evidence of activity', () => {
    const record: ExitQualifyingRecord = {
      recordId: 'r1',
      userId: 'u1',
      targetRole: 'UserGroupLeader',
      activityDate: '2025-05-15',
      createdAt: '2025-05-15T00:00:00.000Z',
      amount: 50,
    };
    const activeUserIds = extractActiveUserIdsForQuarter([record], QUARTER_START, QUARTER_END);
    expect(activeUserIds.has('u1')).toBe(true);
  });

  it('a qualifying earn record fully reversed by an adjust in the same window nets to zero and is NOT active', () => {
    const records: ExitQualifyingRecord[] = [
      {
        recordId: 'e1',
        userId: 'u1',
        targetRole: 'UserGroupLeader',
        activityDate: '2025-05-15',
        createdAt: '2025-05-15T00:00:00.000Z',
        amount: 50,
      },
      {
        recordId: 'a1',
        userId: 'u1',
        targetRole: 'UserGroupLeader',
        activityDate: '2025-05-15',
        createdAt: '2025-06-01T00:00:00.000Z',
        amount: -50,
      },
    ];
    const activeUserIds = extractActiveUserIdsForQuarter(records, QUARTER_START, QUARTER_END);
    expect(activeUserIds.has('u1')).toBe(false);
  });
});
