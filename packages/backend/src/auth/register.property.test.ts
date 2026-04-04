import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { registerUser, RegisterRequest } from './register';
import { ErrorCodes } from '@points-mall/shared';

// Feature: points-mall, Property 2: 邮箱唯一性约束
// 对于任何已注册的邮箱地址，使用相同邮箱再次注册应被拒绝并返回"邮箱已存在"的错误，且不创建新账号。
// Validates: Requirements 1.6

/** Arbitrary for valid email-like strings */
const emailArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 20, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
    fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) }),
    fc.constantFrom('com', 'org', 'net', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Arbitrary for a valid password (≥8 chars, has letter + digit) */
const validPasswordArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) }),
    fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(...'0123456789'.split('')) }),
  )
  .map(([letters, digits]) => letters + digits)
  .filter((pw) => pw.length >= 8);

const nicknameArb = fc.string({ minLength: 1, maxLength: 20, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) });

const VALID_INVITE_TOKEN = 'a'.repeat(64);

function createMockDynamoClient(queryItems: any[] = []) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      // Return a valid pending invite record for invite token validation
      return Promise.resolve({
        Item: {
          token: VALID_INVITE_TOKEN,
          role: 'Speaker',
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
        },
      });
    }
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: queryItems });
    }
    if (name === 'PutCommand') {
      return Promise.resolve({});
    }
    if (name === 'UpdateCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

function createMockSesClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

const TABLE = 'Users';
const INVITES_TABLE = 'Invites';
const SENDER = 'noreply@example.com';
const VERIFY_URL = 'https://example.com/verify';

describe('Property 2: 邮箱唯一性约束', () => {
  it('已注册邮箱再次注册应被拒绝并返回 EMAIL_ALREADY_EXISTS', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        async (email, password, nickname) => {
          // Simulate the email already existing in the database
          const dynamoClient = createMockDynamoClient([{ userId: 'existing-user', email }]);
          const sesClient = createMockSesClient();

          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, dynamoClient, sesClient, TABLE, SENDER, VERIFY_URL, INVITES_TABLE);

          // Registration must fail with the correct error code
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.EMAIL_ALREADY_EXISTS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('已注册邮箱再次注册不应创建新账号（不调用 PutCommand）', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        async (email, password, nickname) => {
          const dynamoClient = createMockDynamoClient([{ userId: 'existing-user', email }]);
          const sesClient = createMockSesClient();

          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          await registerUser(request, dynamoClient, sesClient, TABLE, SENDER, VERIFY_URL, INVITES_TABLE);

          // No PutCommand should have been sent (no new user created)
          const putCalls = dynamoClient.send.mock.calls.filter(
            (c: any) => c[0].constructor.name === 'PutCommand',
          );
          expect(putCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('已注册邮箱再次注册不应发送验证邮件', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        async (email, password, nickname) => {
          const dynamoClient = createMockDynamoClient([{ userId: 'existing-user', email }]);
          const sesClient = createMockSesClient();

          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          await registerUser(request, dynamoClient, sesClient, TABLE, SENDER, VERIFY_URL, INVITES_TABLE);

          // SES should never be called for duplicate emails
          expect(sesClient.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
