import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerUser, RegisterRequest } from './register';
import { ErrorCodes, REGULAR_ROLES, UserRole } from '@points-mall/shared';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('./invite', () => ({
  validateInviteToken: vi.fn(),
  consumeInviteToken: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  hash: vi.fn().mockResolvedValue('$2a$10$mockedhash'),
}));

import { validateInviteToken, consumeInviteToken } from './invite';

// ============================================================
// Shared arbitraries
// ============================================================

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
const TABLE = 'Users';
const INVITES_TABLE = 'Invites';

// ============================================================
// Feature: points-mall, Property 2: 邮箱唯一性约束
// 对于任何已注册的邮箱地址，使用相同邮箱再次注册应被拒绝并返回"邮箱已存在"的错误，且不创建新账号。
// Validates: Requirements 1.6
// ============================================================

describe('Property 2: 邮箱唯一性约束', () => {
  beforeEach(() => {
    // For email uniqueness tests, invite validation always succeeds with a single role
    vi.mocked(validateInviteToken).mockResolvedValue({ success: true, roles: ['Speaker'] });
    vi.mocked(consumeInviteToken).mockResolvedValue({ success: true });
  });

  function createMockDynamoClient(queryItems: any[] = []) {
    return {
      send: vi.fn().mockImplementation((command: any) => {
        if (command instanceof QueryCommand) {
          return Promise.resolve({ Items: queryItems });
        }
        if (command instanceof PutCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }),
    } as any;
  }

  it('已注册邮箱再次注册应被拒绝并返回 EMAIL_ALREADY_EXISTS', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        async (email, password, nickname) => {
          const dynamoClient = createMockDynamoClient([{ userId: 'existing-user', email }]);
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, dynamoClient, TABLE, INVITES_TABLE);

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
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          await registerUser(request, dynamoClient, TABLE, INVITES_TABLE);

          const putCalls = dynamoClient.send.mock.calls.filter(
            (c: any) => c[0] instanceof PutCommand,
          );
          expect(putCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: invite-multi-role, Property 6: 注册角色完整分配（Registration assigns all invite roles）
// For any valid invite record, the user registered through that invite token
// should have their `roles` array contain all roles from the invite record's `roles` array.
// Validates: Requirements 4.1, 4.2, 4.3
// ============================================================

const inviteRolesArb = fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 });

describe('Feature: invite-multi-role, Property 6: 注册角色完整分配（Registration assigns all invite roles）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过邀请 Token 注册的用户 roles 应包含邀请记录中的所有角色', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        inviteRolesArb,
        async (email, password, nickname, inviteRoles) => {
          // Mock validateInviteToken to return the generated roles
          vi.mocked(validateInviteToken).mockResolvedValue({
            success: true,
            roles: inviteRoles,
          });

          // Mock consumeInviteToken to succeed
          vi.mocked(consumeInviteToken).mockResolvedValue({
            success: true,
          });

          // Track the PutCommand item written to DynamoDB
          let capturedUser: any = null;
          const mockDynamoClient = {
            send: vi.fn().mockImplementation((command: any) => {
              if (command instanceof QueryCommand) {
                return Promise.resolve({ Items: [] });
              }
              if (command instanceof PutCommand) {
                capturedUser = command.input.Item;
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, mockDynamoClient, TABLE, INVITES_TABLE);

          // Registration should succeed
          expect(result.success).toBe(true);

          // The user record written to DynamoDB should contain all invite roles
          expect(capturedUser).not.toBeNull();
          for (const role of inviteRoles) {
            expect(capturedUser.roles).toContain(role);
          }

          // The returned user object should also contain all invite roles
          expect(result.user).toBeDefined();
          for (const role of inviteRoles) {
            expect(result.user!.roles).toContain(role);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
