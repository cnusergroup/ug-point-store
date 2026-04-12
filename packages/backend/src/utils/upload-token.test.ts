import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateUploadToken,
  verifyUploadToken,
  base64urlEncode,
  base64urlDecode,
} from './upload-token';

const TEST_SECRET = 'test-upload-token-secret';

describe('upload-token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('base64url helpers', () => {
    it('should round-trip encode and decode a string', () => {
      const original = '{"k":"products/abc/123.jpg","e":1709123456}';
      const encoded = base64urlEncode(original);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
      expect(base64urlDecode(encoded)).toBe(original);
    });
  });

  describe('generateUploadToken + verifyUploadToken round-trip', () => {
    it('should generate a token that verifies successfully and returns the correct key', () => {
      const key = 'products/abc/123.jpg';
      const { token } = generateUploadToken({ key }, TEST_SECRET);

      const result = verifyUploadToken(token, TEST_SECRET);

      expect(result.valid).toBe(true);
      expect(result.key).toBe(key);
      expect(result.error).toBeUndefined();
    });

    it('should work with content and claims paths', () => {
      const contentKey = 'content/user1/file1/doc.pdf';
      const claimsKey = 'claims/user2/img1.png';

      const contentResult = verifyUploadToken(
        generateUploadToken({ key: contentKey }, TEST_SECRET).token,
        TEST_SECRET,
      );
      const claimsResult = verifyUploadToken(
        generateUploadToken({ key: claimsKey }, TEST_SECRET).token,
        TEST_SECRET,
      );

      expect(contentResult.valid).toBe(true);
      expect(contentResult.key).toBe(contentKey);
      expect(claimsResult.valid).toBe(true);
      expect(claimsResult.key).toBe(claimsKey);
    });
  });

  describe('tampered signature fails verification', () => {
    it('should fail when the signature portion is modified', () => {
      const { token } = generateUploadToken({ key: 'products/abc/123.jpg' }, TEST_SECRET);
      const [payload, signature] = token.split('.');
      // Flip a character in the signature
      const tampered = payload + '.' + signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a');

      const result = verifyUploadToken(tampered, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should fail when the payload portion is modified', () => {
      const { token } = generateUploadToken({ key: 'products/abc/123.jpg' }, TEST_SECRET);
      const [, signature] = token.split('.');
      // Create a different payload
      const tamperedPayload = base64urlEncode(JSON.stringify({ k: 'products/evil/hack.jpg', e: Math.floor(Date.now() / 1000) + 300 }));

      const result = verifyUploadToken(tamperedPayload + '.' + signature, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });
  });

  describe('expired token fails verification', () => {
    it('should fail when the token has expired', () => {
      // Generate a token that expires immediately (negative expiresIn via time mock)
      const key = 'products/abc/123.jpg';
      const { token } = generateUploadToken({ key, expiresIn: 1 }, TEST_SECRET);

      // Advance time by 2 seconds so the token is expired
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);

      const result = verifyUploadToken(token, TEST_SECRET);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });
  });

  describe('empty / malformed token fails verification', () => {
    it('should fail for an empty string', () => {
      const result = verifyUploadToken('', TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should fail for a token without a dot separator', () => {
      const result = verifyUploadToken('nodothere', TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should fail for a token with too many parts', () => {
      const result = verifyUploadToken('a.b.c', TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should fail for a token with invalid base64 payload', () => {
      const result = verifyUploadToken('!!!invalid!!!.signature', TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should fail for a token with non-JSON payload', () => {
      const encoded = base64urlEncode('not-json');
      const result = verifyUploadToken(encoded + '.fakesig', TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });
  });

  describe('different secret fails verification', () => {
    it('should fail when verified with a different secret', () => {
      const { token } = generateUploadToken({ key: 'products/abc/123.jpg' }, TEST_SECRET);

      const result = verifyUploadToken(token, 'different-secret');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });
  });
});
