import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { resetPassword } from './reset-password';
import { compare } from 'bcryptjs';

// Feature: admin-roles-password, Property 9: 重置密码往返正确性
// 对于任何拥有有效 resetToken 的用户和任何符合规则的新密码，
// 使用该令牌执行密码重置后，使用新密码应能通过 bcrypt 验证。
// **Validates: Requirements 8.2**

/** Arbitrary for valid passwords: min 8 chars, contains at least one letter and one digit */
const validPasswordArb = fc
  .string({ minLength: 8, maxLength: 32 })
  .filter((s) => /[a-zA-Z]/.test(s) && /[0-9]/.test(s));

const TABLE = 'Users';

function createMockDynamoClient(resetToken: string) {
  let capturedHash: string | null = null;
  const futureExpiry = Date.now() + 3600000; // 1 hour from now

  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'ScanCommand') {
      return Promise.resolve({
        Items: [
          {
            userId: 'user-1',
            passwordHash: '$2a$10$placeholder',
            resetToken,
            resetTokenExpiry: futureExpiry,
          },
        ],
      });
    }
    if (name === 'UpdateCommand') {
      capturedHash = command.input.ExpressionAttributeValues[':hash'];
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });

  return {
    send: sendFn,
    getCapturedHash: () => capturedHash,
  };
}

describe('Property 9: 重置密码往返正确性', () => {
  it('重置密码后新密码可通过 bcrypt 验证', async () => {
    await fc.assert(
      fc.asyncProperty(validPasswordArb, async (newPassword) => {
        const token = 'VALID_RESET_TOKEN';

        // 1. Create mock DynamoDB client that returns a user with valid resetToken and future expiry
        const client = createMockDynamoClient(token);

        // 2. Call resetPassword with the token and new password
        const result = await resetPassword(token, newPassword, client as any, TABLE);

        // 3. Verify the result is successful
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        // 4. Capture the new passwordHash from the UpdateCommand
        const capturedHash = client.getCapturedHash();
        expect(capturedHash).toBeTruthy();

        // 5. Verify bcrypt.compare(newPassword, capturedHash) returns true
        const match = await compare(newPassword, capturedHash!);
        expect(match).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});

// Feature: admin-roles-password, Property 10: 重置令牌一次性使用
// 对于任何有效的 resetToken，成功执行密码重置后，
// 再次使用同一 resetToken 应被拒绝并返回 RESET_TOKEN_INVALID 错误码。
// **Validates: Requirements 8.3**

function createOneTimeUseMockDynamoClient(resetToken: string) {
  let tokenConsumed = false;
  let capturedHash: string | null = null;
  const futureExpiry = Date.now() + 3600000;

  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'ScanCommand') {
      // After a successful reset (UpdateCommand removes resetToken),
      // subsequent scans should return empty — token no longer exists
      if (tokenConsumed) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({
        Items: [
          {
            userId: 'user-1',
            passwordHash: '$2a$10$placeholder',
            resetToken,
            resetTokenExpiry: futureExpiry,
          },
        ],
      });
    }
    if (name === 'UpdateCommand') {
      // The reset was successful — mark token as consumed
      tokenConsumed = true;
      capturedHash = command.input.ExpressionAttributeValues[':hash'];
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });

  return {
    send: sendFn,
    getCapturedHash: () => capturedHash,
  };
}

describe('Property 10: 重置令牌一次性使用', () => {
  it('成功重置后再次使用同一令牌被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(validPasswordArb, async (newPassword) => {
        const token = 'ONE_TIME_RESET_TOKEN';

        const client = createOneTimeUseMockDynamoClient(token);

        // 1. First reset should succeed
        const firstResult = await resetPassword(token, newPassword, client as any, TABLE);
        expect(firstResult.success).toBe(true);
        expect(firstResult.error).toBeUndefined();

        // 2. Second reset with the same token should fail with RESET_TOKEN_INVALID
        const secondResult = await resetPassword(token, newPassword, client as any, TABLE);
        expect(secondResult.success).toBe(false);
        expect(secondResult.error).toBeDefined();
        expect(secondResult.error!.code).toBe('RESET_TOKEN_INVALID');
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});


// Feature: admin-roles-password, Property 11: 密码重置清除锁定状态
// 对于任何处于锁定状态（loginFailCount ≥ 5 且 lockUntil > 当前时间）的用户，
// 成功执行密码重置后，该用户的 loginFailCount 应为 0 且 lockUntil 应被清除。
// **Validates: Requirements 8.7**

describe('Property 11: 密码重置清除锁定状态', () => {
  it('重置密码后 loginFailCount 为 0 且 lockUntil 被清除', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPasswordArb,
        fc.integer({ min: 5, max: 100 }),
        fc.integer({ min: Date.now() + 60_000, max: Date.now() + 7_200_000 }),
        async (newPassword, failCount, lockUntilTs) => {
          const token = 'LOCKED_USER_RESET_TOKEN';
          const futureExpiry = Date.now() + 3_600_000;

          let capturedCommand: any = null;

          const sendFn = vi.fn().mockImplementation((command: any) => {
            const name = command.constructor.name;
            if (name === 'ScanCommand') {
              return Promise.resolve({
                Items: [
                  {
                    userId: 'locked-user-1',
                    passwordHash: '$2a$10$placeholder',
                    resetToken: token,
                    resetTokenExpiry: futureExpiry,
                    loginFailCount: failCount,
                    lockUntil: lockUntilTs,
                  },
                ],
              });
            }
            if (name === 'UpdateCommand') {
              capturedCommand = command;
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          const client = { send: sendFn };

          const result = await resetPassword(token, newPassword, client as any, TABLE);

          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();

          // Verify the UpdateCommand was sent
          expect(capturedCommand).toBeTruthy();

          const input = capturedCommand.input;
          const expression: string = input.UpdateExpression;
          const values = input.ExpressionAttributeValues;

          // loginFailCount is set to 0
          expect(values[':zero']).toBe(0);

          // The REMOVE clause includes lockUntil
          expect(expression).toMatch(/REMOVE\s+.*lockUntil/);

          // The REMOVE clause includes resetToken and resetTokenExpiry
          expect(expression).toMatch(/REMOVE\s+.*resetToken/);
          expect(expression).toMatch(/REMOVE\s+.*resetTokenExpiry/);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
