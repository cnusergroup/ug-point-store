import { createHmac } from 'crypto';

export interface GenerateUploadTokenInput {
  key: string;
  expiresIn?: number;
}

export interface UploadTokenResult {
  token: string;
}

export interface VerifyUploadTokenResult {
  valid: boolean;
  key?: string;
  error?: string;
}

/**
 * Encode a buffer or string to base64url format.
 * Replaces `+` with `-`, `/` with `_`, and removes `=` padding.
 */
export function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url-encoded string back to a UTF-8 string.
 * Restores `+`, `/`, and `=` padding before decoding.
 */
export function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Generate an HMAC-SHA256 upload token for a given S3 key.
 *
 * Token format: `base64url(JSON.stringify(payload)) + '.' + base64url(hmac_sha256(payloadStr, secret))`
 *
 * The payload contains:
 * - `k`: the authorized S3 key
 * - `e`: expiration timestamp (Unix seconds)
 */
export function generateUploadToken(
  input: GenerateUploadTokenInput,
  secret: string,
): UploadTokenResult {
  const expiresIn = input.expiresIn ?? 300;
  const payload = {
    k: input.key,
    e: Math.floor(Date.now() / 1000) + expiresIn,
  };

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(payloadStr);
  const signature = createHmac('sha256', secret).update(payloadStr).digest();
  const encodedSignature = base64urlEncode(signature);

  return { token: `${encodedPayload}.${encodedSignature}` };
}

/**
 * Verify an upload token's HMAC signature and expiration.
 *
 * Returns the decoded S3 key if valid, or an error description if invalid.
 */
export function verifyUploadToken(
  token: string,
  secret: string,
): VerifyUploadTokenResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const [encodedPayload, encodedSignature] = parts;

  // Decode payload
  let payloadStr: string;
  let payload: { k?: string; e?: number };
  try {
    payloadStr = base64urlDecode(encodedPayload);
    payload = JSON.parse(payloadStr);
  } catch {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  // Verify HMAC signature
  const expectedSignature = base64urlEncode(
    createHmac('sha256', secret).update(payloadStr).digest(),
  );
  if (encodedSignature !== expectedSignature) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  // Verify required fields
  if (typeof payload.k !== 'string' || typeof payload.e !== 'number') {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.e) {
    return { valid: false, error: 'TOKEN_EXPIRED' };
  }

  return { valid: true, key: payload.k };
}
