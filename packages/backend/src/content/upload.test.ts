import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  getContentUploadUrl,
  createContentItem,
  type GetContentUploadUrlInput,
  type CreateContentItemInput,
} from './upload';
import { ErrorCodes } from '@points-mall/shared';

// Mock S3 presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-upload-url'),
}));

function createMockS3Client() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

function createMockDynamoClient(getResult: any = {}) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      if (cmd.constructor.name === 'GetCommand') {
        return Promise.resolve(getResult);
      }
      return Promise.resolve({});
    }),
  } as any;
}

const bucket = 'test-content-bucket';
const tables = { contentItemsTable: 'ContentItems', categoriesTable: 'ContentCategories' };

// ─── getContentUploadUrl ───────────────────────────────────

describe('getContentUploadUrl', () => {
  const validInput: GetContentUploadUrlInput = {
    userId: 'user-1',
    fileName: 'slides.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  it('should return uploadUrl and fileKey for valid file type', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(validInput, s3, bucket);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.uploadUrl).toBe('https://s3.amazonaws.com/presigned-upload-url');
    expect(result.data!.fileKey).toMatch(/^content\/user-1\/[A-Z0-9]+\/slides\.pptx$/);
  });

  it('should accept application/pdf', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'application/pdf', fileName: 'doc.pdf' },
      s3, bucket,
    );
    expect(result.success).toBe(true);
  });

  it('should accept application/msword', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'application/msword', fileName: 'doc.doc' },
      s3, bucket,
    );
    expect(result.success).toBe(true);
  });

  it('should accept application/vnd.openxmlformats-officedocument.wordprocessingml.document', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'doc.docx' },
      s3, bucket,
    );
    expect(result.success).toBe(true);
  });

  it('should accept application/vnd.ms-powerpoint', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'application/vnd.ms-powerpoint', fileName: 'slides.ppt' },
      s3, bucket,
    );
    expect(result.success).toBe(true);
  });

  it('should reject invalid file type (image/jpeg)', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'image/jpeg', fileName: 'photo.jpg' },
      s3, bucket,
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_FILE_TYPE);
  });

  it('should reject invalid file type (text/plain)', async () => {
    const s3 = createMockS3Client();
    const result = await getContentUploadUrl(
      { ...validInput, contentType: 'text/plain', fileName: 'readme.txt' },
      s3, bucket,
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_FILE_TYPE);
  });
});


// ─── createContentItem ─────────────────────────────────────

describe('createContentItem', () => {
  const validInput: CreateContentItemInput = {
    userId: 'user-1',
    userNickname: 'TestUser',
    userRole: 'Speaker',
    title: 'My Presentation',
    description: 'A great presentation about testing.',
    categoryId: 'cat-1',
    fileKey: 'content/user-1/ABC123/slides.pptx',
    fileName: 'slides.pptx',
    fileSize: 1024 * 1024, // 1MB
  };

  it('should create content item with valid input', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.title).toBe('My Presentation');
    expect(result.item!.categoryName).toBe('Tech');
  });

  it('should set initial status to pending with counters at 0', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item!.status).toBe('pending');
    expect(result.item!.likeCount).toBe(0);
    expect(result.item!.commentCount).toBe(0);
    expect(result.item!.reservationCount).toBe(0);
  });

  it('should reject empty title', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem({ ...validInput, title: '' }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_TITLE);
  });

  it('should reject title longer than 100 characters', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const longTitle = 'A'.repeat(101);
    const result = await createContentItem({ ...validInput, title: longTitle }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_TITLE);
  });

  it('should accept title with exactly 100 characters', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem({ ...validInput, title: 'A'.repeat(100) }, dynamo, tables);

    expect(result.success).toBe(true);
  });

  it('should reject empty description', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem({ ...validInput, description: '' }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_DESCRIPTION);
  });

  it('should reject description longer than 2000 characters', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const longDesc = 'B'.repeat(2001);
    const result = await createContentItem({ ...validInput, description: longDesc }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_DESCRIPTION);
  });

  it('should accept description with exactly 2000 characters', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem({ ...validInput, description: 'B'.repeat(2000) }, dynamo, tables);

    expect(result.success).toBe(true);
  });

  it('should reject non-existent category (CATEGORY_NOT_FOUND)', async () => {
    const dynamo = createMockDynamoClient({ Item: undefined });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
  });

  it('should accept valid videoUrl', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, videoUrl: 'https://www.youtube.com/watch?v=abc123' },
      dynamo, tables,
    );

    expect(result.success).toBe(true);
    expect(result.item!.videoUrl).toBe('https://www.youtube.com/watch?v=abc123');
  });

  it('should reject invalid videoUrl (INVALID_VIDEO_URL)', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, videoUrl: 'not-a-url' },
      dynamo, tables,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_VIDEO_URL);
  });

  it('should allow omitting videoUrl', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item!.videoUrl).toBeUndefined();
  });

  it('should allow empty string videoUrl (treated as no video)', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, videoUrl: '' },
      dynamo, tables,
    );

    expect(result.success).toBe(true);
  });

  it('should generate a unique contentId', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result1 = await createContentItem(validInput, dynamo, tables);
    const result2 = await createContentItem(validInput, dynamo, tables);

    expect(result1.item!.contentId).not.toBe(result2.item!.contentId);
  });

  it('should set createdAt and updatedAt timestamps', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.item!.createdAt).toBeDefined();
    expect(result.item!.updatedAt).toBeDefined();
  });

  // ── Tag-related tests ──────────────────────────────────────

  it('should create content item with valid tags', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, tags: ['React', 'TypeScript'] },
      dynamo,
      { ...tables, contentTagsTable: 'ContentTags' },
    );

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.tags).toEqual(['react', 'typescript']);
  });

  it('should default tags to empty array when not provided', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.tags).toEqual([]);
  });

  it('should reject tags exceeding maximum of 5', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6'] },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.TOO_MANY_TAGS);
  });

  it('should reject invalid tag name (too short)', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, tags: ['a'] },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_TAG_NAME);
  });

  it('should reject duplicate tags after normalization', async () => {
    const dynamo = createMockDynamoClient({ Item: { categoryId: 'cat-1', name: 'Tech' } });
    const result = await createContentItem(
      { ...validInput, tags: ['React', 'react'] },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.DUPLICATE_TAG_NAME);
  });
});


// ─── getContentUploadUrl - CloudFront mode ─────────────────

describe('getContentUploadUrl - CloudFront mode', () => {
  let cfGetContentUploadUrl: typeof import('./upload').getContentUploadUrl;

  beforeAll(async () => {
    vi.resetModules();
    process.env.UPLOAD_VIA_CLOUDFRONT = 'true';
    process.env.UPLOAD_TOKEN_SECRET = 'test-secret-key';
    process.env.CLOUDFRONT_DOMAIN = 'https://store.awscommunity.cn';
    const mod = await import('./upload');
    cfGetContentUploadUrl = mod.getContentUploadUrl;
  });

  afterAll(() => {
    delete process.env.UPLOAD_VIA_CLOUDFRONT;
    delete process.env.UPLOAD_TOKEN_SECRET;
    delete process.env.CLOUDFRONT_DOMAIN;
    vi.resetModules();
  });

  it('should return CloudFront domain URL with token parameter', async () => {
    const s3 = { send: vi.fn().mockResolvedValue({}) } as any;
    const input: GetContentUploadUrlInput = {
      userId: 'user-cf',
      fileName: 'slides.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    const result = await cfGetContentUploadUrl(input, s3, 'test-content-bucket');

    expect(result.success).toBe(true);
    expect(result.data!.uploadUrl).toMatch(
      /^https:\/\/store\.awscommunity\.cn\/content\/user-cf\/[A-Z0-9]+\/slides\.pptx\?token=.+$/,
    );
  });
});
