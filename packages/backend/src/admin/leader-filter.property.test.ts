import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterAdminUsers, AdminUser } from './leader-filter';

// ============================================================
// Feature: ug-leader-assignment, Property 4: Admin user search filter matches on nickname or email
// **Validates: Requirements 5.4**
// ============================================================

// ============================================================
// Arbitraries
// ============================================================

/** Generate a random AdminUser */
const adminUserArb: fc.Arbitrary<AdminUser> = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  email: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z0-9]+$/.test(s)),
      fc.constantFrom('example.com', 'test.org', 'mail.co', 'company.io'),
    )
    .map(([local, domain]) => `${local}@${domain}`),
});

/** Generate a list of AdminUsers (0–20) */
const adminUserListArb = fc.array(adminUserArb, { minLength: 0, maxLength: 20 });

/** Generate a search query that may be empty, whitespace, or a real string */
const searchQueryArb = fc.oneof(
  fc.constant(''),
  fc.constant('  '),
  fc.constant('\t'),
  fc.string({ minLength: 1, maxLength: 15 }),
);

// ============================================================
// Tests
// ============================================================

describe('Feature: ug-leader-assignment, Property 4: Admin user search filter matches on nickname or email', () => {
  // ----------------------------------------------------------
  // 4a: Returned results are exactly those users whose nickname
  //     or email contains the search query (case-insensitive)
  // ----------------------------------------------------------
  it('returned results contain only users whose nickname or email matches the query (case-insensitive)', () => {
    fc.assert(
      fc.property(adminUserListArb, searchQueryArb, (users, query) => {
        const result = filterAdminUsers(users, query);
        const keyword = query.trim().toLowerCase();

        if (!keyword) {
          // Empty/whitespace query → all users returned (tested separately)
          return;
        }

        for (const user of result) {
          const matchesNickname = user.nickname.toLowerCase().includes(keyword);
          const matchesEmail = user.email.toLowerCase().includes(keyword);
          expect(matchesNickname || matchesEmail).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 4b: No matching user is excluded from results (completeness)
  // ----------------------------------------------------------
  it('no user that matches the query is excluded from results', () => {
    fc.assert(
      fc.property(adminUserListArb, searchQueryArb, (users, query) => {
        const result = filterAdminUsers(users, query);
        const resultIds = new Set(result.map((u) => u.userId));
        const keyword = query.trim().toLowerCase();

        for (const user of users) {
          if (!keyword) {
            // All users should be included
            expect(resultIds.has(user.userId)).toBe(true);
          } else {
            const matchesNickname = user.nickname.toLowerCase().includes(keyword);
            const matchesEmail = user.email.toLowerCase().includes(keyword);
            if (matchesNickname || matchesEmail) {
              expect(resultIds.has(user.userId)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 4c: When search query is empty or whitespace-only, all users
  //     are returned
  // ----------------------------------------------------------
  it('when search query is empty or whitespace-only, all users are returned', () => {
    fc.assert(
      fc.property(
        adminUserListArb,
        fc.constantFrom('', ' ', '  ', '\t', '   '),
        (users, query) => {
          const result = filterAdminUsers(users, query);
          expect(result.length).toBe(users.length);

          const resultIds = new Set(result.map((u) => u.userId));
          for (const user of users) {
            expect(resultIds.has(user.userId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 4d: Result is always a subset of the input users
  // ----------------------------------------------------------
  it('result is always a subset of the input users', () => {
    fc.assert(
      fc.property(adminUserListArb, searchQueryArb, (users, query) => {
        const result = filterAdminUsers(users, query);
        const inputIds = new Set(users.map((u) => u.userId));

        expect(result.length).toBeLessThanOrEqual(users.length);
        for (const user of result) {
          expect(inputIds.has(user.userId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 4e: Searching with a substring from a user's nickname always
  //     includes that user
  // ----------------------------------------------------------
  it('searching with a substring from a users nickname always includes that user', () => {
    fc.assert(
      fc.property(
        adminUserListArb.filter((users) => users.length > 0),
        (users) => {
          // Pick the first user and use a substring of their nickname as query
          const target = users[0];
          if (target.nickname.length === 0) return;
          const substringQuery = target.nickname.substring(
            0,
            Math.max(1, Math.floor(target.nickname.length / 2)),
          );

          const result = filterAdminUsers(users, substringQuery);
          const resultIds = new Set(result.map((u) => u.userId));
          expect(resultIds.has(target.userId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
