import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAdminOrders, getAdminOrderDetail, updateShipping, getOrderStats } from './admin-order';
import { ErrorCodes } from '@points-mall/shared';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeFullOrder(overrides: Record<string, any> = {}) {
  return {
    orderId: 'order-001',
    userId: 'user-001',
    items: [
      { productId: 'prod-001', productName: 'Product 1', imageUrl: 'img.png', pointsCost: 100, quantity: 1, subtotal: 100 },
    ],
    totalPoints: 100,
    shippingAddress: {
      recipientName: '张三',
      phone: '13800138000',
      detailAddress: '北京市朝阳区某某路1号',
    },
    shippingStatus: 'pending',
    trackingNumber: undefined,
    shippingEvents: [{ status: 'pending', timestamp: '2024-01-01T00:00:00.000Z', remark: '订单已创建' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getAdminOrders', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should query GSI when status is provided', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        makeFullOrder({ orderId: 'order-001', shippingStatus: 'pending' }),
        makeFullOrder({ orderId: 'order-002', shippingStatus: 'pending' }),
      ],
    });

    const result = await getAdminOrders('pending', 1, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(2);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('shippingStatus-createdAt-index');
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
  });

  it('should scan table when no status filter', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        makeFullOrder({ orderId: 'order-001', shippingStatus: 'pending', createdAt: '2024-01-01T00:00:00.000Z' }),
        makeFullOrder({ orderId: 'order-002', shippingStatus: 'shipped', createdAt: '2024-01-02T00:00:00.000Z' }),
      ],
    });

    const result = await getAdminOrders(undefined, 1, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(2);
    // Should be sorted descending by createdAt
    expect(result.orders![0].orderId).toBe('order-002');
    expect(result.orders![1].orderId).toBe('order-001');
  });

  it('should paginate correctly', async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeFullOrder({ orderId: `order-${i}`, createdAt: `2024-01-0${5 - i}T00:00:00.000Z` }),
    );
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await getAdminOrders(undefined, 2, 2, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
  });

  it('should return empty list when no orders', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getAdminOrders('shipped', 1, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should clamp page to minimum 1', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeFullOrder()] });

    const result = await getAdminOrders(undefined, -1, 10, client, 'Orders');
    expect(result.page).toBe(1);
  });
});

describe('getAdminOrderDetail', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ORDER_NOT_FOUND when order does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getAdminOrderDetail('order-999', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ORDER_NOT_FOUND);
  });

  it('should return order detail for any user (no ownership check)', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ userId: 'other-user' }) });

    const result = await getAdminOrderDetail('order-001', client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.order).toBeDefined();
    expect(result.order!.userId).toBe('other-user');
    expect(result.order!.orderId).toBe('order-001');
  });

  it('should return full OrderResponse fields', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder() });

    const result = await getAdminOrderDetail('order-001', client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.order!.items).toHaveLength(1);
    expect(result.order!.totalPoints).toBe(100);
    expect(result.order!.shippingAddress.recipientName).toBe('张三');
    expect(result.order!.shippingStatus).toBe('pending');
    expect(result.order!.shippingEvents).toHaveLength(1);
  });
});

describe('updateShipping', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ORDER_NOT_FOUND when order does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await updateShipping('order-999', 'shipped', 'SF123', undefined, 'admin-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ORDER_NOT_FOUND);
  });

  it('should return INVALID_STATUS_TRANSITION for invalid transition', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ shippingStatus: 'pending' }) });

    const result = await updateShipping('order-001', 'delivered', undefined, undefined, 'admin-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('should return INVALID_STATUS_TRANSITION for backward transition', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ shippingStatus: 'shipped' }) });

    const result = await updateShipping('order-001', 'pending', undefined, undefined, 'admin-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('should return TRACKING_NUMBER_REQUIRED when shipping without tracking number', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ shippingStatus: 'pending' }) });

    const result = await updateShipping('order-001', 'shipped', undefined, undefined, 'admin-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TRACKING_NUMBER_REQUIRED);
  });

  it('should return TRACKING_NUMBER_REQUIRED when tracking number is empty string', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ shippingStatus: 'pending' }) });

    const result = await updateShipping('order-001', 'shipped', '  ', undefined, 'admin-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TRACKING_NUMBER_REQUIRED);
  });

  it('should succeed for valid pending -> shipped transition with tracking number', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ shippingStatus: 'pending' }) });
    client.send.mockResolvedValueOnce({}); // UpdateCommand

    const result = await updateShipping('order-001', 'shipped', 'SF1234567890', '已发货', 'admin-001', client, 'Orders');
    expect(result.success).toBe(true);

    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.input.ExpressionAttributeValues[':newStatus']).toBe('shipped');
    expect(updateCmd.input.ExpressionAttributeValues[':tn']).toBe('SF1234567890');
    // Verify new event is appended
    const newEvent = updateCmd.input.ExpressionAttributeValues[':newEvent'][0];
    expect(newEvent.status).toBe('shipped');
    expect(newEvent.remark).toBe('已发货');
    expect(newEvent.operatorId).toBe('admin-001');
  });

  // in_transit and delivered statuses are not yet implemented
});

describe('getOrderStats', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return zero counts when no orders', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getOrderStats(client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.stats).toEqual({
      pending: 0,
      shipped: 0,
      total: 0,
    });
  });

  it('should count orders by status correctly', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { shippingStatus: 'pending' },
        { shippingStatus: 'pending' },
        { shippingStatus: 'shipped' },
      ],
    });

    const result = await getOrderStats(client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.stats).toEqual({
      pending: 2,
      shipped: 1,
      total: 3,
    });
  });

  it('should use ProjectionExpression for efficiency', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await getOrderStats(client, 'Orders');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ProjectionExpression).toBe('shippingStatus');
  });
});
