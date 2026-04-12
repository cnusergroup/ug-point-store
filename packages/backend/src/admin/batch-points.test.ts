import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    distributorId: 'admin-001',
    distributorNickname: 'AdminUser',
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
      makeValidInput({ userIds: ['u1', 'u1', 'u1'] }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.totalPoints).toBe(100); // 1 user × 100 points

    // Verify TransactWriteCommand has exactly 2 items (1 user × 2 ops)
    const txCmd = client.send.mock.calls[1][0];
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
      makeValidInput({ userIds: ['u1', 'u2'], points: 300 }),
      client,
      TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.totalPoints).toBe(600);
    expect(result.distributionId).toBeDefined();

    // Verify TransactWriteCommand structure
    const txCmd = client.send.mock.calls[1][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    const items = txCmd.input.TransactItems;
    // 2 users × 2 ops = 4 items
    expect(items).toHaveLength(4);

    // First user: Update + Put
    expect(items[0].Update.TableName).toBe(USERS_TABLE);
    expect(items[0].Update.Key).toEqual({ userId: 'u1' });
    expect(items[0].Update.ExpressionAttributeValues[':pv']).toBe(300);

    expect(items[1].Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(items[1].Put.Item.userId).toBe('u1');
    expect(items[1].Put.Item.type).toBe('earn');
    expect(items[1].Put.Item.amount).toBe(300);
    expect(items[1].Put.Item.balanceAfter).toBe(500); // 200 + 300

    // Second user: Update + Put
    expect(items[2].Update.TableName).toBe(USERS_TABLE);
    expect(items[2].Update.Key).toEqual({ userId: 'u2' });

    expect(items[3].Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(items[3].Put.Item.userId).toBe('u2');
    expect(items[3].Put.Item.balanceAfter).toBe(350); // 50 + 300

    // Verify PutCommand for distribution record
    const putCmd = client.send.mock.calls[2][0];
    expect(putCmd.constructor.name).toBe('PutCommand');
    expect(putCmd.input.TableName).toBe(BATCH_DISTRIBUTIONS_TABLE);
    expect(putCmd.input.Item.pk).toBe('ALL');
    expect(putCmd.input.Item.successCount).toBe(2);
    expect(putCmd.input.Item.totalPoints).toBe(600);
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
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastEvalKey });

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
