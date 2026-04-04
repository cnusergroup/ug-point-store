import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPointsRecords } from './records';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeRecord(overrides: Record<string, any> = {}) {
  return {
    recordId: 'rec-001',
    userId: 'user-1',
    type: 'earn',
    amount: 50,
    source: 'CODE123',
    balanceAfter: 150,
    createdAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getPointsRecords', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return items with page-based pagination format', async () => {
    const items = [
      makeRecord({ createdAt: '2024-06-02T00:00:00.000Z' }),
      makeRecord({ createdAt: '2024-06-01T00:00:00.000Z' }),
    ];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getPointsRecords('user-1', client, 'PointsRecords');

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('should use default page=1 and pageSize=20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getPointsRecords('user-1', client, 'PointsRecords');

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ScanIndexForward).toBe(false);
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
  });

  it('should use custom page and pageSize when provided', async () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeRecord({ recordId: `rec-${i}`, createdAt: `2024-06-${String(15 - i).padStart(2, '0')}T00:00:00.000Z` }),
    );
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getPointsRecords('user-1', client, 'PointsRecords', { page: 2, pageSize: 5 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.total).toBe(15);
    expect(result.items).toHaveLength(5);
  });

  it('should return empty items when page exceeds total records', async () => {
    const items = [makeRecord()];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getPointsRecords('user-1', client, 'PointsRecords', { page: 5, pageSize: 20 });

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.page).toBe(5);
  });

  it('should return empty items when user has no history', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getPointsRecords('user-1', client, 'PointsRecords');

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should query with correct table name and userId', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await getPointsRecords('user-xyz', client, 'MyPointsTable');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('MyPointsTable');
    expect(cmd.input.KeyConditionExpression).toBe('userId = :uid');
    expect(cmd.input.ExpressionAttributeValues).toEqual({ ':uid': 'user-xyz' });
  });

  it('should handle pagination across multiple DynamoDB pages', async () => {
    const page1Items = Array.from({ length: 3 }, (_, i) =>
      makeRecord({ recordId: `rec-${i}` }),
    );
    const page2Items = Array.from({ length: 2 }, (_, i) =>
      makeRecord({ recordId: `rec-${i + 3}` }),
    );
    client.send
      .mockResolvedValueOnce({ Items: page1Items, LastEvaluatedKey: { userId: 'user-1', createdAt: 'x' } })
      .mockResolvedValueOnce({ Items: page2Items });

    const result = await getPointsRecords('user-1', client, 'PointsRecords');

    expect(result.success).toBe(true);
    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(5);
  });

  it('should treat page < 1 as page 1', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeRecord()] });

    const result = await getPointsRecords('user-1', client, 'PointsRecords', { page: 0 });

    expect(result.page).toBe(1);
  });
});
