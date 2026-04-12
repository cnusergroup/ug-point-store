import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateUploadToken, verifyUploadToken } from './upload-token';

// Feature: cloudfront-upload-proxy, Property 5: 令牌往返一致性
// 对于任意 S3 Key，生成的上传鉴权令牌经解析后应满足：
// - 令牌中编码的 Key 与输入的 S3 Key 完全一致
// - 令牌的过期时间为生成时刻 + 300 秒（±1 秒容差）
// - 令牌的 HMAC 签名可通过相同密钥验证
// Validates: Requirements 4.5, 4.6, 3.4

const TEST_SECRET = 'property-test-upload-token-secret';

// S3 key character set: lowercase letters, digits, and -_/.
const s3KeyChars = 'abcdefghijklmnopqrstuvwxyz0123456789-_/.';
const s3KeyCharArb = fc.mapToConstant(
  { num: s3KeyChars.length, build: (v) => s3KeyChars[v] },
);

const s3KeyArb = fc.string({ minLength: 1, maxLength: 200, unit: s3KeyCharArb });

describe('Feature: cloudfront-upload-proxy, Property 5: 令牌往返一致性', () => {
  it('generateUploadToken 生成的令牌经 verifyUploadToken 验证后 key 完全一致，且 exp 在 [now+299, now+301] 范围内', () => {
    fc.assert(
      fc.property(s3KeyArb, (key) => {
        const nowSeconds = Math.floor(Date.now() / 1000);

        const { token } = generateUploadToken({ key }, TEST_SECRET);
        const result = verifyUploadToken(token, TEST_SECRET);

        // Token should be valid (HMAC signature verified)
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();

        // Key should be exactly the same
        expect(result.key).toBe(key);

        // Verify exp is in [now+299, now+301] by decoding the payload directly
        const [encodedPayload] = token.split('.');
        const payloadStr = Buffer.from(
          encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf-8');
        const payload = JSON.parse(payloadStr) as { k: string; e: number };

        expect(payload.e).toBeGreaterThanOrEqual(nowSeconds + 299);
        expect(payload.e).toBeLessThanOrEqual(nowSeconds + 301);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: cloudfront-upload-proxy, Property 2: 无效令牌拒绝访问
// 对于任意 PUT 请求，若请求未携带鉴权令牌、令牌签名无效、或令牌已过期，
// 验证函数应返回 valid: false 并拒绝该请求。
// Validates: Requirements 3.1, 3.2, 3.3

describe('Feature: cloudfront-upload-proxy, Property 2: 无效令牌拒绝访问', () => {
  it('任意随机字符串作为令牌，verifyUploadToken 应返回 valid: false', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (randomToken) => {
        const result = verifyUploadToken(randomToken, TEST_SECRET);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('有效令牌修改 payload 中的 key 后，签名验证应失败', () => {
    fc.assert(
      fc.property(
        s3KeyArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (originalKey, suffix) => {
          // Generate a valid token
          const { token } = generateUploadToken({ key: originalKey }, TEST_SECRET);

          // Split token into payload and signature
          const [encodedPayload, encodedSignature] = token.split('.');

          // Decode payload, modify the key, re-encode
          const payloadStr = Buffer.from(
            encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
          ).toString('utf-8');
          const payload = JSON.parse(payloadStr) as { k: string; e: number };

          // Modify the key by appending a suffix
          payload.k = payload.k + suffix;
          const modifiedPayloadStr = JSON.stringify(payload);
          const modifiedEncodedPayload = Buffer.from(modifiedPayloadStr)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

          // Reconstruct token with modified payload but original signature
          const tamperedToken = `${modifiedEncodedPayload}.${encodedSignature}`;

          const result = verifyUploadToken(tamperedToken, TEST_SECRET);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('INVALID_TOKEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: cloudfront-upload-proxy, Property 3: 路径篡改防护
// 对于任意有效的上传鉴权令牌（授权 S3 Key 为 keyA）和任意不同的 S3 Key keyB（keyA ≠ keyB），
// 令牌中解码出的 key 应为 keyA 而非 keyB。
// Validates: Requirements 3.5

describe('Feature: cloudfront-upload-proxy, Property 3: 路径篡改防护', () => {
  it('用 keyA 生成的令牌，解码后 key 为 keyA 而非 keyB（keyA ≠ keyB）', () => {
    fc.assert(
      fc.property(
        s3KeyArb,
        s3KeyArb,
        (keyA, keyB) => {
          // Ensure keyA and keyB are different
          fc.pre(keyA !== keyB);

          const { token } = generateUploadToken({ key: keyA }, TEST_SECRET);
          const result = verifyUploadToken(token, TEST_SECRET);

          // Token should be valid
          expect(result.valid).toBe(true);

          // Decoded key must be keyA
          expect(result.key).toBe(keyA);

          // Decoded key must NOT be keyB
          expect(result.key).not.toBe(keyB);
        },
      ),
      { numRuns: 100 },
    );
  });
});
