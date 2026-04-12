import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  getUploadUrl,
  deleteImage,
  extractExtension,
  generateS3Key,
  type GetUploadUrlInput,
} from './images';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

function createMockS3Client() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const bucketName = 'test-images-bucket';

describe('extractExtension', () => {
  it('should extract jpg extension', () => {
    expect(extractExtension('photo.jpg')).toBe('jpg');
  });

  it('should extract png extension case-insensitively', () => {
    expect(extractExtension('photo.PNG')).toBe('png');
  });

  it('should return empty string for no extension', () => {
    expect(extractExtension('noext')).toBe('');
  });

  it('should return empty string for trailing dot', () => {
    expect(extractExtension('file.')).toBe('');
  });

  it('should extract last extension from multiple dots', () => {
    expect(extractExtension('my.photo.webp')).toBe('webp');
  });
});

describe('generateS3Key', () => {
  it('should generate key with correct prefix and extension', () => {
    const key = generateS3Key('prod123', 'jpg');
    expect(key).toMatch(/^products\/prod123\/[A-Z0-9]+\.jpg$/);
  });

  it('should generate unique keys', () => {
    const key1 = generateS3Key('prod1', 'png');
    const key2 = generateS3Key('prod1', 'png');
    expect(key1).not.toBe(key2);
  });
});

describe('getUploadUrl', () => {
  const input: GetUploadUrlInput = {
    productId: 'prod-abc',
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
  };

  it('should return presigned URL for valid input with count < 5', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(input, 3, s3, bucketName);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
    expect(result.data!.key).toMatch(/^products\/prod-abc\/[A-Z0-9]+\.jpg$/);
  });

  it('should reject when currentImageCount >= 5', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(input, 5, s3, bucketName);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('IMAGE_LIMIT_EXCEEDED');
  });

  it('should reject when currentImageCount > 5', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(input, 7, s3, bucketName);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('IMAGE_LIMIT_EXCEEDED');
  });

  it('should reject invalid file type', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(
      { ...input, fileName: 'doc.pdf' },
      0,
      s3,
      bucketName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('INVALID_FILE_TYPE');
  });

  it('should reject file with no extension', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(
      { ...input, fileName: 'noext' },
      0,
      s3,
      bucketName,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('INVALID_FILE_TYPE');
  });

  it('should accept jpeg extension', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(
      { ...input, fileName: 'photo.jpeg' },
      0,
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.key).toMatch(/\.jpeg$/);
  });

  it('should accept png extension', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(
      { ...input, fileName: 'image.png' },
      0,
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
  });

  it('should accept webp extension', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(
      { ...input, fileName: 'image.webp' },
      0,
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
  });

  it('should accept at count 0', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(input, 0, s3, bucketName);
    expect(result.success).toBe(true);
  });

  it('should accept at count 4', async () => {
    const s3 = createMockS3Client();
    const result = await getUploadUrl(input, 4, s3, bucketName);
    expect(result.success).toBe(true);
  });
});

describe('getUploadUrl - S3 mode (UPLOAD_VIA_CLOUDFRONT not set)', () => {
  it('should return S3 presigned URL when UPLOAD_VIA_CLOUDFRONT is not set', async () => {
    const s3 = createMockS3Client();
    const input: GetUploadUrlInput = {
      productId: 'prod-abc',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    };
    const result = await getUploadUrl(input, 0, s3, bucketName);

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
  });
});

describe('getUploadUrl - CloudFront mode', () => {
  let cfGetUploadUrl: typeof import('./images').getUploadUrl;
  let cfGetTempUploadUrl: typeof import('./images').getTempUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
    process.env.UPLOAD_TOKEN_SECRET = 'test-secret-key';
    process.env.CLOUDFRONT_DOMAIN = 'https://store.awscommunity.cn';
    const mod = await import('./images');
    cfGetUploadUrl = mod.getUploadUrl;
    cfGetTempUploadUrl = mod.getTempUploadUrl;
  });

  afterAll(() => {
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    delete process.env.UPLOAD_TOKEN_SECRET;
    delete process.env.CLOUDFRONT_DOMAIN;
    vi.resetModules();
  });

  it('getUploadUrl should return CloudFront domain URL with token parameter', async () => {
    const s3 = createMockS3Client();
    const input: GetUploadUrlInput = {
      productId: 'prod-cf',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    };
    const result = await cfGetUploadUrl(input, 0, s3, bucketName);

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toMatch(/^https:\/\/store\.awscommunity\.cn\/products\/prod-cf\/[A-Z0-9]+\.jpg\?token=.+$/);
  });

  it('getTempUploadUrl should return CloudFront domain URL with token parameter', async () => {
    const s3 = createMockS3Client();
    const result = await cfGetTempUploadUrl(
      { fileName: 'image.png', contentType: 'image/png' },
      s3,
      bucketName,
    );

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toMatch(/^https:\/\/store\.awscommunity\.cn\/products\/temp\/[A-Z0-9]+\.png\?token=.+$/);
  });
});

describe('getUploadUrl - CloudFront mode without UPLOAD_TOKEN_SECRET', () => {
  let cfGetUploadUrl: typeof import('./images').getUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
    delete process.env.UPLOAD_TOKEN_SECRET;
    const mod = await import('./images');
    cfGetUploadUrl = mod.getUploadUrl;
  });

  afterAll(() => {
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    vi.resetModules();
  });

  it('should throw error when UPLOAD_TOKEN_SECRET is not set', async () => {
    const s3 = createMockS3Client();
    const input: GetUploadUrlInput = {
      productId: 'prod-err',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    };
    await expect(cfGetUploadUrl(input, 0, s3, bucketName)).rejects.toThrow(
      'UPLOAD_TOKEN_SECRET must be configured when UPLOAD_VIA_CLOUDFRONT is enabled',
    );
  });
});

describe('deleteImage', () => {
  it('should call S3 DeleteObject with correct params', async () => {
    const s3 = createMockS3Client();
    const result = await deleteImage('products/prod1/abc.jpg', s3, bucketName);

    expect(result.success).toBe(true);
    expect(s3.send).toHaveBeenCalledTimes(1);
    const command = s3.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('DeleteObjectCommand');
    expect(command.input.Bucket).toBe(bucketName);
    expect(command.input.Key).toBe('products/prod1/abc.jpg');
  });
});
