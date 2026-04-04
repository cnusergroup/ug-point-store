import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemCode, RedeemCodeTableNames } from '../points/redeem-code';
import { redeemWithCode, CodeRedemptionTableNames } from '../redemptions/code-redemption';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 16: 禁用 Code 后拒绝兑换
// 对于任何被禁用的 Code，任何用户对该 Code 的兑换请求（无论是积分码还是商品码）都应被拒绝。
// Validates: Requirements 9.4, 9.5

const pointsTables: RedeemCodeTableNames = {
  codesTable: 'Codes',
  usersTable: 'Users',
  pointsRecordsTable: 'PointsRecords',
};

const codeTables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/** Arbitrary for a disabled points code */
const disabledPointsCodeArb = fc.record({
  codeId: fc.uuid(),
  codeValue: fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) }),
  type: fc.constant('points' as const),
  pointsValue: fc.integer({ min: 1, max: 10000 }),
  maxUses: fc.integer({ min: 1, max: 100 }),
  currentUses: fc.nat({ max: 50 }),
});

/** Arbitrary for a disabled product code */
const disabledProductCodeArb = fc.record({
  codeId: fc.uuid(),
  codeValue: fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) }),
  type: fc.constant('product' as const),
  productId: fc.uuid(),
  maxUses: fc.constant(1),
  currentUses: fc.constant(0),
});

const userIdArb = fc.uuid();

describe('Property 16: 禁用 Code 后拒绝兑换', () => {
  it('禁用的积分码兑换请求应被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(disabledPointsCodeArb, userIdArb, async (code, userId) => {
        const client = { send: vi.fn() } as any;

        // QueryCommand returns the code with status='disabled'
        client.send.mockResolvedValueOnce({
          Items: [{ ...code, status: 'disabled', usedBy: {} }],
        });

        const result = await redeemCode(
          { code: code.codeValue, userId },
          client,
          pointsTables,
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
        // Should only have called QueryCommand, no transaction
        expect(client.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  it('禁用的商品专属码兑换请求应被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(disabledProductCodeArb, userIdArb, async (code, userId) => {
        const client = { send: vi.fn() } as any;

        // QueryCommand returns the code with status='disabled'
        client.send.mockResolvedValueOnce({
          Items: [{ ...code, status: 'disabled', usedBy: {} }],
        });

        const result = await redeemWithCode(
          { productId: code.productId!, code: code.codeValue, userId, addressId: 'addr-001' },
          client,
          codeTables,
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
        // Should only have called QueryCommand, no transaction
        expect(client.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  it('禁用的积分码不应触发事务写入（积分不变）', async () => {
    await fc.assert(
      fc.asyncProperty(disabledPointsCodeArb, userIdArb, async (code, userId) => {
        const client = { send: vi.fn() } as any;

        client.send.mockResolvedValueOnce({
          Items: [{ ...code, status: 'disabled', usedBy: {} }],
        });

        await redeemCode(
          { code: code.codeValue, userId },
          client,
          pointsTables,
        );

        // Verify no TransactWriteCommand was sent (only 1 call: the query)
        const calls = client.send.mock.calls;
        expect(calls.length).toBe(1);
        // The single call should be the QueryCommand, not a TransactWriteCommand
        expect(calls[0][0].input.TransactItems).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('禁用的商品专属码不应触发事务写入（库存不变）', async () => {
    await fc.assert(
      fc.asyncProperty(disabledProductCodeArb, userIdArb, async (code, userId) => {
        const client = { send: vi.fn() } as any;

        client.send.mockResolvedValueOnce({
          Items: [{ ...code, status: 'disabled', usedBy: {} }],
        });

        await redeemWithCode(
          { productId: code.productId!, code: code.codeValue, userId, addressId: 'addr-001' },
          client,
          codeTables,
        );

        // Verify no TransactWriteCommand was sent
        const calls = client.send.mock.calls;
        expect(calls.length).toBe(1);
        expect(calls[0][0].input.TransactItems).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
