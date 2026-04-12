import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { CloudFrontRequestEvent, CloudFrontRequest, CloudFrontResultResponse } from 'aws-lambda';
import { generateUploadToken } from '../../../backend/src/utils/upload-token';

// Define build-time constants as globals before importing the handler
const TEST_BUCKET_NAME = 'test-images-bucket';
const TEST_BUCKET_REGION = 'ap-northeast-1';
const TEST_TOKEN_SECRET = 'test-secret-key-for-edge-signer';

vi.stubGlobal('BUCKET_NAME', TEST_BUCKET_NAME);
vi.stubGlobal('BUCKET_REGION', TEST_BUCKET_REGION);
vi.stubGlobal('TOKEN_SECRET', TEST_TOKEN_SECRET);

// Set AWS credentials before importing handler
const originalEnv = { ...process.env };

function createMockEvent(method: string, uri: string, querystring: string = ''): CloudFrontRequestEvent {
  return {
    Records: [{
      cf: {
        config: {
          distributionDomainName: 'd123.cloudfront.net',
          distributionId: 'EDFDVBD6EXAMPLE',
          eventType: 'origin-request' as const,
          requestId: 'test-request-id',
        },
        request: {
          clientIp: '1.2.3.4',
          headers: {
            host: [{ key: 'Host', value: 'store.awscommunity.cn' }],
          },
          method,
          querystring,
          uri,
        },
      },
    }],
  };
}

function isCloudFrontRequest(result: CloudFrontRequest | CloudFrontResultResponse): result is CloudFrontRequest {
  return 'method' in result && 'uri' in result && !('status' in result);
}

function isCloudFrontResponse(result: CloudFrontRequest | CloudFrontResultResponse): result is CloudFrontResultResponse {
  return 'status' in result;
}

describe('Edge Signer Lambda@Edge', () => {
  let handler: (event: CloudFrontRequestEvent) => Promise<CloudFrontRequest | CloudFrontResultResponse>;

  beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    delete process.env.AWS_SESSION_TOKEN;

    const mod = await import('./index');
    handler = mod.handler;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('GET request passthrough', () => {
    it('should pass through GET request without modifying headers', async () => {
      const event = createMockEvent('GET', '/products/abc/image.jpg');
      const result = await handler(event);

      expect(isCloudFrontRequest(result)).toBe(true);
      if (isCloudFrontRequest(result)) {
        expect(result.method).toBe('GET');
        expect(result.uri).toBe('/products/abc/image.jpg');
        // Should not have Authorization header added
        expect(result.headers['authorization']).toBeUndefined();
        // Host should remain unchanged
        expect(result.headers['host'][0].value).toBe('store.awscommunity.cn');
      }
    });
  });

  describe('PUT request with valid token', () => {
    it('should return request with Authorization header for valid token', async () => {
      const key = 'products/abc/image.jpg';
      const { token } = generateUploadToken({ key }, TEST_TOKEN_SECRET);
      const event = createMockEvent('PUT', `/${key}`, `token=${encodeURIComponent(token)}`);

      const result = await handler(event);

      expect(isCloudFrontRequest(result)).toBe(true);
      if (isCloudFrontRequest(result)) {
        // Authorization header should be set
        expect(result.headers['authorization']).toBeDefined();
        const authValue = result.headers['authorization'][0].value;

        // Verify SigV4 Authorization header format
        expect(authValue).toMatch(
          /^AWS4-HMAC-SHA256 Credential=.*\/s3\/aws4_request, SignedHeaders=.*, Signature=[a-f0-9]{64}$/,
        );

        // Verify credential includes the access key
        expect(authValue).toContain('Credential=AKIAIOSFODNN7EXAMPLE/');

        // Host should be updated to S3 endpoint
        expect(result.headers['host'][0].value).toBe(
          `${TEST_BUCKET_NAME}.s3.${TEST_BUCKET_REGION}.amazonaws.com`,
        );

        // x-amz-date should be set
        expect(result.headers['x-amz-date']).toBeDefined();

        // x-amz-content-sha256 should be UNSIGNED-PAYLOAD
        expect(result.headers['x-amz-content-sha256'][0].value).toBe('UNSIGNED-PAYLOAD');

        // Token should be removed from querystring
        expect(result.querystring).not.toContain('token=');
      }
    });
  });

  describe('PUT request without token', () => {
    it('should return 403 with MISSING_TOKEN error', async () => {
      const event = createMockEvent('PUT', '/products/abc/image.jpg');
      const result = await handler(event);

      expect(isCloudFrontResponse(result)).toBe(true);
      if (isCloudFrontResponse(result)) {
        expect(result.status).toBe('403');
        const body = JSON.parse(result.body!);
        expect(body.error).toBe('MISSING_TOKEN');
        expect(body.message).toBe('Upload token is required');
      }
    });
  });

  describe('PUT request with expired token', () => {
    it('should return 403 with TOKEN_EXPIRED error', async () => {
      const key = 'products/abc/image.jpg';
      // Generate a token that expired 10 seconds ago
      const { token } = generateUploadToken({ key, expiresIn: -10 }, TEST_TOKEN_SECRET);
      const event = createMockEvent('PUT', `/${key}`, `token=${encodeURIComponent(token)}`);

      const result = await handler(event);

      expect(isCloudFrontResponse(result)).toBe(true);
      if (isCloudFrontResponse(result)) {
        expect(result.status).toBe('403');
        const body = JSON.parse(result.body!);
        expect(body.error).toBe('TOKEN_EXPIRED');
        expect(body.message).toBe('Upload token has expired');
      }
    });
  });

  describe('PUT request with invalid token signature', () => {
    it('should return 403 with INVALID_TOKEN error', async () => {
      const key = 'products/abc/image.jpg';
      // Generate a valid token then tamper with the signature
      const { token } = generateUploadToken({ key }, TEST_TOKEN_SECRET);
      const [payload] = token.split('.');
      const tamperedToken = `${payload}.invalidsignaturedata`;
      const event = createMockEvent('PUT', `/${key}`, `token=${encodeURIComponent(tamperedToken)}`);

      const result = await handler(event);

      expect(isCloudFrontResponse(result)).toBe(true);
      if (isCloudFrontResponse(result)) {
        expect(result.status).toBe('403');
        const body = JSON.parse(result.body!);
        expect(body.error).toBe('INVALID_TOKEN');
        expect(body.message).toBe('Upload token is invalid');
      }
    });
  });

  describe('PUT request with path mismatch', () => {
    it('should return 403 with PATH_MISMATCH error', async () => {
      const tokenKey = 'products/abc/image.jpg';
      const requestPath = '/products/xyz/other.jpg'; // Different path
      const { token } = generateUploadToken({ key: tokenKey }, TEST_TOKEN_SECRET);
      const event = createMockEvent('PUT', requestPath, `token=${encodeURIComponent(token)}`);

      const result = await handler(event);

      expect(isCloudFrontResponse(result)).toBe(true);
      if (isCloudFrontResponse(result)) {
        expect(result.status).toBe('403');
        const body = JSON.parse(result.body!);
        expect(body.error).toBe('PATH_MISMATCH');
        expect(body.message).toBe('Upload path does not match token');
      }
    });
  });

  describe('SigV4 Authorization header format', () => {
    it('should produce correctly formatted AWS4-HMAC-SHA256 Authorization header', async () => {
      const key = 'content/user123/file.pdf';
      const { token } = generateUploadToken({ key }, TEST_TOKEN_SECRET);
      const event = createMockEvent('PUT', `/${key}`, `token=${encodeURIComponent(token)}`);

      const result = await handler(event);

      expect(isCloudFrontRequest(result)).toBe(true);
      if (isCloudFrontRequest(result)) {
        const authValue = result.headers['authorization'][0].value;

        // Full format: AWS4-HMAC-SHA256 Credential=AKID/date/region/s3/aws4_request, SignedHeaders=..., Signature=...
        const parts = authValue.split(' ');
        expect(parts[0]).toBe('AWS4-HMAC-SHA256');

        // Parse credential
        const credentialMatch = authValue.match(/Credential=([^,]+)/);
        expect(credentialMatch).not.toBeNull();
        const credential = credentialMatch![1];
        expect(credential).toMatch(/^AKIAIOSFODNN7EXAMPLE\/\d{8}\/ap-northeast-1\/s3\/aws4_request$/);

        // Parse signed headers
        const signedHeadersMatch = authValue.match(/SignedHeaders=([^,]+)/);
        expect(signedHeadersMatch).not.toBeNull();
        const signedHeaders = signedHeadersMatch![1];
        expect(signedHeaders).toContain('host');
        expect(signedHeaders).toContain('x-amz-content-sha256');
        expect(signedHeaders).toContain('x-amz-date');

        // Parse signature (64 hex chars)
        const signatureMatch = authValue.match(/Signature=([a-f0-9]+)$/);
        expect(signatureMatch).not.toBeNull();
        expect(signatureMatch![1]).toHaveLength(64);
      }
    });
  });
});
