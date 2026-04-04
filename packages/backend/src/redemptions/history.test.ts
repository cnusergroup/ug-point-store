import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRedemptionHistory } from './history';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeRecord(overrides: Record<string, any> = {}) {
  return {
    redemptionId: 'rdm-001',
    userId: 'user-1',
    productId: 'prod-1',
    productName: 'Test Product',
    method: 'points',
    pointsSpent: 100,
    status: 'success',
    createdAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getRedemptionHistory', () => {
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

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('should use default page=1 and pageSize=20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ScanIndexForward).toBe(false);
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
  });

  it('should use custom page and pageSize when provided', async () => {
    // Generate 15 records
    const items = Array.from({ length: 15 }, (_, i) =>
      makeRecord({ redemptionId: `rdm-${i}`, createdAt: `2024-06-${String(15 - i).padStart(2, '0')}T00:00:00.000Z` }),
    );
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders', { page: 2, pageSize: 5 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.total).toBe(15);
    expect(result.items).toHaveLength(5);
  });

  it('should return empty items when page exceeds total records', async () => {
    const items = [makeRecord()];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders', { page: 5, pageSize: 20 });

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.page).toBe(5);
  });

  it('should return empty items when user has no history', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should query with correct table name and userId', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await getRedemptionHistory('user-xyz', client, 'MyRedemptionsTable', 'MyOrdersTable');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('MyRedemptionsTable');
    expect(cmd.input.KeyConditionExpression).toBe('userId = :uid');
    expect(cmd.input.ExpressionAttributeValues).toEqual({ ':uid': 'user-xyz' });
  });

  it('should enrich records with shippingStatus from Orders table', async () => {
    const items = [
      makeRecord({ orderId: 'ord-1' }),
      makeRecord({ redemptionId: 'rdm-002' }),
    ];
    client.send
      .mockResolvedValueOnce({ Items: items }) // Query redemptions
      .mockResolvedValueOnce({ // BatchGet orders
        Responses: {
          Orders: [{ orderId: 'ord-1', shippingStatus: 'shipped' }],
        },
      });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.success).toBe(true);
    expect(result.items![0]).toMatchObject({ orderId: 'ord-1', shippingStatus: 'shipped' });
    expect(result.items![1].shippingStatus).toBeUndefined();
  });

  it('should handle missing orders gracefully when enriching shippingStatus', async () => {
    const items = [makeRecord({ orderId: 'ord-missing' })];
    client.send
      .mockResolvedValueOnce({ Items: items })
      .mockResolvedValueOnce({ Responses: { Orders: [] } });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.success).toBe(true);
    expect(result.items![0].shippingStatus).toBeUndefined();
  });

  it('should handle pagination across multiple DynamoDB pages', async () => {
    const page1Items = Array.from({ length: 3 }, (_, i) =>
      makeRecord({ redemptionId: `rdm-${i}` }),
    );
    const page2Items = Array.from({ length: 2 }, (_, i) =>
      makeRecord({ redemptionId: `rdm-${i + 3}` }),
    );
    client.send
      .mockResolvedValueOnce({ Items: page1Items, LastEvaluatedKey: { userId: 'user-1', createdAt: 'x' } })
      .mockResolvedValueOnce({ Items: page2Items });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders');

    expect(result.success).toBe(true);
    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(5);
  });

  it('should treat page < 1 as page 1', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeRecord()] });

    const result = await getRedemptionHistory('user-1', client, 'Redemptions', 'Orders', { page: 0 });

    expect(result.page).toBe(1);
  });
});
