import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { editContentItem, type EditContentItemInput } from './edit';
import { getContentDetail } from './list';
import { ErrorCodes } from '@points-mall/shared';
import type { ContentItem, ContentStatus } from '@points-mall/shared';

// Feature: content-edit, Property 1: 编辑权限与状态门控
// 对于任何用户和 ContentItem 的组合，编辑操作成功当且仅当 userId === uploaderId 且 status ∈ {pending, rejected}。
// 当 userId !== uploaderId 时应返回 FORBIDDEN；当 status === approved 时应返回 CONTENT_NOT_EDITABLE。
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

// ─── Helpers ───────────────────────────────────────────────

const tables = { contentItemsTable: 'ContentItems', categoriesTable: 'ContentCategories' };
const bucket = 'test-content-bucket';

function makeContentItem(uploaderId: string, status: ContentStatus): ContentItem {
  return {
    contentId: 'content-1',
    title: 'Test Title',
    description: 'Test Description',
    categoryId: 'cat-1',
    categoryName: 'Tech',
    uploaderId,
    uploaderNickname: 'TestUser',
    uploaderRole: 'Speaker',
    fileKey: 'content/user/file.pptx',
    fileName: 'file.pptx',
    fileSize: 1024,
    status,
    likeCount: 0,
    commentCount: 0,
    reservationCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...(status === 'rejected'
      ? { rejectReason: 'Quality too low', reviewerId: 'admin-1', reviewedAt: '2024-01-02T00:00:00.000Z' }
      : {}),
  };
}

function createMockDynamoClient(contentItem: ContentItem | undefined) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({ Item: contentItem });
      }
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

/** Mock DynamoDB client that returns a content item on GetCommand for content table,
 *  and a valid category on GetCommand for categories table. */
function createMockDynamoClientWithCategory(
  contentItem: ContentItem | undefined,
  category: { categoryId: string; name: string },
) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        const tableName = cmd.input?.TableName as string;
        if (tableName?.includes('Categories') || tableName?.includes('categories')) {
          return Promise.resolve({ Item: category });
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

function createMockS3Client() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

// ─── Arbitraries ───────────────────────────────────────────

/** Arbitrary for a non-empty userId string */
const userIdArb = fc.uuid();

/** Arbitrary for a random ContentStatus */
const statusArb: fc.Arbitrary<ContentStatus> = fc.constantFrom('pending', 'rejected', 'approved');

// ─── Property 1 ────────────────────────────────────────────

describe('Feature: content-edit, Property 1: 编辑权限门控', () => {
  it('userId === uploaderId → success (any status); userId !== uploaderId → FORBIDDEN', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        statusArb,
        async (userId, uploaderId, status) => {
          const item = makeContentItem(uploaderId, status);
          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId,
            title: 'Updated Title',
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          if (userId !== uploaderId) {
            // Requirement 1.2: non-uploader → FORBIDDEN
            expect(result.success).toBe(false);
            expect(result.error!.code).toBe(ErrorCodes.FORBIDDEN);
          } else {
            // Requirement 1.1, 1.3: uploader → success regardless of status
            expect(result.success).toBe(true);
            expect(result.item).toBeDefined();
            expect(result.item!.status).toBe('pending'); // always reset to pending
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 2: 部分更新正确性 ────────────────────────────
// 对于任何有效的编辑请求，请求中提供的字段应被更新为新值，未提供的字段应保留原始值不变。
// **Validates: Requirements 2.1, 2.7, 3.1, 3.4, 3.5**

/** Arbitrary for a valid title (1~100 chars) */
const titleArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/** Arbitrary for a valid description (1~2000 chars) */
const descriptionArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/** Arbitrary for a valid video URL */
const videoUrlArb = fc.webUrl({ withFragments: false, withQueryParameters: false });

/** Arbitrary for a file key path */
const fileKeyArb = fc.tuple(fc.uuid(), fc.constantFrom('slides.pptx', 'doc.pdf', 'report.docx'))
  .map(([id, name]) => `content/user/${id}/${name}`);

/** Arbitrary for a file name */
const fileNameArb = fc.constantFrom('slides.pptx', 'doc.pdf', 'report.docx', 'presentation.pptx', 'notes.doc');

/** Arbitrary for a file size (positive integer) */
const fileSizeArb = fc.integer({ min: 1, max: 50 * 1024 * 1024 });

/** Arbitrary for a category ID */
const categoryIdArb = fc.uuid().map(id => `cat-${id}`);

/** Arbitrary for a category name */
const categoryNameArb = fc.constantFrom('Tech', 'Design', 'Marketing', 'Engineering', 'Science');

/** Arbitrary for an editable status */
const editableStatusArb: fc.Arbitrary<ContentStatus> = fc.constantFrom('pending', 'rejected');

/** Arbitrary for a random ContentItem with random field values */
const contentItemArb = fc.record({
  contentId: fc.uuid(),
  title: titleArb,
  description: descriptionArb,
  categoryId: categoryIdArb,
  categoryName: categoryNameArb,
  uploaderId: fc.uuid(),
  uploaderNickname: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  uploaderRole: fc.constantFrom('Speaker', 'Volunteer', 'UserGroupLeader', 'CommunityBuilder'),
  fileKey: fileKeyArb,
  fileName: fileNameArb,
  fileSize: fileSizeArb,
  status: editableStatusArb,
  likeCount: fc.nat({ max: 1000 }),
  commentCount: fc.nat({ max: 500 }),
  reservationCount: fc.constant(0),
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
}) as fc.Arbitrary<ContentItem>;

/**
 * Arbitrary that generates a random subset of editable fields with new values.
 * Each field is independently included or excluded (boolean toggle).
 * At least one field must be included.
 */
const fieldSubsetArb = fc.record({
  includeTitle: fc.boolean(),
  includeDescription: fc.boolean(),
  includeCategoryId: fc.boolean(),
  includeVideoUrl: fc.boolean(),
  includeFileKey: fc.boolean(),
  includeFileName: fc.boolean(),
  includeFileSize: fc.boolean(),
  newTitle: titleArb,
  newDescription: descriptionArb,
  newCategoryId: categoryIdArb,
  newCategoryName: categoryNameArb,
  newVideoUrl: videoUrlArb,
  newFileKey: fileKeyArb,
  newFileName: fileNameArb,
  newFileSize: fileSizeArb,
}).filter(f =>
  // Ensure at least one field is included
  f.includeTitle || f.includeDescription || f.includeCategoryId ||
  f.includeVideoUrl || f.includeFileKey || f.includeFileName || f.includeFileSize,
);

describe('Feature: content-edit, Property 2: 部分更新正确性', () => {
  it('fields provided in the request are updated to new values; fields NOT provided retain their original values', async () => {
    await fc.assert(
      fc.asyncProperty(
        contentItemArb,
        fieldSubsetArb,
        async (originalItem, fields) => {
          // Build the edit input: userId === uploaderId to pass permission check
          const input: EditContentItemInput = {
            contentId: originalItem.contentId,
            userId: originalItem.uploaderId,
            ...(fields.includeTitle ? { title: fields.newTitle } : {}),
            ...(fields.includeDescription ? { description: fields.newDescription } : {}),
            ...(fields.includeCategoryId ? { categoryId: fields.newCategoryId } : {}),
            ...(fields.includeVideoUrl ? { videoUrl: fields.newVideoUrl } : {}),
            ...(fields.includeFileKey ? { fileKey: fields.newFileKey } : {}),
            ...(fields.includeFileName ? { fileName: fields.newFileName } : {}),
            ...(fields.includeFileSize ? { fileSize: fields.newFileSize } : {}),
          };

          // Mock DynamoDB: return content item on GetCommand, valid category for categoryId updates
          const dynamo = createMockDynamoClientWithCategory(
            originalItem,
            { categoryId: fields.newCategoryId, name: fields.newCategoryName },
          );
          const s3 = createMockS3Client();

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(true);
          expect(result.item).toBeDefined();
          const updated = result.item!;

          // ── Provided fields should be updated to new values ──
          if (fields.includeTitle) {
            expect(updated.title).toBe(fields.newTitle);
          } else {
            expect(updated.title).toBe(originalItem.title);
          }

          if (fields.includeDescription) {
            expect(updated.description).toBe(fields.newDescription);
          } else {
            expect(updated.description).toBe(originalItem.description);
          }

          if (fields.includeCategoryId) {
            expect(updated.categoryId).toBe(fields.newCategoryId);
            expect(updated.categoryName).toBe(fields.newCategoryName);
          } else {
            expect(updated.categoryId).toBe(originalItem.categoryId);
            expect(updated.categoryName).toBe(originalItem.categoryName);
          }

          if (fields.includeVideoUrl) {
            expect(updated.videoUrl).toBe(fields.newVideoUrl);
          } else {
            // videoUrl not provided → retain original (may be undefined)
            expect(updated.videoUrl).toBe(originalItem.videoUrl);
          }

          if (fields.includeFileKey) {
            expect(updated.fileKey).toBe(fields.newFileKey);
          } else {
            expect(updated.fileKey).toBe(originalItem.fileKey);
          }

          if (fields.includeFileName) {
            expect(updated.fileName).toBe(fields.newFileName);
          } else {
            expect(updated.fileName).toBe(originalItem.fileName);
          }

          if (fields.includeFileSize) {
            expect(updated.fileSize).toBe(fields.newFileSize);
          } else {
            expect(updated.fileSize).toBe(originalItem.fileSize);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 3: 编辑输入校验正确性 ────────────────────────
// 对于任何编辑请求中提供的字段值：title 为空或超过 100 字符时应被拒绝；
// description 为空或超过 2000 字符时应被拒绝；categoryId 不存在于 ContentCategories 表时应被拒绝；
// videoUrl 非空且非合法 URL 时应被拒绝。合法值应通过校验。
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

/** Arbitrary for an invalid title: empty string or >100 chars */
const invalidTitleArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 101, maxLength: 300 }),
);

/** Arbitrary for a valid title: 1~100 non-empty-trimmed chars */
const validTitleArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/** Arbitrary for an invalid description: empty string or >2000 chars */
const invalidDescriptionArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 2001, maxLength: 3000 }),
);

/** Arbitrary for a valid description: 1~2000 non-empty-trimmed chars */
const validDescriptionArb = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);

/** Arbitrary for an invalid video URL: non-empty string that is not a valid http/https URL */
const invalidVideoUrlArb = fc.oneof(
  fc.constant('not-a-url'),
  fc.constant('ftp://example.com/video'),
  fc.constant('://missing-protocol'),
  fc.constant('just some random text'),
  fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
    try {
      const u = new URL(s);
      return u.protocol !== 'http:' && u.protocol !== 'https:';
    } catch {
      return true; // not a valid URL at all → invalid
    }
  }),
);

/** Arbitrary for a valid video URL */
const validVideoUrlArb = fc.webUrl({ withFragments: false, withQueryParameters: false });

describe('Feature: content-edit, Property 3: 编辑输入校验正确性', () => {
  // Sub-property 3a: invalid title → rejected with INVALID_CONTENT_TITLE
  it('title 为空或超过 100 字符时被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidTitleArb,
        editableStatusArb,
        async (badTitle, status) => {
          const uploaderId = 'user-owner';
          const item = makeContentItem(uploaderId, status);
          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            title: badTitle,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(false);
          expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_TITLE);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Sub-property 3b: invalid description → rejected with INVALID_CONTENT_DESCRIPTION
  it('description 为空或超过 2000 字符时被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidDescriptionArb,
        editableStatusArb,
        async (badDesc, status) => {
          const uploaderId = 'user-owner';
          const item = makeContentItem(uploaderId, status);
          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            description: badDesc,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(false);
          expect(result.error!.code).toBe(ErrorCodes.INVALID_CONTENT_DESCRIPTION);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Sub-property 3c: categoryId not found → rejected with CATEGORY_NOT_FOUND
  it('categoryId 不存在时被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        editableStatusArb,
        async (randomCategoryId, status) => {
          const uploaderId = 'user-owner';
          const item = makeContentItem(uploaderId, status);

          // Mock DynamoDB: content item exists, but category lookup returns undefined
          const dynamo = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const cmdName = cmd.constructor.name;
              if (cmdName === 'GetCommand') {
                const tableName = cmd.input?.TableName as string;
                if (tableName?.includes('Categories') || tableName?.includes('categories')) {
                  return Promise.resolve({ Item: undefined }); // category not found
                }
                return Promise.resolve({ Item: item });
              }
              if (cmdName === 'UpdateCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            categoryId: randomCategoryId,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(false);
          expect(result.error!.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Sub-property 3d: videoUrl non-empty and not valid URL → rejected with INVALID_VIDEO_URL
  it('videoUrl 非空且非合法 URL 时被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidVideoUrlArb,
        editableStatusArb,
        async (badUrl, status) => {
          const uploaderId = 'user-owner';
          const item = makeContentItem(uploaderId, status);
          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            videoUrl: badUrl,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(false);
          expect(result.error!.code).toBe(ErrorCodes.INVALID_VIDEO_URL);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Sub-property 3e: valid values pass validation
  it('合法值通过校验', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTitleArb,
        validDescriptionArb,
        validVideoUrlArb,
        categoryIdArb,
        categoryNameArb,
        editableStatusArb,
        async (goodTitle, goodDesc, goodVideoUrl, catId, catName, status) => {
          const uploaderId = 'user-owner';
          const item = makeContentItem(uploaderId, status);
          const dynamo = createMockDynamoClientWithCategory(
            item,
            { categoryId: catId, name: catName },
          );
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            title: goodTitle,
            description: goodDesc,
            categoryId: catId,
            videoUrl: goodVideoUrl,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(true);
          expect(result.item).toBeDefined();
          expect(result.item!.title).toBe(goodTitle);
          expect(result.item!.description).toBe(goodDesc);
          expect(result.item!.categoryId).toBe(catId);
          expect(result.item!.videoUrl).toBe(goodVideoUrl);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 4: 文件替换时旧文件删除 ──────────────────────
// 对于任何编辑操作，当请求中提供了新的 fileKey 且与原 fileKey 不同时，
// 系统应对旧 fileKey 发起 S3 DeleteObject 调用。当 fileKey 未变更时，不应发起删除调用。
// **Validates: Requirements 3.2**

describe('Feature: content-edit, Property 4: 文件替换时旧文件删除', () => {
  it('新 fileKey 与原 fileKey 不同时发起 S3 DeleteObject 调用；fileKey 未变更时不发起删除调用', async () => {
    await fc.assert(
      fc.asyncProperty(
        fileKeyArb,
        fileKeyArb,
        editableStatusArb,
        async (originalFileKey, newFileKey, status) => {
          const uploaderId = 'user-owner';
          const item: ContentItem = {
            ...makeContentItem(uploaderId, status),
            fileKey: originalFileKey,
          };

          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: 'content-1',
            userId: uploaderId,
            fileKey: newFileKey,
            fileName: 'new-file.pptx',
            fileSize: 2048,
          };

          const result = await editContentItem(input, dynamo, s3, tables, bucket);

          expect(result.success).toBe(true);

          if (newFileKey !== originalFileKey) {
            // fileKey changed → S3 DeleteObject should be called for the old key
            expect(s3.send).toHaveBeenCalled();
            const deleteCall = s3.send.mock.calls.find(
              (call: any[]) => call[0].constructor.name === 'DeleteObjectCommand',
            );
            expect(deleteCall).toBeDefined();
            expect(deleteCall![0].input).toEqual({
              Bucket: bucket,
              Key: originalFileKey,
            });
          } else {
            // fileKey unchanged → no S3 DeleteObject call
            const deleteCalls = s3.send.mock.calls.filter(
              (call: any[]) => call[0].constructor.name === 'DeleteObjectCommand',
            );
            expect(deleteCalls.length).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 5: 编辑后状态重置不变量 ──────────────────────
// 对于任何成功的编辑操作，编辑后的 ContentItem 应满足：
// status 为 pending，rejectReason/reviewerId/reviewedAt 被清除，updatedAt 被更新，
// 且 likeCount、commentCount、reservationCount 与编辑前完全一致。
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.3**

describe('Feature: content-edit, Property 5: 编辑后状态重置不变量', () => {
  it('编辑后 status 为 pending，rejectReason/reviewerId/reviewedAt 被清除，updatedAt 被更新，likeCount/commentCount/reservationCount 不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        contentItemArb,
        titleArb,
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        async (baseItem, newTitle, likeCount, commentCount) => {
          // Build a content item with random counter values (reservationCount must be 0 for edit to succeed)
          const item: ContentItem = {
            ...baseItem,
            likeCount,
            commentCount,
            reservationCount: 0,
            // If rejected, add review fields that should be cleared after edit
            ...(baseItem.status === 'rejected'
              ? { rejectReason: 'Some reason', reviewerId: 'admin-99', reviewedAt: '2024-06-01T00:00:00.000Z' }
              : {}),
          };

          const dynamo = createMockDynamoClient(item);
          const s3 = createMockS3Client();

          const input: EditContentItemInput = {
            contentId: item.contentId,
            userId: item.uploaderId, // same user → passes permission check
            title: newTitle,
          };

          const beforeTime = new Date().toISOString();
          const result = await editContentItem(input, dynamo, s3, tables, bucket);
          const afterTime = new Date().toISOString();

          // Edit should succeed (userId === uploaderId, status ∈ {pending, rejected})
          expect(result.success).toBe(true);
          expect(result.item).toBeDefined();
          const updated = result.item!;

          // Requirement 4.1: status reset to pending
          expect(updated.status).toBe('pending');

          // Requirement 4.2: rejectReason/reviewerId/reviewedAt cleared
          expect(updated.rejectReason).toBeUndefined();
          expect(updated.reviewerId).toBeUndefined();
          expect(updated.reviewedAt).toBeUndefined();

          // Requirement 4.3: updatedAt is updated (between beforeTime and afterTime)
          expect(updated.updatedAt).toBeDefined();
          expect(updated.updatedAt >= beforeTime).toBe(true);
          expect(updated.updatedAt <= afterTime).toBe(true);

          // Requirement 4.4 + 7.3: likeCount, commentCount, reservationCount unchanged
          expect(updated.likeCount).toBe(likeCount);
          expect(updated.commentCount).toBe(commentCount);
          expect(updated.reservationCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 6: 上传者可查看自己的非 approved 内容 ────────
// 对于任何 ContentItem 和用户，当 userId === uploaderId 时，getContentDetail 应返回该内容（无论 status 为何值）；
// 当 userId !== uploaderId 且 status !== approved 时，应返回 CONTENT_NOT_FOUND。
// **Validates: Requirements 6.3**

const detailTables = {
  contentItemsTable: 'ContentItems',
  reservationsTable: 'Reservations',
  likesTable: 'Likes',
};

/**
 * Create a mock DynamoDB client for getContentDetail.
 * - GetCommand on contentItemsTable returns the provided ContentItem
 * - GetCommand on reservationsTable / likesTable returns empty (no reservation/like)
 */
function createMockDetailDynamoClient(contentItem: ContentItem | undefined) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        const tableName = cmd.input?.TableName as string;
        if (tableName === detailTables.reservationsTable || tableName === detailTables.likesTable) {
          return Promise.resolve({ Item: undefined });
        }
        // contentItemsTable
        return Promise.resolve({ Item: contentItem });
      }
      return Promise.resolve({});
    }),
  } as any;
}

describe('Feature: content-edit, Property 6: 上传者可查看自己的非 approved 内容', () => {
  it('userId === uploaderId → getContentDetail 返回内容（无论 status）；userId !== uploaderId AND status !== approved → 返回 CONTENT_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        statusArb,
        async (userId, uploaderId, status) => {
          const item: ContentItem = {
            contentId: 'content-detail-1',
            title: 'Detail Test',
            description: 'Detail Description',
            categoryId: 'cat-1',
            categoryName: 'Tech',
            uploaderId,
            uploaderNickname: 'Uploader',
            uploaderRole: 'Speaker',
            fileKey: 'content/user/file.pptx',
            fileName: 'file.pptx',
            fileSize: 1024,
            status,
            likeCount: 5,
            commentCount: 3,
            reservationCount: 2,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          };

          const dynamo = createMockDetailDynamoClient(item);

          const result = await getContentDetail(
            'content-detail-1',
            userId,
            dynamo,
            detailTables,
          );

          if (userId === uploaderId) {
            // Uploader can always view their own content regardless of status
            expect(result.success).toBe(true);
            expect(result.item).toBeDefined();
            expect(result.item!.contentId).toBe('content-detail-1');
            expect(result.item!.status).toBe(status);
          } else if (status === 'approved') {
            // Non-uploader can view approved content
            expect(result.success).toBe(true);
            expect(result.item).toBeDefined();
            expect(result.item!.status).toBe('approved');
          } else {
            // Non-uploader cannot view non-approved content → CONTENT_NOT_FOUND
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
