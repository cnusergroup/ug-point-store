import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateBatchDistributionInput,
  executeBatchDistribution,
  listDistributionHistory,
  getDistributionDetail,
  filterUsersBySearch,
  clampPageSize,
  type BatchDistributionInput,
  type SearchableUser,
} from './batch-points';

// ============================================================
// Helpers
// ============================================================

const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';
const BATCH_DISTRIBUTIONS_TABLE = 'BatchDistributions';
const TABLES = {
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeValidInput(overrides: Partial<BatchDistributionInput> = {}): BatchDistributionInput {
  return {
    userIds: ['user-001', 'user-002'],
    points: 100,
    reason: '季度活动奖励',
    targetRole: 'Speaker',
    speakerType: 'typeA',
    distributorId: 'admin-001',
    distributorNickname: 'AdminUser',
    activityId: 'act-001',
    activityType: '线下活动',
    activityUG: 'Tokyo',
    activityTopic: 'AWS Summit',
    activityDate: '2024-06-15',
    ...overrides,
  };
}

// ============================================================
// 1. Input validation — validateBatchDistributionInput
// ============================================================

describe('validateBatchDistributionInput', () => {
  it('should accept valid input', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 50,
      reason: '奖励',
      targetRole: 'Speaker',
      activityId: 'act-001',
      speakerType: 'typeA',
    });
    expect(result.valid).toBe(true);
  });

  it('should reject null / undefined body', () => {
    expect(validateBatchDistributionInput(null).valid).toBe(false);
    expect(validateBatchDistributionInput(undefined).valid).toBe(false);
  });

  it('should reject missing fields (empty object)', () => {
    const result = validateBatchDistributionInput({});
    expect(result.valid).toBe(false);
  });

  it('should reject points that is not a positive integer (0)', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 0,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject points that is not a positive integer (negative)', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: -5,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject points that is not a positive integer (float)', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 1.5,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject reason longer than 200 characters', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 10,
      reason: 'a'.repeat(201),
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject empty reason', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 10,
      reason: '',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid targetRole', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 10,
      reason: '奖励',
      targetRole: 'Admin',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject empty userIds array', () => {
    const result = validateBatchDistributionInput({
      userIds: [],
      points: 10,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject userIds containing empty strings', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1', ''],
      points: 10,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject missing activityId', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 50,
      reason: '奖励',
      targetRole: 'Speaker',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toContain('activityId');
    }
  });

  it('should reject empty string activityId', () => {
    const result = validateBatchDistributionInput({
      userIds: ['u1'],
      points: 50,
      reason: '奖励',
      targetRole: 'Speaker',
      activityId: '',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(result.error.message).toContain('activityId');
    }
  });
});

// ============================================================
// 2. Deduplication logic
// ============================================================

describe('executeBatchDistribution — deduplication', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should deduplicate userIds so each user receives points only once', async () => {
    // GetCommand for feature-toggles (pointsRuleConfig)
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // BatchGetCommand returns user data
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'u1', points: 100, nickname: 'A', email: 'a@test.com' },
        ],
      },
    });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({ userIds: ['u1', 'u1', 'u1'], speakerType: 'typeA' }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.totalPoints).toBe(100); // 1 user × 100 points

    // Verify TransactWriteCommand has exactly 2 items (1 user × 2 ops)
    const txCmd = client.send.mock.calls[3][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    expect(txCmd.input.TransactItems).toHaveLength(2);
  });
});

// ============================================================
// 3. Transaction construction
// ============================================================

describe('executeBatchDistribution — transaction construction', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should build correct DynamoDB transaction parameters', async () => {
    // GetCommand for feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'u1', points: 200, nickname: 'Alice', email: 'alice@test.com' },
          { userId: 'u2', points: 50, nickname: 'Bob', email: 'bob@test.com' },
        ],
      },
    });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({ userIds: ['u1', 'u2'], points: 100, targetRole: 'Speaker', speakerType: 'typeA' }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.totalPoints).toBe(200);
    expect(result.distributionId).toBeDefined();

    // Verify TransactWriteCommand structure (offset by 2 for feature-toggles + awarded query)
    const txCmd = client.send.mock.calls[3][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    const items = txCmd.input.TransactItems;
    // 2 users × 2 ops = 4 items
    expect(items).toHaveLength(4);

    // First user: Update + Put
    expect(items[0].Update.TableName).toBe(USERS_TABLE);
    expect(items[0].Update.Key).toEqual({ userId: 'u1' });
    expect(items[0].Update.ExpressionAttributeValues[':pv']).toBe(100);

    expect(items[1].Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(items[1].Put.Item.userId).toBe('u1');
    expect(items[1].Put.Item.type).toBe('earn');
    expect(items[1].Put.Item.amount).toBe(100);
    expect(items[1].Put.Item.balanceAfter).toBe(300); // 200 + 100

    // Second user: Update + Put
    expect(items[2].Update.TableName).toBe(USERS_TABLE);
    expect(items[2].Update.Key).toEqual({ userId: 'u2' });

    expect(items[3].Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(items[3].Put.Item.userId).toBe('u2');
    expect(items[3].Put.Item.balanceAfter).toBe(150); // 50 + 100

    // Verify PutCommand for distribution record
    const putCmd = client.send.mock.calls[4][0];
    expect(putCmd.constructor.name).toBe('PutCommand');
    expect(putCmd.input.TableName).toBe(BATCH_DISTRIBUTIONS_TABLE);
    expect(putCmd.input.Item.pk).toBe('ALL');
    expect(putCmd.input.Item.successCount).toBe(2);
    expect(putCmd.input.Item.totalPoints).toBe(200);
  });
});

// ============================================================
// 3b. Activity validation and metadata in distribution
// ============================================================

const ACTIVITIES_TABLE = 'Activities';
const TABLES_WITH_ACTIVITIES = {
  ...TABLES,
  activitiesTable: ACTIVITIES_TABLE,
};

describe('executeBatchDistribution — activityId validation', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ACTIVITY_NOT_FOUND when activityId does not exist in Activities table', async () => {
    // GetCommand for activityId returns no item
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await executeBatchDistribution(
      makeValidInput({ activityId: 'nonexistent-act' }),
      client,
      TABLES_WITH_ACTIVITIES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ACTIVITY_NOT_FOUND');
    expect(result.error?.message).toContain('活动');

    // Verify GetCommand was called with correct table and key
    const getCmd = client.send.mock.calls[0][0];
    expect(getCmd.constructor.name).toBe('GetCommand');
    expect(getCmd.input.TableName).toBe(ACTIVITIES_TABLE);
    expect(getCmd.input.Key).toEqual({ activityId: 'nonexistent-act' });

    // No further DynamoDB calls should be made
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should write activity metadata to Distribution_Record on successful distribution', async () => {
    // GetCommand for activityId returns existing activity
    client.send.mockResolvedValueOnce({
      Item: { activityId: 'act-001', activityType: '线下活动', ugName: 'Tokyo', topic: 'AWS Summit', activityDate: '2024-06-15' },
    });
    // GetCommand for feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // BatchGetCommand returns user data
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'u1', points: 100, nickname: 'Alice', email: 'alice@test.com' },
        ],
      },
    });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const input = makeValidInput({
      userIds: ['u1'],
      activityId: 'act-001',
      activityType: '线下活动',
      activityUG: 'Tokyo',
      activityTopic: 'AWS Summit',
      activityDate: '2024-06-15',
    });

    const result = await executeBatchDistribution(input, client, TABLES_WITH_ACTIVITIES);

    expect(result.success).toBe(true);

    // Verify Distribution_Record contains activity metadata (offset by 2 for feature-toggles + awarded)
    const putCmd = client.send.mock.calls[5][0];
    expect(putCmd.constructor.name).toBe('PutCommand');
    expect(putCmd.input.TableName).toBe(BATCH_DISTRIBUTIONS_TABLE);
    const record = putCmd.input.Item;
    expect(record.activityId).toBe('act-001');
    expect(record.activityType).toBe('线下活动');
    expect(record.activityUG).toBe('Tokyo');
    expect(record.activityTopic).toBe('AWS Summit');
    expect(record.activityDate).toBe('2024-06-15');
  });

  it('should write activityId to each PointsRecord on successful distribution', async () => {
    // GetCommand for activityId returns existing activity
    client.send.mockResolvedValueOnce({
      Item: { activityId: 'act-002', activityType: '线上活动', ugName: 'Security', topic: 'Cloud Security Workshop', activityDate: '2024-07-20' },
    });
    // GetCommand for feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // BatchGetCommand returns user data
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'u1', points: 50, nickname: 'Alice', email: 'alice@test.com' },
          { userId: 'u2', points: 200, nickname: 'Bob', email: 'bob@test.com' },
        ],
      },
    });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const input = makeValidInput({
      userIds: ['u1', 'u2'],
      activityId: 'act-002',
      activityType: '线上活动',
      activityUG: 'Security',
      activityTopic: 'Cloud Security Workshop',
      activityDate: '2024-07-20',
    });

    const result = await executeBatchDistribution(input, client, TABLES_WITH_ACTIVITIES);

    expect(result.success).toBe(true);

    // Verify TransactWriteCommand — each PointsRecord Put should contain activityId (offset by 2)
    const txCmd = client.send.mock.calls[4][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    const items = txCmd.input.TransactItems;
    // 2 users × 2 ops = 4 items; Put items are at index 1 and 3
    expect(items[1].Put.Item.activityId).toBe('act-002');
    expect(items[3].Put.Item.activityId).toBe('act-002');
  });
});

// ============================================================
// 4. History query — listDistributionHistory
// ============================================================

describe('listDistributionHistory', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should pass pagination parameters correctly', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listDistributionHistory({ pageSize: 30 }, client, BATCH_DISTRIBUTIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('QueryCommand');
    expect(cmd.input.Limit).toBe(30);
    expect(cmd.input.IndexName).toBe('createdAt-index');
    expect(cmd.input.KeyConditionExpression).toBe('pk = :pk');
    expect(cmd.input.ExpressionAttributeValues[':pk']).toBe('ALL');
  });

  it('should query in descending time order (ScanIndexForward=false)', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listDistributionHistory({}, client, BATCH_DISTRIBUTIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  it('should decode base64 lastKey and pass as ExclusiveStartKey', async () => {
    const lastEvalKey = { distributionId: 'd1', pk: 'ALL', createdAt: '2024-01-01T00:00:00Z' };
    const encodedKey = Buffer.from(JSON.stringify(lastEvalKey)).toString('base64');
    client.send.mockResolvedValueOnce({ Items: [] });

    await listDistributionHistory({ lastKey: encodedKey }, client, BATCH_DISTRIBUTIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toEqual(lastEvalKey);
  });

  it('should return encoded lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { distributionId: 'd2', pk: 'ALL', createdAt: '2024-02-01T00:00:00Z' };
    // Return exactly pageSize (20) items so the loop exits (collected.length >= pageSize)
    // with cursor still set from LastEvaluatedKey
    const fakeItems = Array.from({ length: 20 }, (_, i) => ({
      distributionId: `d-${i}`,
      pk: 'ALL',
      createdAt: `2024-02-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    client.send.mockResolvedValueOnce({ Items: fakeItems, LastEvaluatedKey: lastEvalKey });

    const result = await listDistributionHistory({}, client, BATCH_DISTRIBUTIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should return error for invalid lastKey', async () => {
    const result = await listDistributionHistory(
      { lastKey: 'not-valid-base64!!' },
      client,
      BATCH_DISTRIBUTIONS_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listDistributionHistory({}, client, BATCH_DISTRIBUTIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(20);
  });
});

// ============================================================
// 5. Detail query — getDistributionDetail
// ============================================================

describe('getDistributionDetail', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return success with distribution when record exists', async () => {
    const record = {
      distributionId: 'd1',
      distributorId: 'admin-001',
      distributorNickname: 'Admin',
      targetRole: 'Speaker',
      recipientIds: ['u1'],
      points: 100,
      reason: '奖励',
      successCount: 1,
      totalPoints: 100,
      createdAt: '2024-01-01T00:00:00Z',
    };
    client.send.mockResolvedValueOnce({ Item: record });

    const result = await getDistributionDetail('d1', client, BATCH_DISTRIBUTIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.distribution).toEqual(record);
  });

  it('should return DISTRIBUTION_NOT_FOUND when record does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getDistributionDetail('nonexistent', client, BATCH_DISTRIBUTIONS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DISTRIBUTION_NOT_FOUND');
  });
});

// ============================================================
// 6. filterUsersBySearch
// ============================================================

describe('filterUsersBySearch', () => {
  const users: SearchableUser[] = [
    { userId: 'u1', nickname: 'Alice', email: 'alice@example.com' },
    { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
    { userId: 'u3', nickname: 'Charlie', email: 'charlie@example.com' },
  ];

  it('should filter by nickname match', () => {
    const result = filterUsersBySearch(users, 'Alice');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
  });

  it('should filter by email match', () => {
    const result = filterUsersBySearch(users, 'bob@test');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u2');
  });

  it('should perform case-insensitive matching', () => {
    const result = filterUsersBySearch(users, 'aLiCe');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
  });

  it('should return all users when query is empty', () => {
    const result = filterUsersBySearch(users, '');
    expect(result).toHaveLength(3);
  });
});

// ============================================================
// 7. clampPageSize
// ============================================================

describe('clampPageSize', () => {
  it('should return 20 when undefined', () => {
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('should return 1 when value < 1', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-10)).toBe(1);
  });

  it('should return 100 when value > 100', () => {
    expect(clampPageSize(200)).toBe(100);
    expect(clampPageSize(101)).toBe(100);
  });

  it('should pass through valid values', () => {
    expect(clampPageSize(1)).toBe(1);
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(100)).toBe(100);
  });
});

// ============================================================
// 8. skipPointsValidation — SuperAdmin quarterly points fix
// ============================================================

describe('executeBatchDistribution — skipPointsValidation', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should succeed with custom points when skipPointsValidation=true (no POINTS_MISMATCH)', async () => {
    // GetCommand for feature-toggles (speakerTypeAPoints=100, but we send 200)
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // BatchGetCommand returns user data
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'user-001', points: 100, nickname: 'Alice', email: 'alice@test.com' },
          { userId: 'user-002', points: 50, nickname: 'Bob', email: 'bob@test.com' },
        ],
      },
    });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({ points: 200, skipPointsValidation: true }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.totalPoints).toBe(400); // 2 users × 200 points
    expect(result.distributionId).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('should return POINTS_MISMATCH when skipPointsValidation is undefined and points mismatch', async () => {
    // GetCommand for feature-toggles (speakerTypeAPoints=100, but we send 200)
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });

    const result = await executeBatchDistribution(
      makeValidInput({ points: 200 }), // skipPointsValidation is undefined by default
      client,
      TABLES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('POINTS_MISMATCH');
  });

  it('should still enforce volunteer limit when skipPointsValidation=true', async () => {
    // GetCommand for feature-toggles (volunteerMaxPerEvent=10)
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });

    // 11 unique volunteer userIds — exceeds volunteerMaxPerEvent of 10
    const userIds = Array.from({ length: 11 }, (_, i) => `vol-${String(i + 1).padStart(3, '0')}`);

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds,
        points: 75,
        targetRole: 'Volunteer',
        speakerType: undefined,
        skipPointsValidation: true,
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VOLUNTEER_LIMIT_EXCEEDED');
  });

  it('should still deduplicate userIds when skipPointsValidation=true', async () => {
    // GetCommand for feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // BatchGetCommand returns user data (only 1 unique user)
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'user-001', points: 100, nickname: 'Alice', email: 'alice@test.com' },
        ],
      },
    });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});
    // PutCommand for distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds: ['user-001', 'user-001', 'user-001'],
        points: 200,
        skipPointsValidation: true,
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1); // deduplicated to 1 user
    expect(result.totalPoints).toBe(200); // 1 user × 200 points
  });

  it('should still enforce duplicate distribution check when skipPointsValidation=true', async () => {
    // GetCommand for feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: { uglPointsPerEvent: 50, volunteerPointsPerEvent: 30, volunteerMaxPerEvent: 10, speakerTypeAPoints: 100, speakerTypeBPoints: 50, speakerRoundtablePoints: 50 } },
    });
    // QueryCommand for awarded users — user-001 already awarded
    client.send.mockResolvedValueOnce({
      Items: [
        { recipientIds: ['user-001'] },
      ],
    });

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds: ['user-001'],
        points: 200,
        skipPointsValidation: true,
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DUPLICATE_DISTRIBUTION');
  });
});

// ============================================================
// 9. Skill-points split — base / skill / volunteer classification
//    需求: 1.1–1.6, 2.1–2.2
// ============================================================

describe('executeBatchDistribution — skill-points split into Volunteer', () => {
  let client: ReturnType<typeof createMockDynamoClient>;
  let savedSkillClaimsTable: string | undefined;

  // Config including skill point values
  const SKILL_CONFIG = {
    uglPointsPerEvent: 50,
    volunteerPointsPerEvent: 30,
    volunteerMaxPerEvent: 10,
    speakerTypeAPoints: 100,
    speakerTypeBPoints: 50,
    speakerRoundtablePoints: 50,
    liveSupportPoints: 20,
    posterDesignPoints: 15,
    articleEditingPoints: 10,
  };

  beforeEach(() => {
    client = createMockDynamoClient();
    // Ensure skill-claim Put items are NOT appended to the transaction so the
    // PointsRecords split assertions have a deterministic item count.
    savedSkillClaimsTable = process.env.ACTIVITY_SKILL_CLAIMS_TABLE;
    delete process.env.ACTIVITY_SKILL_CLAIMS_TABLE;
  });

  afterEach(() => {
    if (savedSkillClaimsTable === undefined) {
      delete process.env.ACTIVITY_SKILL_CLAIMS_TABLE;
    } else {
      process.env.ACTIVITY_SKILL_CLAIMS_TABLE = savedSkillClaimsTable;
    }
  });

  // ----------------------------------------------------------
  // 场景一：基础分 + 技能分（同一用户既在 userIds 又在 skillClaims）
  // 需求 1.1, 1.4, 1.5, 1.6, 2.1, 2.2
  // ----------------------------------------------------------
  it('场景一 基础+技能：写两条记录，基础分计入发放身份、技能分计入 Volunteer', async () => {
    // feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: SKILL_CONFIG },
    });
    // skill claims validation BatchGet (u1 active)
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [{ userId: 'u1', status: 'active' }] },
    });
    // awarded users query (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // balances BatchGet
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [{ userId: 'u1', points: 100, nickname: 'Alice', email: 'a@test.com' }] },
    });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});
    // PutCommand distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds: ['u1'],
        points: 50,
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
        skillClaims: [{ skill: 'liveSupport', userId: 'u1' }],
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);

    const txCmd = client.send.mock.calls[4][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    const items = txCmd.input.TransactItems;
    // 1 Update + 2 Put (base + skill)
    expect(items).toHaveLength(3);

    // User table update: total(70) → points/earnTotal; base(50) → earnTotalLeader; skill(20) → earnTotalVolunteer
    const update = items[0].Update;
    expect(update.Key).toEqual({ userId: 'u1' });
    expect(update.ExpressionAttributeNames['#rf']).toBe('earnTotalLeader');
    expect(update.ExpressionAttributeValues[':pv']).toBe(70); // base + skill
    expect(update.ExpressionAttributeValues[':av']).toBe(50); // base
    expect(update.ExpressionAttributeValues[':sv']).toBe(20); // skill
    // points / earnTotal both increment by the combined total (unchanged behavior)
    expect(update.UpdateExpression).toContain('points = points + :pv');
    expect(update.UpdateExpression).toContain('earnTotal = if_not_exists(earnTotal, :zero) + :pv');
    expect(update.UpdateExpression).toContain('#rf = if_not_exists(#rf, :zero) + :av');
    expect(update.UpdateExpression).toContain('earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) + :sv');

    // Base record: granting identity, amount = base points
    const base = items[1].Put.Item;
    expect(base.amount).toBe(50);
    expect(base.targetRole).toBe('UserGroupLeader');
    expect(base.balanceAfter).toBe(150); // 100 + 50
    expect(base.activityId).toBe('act-001');

    // Skill record: Volunteer, amount = skill points, balanceAfter accumulates after base
    const skill = items[2].Put.Item;
    expect(skill.amount).toBe(20);
    expect(skill.targetRole).toBe('Volunteer');
    expect(skill.balanceAfter).toBe(170); // 100 + 50 + 20
    // activity info retained on skill record (需求 1.4)
    expect(skill.activityId).toBe('act-001');
    expect(skill.activityUG).toBe('Tokyo');
    expect(skill.activityTopic).toBe('AWS Summit');
    expect(skill.activityDate).toBe('2024-06-15');
    // skill source clearly identifies skill claim + skill type (需求 1.5)
    expect(skill.source).toContain('技能认领');
    expect(skill.source).toContain('liveSupport');
  });

  // ----------------------------------------------------------
  // 场景二：纯技能分（用户只在 skillClaims，不在 userIds）
  // 需求 1.2, 2.1, 2.2
  // ----------------------------------------------------------
  it('场景二 纯技能：仅在 skillClaims 的用户只写一条 Volunteer 记录', async () => {
    // feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: SKILL_CONFIG },
    });
    // skill claims validation BatchGet (u2 active)
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [{ userId: 'u2', status: 'active' }] },
    });
    // awarded users query (empty)
    client.send.mockResolvedValueOnce({ Items: [] });
    // balances BatchGet (both base user u1 and skill-only user u2)
    client.send.mockResolvedValueOnce({
      Responses: {
        [USERS_TABLE]: [
          { userId: 'u1', points: 100, nickname: 'Alice', email: 'a@test.com' },
          { userId: 'u2', points: 80, nickname: 'Bob', email: 'b@test.com' },
        ],
      },
    });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});
    // PutCommand distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds: ['u1'],
        points: 50,
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
        skillClaims: [{ skill: 'posterDesign', userId: 'u2' }],
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);

    const txCmd = client.send.mock.calls[4][0];
    const items = txCmd.input.TransactItems;
    // u1: Update + base Put; u2: Update + skill Put = 4 items
    expect(items).toHaveLength(4);

    // u2 user update: nothing into base field (av=0), skill → earnTotalVolunteer
    const u2Update = items[2].Update;
    expect(u2Update.Key).toEqual({ userId: 'u2' });
    expect(u2Update.ExpressionAttributeValues[':pv']).toBe(15); // skill only
    expect(u2Update.ExpressionAttributeValues[':av']).toBe(0); // no base
    expect(u2Update.ExpressionAttributeValues[':sv']).toBe(15); // skill

    // u2 has exactly one PointsRecord and it is the Volunteer skill record
    const u2Puts = items.filter((i: any) => i.Put && i.Put.Item.userId === 'u2');
    expect(u2Puts).toHaveLength(1);
    const u2Skill = u2Puts[0].Put.Item;
    expect(u2Skill.amount).toBe(15);
    expect(u2Skill.targetRole).toBe('Volunteer');
    expect(u2Skill.balanceAfter).toBe(95); // 80 + 0 + 15
    expect(u2Skill.activityId).toBe('act-001');
  });

  // ----------------------------------------------------------
  // 场景三：纯基础分（无技能认领，维持原行为）
  // 需求 1.3, 2.1, 2.2
  // ----------------------------------------------------------
  it('场景三 纯基础：无技能认领时写一条发放身份记录、无 Volunteer 记录', async () => {
    // feature-toggles
    client.send.mockResolvedValueOnce({
      Item: { userId: 'feature-toggles', pointsRuleConfig: SKILL_CONFIG },
    });
    // awarded users query (empty) — no skill validation BatchGet since no skillClaims
    client.send.mockResolvedValueOnce({ Items: [] });
    // balances BatchGet
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [{ userId: 'u1', points: 100, nickname: 'Alice', email: 'a@test.com' }] },
    });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});
    // PutCommand distribution record
    client.send.mockResolvedValueOnce({});

    const result = await executeBatchDistribution(
      makeValidInput({
        userIds: ['u1'],
        points: 50,
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
      }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);

    const txCmd = client.send.mock.calls[3][0];
    const items = txCmd.input.TransactItems;
    // 1 Update + 1 base Put
    expect(items).toHaveLength(2);

    const update = items[0].Update;
    expect(update.ExpressionAttributeNames['#rf']).toBe('earnTotalLeader');
    expect(update.ExpressionAttributeValues[':pv']).toBe(50); // base only
    expect(update.ExpressionAttributeValues[':av']).toBe(50);
    expect(update.ExpressionAttributeValues[':sv']).toBe(0); // no skill

    const base = items[1].Put.Item;
    expect(base.amount).toBe(50);
    expect(base.targetRole).toBe('UserGroupLeader');
    expect(base.balanceAfter).toBe(150); // 100 + 50

    // no Volunteer skill record produced
    const volunteerPuts = items.filter((i: any) => i.Put && i.Put.Item.targetRole === 'Volunteer');
    expect(volunteerPuts).toHaveLength(0);
  });
});
