import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { listProducts } from './list';
import type { UserRole, ProductType, ProductStatus } from '@points-mall/shared';

// Feature: points-mall, Property 9: 商品筛选正确性
// 对于任何商品类型筛选条件或角色筛选条件，返回的商品列表中每个商品都应满足筛选条件：
// 按类型筛选时所有商品类型一致，按角色筛选时所有商品允许该角色兑换。
// Validates: Requirements 5.6, 5.7

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

const productTypeArb = fc.constantFrom<ProductType>('points', 'code_exclusive');
const productStatusArb = fc.constantFrom<ProductStatus>('active', 'inactive');
const roleArb = fc.constantFrom<UserRole>(...ALL_ROLES);

const allowedRolesArb = fc.oneof(
  fc.constant('all' as const),
  fc.subarray(ALL_ROLES, { minLength: 1 }),
);

/** Arbitrary for a product record as stored in DynamoDB */
const productArb = fc
  .record({
    productId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ maxLength: 100 }),
    imageUrl: fc.constant('https://img.example.com/pic.png'),
    type: productTypeArb,
    status: productStatusArb,
    stock: fc.nat({ max: 1000 }),
    redemptionCount: fc.nat({ max: 500 }),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  })
  .chain((base) => {
    if (base.type === 'points') {
      return fc
        .record({
          pointsCost: fc.integer({ min: 1, max: 10000 }),
          allowedRoles: allowedRolesArb,
        })
        .map((ext) => ({ ...base, ...ext }));
    }
    return fc
      .record({
        eventInfo: fc.string({ minLength: 1, maxLength: 50 }),
      })
      .map((ext) => ({ ...base, ...ext }));
  });

const TABLE = 'Products';

/**
 * Creates a mock DynamoDB client that simulates real GSI / scan behavior:
 * - QueryCommand on type-status-index: returns active products matching the given type
 * - ScanCommand with status filter: returns all active products
 */
function createMockDynamoClient(allProducts: Record<string, unknown>[]) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor?.name ?? '';
      const active = allProducts.filter((p) => p.status === 'active');

      if (cmdName === 'QueryCommand') {
        // GSI query filters by type + status='active'
        const typeVal = cmd.input?.ExpressionAttributeValues?.[':type'];
        const filtered = active.filter((p) => p.type === typeVal);
        return Promise.resolve({ Items: filtered });
      }
      // ScanCommand — returns all active
      return Promise.resolve({ Items: active });
    }),
  } as any;
}

describe('Property 9: 商品筛选正确性', () => {
  it('按类型筛选时，返回的商品类型应全部一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productArb, { minLength: 0, maxLength: 30 }),
        productTypeArb,
        async (products, filterType) => {
          const client = createMockDynamoClient(products);
          const result = await listProducts({ type: filterType, pageSize: 1000 }, client, TABLE);

          for (const item of result.items) {
            expect(item.type).toBe(filterType);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('按类型筛选时，应包含所有该类型的 active 商品', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productArb, { minLength: 0, maxLength: 30 }),
        productTypeArb,
        async (products, filterType) => {
          const client = createMockDynamoClient(products);
          const result = await listProducts({ type: filterType, pageSize: 1000 }, client, TABLE);

          const expectedIds = products
            .filter((p) => p.status === 'active' && p.type === filterType)
            .map((p) => p.productId);

          const returnedIds = result.items.map((i) => i.productId);
          expect(returnedIds.length).toBe(expectedIds.length);
          for (const id of expectedIds) {
            expect(returnedIds).toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('按角色筛选时，返回的商品应全部允许该角色兑换', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productArb, { minLength: 0, maxLength: 30 }),
        roleArb,
        async (products, filterRole) => {
          const client = createMockDynamoClient(products);
          const result = await listProducts({ roleFilter: filterRole, pageSize: 1000 }, client, TABLE);

          for (const item of result.items) {
            if (item.type === 'code_exclusive') {
              // code_exclusive products have no allowedRoles — always pass role filter
              continue;
            }
            const allowed = (item as any).allowedRoles as UserRole[] | 'all' | undefined;
            if (allowed === 'all' || allowed === undefined) continue;
            expect(allowed).toContain(filterRole);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('按角色筛选时，不应遗漏任何允许该角色的 active 商品', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productArb, { minLength: 0, maxLength: 30 }),
        roleArb,
        async (products, filterRole) => {
          const client = createMockDynamoClient(products);
          const result = await listProducts({ roleFilter: filterRole, pageSize: 1000 }, client, TABLE);

          const expectedIds = products
            .filter((p) => {
              if (p.status !== 'active') return false;
              const allowed = (p as any).allowedRoles as UserRole[] | 'all' | undefined;
              if (!allowed) return true; // code_exclusive — no role restriction
              if (allowed === 'all') return true;
              return (allowed as UserRole[]).includes(filterRole);
            })
            .map((p) => p.productId);

          const returnedIds = result.items.map((i) => i.productId);
          expect(returnedIds.length).toBe(expectedIds.length);
          for (const id of expectedIds) {
            expect(returnedIds).toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('同时按类型和角色筛选时，返回的商品应同时满足两个条件', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productArb, { minLength: 0, maxLength: 30 }),
        productTypeArb,
        roleArb,
        async (products, filterType, filterRole) => {
          const client = createMockDynamoClient(products);
          const result = await listProducts(
            { type: filterType, roleFilter: filterRole, pageSize: 1000 },
            client,
            TABLE,
          );

          for (const item of result.items) {
            // Must match type
            expect(item.type).toBe(filterType);
            // Must match role
            if (item.type === 'code_exclusive') continue;
            const allowed = (item as any).allowedRoles as UserRole[] | 'all' | undefined;
            if (allowed === 'all' || allowed === undefined) continue;
            expect(allowed).toContain(filterRole);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
