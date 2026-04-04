import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithPoints, RedemptionTableNames } from './points-redemption';
import { ErrorCodes } from '@points-mall/shared';

// Feature: redemption-order-unification, Property 2: 兑换请求缺少 addressId 时被拒绝
// For any 积分兑换请求，若请求中未提供 addressId（undefined/空字符串），
// 则兑换函数必须返回 success: false 且错误码为 NO_ADDRESS_SELECTED。
// **Validates: Requirements 3.1, 3.2**

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

/** Arbitrary for a user with sufficient points and matching roles */
function validUserArb(product: { pointsCost: number; allowedRoles: readonly string[] | 'all' }) {
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

/** Arbitrary for missing addressId: empty string or undefined */
const missingAddressIdArb = fc.oneof(
  fc.constant(''),
  fc.constant(undefined as unknown as string),
);

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
}

// Feature: redemption-order-unification, Property 3: 兑换请求的地址归属校验
// For any 积分兑换请求，若提供的 addressId 对应的地址不存在或不属于当前用户，
// 则兑换函数必须返回 success: false 且错误码为 ADDRESS_NOT_FOUND。
// **Validates: Requirements 3.3, 3.4**

/** Arbitrary for a valid non-empty addressId */
const validAddressIdArb = fc.uuid();

/** Arbitrary for an address record belonging to a different user */
function otherUserAddressArb(requestUserId: string) {
  return fc.record({
    addressId: fc.uuid(),
    userId: fc.uuid().filter((id) => id !== requestUserId),
    recipientName: fc.string({ minLength: 1, maxLength: 20 }),
    phone: fc.string({ minLength: 11, maxLength: 11 }),
    detailAddress: fc.string({ minLength: 1, maxLength: 100 }),
  });
}

function setupMocksWithAddress(
  client: any,
  product: Record<string, any>,
  user: Record<string, any>,
  addressItem: Record<string, any> | undefined,
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
  client.send.mockResolvedValueOnce({ Item: addressItem });
}

describe('Property 3: 兑换请求的地址归属校验', () => {
  it('地址不存在时应返回 ADDRESS_NOT_FOUND 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        validAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocksWithAddress(client, product, user, undefined);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('地址属于其他用户时应返回 ADDRESS_NOT_FOUND 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        async ([product, user]) => {
          const client = { send: vi.fn() } as any;
          const otherAddress = fc.sample(otherUserAddressArb(user.userId), 1)[0];
          setupMocksWithAddress(client, product, user, otherAddress);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: otherAddress.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('地址不匹配时不应返回 redemptionId 或 orderId', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        validAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocksWithAddress(client, product, user, undefined);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          expect(result.redemptionId).toBeUndefined();
          expect(result.orderId).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('地址不匹配时不应发起事务写入', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        validAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocksWithAddress(client, product, user, undefined);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          // 3 calls: product lookup + user lookup + address lookup, no transaction
          expect(client.send).toHaveBeenCalledTimes(3);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: 兑换请求缺少 addressId 时被拒绝', () => {
  it('addressId 为空字符串或 undefined 时应返回 NO_ADDRESS_SELECTED 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        missingAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NO_ADDRESS_SELECTED);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('addressId 缺失时不应发起地址查询或事务写入', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        missingAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          // Only 2 calls: product lookup + user lookup, no address lookup or transaction
          expect(client.send).toHaveBeenCalledTimes(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('addressId 缺失时不应返回 redemptionId 或 orderId', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validUserArb(product)),
        ),
        missingAddressIdArb,
        async ([product, user], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, product, user);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId },
            client,
            tables,
          );

          expect(result.redemptionId).toBeUndefined();
          expect(result.orderId).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: redemption-order-unification, Property 4: 成功兑换创建正确的订单记录
// For any 成功的积分兑换，Orders 表中必须存在一条对应的订单记录，满足：
// shippingStatus 为 pending，shippingEvents 包含一条初始事件（status: 'pending'），
// shippingAddress 与用户选择的地址一致，source 为 points_redemption，
// totalPoints 等于商品积分价格。
// **Validates: Requirements 4.1, 4.3, 4.5**

/** Arbitrary for a valid address belonging to the user */
function validAddressArb(userId: string) {
  return fc.record({
    addressId: fc.uuid(),
    userId: fc.constant(userId),
    recipientName: fc.string({ minLength: 1, maxLength: 20 }),
    phone: fc.stringMatching(/^1[3-9]\d{9}$/),
    detailAddress: fc.string({ minLength: 1, maxLength: 100 }),
  });
}

function setupMocksForSuccess(
  client: any,
  product: Record<string, any>,
  user: Record<string, any>,
  address: Record<string, any>,
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
      imageUrl: 'https://example.com/img.png',
    },
  });
  // 2nd call: GetCommand - user lookup
  client.send.mockResolvedValueOnce({
    Item: { userId: user.userId, points: user.points, roles: user.roles },
  });
  // 3rd call: GetCommand - address lookup
  client.send.mockResolvedValueOnce({
    Item: {
      addressId: address.addressId,
      userId: address.userId,
      recipientName: address.recipientName,
      phone: address.phone,
      detailAddress: address.detailAddress,
    },
  });
  // 4th call: TransactWriteCommand - success
  client.send.mockResolvedValueOnce({});
}

describe('Property 4: 成功兑换创建正确的订单记录', () => {
  it('订单记录的 shippingStatus 应为 pending', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;
          expect(orderRecord.shippingStatus).toBe('pending');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 source 应为 points_redemption', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;
          expect(orderRecord.source).toBe('points_redemption');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 totalPoints 应等于商品的 pointsCost', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;
          expect(orderRecord.totalPoints).toBe(product.pointsCost);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 shippingAddress 应与选择的地址一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;
          expect(orderRecord.shippingAddress).toEqual({
            recipientName: address.recipientName,
            phone: address.phone,
            detailAddress: address.detailAddress,
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 shippingEvents 应包含一条 pending 初始事件', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;
          expect(orderRecord.shippingEvents).toHaveLength(1);
          expect(orderRecord.shippingEvents[0].status).toBe('pending');
          expect(orderRecord.shippingEvents[0].timestamp).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: redemption-order-unification, Property 5: 兑换记录和响应包含 orderId
// For any 成功的积分兑换，兑换函数的返回结果必须包含非空的 orderId，
// 且 Redemptions 表中对应的兑换记录也包含相同的 orderId。
// **Validates: Requirements 4.4, 4.6**

describe('Property 5: 兑换记录和响应包含 orderId', () => {
  it('返回结果应包含非空的 orderId', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(true);
          expect(result.orderId).toBeDefined();
          expect(typeof result.orderId).toBe('string');
          expect(result.orderId!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Redemptions 表的 Put 操作应包含与响应相同的 orderId', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // TransactWriteCommand is the 4th call (index 3)
          const txCmd = client.send.mock.calls[3][0];
          // Redemptions Put is the 3rd item in TransactItems (index 2)
          const redemptionRecord = txCmd.input.TransactItems[2].Put.Item;

          expect(redemptionRecord.orderId).toBeDefined();
          expect(redemptionRecord.orderId).toBe(result.orderId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('响应中的 orderId 与 Redemptions 记录中的 orderId 应一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validUserArb(product).chain((user) =>
            fc.tuple(
              fc.constant(product),
              fc.constant(user),
              validAddressArb(user.userId),
            ),
          ),
        ),
        async ([product, user, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, product, user, address);

          const result = await redeemWithPoints(
            { productId: product.productId, userId: user.userId, addressId: address.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          const txCmd = client.send.mock.calls[3][0];
          const redemptionRecord = txCmd.input.TransactItems[2].Put.Item;
          const orderRecord = txCmd.input.TransactItems[4].Put.Item;

          // All three orderId references must match
          expect(result.orderId).toBe(redemptionRecord.orderId);
          expect(result.orderId).toBe(orderRecord.orderId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
