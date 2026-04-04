import { describe, it, expect, vi } from 'vitest';
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
    expect(result.data!.url).toBe(`/images/${result.data!.key}`);
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
