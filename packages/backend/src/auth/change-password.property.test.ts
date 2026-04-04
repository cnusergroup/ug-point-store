import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { changePassword } from './change-password';
import { hash, compare } from 'bcryptjs';

// Feature: admin-roles-password, Property 5: 修改密码往返正确性
// 对于任何用户和任何符合规则的新密码，使用正确的当前密码调用修改密码接口后，
// 使用新密码应能通过 bcrypt 验证（即 bcrypt.compare(newPassword, updatedHash) 返回 true）。
// **Validates: Requirements 6.2**

/** Arbitrary for valid passwords: min 8 chars, contains at least one letter and one digit */
const validPasswordArb = fc
  .string({ minLength: 8, maxLength: 32 })
  .filter((s) => /[a-zA-Z]/.test(s) && /[0-9]/.test(s));

const TABLE = 'Users';

function createMockDynamoClient(passwordHash: string) {
  let storedHash: string | null = null;
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      return Promise.resolve({ Item: { passwordHash } });
    }
    if (name === 'UpdateCommand') {
      // Capture the new hash written to DynamoDB
      storedHash = command.input.ExpressionAttributeValues[':hash'];
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return {
    send: sendFn,
    getStoredHash: () => storedHash,
  };
}

describe('Property 5: 修改密码往返正确性', () => {
  it('修改密码后新密码可通过 bcrypt 验证', async () => {
    // bcrypt hashing is computationally expensive, so we need a longer timeout
    // Each iteration does 2 bcrypt hashes (current password + new password in changePassword) + 1 compare
    await fc.assert(
      fc.asyncProperty(validPasswordArb, validPasswordArb, async (currentPassword, newPassword) => {
        // 1. Hash the current password to simulate existing DB state
        const currentHash = await hash(currentPassword, 10);

        // 2. Create mock DynamoDB client that returns the hashed current password
        const client = createMockDynamoClient(currentHash);

        // 3. Call changePassword with correct current password and new password
        const result = await changePassword(
          'test-user-id',
          currentPassword,
          newPassword,
          client as any,
          TABLE,
        );

        // 4. Verify the result is successful
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        // 5. Verify the new hash stored in DynamoDB can be verified with bcrypt.compare
        const storedHash = client.getStoredHash();
        expect(storedHash).toBeTruthy();
        const match = await compare(newPassword, storedHash!);
        expect(match).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});

// Feature: admin-roles-password, Property 6: 错误的当前密码被拒绝
// 对于任何用户和任何与当前密码不同的字符串作为 currentPassword，
// 修改密码请求应被拒绝并返回 INVALID_CURRENT_PASSWORD 错误码，且用户的密码哈希不变。
// **Validates: Requirements 6.3**

describe('Property 6: 错误的当前密码被拒绝', () => {
  it('使用错误的当前密码时请求被拒绝且密码哈希不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPasswordArb,
        validPasswordArb,
        fc.string({ minLength: 1, maxLength: 32 }),
        async (actualPassword, newPassword, wrongPassword) => {
          // Filter: ensure wrong password differs from actual password
          fc.pre(wrongPassword !== actualPassword);

          // 1. Hash the actual current password
          const actualHash = await hash(actualPassword, 10);

          // 2. Create mock DynamoDB client that returns the hashed actual password
          const sendFn = vi.fn().mockImplementation((command: any) => {
            const name = command.constructor.name;
            if (name === 'GetCommand') {
              return Promise.resolve({ Item: { passwordHash: actualHash } });
            }
            if (name === 'UpdateCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });
          const client = { send: sendFn };

          // 3. Call changePassword with the WRONG password
          const result = await changePassword(
            'test-user-id',
            wrongPassword,
            newPassword,
            client as any,
            TABLE,
          );

          // 4. Verify the result is failure with INVALID_CURRENT_PASSWORD
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('INVALID_CURRENT_PASSWORD');

          // 5. Verify no UpdateCommand was sent (password hash unchanged)
          const updateCalls = sendFn.mock.calls.filter(
            ([cmd]: any) => cmd.constructor.name === 'UpdateCommand',
          );
          expect(updateCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
