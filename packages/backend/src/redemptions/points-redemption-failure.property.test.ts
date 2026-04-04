import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithPoints, RedemptionTableNames } from './points-redemption';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 11: 积分兑换失败时状态不变
// 对于任何积分不足或角色不匹配的用户，对积分商品发起兑换请求应被拒绝，
// 且用户积分余额和商品库存均保持不变。
// Validates: Requirements 6.4, 6.5

const tables: RedemptionTableNames = {
  usersTable: 'Users',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  pointsRecordsTable: 'PointsRecords',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const ALL_ROLES = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const;

/** Arbitrary for a valid active points product with stock */
const productArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  pointsCost: fc.integer({ min: 1, max: 5000 }),
  stock: fc.integer({ min: 1, max: 1000 }),
  redemptionCount: fc.nat({ max: 10000 }),
  allowedRoles: fc.oneof(
    fc.constant('all' as const),
    fc.subarray([...ALL_ROLES], { minLength: 1 }),
  ),
});

/** Arbitrary for a user with INSUFFICIENT points (points < pointsCost) */
function insufficientPointsUserArb(product: { pointsCost: number; allowedRoles: readonly string[] | 'all' }) {
  const roleArb =
    product.allowedRoles === 'all'
      ? fc.subarray([...ALL_ROLES], { minLength: 0 })
      : fc.constant([product.allowedRoles[0]]);

  return fc.record({
    userId: fc.uuid(),
    points: fc.integer({ min: 0, max: Math.max(0, product.pointsCost - 1) }),
    roles: roleArb,
  });
}

/** Product with role restrictions (never 'all') */
const roleRestrictedProductArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  pointsCost: fc.integer({ min: 1, max: 5000 }),
  stock: fc.integer({ min: 1, max: 1000 }),
  redemptionCount: fc.nat({ max: 10000 }),
  allowedRoles: fc.subarray([...ALL_ROLES], { minLength: 1 }),
});

/** Arbitrary for a user whose roles do NOT overlap with product's allowedRoles */
function roleMismatchUserArb(product: { pointsCost: number; allowedRoles: readonly string[] }) {
  const disallowedRoles = ALL_ROLES.filter((r) => !product.allowedRoles.includes(r));
  const roleArb =
    disallowedRoles.length > 0
      ? fc.subarray(disallowedRoles, { minLength: 1 })
      : fc.constant([] as string[]);

  return fc.record({
    userId: fc.uuid(),
    points: fc.integer({ min: product.pointsCost, max: product.pointsCost + 100000 }),
    roles: roleArb,
  });
}

function setupMocks(
  client: any,
  product: Record<string, any>,
  user: Record<string, any>,
) {
  client.send.mockResolvedValueOnce({
    Item: {
      productId: product.productId,
      name: product.name,
      type: 'points',
      status: 'active',
      stock: product.stock,
      redemptionCount: product.redemptionCount,
      pointsCost: product.pointsCost,
      allowedRoles: product.allowedRoles,
    },
  });
  client.send.mockResolvedValueOnce({
    Item: { userId: user.userId, points: user.points, roles: user.roles },
  });
}

describe('Property 11: 积分兑换失败时状态不变', () => {
  it('积分不足时应返回 INSUFFICIENT_POINTS 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), insufficientPointsUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('积分不足时不应发起事务写入（积分和库存不变）', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), insufficientPointsUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(client.send).toHaveBeenCalledTimes(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('角色不匹配时应返回 NO_REDEMPTION_PERMISSION 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        roleRestrictedProductArb.chain((product) =>
          fc.tuple(fc.constant(product), roleMismatchUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('角色不匹配时不应发起事务写入（积分和库存不变）', async () => {
    await fc.assert(
      fc.asyncProperty(
        roleRestrictedProductArb.chain((product) =>
          fc.tuple(fc.constant(product), roleMismatchUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(client.send).toHaveBeenCalledTimes(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不应返回 redemptionId（无论是积分不足还是角色不匹配）', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), insufficientPointsUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.redemptionId).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
