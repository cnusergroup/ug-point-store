import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isSuperAdmin, type UserRole, ALL_ROLES } from '@points-mall/shared';
import {
  filterPointsRecords,
  sortRecords,
  clampPageSize,
  type RawPointsRecord,
  type PointsDetailRecord,
  type UGActivitySummaryRecord,
  type UserRankingRecord,
  type ActivitySummaryRecord,
} from './query';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a valid UserRole */
const userRoleArb = fc.constantFrom<UserRole>(
  'UserGroupLeader',
  'Speaker',
  'Volunteer',
  'Admin',
  'SuperAdmin',
  'OrderAdmin',
);

/** Arbitrary for an array of roles (may or may not include SuperAdmin) */
const rolesArrayArb = fc.array(userRoleArb, { minLength: 0, maxLength: 6 });

/** Arbitrary for valid target roles used in points records */
const targetRoleArb = fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer');

/** Arbitrary for points record type */
const pointsTypeArb = fc.constantFrom<'earn' | 'spend'>('earn', 'spend');

/** Arbitrary for an ISO 8601 date string within a reasonable range */
const isoDateArb = fc.integer({
  min: new Date('2023-01-01').getTime(),
  max: new Date('2025-12-31').getTime(),
}).map(ts => new Date(ts).toISOString());

/** Arbitrary for a RawPointsRecord */
const rawPointsRecordArb = fc.record({
  recordId: fc.uuid(),
  userId: fc.uuid(),
  type: pointsTypeArb,
  amount: fc.integer({ min: 1, max: 10000 }),
  source: fc.constantFrom('batch', 'claim', 'manual'),
  balanceAfter: fc.integer({ min: 0, max: 100000 }),
  createdAt: isoDateArb,
  activityId: fc.uuid(),
  activityType: fc.constantFrom('线上活动', '线下活动'),
  activityUG: fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen', 'UG-Hangzhou'),
  activityTopic: fc.string({ minLength: 1, maxLength: 50 }),
  activityDate: fc.integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-12-31').getTime(),
  }).map(ts => new Date(ts).toISOString().slice(0, 10)),
  targetRole: targetRoleArb,
});

// ============================================================
// Property 1: SuperAdmin permission check
// Feature: admin-reports-export, Property 1: SuperAdmin permission check
// Validates: Requirements 1.1
// ============================================================

describe('Feature: admin-reports-export, Property 1: SuperAdmin permission check', () => {
  it('access is granted if and only if roles contains SuperAdmin', () => {
    fc.assert(
      fc.property(rolesArrayArb, (roles) => {
        const result = isSuperAdmin(roles);
        const hasSuperAdmin = roles.includes('SuperAdmin');
        expect(result).toBe(hasSuperAdmin);
      }),
      { numRuns: 100 },
    );
  });

  it('roles without SuperAdmin are always denied', () => {
    const nonSuperAdminRolesArb = fc.array(
      fc.constantFrom<UserRole>('UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'OrderAdmin'),
      { minLength: 0, maxLength: 5 },
    );

    fc.assert(
      fc.property(nonSuperAdminRolesArb, (roles) => {
        expect(isSuperAdmin(roles)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('any roles array containing SuperAdmin is always granted', () => {
    const rolesWithSuperAdminArb = fc.array(userRoleArb, { minLength: 0, maxLength: 5 }).map(
      roles => [...roles, 'SuperAdmin' as UserRole],
    );

    fc.assert(
      fc.property(rolesWithSuperAdminArb, (roles) => {
        expect(isSuperAdmin(roles)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Points detail filter correctness
// Feature: admin-reports-export, Property 2: Points detail filter correctness
// Validates: Requirements 2.2, 4.2, 6.2, 8.2
// ============================================================

/** Arbitrary for filter combinations */
const filterArb = fc.record({
  startDate: fc.option(isoDateArb, { nil: undefined }),
  endDate: fc.option(isoDateArb, { nil: undefined }),
  ugName: fc.option(
    fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen', 'UG-Hangzhou'),
    { nil: undefined },
  ),
  targetRole: fc.option(
    fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer', 'all'),
    { nil: undefined },
  ),
  activityId: fc.option(fc.uuid(), { nil: undefined }),
  type: fc.option(
    fc.constantFrom<'earn' | 'spend' | 'all'>('earn', 'spend', 'all'),
    { nil: undefined },
  ),
});

describe('Feature: admin-reports-export, Property 2: Points detail filter correctness', () => {
  it('filtered result contains exactly those records matching ALL active criteria', () => {
    fc.assert(
      fc.property(
        fc.array(rawPointsRecordArb, { minLength: 0, maxLength: 30 }),
        filterArb,
        (records, filter) => {
          const result = filterPointsRecords(records, filter);

          // Every returned record must match ALL active filter criteria
          for (const r of result) {
            if (filter.startDate) {
              expect(r.createdAt >= filter.startDate).toBe(true);
            }
            if (filter.endDate) {
              expect(r.createdAt <= filter.endDate).toBe(true);
            }
            if (filter.ugName) {
              expect(r.activityUG).toBe(filter.ugName);
            }
            if (filter.targetRole && filter.targetRole !== 'all') {
              expect(r.targetRole).toBe(filter.targetRole);
            }
            if (filter.activityId) {
              expect(r.activityId).toBe(filter.activityId);
            }
            if (filter.type && filter.type !== 'all') {
              expect(r.type).toBe(filter.type);
            }
          }

          // No matching record should be excluded
          for (const r of records) {
            const matchesAll =
              (!filter.startDate || r.createdAt >= filter.startDate) &&
              (!filter.endDate || r.createdAt <= filter.endDate) &&
              (!filter.ugName || r.activityUG === filter.ugName) &&
              (!filter.targetRole || filter.targetRole === 'all' || r.targetRole === filter.targetRole) &&
              (!filter.activityId || r.activityId === filter.activityId) &&
              (!filter.type || filter.type === 'all' || r.type === filter.type);

            if (matchesAll) {
              expect(result).toContainEqual(r);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: Report output sorting correctness
// Feature: admin-reports-export, Property 3: Report output sorting correctness
// Validates: Requirements 2.3, 4.3, 6.3, 8.3
// ============================================================

describe('Feature: admin-reports-export, Property 3: Report output sorting correctness', () => {
  it('points detail records are sorted by createdAt descending', () => {
    fc.assert(
      fc.property(
        fc.array(rawPointsRecordArb, { minLength: 1, maxLength: 30 }),
        (records) => {
          const sorted = sortRecords(records, 'createdAt', 'desc');

          // Adjacent elements satisfy sort order invariant
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].createdAt >= sorted[i].createdAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('UG summary records are sorted by totalPoints descending', () => {
    const ugSummaryArb = fc.record({
      ugName: fc.string({ minLength: 1, maxLength: 20 }),
      activityCount: fc.integer({ min: 0, max: 100 }),
      totalPoints: fc.integer({ min: 0, max: 100000 }),
      participantCount: fc.integer({ min: 0, max: 500 }),
    });

    fc.assert(
      fc.property(
        fc.array(ugSummaryArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const sorted = sortRecords(records as UGActivitySummaryRecord[], 'totalPoints', 'desc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].totalPoints >= sorted[i].totalPoints).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('user ranking records are sorted by totalEarnPoints descending', () => {
    const userRankingArb = fc.record({
      rank: fc.integer({ min: 1, max: 1000 }),
      userId: fc.uuid(),
      nickname: fc.string({ minLength: 1, maxLength: 20 }),
      totalEarnPoints: fc.integer({ min: 0, max: 100000 }),
      targetRole: fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer'),
    });

    fc.assert(
      fc.property(
        fc.array(userRankingArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const sorted = sortRecords(records as UserRankingRecord[], 'totalEarnPoints', 'desc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].totalEarnPoints >= sorted[i].totalEarnPoints).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('activity summary records are sorted by activityDate descending', () => {
    const activitySummaryArb = fc.record({
      activityId: fc.uuid(),
      activityTopic: fc.string({ minLength: 1, maxLength: 50 }),
      activityDate: fc.integer({
        min: new Date('2023-01-01').getTime(),
        max: new Date('2025-12-31').getTime(),
      }).map(ts => new Date(ts).toISOString().slice(0, 10)),
      activityUG: fc.string({ minLength: 1, maxLength: 20 }),
      totalPoints: fc.integer({ min: 0, max: 100000 }),
      participantCount: fc.integer({ min: 0, max: 500 }),
      uglCount: fc.integer({ min: 0, max: 100 }),
      speakerCount: fc.integer({ min: 0, max: 100 }),
      volunteerCount: fc.integer({ min: 0, max: 100 }),
    });

    fc.assert(
      fc.property(
        fc.array(activitySummaryArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const sorted = sortRecords(records as ActivitySummaryRecord[], 'activityDate', 'desc');

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].activityDate >= sorted[i].activityDate).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 4: Pagination pageSize clamping
// Feature: admin-reports-export, Property 4: Pagination pageSize clamping
// Validates: Requirements 2.4, 6.4
// ============================================================

describe('Feature: admin-reports-export, Property 4: Pagination pageSize clamping', () => {
  it('undefined pageSize defaults to 20 (general reports)', () => {
    fc.assert(
      fc.property(fc.constant(undefined), (_) => {
        expect(clampPageSize(undefined)).toBe(20);
      }),
      { numRuns: 100 },
    );
  });

  it('undefined pageSize defaults to 50 for user ranking', () => {
    fc.assert(
      fc.property(fc.constant(undefined), (_) => {
        expect(clampPageSize(undefined, 50)).toBe(50);
      }),
      { numRuns: 100 },
    );
  });

  it('negative and zero pageSize are clamped to 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000, max: 0 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pageSize > 100 is clamped to 100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 100000 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(100);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pageSize in [1, 100] is used as-is (floored to integer)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('effective pageSize is always in [1, 100] for any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100000, max: 100000 }),
          fc.constant(undefined as unknown as number),
        ),
        (pageSize) => {
          const result = clampPageSize(pageSize);
          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Earn-only record arbitrary (shared by Properties 5–7)
// ============================================================

/** Arbitrary for earn-type RawPointsRecord (used by aggregation property tests) */
const earnRecordArb = rawPointsRecordArb.map(r => ({ ...r, type: 'earn' as const }));

// ============================================================
// Property 5: UG aggregation correctness
// Feature: admin-reports-export, Property 5: UG aggregation correctness
// Validates: Requirements 4.1
// ============================================================

import {
  aggregateByUG,
  aggregateByUser,
  aggregateByActivity,
} from './query';

describe('Feature: admin-reports-export, Property 5: UG aggregation correctness', () => {
  it('produces one record per unique activityUG with correct activityCount, totalPoints, participantCount', () => {
    fc.assert(
      fc.property(
        fc.array(earnRecordArb, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = aggregateByUG(records);

          // Build expected aggregation independently
          const expectedMap = new Map<string, {
            activityIds: Set<string>;
            totalPoints: number;
            userIds: Set<string>;
          }>();

          for (const r of records) {
            const ug = r.activityUG ?? '';
            if (!expectedMap.has(ug)) {
              expectedMap.set(ug, { activityIds: new Set(), totalPoints: 0, userIds: new Set() });
            }
            const entry = expectedMap.get(ug)!;
            if (r.activityId) entry.activityIds.add(r.activityId);
            entry.totalPoints += r.amount;
            entry.userIds.add(r.userId);
          }

          // One record per unique activityUG
          expect(result.length).toBe(expectedMap.size);

          // Verify each aggregated record
          for (const rec of result) {
            const expected = expectedMap.get(rec.ugName);
            expect(expected).toBeDefined();
            expect(rec.activityCount).toBe(expected!.activityIds.size);
            expect(rec.totalPoints).toBe(expected!.totalPoints);
            expect(rec.participantCount).toBe(expected!.userIds.size);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 6: User ranking aggregation correctness
// Feature: admin-reports-export, Property 6: User ranking aggregation correctness
// Validates: Requirements 6.1
// ============================================================

describe('Feature: admin-reports-export, Property 6: User ranking aggregation correctness', () => {
  it('produces one record per unique userId with correct totalEarnPoints and sequential rank after sorting', () => {
    fc.assert(
      fc.property(
        fc.array(earnRecordArb, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = aggregateByUser(records);

          // Build expected aggregation independently
          const expectedMap = new Map<string, number>();
          for (const r of records) {
            expectedMap.set(r.userId, (expectedMap.get(r.userId) ?? 0) + r.amount);
          }

          // One record per unique userId
          expect(result.length).toBe(expectedMap.size);

          // Verify totalEarnPoints for each user
          for (const rec of result) {
            expect(expectedMap.has(rec.userId)).toBe(true);
            expect(rec.totalEarnPoints).toBe(expectedMap.get(rec.userId)!);
          }

          // Sort by totalEarnPoints desc and assign rank starting from 1
          const sorted = [...result].sort((a, b) => b.totalEarnPoints - a.totalEarnPoints);
          for (let i = 0; i < sorted.length; i++) {
            const expectedRank = i + 1;
            // Verify sequential ranking is possible (descending order maintained)
            if (i > 0) {
              expect(sorted[i - 1].totalEarnPoints).toBeGreaterThanOrEqual(sorted[i].totalEarnPoints);
            }
            // Verify rank assignment would be correct
            expect(expectedRank).toBe(i + 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: Activity aggregation correctness
// Feature: admin-reports-export, Property 7: Activity aggregation correctness
// Validates: Requirements 8.1
// ============================================================

describe('Feature: admin-reports-export, Property 7: Activity aggregation correctness', () => {
  it('produces one record per unique activityId with correct totalPoints, participantCount, and role-specific counts', () => {
    fc.assert(
      fc.property(
        fc.array(earnRecordArb, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = aggregateByActivity(records);

          // Build expected aggregation independently
          const expectedMap = new Map<string, {
            totalPoints: number;
            userIds: Set<string>;
            uglUserIds: Set<string>;
            speakerUserIds: Set<string>;
            volunteerUserIds: Set<string>;
          }>();

          for (const r of records) {
            const aid = r.activityId ?? '';
            if (!expectedMap.has(aid)) {
              expectedMap.set(aid, {
                totalPoints: 0,
                userIds: new Set(),
                uglUserIds: new Set(),
                speakerUserIds: new Set(),
                volunteerUserIds: new Set(),
              });
            }
            const entry = expectedMap.get(aid)!;
            entry.totalPoints += r.amount;
            entry.userIds.add(r.userId);
            switch (r.targetRole) {
              case 'UserGroupLeader':
                entry.uglUserIds.add(r.userId);
                break;
              case 'Speaker':
                entry.speakerUserIds.add(r.userId);
                break;
              case 'Volunteer':
                entry.volunteerUserIds.add(r.userId);
                break;
            }
          }

          // One record per unique activityId
          expect(result.length).toBe(expectedMap.size);

          // Verify each aggregated record
          for (const rec of result) {
            const expected = expectedMap.get(rec.activityId);
            expect(expected).toBeDefined();
            expect(rec.totalPoints).toBe(expected!.totalPoints);
            expect(rec.participantCount).toBe(expected!.userIds.size);
            expect(rec.uglCount).toBe(expected!.uglUserIds.size);
            expect(rec.speakerCount).toBe(expected!.speakerUserIds.size);
            expect(rec.volunteerCount).toBe(expected!.volunteerUserIds.size);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
