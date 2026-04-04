import { describe, it, expect, vi } from 'vitest';
import { getUserProfile } from './profile';

function createMockDynamoClient(item: any | null) {
  return {
    send: vi.fn().mockResolvedValue({ Item: item }),
  } as any;
}

const tableName = 'Users';

describe('getUserProfile', () => {
  it('should return user profile with all fields', async () => {
    const client = createMockDynamoClient({
      userId: 'user-1',
      nickname: 'Alice',
      email: 'alice@example.com',
      wechatOpenId: 'wx-123',
      roles: new Set(['Speaker', 'Volunteer']),
      points: 500,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await getUserProfile('user-1', client, tableName);

    expect(result.success).toBe(true);
    expect(result.profile).toBeDefined();
    expect(result.profile!.userId).toBe('user-1');
    expect(result.profile!.nickname).toBe('Alice');
    expect(result.profile!.email).toBe('alice@example.com');
    expect(result.profile!.wechatOpenId).toBe('wx-123');
    expect(result.profile!.roles).toEqual(expect.arrayContaining(['Speaker', 'Volunteer']));
    expect(result.profile!.roles).toHaveLength(2);
    expect(result.profile!.points).toBe(500);
    expect(result.profile!.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('should return error when user not found', async () => {
    const client = createMockDynamoClient(null);

    const result = await getUserProfile('nonexistent', client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('USER_NOT_FOUND');
    expect(result.profile).toBeUndefined();
  });

  it('should handle user with no optional fields', async () => {
    const client = createMockDynamoClient({
      userId: 'user-2',
      nickname: 'Bob',
      roles: [],
      points: 0,
      createdAt: '2024-06-01T00:00:00.000Z',
    });

    const result = await getUserProfile('user-2', client, tableName);

    expect(result.success).toBe(true);
    expect(result.profile!.email).toBeUndefined();
    expect(result.profile!.wechatOpenId).toBeUndefined();
    expect(result.profile!.roles).toEqual([]);
    expect(result.profile!.points).toBe(0);
  });

  it('should handle roles as array (non-Set)', async () => {
    const client = createMockDynamoClient({
      userId: 'user-3',
      nickname: 'Charlie',
      roles: ['UserGroupLeader'],
      points: 100,
      createdAt: '2024-03-01T00:00:00.000Z',
    });

    const result = await getUserProfile('user-3', client, tableName);

    expect(result.success).toBe(true);
    expect(result.profile!.roles).toEqual(['UserGroupLeader']);
  });

  it('should default points to 0 when undefined', async () => {
    const client = createMockDynamoClient({
      userId: 'user-4',
      nickname: 'Dave',
      roles: [],
      createdAt: '2024-04-01T00:00:00.000Z',
    });

    const result = await getUserProfile('user-4', client, tableName);

    expect(result.success).toBe(true);
    expect(result.profile!.points).toBe(0);
  });

  it('should use GetCommand with correct table and key', async () => {
    const client = createMockDynamoClient({
      userId: 'user-5',
      nickname: 'Eve',
      roles: [],
      points: 0,
      createdAt: '2024-05-01T00:00:00.000Z',
    });

    await getUserProfile('user-5', client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('GetCommand');
    expect(command.input.TableName).toBe('Users');
    expect(command.input.Key).toEqual({ userId: 'user-5' });
  });
});
