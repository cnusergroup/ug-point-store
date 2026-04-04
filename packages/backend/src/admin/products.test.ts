import { describe, it, expect, vi } from 'vitest';
import {
  createPointsProduct,
  createCodeExclusiveProduct,
  updateProduct,
  setProductStatus,
  listAdminProducts,
  validateSizeOptions,
  validatePurchaseLimit,
  syncImageUrl,
  type CreatePointsProductInput,
  type CreateCodeExclusiveProductInput,
} from './products';

function createMockDynamoClient() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const tableName = 'Products';

describe('createPointsProduct', () => {
  const input: CreatePointsProductInput = {
    name: '测试积分商品',
    description: '这是一个测试商品',
    imageUrl: 'https://example.com/image.png',
    pointsCost: 100,
    stock: 50,
    allowedRoles: ['Speaker', 'Volunteer'],
  };

  it('should create a points product with correct fields', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(input, client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.type).toBe('points');
    expect(result.data!.status).toBe('active');
    expect(result.data!.redemptionCount).toBe(0);
    expect(result.data!.name).toBe(input.name);
    expect(result.data!.pointsCost).toBe(100);
    expect(result.data!.allowedRoles).toEqual(['Speaker', 'Volunteer']);
    expect(result.data!.stock).toBe(50);
    expect(result.data!.productId).toBeDefined();
    expect(result.data!.createdAt).toBeDefined();
    expect(result.data!.updatedAt).toBeDefined();
  });

  it('should generate a unique productId using ulid', async () => {
    const client = createMockDynamoClient();
    const r1 = await createPointsProduct(input, client, tableName);
    const r2 = await createPointsProduct(input, client, tableName);

    expect(r1.data!.productId).not.toBe(r2.data!.productId);
  });

  it('should put item into DynamoDB with correct table name', async () => {
    const client = createMockDynamoClient();
    await createPointsProduct(input, client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('PutCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.Item.type).toBe('points');
  });

  it('should support allowedRoles as "all"', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      { ...input, allowedRoles: 'all' },
      client,
      tableName,
    );

    expect(result.data!.allowedRoles).toBe('all');
  });
});

describe('createCodeExclusiveProduct', () => {
  const input: CreateCodeExclusiveProductInput = {
    name: 'Code 专属商品',
    description: '活动专属奖品',
    imageUrl: 'https://example.com/code-product.png',
    eventInfo: '2024 年度社区大会',
    stock: 10,
  };

  it('should create a code-exclusive product with correct fields', async () => {
    const client = createMockDynamoClient();
    const result = await createCodeExclusiveProduct(input, client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.type).toBe('code_exclusive');
    expect(result.data!.status).toBe('active');
    expect(result.data!.redemptionCount).toBe(0);
    expect(result.data!.name).toBe(input.name);
    expect(result.data!.eventInfo).toBe('2024 年度社区大会');
    expect(result.data!.stock).toBe(10);
    expect(result.data!.productId).toBeDefined();
  });

  it('should put item into DynamoDB with type code_exclusive', async () => {
    const client = createMockDynamoClient();
    await createCodeExclusiveProduct(input, client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('PutCommand');
    expect(command.input.Item.type).toBe('code_exclusive');
    expect(command.input.Item.eventInfo).toBe('2024 年度社区大会');
  });
});

describe('updateProduct', () => {
  it('should build dynamic update expression for provided fields', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      { name: '新名称', description: '新描述' },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);

    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.Key).toEqual({ productId: 'prod-1' });
    expect(command.input.UpdateExpression).toContain('#name');
    expect(command.input.UpdateExpression).toContain('#description');
    expect(command.input.UpdateExpression).toContain('#updatedAt');
    expect(command.input.ExpressionAttributeValues[':name']).toBe('新名称');
    expect(command.input.ExpressionAttributeValues[':description']).toBe('新描述');
  });

  it('should filter out immutable fields (productId, type, createdAt, redemptionCount)', async () => {
    const client = createMockDynamoClient();
    await updateProduct(
      'prod-1',
      { name: '新名称', productId: 'hack', type: 'points', createdAt: 'old', redemptionCount: 999 },
      client,
      tableName,
    );

    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':productId']).toBeUndefined();
    expect(command.input.ExpressionAttributeValues[':type']).toBeUndefined();
    expect(command.input.ExpressionAttributeValues[':createdAt']).toBeUndefined();
    expect(command.input.ExpressionAttributeValues[':redemptionCount']).toBeUndefined();
    expect(command.input.ExpressionAttributeValues[':name']).toBe('新名称');
  });

  it('should return error when no valid updates provided', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct('prod-1', { productId: 'hack' }, client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_UPDATES');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should ignore undefined values', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      { name: '有效', stock: undefined },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':stock']).toBeUndefined();
    expect(command.input.ExpressionAttributeValues[':name']).toBe('有效');
  });

  it('should always set updatedAt timestamp', async () => {
    const client = createMockDynamoClient();
    await updateProduct('prod-1', { stock: 20 }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.UpdateExpression).toContain('#updatedAt');
    const now = command.input.ExpressionAttributeValues[':updatedAt'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe('setProductStatus', () => {
  it('should set product status to active', async () => {
    const client = createMockDynamoClient();
    const result = await setProductStatus('prod-1', 'active', client, tableName);

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.Key).toEqual({ productId: 'prod-1' });
    expect(command.input.ExpressionAttributeValues[':status']).toBe('active');
  });

  it('should set product status to inactive', async () => {
    const client = createMockDynamoClient();
    const result = await setProductStatus('prod-1', 'inactive', client, tableName);

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':status']).toBe('inactive');
  });

  it('should reject invalid status values', async () => {
    const client = createMockDynamoClient();
    const result = await setProductStatus('prod-1', 'deleted' as any, client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_STATUS');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should set updatedAt timestamp', async () => {
    const client = createMockDynamoClient();
    await setProductStatus('prod-1', 'inactive', client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.UpdateExpression).toContain('updatedAt');
    const now = command.input.ExpressionAttributeValues[':now'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});


describe('listAdminProducts', () => {
  it('should return all products including both active and inactive', async () => {
    const items = [
      { productId: 'p1', name: '商品A', type: 'points', status: 'active', stock: 10, redemptionCount: 5, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
      { productId: 'p2', name: '商品B', type: 'code_exclusive', status: 'inactive', stock: 0, redemptionCount: 20, createdAt: '2024-01-02T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z' },
    ];
    const client = { send: vi.fn().mockResolvedValue({ Items: items }) } as any;

    const result = await listAdminProducts(client, tableName);

    expect(result).toHaveLength(2);
    expect(result.some(p => p.status === 'active')).toBe(true);
    expect(result.some(p => p.status === 'inactive')).toBe(true);
  });

  it('should sort products by createdAt descending (newest first)', async () => {
    const items = [
      { productId: 'p1', name: '旧商品', createdAt: '2024-01-01T00:00:00.000Z', stock: 5, redemptionCount: 1 },
      { productId: 'p2', name: '新商品', createdAt: '2024-06-15T00:00:00.000Z', stock: 10, redemptionCount: 3 },
      { productId: 'p3', name: '中间商品', createdAt: '2024-03-10T00:00:00.000Z', stock: 8, redemptionCount: 2 },
    ];
    const client = { send: vi.fn().mockResolvedValue({ Items: items }) } as any;

    const result = await listAdminProducts(client, tableName);

    expect(result[0].productId).toBe('p2');
    expect(result[1].productId).toBe('p3');
    expect(result[2].productId).toBe('p1');
  });

  it('should include redemptionCount and stock in each product', async () => {
    const items = [
      { productId: 'p1', name: '商品', stock: 42, redemptionCount: 17, createdAt: '2024-01-01T00:00:00.000Z' },
    ];
    const client = { send: vi.fn().mockResolvedValue({ Items: items }) } as any;

    const result = await listAdminProducts(client, tableName);

    expect(result[0].stock).toBe(42);
    expect(result[0].redemptionCount).toBe(17);
  });

  it('should return empty array when no products exist', async () => {
    const client = { send: vi.fn().mockResolvedValue({ Items: undefined }) } as any;

    const result = await listAdminProducts(client, tableName);

    expect(result).toEqual([]);
  });

  it('should scan the correct table without any filter', async () => {
    const client = { send: vi.fn().mockResolvedValue({ Items: [] }) } as any;

    await listAdminProducts(client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('ScanCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.FilterExpression).toBeUndefined();
  });
});


describe('validateSizeOptions', () => {
  it('should return error when sizeOptions is empty', () => {
    const result = validateSizeOptions([]);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('SIZE_OPTIONS_REQUIRED');
  });

  it('should return null for valid non-empty sizeOptions with unique names', () => {
    const result = validateSizeOptions([
      { name: 'S', stock: 10 },
      { name: 'M', stock: 20 },
      { name: 'L', stock: 15 },
    ]);
    expect(result).toBeNull();
  });

  it('should return error when sizeOptions has duplicate names', () => {
    const result = validateSizeOptions([
      { name: 'S', stock: 10 },
      { name: 'M', stock: 20 },
      { name: 'S', stock: 5 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('DUPLICATE_SIZE_NAME');
  });

  it('should allow single size option', () => {
    const result = validateSizeOptions([{ name: 'OneSize', stock: 100 }]);
    expect(result).toBeNull();
  });
});

describe('validatePurchaseLimit', () => {
  it('should return null when not enabled', () => {
    expect(validatePurchaseLimit(false, undefined)).toBeNull();
    expect(validatePurchaseLimit(undefined, undefined)).toBeNull();
  });

  it('should return null when enabled with valid positive integer', () => {
    expect(validatePurchaseLimit(true, 1)).toBeNull();
    expect(validatePurchaseLimit(true, 5)).toBeNull();
    expect(validatePurchaseLimit(true, 100)).toBeNull();
  });

  it('should return error when enabled with zero', () => {
    const result = validatePurchaseLimit(true, 0);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PURCHASE_LIMIT_INVALID');
  });

  it('should return error when enabled with negative number', () => {
    const result = validatePurchaseLimit(true, -1);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PURCHASE_LIMIT_INVALID');
  });

  it('should return error when enabled with decimal', () => {
    const result = validatePurchaseLimit(true, 2.5);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PURCHASE_LIMIT_INVALID');
  });

  it('should return error when enabled with undefined count', () => {
    const result = validatePurchaseLimit(true, undefined);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PURCHASE_LIMIT_INVALID');
  });
});

describe('syncImageUrl', () => {
  it('should return first image url when images is non-empty', () => {
    const images = [
      { key: 'products/abc/1.jpg', url: '/images/products/abc/1.jpg' },
      { key: 'products/abc/2.jpg', url: '/images/products/abc/2.jpg' },
    ];
    expect(syncImageUrl(images)).toBe('/images/products/abc/1.jpg');
  });

  it('should return empty string when images is empty', () => {
    expect(syncImageUrl([])).toBe('');
  });

  it('should return empty string when images is undefined', () => {
    expect(syncImageUrl(undefined)).toBe('');
  });
});

describe('createPointsProduct with new fields', () => {
  const baseInput: CreatePointsProductInput = {
    name: '尺码商品',
    description: '带尺码的商品',
    imageUrl: '',
    pointsCost: 200,
    stock: 0,
    allowedRoles: 'all',
  };

  it('should calculate stock from sizeOptions when provided', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      {
        ...baseInput,
        sizeOptions: [
          { name: 'S', stock: 10 },
          { name: 'M', stock: 20 },
          { name: 'L', stock: 30 },
        ],
      },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.stock).toBe(60);
    expect(result.data!.sizeOptions).toHaveLength(3);
  });

  it('should sync imageUrl from images array', async () => {
    const client = createMockDynamoClient();
    const images = [
      { key: 'products/abc/1.jpg', url: '/images/products/abc/1.jpg' },
      { key: 'products/abc/2.jpg', url: '/images/products/abc/2.jpg' },
    ];
    const result = await createPointsProduct(
      { ...baseInput, images },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.imageUrl).toBe('/images/products/abc/1.jpg');
    expect(result.data!.images).toEqual(images);
  });

  it('should reject empty sizeOptions', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      { ...baseInput, sizeOptions: [] },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('SIZE_OPTIONS_REQUIRED');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject duplicate size names', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      {
        ...baseInput,
        sizeOptions: [
          { name: 'M', stock: 10 },
          { name: 'M', stock: 20 },
        ],
      },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('DUPLICATE_SIZE_NAME');
  });

  it('should reject invalid purchase limit', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      { ...baseInput, purchaseLimitEnabled: true, purchaseLimitCount: 0 },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('PURCHASE_LIMIT_INVALID');
  });

  it('should save purchase limit fields when valid', async () => {
    const client = createMockDynamoClient();
    const result = await createPointsProduct(
      { ...baseInput, purchaseLimitEnabled: true, purchaseLimitCount: 3 },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.purchaseLimitEnabled).toBe(true);
    expect(result.data!.purchaseLimitCount).toBe(3);
  });
});

describe('createCodeExclusiveProduct with new fields', () => {
  const baseInput: CreateCodeExclusiveProductInput = {
    name: 'Code 尺码商品',
    description: '带尺码的 Code 商品',
    imageUrl: '',
    eventInfo: '测试活动',
    stock: 0,
  };

  it('should calculate stock from sizeOptions', async () => {
    const client = createMockDynamoClient();
    const result = await createCodeExclusiveProduct(
      {
        ...baseInput,
        sizeOptions: [
          { name: 'S', stock: 5 },
          { name: 'L', stock: 15 },
        ],
      },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.stock).toBe(20);
  });

  it('should reject invalid purchase limit', async () => {
    const client = createMockDynamoClient();
    const result = await createCodeExclusiveProduct(
      { ...baseInput, purchaseLimitEnabled: true, purchaseLimitCount: -1 },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('PURCHASE_LIMIT_INVALID');
  });
});

describe('updateProduct with new fields', () => {
  it('should validate and recalculate stock when sizeOptions updated', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      {
        sizeOptions: [
          { name: 'S', stock: 10 },
          { name: 'M', stock: 25 },
        ],
      },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':stock']).toBe(35);
    expect(command.input.ExpressionAttributeValues[':sizeOptions']).toEqual([
      { name: 'S', stock: 10 },
      { name: 'M', stock: 25 },
    ]);
  });

  it('should reject duplicate size names on update', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      {
        sizeOptions: [
          { name: 'L', stock: 10 },
          { name: 'L', stock: 20 },
        ],
      },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('DUPLICATE_SIZE_NAME');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject invalid purchase limit on update', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      { purchaseLimitEnabled: true, purchaseLimitCount: 0 },
      client,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('PURCHASE_LIMIT_INVALID');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should sync imageUrl when images updated', async () => {
    const client = createMockDynamoClient();
    const images = [
      { key: 'products/p1/1.jpg', url: '/images/products/p1/1.jpg' },
    ];
    const result = await updateProduct(
      'prod-1',
      { images },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':imageUrl']).toBe('/images/products/p1/1.jpg');
  });

  it('should set imageUrl to empty string when images is empty array', async () => {
    const client = createMockDynamoClient();
    const result = await updateProduct(
      'prod-1',
      { images: [] },
      client,
      tableName,
    );

    expect(result.success).toBe(true);
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':imageUrl']).toBe('');
  });
});
