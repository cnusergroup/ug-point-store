import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getProductDetail } from './detail';
import type { UserRole, ProductType } from '@points-mall/shared';

// Property 2: Preservation — Active Products and Missing Products Unchanged
// For any product detail request where the productId either does not exist in the database
// OR exists with status='active', the fixed getProductDetail function SHALL produce the same
// result as the original function, preserving the existing 404 behavior for missing products
// and normal data return for active products.
// **Validates: Requirements 3.1, 3.2**

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

/** Arbitrary for an active product record as stored in DynamoDB */
const activeProductArb = fc
  .record({
    productId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ maxLength: 100 }),
    imageUrl: fc.constant('https://img.example.com/pic.png'),
    type: productTypeArb,
    status: fc.constant('active' as const),
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

describe('Property 2: Preservation — Active/missing product behavior preserved', () => {
  it('getProductDetail returns success: true with complete data for any active product', async () => {
    await fc.assert(
      fc.asyncProperty(activeProductArb, async (product) => {
        const client = createMockDynamoClient(product);
        const result = await getProductDetail(product.productId, client, TABLE);

        // Must return success
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        // Must return the product data
        expect(result.data).toBeDefined();
        expect(result.data!.productId).toBe(product.productId);
        expect(result.data!.status).toBe('active');
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

  it('getProductDetail returns PRODUCT_NOT_FOUND for any missing product', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (productId) => {
        // DynamoDB returns undefined Item when product does not exist
        const client = createMockDynamoClient(undefined);
        const result = await getProductDetail(productId, client, TABLE);

        // Must return failure with PRODUCT_NOT_FOUND
        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('PRODUCT_NOT_FOUND');
        expect(result.error!.message).toBe('商品不存在');
      }),
      { numRuns: 100 },
    );
  });
});
