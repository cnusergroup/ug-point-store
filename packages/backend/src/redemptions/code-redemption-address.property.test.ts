import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithCode, CodeRedemptionTableNames } from './code-redemption';
import { ErrorCodes } from '@points-mall/shared';
import type { ShippingEvent } from '@points-mall/shared';

// Feature: redemption-order-unification, Property 2: 兑换请求缺少 addressId 时被拒绝（Code 路径）
// For any Code 兑换请求，若请求中未提供 addressId（undefined/空字符串），
// 则兑换函数必须返回 success: false 且错误码为 NO_ADDRESS_SELECTED。
// **Validates: Requirements 2.1, 2.2**

const tables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

/** Arbitrary for a valid active code that matches the product */
function validCodeArb(productId: string) {
  return fc.record({
    codeId: fc.uuid(),
    codeValue: fc.string({ minLength: 4, maxLength: 20 }),
    type: fc.constant('product' as const),
    productId: fc.constant(productId),
    maxUses: fc.integer({ min: 2, max: 100 }),
    currentUses: fc.integer({ min: 0, max: 1 }),
    status: fc.constant('active' as const),
    usedBy: fc.constant({} as Record<string, string>),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  });
}

/** Arbitrary for a valid active code_exclusive product with stock */
const productArb = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  type: fc.constant('code_exclusive' as const),
  status: fc.constant('active' as const),
  stock: fc.integer({ min: 1, max: 1000 }),
  redemptionCount: fc.nat({ max: 10000 }),
  imageUrl: fc.constant('https://example.com/img.png'),
});

/** Arbitrary for missing addressId: empty string or undefined */
const missingAddressIdArb = fc.oneof(
  fc.constant(''),
  fc.constant(undefined as unknown as string),
);

/** Arbitrary for a userId that won't collide with usedBy */
const userIdArb = fc.uuid();

function setupMocks(
  client: any,
  code: Record<string, any>,
  product: Record<string, any>,
) {
  // 1st call: QueryCommand - code lookup
  client.send.mockResolvedValueOnce({ Items: [code] });
  // 2nd call: GetCommand - product lookup
  client.send.mockResolvedValueOnce({ Item: product });
}

describe('Property 2 (Code path): 兑换请求缺少 addressId 时被拒绝', () => {
  it('addressId 为空字符串或 undefined 时应返回 NO_ADDRESS_SELECTED 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          fc.tuple(fc.constant(product), validCodeArb(product.productId), userIdArb),
        ),
        missingAddressIdArb,
        async ([product, code, userId], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, code, product);

          const result = await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId },
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
          fc.tuple(fc.constant(product), validCodeArb(product.productId), userIdArb),
        ),
        missingAddressIdArb,
        async ([product, code, userId], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, code, product);

          await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId },
            client,
            tables,
          );

          // Only 2 calls: code query + product lookup, no address lookup or transaction
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
          fc.tuple(fc.constant(product), validCodeArb(product.productId), userIdArb),
        ),
        missingAddressIdArb,
        async ([product, code, userId], addressId) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, code, product);

          const result = await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId },
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


// Feature: redemption-order-unification, Property 4: 成功兑换创建正确的订单记录（Code 路径）
// For any 成功的 Code 兑换，Orders 表中必须存在一条对应的订单记录，满足：
// totalPoints 为 0，source 为 code_redemption，shippingStatus 为 pending，
// shippingEvents 包含一条初始事件（status: 'pending'）。
// **Validates: Requirements 4.2, 4.5**

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
  code: Record<string, any>,
  product: Record<string, any>,
  address: Record<string, any>,
) {
  // 1st call: QueryCommand - code lookup
  client.send.mockResolvedValueOnce({ Items: [code] });
  // 2nd call: GetCommand - product lookup
  client.send.mockResolvedValueOnce({
    Item: {
      productId: product.productId,
      name: product.name,
      type: 'code_exclusive',
      status: 'active',
      stock: product.stock,
      redemptionCount: product.redemptionCount,
      imageUrl: product.imageUrl,
    },
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

describe('Property 4 (Code path): 成功兑换创建正确的订单记录', () => {
  it('订单记录的 totalPoints 应为 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validCodeArb(product.productId).chain((code) =>
            userIdArb.chain((userId) =>
              fc.tuple(
                fc.constant(product),
                fc.constant(code),
                fc.constant(userId),
                validAddressArb(userId),
              ),
            ),
          ),
        ),
        async ([product, code, userId, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, code, product, address);

          const result = await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId: address.addressId },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // TransactWriteCommand is the 4th call (index 3)
          const txCmd = client.send.mock.calls[3][0];
          // Order record is the 4th item in TransactItems (index 3)
          const orderRecord = txCmd.input.TransactItems[3].Put.Item;
          expect(orderRecord.totalPoints).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 source 应为 code_redemption', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validCodeArb(product.productId).chain((code) =>
            userIdArb.chain((userId) =>
              fc.tuple(
                fc.constant(product),
                fc.constant(code),
                fc.constant(userId),
                validAddressArb(userId),
              ),
            ),
          ),
        ),
        async ([product, code, userId, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, code, product, address);

          await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[3].Put.Item;
          expect(orderRecord.source).toBe('code_redemption');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 shippingStatus 应为 pending', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validCodeArb(product.productId).chain((code) =>
            userIdArb.chain((userId) =>
              fc.tuple(
                fc.constant(product),
                fc.constant(code),
                fc.constant(userId),
                validAddressArb(userId),
              ),
            ),
          ),
        ),
        async ([product, code, userId, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, code, product, address);

          await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[3].Put.Item;
          expect(orderRecord.shippingStatus).toBe('pending');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('订单记录的 shippingEvents 应包含一条 pending 初始事件', async () => {
    await fc.assert(
      fc.asyncProperty(
        productArb.chain((product) =>
          validCodeArb(product.productId).chain((code) =>
            userIdArb.chain((userId) =>
              fc.tuple(
                fc.constant(product),
                fc.constant(code),
                fc.constant(userId),
                validAddressArb(userId),
              ),
            ),
          ),
        ),
        async ([product, code, userId, address]) => {
          const client = { send: vi.fn() } as any;
          setupMocksForSuccess(client, code, product, address);

          await redeemWithCode(
            { productId: product.productId, code: code.codeValue, userId, addressId: address.addressId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const orderRecord = txCmd.input.TransactItems[3].Put.Item;
          expect(orderRecord.shippingEvents).toHaveLength(1);
          const event: ShippingEvent = orderRecord.shippingEvents[0];
          expect(event.status).toBe('pending');
          expect(event.timestamp).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
