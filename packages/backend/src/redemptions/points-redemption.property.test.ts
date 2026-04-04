import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithPoints, RedemptionTableNames } from './points-redemption';

// Feature: points-mall, Property 10: 积分兑换商品成功流程
// 对于任何积分充足且角色匹配的用户和任何有库存的积分商品，兑换后用户积分应减少商品所需积分数量，
// 商品库存应减少 1，且系统应生成兑换记录和积分扣减记录。
// Validates: Requirements 6.1, 6.2, 6.3

const tables: RedemptionTableNames = {
  usersTable: 'Users',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  pointsRecordsTable: 'PointsRecords',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const ALL_ROLES = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const;

/** Arbitrary for a valid points product with stock */
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

/** Arbitrary for a user whose points >= pointsCost and roles match allowedRoles */
function userArb(product: { pointsCost: number; allowedRoles: readonly string[] | 'all' }) {
  const roleArb =
    product.allowedRoles === 'all'
      ? fc.subarray([...ALL_ROLES], { minLength: 0 })
      : fc.constant([product.allowedRoles[0]]);

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
  // 1st call: GetCommand - product lookup
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
  // 2nd call: GetCommand - user lookup
  client.send.mockResolvedValueOnce({
    Item: { userId: user.userId, points: user.points, roles: user.roles },
  });
  // 3rd call: GetCommand - address lookup
  client.send.mockResolvedValueOnce({
    Item: {
      addressId: 'addr-001',
      userId: user.userId,
      recipientName: '张三',
      phone: '13800138000',
      detailAddress: '北京市朝阳区某某路1号',
    },
  });
  // 4th call: TransactWriteCommand
  client.send.mockResolvedValueOnce({});
}

describe('Property 10: 积分兑换商品成功流程', () => {
  it('兑换成功应返回 success 和 redemptionId', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) => fc.tuple(fc.constant(product), userArb(product))),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(true);
          expect(result.redemptionId).toBeDefined();
          expect(typeof result.redemptionId).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('事务中用户积分扣减量应等于商品所需积分', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) => fc.tuple(fc.constant(product), userArb(product))),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const items = txCmd.input.TransactItems;

          // User update: deduct pointsCost
          const userUpdate = items[0].Update;
          expect(userUpdate.TableName).toBe('Users');
          expect(userUpdate.ExpressionAttributeValues[':cost']).toBe(product.pointsCost);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('事务中商品库存应减少 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) => fc.tuple(fc.constant(product), userArb(product))),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const items = txCmd.input.TransactItems;

          // Product update: stock - 1, redemptionCount + 1
          const productUpdate = items[1].Update;
          expect(productUpdate.TableName).toBe('Products');
          expect(productUpdate.ExpressionAttributeValues[':one']).toBe(1);
          expect(productUpdate.ConditionExpression).toContain('stock > :zero');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('应生成正确的兑换记录（method=points, pointsSpent=商品积分, status=success）', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) => fc.tuple(fc.constant(product), userArb(product))),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const redemptionRecord = txCmd.input.TransactItems[2].Put.Item;

          expect(redemptionRecord.userId).toBe(user.userId);
          expect(redemptionRecord.productId).toBe(product.productId);
          expect(redemptionRecord.productName).toBe(product.name);
          expect(redemptionRecord.method).toBe('points');
          expect(redemptionRecord.pointsSpent).toBe(product.pointsCost);
          expect(redemptionRecord.status).toBe('success');
          expect(redemptionRecord.createdAt).toBeDefined();
          expect(redemptionRecord.redemptionId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('应生成正确的积分扣减记录（type=spend, amount=-pointsCost, balanceAfter 正确）', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) => fc.tuple(fc.constant(product), userArb(product))),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: 'addr-001' },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const pointsRecord = txCmd.input.TransactItems[3].Put.Item;

          expect(pointsRecord.userId).toBe(user.userId);
          expect(pointsRecord.type).toBe('spend');
          expect(pointsRecord.amount).toBe(-product.pointsCost);
          expect(pointsRecord.source).toBe(product.name);
          expect(pointsRecord.balanceAfter).toBe(user.points - product.pointsCost);
          expect(pointsRecord.createdAt).toBeDefined();
          expect(pointsRecord.recordId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
