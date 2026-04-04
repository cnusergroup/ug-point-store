import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redeemWithPoints, RedemptionTableNames } from './points-redemption';
import { ErrorCodes } from '@points-mall/shared';

const tables: RedemptionTableNames = {
  usersTable: 'Users',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  pointsRecordsTable: 'PointsRecords',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
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

const defaultInput = { productId: 'prod-001', userId: 'user-001', addressId: 'addr-001' };

describe('redeemWithPoints', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return error when product does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined }); // product not found

    const result = await redeemWithPoints(
      { productId: 'nonexist', userId: 'user-001', addressId: 'addr-001' },
      client,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return error when product is inactive', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ status: 'inactive' }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return CODE_ONLY_PRODUCT for code_exclusive products', async () => {
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ type: 'code_exclusive', eventInfo: 'Event A' }),
    });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_ONLY_PRODUCT);
  });

  it('should return OUT_OF_STOCK when stock is zero', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ stock: 0 }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return INSUFFICIENT_POINTS when user has not enough points', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 1000 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 100 }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
  });

  it('should return NO_REDEMPTION_PERMISSION when user role does not match', async () => {
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ allowedRoles: ['UserGroupLeader'] }),
    });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: ['Volunteer'] }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);
  });

  it('should return NO_REDEMPTION_PERMISSION when user has no roles', async () => {
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ allowedRoles: ['Speaker'] }),
    });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: [] }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);
  });

  it('should return NO_ADDRESS_SELECTED when addressId is empty', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });

    const result = await redeemWithPoints(
      { productId: 'prod-001', userId: 'user-001', addressId: '' },
      client,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_ADDRESS_SELECTED);
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: undefined }); // address not found

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: makeAddress({ userId: 'other-user' }) });

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should succeed for valid redemption with allowedRoles=all', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 100 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 500 }) });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({}); // TransactWrite

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.redemptionId).toBeDefined();
    expect(result.orderId).toBeDefined();
  });

  it('should succeed when user role matches one of allowedRoles', async () => {
    client.send.mockResolvedValueOnce({
      Item: makeProduct({ allowedRoles: ['Speaker', 'Volunteer'], pointsCost: 50 }),
    });
    client.send.mockResolvedValueOnce({ Item: makeUser({ roles: ['Speaker'], points: 200 }) });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
  });

  it('should issue TransactWriteCommand with correct items including order', async () => {
    const product = makeProduct({ pointsCost: 100, name: 'Cool Item' });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 300 }) });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    await redeemWithPoints(defaultInput, client, tables);

    expect(client.send).toHaveBeenCalledTimes(4);
    const txCmd = client.send.mock.calls[3][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');

    const items = txCmd.input.TransactItems;
    expect(items).toHaveLength(5);

    // a. User points deduction
    expect(items[0].Update.TableName).toBe('Users');
    expect(items[0].Update.Key).toEqual({ userId: 'user-001' });
    expect(items[0].Update.ExpressionAttributeValues[':cost']).toBe(100);

    // b. Product stock decrement
    expect(items[1].Update.TableName).toBe('Products');
    expect(items[1].Update.Key).toEqual({ productId: 'prod-001' });

    // c. Redemption record (with orderId)
    expect(items[2].Put.TableName).toBe('Redemptions');
    expect(items[2].Put.Item.method).toBe('points');
    expect(items[2].Put.Item.pointsSpent).toBe(100);
    expect(items[2].Put.Item.productName).toBe('Cool Item');
    expect(items[2].Put.Item.status).toBe('success');
    expect(items[2].Put.Item.orderId).toBeDefined();

    // d. Points record
    expect(items[3].Put.TableName).toBe('PointsRecords');
    expect(items[3].Put.Item.type).toBe('spend');
    expect(items[3].Put.Item.amount).toBe(-100);
    expect(items[3].Put.Item.source).toBe('Cool Item');
    expect(items[3].Put.Item.balanceAfter).toBe(200);

    // e. Order record
    expect(items[4].Put.TableName).toBe('Orders');
    expect(items[4].Put.Item.orderId).toBeDefined();
    expect(items[4].Put.Item.userId).toBe('user-001');
    expect(items[4].Put.Item.totalPoints).toBe(100);
    expect(items[4].Put.Item.shippingStatus).toBe('pending');
    expect(items[4].Put.Item.source).toBe('points_redemption');
    expect(items[4].Put.Item.shippingAddress).toEqual({
      recipientName: '张三',
      phone: '13800138000',
      detailAddress: '北京市朝阳区某某路1号',
    });
    expect(items[4].Put.Item.shippingEvents).toHaveLength(1);
    expect(items[4].Put.Item.shippingEvents[0].status).toBe('pending');
    expect(items[4].Put.Item.shippingEvents[0].remark).toBe('兑换订单已创建');
    expect(items[4].Put.Item.items).toHaveLength(1);
    expect(items[4].Put.Item.items[0].productName).toBe('Cool Item');
    expect(items[4].Put.Item.items[0].quantity).toBe(1);
  });

  it('should return error when user does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: undefined }); // user not found

    const result = await redeemWithPoints(
      { productId: 'prod-001', userId: 'nonexist', addressId: 'addr-001' },
      client,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
  });

  it('should handle user with zero points defaulting correctly', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ pointsCost: 0 }) });
    client.send.mockResolvedValueOnce({ Item: makeUser({ points: 0 }) });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    const result = await redeemWithPoints(defaultInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
  });
});
