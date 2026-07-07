import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { searchUsers } from './user-search';

// ============================================================
// Feature: code-user-email-distribution
// Property 8: 关键字不区分大小写匹配 (Validates: Requirements 4.1)
// Property 9: 角色过滤 (Validates: Requirements 4.2)
// Property 10: 查询结果字段完整 (Validates: Requirements 4.4)
// ============================================================

const usersTable = 'Users';

const ROLES = [
  'UserGroupLeader',
  'Speaker',
  'Volunteer',
  'Admin',
  'SuperAdmin',
  'OrderAdmin',
] as const;

// ---- Arbitraries ----

/**
 * Small alphabet for nickname/email so that random keywords frequently
 * collide with user fields — giving meaningful match coverage, while
 * still mixing case to exercise case-insensitive matching.
 */
const smallToken = fc.string({
  unit: fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '1', '2'),
  minLength: 1,
  maxLength: 6,
});

const rolesArb = fc.uniqueArray(fc.constantFrom(...ROLES), {
  minLength: 0,
  maxLength: ROLES.length,
});

const userArb = fc.record({
  userId: fc.uuid(),
  nickname: smallToken,
  email: smallToken.map((local) => `${local}@test.com`),
  roles: rolesArb,
});

/** Unique-by-userId list of users (the GSI page contents). */
const usersArb = fc.uniqueArray(userArb, {
  selector: (u) => u.userId,
  minLength: 0,
  maxLength: 15,
});

/** Keyword may be empty/whitespace or a mixed-case token. */
const keywordArb = fc.oneof(
  fc.constant(''),
  fc.constant('  '),
  fc.string({
    unit: fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C', '1', '2'),
    minLength: 1,
    maxLength: 3,
  }),
);

// ---- Mock DynamoDBDocumentClient ----

/**
 * Returns a mock client whose `send` resolves the supplied users as Items.
 * It inspects the QueryCommand input and, when a `:role` value is present
 * (i.e. searchUsers added the contains FilterExpression), emulates the
 * server-side `contains(#roles, :role)` filter — mirroring real DynamoDB.
 */
function createMockClient(users: any[]) {
  return {
    send: vi.fn().mockImplementation(async (command: any) => {
      const input = command.input ?? {};
      let items = users;
      const roleVal = input.ExpressionAttributeValues?.[':role'];
      if (roleVal !== undefined) {
        items = items.filter((u: any) => {
          const roles = Array.isArray(u.roles)
            ? u.roles
            : u.roles instanceof Set
              ? Array.from(u.roles as Set<string>)
              : [];
          return roles.includes(roleVal);
        });
      }
      return { Items: items };
    }),
  } as any;
}

// ============================================================
// Property 8: 关键字不区分大小写匹配
// ============================================================

describe('Feature: code-user-email-distribution, Property 8: 关键字不区分大小写匹配', () => {
  it('returned set equals exactly the users whose nickname or email contains the keyword (case-insensitive)', async () => {
    await fc.assert(
      fc.asyncProperty(usersArb, keywordArb, async (users, keyword) => {
        const client = createMockClient(users);
        const result = await searchUsers({ keyword }, client, usersTable);

        const kw = keyword.trim().toLowerCase();
        const expected = kw
          ? users.filter(
              (u) =>
                u.nickname.toLowerCase().includes(kw) ||
                u.email.toLowerCase().includes(kw),
            )
          : users;

        const expectedIds = new Set(expected.map((u) => u.userId));
        const resultIds = new Set(result.users.map((u) => u.userId));

        // Exact set equality: same size and same members.
        expect(resultIds.size).toBe(expectedIds.size);
        for (const id of expectedIds) {
          expect(resultIds.has(id)).toBe(true);
        }
        for (const id of resultIds) {
          expect(expectedIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('matching is case-insensitive: an upper/lower-cased keyword yields the same result set', async () => {
    await fc.assert(
      fc.asyncProperty(
        usersArb,
        fc.string({
          unit: fc.constantFrom('a', 'b', 'c'),
          minLength: 1,
          maxLength: 3,
        }),
        async (users, lowerKeyword) => {
          const lowerResult = await searchUsers(
            { keyword: lowerKeyword },
            createMockClient(users),
            usersTable,
          );
          const upperResult = await searchUsers(
            { keyword: lowerKeyword.toUpperCase() },
            createMockClient(users),
            usersTable,
          );

          const lowerIds = lowerResult.users.map((u) => u.userId).sort();
          const upperIds = upperResult.users.map((u) => u.userId).sort();
          expect(lowerIds).toEqual(upperIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: 角色过滤
// ============================================================

describe('Feature: code-user-email-distribution, Property 9: 角色过滤', () => {
  it('every returned user has the filtered role, and users lacking it are excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        usersArb,
        fc.constantFrom(...ROLES),
        async (users, role) => {
          const client = createMockClient(users);
          const result = await searchUsers({ role }, client, usersTable);

          // Every returned user must have the role.
          for (const u of result.users) {
            expect(u.roles).toContain(role);
          }

          // Completeness: every input user with the role must appear,
          // and no input user without the role may appear.
          const resultIds = new Set(result.users.map((u) => u.userId));
          for (const u of users) {
            if (u.roles.includes(role)) {
              expect(resultIds.has(u.userId)).toBe(true);
            } else {
              expect(resultIds.has(u.userId)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 10: 查询结果字段完整
// ============================================================

describe('Feature: code-user-email-distribution, Property 10: 查询结果字段完整', () => {
  it('each returned entry contains userId, nickname, email and roles', async () => {
    await fc.assert(
      fc.asyncProperty(
        usersArb,
        fc.option(fc.constantFrom(...ROLES), { nil: undefined }),
        keywordArb,
        async (users, role, keyword) => {
          const client = createMockClient(users);
          const result = await searchUsers(
            { role, keyword },
            client,
            usersTable,
          );

          for (const item of result.users) {
            expect(item).toHaveProperty('userId');
            expect(typeof item.userId).toBe('string');

            expect(item).toHaveProperty('nickname');
            expect(typeof item.nickname).toBe('string');

            expect(item).toHaveProperty('email');
            expect(typeof item.email).toBe('string');

            expect(item).toHaveProperty('roles');
            expect(Array.isArray(item.roles)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
