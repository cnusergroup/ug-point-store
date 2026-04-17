import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateRankingParams,
  isEligibleForRanking,
  filterByRole,
  getRanking,
} from './ranking';

// ============================================================
// Helpers
// ============================================================

const USERS_TABLE = 'Users';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

// ============================================================
// 1. validateRankingParams
// ============================================================

describe('validateRankingParams', () => {
  // --- Valid parameters ---

  it('should return valid with default values when no params provided', () => {
    const result = validateRankingParams({});
    expect(result.valid).toBe(true);
    expect(result.options).toEqual({
      role: 'all',
      limit: 20,
    });
  });

  it('should accept explicit valid role and limit', () => {
    const result = validateRankingParams({ role: 'Speaker', limit: '30' });
    expect(result.valid).toBe(true);
    expect(result.options).toEqual({
      role: 'Speaker',
      limit: 30,
    });
  });

  it('should accept role=UserGroupLeader', () => {
    const result = validateRankingParams({ role: 'UserGroupLeader' });
    expect(result.valid).toBe(true);
    expect(result.options!.role).toBe('UserGroupLeader');
  });

  it('should accept role=Volunteer', () => {
    const result = validateRankingParams({ role: 'Volunteer' });
    expect(result.valid).toBe(true);
    expect(result.options!.role).toBe('Volunteer');
  });

  it('should accept limit at boundary (1)', () => {
    const result = validateRankingParams({ limit: '1' });
    expect(result.valid).toBe(true);
    expect(result.options!.limit).toBe(1);
  });

  it('should accept limit at boundary (50)', () => {
    const result = validateRankingParams({ limit: '50' });
    expect(result.valid).toBe(true);
    expect(result.options!.limit).toBe(50);
  });

  // --- Invalid role ---

  it('should reject invalid role value', () => {
    const result = validateRankingParams({ role: 'Admin' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject unknown role value', () => {
    const result = validateRankingParams({ role: 'Unknown' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  // --- Invalid limit ---

  it('should reject limit of 0', () => {
    const result = validateRankingParams({ limit: '0' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject limit of 51', () => {
    const result = validateRankingParams({ limit: '51' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject negative limit', () => {
    const result = validateRankingParams({ limit: '-5' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-numeric limit', () => {
    const result = validateRankingParams({ limit: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  // --- lastKey ---

  it('should reject invalid base64 lastKey', () => {
    const result = validateRankingParams({ lastKey: '!!!not-valid-base64!!!' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });

  it('should reject lastKey that is valid base64 but not valid JSON', () => {
    const notJson = Buffer.from('this is not json').toString('base64');
    const result = validateRankingParams({ lastKey: notJson });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });

  it('should accept valid base64-encoded JSON lastKey', () => {
    const key = { pk: 'ALL', earnTotal: 100, userId: 'u1' };
    const encoded = Buffer.from(JSON.stringify(key)).toString('base64');
    const result = validateRankingParams({ lastKey: encoded });
    expect(result.valid).toBe(true);
    expect(result.options!.lastKey).toBe(encoded);
  });

  it('should ignore empty lastKey', () => {
    const result = validateRankingParams({ lastKey: '' });
    expect(result.valid).toBe(true);
    expect(result.options!.lastKey).toBeUndefined();
  });
});

// ============================================================
// 2. isEligibleForRanking
// ============================================================

describe('isEligibleForRanking', () => {
  it('should return false for pure admin roles', () => {
    expect(isEligibleForRanking(['Admin'])).toBe(false);
    expect(isEligibleForRanking(['SuperAdmin'])).toBe(false);
    expect(isEligibleForRanking(['Admin', 'SuperAdmin'])).toBe(false);
  });

  it('should return false for OrderAdmin only', () => {
    expect(isEligibleForRanking(['OrderAdmin'])).toBe(false);
  });

  it('should return true when user has a regular role', () => {
    expect(isEligibleForRanking(['Speaker'])).toBe(true);
    expect(isEligibleForRanking(['UserGroupLeader'])).toBe(true);
    expect(isEligibleForRanking(['Volunteer'])).toBe(true);
  });

  it('should return false for empty roles', () => {
    expect(isEligibleForRanking([])).toBe(false);
  });

  it('should return true for mixed roles (regular + admin)', () => {
    expect(isEligibleForRanking(['Admin', 'Speaker'])).toBe(true);
    expect(isEligibleForRanking(['SuperAdmin', 'Volunteer'])).toBe(true);
    expect(isEligibleForRanking(['OrderAdmin', 'UserGroupLeader'])).toBe(true);
  });
});

// ============================================================
// 3. filterByRole
// ============================================================

describe('filterByRole', () => {
  const users = [
    { userId: 'u1', roles: ['Speaker'], nickname: 'Alice', earnTotal: 300 },
    { userId: 'u2', roles: ['UserGroupLeader', 'Speaker'], nickname: 'Bob', earnTotal: 200 },
    { userId: 'u3', roles: ['Volunteer'], nickname: 'Charlie', earnTotal: 100 },
    { userId: 'u4', roles: ['Admin'], nickname: 'AdminOnly', earnTotal: 500 },
    { userId: 'u5', roles: ['Admin', 'Speaker'], nickname: 'AdminSpeaker', earnTotal: 400 },
    { userId: 'u6', roles: ['OrderAdmin'], nickname: 'OrderAdminOnly', earnTotal: 50 },
  ];

  it('should filter by specific role (Speaker)', () => {
    const result = filterByRole(users, 'Speaker');
    expect(result).toHaveLength(3); // u1, u2, u5
    expect(result.map(u => u.userId)).toEqual(
      expect.arrayContaining(['u1', 'u2', 'u5']),
    );
  });

  it('should filter by specific role (UserGroupLeader)', () => {
    const result = filterByRole(users, 'UserGroupLeader');
    expect(result).toHaveLength(1); // u2
    expect((result[0] as any).userId).toBe('u2');
  });

  it('should filter by specific role (Volunteer)', () => {
    const result = filterByRole(users, 'Volunteer');
    expect(result).toHaveLength(1); // u3
    expect((result[0] as any).userId).toBe('u3');
  });

  it('should return all eligible users when role is "all"', () => {
    const result = filterByRole(users, 'all');
    // u1 (Speaker), u2 (UGL+Speaker), u3 (Volunteer), u5 (Admin+Speaker) — all have regular roles
    // u4 (Admin only) and u6 (OrderAdmin only) excluded
    expect(result).toHaveLength(4);
    const ids = result.map(u => (u as any).userId);
    expect(ids).toContain('u1');
    expect(ids).toContain('u2');
    expect(ids).toContain('u3');
    expect(ids).toContain('u5');
  });

  it('should exclude admin-only users', () => {
    const result = filterByRole(users, 'all');
    const ids = result.map(u => (u as any).userId);
    expect(ids).not.toContain('u4'); // Admin only
    expect(ids).not.toContain('u6'); // OrderAdmin only
  });

  it('should handle users with undefined roles', () => {
    const usersWithUndefined = [
      { userId: 'u1', nickname: 'NoRoles', earnTotal: 10 },
    ];
    const result = filterByRole(usersWithUndefined, 'all');
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// 4. getRanking — integration with mock DynamoDB
// ============================================================

describe('getRanking', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ranked items sorted by earnTotal descending', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { userId: 'u1', pk: 'ALL', earnTotal: 300, nickname: 'Alice', roles: ['Speaker'] },
        { userId: 'u2', pk: 'ALL', earnTotal: 200, nickname: 'Bob', roles: ['Volunteer'] },
        { userId: 'u3', pk: 'ALL', earnTotal: 100, nickname: 'Charlie', roles: ['UserGroupLeader'] },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getRanking(
      { role: 'all', limit: 20 },
      client,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items![0].nickname).toBe('Alice');
    expect(result.items![0].rank).toBe(1);
    expect(result.items![0].earnTotal).toBe(300);
    expect(result.items![1].rank).toBe(2);
    expect(result.items![2].rank).toBe(3);
  });

  it('should filter out admin-only users from results', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { userId: 'u1', pk: 'ALL', earnTotal: 500, nickname: 'AdminOnly', roles: ['Admin'] },
        { userId: 'u2', pk: 'ALL', earnTotal: 300, nickname: 'Speaker', roles: ['Speaker'] },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getRanking(
      { role: 'all', limit: 20 },
      client,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].nickname).toBe('Speaker');
  });

  it('should only include regular roles in the roles array of each item', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { userId: 'u1', pk: 'ALL', earnTotal: 300, nickname: 'Mixed', roles: ['Admin', 'Speaker', 'Volunteer'] },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getRanking(
      { role: 'all', limit: 20 },
      client,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.items![0].roles).toEqual(['Speaker', 'Volunteer']);
    expect(result.items![0].roles).not.toContain('Admin');
  });

  it('should return null lastKey when no more data', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { userId: 'u1', pk: 'ALL', earnTotal: 100, nickname: 'Alice', roles: ['Speaker'] },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getRanking(
      { role: 'all', limit: 20 },
      client,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeNull();
  });

  it('should return error for invalid lastKey in getRanking', async () => {
    const result = await getRanking(
      { role: 'all', limit: 20, lastKey: 'invalid-base64!!' },
      client,
      USERS_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });
});
