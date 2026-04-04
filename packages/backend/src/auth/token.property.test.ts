import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { generateToken, TokenPayload } from './token';

// Feature: points-mall, Property 3: Token 有效期
// 对于任何成功登录的用户，生成的 JWT Token 的过期时间应恰好为签发时间后 7 天（604800 秒）。
// Validates: Requirements 1.9

const TEST_SECRET = 'test-jwt-secret-key-for-property-testing';

const SEVEN_DAYS_IN_SECONDS = 604800;

const validRoles = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const;

const roleArb = fc.subarray([...validRoles], { minLength: 0, maxLength: 4 });

const tokenPayloadArb: fc.Arbitrary<TokenPayload> = fc.record({
  userId: fc.uuid(),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  roles: roleArb,
});

describe('Property 3: Token 有效期', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('生成的 Token 过期时间应恰好为签发时间后 604800 秒（7 天）', async () => {
    await fc.assert(
      fc.asyncProperty(tokenPayloadArb, async (payload) => {
        const token = await generateToken(payload);
        const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

        expect(decoded.exp).toBeDefined();
        expect(decoded.iat).toBeDefined();
        expect(decoded.exp! - decoded.iat!).toBe(SEVEN_DAYS_IN_SECONDS);
      }),
      { numRuns: 100 }
    );
  });

  it('Token 中的用户信息应与输入 payload 一致', async () => {
    await fc.assert(
      fc.asyncProperty(tokenPayloadArb, async (payload) => {
        const token = await generateToken(payload);
        const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

        expect(decoded.userId).toBe(payload.userId);
        expect(decoded.roles).toEqual(payload.roles);
        if (payload.email !== undefined) {
          expect(decoded.email).toBe(payload.email);
        }
      }),
      { numRuns: 100 }
    );
  });
});
