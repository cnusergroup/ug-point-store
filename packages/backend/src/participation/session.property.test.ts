import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { verifyQuerySession } from './session';

// Feature: employee-participation-query, Property 8: 会话校验正确性
// 对于任意当前凭证版本号与任意 token（正确签发/不同版本签发/篡改字符串/已过期/随机垃圾字符串），
// verifyQuerySession 接受当且仅当 token 格式正确、签名有效、未过期，且 credentialVersion 与当前版本一致。
// Validates: Requirements 4.1, 4.2, 4.3, 4.4

const TEST_SECRET = 'test-query-jwt-secret-for-property-testing';
const WRONG_SECRET = 'wrong-secret-produces-invalid-signature';

type TokenKind =
  | 'validCurrentVersion'
  | 'validDifferentVersion'
  | 'expiredCurrentVersion'
  | 'tamperedSignature'
  | 'wrongSecret'
  | 'randomGarbage';

/** 篡改一个合法 JWT 的签名段，使其签名校验必然失败 */
function tamperSignature(token: string): string {
  const parts = token.split('.');
  const signature = parts[2] ?? '';
  const flippedChar = signature[0] === 'a' ? 'b' : 'a';
  parts[2] = flippedChar + signature.slice(1) + 'x';
  return parts.join('.');
}

describe('Property 8: 会话校验正确性', () => {
  beforeEach(() => {
    vi.stubEnv('QUERY_JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifyQuerySession 接受当且仅当 token 格式正确、签名有效、未过期且版本号一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom<TokenKind>(
          'validCurrentVersion',
          'validDifferentVersion',
          'expiredCurrentVersion',
          'tamperedSignature',
          'wrongSecret',
          'randomGarbage',
        ),
        fc.string(),
        async (currentVersion, otherVersionRaw, kind, garbage) => {
          // 确保 "版本不同" 场景下的版本号确实与当前版本不同
          const otherVersion =
            otherVersionRaw === currentVersion ? otherVersionRaw + 1 : otherVersionRaw;

          let token: string;
          let expectedValid: boolean;

          switch (kind) {
            case 'validCurrentVersion': {
              token = jwt.sign({ credentialVersion: currentVersion }, TEST_SECRET, {
                expiresIn: '24h',
              });
              expectedValid = true;
              break;
            }
            case 'validDifferentVersion': {
              token = jwt.sign({ credentialVersion: otherVersion }, TEST_SECRET, {
                expiresIn: '24h',
              });
              expectedValid = false; // STALE_VERSION
              break;
            }
            case 'expiredCurrentVersion': {
              token = jwt.sign({ credentialVersion: currentVersion }, TEST_SECRET, {
                expiresIn: '-1s', // 签发时刻已早于过期时刻，恒为已过期
              });
              expectedValid = false; // EXPIRED
              break;
            }
            case 'tamperedSignature': {
              const validToken = jwt.sign({ credentialVersion: currentVersion }, TEST_SECRET, {
                expiresIn: '24h',
              });
              token = tamperSignature(validToken);
              expectedValid = false; // MALFORMED（签名不合法）
              break;
            }
            case 'wrongSecret': {
              token = jwt.sign({ credentialVersion: currentVersion }, WRONG_SECRET, {
                expiresIn: '24h',
              });
              expectedValid = false; // MALFORMED（签名不合法）
              break;
            }
            case 'randomGarbage': {
              token = garbage.length > 0 ? garbage : 'not-a-jwt-token';
              expectedValid = false; // MALFORMED（格式无法识别）
              break;
            }
          }

          const result = await verifyQuerySession(token, currentVersion);
          expect(result.valid).toBe(expectedValid);
          if (!expectedValid) {
            expect(result.error).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: employee-participation-query, Property 6: 密码修改导致会话版本递增
// 对于任意当前版本 V，模拟一次成功的密码修改（V' = V + 1）：
// 携带版本 V 的旧 token 在版本变为 V' 后应被拒绝（STALE_VERSION）；
// 携带版本 V' 的新签发 token 应被接受。
// Validates: Requirements 2.7

describe('Property 6: 密码修改导致会话版本递增', () => {
  beforeEach(() => {
    vi.stubEnv('QUERY_JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('旧版本 token 在密码修改后被拒绝，新版本 token 被接受', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER - 1 }),
        async (v) => {
          const oldToken = jwt.sign({ credentialVersion: v }, TEST_SECRET, { expiresIn: '24h' });

          // 模拟一次成功的密码修改：版本递增
          const newVersion = v + 1;
          const newToken = jwt.sign({ credentialVersion: newVersion }, TEST_SECRET, {
            expiresIn: '24h',
          });

          // 旧 token 携带旧版本 V，但当前版本已变为 V'，应被拒绝
          const oldResult = await verifyQuerySession(oldToken, newVersion);
          expect(oldResult.valid).toBe(false);
          expect(oldResult.error).toBe('STALE_VERSION');

          // 新签发的 token 携带版本 V'，与当前版本一致，应被接受
          const newResult = await verifyQuerySession(newToken, newVersion);
          expect(newResult.valid).toBe(true);
          expect(newResult.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
