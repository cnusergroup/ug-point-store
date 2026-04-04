import { describe, it, expect, vi } from 'vitest';
import { listProducts, type ListProductsOptions } from './list';

function createMockDynamoClient(items: Record<string, unknown>[] = []) {
  return {
    send: vi.fn().mockResolvedValue({ Items: items }),
  } as any;
}

const tableName = 'Products';

const activePointsAll = {
  productId: 'p1',
  name: '全员商品',
  description: 'desc',
  imageUrl: 'img',
  type: 'points',
  status: 'active',
  stock: 10,
  redemptionCount: 0,
  pointsCost: 50,
  allowedRoles: 'all',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const activePointsSpeaker = {
  productId: 'p2',
  name: 'Speaker 专属',
  description: 'desc',
  imageUrl: 'img',
  type: 'points',
  status: 'active',
  stock: 5,
  redemptionCount: 0,
  pointsCost: 100,
  allowedRoles: ['Speaker'],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const activeCodeExclusive = {
  productId: 'p3',
  name: 'Code 专属',
  description: 'desc',
  imageUrl: 'img',
  type: 'code_exclusive',
  status: 'active',
  stock: 3,
  redemptionCount: 0,
  eventInfo: '2024 大会',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const inactiveProduct = {
  productId: 'p4',
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

describe('listProducts', () => {
  it('should use scan with status filter when no type provided', async () => {
    const client = createMockDynamoClient([activePointsAll, activeCodeExclusive]);
    const result = await listProducts({}, client, tableName);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('ScanCommand');
    expect(command.input.FilterExpression).toContain('#status = :status');
  });

  it('should use query with type-status-index GSI when type provided', async () => {
    const client = createMockDynamoClient([activePointsAll, activePointsSpeaker]);
    const result = await listProducts({ type: 'points' }, client, tableName);

    expect(result.items).toHaveLength(2);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input.IndexName).toBe('type-status-index');
    expect(command.input.ExpressionAttributeValues[':type']).toBe('points');
    expect(command.input.ExpressionAttributeValues[':status']).toBe('active');
  });

  it('should filter by roleFilter - keep products with matching role or all', async () => {
    const client = createMockDynamoClient([activePointsAll, activePointsSpeaker, activeCodeExclusive]);
    const result = await listProducts({ roleFilter: 'Volunteer' }, client, tableName);

    // activePointsAll (allowedRoles='all') + activeCodeExclusive (no allowedRoles) should pass
    // activePointsSpeaker (allowedRoles=['Speaker']) should be filtered out
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.productId)).toEqual(['p1', 'p3']);
  });

  it('should filter by roleFilter - include matching role', async () => {
    const client = createMockDynamoClient([activePointsAll, activePointsSpeaker, activeCodeExclusive]);
    const result = await listProducts({ roleFilter: 'Speaker' }, client, tableName);

    expect(result.items).toHaveLength(3);
  });

  it('should mark locked=true for points products user cannot redeem', async () => {
    const client = createMockDynamoClient([activePointsAll, activePointsSpeaker]);
    const result = await listProducts({ userRoles: ['Volunteer'] }, client, tableName);

    const allProduct = result.items.find((i) => i.productId === 'p1');
    const speakerProduct = result.items.find((i) => i.productId === 'p2');

    expect(allProduct!.locked).toBe(false); // allowedRoles='all'
    expect(speakerProduct!.locked).toBe(true); // user is Volunteer, product needs Speaker
  });

  it('should mark locked=false for points products user can redeem', async () => {
    const client = createMockDynamoClient([activePointsSpeaker]);
    const result = await listProducts({ userRoles: ['Speaker'] }, client, tableName);

    expect(result.items[0].locked).toBe(false);
  });

  it('should never lock code_exclusive products', async () => {
    const client = createMockDynamoClient([activeCodeExclusive]);
    const result = await listProducts({ userRoles: [] }, client, tableName);

    expect(result.items[0].locked).toBe(false);
  });

  it('should support pagination', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...activePointsAll,
      productId: `p${i}`,
    }));
    const client = createMockDynamoClient(items);

    const page1 = await listProducts({ page: 1, pageSize: 2 }, client, tableName);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    expect(page1.items[0].productId).toBe('p0');

    // Reset mock for page 2
    const client2 = createMockDynamoClient(items);
    const page2 = await listProducts({ page: 2, pageSize: 2 }, client2, tableName);
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].productId).toBe('p2');

    // Last page
    const client3 = createMockDynamoClient(items);
    const page3 = await listProducts({ page: 3, pageSize: 2 }, client3, tableName);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0].productId).toBe('p4');
  });

  it('should default to page=1 and pageSize=20', async () => {
    const client = createMockDynamoClient([activePointsAll]);
    const result = await listProducts({}, client, tableName);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('should default userRoles to empty array', async () => {
    const client = createMockDynamoClient([activePointsSpeaker]);
    const result = await listProducts({}, client, tableName);

    // No user roles → Speaker-only product should be locked
    expect(result.items[0].locked).toBe(true);
  });
});
