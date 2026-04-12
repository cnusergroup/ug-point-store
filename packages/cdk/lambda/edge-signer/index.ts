import { createHmac, createHash } from 'crypto';
import type {
  CloudFrontRequestEvent,
  CloudFrontRequest,
  CloudFrontResultResponse,
} from 'aws-lambda';

// Build-time injected constants (replaced by esbuild define)
// BUCKET_NAME is extracted at runtime from CloudFront origin domain
declare const BUCKET_REGION: string;
declare const TOKEN_SECRET: string;

// ---------------------------------------------------------------------------
// Inlined upload-token helpers (avoid cross-package import for esbuild)
// ---------------------------------------------------------------------------

interface VerifyUploadTokenResult {
  valid: boolean;
  key?: string;
  error?: string;
}

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function verifyUploadToken(token: string, secret: string): VerifyUploadTokenResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const [encodedPayload, encodedSignature] = parts;

  let payloadStr: string;
  let payload: { k?: string; e?: number };
  try {
    payloadStr = base64urlDecode(encodedPayload);
    payload = JSON.parse(payloadStr);
  } catch {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const expectedSignature = base64urlEncode(
    createHmac('sha256', secret).update(payloadStr).digest(),
  );
  if (encodedSignature !== expectedSignature) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  if (typeof payload.k !== 'string' || typeof payload.e !== 'number') {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.e) {
    return { valid: false, error: 'TOKEN_EXPIRED' };
  }

  return { valid: true, key: payload.k };
}

// ---------------------------------------------------------------------------
// SigV4 signing helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

function errorResponse(
  status: string,
  errorCode: string,
  message: string,
): CloudFrontResultResponse {
  return {
    status,
    statusDescription: status === '403' ? 'Forbidden' : 'Internal Server Error',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
    },
    body: JSON.stringify({ error: errorCode, message }),
  };
}

// ---------------------------------------------------------------------------
// Parse querystring into key-value map
// ---------------------------------------------------------------------------

function parseQuerystring(qs: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!qs) return params;
  for (const pair of qs.split('&')) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      params[decodeURIComponent(pair)] = '';
    } else {
      params[decodeURIComponent(pair.substring(0, idx))] = decodeURIComponent(
        pair.substring(idx + 1),
      );
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Lambda@Edge origin-request handler
// ---------------------------------------------------------------------------

export async function handler(
  event: CloudFrontRequestEvent,
): Promise<CloudFrontRequest | CloudFrontResultResponse> {
  const request = event.Records[0].cf.request;

  try {
    // --- OPTIONS preflight: return CORS headers directly ---
    if (request.method === 'OPTIONS') {
      return {
        status: '204',
        statusDescription: 'No Content',
        headers: {
          'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: '*' }],
          'access-control-allow-methods': [{ key: 'Access-Control-Allow-Methods', value: 'GET, PUT, OPTIONS' }],
          'access-control-allow-headers': [{ key: 'Access-Control-Allow-Headers', value: 'Content-Type, Content-Length' }],
          'access-control-max-age': [{ key: 'Access-Control-Max-Age', value: '86400' }],
        },
      };
    }

    // --- PUT requests: verify upload token first ---
    if (request.method === 'PUT') {
      const params = parseQuerystring(request.querystring);
      const token = params['token'];

      if (!token) {
        return errorResponse('403', 'MISSING_TOKEN', 'Upload token is required');
      }

      const result = verifyUploadToken(token, TOKEN_SECRET);
      if (!result.valid) {
        if (result.error === 'TOKEN_EXPIRED') {
          return errorResponse('403', 'TOKEN_EXPIRED', 'Upload token has expired');
        }
        return errorResponse('403', 'INVALID_TOKEN', 'Upload token is invalid');
      }

      // URI from CloudFront is URL-encoded; token key is raw UTF-8. Decode for comparison.
      const requestKey = decodeURIComponent(request.uri.replace(/^\//, ''));
      if (requestKey !== result.key) {
        return errorResponse('403', 'PATH_MISMATCH', 'Upload path does not match token');
      }

      // Remove token from querystring
      delete params['token'];
      request.querystring = Object.entries(params)
        .map(([k, v]) => (v ? `${encodeURIComponent(k)}=${encodeURIComponent(v)}` : encodeURIComponent(k)))
        .join('&');
    }

    // --- SigV4 signing for ALL requests (GET, PUT, HEAD, etc.) ---
    // Since this origin has no OAC, we must sign every request to S3
    const origin = request.origin?.s3 || request.origin?.custom;
    const originDomain = (origin as any)?.domainName || '';
    const bucketName = originDomain.split('.s3.')[0];
    const host = `${bucketName}.s3.${BUCKET_REGION}.amazonaws.com`;
    const region = BUCKET_REGION;
    const service = 's3';

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.substring(0, 8);

    const canonicalUri = request.uri;
    const canonicalQuerystring = request.querystring
      ? request.querystring.split('&').filter(Boolean).sort().join('&')
      : '';

    const payloadHash = 'UNSIGNED-PAYLOAD';

    const headersToSign: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (sessionToken) {
      headersToSign['x-amz-security-token'] = sessionToken;
    }

    const sortedHeaderKeys = Object.keys(headersToSign).sort();
    const signedHeaders = sortedHeaderKeys.join(';');
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}\n`).join('');

    const canonicalRequest = [
      request.method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n');

    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign, 'utf8')
      .digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    request.headers['host'] = [{ key: 'Host', value: host }];
    request.headers['authorization'] = [{ key: 'Authorization', value: authorization }];
    request.headers['x-amz-date'] = [{ key: 'X-Amz-Date', value: amzDate }];
    request.headers['x-amz-content-sha256'] = [{ key: 'X-Amz-Content-Sha256', value: payloadHash }];
    if (sessionToken) {
      request.headers['x-amz-security-token'] = [{ key: 'X-Amz-Security-Token', value: sessionToken }];
    }

    return request;
  } catch {
    return errorResponse('500', 'SIGNING_ERROR', 'Internal signing error');
  }
}
