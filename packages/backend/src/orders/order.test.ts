import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrder, createDirectOrder, getOrders, getOrderDetail, getUserProductPurchaseCount, OrderTableNames } from './order';
import { ErrorCodes } from '@points-mall/shared';

const tables: OrderTableNames = {
  usersTable: 'Users',
  productsTable: 'Products',
  ordersTable: 'Orders',
  cartTable: 'Cart',
  pointsRecordsTable: 'PointsRecords',
  addressesTable: 'Addresses',
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeAddress(overrides: Record<string, any> = {}) {
  return {
    addressId: 'addr-001',
    userId: 'user-001',
    recipientName: '张三',
    phone: '13800138000',
    detailAddress: '北京市朝阳区某某路1号',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    productId: 'prod-001',
    name: 'Test Product',
    description: 'A test product',
    imageUrl: 'https://example.com/img.png',
    type: 'points',
    status: 'active',
    stock: 10,
    redemptionCount: 0,
    pointsCost: 100,
    allowedRoles: 'all',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeUser(overrides: Record<string, any> = {}) {
  return {
    userId: 'user-001',
    nickname: 'TestUser',
    roles: ['Speaker'],
    points: 500,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createOrder', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return NO_ADDRESS_SELECTED when addressId is empty', async () => {
    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], '', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_ADDRESS_SELECTED);
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined }); // address not found

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-999', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress({ userId: 'other-user' }) });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return INSUFFICIENT_POINTS when user does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: undefined }); // user not found

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
  });

  it('should return OUT_OF_STOCK when product does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser() }); // user
    client.send.mockResolvedValueOnce({ Item: undefined }); // product not found

    const result = await createOrder('user-001', [{ productId: 'prod-999', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return OUT_OF_STOCK when product is inactive', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser() });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ status: 'inactive' }) });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return OUT_OF_STOCK when product stock is insufficient', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser() });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ stock: 2 }) });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 5 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return NO_REDEMPTION_PERMISSION when user role does not match', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: ['Volunteer'] }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ allowedRoles: ['UserGroupLeader'] }) });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);
  });

  it('should return INSUFFICIENT_POINTS when user has not enough points', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 50 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
  });

  it('should succeed for a valid single-item order', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) }); // user
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) }); // product
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-001', items: [{ productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' }] } }); // cart get
    client.send.mockResolvedValueOnce({}); // cart put

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
  });

  it('should succeed for a valid multi-item order', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 1000 }) }); // user
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-001', pointsCost: 100, stock: 5 }) }); // product 1
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-002', pointsCost: 200, stock: 3, name: 'Product 2' }) }); // product 2
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-001', items: [] } }); // cart get
    client.send.mockResolvedValueOnce({}); // cart put

    const result = await createOrder(
      'user-001',
      [{ productId: 'prod-001', quantity: 2 }, { productId: 'prod-002', quantity: 1 }],
      'addr-001',
      client,
      tables,
    );
    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
  });

  it('should issue TransactWriteCommand with correct items for single product', async () => {
    const product = makeProduct({ pointsCost: 100, name: 'Cool Item', stock: 10 });
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 300 }) });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart get (no cart)

    await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);

    // TransactWrite is the 4th call (index 3)
    const txCmd = client.send.mock.calls[3][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');

    const txItems = txCmd.input.TransactItems;
    // 1 user update + 1 product update + 1 order put + 1 points record put = 4
    expect(txItems).toHaveLength(4);

    // a. User points deduction
    expect(txItems[0].Update.TableName).toBe('Users');
    expect(txItems[0].Update.Key).toEqual({ userId: 'user-001' });
    expect(txItems[0].Update.ExpressionAttributeValues[':total']).toBe(100);

    // b. Product stock decrement
    expect(txItems[1].Update.TableName).toBe('Products');
    expect(txItems[1].Update.Key).toEqual({ productId: 'prod-001' });
    expect(txItems[1].Update.ExpressionAttributeValues[':qty']).toBe(1);

    // c. Order record
    expect(txItems[2].Put.TableName).toBe('Orders');
    const orderItem = txItems[2].Put.Item;
    expect(orderItem.userId).toBe('user-001');
    expect(orderItem.totalPoints).toBe(100);
    expect(orderItem.shippingStatus).toBe('pending');
    expect(orderItem.shippingEvents).toHaveLength(1);
    expect(orderItem.shippingEvents[0].status).toBe('pending');
    expect(orderItem.items).toHaveLength(1);
    expect(orderItem.items[0].productName).toBe('Cool Item');
    expect(orderItem.shippingAddress.recipientName).toBe('张三');
    expect(orderItem.shippingAddress.phone).toBe('13800138000');

    // d. Points record
    expect(txItems[3].Put.TableName).toBe('PointsRecords');
    expect(txItems[3].Put.Item.type).toBe('spend');
    expect(txItems[3].Put.Item.amount).toBe(-100);
    expect(txItems[3].Put.Item.balanceAfter).toBe(200);
  });

  it('should remove redeemed items from cart after success', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-001', pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    // Cart has prod-001 (redeemed) and prod-002 (not redeemed)
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'user-001',
        items: [
          { productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' },
          { productId: 'prod-002', quantity: 3, addedAt: '2024-01-02T00:00:00.000Z' },
        ],
      },
    });
    client.send.mockResolvedValueOnce({}); // cart put

    await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);

    // Cart put is the 6th call (index 5)
    const cartPutCmd = client.send.mock.calls[5][0];
    expect(cartPutCmd.constructor.name).toBe('PutCommand');
    const cartItems = cartPutCmd.input.Item.items;
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].productId).toBe('prod-002');
  });

  it('should allow order with allowedRoles=all', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: ['Volunteer'], points: 200 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ allowedRoles: 'all', pointsCost: 50 }) });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
  });

  it('should allow order when user role matches one of allowedRoles', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: ['Speaker'], points: 200 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ allowedRoles: ['Speaker', 'Volunteer'], pointsCost: 50 }) });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
  });
});

describe('createDirectOrder', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should delegate to createOrder with single-item array', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createDirectOrder('user-001', 'prod-001', 1, 'addr-001', client, tables);
    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
  });

  it('should return error for invalid address just like createOrder', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined }); // address not found

    const result = await createDirectOrder('user-001', 'prod-001', 1, 'addr-999', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return INSUFFICIENT_POINTS for direct order', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 10 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });

    const result = await createDirectOrder('user-001', 'prod-001', 1, 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
  });
});


describe('getOrders', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  function makeOrderItem(overrides: Record<string, any> = {}) {
    return {
      orderId: 'order-001',
      userId: 'user-001',
      items: [
        { productId: 'prod-001', productName: 'Product 1', imageUrl: '', pointsCost: 100, quantity: 1, subtotal: 100 },
        { productId: 'prod-002', productName: 'Product 2', imageUrl: '', pointsCost: 200, quantity: 2, subtotal: 400 },
      ],
      totalPoints: 500,
      shippingStatus: 'pending',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('should return empty list when user has no orders', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const { getOrders } = await import('./order');
    const result = await getOrders('user-001', 1, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should return orders with correct OrderListItem fields', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeOrderItem({ orderId: 'order-001', totalPoints: 500, shippingStatus: 'pending', createdAt: '2024-01-02T00:00:00.000Z' })],
    });

    const { getOrders } = await import('./order');
    const result = await getOrders('user-001', 1, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders![0]).toEqual({
      orderId: 'order-001',
      itemCount: 2,
      totalPoints: 500,
      shippingStatus: 'pending',
      createdAt: '2024-01-02T00:00:00.000Z',
      productNames: ['Product 1', 'Product 2'],
    });
  });

  it('should paginate correctly', async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeOrderItem({ orderId: `order-${i}`, createdAt: `2024-01-0${5 - i}T00:00:00.000Z` }),
    );
    client.send.mockResolvedValueOnce({ Items: items });

    const { getOrders } = await import('./order');
    const result = await getOrders('user-001', 2, 2, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.orders![0].orderId).toBe('order-2');
    expect(result.orders![1].orderId).toBe('order-3');
  });

  it('should return empty page when page exceeds total', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeOrderItem()] });

    const { getOrders } = await import('./order');
    const result = await getOrders('user-001', 5, 10, client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.orders).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('should query GSI with ScanIndexForward=false for descending order', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const { getOrders } = await import('./order');
    await getOrders('user-001', 1, 10, client, 'Orders');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
    expect(cmd.input.ScanIndexForward).toBe(false);
    expect(cmd.input.ExpressionAttributeValues[':uid']).toBe('user-001');
  });

  it('should clamp page to minimum 1', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeOrderItem()] });

    const { getOrders } = await import('./order');
    const result = await getOrders('user-001', -1, 10, client, 'Orders');
    expect(result.page).toBe(1);
    expect(result.orders).toHaveLength(1);
  });
});

describe('getOrderDetail', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

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

  it('should return ORDER_NOT_FOUND when order does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const { getOrderDetail } = await import('./order');
    const result = await getOrderDetail('order-999', 'user-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ORDER_NOT_FOUND);
  });

  it('should return ORDER_NOT_FOUND when order belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeFullOrder({ userId: 'other-user' }) });

    const { getOrderDetail } = await import('./order');
    const result = await getOrderDetail('order-001', 'user-001', client, 'Orders');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ORDER_NOT_FOUND);
  });

  it('should return full OrderResponse when order exists and belongs to user', async () => {
    const orderData = makeFullOrder();
    client.send.mockResolvedValueOnce({ Item: orderData });

    const { getOrderDetail } = await import('./order');
    const result = await getOrderDetail('order-001', 'user-001', client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.order).toBeDefined();
    expect(result.order!.orderId).toBe('order-001');
    expect(result.order!.userId).toBe('user-001');
    expect(result.order!.items).toHaveLength(1);
    expect(result.order!.totalPoints).toBe(100);
    expect(result.order!.shippingAddress.recipientName).toBe('张三');
    expect(result.order!.shippingAddress.phone).toBe('13800138000');
    expect(result.order!.shippingStatus).toBe('pending');
    expect(result.order!.shippingEvents).toHaveLength(1);
    expect(result.order!.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(result.order!.updatedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('should return order with trackingNumber when present', async () => {
    client.send.mockResolvedValueOnce({
      Item: makeFullOrder({ shippingStatus: 'shipped', trackingNumber: 'SF1234567890' }),
    });

    const { getOrderDetail } = await import('./order');
    const result = await getOrderDetail('order-001', 'user-001', client, 'Orders');
    expect(result.success).toBe(true);
    expect(result.order!.trackingNumber).toBe('SF1234567890');
    expect(result.order!.shippingStatus).toBe('shipped');
  });

  it('should query by orderId primary key', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const { getOrderDetail } = await import('./order');
    await getOrderDetail('order-123', 'user-001', client, 'Orders');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('Orders');
    expect(cmd.input.Key).toEqual({ orderId: 'order-123' });
  });
});


describe('getUserProductPurchaseCount', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return 0 when user has no orders', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });
    const count = await getUserProductPurchaseCount('user-001', 'prod-001', client, 'Orders');
    expect(count).toBe(0);
  });

  it('should accumulate quantity for matching productId across orders', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { orderId: 'o1', items: [{ productId: 'prod-001', quantity: 2 }, { productId: 'prod-002', quantity: 1 }] },
        { orderId: 'o2', items: [{ productId: 'prod-001', quantity: 3 }] },
      ],
    });
    const count = await getUserProductPurchaseCount('user-001', 'prod-001', client, 'Orders');
    expect(count).toBe(5);
  });

  it('should return 0 when no orders contain the product', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { orderId: 'o1', items: [{ productId: 'prod-002', quantity: 1 }] },
      ],
    });
    const count = await getUserProductPurchaseCount('user-001', 'prod-001', client, 'Orders');
    expect(count).toBe(0);
  });

  it('should query the userId-createdAt-index GSI', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });
    await getUserProductPurchaseCount('user-001', 'prod-001', client, 'Orders');
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
    expect(cmd.input.ExpressionAttributeValues[':uid']).toBe('user-001');
  });
});

describe('createOrder - purchase limit validation', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return PURCHASE_LIMIT_EXCEEDED when historical + current exceeds limit', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) }); // user
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ purchaseLimitEnabled: true, purchaseLimitCount: 3, pointsCost: 100 }),
    }); // product
    // getUserProductPurchaseCount query - user already bought 2
    client.send.mockResolvedValueOnce({
      Items: [{ orderId: 'o1', items: [{ productId: 'prod-001', quantity: 2 }] }],
    });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 2 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PURCHASE_LIMIT_EXCEEDED);
    expect(result.error?.message).toContain('已购买 2 件');
    expect(result.error?.message).toContain('最多还可购买 1 件');
  });

  it('should allow order when within purchase limit', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) }); // user
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ purchaseLimitEnabled: true, purchaseLimitCount: 5, pointsCost: 100 }),
    }); // product
    // getUserProductPurchaseCount query - user already bought 2
    client.send.mockResolvedValueOnce({
      Items: [{ orderId: 'o1', items: [{ productId: 'prod-001', quantity: 2 }] }],
    });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 2 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
  });

  it('should skip purchase limit check when purchaseLimitEnabled is false', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) }); // user
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ purchaseLimitEnabled: false, pointsCost: 100 }),
    }); // product - no limit
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
  });
});

describe('createOrder - size validation', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return SIZE_REQUIRED when product has sizeOptions but no selectedSize', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 5 }, { name: 'M', stock: 5 }],
        pointsCost: 100,
      }),
    });

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_REQUIRED);
  });

  it('should return SIZE_NOT_FOUND when selectedSize does not exist in sizeOptions', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 5 }, { name: 'M', stock: 5 }],
        pointsCost: 100,
      }),
    });

    const result = await createOrder(
      'user-001',
      [{ productId: 'prod-001', quantity: 1, selectedSize: 'XXL' }],
      'addr-001',
      client,
      tables,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_NOT_FOUND);
  });

  it('should return SIZE_OUT_OF_STOCK when selected size has insufficient stock', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 1 }, { name: 'M', stock: 5 }],
        stock: 6,
        pointsCost: 100,
      }),
    });

    const result = await createOrder(
      'user-001',
      [{ productId: 'prod-001', quantity: 3, selectedSize: 'S' }],
      'addr-001',
      client,
      tables,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_OUT_OF_STOCK);
  });

  it('should succeed and save selectedSize in order items', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 5 }, { name: 'M', stock: 5 }],
        stock: 10,
        pointsCost: 100,
      }),
    });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder(
      'user-001',
      [{ productId: 'prod-001', quantity: 1, selectedSize: 'M' }],
      'addr-001',
      client,
      tables,
    );
    expect(result.success).toBe(true);

    // Verify selectedSize is saved in order record
    const txCmd = client.send.mock.calls[3][0];
    const orderRecord = txCmd.input.TransactItems[2].Put.Item;
    expect(orderRecord.items[0].selectedSize).toBe('M');
  });

  it('should use size-specific stock deduction in transaction for size-enabled products', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 5 }, { name: 'M', stock: 5 }],
        stock: 10,
        pointsCost: 100,
      }),
    });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    await createOrder(
      'user-001',
      [{ productId: 'prod-001', quantity: 2, selectedSize: 'M' }],
      'addr-001',
      client,
      tables,
    );

    // Verify the product update includes size-specific deduction
    const txCmd = client.send.mock.calls[3][0];
    const productUpdate = txCmd.input.TransactItems[1].Update;
    expect(productUpdate.UpdateExpression).toContain('sizeOptions[1].stock');
    expect(productUpdate.ConditionExpression).toContain('sizeOptions[1].stock >= :qty');
  });

  it('should not require selectedSize for products without sizeOptions', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) }); // no sizeOptions
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createOrder('user-001', [{ productId: 'prod-001', quantity: 1 }], 'addr-001', client, tables);
    expect(result.success).toBe(true);
  });
});

describe('createDirectOrder - size and purchase limit', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should pass selectedSize through to createOrder', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'L', stock: 5 }],
        stock: 5,
        pointsCost: 100,
      }),
    });
    client.send.mockResolvedValueOnce({}); // TransactWrite
    client.send.mockResolvedValueOnce({ Item: null }); // cart

    const result = await createDirectOrder('user-001', 'prod-001', 1, 'addr-001', client, tables, 'L');
    expect(result.success).toBe(true);

    // Verify selectedSize in order record
    const txCmd = client.send.mock.calls[3][0];
    const orderRecord = txCmd.input.TransactItems[2].Put.Item;
    expect(orderRecord.items[0].selectedSize).toBe('L');
  });

  it('should return SIZE_REQUIRED for direct order with size product but no selectedSize', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddress() });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({
      Item: makeProduct({
        sizeOptions: [{ name: 'S', stock: 5 }],
        stock: 5,
        pointsCost: 100,
      }),
    });

    const result = await createDirectOrder('user-001', 'prod-001', 1, 'addr-001', client, tables);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_REQUIRED);
  });
});
