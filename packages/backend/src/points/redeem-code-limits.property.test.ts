import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemCode, RedeemCodeTableNames } from './redeem-code';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 7: Code 使用限制
// 对于任何兑换码，如果该 Code 已被当前用户使用过，或已达到最大使用次数上限，
// 则兑换请求应被拒绝，且用户积分不变。
// Validates: Requirements 4.4, 4.5

const tables: RedeemCodeTableNames = {
  codesTable: 'Codes',
  usersTable: 'Users',
  pointsRecordsTable: 'PointsRecords',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const codeValueArb = fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) });

const userArb = fc.record({
  userId: fc.uuid(),
  currentPoints: fc.nat({ max: 100000 }),
});

describe('Property 7: Code 使用限制', () => {
  it('已被当前用户使用过的 Code 应被拒绝并返回 CODE_ALREADY_USED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          codeId: fc.uuid(),
          codeValue: codeValueArb,
          pointsValue: fc.integer({ min: 1, max: 10000 }),
          maxUses: fc.integer({ min: 2, max: 100 }),
        }),
        userArb,
        async (code, user) => {
          const client = { send: vi.fn() } as any;

          // Code is active but user already used it
          client.send.mockResolvedValueOnce({
            Items: [{
              ...code,
              type: 'points',
              status: 'active',
              currentUses: 1,
              usedBy: { [user.userId]: '2024-01-01T00:00:00.000Z' },
            }],
          });

          const result = await redeemCode(
            { code: code.codeValue, userId: user.userId },
            client,
            tables,
          );

          // Redemption should be rejected
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.CODE_ALREADY_USED);

          // No transaction should have been issued (only the query call)
          expect(client.send).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('已达最大使用次数上限的 Code 应被拒绝并返回 CODE_EXHAUSTED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          codeId: fc.uuid(),
          codeValue: codeValueArb,
          pointsValue: fc.integer({ min: 1, max: 10000 }),
          maxUses: fc.integer({ min: 1, max: 50 }),
        }),
        userArb,
        async (code, user) => {
          const client = { send: vi.fn() } as any;

          // Code is active but currentUses >= maxUses
          client.send.mockResolvedValueOnce({
            Items: [{
              ...code,
              type: 'points',
              status: 'active',
              currentUses: code.maxUses,
              usedBy: {},
            }],
          });

          const result = await redeemCode(
            { code: code.codeValue, userId: user.userId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.CODE_EXHAUSTED);

          // No transaction should have been issued
          expect(client.send).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('超过最大使用次数的 Code 也应被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          codeId: fc.uuid(),
          codeValue: codeValueArb,
          pointsValue: fc.integer({ min: 1, max: 10000 }),
          maxUses: fc.integer({ min: 1, max: 50 }),
          extraUses: fc.integer({ min: 1, max: 50 }),
        }),
        userArb,
        async (code, user) => {
          const client = { send: vi.fn() } as any;

          // currentUses exceeds maxUses
          client.send.mockResolvedValueOnce({
            Items: [{
              codeId: code.codeId,
              codeValue: code.codeValue,
              pointsValue: code.pointsValue,
              maxUses: code.maxUses,
              type: 'points',
              status: 'active',
              currentUses: code.maxUses + code.extraUses,
              usedBy: {},
            }],
          });

          const result = await redeemCode(
            { code: code.codeValue, userId: user.userId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.CODE_EXHAUSTED);
          expect(client.send).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('被拒绝时不应发起事务写入（用户积分不变）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          codeId: fc.uuid(),
          codeValue: codeValueArb,
          pointsValue: fc.integer({ min: 1, max: 10000 }),
          maxUses: fc.integer({ min: 1, max: 50 }),
        }),
        userArb,
        fc.boolean(),
        async (code, user, alreadyUsed) => {
          const client = { send: vi.fn() } as any;

          if (alreadyUsed) {
            // User already used this code
            client.send.mockResolvedValueOnce({
              Items: [{
                ...code,
                type: 'points',
                status: 'active',
                currentUses: 1,
                usedBy: { [user.userId]: '2024-06-01T00:00:00.000Z' },
              }],
            });
          } else {
            // Code exhausted
            client.send.mockResolvedValueOnce({
              Items: [{
                ...code,
                type: 'points',
                status: 'active',
                currentUses: code.maxUses,
                usedBy: {},
              }],
            });
          }

          const result = await redeemCode(
            { code: code.codeValue, userId: user.userId },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          // Only the initial query call should have been made — no GetCommand, no TransactWrite
          expect(client.send).toHaveBeenCalledTimes(1);
          // No earnedPoints on failure
          expect(result.earnedPoints).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
