import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getProductDetail } from './detail';
import type { UserRole, ProductType } from '@points-mall/shared';

// Property 1: Bug Condition — Inactive Products Return Data
// For any product detail request where the requested productId exists in the database
// with status='inactive', the fixed getProductDetail function SHALL return
// { success: true, data: <product> } with the complete product data including status: 'inactive'.
// **Validates: Requirements 2.1, 2.2**

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

const productTypeArb = fc.constantFrom<ProductType>('points', 'code_exclusive');

const allowedRolesArb = fc.oneof(
  fc.constant('all' as const),
  fc.subarray(ALL_ROLES, { minLength: 1 }),
);

const imageArb = fc.record({
  key: fc.string({ minLength: 1, maxLength: 30 }),
  url: fc.string({ minLength: 1, maxLength: 50 }),
});

const sizeOptionArb = fc.record({
  name: fc.constantFrom('S', 'M', 'L', 'XL'),
  stock: fc.nat({ max: 100 }),
});

/** Arbitrary for an inactive product record as stored in DynamoDB */
const inactiveProductArb = fc
  .record({
    productId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ maxLength: 100 }),
    imageUrl: fc.constant('https://img.example.com/pic.png'),
    type: productTypeArb,
    status: fc.constant('inactive' as const),
    stock: fc.nat({ max: 1000 }),
    redemptionCount: fc.nat({ max: 500 }),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    images: fc.option(fc.array(imageArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
    sizeOptions: fc.option(fc.array(sizeOptionArb, { minLength: 0, maxLength: 4 }), { nil: undefined }),
    purchaseLimitEnabled: fc.option(fc.boolean(), { nil: undefined }),
    purchaseLimitCount: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
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

function createMockDynamoClient(item?: Record<string, unknown>) {
  return {
    send: vi.fn().mockResolvedValue({ Item: item }),
  } as any;
}

describe('Property 1: Bug Condition — Inactive product detail returns data', () => {
  it('getProductDetail returns success: true with complete data for any inactive product', async () => {
    await fc.assert(
      fc.asyncProperty(inactiveProductArb, async (product) => {
        const client = createMockDynamoClient(product);
        const result = await getProductDetail(product.productId, client, TABLE);

        // Must return success
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        // Must return the product data
        expect(result.data).toBeDefined();
        expect(result.data!.productId).toBe(product.productId);
        expect(result.data!.status).toBe('inactive');
        expect(result.data!.name).toBe(product.name);
        expect(result.data!.description).toBe(product.description);
        expect(result.data!.type).toBe(product.type);
        expect(result.data!.stock).toBe(product.stock);
        expect(result.data!.redemptionCount).toBe(product.redemptionCount);

        // Type-specific fields preserved
        if (product.type === 'points') {
          expect((result.data as any).pointsCost).toBe((product as any).pointsCost);
          expect((result.data as any).allowedRoles).toEqual((product as any).allowedRoles);
        } else {
          expect((result.data as any).eventInfo).toBe((product as any).eventInfo);
        }

        // Optional fields preserved when present
        if (product.images !== undefined) {
          expect(result.data!.images).toEqual(product.images);
        }
        if (product.sizeOptions !== undefined) {
          expect(result.data!.sizeOptions).toEqual(product.sizeOptions);
        }
        if (product.purchaseLimitEnabled !== undefined) {
          expect(result.data!.purchaseLimitEnabled).toBe(product.purchaseLimitEnabled);
        }
        if (product.purchaseLimitCount !== undefined) {
          expect(result.data!.purchaseLimitCount).toBe(product.purchaseLimitCount);
        }
      }),
      { numRuns: 100 },
    );
  });
});
