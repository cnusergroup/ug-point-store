import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redeemWithCode, CodeRedemptionTableNames } from './code-redemption';
import { ErrorCodes } from '@points-mall/shared';

const tables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeCode(overrides: Record<string, any> = {}) {
  return {
    codeId: 'code-001',
    codeValue: 'PRODUCT-ABC',
    type: 'product',
    productId: 'prod-001',
    maxUses: 5,
    currentUses: 0,
    status: 'active',
    usedBy: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    productId: 'prod-001',
    name: 'Exclusive Gift',
    description: 'A code-exclusive product',
    imageUrl: 'https://example.com/img.png',
    type: 'code_exclusive',
    status: 'active',
    stock: 10,
    redemptionCount: 0,
    eventInfo: 'Community Event 2024',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultInput = { productId: 'prod-001', code: 'PRODUCT-ABC', userId: 'user-001', addressId: 'addr-001' };

function makeAddress(overrides: Record<string, any> = {}) {
  return {
    addressId: 'addr-001',
    userId: 'user-001',
    recipientName: 'Alice',
    phone: '13800138000',
    detailAddress: '北京市朝阳区某某路1号',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('redeemWithCode', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return INVALID_CODE when code does not exist', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code status is disabled', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode({ status: 'disabled' })] });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code status is exhausted', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode({ status: 'exhausted' })] });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code type is not product', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode({ type: 'points' })] });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return CODE_PRODUCT_MISMATCH when code productId does not match', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCode({ productId: 'prod-999' })],
    });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_PRODUCT_MISMATCH);
  });

  it('should return CODE_EXHAUSTED when currentUses >= maxUses', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCode({ currentUses: 5, maxUses: 5 })],
    });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_EXHAUSTED);
  });

  it('should return CODE_ALREADY_USED when userId is in usedBy', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCode({ usedBy: { 'user-001': '2024-01-01T00:00:00.000Z' } })],
    });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_ALREADY_USED);
  });

  it('should return error when product does not exist', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] }); // code query
    client.send.mockResolvedValueOnce({ Item: undefined }); // product not found

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return error when product is inactive', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ status: 'inactive' }) });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return OUT_OF_STOCK when product stock is zero', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ stock: 0 }) });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
  });

  it('should return NO_ADDRESS_SELECTED when addressId is empty', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });

    const result = await redeemWithCode({ ...defaultInput, addressId: '' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_ADDRESS_SELECTED);
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: undefined }); // address not found

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeAddress({ userId: 'other-user' }) });

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should succeed for valid code redemption', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeCode()] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({}); // TransactWrite

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.redemptionId).toBeDefined();
    expect(result.orderId).toBeDefined();
  });

  it('should issue TransactWriteCommand with correct items (no points deduction)', async () => {
    const code = makeCode({ codeValue: 'PRODUCT-ABC' });
    const product = makeProduct({ name: 'Exclusive Gift' });
    client.send.mockResolvedValueOnce({ Items: [code] });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    await redeemWithCode(defaultInput, client, tables);

    expect(client.send).toHaveBeenCalledTimes(4);
    const txCmd = client.send.mock.calls[3][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');

    const items = txCmd.input.TransactItems;
    // 4 items: update code, update product, put redemption, put order (NO points record)
    expect(items).toHaveLength(4);

    // a. Code update
    expect(items[0].Update.TableName).toBe('Codes');
    expect(items[0].Update.Key).toEqual({ codeId: 'code-001' });

    // b. Product stock decrement
    expect(items[1].Update.TableName).toBe('Products');
    expect(items[1].Update.Key).toEqual({ productId: 'prod-001' });

    // c. Redemption record with method='code', codeUsed, no pointsSpent, has orderId
    expect(items[2].Put.TableName).toBe('Redemptions');
    expect(items[2].Put.Item.method).toBe('code');
    expect(items[2].Put.Item.codeUsed).toBe('PRODUCT-ABC');
    expect(items[2].Put.Item.productName).toBe('Exclusive Gift');
    expect(items[2].Put.Item.status).toBe('success');
    expect(items[2].Put.Item.pointsSpent).toBeUndefined();
    expect(items[2].Put.Item.orderId).toBeDefined();

    // d. Order record
    expect(items[3].Put.TableName).toBe('Orders');
    expect(items[3].Put.Item.totalPoints).toBe(0);
    expect(items[3].Put.Item.source).toBe('code_redemption');
    expect(items[3].Put.Item.shippingStatus).toBe('pending');
    expect(items[3].Put.Item.shippingAddress.recipientName).toBe('Alice');
    expect(items[3].Put.Item.orderId).toBe(items[2].Put.Item.orderId);
  });

  it('should set code status to exhausted when reaching maxUses', async () => {
    const code = makeCode({ currentUses: 4, maxUses: 5 });
    client.send.mockResolvedValueOnce({ Items: [code] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    await redeemWithCode(defaultInput, client, tables);

    const txCmd = client.send.mock.calls[3][0];
    const codeUpdate = txCmd.input.TransactItems[0].Update;
    expect(codeUpdate.ExpressionAttributeValues[':newStatus']).toBe('exhausted');
  });

  it('should keep code status active when not reaching maxUses', async () => {
    const code = makeCode({ currentUses: 0, maxUses: 5 });
    client.send.mockResolvedValueOnce({ Items: [code] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    await redeemWithCode(defaultInput, client, tables);

    const txCmd = client.send.mock.calls[3][0];
    const codeUpdate = txCmd.input.TransactItems[0].Update;
    expect(codeUpdate.ExpressionAttributeValues[':newStatus']).toBe('active');
  });

  it('should allow different user to use same code', async () => {
    const code = makeCode({ usedBy: { 'user-002': '2024-01-01T00:00:00.000Z' }, currentUses: 1 });
    client.send.mockResolvedValueOnce({ Items: [code] });
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeAddress() }); // address lookup
    client.send.mockResolvedValueOnce({});

    const result = await redeemWithCode(defaultInput, client, tables);

    expect(result.success).toBe(true);
  });
});
