import { describe, it, expect, vi } from 'vitest';
import { getProductDetail } from './detail';

function createMockDynamoClient(item?: Record<string, unknown>) {
  return {
    send: vi.fn().mockResolvedValue({ Item: item }),
  } as any;
}

const tableName = 'Products';

describe('getProductDetail', () => {
  it('should return product detail for active points product', async () => {
    const product = {
      productId: 'p1',
      name: '积分商品',
      description: 'desc',
      imageUrl: 'img',
      type: 'points',
      status: 'active',
      stock: 10,
      redemptionCount: 0,
      pointsCost: 100,
      allowedRoles: ['Speaker', 'Volunteer'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p1', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.productId).toBe('p1');
    expect(result.data!.type).toBe('points');
    expect((result.data as any).allowedRoles).toEqual(['Speaker', 'Volunteer']);
    expect((result.data as any).pointsCost).toBe(100);
  });

  it('should return product detail for active code_exclusive product with eventInfo', async () => {
    const product = {
      productId: 'p2',
      name: 'Code 专属',
      description: 'desc',
      imageUrl: 'img',
      type: 'code_exclusive',
      status: 'active',
      stock: 5,
      redemptionCount: 0,
      eventInfo: '2024 年度大会',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p2', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.type).toBe('code_exclusive');
    expect((result.data as any).eventInfo).toBe('2024 年度大会');
  });

  it('should return 404 error when product not found', async () => {
    const client = createMockDynamoClient(undefined);
    const result = await getProductDetail('nonexistent', client, tableName);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('should return product detail when product is inactive', async () => {
    const product = {
      productId: 'p3',
      name: '下架商品',
      description: 'desc',
      imageUrl: 'img',
      type: 'points',
      status: 'inactive',
      stock: 0,
      redemptionCount: 5,
      pointsCost: 200,
      allowedRoles: 'all',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p3', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.productId).toBe('p3');
    expect(result.data!.status).toBe('inactive');
    expect(result.data!.type).toBe('points');
    expect((result.data as any).pointsCost).toBe(200);
    expect((result.data as any).allowedRoles).toBe('all');
    expect(result.error).toBeUndefined();
  });

  it('should return product detail for inactive code_exclusive product', async () => {
    const product = {
      productId: 'p10',
      name: '下架 Code 专属',
      description: 'desc',
      imageUrl: 'img',
      type: 'code_exclusive',
      status: 'inactive',
      stock: 0,
      redemptionCount: 3,
      eventInfo: '2023 年度大会',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p10', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.productId).toBe('p10');
    expect(result.data!.status).toBe('inactive');
    expect(result.data!.type).toBe('code_exclusive');
    expect((result.data as any).eventInfo).toBe('2023 年度大会');
    expect(result.error).toBeUndefined();
  });

  it('should use GetCommand with correct table and key', async () => {
    const product = {
      productId: 'p1',
      name: 'test',
      type: 'points',
      status: 'active',
    };
    const client = createMockDynamoClient(product);
    await getProductDetail('p1', client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('GetCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.Key).toEqual({ productId: 'p1' });
  });

  it('should return points product with allowedRoles="all"', async () => {
    const product = {
      productId: 'p4',
      name: '全员商品',
      type: 'points',
      status: 'active',
      stock: 10,
      redemptionCount: 0,
      pointsCost: 50,
      allowedRoles: 'all',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p4', client, tableName);

    expect(result.success).toBe(true);
    expect((result.data as any).allowedRoles).toBe('all');
  });

  it('should return product with images field', async () => {
    const images = [
      { key: 'products/p5/img1.jpg', url: '/images/products/p5/img1.jpg' },
      { key: 'products/p5/img2.png', url: '/images/products/p5/img2.png' },
    ];
    const product = {
      productId: 'p5',
      name: '多图商品',
      type: 'points',
      status: 'active',
      stock: 10,
      redemptionCount: 0,
      pointsCost: 100,
      allowedRoles: 'all',
      imageUrl: '/images/products/p5/img1.jpg',
      images,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p5', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.images).toEqual(images);
    expect(result.data!.images).toHaveLength(2);
  });

  it('should return product with sizeOptions field', async () => {
    const sizeOptions = [
      { name: 'S', stock: 5 },
      { name: 'M', stock: 10 },
      { name: 'L', stock: 3 },
    ];
    const product = {
      productId: 'p6',
      name: '尺码商品',
      type: 'points',
      status: 'active',
      stock: 18,
      redemptionCount: 0,
      pointsCost: 200,
      allowedRoles: 'all',
      sizeOptions,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p6', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.sizeOptions).toEqual(sizeOptions);
    expect(result.data!.sizeOptions).toHaveLength(3);
  });

  it('should return product with purchaseLimitEnabled and purchaseLimitCount fields', async () => {
    const product = {
      productId: 'p7',
      name: '限购商品',
      type: 'points',
      status: 'active',
      stock: 50,
      redemptionCount: 0,
      pointsCost: 300,
      allowedRoles: 'all',
      purchaseLimitEnabled: true,
      purchaseLimitCount: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p7', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.purchaseLimitEnabled).toBe(true);
    expect(result.data!.purchaseLimitCount).toBe(2);
  });

  it('should return product with all new fields combined', async () => {
    const images = [
      { key: 'products/p8/img1.jpg', url: '/images/products/p8/img1.jpg' },
    ];
    const sizeOptions = [
      { name: 'M', stock: 8 },
      { name: 'L', stock: 12 },
    ];
    const product = {
      productId: 'p8',
      name: '全功能商品',
      type: 'points',
      status: 'active',
      stock: 20,
      redemptionCount: 0,
      pointsCost: 500,
      allowedRoles: 'all',
      imageUrl: '/images/products/p8/img1.jpg',
      images,
      sizeOptions,
      purchaseLimitEnabled: true,
      purchaseLimitCount: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p8', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.images).toEqual(images);
    expect(result.data!.sizeOptions).toEqual(sizeOptions);
    expect(result.data!.purchaseLimitEnabled).toBe(true);
    expect(result.data!.purchaseLimitCount).toBe(3);
  });

  it('should return product without new fields when not set (backward compatibility)', async () => {
    const product = {
      productId: 'p9',
      name: '旧商品',
      type: 'points',
      status: 'active',
      stock: 5,
      redemptionCount: 0,
      pointsCost: 100,
      allowedRoles: 'all',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const client = createMockDynamoClient(product);
    const result = await getProductDetail('p9', client, tableName);

    expect(result.success).toBe(true);
    expect(result.data!.images).toBeUndefined();
    expect(result.data!.sizeOptions).toBeUndefined();
    expect(result.data!.purchaseLimitEnabled).toBeUndefined();
    expect(result.data!.purchaseLimitCount).toBeUndefined();
  });
});
