import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerUser, RegisterRequest } from './register';
import { REGULAR_ROLES, UserRole } from '@points-mall/shared';
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

const inviteRolesArb = fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 });

const VALID_INVITE_TOKEN = 'a'.repeat(64);
const TABLE = 'Users';
const INVITES_TABLE = 'Invites';

// ============================================================
// Feature: employee-badge, Property 2: 注册流程传递 isEmployee 标记
// For any valid registration request and corresponding invite record,
// the user record created during registration should have isEmployee
// matching the invite record's isEmployee. When the invite record
// doesn't have isEmployee (old data), the user record should NOT
// have isEmployee: true.
// Validates: Requirements 5.1, 5.2, 5.3, 5.4
// ============================================================

describe('Feature: employee-badge, Property 2: 注册流程传递 isEmployee 标记', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeInviteToken).mockResolvedValue({ success: true });
  });

  /**
   * Helper: create a mock DynamoDB client that captures the PutCommand item.
   * QueryCommand returns empty (no existing user with that email).
   */
  function createCapturingMockClient() {
    let capturedUser: any = null;
    const client = {
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
    return { client, getCapturedUser: () => capturedUser };
  }

  it('当邀请记录 isEmployee 为 true 时，用户记录应包含 isEmployee: true', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        inviteRolesArb,
        async (email, password, nickname, roles) => {
          vi.mocked(validateInviteToken).mockResolvedValue({
            success: true,
            roles,
            isEmployee: true,
          });

          const { client, getCapturedUser } = createCapturingMockClient();
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, client, TABLE, INVITES_TABLE);

          expect(result.success).toBe(true);

          const user = getCapturedUser();
          expect(user).not.toBeNull();
          expect(user.isEmployee).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('当邀请记录 isEmployee 为 false 时，用户记录不应包含 isEmployee: true', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        inviteRolesArb,
        async (email, password, nickname, roles) => {
          vi.mocked(validateInviteToken).mockResolvedValue({
            success: true,
            roles,
            isEmployee: false,
          });

          const { client, getCapturedUser } = createCapturingMockClient();
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, client, TABLE, INVITES_TABLE);

          expect(result.success).toBe(true);

          const user = getCapturedUser();
          expect(user).not.toBeNull();
          // isEmployee should either be absent or not true
          expect(user.isEmployee).not.toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('当邀请记录不含 isEmployee 字段（旧数据兼容）时，用户记录不应包含 isEmployee: true', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        inviteRolesArb,
        async (email, password, nickname, roles) => {
          // Simulate old invite data: validateInviteToken returns isEmployee as false
          // (the real validateInviteToken defaults missing isEmployee to false via ?? false)
          vi.mocked(validateInviteToken).mockResolvedValue({
            success: true,
            roles,
            isEmployee: false,
          });

          const { client, getCapturedUser } = createCapturingMockClient();
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, client, TABLE, INVITES_TABLE);

          expect(result.success).toBe(true);

          const user = getCapturedUser();
          expect(user).not.toBeNull();
          expect(user.isEmployee).not.toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isEmployee 值与邀请记录一致（布尔值往返）', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        validPasswordArb,
        nicknameArb,
        inviteRolesArb,
        fc.boolean(),
        async (email, password, nickname, roles, isEmployee) => {
          vi.mocked(validateInviteToken).mockResolvedValue({
            success: true,
            roles,
            isEmployee,
          });

          const { client, getCapturedUser } = createCapturingMockClient();
          const request: RegisterRequest = { email, password, nickname, inviteToken: VALID_INVITE_TOKEN };
          const result = await registerUser(request, client, TABLE, INVITES_TABLE);

          expect(result.success).toBe(true);

          const user = getCapturedUser();
          expect(user).not.toBeNull();

          if (isEmployee === true) {
            // When invite has isEmployee: true, user record must have isEmployee: true
            expect(user.isEmployee).toBe(true);
          } else {
            // When invite has isEmployee: false, user record must NOT have isEmployee: true
            expect(user.isEmployee).not.toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
