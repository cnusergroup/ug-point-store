import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemWithCode, CodeRedemptionTableNames } from './code-redemption';

// Feature: points-mall, Property 13: Code 专属商品兑换不扣积分
// 对于任何通过 Code 成功兑换的专属商品，用户的积分余额应在兑换前后保持不变。
// Validates: Requirements 7.2

const tables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const codeValueArb = fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) });

function makeCode(overrides: Record<string, any> = {}) {
  return {
    codeId: 'code-001',
    codeValue: 'PRODUCT-ABC',
    type: 'product',
    productId: 'prod-001',
    maxUses: 10,
    currentUses: 0,
    status: 'active',
    usedBy: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    productId: 'prod-001',
    name: 'Exclusive Gift',
    type: 'code_exclusive',
    status: 'active',
    stock: 10,
    redemptionCount: 0,
    eventInfo: 'Community Event 2024',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Property 13: Code 专属商品兑换不扣积分', () => {
  it('成功兑换后事务中不应包含用户积分扣减操作', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100000 }),
        async (productId, userId, codeValue, productName, stock, userPoints) => {
          const client = { send: vi.fn() } as any;

          client.send.mockResolvedValueOnce({
            Items: [makeCode({ codeValue, productId })],
          });
          client.send.mockResolvedValueOnce({
            Item: makeProduct({ productId, name: productName, stock }),
          });
          client.send.mockResolvedValueOnce({
            Item: { addressId: 'addr-001', userId, recipientName: 'Test', phone: '13800138000', detailAddress: '测试地址' },
          });
          client.send.mockResolvedValueOnce({});

          const result = await redeemWithCode(
            { productId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // Inspect the TransactWriteCommand
          const txCmd = client.send.mock.calls[3][0];
          const items = txCmd.input.TransactItems;

          // Transaction should have exactly 4 items: code update, product update, redemption record, order record
          // NO Users table update (no points deduction)
          // NO PointsRecords table entry
          expect(items).toHaveLength(4);

          const tableNames = items.map((item: any) =>
            item.Update?.TableName ?? item.Put?.TableName,
          );
          expect(tableNames).not.toContain('Users');
          expect(tableNames).not.toContain('PointsRecords');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('兑换记录中不应包含 pointsSpent 字段', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 1000 }),
        async (productId, userId, codeValue, productName, stock) => {
          const client = { send: vi.fn() } as any;

          client.send.mockResolvedValueOnce({
            Items: [makeCode({ codeValue, productId })],
          });
          client.send.mockResolvedValueOnce({
            Item: makeProduct({ productId, name: productName, stock }),
          });
          client.send.mockResolvedValueOnce({
            Item: { addressId: 'addr-001', userId, recipientName: 'Test', phone: '13800138000', detailAddress: '测试地址' },
          });
          client.send.mockResolvedValueOnce({});

          await redeemWithCode(
            { productId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[3][0];
          const items = txCmd.input.TransactItems;

          // Find the redemption Put item
          const redemptionPut = items.find((item: any) => item.Put?.TableName === 'Redemptions');
          expect(redemptionPut).toBeDefined();

          const record = redemptionPut.Put.Item;
          expect(record.method).toBe('code');
          expect(record.codeUsed).toBe(codeValue);
          expect(record.pointsSpent).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不同积分余额的用户通过 Code 兑换后积分均不受影响', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        codeValueArb,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 100000 }),
        async (productId, userId, codeValue, stock, userPoints) => {
          const client = { send: vi.fn() } as any;

          client.send.mockResolvedValueOnce({
            Items: [makeCode({ codeValue, productId })],
          });
          client.send.mockResolvedValueOnce({
            Item: makeProduct({ productId, stock }),
          });
          client.send.mockResolvedValueOnce({
            Item: { addressId: 'addr-001', userId, recipientName: 'Test', phone: '13800138000', detailAddress: '测试地址' },
          });
          client.send.mockResolvedValueOnce({});

          const result = await redeemWithCode(
            { productId, code: codeValue, userId, addressId: 'addr-001' },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // Verify no transaction item touches the Users table
          const txCmd = client.send.mock.calls[3][0];
          const items = txCmd.input.TransactItems;

          for (const item of items) {
            const tableName = item.Update?.TableName ?? item.Put?.TableName;
            if (tableName === 'Users') {
              // If somehow a Users update exists, it must NOT modify points
              const expr = item.Update?.UpdateExpression ?? '';
              expect(expr).not.toContain('points');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
