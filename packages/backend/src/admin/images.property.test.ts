import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';

// Feature: cloudfront-upload-proxy, Property 4: 上传 URL 格式正确性
// 对于任意有效的上传参数（productId、fileName），当 UPLOAD_VIA_CLOUDFRONT=true 时，
// Upload URL Generator 生成的商品图片 URL 应匹配
// https://store.awscommunity.cn/products/{productId}/{fileId}.{ext}?token=...
// 且 URL 中包含 token= 查询参数。
// **Validates: Requirements 4.1, 4.4**

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://test-images-bucket.s3.ap-northeast-1.amazonaws.com/presigned-url?X-Amz-Signature=abc'),
}));

function createMockS3Client() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const bucketName = 'test-images-bucket';

/** Arbitrary: alphanumeric productId */
const productIdArb = fc.string({
  minLength: 1,
  maxLength: 20,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
});

/** Arbitrary: valid image extension */
const extensionArb = fc.constantFrom('jpg', 'jpeg', 'png', 'webp');

/** Arbitrary: random file base name + extension → full fileName */
const fileNameArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 15, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789') }),
  extensionArb,
).map(([name, ext]) => `${name}.${ext}`);

describe('Property 4: 上传 URL 格式正确性', () => {
  let cfGetUploadUrl: typeof import('./images').getUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
    process.env.UPLOAD_TOKEN_SECRET = 'test-secret';
    process.env.CLOUDFRONT_DOMAIN = 'https://store.awscommunity.cn';
    const mod = await import('./images');
    cfGetUploadUrl = mod.getUploadUrl;
  });

  afterAll(() => {
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    delete process.env.UPLOAD_TOKEN_SECRET;
    delete process.env.CLOUDFRONT_DOMAIN;
    vi.resetModules();
  });

  it('商品图片 URL 匹配 https://store.awscommunity.cn/products/{productId}/{fileId}.{ext}?token=...', async () => {
    await fc.assert(
      fc.asyncProperty(productIdArb, fileNameArb, extensionArb, async (productId, fileName, _ext) => {
        // Derive the actual extension from the generated fileName
        const ext = fileName.split('.').pop()!;
        const s3 = createMockS3Client();
        const result = await cfGetUploadUrl(
          { productId, fileName, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` },
          0,
          s3,
          bucketName,
        );

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        const uploadUrl = result.data!.uploadUrl;

        // URL starts with CloudFront domain + /products/{productId}/
        const prefix = `https://store.awscommunity.cn/products/${productId}/`;
        expect(uploadUrl.startsWith(prefix)).toBe(true);

        // URL contains token= query parameter
        expect(uploadUrl).toContain('?token=');

        // Extract the path portion between prefix and ?token=
        const afterPrefix = uploadUrl.slice(prefix.length);
        const [fileIdWithExt] = afterPrefix.split('?');

        // fileId.ext pattern: ULID (26 uppercase alphanumeric chars) + .ext
        const fileIdExtRegex = new RegExp(`^[A-Z0-9]{26}\\.${ext}$`);
        expect(fileIdWithExt).toMatch(fileIdExtRegex);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cloudfront-upload-proxy, Property 6: 功能开关控制 URL 格式
// 对于任意有效的上传参数，当 UPLOAD_VIA_CLOUDFRONT=true 时，生成的上传 URL 域名为
// store.awscommunity.cn；当环境变量为 false 时，生成的上传 URL 为 S3 presigned URL
// （域名包含 s3.ap-northeast-1.amazonaws.com）。
// **Validates: Requirements 8.1, 8.2, 8.3**

describe('Property 6: 功能开关控制 URL 格式', () => {
  describe('UPLOAD_VIA_CLOUDFRONT=true → CloudFront 域名', () => {
    let cfGetUploadUrl: typeof import('./images').getUploadUrl;

    beforeAll(async () => {
      vi.resetModules();
      process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
      process.env.UPLOAD_TOKEN_SECRET = 'test-secret';
      process.env.CLOUDFRONT_DOMAIN = 'https://store.awscommunity.cn';
      const mod = await import('./images');
      cfGetUploadUrl = mod.getUploadUrl;
    });

    afterAll(() => {
      delete process.env.UPLOAD_VIA_CLOUDFRONT;
      delete process.env.UPLOAD_TOKEN_SECRET;
      delete process.env.CLOUDFRONT_DOMAIN;
      vi.resetModules();
    });

    it('URL 域名为 store.awscommunity.cn', async () => {
      await fc.assert(
        fc.asyncProperty(productIdArb, fileNameArb, async (productId, fileName) => {
          const ext = fileName.split('.').pop()!;
          const s3 = createMockS3Client();
          const result = await cfGetUploadUrl(
            { productId, fileName, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` },
            0,
            s3,
            bucketName,
          );

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          const url = new URL(result.data!.uploadUrl);
          expect(url.hostname).toBe('store.awscommunity.cn');
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('UPLOAD_VIA_CLOUDFRONT=false → S3 presigned URL', () => {
    let s3GetUploadUrl: typeof import('./images').getUploadUrl;

    beforeAll(async () => {
      vi.resetModules();
      process.env.UPLOAD_VIA_CLOUDFRONT = 'false';
      delete process.env.UPLOAD_TOKEN_SECRET;
      delete process.env.CLOUDFRONT_DOMAIN;
      const mod = await import('./images');
      s3GetUploadUrl = mod.getUploadUrl;
    });

    afterAll(() => {
      delete process.env.UPLOAD_VIA_CLOUDFRONT;
      vi.resetModules();
    });

    it('URL 域名包含 s3.ap-northeast-1.amazonaws.com', async () => {
      await fc.assert(
        fc.asyncProperty(productIdArb, fileNameArb, async (productId, fileName) => {
          const ext = fileName.split('.').pop()!;
          const s3 = createMockS3Client();
          const result = await s3GetUploadUrl(
            { productId, fileName, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` },
            0,
            s3,
            bucketName,
          );

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          const uploadUrl = result.data!.uploadUrl;
          // S3 mode: URL should contain the S3 regional domain
          expect(uploadUrl).toContain('s3.ap-northeast-1.amazonaws.com');
          // S3 mode: URL should NOT contain CloudFront domain
          expect(uploadUrl).not.toContain('store.awscommunity.cn');
        }),
        { numRuns: 100 },
      );
    });
  });
});
