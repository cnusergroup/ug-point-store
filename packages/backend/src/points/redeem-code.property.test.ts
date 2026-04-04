import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { redeemCode, RedeemCodeTableNames } from './redeem-code';

// Feature: points-mall, Property 6: 积分码兑换正确性
// 对于任何有效的积分兑换码和任何用户，兑换后用户积分余额应增加该 Code 对应的积分数量，
// 且系统应生成一条包含正确时间、Code 标识和积分数量的积分增加记录。
// Validates: Requirements 4.1, 4.2

const tables: RedeemCodeTableNames = {
  codesTable: 'Codes',
  usersTable: 'Users',
  pointsRecordsTable: 'PointsRecords',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/** Arbitrary for a valid points code item */
const validCodeArb = fc.record({
  codeId: fc.uuid(),
  codeValue: fc.string({ minLength: 4, maxLength: 20, unit: fc.constantFrom(...alphaNumChars) }),
  pointsValue: fc.integer({ min: 1, max: 10000 }),
  maxUses: fc.integer({ min: 1, max: 100 }),
});

/** Arbitrary for user state */
const userArb = fc.record({
  userId: fc.uuid(),
  currentPoints: fc.nat({ max: 100000 }),
});

function setupMocks(client: any, code: any, user: any) {
  // 1st call: QueryCommand - code lookup
  client.send.mockResolvedValueOnce({
    Items: [{
      ...code,
      type: 'points',
      status: 'active',
      currentUses: 0,
      usedBy: {},
    }],
  });
  // 2nd call: GetCommand - user lookup
  client.send.mockResolvedValueOnce({
    Item: { userId: user.userId, points: user.currentPoints },
  });
  // 3rd call: TransactWriteCommand
  client.send.mockResolvedValueOnce({});
}

describe('Property 6: 积分码兑换正确性', () => {
  it('兑换后返回的积分数应等于 Code 的积分值', async () => {
    await fc.assert(
      fc.asyncProperty(validCodeArb, userArb, async (code, user) => {
        const client = { send: vi.fn() } as any;
        setupMocks(client, code, user);

        const result = await redeemCode(
          { code: code.codeValue, userId: user.userId },
          client,
          tables,
        );

        expect(result.success).toBe(true);
        expect(result.earnedPoints).toBe(code.pointsValue);
      }),
      { numRuns: 100 },
    );
  });

  it('事务写入中用户积分增量应等于 Code 积分值', async () => {
    await fc.assert(
      fc.asyncProperty(validCodeArb, userArb, async (code, user) => {
        const client = { send: vi.fn() } as any;
        setupMocks(client, code, user);

        await redeemCode(
          { code: code.codeValue, userId: user.userId },
          client,
          tables,
        );

        const txCmd = client.send.mock.calls[2][0];
        const items = txCmd.input.TransactItems;

        // User update: points increment equals code's pointsValue
        const userUpdate = items[1].Update;
        expect(userUpdate.TableName).toBe('Users');
        expect(userUpdate.ExpressionAttributeValues[':pv']).toBe(code.pointsValue);
      }),
      { numRuns: 100 },
    );
  });

  it('生成的积分记录应包含正确的类型、积分数量、Code 标识和变动后余额', async () => {
    await fc.assert(
      fc.asyncProperty(validCodeArb, userArb, async (code, user) => {
        const client = { send: vi.fn() } as any;
        setupMocks(client, code, user);

        await redeemCode(
          { code: code.codeValue, userId: user.userId },
          client,
          tables,
        );

        const txCmd = client.send.mock.calls[2][0];
        const record = txCmd.input.TransactItems[2].Put.Item;

        expect(record.type).toBe('earn');
        expect(record.amount).toBe(code.pointsValue);
        expect(record.source).toBe(code.codeValue);
        expect(record.balanceAfter).toBe(user.currentPoints + code.pointsValue);
        expect(record.userId).toBe(user.userId);
        expect(record.createdAt).toBeDefined();
        expect(record.recordId).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('变动后余额应等于原始余额加上 Code 积分值（对任意初始余额）', async () => {
    await fc.assert(
      fc.asyncProperty(
        validCodeArb,
        fc.record({
          userId: fc.uuid(),
          currentPoints: fc.integer({ min: 0, max: 1000000 }),
        }),
        async (code, user) => {
          const client = { send: vi.fn() } as any;
          setupMocks(client, code, user);

          await redeemCode(
            { code: code.codeValue, userId: user.userId },
            client,
            tables,
          );

          const txCmd = client.send.mock.calls[2][0];
          const record = txCmd.input.TransactItems[2].Put.Item;

          // balanceAfter = currentPoints + pointsValue (additive property)
          expect(record.balanceAfter).toBe(user.currentPoints + code.pointsValue);
        },
      ),
      { numRuns: 100 },
    );
  });
});
