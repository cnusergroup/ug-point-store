import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithPoints, RedemptionTableNames } from './points-redemption';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 14: Code 专属商品拒绝积分购买
// 对于任何 Code 专属商品，使用积分兑换的请求应被拒绝并返回"该商品仅支持 Code 兑换"的提示。
// Validates: Requirements 7.4

const tables: RedemptionTableNames = {
  usersTable: 'Users',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  pointsRecordsTable: 'PointsRecords',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const ALL_ROLES = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const;

/** Arbitrary for a code_exclusive product */
const codeExclusiveProductArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  eventInfo: fc.string({ minLength: 1, maxLength: 100 }),
  stock: fc.integer({ min: 1, max: 1000 }),
  redemptionCount: fc.nat({ max: 10000 }),
});

/** Arbitrary for any user (with arbitrary points and roles) */
const userArb = fc.record({
  userId: fc.uuid(),
  points: fc.integer({ min: 0, max: 100000 }),
  roles: fc.subarray([...ALL_ROLES], { minLength: 0 }),
});

describe('Property 14: Code 专属商品拒绝积分购买', () => {
  it('对 code_exclusive 商品的积分兑换请求应返回 CODE_ONLY_PRODUCT 错误', async () => {
    await fc.assert(
      fc.asyncProperty(codeExclusiveProductArb, userArb, async (product, user) => {
        const client = { send: vi.fn() } as any;

        // Mock product lookup returning a code_exclusive product
        client.send.mockResolvedValueOnce({
          Item: {
            productId: product.productId,
            name: product.name,
            type: 'code_exclusive',
            status: 'active',
            stock: product.stock,
            redemptionCount: product.redemptionCount,
            eventInfo: product.eventInfo,
          },
        });

        const result = await redeemWithPoints(
          { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
          client,
          tables,
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCodes.CODE_ONLY_PRODUCT);
      }),
      { numRuns: 100 },
    );
  });

  it('不应查询用户信息或发起事务写入（积分和库存不变）', async () => {
    await fc.assert(
      fc.asyncProperty(codeExclusiveProductArb, userArb, async (product, user) => {
        const client = { send: vi.fn() } as any;

        client.send.mockResolvedValueOnce({
          Item: {
            productId: product.productId,
            name: product.name,
            type: 'code_exclusive',
            status: 'active',
            stock: product.stock,
            redemptionCount: product.redemptionCount,
            eventInfo: product.eventInfo,
          },
        });

        await redeemWithPoints(
          { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
          client,
          tables,
        );

        // Only 1 call: product lookup. No user lookup or TransactWriteCommand.
        expect(client.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  it('不应返回 redemptionId', async () => {
    await fc.assert(
      fc.asyncProperty(codeExclusiveProductArb, userArb, async (product, user) => {
        const client = { send: vi.fn() } as any;

        client.send.mockResolvedValueOnce({
          Item: {
            productId: product.productId,
            name: product.name,
            type: 'code_exclusive',
            status: 'active',
            stock: product.stock,
            redemptionCount: product.redemptionCount,
            eventInfo: product.eventInfo,
          },
        });

        const result = await redeemWithPoints(
          { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
          client,
          tables,
        );

        expect(result.redemptionId).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
