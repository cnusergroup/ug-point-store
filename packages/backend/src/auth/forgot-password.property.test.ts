import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { forgotPassword } from './forgot-password';

// Feature: admin-roles-password, Property 7: 忘记密码防枚举响应
// 对于任何邮箱地址（无论是否已注册），忘记密码接口应返回相同的 HTTP 状态码（200）
// 和相同结构的成功响应，不泄露邮箱是否存在的信息。
// **Validates: Requirements 7.5**

const TABLE = 'Users';
const SENDER = 'noreply@example.com';
const RESET_URL = 'https://example.com/reset-password';

/** Arbitrary for random email addresses */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,20}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.constantFrom('com', 'org', 'net', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
  .filter((e) => e.length > 5);

function createMockDynamoClient(userExists: boolean, email: string) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;
      if (name === 'QueryCommand') {
        if (userExists) {
          return Promise.resolve({ Items: [{ userId: 'user-123', email }] });
        }
        return Promise.resolve({ Items: [] });
      }
      if (name === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

function createMockSesClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

describe('Property 7: 忘记密码防枚举响应', () => {
  it('已注册和未注册邮箱返回相同状态码和响应结构', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, async (email) => {
        // Call forgotPassword with a mock that returns a user (registered)
        const registeredClient = createMockDynamoClient(true, email);
        const registeredSes = createMockSesClient();
        const registeredResult = await forgotPassword(
          email, registeredClient, registeredSes, TABLE, SENDER, RESET_URL,
        );

        // Call forgotPassword with a mock that returns no user (unregistered)
        const unregisteredClient = createMockDynamoClient(false, email);
        const unregisteredSes = createMockSesClient();
        const unregisteredResult = await forgotPassword(
          email, unregisteredClient, unregisteredSes, TABLE, SENDER, RESET_URL,
        );

        // Both should return { success: true } with no error
        expect(registeredResult.success).toBe(true);
        expect(registeredResult.error).toBeUndefined();

        expect(unregisteredResult.success).toBe(true);
        expect(unregisteredResult.error).toBeUndefined();

        // Response structure should be identical
        expect(Object.keys(registeredResult).sort()).toEqual(
          Object.keys(unregisteredResult).sort(),
        );
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: admin-roles-password, Property 8: 重复请求重置使旧令牌失效
// 对于任何已注册用户，连续两次请求密码重置后，仅最新生成的 resetToken 有效，
// 第二次调用的 UpdateCommand 会覆盖第一次写入的 resetToken。
// **Validates: Requirements 7.6**

describe('Property 8: 重复请求重置使旧令牌失效', () => {
  it('连续两次请求重置产生不同令牌，第二次覆盖第一次', async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, async (email) => {
        // Capture resetToken from each UpdateCommand call
        const capturedTokens: string[] = [];

        const mockDynamoClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const name = command.constructor.name;
            if (name === 'QueryCommand') {
              return Promise.resolve({
                Items: [{ userId: 'user-' + email, email }],
              });
            }
            if (name === 'UpdateCommand') {
              // Extract the resetToken from the UpdateCommand's ExpressionAttributeValues
              const token = command.input?.ExpressionAttributeValues?.[':token'];
              if (token) {
                capturedTokens.push(token);
              }
              return Promise.resolve({});
            }
            return Promise.resolve({});
          }),
        } as any;

        const mockSes = createMockSesClient();

        // First call
        const result1 = await forgotPassword(
          email, mockDynamoClient, mockSes, TABLE, SENDER, RESET_URL,
        );

        // Second call (same email, same client — simulates consecutive requests)
        const result2 = await forgotPassword(
          email, mockDynamoClient, mockSes, TABLE, SENDER, RESET_URL,
        );

        // Both calls should succeed
        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);

        // Two UpdateCommand calls should have been made, each with a different token
        expect(capturedTokens).toHaveLength(2);
        const [firstToken, secondToken] = capturedTokens;

        // Tokens must be different (ULID generates unique values)
        expect(firstToken).not.toBe(secondToken);

        // Both tokens should be non-empty strings
        expect(firstToken.length).toBeGreaterThan(0);
        expect(secondToken.length).toBeGreaterThan(0);

        // Verify the UpdateCommand uses SET expression that replaces resetToken
        // (the second call overwrites the first token in the DB)
        const updateCalls = mockDynamoClient.send.mock.calls.filter(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(updateCalls).toHaveLength(2);

        // Both UpdateCommands should use SET expression (overwrites, not ADD)
        for (const [cmd] of updateCalls) {
          const updateExpr: string = cmd.input.UpdateExpression;
          expect(updateExpr).toContain('SET');
          expect(updateExpr).toContain('resetToken');
        }
      }),
      { numRuns: 100 },
    );
  });
});
