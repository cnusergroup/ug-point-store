import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateUGName,
  createUG,
  deleteUG,
  updateUGStatus,
  listUGs,
  assignLeader,
  removeLeader,
  getMyUGs,
} from './ug';

// ============================================================
// Helpers
// ============================================================

const UGS_TABLE = 'UGs';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

// ============================================================
// 1. Name validation — validateUGName
// ============================================================

describe('validateUGName', () => {
  it('should accept a valid name', () => {
    const result = validateUGName('Tokyo UG');
    expect(result.valid).toBe(true);
  });

  it('should accept a name with exactly 1 character', () => {
    const result = validateUGName('A');
    expect(result.valid).toBe(true);
  });

  it('should accept a name with exactly 50 characters', () => {
    const result = validateUGName('a'.repeat(50));
    expect(result.valid).toBe(true);
  });

  it('should reject an empty string', () => {
    const result = validateUGName('');
    expect(result.valid).toBe(false);
  });

  it('should reject a whitespace-only string', () => {
    const result = validateUGName('   ');
    expect(result.valid).toBe(false);
  });

  it('should reject a name over 50 characters', () => {
    const result = validateUGName('a'.repeat(51));
    expect(result.valid).toBe(false);
  });

  it('should reject non-string input (number)', () => {
    const result = validateUGName(123);
    expect(result.valid).toBe(false);
  });

  it('should reject non-string input (null)', () => {
    const result = validateUGName(null);
    expect(result.valid).toBe(false);
  });

  it('should reject non-string input (undefined)', () => {
    const result = validateUGName(undefined);
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// 2. Create — createUG
// ============================================================

describe('createUG', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should create a UG successfully with valid name', async () => {
    // ScanCommand for uniqueness check — no existing UGs
    client.send.mockResolvedValueOnce({ Items: [] });
    // PutCommand for creation
    client.send.mockResolvedValueOnce({});

    const result = await createUG({ name: 'Tokyo UG' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ug).toBeDefined();
    expect(result.ug!.name).toBe('Tokyo UG');
    expect(result.ug!.status).toBe('active');
    expect(result.ug!.ugId).toBeDefined();
    expect(result.ug!.createdAt).toBeDefined();
    expect(result.ug!.updatedAt).toBeDefined();

    // Verify PutCommand was called
    const putCmd = client.send.mock.calls[1][0];
    expect(putCmd.constructor.name).toBe('PutCommand');
    expect(putCmd.input.TableName).toBe(UGS_TABLE);
  });

  it('should reject duplicate name (case-insensitive)', async () => {
    // ScanCommand returns existing UG with same name in different case
    client.send.mockResolvedValueOnce({
      Items: [{ name: 'tokyo ug' }],
    });

    const result = await createUG({ name: 'Tokyo UG' }, client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DUPLICATE_UG_NAME');
    // PutCommand should NOT have been called
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should reject duplicate name with exact match', async () => {
    client.send.mockResolvedValueOnce({
      Items: [{ name: 'Tokyo UG' }],
    });

    const result = await createUG({ name: 'Tokyo UG' }, client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DUPLICATE_UG_NAME');
  });

  it('should reject invalid name (empty string)', async () => {
    const result = await createUG({ name: '' }, client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject invalid name (over 50 chars)', async () => {
    const result = await createUG({ name: 'a'.repeat(51) }, client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should trim name before storing', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });
    client.send.mockResolvedValueOnce({});

    const result = await createUG({ name: '  Tokyo UG  ' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ug!.name).toBe('Tokyo UG');
  });
});

// ============================================================
// 3. Delete — deleteUG
// ============================================================

describe('deleteUG', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should delete an existing UG successfully', async () => {
    // GetCommand returns existing UG
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // DeleteCommand succeeds
    client.send.mockResolvedValueOnce({});

    const result = await deleteUG('ug-001', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);

    // Verify GetCommand
    const getCmd = client.send.mock.calls[0][0];
    expect(getCmd.constructor.name).toBe('GetCommand');
    expect(getCmd.input.Key).toEqual({ ugId: 'ug-001' });

    // Verify DeleteCommand
    const deleteCmd = client.send.mock.calls[1][0];
    expect(deleteCmd.constructor.name).toBe('DeleteCommand');
    expect(deleteCmd.input.Key).toEqual({ ugId: 'ug-001' });
  });

  it('should return UG_NOT_FOUND for non-existent UG', async () => {
    // GetCommand returns no item
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await deleteUG('nonexistent', client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UG_NOT_FOUND');
    // Only GetCommand should have been called
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 4. Status update — updateUGStatus
// ============================================================

describe('updateUGStatus', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should update status from active to inactive', async () => {
    // GetCommand returns existing UG with active status
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // UpdateCommand succeeds
    client.send.mockResolvedValueOnce({});

    const result = await updateUGStatus('ug-001', 'inactive', client, UGS_TABLE);

    expect(result.success).toBe(true);

    // Verify UpdateCommand
    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
    expect(updateCmd.input.Key).toEqual({ ugId: 'ug-001' });
    expect(updateCmd.input.ExpressionAttributeValues[':status']).toBe('inactive');
    expect(updateCmd.input.ExpressionAttributeValues[':now']).toBeDefined();
  });

  it('should update status from inactive to active', async () => {
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-002', name: 'Osaka UG', status: 'inactive' },
    });
    client.send.mockResolvedValueOnce({});

    const result = await updateUGStatus('ug-002', 'active', client, UGS_TABLE);

    expect(result.success).toBe(true);

    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.input.ExpressionAttributeValues[':status']).toBe('active');
  });

  it('should return UG_NOT_FOUND for non-existent UG', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await updateUGStatus('nonexistent', 'active', client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UG_NOT_FOUND');
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 5. List query — listUGs
// ============================================================

describe('listUGs', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should filter by active status using status-index GSI', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-001', name: 'Tokyo UG', status: 'active', createdAt: '2024-02-01T00:00:00Z' },
        { ugId: 'ug-002', name: 'Osaka UG', status: 'active', createdAt: '2024-01-01T00:00:00Z' },
      ],
    });

    const result = await listUGs({ status: 'active' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(2);
    expect(result.ugs!.every((ug) => ug.status === 'active')).toBe(true);

    // Verify QueryCommand with status-index GSI
    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.constructor.name).toBe('QueryCommand');
    expect(queryCmd.input.IndexName).toBe('status-index');
    expect(queryCmd.input.ExpressionAttributeValues[':status']).toBe('active');
    expect(queryCmd.input.ScanIndexForward).toBe(false);
  });

  it('should filter by inactive status using status-index GSI', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-003', name: 'Kyoto UG', status: 'inactive', createdAt: '2024-01-15T00:00:00Z' },
      ],
    });

    const result = await listUGs({ status: 'inactive' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(1);
    expect(result.ugs![0].status).toBe('inactive');

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.constructor.name).toBe('QueryCommand');
    expect(queryCmd.input.ExpressionAttributeValues[':status']).toBe('inactive');
  });

  it('should return all UGs when status is "all" using Scan', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-001', name: 'Tokyo UG', status: 'active', createdAt: '2024-01-01T00:00:00Z' },
        { ugId: 'ug-002', name: 'Osaka UG', status: 'inactive', createdAt: '2024-02-01T00:00:00Z' },
      ],
    });

    const result = await listUGs({ status: 'all' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(2);

    const scanCmd = client.send.mock.calls[0][0];
    expect(scanCmd.constructor.name).toBe('ScanCommand');
  });

  it('should sort results by createdAt in descending order when using Scan', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-001', name: 'Tokyo UG', status: 'active', createdAt: '2024-01-01T00:00:00Z' },
        { ugId: 'ug-002', name: 'Osaka UG', status: 'inactive', createdAt: '2024-03-01T00:00:00Z' },
        { ugId: 'ug-003', name: 'Kyoto UG', status: 'active', createdAt: '2024-02-01T00:00:00Z' },
      ],
    });

    const result = await listUGs({ status: 'all' }, client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(3);
    // Should be sorted descending by createdAt
    expect(result.ugs![0].createdAt).toBe('2024-03-01T00:00:00Z');
    expect(result.ugs![1].createdAt).toBe('2024-02-01T00:00:00Z');
    expect(result.ugs![2].createdAt).toBe('2024-01-01T00:00:00Z');
  });

  it('should use ScanIndexForward=false for descending order when querying by status', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listUGs({ status: 'active' }, client, UGS_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.ScanIndexForward).toBe(false);
  });

  it('should default to "all" when status is not provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await listUGs({}, client, UGS_TABLE);

    expect(result.success).toBe(true);
    const scanCmd = client.send.mock.calls[0][0];
    expect(scanCmd.constructor.name).toBe('ScanCommand');
  });
});


// ============================================================
// Helpers for leader tests
// ============================================================

const USERS_TABLE = 'Users';

// ============================================================
// 6. Assign Leader — assignLeader
// ============================================================

describe('assignLeader', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should assign leader successfully when UG exists and user has Admin role', async () => {
    // GetCommand — UG exists
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // GetCommand — User exists with Admin role
    client.send.mockResolvedValueOnce({
      Item: { userId: 'user-001', nickname: 'Alice', roles: ['Admin'] },
    });
    // UpdateCommand — success
    client.send.mockResolvedValueOnce({});

    const result = await assignLeader(
      { ugId: 'ug-001', leaderId: 'user-001' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called with correct params
    expect(client.send).toHaveBeenCalledTimes(3);
    const updateCmd = client.send.mock.calls[2][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
    expect(updateCmd.input.Key).toEqual({ ugId: 'ug-001' });
    expect(updateCmd.input.ExpressionAttributeValues[':leaderId']).toBe('user-001');
    expect(updateCmd.input.ExpressionAttributeValues[':leaderNickname']).toBe('Alice');
    expect(updateCmd.input.ExpressionAttributeValues[':now']).toBeDefined();
  });

  it('should return USER_NOT_FOUND when user does not exist', async () => {
    // GetCommand — UG exists
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // GetCommand — User not found
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await assignLeader(
      { ugId: 'ug-001', leaderId: 'nonexistent-user' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('USER_NOT_FOUND');
    expect(result.error?.message).toBe('用户不存在');
    // UpdateCommand should NOT have been called
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('should return INVALID_LEADER_ROLE when user does not have Admin role', async () => {
    // GetCommand — UG exists
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // GetCommand — User exists but only has Member role
    client.send.mockResolvedValueOnce({
      Item: { userId: 'user-002', nickname: 'Bob', roles: ['Member'] },
    });

    const result = await assignLeader(
      { ugId: 'ug-001', leaderId: 'user-002' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_LEADER_ROLE');
    expect(result.error?.message).toBe('负责人必须拥有 Admin 角色');
    // UpdateCommand should NOT have been called
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('should return UG_NOT_FOUND when UG does not exist', async () => {
    // GetCommand — UG not found
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await assignLeader(
      { ugId: 'nonexistent-ug', leaderId: 'user-001' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UG_NOT_FOUND');
    expect(result.error?.message).toBe('UG 不存在');
    // Only the UG GetCommand should have been called
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should allow the same Admin to be assigned to multiple UGs', async () => {
    // First UG assignment
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    client.send.mockResolvedValueOnce({
      Item: { userId: 'user-001', nickname: 'Alice', roles: ['Admin'] },
    });
    client.send.mockResolvedValueOnce({});

    const result1 = await assignLeader(
      { ugId: 'ug-001', leaderId: 'user-001' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );
    expect(result1.success).toBe(true);

    // Second UG assignment with same Admin
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-002', name: 'Osaka UG', status: 'active' },
    });
    client.send.mockResolvedValueOnce({
      Item: { userId: 'user-001', nickname: 'Alice', roles: ['Admin'] },
    });
    client.send.mockResolvedValueOnce({});

    const result2 = await assignLeader(
      { ugId: 'ug-002', leaderId: 'user-001' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );
    expect(result2.success).toBe(true);

    // Both assignments should have called UpdateCommand
    expect(client.send).toHaveBeenCalledTimes(6);
  });

  it('should overwrite existing leader (replace)', async () => {
    // GetCommand — UG exists with existing leader
    client.send.mockResolvedValueOnce({
      Item: {
        ugId: 'ug-001',
        name: 'Tokyo UG',
        status: 'active',
        leaderId: 'old-leader',
        leaderNickname: 'OldLeader',
      },
    });
    // GetCommand — New user exists with Admin role
    client.send.mockResolvedValueOnce({
      Item: { userId: 'new-leader', nickname: 'NewLeader', roles: ['Admin'] },
    });
    // UpdateCommand — success
    client.send.mockResolvedValueOnce({});

    const result = await assignLeader(
      { ugId: 'ug-001', leaderId: 'new-leader' },
      client,
      UGS_TABLE,
      USERS_TABLE,
    );

    expect(result.success).toBe(true);

    // Verify UpdateCommand overwrites with new leader info
    const updateCmd = client.send.mock.calls[2][0];
    expect(updateCmd.input.ExpressionAttributeValues[':leaderId']).toBe('new-leader');
    expect(updateCmd.input.ExpressionAttributeValues[':leaderNickname']).toBe('NewLeader');
  });
});

// ============================================================
// 7. Remove Leader — removeLeader
// ============================================================

describe('removeLeader', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should remove leader successfully', async () => {
    // GetCommand — UG exists with leader
    client.send.mockResolvedValueOnce({
      Item: {
        ugId: 'ug-001',
        name: 'Tokyo UG',
        status: 'active',
        leaderId: 'user-001',
        leaderNickname: 'Alice',
      },
    });
    // UpdateCommand — success
    client.send.mockResolvedValueOnce({});

    const result = await removeLeader('ug-001', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand uses REMOVE expression
    expect(client.send).toHaveBeenCalledTimes(2);
    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
    expect(updateCmd.input.Key).toEqual({ ugId: 'ug-001' });
    expect(updateCmd.input.UpdateExpression).toContain('REMOVE');
    expect(updateCmd.input.UpdateExpression).toContain('leaderId');
    expect(updateCmd.input.UpdateExpression).toContain('leaderNickname');
    expect(updateCmd.input.ExpressionAttributeValues[':now']).toBeDefined();
  });

  it('should return UG_NOT_FOUND when UG does not exist', async () => {
    // GetCommand — UG not found
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await removeLeader('nonexistent-ug', client, UGS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UG_NOT_FOUND');
    expect(result.error?.message).toBe('UG 不存在');
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should succeed idempotently when UG has no leader', async () => {
    // GetCommand — UG exists but has no leader fields
    client.send.mockResolvedValueOnce({
      Item: { ugId: 'ug-001', name: 'Tokyo UG', status: 'active' },
    });
    // UpdateCommand — success (REMOVE on non-existent fields is a no-op in DynamoDB)
    client.send.mockResolvedValueOnce({});

    const result = await removeLeader('ug-001', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// 8. Get My UGs — getMyUGs
// ============================================================

describe('getMyUGs', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return correct UG list for a given userId', async () => {
    // ScanCommand — returns UGs where leaderId matches
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-001', name: 'Tokyo UG', status: 'active', leaderId: 'user-001', leaderNickname: 'Alice' },
        { ugId: 'ug-003', name: 'Kyoto UG', status: 'active', leaderId: 'user-001', leaderNickname: 'Alice' },
      ],
    });

    const result = await getMyUGs('user-001', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(2);
    expect(result.ugs![0].ugId).toBe('ug-001');
    expect(result.ugs![1].ugId).toBe('ug-003');

    // Verify ScanCommand with correct FilterExpression
    const scanCmd = client.send.mock.calls[0][0];
    expect(scanCmd.constructor.name).toBe('ScanCommand');
    expect(scanCmd.input.TableName).toBe(UGS_TABLE);
    expect(scanCmd.input.FilterExpression).toContain('leaderId = :userId');
    expect(scanCmd.input.FilterExpression).toContain('#status = :active');
    expect(scanCmd.input.ExpressionAttributeValues[':userId']).toBe('user-001');
    expect(scanCmd.input.ExpressionAttributeValues[':active']).toBe('active');
  });

  it('should only return active status UGs', async () => {
    // ScanCommand — DynamoDB FilterExpression already filters for active status
    // Simulating that DynamoDB only returns active UGs (inactive ones are filtered server-side)
    client.send.mockResolvedValueOnce({
      Items: [
        { ugId: 'ug-001', name: 'Tokyo UG', status: 'active', leaderId: 'user-001', leaderNickname: 'Alice' },
      ],
    });

    const result = await getMyUGs('user-001', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toHaveLength(1);
    expect(result.ugs![0].status).toBe('active');

    // Verify the FilterExpression includes status = active
    const scanCmd = client.send.mock.calls[0][0];
    expect(scanCmd.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
    expect(scanCmd.input.ExpressionAttributeValues[':active']).toBe('active');
  });

  it('should return empty list when no matches', async () => {
    // ScanCommand — no matching items
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getMyUGs('user-no-ugs', client, UGS_TABLE);

    expect(result.success).toBe(true);
    expect(result.ugs).toEqual([]);
  });
});
