import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPointsBalance } from './balance';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

describe('getPointsBalance', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return user points balance', async () => {
    client.send.mockResolvedValueOnce({ Item: { points: 150 } });

    const result = await getPointsBalance('user-1', client, 'Users');

    expect(result.success).toBe(true);
    expect(result.points).toBe(150);
  });

  it('should return 0 when user has no points field', async () => {
    client.send.mockResolvedValueOnce({ Item: {} });

    const result = await getPointsBalance('user-1', client, 'Users');

    expect(result.success).toBe(true);
    expect(result.points).toBe(0);
  });

  it('should return USER_NOT_FOUND when user does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getPointsBalance('nonexistent', client, 'Users');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('USER_NOT_FOUND');
  });

  it('should query with correct table name and key', async () => {
    client.send.mockResolvedValueOnce({ Item: { points: 42 } });

    await getPointsBalance('user-abc', client, 'MyUsersTable');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('MyUsersTable');
    expect(cmd.input.Key).toEqual({ userId: 'user-abc' });
    expect(cmd.input.ProjectionExpression).toBe('points');
  });
});
