import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateSkillClaimsInput,
  getSkillClaimsForActivity,
  buildSkillClaimTransactItems,
  VALID_SKILL_TYPES,
  type SkillClaimInput,
  type SkillClaimContext,
  type SkillType,
  type SkillClaimRecord,
} from './skill-claims';

describe('skill-claims types', () => {
  it('VALID_SKILL_TYPES contains exactly liveSupport, posterDesign, articleEditing', () => {
    expect(VALID_SKILL_TYPES).toEqual(['liveSupport', 'posterDesign', 'articleEditing']);
  });

  it('SkillClaimInput interface accepts valid shape', () => {
    const input: SkillClaimInput = { skill: 'liveSupport', userId: 'user-1' };
    expect(input.skill).toBe('liveSupport');
    expect(input.userId).toBe('user-1');
  });

  it('SkillClaimRecord interface accepts valid shape', () => {
    const record: SkillClaimRecord = {
      activityId: 'act-1',
      skill: 'articleEditing',
      userId: 'user-1',
      userNickname: 'Alice',
      claimedAt: '2024-01-01T00:00:00.000Z',
      claimedBy: 'admin-1',
      distributionId: 'dist-1',
      pointsAwarded: 30,
    };
    expect(record.activityId).toBe('act-1');
    expect(record.skill).toBe('articleEditing');
    expect(record.pointsAwarded).toBe(30);
  });
});

describe('validateSkillClaimsInput', () => {
  it('returns null for empty skillClaims array', () => {
    const result = validateSkillClaimsInput([], 'UserGroupLeader');
    expect(result).toBeNull();
  });

  it('returns null for undefined-like empty input', () => {
    const result = validateSkillClaimsInput([] as SkillClaimInput[], 'Speaker');
    expect(result).toBeNull();
  });

  it('returns null for valid single skill claim with UGL role', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).toBeNull();
  });

  it('returns null for valid two skill claims with UGL role', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-2' },
    ];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).toBeNull();
  });

  it('returns SKILL_NOT_ALLOWED_FOR_ROLE when targetRole is Speaker', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'Speaker');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('SKILL_NOT_ALLOWED_FOR_ROLE');
    expect(result!.message).toContain('UGL');
  });

  it('returns null when targetRole is Volunteer (skill claims allowed for any role)', () => {
    const claims: SkillClaimInput[] = [{ skill: 'articleEditing', userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'Volunteer');
    expect(result).toBeNull();
  });

  it('returns INVALID_SKILL_TYPE for unknown skill value', () => {
    const claims = [{ skill: 'unknownSkill' as SkillType, userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_SKILL_TYPE');
    expect(result!.message).toContain('unknownSkill');
  });

  it('returns INVALID_SKILL_TYPE for empty string skill', () => {
    const claims = [{ skill: '' as SkillType, userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('INVALID_SKILL_TYPE');
  });

  it('returns DUPLICATE_SKILL_IN_REQUEST when same skill appears twice', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'liveSupport', userId: 'user-2' },
    ];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('DUPLICATE_SKILL_IN_REQUEST');
    expect(result!.message).toContain('同一技能');
  });

  it('returns DUPLICATE_SKILL_IN_REQUEST for duplicate promoWriting', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'articleEditing', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-3' },
    ];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('DUPLICATE_SKILL_IN_REQUEST');
  });

  it('accepts userIds parameter without affecting validation', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'UserGroupLeader', ['user-1', 'user-2']);
    expect(result).toBeNull();
  });

  it('role check takes priority over other validations', () => {
    // Even with invalid skill type, role check should fire first
    const claims = [{ skill: 'invalidSkill' as SkillType, userId: 'user-1' }];
    const result = validateSkillClaimsInput(claims, 'Speaker');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('SKILL_NOT_ALLOWED_FOR_ROLE');
  });
});


// ============================================================
// Helpers
// ============================================================

const TABLE_NAME = 'PointsMall-ActivitySkillClaims';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeSkillClaimRecord(overrides: Partial<SkillClaimRecord> = {}): SkillClaimRecord {
  return {
    activityId: 'act-001',
    skill: 'liveSupport',
    userId: 'user-1',
    userNickname: 'Alice',
    claimedAt: '2024-01-15T10:00:00.000Z',
    claimedBy: 'admin-1',
    distributionId: 'dist-001',
    pointsAwarded: 30,
    ...overrides,
  };
}

// ============================================================
// getSkillClaimsForActivity
// ============================================================

describe('getSkillClaimsForActivity', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('returns skill claim records for a given activityId', async () => {
    const items = [
      makeSkillClaimRecord({ skill: 'liveSupport', userId: 'user-1' }),
      makeSkillClaimRecord({ skill: 'articleEditing', userId: 'user-2', userNickname: 'Bob' }),
    ];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getSkillClaimsForActivity('act-001', client, TABLE_NAME);

    expect(result).toHaveLength(2);
    expect(result[0].skill).toBe('liveSupport');
    expect(result[0].userId).toBe('user-1');
    expect(result[1].skill).toBe('articleEditing');
    expect(result[1].userId).toBe('user-2');
  });

  it('returns empty array when no items found (Items is empty)', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getSkillClaimsForActivity('act-no-claims', client, TABLE_NAME);

    expect(result).toEqual([]);
  });

  it('returns empty array when Items is undefined', async () => {
    client.send.mockResolvedValueOnce({ Items: undefined });

    const result = await getSkillClaimsForActivity('act-no-claims', client, TABLE_NAME);

    expect(result).toEqual([]);
  });

  it('passes correct QueryCommand parameters', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await getSkillClaimsForActivity('act-xyz', client, TABLE_NAME);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.input).toEqual({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'activityId = :aid',
      ExpressionAttributeValues: {
        ':aid': 'act-xyz',
      },
    });
  });

  it('uses the provided table name', async () => {
    const customTable = 'CustomTable-SkillClaims';
    client.send.mockResolvedValueOnce({ Items: [] });

    await getSkillClaimsForActivity('act-001', client, customTable);

    const command = client.send.mock.calls[0][0];
    expect(command.input.TableName).toBe(customTable);
  });

  it('returns single record when only one skill is claimed', async () => {
    const items = [makeSkillClaimRecord({ skill: 'articleEditing', userId: 'user-3', pointsAwarded: 50 })];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getSkillClaimsForActivity('act-001', client, TABLE_NAME);

    expect(result).toHaveLength(1);
    expect(result[0].skill).toBe('articleEditing');
    expect(result[0].pointsAwarded).toBe(50);
  });
});

// ============================================================
// buildSkillClaimTransactItems
// ============================================================

describe('buildSkillClaimTransactItems', () => {
  const baseContext: SkillClaimContext = {
    activityId: 'act-001',
    claimedBy: 'admin-1',
    distributionId: 'dist-001',
    tableName: TABLE_NAME,
    userNicknameMap: { 'user-1': 'Alice', 'user-2': 'Bob' },
    pointsConfig: { liveSupportPoints: 30, posterDesignPoints: 40, articleEditingPoints: 40 },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array for empty skillClaims', () => {
    const result = buildSkillClaimTransactItems([], baseContext);
    expect(result).toEqual([]);
  });

  it('builds a single Put item for one liveSupport claim', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          activityId: 'act-001',
          skill: 'liveSupport',
          userId: 'user-1',
          userNickname: 'Alice',
          claimedAt: '2024-06-15T12:00:00.000Z',
          claimedBy: 'admin-1',
          distributionId: 'dist-001',
          pointsAwarded: 30,
        },
        ConditionExpression: 'attribute_not_exists(activityId)',
      },
    });
  });

  it('builds a single Put item for one promoWriting claim with correct points', () => {
    const claims: SkillClaimInput[] = [{ skill: 'articleEditing', userId: 'user-2' }];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    expect(result).toHaveLength(1);
    expect(result[0]!.Put!.Item!.pointsAwarded).toBe(40);
    expect(result[0]!.Put!.Item!.skill).toBe('articleEditing');
    expect(result[0]!.Put!.Item!.userNickname).toBe('Bob');
  });

  it('builds two Put items for two different skill claims', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-2' },
    ];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    expect(result).toHaveLength(2);
    expect(result[0]!.Put!.Item!.skill).toBe('liveSupport');
    expect(result[0]!.Put!.Item!.pointsAwarded).toBe(30);
    expect(result[1]!.Put!.Item!.skill).toBe('articleEditing');
    expect(result[1]!.Put!.Item!.pointsAwarded).toBe(40);
  });

  it('includes ConditionExpression on every Put item', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-2' },
    ];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    for (const item of result) {
      expect(item.Put!.ConditionExpression).toBe('attribute_not_exists(activityId)');
    }
  });

  it('uses ISO 8601 format for claimedAt', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    const claimedAt = result[0]!.Put!.Item!.claimedAt as string;
    // ISO 8601 format check
    expect(claimedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(claimedAt).toBe('2024-06-15T12:00:00.000Z');
  });

  it('uses empty string for nickname when userId not in userNicknameMap', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'unknown-user' }];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    expect(result[0]!.Put!.Item!.userNickname).toBe('');
  });

  it('uses the provided tableName from context', () => {
    const customContext: SkillClaimContext = {
      ...baseContext,
      tableName: 'Custom-SkillClaims-Table',
    };
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = buildSkillClaimTransactItems(claims, customContext);

    expect(result[0]!.Put!.TableName).toBe('Custom-SkillClaims-Table');
  });

  it('uses pointsConfig snapshot values (not hardcoded defaults)', () => {
    const customContext: SkillClaimContext = {
      ...baseContext,
      pointsConfig: { liveSupportPoints: 100, posterDesignPoints: 200, articleEditingPoints: 200 },
    };
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-2' },
    ];
    const result = buildSkillClaimTransactItems(claims, customContext);

    expect(result[0]!.Put!.Item!.pointsAwarded).toBe(100);
    expect(result[1]!.Put!.Item!.pointsAwarded).toBe(200);
  });

  it('includes all required SkillClaimRecord fields', () => {
    const claims: SkillClaimInput[] = [{ skill: 'liveSupport', userId: 'user-1' }];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    const item = result[0]!.Put!.Item!;
    expect(item).toHaveProperty('activityId', 'act-001');
    expect(item).toHaveProperty('skill', 'liveSupport');
    expect(item).toHaveProperty('userId', 'user-1');
    expect(item).toHaveProperty('userNickname', 'Alice');
    expect(item).toHaveProperty('claimedAt');
    expect(item).toHaveProperty('claimedBy', 'admin-1');
    expect(item).toHaveProperty('distributionId', 'dist-001');
    expect(item).toHaveProperty('pointsAwarded', 30);
  });

  it('all items share the same claimedAt timestamp', () => {
    const claims: SkillClaimInput[] = [
      { skill: 'liveSupport', userId: 'user-1' },
      { skill: 'articleEditing', userId: 'user-2' },
    ];
    const result = buildSkillClaimTransactItems(claims, baseContext);

    expect(result[0]!.Put!.Item!.claimedAt).toBe(result[1]!.Put!.Item!.claimedAt);
  });
});
