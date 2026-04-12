import { describe, it, expect, vi } from 'vitest';
import { editContentItem, type EditContentItemInput } from './edit';
import { ErrorCodes } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';

// ─── Helpers ───────────────────────────────────────────────

function createMockS3Client(shouldFail = false) {
  return {
    send: vi.fn().mockImplementation(() => {
      if (shouldFail) return Promise.reject(new Error('S3 delete failed'));
      return Promise.resolve({});
    }),
  } as any;
}

function createMockDynamoClient(
  contentItem: ContentItem | undefined,
  categoryItem?: { categoryId: string; name: string },
) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        const tableName = cmd.input?.TableName as string;
        if (tableName?.includes('Categories') || tableName?.includes('categories')) {
          return Promise.resolve({ Item: categoryItem });
        }
        return Promise.resolve({ Item: contentItem });
      }
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

const bucket = 'test-content-bucket';
const tables = { contentItemsTable: 'ContentItems', categoriesTable: 'ContentCategories' };

function makePendingItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    contentId: 'content-1',
    title: 'Original Title',
    description: 'Original Description',
    categoryId: 'cat-1',
    categoryName: 'Tech',
    uploaderId: 'user-1',
    uploaderNickname: 'TestUser',
    uploaderRole: 'Speaker',
    fileKey: 'content/user-1/OLD123/slides.pptx',
    fileName: 'slides.pptx',
    fileSize: 1024 * 1024,
    status: 'pending',
    likeCount: 5,
    commentCount: 3,
    reservationCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRejectedItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return makePendingItem({
    status: 'rejected',
    rejectReason: 'Content quality too low',
    reviewerId: 'admin-1',
    reviewedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  });
}

const baseInput: EditContentItemInput = {
  contentId: 'content-1',
  userId: 'user-1',
  title: 'Updated Title',
};

// ─── editContentItem ───────────────────────────────────────

describe('editContentItem', () => {
  // 1. Uploader edits their own pending content successfully
  it('should allow uploader to edit their own pending content', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item, { categoryId: 'cat-1', name: 'Tech' });
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.title).toBe('Updated Title');
  });

  // 2. Uploader edits their own rejected content successfully
  it('should allow uploader to edit their own rejected content', async () => {
    const item = makeRejectedItem();
    const dynamo = createMockDynamoClient(item, { categoryId: 'cat-1', name: 'Tech' });
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.title).toBe('Updated Title');
  });

  // 3. Non-uploader edit is rejected (FORBIDDEN)
  it('should reject edit from non-uploader with FORBIDDEN', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, userId: 'other-user' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.FORBIDDEN);
  });

  // 4. Editing approved content succeeds and resets status to pending
  it('should allow editing approved content and reset status to pending', async () => {
    const item = makePendingItem({ status: 'approved' });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item!.status).toBe('pending');
  });

  // 4b. Editing content with reservations is rejected (CONTENT_NOT_EDITABLE)
  it('should reject editing content with reservations', async () => {
    const item = makePendingItem({ reservationCount: 3 });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_EDITABLE);
  });

  // 4c. Editing content with zero reservations is allowed
  it('should allow editing content with zero reservations', async () => {
    const item = makePendingItem({ reservationCount: 0 });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
  });

  // 5. Editing non-existent content is rejected (CONTENT_NOT_FOUND)
  it('should reject editing non-existent content with CONTENT_NOT_FOUND', async () => {
    const dynamo = createMockDynamoClient(undefined);
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  // 6. Title too long is rejected
  it('should reject title longer than 100 characters', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: 'A'.repeat(101) },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_TITLE);
  });

  // 6b. Empty title is rejected
  it('should reject empty title', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: '' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_TITLE);
  });

  // 7. Description too long is rejected
  it('should reject description longer than 2000 characters', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: undefined, description: 'B'.repeat(2001) },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_DESCRIPTION);
  });

  // 7b. Empty description is rejected
  it('should reject empty description', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: undefined, description: '' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_DESCRIPTION);
  });

  // 8. Invalid category ID is rejected
  it('should reject invalid category ID with CATEGORY_NOT_FOUND', async () => {
    const item = makePendingItem();
    // Content item exists, but category lookup returns undefined
    const dynamo = createMockDynamoClient(item, undefined);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: undefined, categoryId: 'non-existent-cat' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
  });

  // 9. Invalid video URL is rejected
  it('should reject invalid video URL with INVALID_VIDEO_URL', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: undefined, videoUrl: 'not-a-valid-url' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_VIDEO_URL);
  });

  // 10. Empty string video URL clears the field
  it('should clear videoUrl when empty string is provided', async () => {
    const item = makePendingItem({ videoUrl: 'https://youtube.com/watch?v=abc' });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { ...baseInput, title: undefined, videoUrl: '' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(result.item!.videoUrl).toBeUndefined();
  });

  // 11. File replacement triggers old file deletion
  it('should delete old S3 file when fileKey is replaced', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      {
        ...baseInput,
        title: undefined,
        fileKey: 'content/user-1/NEW456/new-slides.pptx',
        fileName: 'new-slides.pptx',
        fileSize: 2048,
      },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(s3.send).toHaveBeenCalled();
    // Verify the S3 delete was called with the old file key
    const s3Call = s3.send.mock.calls.find(
      (call: any[]) => call[0].constructor.name === 'DeleteObjectCommand',
    );
    expect(s3Call).toBeDefined();
  });

  // 12. S3 delete failure doesn't block edit success
  it('should succeed even when S3 delete fails', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client(true); // S3 will fail
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await editContentItem(
      {
        ...baseInput,
        title: undefined,
        fileKey: 'content/user-1/NEW456/new-slides.pptx',
        fileName: 'new-slides.pptx',
        fileSize: 2048,
      },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // 13. After edit, status resets to pending
  it('should reset status to pending after edit', async () => {
    const item = makeRejectedItem();
    const dynamo = createMockDynamoClient(item, { categoryId: 'cat-1', name: 'Tech' });
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item!.status).toBe('pending');
  });

  // 14. After edit, rejectReason/reviewerId/reviewedAt are cleared
  it('should clear rejectReason, reviewerId, and reviewedAt after edit', async () => {
    const item = makeRejectedItem();
    const dynamo = createMockDynamoClient(item, { categoryId: 'cat-1', name: 'Tech' });
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item!.rejectReason).toBeUndefined();
    expect(result.item!.reviewerId).toBeUndefined();
    expect(result.item!.reviewedAt).toBeUndefined();
  });

  // 15. After edit, likeCount/commentCount/reservationCount unchanged
  it('should preserve likeCount, commentCount, and reservationCount after edit', async () => {
    const item = makePendingItem({ likeCount: 42, commentCount: 7, reservationCount: 0 });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(baseInput, dynamo, s3, tables, bucket);

    expect(result.success).toBe(true);
    expect(result.item!.likeCount).toBe(42);
    expect(result.item!.commentCount).toBe(7);
    expect(result.item!.reservationCount).toBe(0);
  });

  // 16. Partial update (only title provided)
  it('should update only title when only title is provided', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', title: 'New Title Only' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(result.item!.title).toBe('New Title Only');
    // Other fields should remain unchanged
    expect(result.item!.description).toBe('Original Description');
    expect(result.item!.categoryId).toBe('cat-1');
    expect(result.item!.categoryName).toBe('Tech');
    expect(result.item!.fileKey).toBe('content/user-1/OLD123/slides.pptx');
    expect(result.item!.fileName).toBe('slides.pptx');
    expect(result.item!.fileSize).toBe(1024 * 1024);
  });

  // 17. Partial update (only description provided)
  it('should update only description when only description is provided', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', description: 'New Description Only' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(result.item!.description).toBe('New Description Only');
    // Other fields should remain unchanged
    expect(result.item!.title).toBe('Original Title');
    expect(result.item!.categoryId).toBe('cat-1');
    expect(result.item!.categoryName).toBe('Tech');
    expect(result.item!.fileKey).toBe('content/user-1/OLD123/slides.pptx');
  });

  // ── Tag-related tests ──────────────────────────────────────

  // 18. Editing tags successfully
  it('should update tags when valid tags are provided', async () => {
    const item = makePendingItem({ tags: ['react'] });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', tags: ['TypeScript', 'AWS'] },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(result.item!.tags).toEqual(['typescript', 'aws']);
  });

  // 19. Edit round-trip: tags in response match submitted normalized tags
  it('should return normalized tags in the response after edit (round-trip)', async () => {
    const item = makePendingItem({ tags: [] });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const inputTags = ['  React  ', 'TYPESCRIPT', 'aws'];
    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', tags: inputTags },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    expect(result.item!.tags).toEqual(['react', 'typescript', 'aws']);
  });

  // 20. Reject invalid tags during edit
  it('should reject invalid tags during edit (too many)', async () => {
    const item = makePendingItem();
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', tags: ['t1', 't2', 't3', 't4', 't5', 't6'] },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.TOO_MANY_TAGS);
  });

  // 21. Editing without tags field should not change existing tags
  it('should not change tags when tags field is not provided in edit', async () => {
    const item = makePendingItem({ tags: ['react', 'aws'] });
    const dynamo = createMockDynamoClient(item);
    const s3 = createMockS3Client();

    const result = await editContentItem(
      { contentId: 'content-1', userId: 'user-1', title: 'New Title' },
      dynamo, s3, tables, bucket,
    );

    expect(result.success).toBe(true);
    // tags should remain unchanged from the original item
    expect(result.item!.tags).toEqual(['react', 'aws']);
  });
});
