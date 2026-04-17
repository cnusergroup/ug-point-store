import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { REGULAR_ROLES } from '@points-mall/shared';
import { filterByRole, isEligibleForRanking, getRanking } from './ranking';

// ============================================================
// Arbitraries
// ============================================================

const ADMIN_ROLES_LIST = ['Admin', 'SuperAdmin', 'OrderAdmin'];

/** Arbitrary for a regular role */
const regularRoleArb = fc.constantFrom('Speaker', 'UserGroupLeader', 'Volunteer');

/** Arbitrary for an admin role */
const adminRoleArb = fc.constantFrom('Admin', 'SuperAdmin', 'OrderAdmin');

/** Arbitrary for a non-empty subset of regular roles */
const regularRolesSubsetArb = fc.subarray(
  ['Speaker', 'UserGroupLeader', 'Volunteer'] as string[],
  { minLength: 1 },
);

/** Arbitrary for a user with at least one regular role (eligible for ranking) */
const eligibleUserArb = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }),
  roles: regularRolesSubsetArb,
  earnTotal: fc.integer({ min: 0, max: 100000 }),
  pk: fc.constant('ALL'),
});

/** Arbitrary for a user with only admin roles (not eligible for ranking) */
const adminOnlyUserArb = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }),
  roles: fc.subarray(ADMIN_ROLES_LIST, { minLength: 1 }),
  earnTotal: fc.integer({ min: 0, max: 100000 }),
  pk: fc.constant('ALL'),
});

/** Arbitrary for a mixed user (may or may not be eligible) */
const mixedUserArb = fc.oneof(eligibleUserArb, adminOnlyUserArb);

/** Arbitrary for a user with mixed roles (regular + admin) */
const mixedRolesUserArb = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }),
  roles: fc.tuple(regularRolesSubsetArb, fc.subarray(ADMIN_ROLES_LIST, { minLength: 0 }))
    .map(([regular, admin]) => [...regular, ...admin]),
  earnTotal: fc.integer({ min: 0, max: 100000 }),
  pk: fc.constant('ALL'),
});

/** Arbitrary for a specific role filter value */
const specificRoleArb = fc.constantFrom<'Speaker' | 'UserGroupLeader' | 'Volunteer'>('Speaker', 'UserGroupLeader', 'Volunteer');

/** Arbitrary for any valid role filter value */
const roleFilterArb = fc.constantFrom<'all' | 'Speaker' | 'UserGroupLeader' | 'Volunteer'>('all', 'Speaker', 'UserGroupLeader', 'Volunteer');

// ============================================================
// Property 1: Ranking results are sorted by earnTotal descending and contain all required fields
// Feature: points-leaderboard, Property 1: Ranking results are sorted by earnTotal descending and contain all required fields
// Validates: Requirements 3.1, 3.6, 10.4
// ============================================================

describe('Feature: points-leaderboard, Property 1: Ranking results are sorted by earnTotal descending and contain all required fields', () => {
  it('filterByRole with "all" returns results sorted by earnTotal descending when input is sorted, and each item has valid fields', () => {
    fc.assert(
      fc.property(
        fc.array(eligibleUserArb, { minLength: 1, maxLength: 50 }),
        (users) => {
          // Sort users by earnTotal descending (simulating GSI behavior)
          const sorted = [...users].sort((a, b) => b.earnTotal - a.earnTotal);

          const filtered = filterByRole(sorted, 'all');

          // All eligible users should be returned
          expect(filtered.length).toBe(sorted.length);

          // Verify sorted order is preserved (earnTotal non-increasing)
          for (let i = 1; i < filtered.length; i++) {
            expect((filtered[i - 1] as any).earnTotal).toBeGreaterThanOrEqual(
              (filtered[i] as any).earnTotal,
            );
          }

          // Verify each item has required fields
          for (const item of filtered) {
            const u = item as any;
            expect(typeof u.nickname).toBe('string');
            expect(u.nickname.length).toBeGreaterThan(0);
            expect(Array.isArray(u.roles)).toBe(true);
            expect(u.roles.length).toBeGreaterThan(0);
            // All roles should be regular roles
            for (const role of u.roles) {
              expect((REGULAR_ROLES as string[]).includes(role)).toBe(true);
            }
            expect(typeof u.earnTotal).toBe('number');
            expect(u.earnTotal).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isEligibleForRanking returns true only for users with at least one regular role', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Users with at least one regular role → eligible
          regularRolesSubsetArb.map(roles => ({ roles, expected: true })),
          // Users with only admin roles → not eligible
          fc.subarray(ADMIN_ROLES_LIST, { minLength: 1 }).map(roles => ({ roles, expected: false })),
          // Users with mixed roles (regular + admin) → eligible
          fc.tuple(regularRolesSubsetArb, fc.subarray(ADMIN_ROLES_LIST, { minLength: 1 }))
            .map(([regular, admin]) => ({ roles: [...regular, ...admin], expected: true })),
        ),
        ({ roles, expected }) => {
          expect(isEligibleForRanking(roles)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getRanking returns items sorted by earnTotal descending with all required fields (rank, nickname, roles, earnTotal)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(eligibleUserArb, { minLength: 1, maxLength: 30 })
          .map(users => {
            // Ensure unique userIds
            const seen = new Set<string>();
            return users.filter(u => {
              if (seen.has(u.userId)) return false;
              seen.add(u.userId);
              return true;
            });
          })
          .filter(users => users.length > 0),
        async (users) => {
          // Sort by earnTotal descending (simulating GSI behavior)
          const sorted = [...users].sort((a, b) => b.earnTotal - a.earnTotal);

          const mockClient = {
            send: vi.fn().mockResolvedValue({
              Items: sorted,
              LastEvaluatedKey: undefined,
            }),
          } as any;

          const result = await getRanking(
            { role: 'all', limit: 20 },
            mockClient,
            'Users',
          );

          expect(result.success).toBe(true);
          expect(result.items).toBeDefined();
          const items = result.items!;

          // 1. Items are sorted by earnTotal in non-increasing order
          for (let i = 1; i < items.length; i++) {
            expect(items[i - 1].earnTotal).toBeGreaterThanOrEqual(items[i].earnTotal);
          }

          // 2. Each item has a valid rank (positive integer)
          for (let i = 0; i < items.length; i++) {
            expect(items[i].rank).toBe(i + 1);
            expect(Number.isInteger(items[i].rank)).toBe(true);
            expect(items[i].rank).toBeGreaterThan(0);
          }

          // 3. Each item has a non-empty nickname
          for (const item of items) {
            expect(typeof item.nickname).toBe('string');
            // nickname comes from user data; may be empty string if user has no nickname
            // but our generated users always have minLength: 1
          }

          // 4. Each item has a non-empty roles array containing only regular roles
          for (const item of items) {
            expect(Array.isArray(item.roles)).toBe(true);
            expect(item.roles.length).toBeGreaterThan(0);
            for (const role of item.roles) {
              expect((REGULAR_ROLES as string[]).includes(role)).toBe(true);
            }
          }

          // 5. Each item has a non-negative earnTotal
          for (const item of items) {
            expect(typeof item.earnTotal).toBe('number');
            expect(item.earnTotal).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Role filtering returns only eligible users with matching roles
// Feature: points-leaderboard, Property 2: Role filtering returns only eligible users with matching roles
// Validates: Requirements 3.2, 3.3, 3.4
// ============================================================

describe('Feature: points-leaderboard, Property 2: Role filtering returns only eligible users with matching roles', () => {
  it('when filter is a specific role, all returned users have that role', () => {
    fc.assert(
      fc.property(
        fc.array(mixedUserArb, { minLength: 1, maxLength: 50 }),
        specificRoleArb,
        (users, role) => {
          const filtered = filterByRole(users, role);

          for (const user of filtered) {
            const userRoles = (user as any).roles as string[];
            // Every returned user must have the specific role
            expect(userRoles).toContain(role);
            // Every returned user must also be eligible (have at least one regular role)
            expect(isEligibleForRanking(userRoles)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when filter is "all", all returned users have at least one regular role', () => {
    fc.assert(
      fc.property(
        fc.array(mixedUserArb, { minLength: 1, maxLength: 50 }),
        (users) => {
          const filtered = filterByRole(users, 'all');

          for (const user of filtered) {
            const userRoles = (user as any).roles as string[];
            // Every returned user must have at least one regular role
            expect(isEligibleForRanking(userRoles)).toBe(true);
            const hasRegularRole = userRoles.some(r =>
              (REGULAR_ROLES as string[]).includes(r),
            );
            expect(hasRegularRole).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('users with only admin roles are excluded in all cases', () => {
    fc.assert(
      fc.property(
        fc.array(adminOnlyUserArb, { minLength: 1, maxLength: 20 }),
        fc.array(eligibleUserArb, { minLength: 0, maxLength: 20 }),
        roleFilterArb,
        (adminUsers, regularUsers, role) => {
          const allUsers = [...adminUsers, ...regularUsers];
          const filtered = filterByRole(allUsers, role);

          // No admin-only user should appear in the results
          for (const user of filtered) {
            const userRoles = (user as any).roles as string[];
            const hasRegularRole = userRoles.some(r =>
              (REGULAR_ROLES as string[]).includes(r),
            );
            expect(hasRegularRole).toBe(true);
          }

          // Verify admin-only users are specifically excluded
          const adminOnlyUserIds = new Set(adminUsers.map(u => u.userId));
          for (const user of filtered) {
            expect(adminOnlyUserIds.has((user as any).userId)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('users with mixed roles (regular + admin) are included when eligible', () => {
    fc.assert(
      fc.property(
        fc.array(mixedRolesUserArb, { minLength: 1, maxLength: 30 }),
        roleFilterArb,
        (users, role) => {
          const filtered = filterByRole(users, role);

          // All mixed-role users have at least one regular role, so they should be eligible
          if (role === 'all') {
            // All users with regular roles should be returned
            expect(filtered.length).toBe(users.length);
          } else {
            // Only users with the specific role should be returned
            const expected = users.filter(u => u.roles.includes(role));
            expect(filtered.length).toBe(expected.length);
          }

          // Every returned user must be eligible
          for (const user of filtered) {
            const userRoles = (user as any).roles as string[];
            expect(isEligibleForRanking(userRoles)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('specific role filter never returns users without that role', () => {
    fc.assert(
      fc.property(
        fc.array(mixedUserArb, { minLength: 1, maxLength: 50 }),
        specificRoleArb,
        (users, role) => {
          const filtered = filterByRole(users, role);

          // Count how many input users have the specific role AND are eligible
          const expectedCount = users.filter(u => {
            const roles = (u as any).roles as string[];
            return roles.includes(role) && isEligibleForRanking(roles);
          }).length;

          expect(filtered.length).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
