import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export interface TokenPayload {
  userId: string;
  email?: string;
  roles: string[];
  /** Timestamp (ms) when roles were last written into this token.
   *  Used to detect stale roles without a DB read on every request. */
  rolesVersion?: number;
}

export interface VerifyTokenResult {
  valid: boolean;
  payload?: jwt.JwtPayload & TokenPayload;
  error?: string;
}

const TOKEN_EXPIRY = '7d'; // 604800 seconds

// Cache the secret after first SSM fetch (Lambda cold start)
let cachedSecret: string | null = null;

async function fetchJwtSecretFromSsm(): Promise<string> {
  const paramName = process.env.JWT_SECRET_PARAM;
  if (!paramName) {
    throw new Error('JWT_SECRET_PARAM environment variable is not set');
  }
  const client = new SSMClient({});
  const result = await client.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  if (!result.Parameter?.Value) {
    throw new Error(`SSM parameter ${paramName} has no value`);
  }
  return result.Parameter.Value;
}

/**
 * Get JWT secret. Reads from SSM on first call, then caches.
 * Falls back to JWT_SECRET env var for local testing.
 */
async function getJwtSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  // Fallback: direct env var (for local dev / tests)
  if (process.env.JWT_SECRET) {
    cachedSecret = process.env.JWT_SECRET;
    return cachedSecret;
  }

  cachedSecret = await fetchJwtSecretFromSsm();
  return cachedSecret;
}

export async function generateToken(payload: TokenPayload): Promise<string> {
  const secret = await getJwtSecret();
  return jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
      roles: payload.roles,
      rolesVersion: payload.rolesVersion ?? Date.now(),
    },
    secret,
    { expiresIn: TOKEN_EXPIRY },
  );
}

export async function verifyToken(token: string): Promise<VerifyTokenResult> {
  try {
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & TokenPayload;
    return { valid: true, payload: decoded };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, error: 'TOKEN_EXPIRED' };
    }
    return { valid: false, error: 'INVALID_TOKEN' };
  }
}
