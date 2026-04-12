import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ErrorCodes } from '@points-mall/shared';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-claim-url'),
}));

function createMockS3Client() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

const bucketName = 'test-images-bucket';

// ─── S3 mode (default, UPLOAD_VIA_CLOUDFRONT not set) ──────

describe('getClaimUploadUrl - S3 mode', () => {
  let getClaimUploadUrl: typeof import('./images').getClaimUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    delete process.env.UPLOAD_TOKEN_SECRET;
    const mod = await import('./images');
    getClaimUploadUrl = mod.getClaimUploadUrl;
  });

  afterAll(() => {
    vi.resetModules();
  });

  it('should return S3 presigned URL', async () => {
    const s3 = createMockS3Client();
    const result = await getClaimUploadUrl(
      { userId: 'user-1', fileName: 'receipt.jpg', contentType: 'image/jpeg' },
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toBe('https://s3.amazonaws.com/presigned-claim-url');
    expect(result.data!.key).toMatch(/^claims\/user-1\/[A-Z0-9]+\.jpg$/);
    expect(result.data!.url).toMatch(/^\/claims\/user-1\/[A-Z0-9]+\.jpg$/);
  });

  it('should reject invalid file type', async () => {
    const s3 = createMockS3Client();
    const result = await getClaimUploadUrl(
      { userId: 'user-1', fileName: 'doc.pdf', contentType: 'application/pdf' },
      s3,
      bucketName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_FILE_TYPE);
  });

  it('should reject file with no extension', async () => {
    const s3 = createMockS3Client();
    const result = await getClaimUploadUrl(
      { userId: 'user-1', fileName: 'noext', contentType: 'image/jpeg' },
      s3,
      bucketName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_FILE_TYPE);
  });
});

// ─── CloudFront mode ───────────────────────────────────────

describe('getClaimUploadUrl - CloudFront mode', () => {
  let getClaimUploadUrl: typeof import('./images').getClaimUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
    process.env.UPLOAD_TOKEN_SECRET = 'test-secret-key';
    process.env.CLOUDFRONT_DOMAIN = 'https://store.awscommunity.cn';
    const mod = await import('./images');
    getClaimUploadUrl = mod.getClaimUploadUrl;
  });

  afterAll(() => {
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    delete process.env.UPLOAD_TOKEN_SECRET;
    delete process.env.CLOUDFRONT_DOMAIN;
    vi.resetModules();
  });

  it('should return CloudFront domain URL with token parameter', async () => {
    const s3 = createMockS3Client();
    const result = await getClaimUploadUrl(
      { userId: 'user-cf', fileName: 'receipt.png', contentType: 'image/png' },
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toMatch(
      /^https:\/\/store\.awscommunity\.cn\/claims\/user-cf\/[A-Z0-9]+\.png\?token=.+$/,
    );
    expect(result.data!.key).toMatch(/^claims\/user-cf\/[A-Z0-9]+\.png$/);
  });
});
