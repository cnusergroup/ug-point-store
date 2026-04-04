import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithCode, CodeRedemptionTableNames } from './code-redemption';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 12: Code 专属商品兑换绑定校验
// 对于任何 Code 和任何商品，只有当该 Code 的绑定商品 ID 与目标商品 ID 一致时，兑换才应成功；
// 否则应返回"兑换码与商品不匹配"的错误。
// Validates: Requirements 7.1, 7.3

const tables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const codeValueArb = fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) });

/** Arbitrary for a valid active product code bound to a given productId */
const productCodeArb = (boundProductId: string) =>
  fc.record({
    codeId: fc.uuid(),
    codeValue: codeValueArb,
    type: fc.constant('product' as const),
    productId: fc.constant(boundProductId),
    maxUses: fc.integer({ min: 1, max: 100 }),
    currentUses: fc.constant(0),
    status: fc.constant('active' as const),
    usedBy: fc.constant({}),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  });

/** Arbitrary for an active code_exclusive product */
const productArb = (productId: string) =>
  fc.record({
    productId: fc.constant(productId),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    type: fc.constant('code_exclusive' as const),
    status: fc.constant('active' as const),
    stock: fc.integer({ min: 1, max: 1000 }),
    redemptionCount: fc.nat({ max: 10000 }),
    eventInfo: fc.string({ minLength: 1, maxLength: 100 }),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  });

describe('Property 12: Code 专属商品兑换绑定校验', () => {
  it('当 Code 绑定商品 ID 与目标商品一致时，兑换应成功', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 1000 }),
        async (productId, userId, codeValue, productName, stock) => {
          const code = {
            codeId: 'code-id-1',
            codeValue,
            type: 'product',
            productId,
            maxUses: 10,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };
          const product = {
            productId,
            name: productName,
            type: 'code_exclusive',
            status: 'active',
            stock,
            redemptionCount: 0,
            eventInfo: 'Event',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          };
          const client = { send: vi.fn() } as any;

          // 1. Code query returns matching code
          client.send.mockResolvedValueOnce({ Items: [code] });
          // 2. Product lookup returns active product
          client.send.mockResolvedValueOnce({ Item: product });
          // 3. Address lookup returns valid address
          client.send.mockResolvedValueOnce({
            Item: { addressId: 'addr-001', userId, recipientName: 'Test', phone: '13800138000', detailAddress: '测试地址' },
          });
          // 4. TransactWrite succeeds
          client.send.mockResolvedValueOnce({});

          const result = await redeemWithCode(
            { productId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(true);
          expect(result.redemptionId).toBeDefined();
          expect(result.orderId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('当 Code 绑定商品 ID 与目标商品不一致时，应返回 CODE_PRODUCT_MISMATCH', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        async (boundProductId, targetProductId, userId, codeValue) => {
          // Ensure the two product IDs are different
          fc.pre(boundProductId !== targetProductId);

          const code = {
            codeId: 'code-id-1',
            codeValue,
            type: 'product',
            productId: boundProductId,
            maxUses: 10,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };
          const client = { send: vi.fn() } as any;

          // Code query returns code bound to a different product
          client.send.mockResolvedValueOnce({ Items: [code] });

          const result = await redeemWithCode(
            { productId: targetProductId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.CODE_PRODUCT_MISMATCH);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('当 Code 与商品不匹配时，不应发起产品查询或事务写入', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        async (boundProductId, targetProductId, userId, codeValue) => {
          fc.pre(boundProductId !== targetProductId);

          const code = {
            codeId: 'code-id-1',
            codeValue,
            type: 'product',
            productId: boundProductId,
            maxUses: 10,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };
          const client = { send: vi.fn() } as any;

          client.send.mockResolvedValueOnce({ Items: [code] });

          await redeemWithCode(
            { productId: targetProductId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          // Only 1 call: code query. No product lookup or TransactWrite.
          expect(client.send).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
