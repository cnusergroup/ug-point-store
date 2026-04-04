import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateToken, verifyToken, TokenPayload } from './token';

const TEST_SECRET = 'test-jwt-secret-key-for-testing';

describe('token', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    // Clear the cached secret so each test picks up the env var
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('generateToken', () => {
    it('should generate a valid JWT string', async () => {
      const payload: TokenPayload = { userId: 'user-1', email: 'test@example.com', roles: ['Speaker'] };
      const token = await generateToken(payload);

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include userId, email, and roles in the token payload', async () => {
      const payload: TokenPayload = { userId: 'user-1', email: 'test@example.com', roles: ['Speaker', 'Volunteer'] };
      const token = await generateToken(payload);
      const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

      expect(decoded.userId).toBe('user-1');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.roles).toEqual(['Speaker', 'Volunteer']);
    });

    it('should set expiry to 7 days (604800 seconds)', async () => {
      const payload: TokenPayload = { userId: 'user-1', roles: [] };
      const token = await generateToken(payload);
      const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

      expect(decoded.exp! - decoded.iat!).toBe(604800);
    });

    it('should work without email', async () => {
      const payload: TokenPayload = { userId: 'user-1', roles: ['Volunteer'] };
      const token = await generateToken(payload);
      const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

      expect(decoded.userId).toBe('user-1');
      expect(decoded.email).toBeUndefined();
      expect(decoded.roles).toEqual(['Volunteer']);
    });
  });

  describe('verifyToken', () => {
    it('should return valid=true for a valid token', async () => {
      const token = await generateToken({ userId: 'user-1', email: 'a@b.com', roles: ['Speaker'] });
      const result = await verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload?.userId).toBe('user-1');
      expect(result.error).toBeUndefined();
    });

    it('should return TOKEN_EXPIRED for an expired token', async () => {
      const token = jwt.sign({ userId: 'user-1', roles: [] }, TEST_SECRET, { expiresIn: -1 });
      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });

    it('should return INVALID_TOKEN for a token signed with wrong secret', async () => {
      const token = jwt.sign({ userId: 'user-1', roles: [] }, 'wrong-secret', { expiresIn: '7d' });
      const result = await verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });

    it('should return INVALID_TOKEN for a malformed token', async () => {
      const result = await verifyToken('not-a-valid-jwt');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
    });
  });
});
