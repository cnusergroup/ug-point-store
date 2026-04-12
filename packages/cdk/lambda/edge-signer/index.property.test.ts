import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';
import type {
  CloudFrontRequestEvent,
  CloudFrontRequest,
  CloudFrontResultResponse,
} from 'aws-lambda';

// Stub build-time constants before importing the handler
vi.stubGlobal('BUCKET_NAME', 'test-images-bucket');
vi.stubGlobal('BUCKET_REGION', 'ap-northeast-1');
vi.stubGlobal('TOKEN_SECRET', 'test-secret');

const originalEnv = { ...process.env };

// S3 key character set for generating random URIs
const s3KeyChars = 'abcdefghijklmnopqrstuvwxyz0123456789-_/.';
const s3KeyCharArb = fc.mapToConstant(
  { num: s3KeyChars.length, build: (v) => s3KeyChars[v] },
);
const s3KeyArb = fc.string({ minLength: 1, maxLength: 60, unit: s3KeyCharArb });

function createMockEvent(
  method: string,
  uri: string,
  querystring: string = '',
): CloudFrontRequestEvent {
  return {
    Records: [
      {
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
      },
    ],
  };
}

function isCloudFrontRequest(
  result: CloudFrontRequest | CloudFrontResultResponse,
): result is CloudFrontRequest {
  return 'method' in result && 'uri' in result && !('status' in result);
}

describe('Feature: cloudfront-upload-proxy, Property 1: 仅对 PUT 请求执行签名', () => {
  let handler: (
    event: CloudFrontRequestEvent,
  ) => Promise<CloudFrontRequest | CloudFrontResultResponse>;

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

  /**
   * **Validates: Requirements 2.1**
   *
   * For any non-PUT HTTP method, the Edge Signer should pass through the
   * original request without adding an Authorization header.
   */
  it('should pass through non-PUT requests without Authorization header', async () => {
    const nonPutMethods = ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PATCH', 'POST'] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonPutMethods),
        s3KeyArb,
        async (method, path) => {
          const uri = `/${path}`;
          const event = createMockEvent(method, uri);
          const result = await handler(event);

          // Should return the original request (not an error response)
          expect(isCloudFrontRequest(result)).toBe(true);

          if (isCloudFrontRequest(result)) {
            // Method should be unchanged
            expect(result.method).toBe(method);
            // URI should be unchanged
            expect(result.uri).toBe(uri);
            // Should NOT have Authorization header added
            expect(result.headers['authorization']).toBeUndefined();
            // Host should remain unchanged (not rewritten to S3)
            expect(result.headers['host'][0].value).toBe('store.awscommunity.cn');
            // Should NOT have x-amz-date header added
            expect(result.headers['x-amz-date']).toBeUndefined();
            // Should NOT have x-amz-content-sha256 header added
            expect(result.headers['x-amz-content-sha256']).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
