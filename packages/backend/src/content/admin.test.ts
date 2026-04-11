import { describe, it, expect, vi } from 'vitest';
import {
  reviewContent,
  listAllContent,
  deleteContent,
  createCategory,
  updateCategory,
  deleteCategory,
  listCategories,
} from './admin';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock helpers ──────────────────────────────────────────

function makeContentItem(overrides?: Partial<Record<string, any>>) {
  return {
    contentId: 'content-1',
    title: 'Test Content',
    description: 'A test content item',
    categoryId: 'cat-1',
    categoryName: 'Category 1',
    uploaderId: 'uploader-1',
    uploaderNickname: 'Uploader',
    uploaderRole: 'Speaker',
    fileKey: 'content/uploader-1/abc/test.pdf',
    fileName: 'test.pdf',
    fileSize: 1024,
    status: 'pending',
    likeCount: 0,
    commentCount: 0,
    reservationCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockDynamoClient(overrides?: {
  getResult?: any;
  queryResult?: any;
  scanResult?: any;
}) {
  const getResult = overrides?.getResult ?? {};
  const queryResult = overrides?.queryResult ?? { Items: [], LastEvaluatedKey: undefined };
  const scanResult = overrides?.scanResult ?? { Items: [], LastEvaluatedKey: undefined };

  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'GetCommand') return Promise.resolve(getResult);
      if (name === 'QueryCommand') return Promise.resolve(queryResult);
      if (name === 'ScanCommand') return Promise.resolve(scanResult);
      // PutCommand / UpdateCommand / DeleteCommand / BatchWriteCommand
      return Promise.resolve({});
    }),
  } as any;
}

function createMockS3Client() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const contentItemsTable = 'ContentItems';
const categoriesTable = 'ContentCategories';
const deleteTables = {
  contentItemsTable: 'ContentItems',
  commentsTable: 'ContentComments',
  likesTable: 'ContentLikes',
  reservationsTable: 'ContentReservations',
};
const bucket = 'test-bucket';

// ─── reviewContent ─────────────────────────────────────────

describe('reviewContent', () => {
  it('should approve content successfully (status→approved, reviewerId set)', async () => {
    const item = makeContentItem({ status: 'pending' });
    const dynamo = createMockDynamoClient({ getResult: { Item: item } });

    const result = await reviewContent(
      { contentId: 'content-1', reviewerId: 'admin-1', action: 'approve' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.item?.status).toBe('approved');
    expect(result.item?.reviewerId).toBe('admin-1');
    expect(result.item?.reviewedAt).toBeDefined();

    // Verify UpdateCommand was called
    const calls = dynamo.send.mock.calls;
    const updateCall = calls.find((c: any) => c[0].constructor.name === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':approved']).toBe('approved');
  });

  it('should reject content successfully (status→rejected, rejectReason set)', async () => {
    const item = makeContentItem({ status: 'pending' });
    const dynamo = createMockDynamoClient({ getResult: { Item: item } });

    const result = await reviewContent(
      { contentId: 'content-1', reviewerId: 'admin-1', action: 'reject', rejectReason: 'Low quality' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.item?.status).toBe('rejected');
    expect(result.item?.rejectReason).toBe('Low quality');
    expect(result.item?.reviewerId).toBe('admin-1');
    expect(result.item?.reviewedAt).toBeDefined();
  });

  it('should return CONTENT_ALREADY_REVIEWED for already approved content', async () => {
    const item = makeContentItem({ status: 'approved' });
    const dynamo = createMockDynamoClient({ getResult: { Item: item } });

    const result = await reviewContent(
      { contentId: 'content-1', reviewerId: 'admin-1', action: 'approve' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_ALREADY_REVIEWED);
  });

  it('should return CONTENT_ALREADY_REVIEWED for already rejected content', async () => {
    const item = makeContentItem({ status: 'rejected' });
    const dynamo = createMockDynamoClient({ getResult: { Item: item } });

    const result = await reviewContent(
      { contentId: 'content-1', reviewerId: 'admin-1', action: 'reject', rejectReason: 'Bad' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_ALREADY_REVIEWED);
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    const dynamo = createMockDynamoClient({ getResult: { Item: undefined } });

    const result = await reviewContent(
      { contentId: 'nonexistent', reviewerId: 'admin-1', action: 'approve' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });
});


// ─── listAllContent ────────────────────────────────────────

describe('listAllContent', () => {
  it('should filter by status using GSI query', async () => {
    const items = [
      makeContentItem({ contentId: 'c1', status: 'pending', createdAt: '2024-01-03T00:00:00Z' }),
      makeContentItem({ contentId: 'c2', status: 'pending', createdAt: '2024-01-02T00:00:00Z' }),
    ];
    const dynamo = createMockDynamoClient({
      queryResult: { Items: items, LastEvaluatedKey: undefined },
    });

    const result = await listAllContent(
      { status: 'pending' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);

    // Verify QueryCommand was used with the status GSI
    const queryCall = dynamo.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'QueryCommand',
    );
    expect(queryCall).toBeDefined();
    expect(queryCall![0].input.IndexName).toBe('status-createdAt-index');
    expect(queryCall![0].input.ExpressionAttributeValues[':status']).toBe('pending');
  });

  it('should return all items when no status filter (Scan)', async () => {
    const items = [
      makeContentItem({ contentId: 'c1', status: 'approved', createdAt: '2024-01-03T00:00:00Z' }),
      makeContentItem({ contentId: 'c2', status: 'pending', createdAt: '2024-01-02T00:00:00Z' }),
      makeContentItem({ contentId: 'c3', status: 'rejected', createdAt: '2024-01-01T00:00:00Z' }),
    ];
    const dynamo = createMockDynamoClient({
      scanResult: { Items: items, LastEvaluatedKey: undefined },
    });

    const result = await listAllContent({}, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(3);

    // Verify ScanCommand was used
    const scanCall = dynamo.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'ScanCommand',
    );
    expect(scanCall).toBeDefined();
  });

  it('should sort items by createdAt descending when no filter', async () => {
    const items = [
      makeContentItem({ contentId: 'c1', createdAt: '2024-01-01T00:00:00Z' }),
      makeContentItem({ contentId: 'c3', createdAt: '2024-01-03T00:00:00Z' }),
      makeContentItem({ contentId: 'c2', createdAt: '2024-01-02T00:00:00Z' }),
    ];
    const dynamo = createMockDynamoClient({
      scanResult: { Items: items, LastEvaluatedKey: undefined },
    });

    const result = await listAllContent({}, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items![0].contentId).toBe('c3');
    expect(result.items![1].contentId).toBe('c2');
    expect(result.items![2].contentId).toBe('c1');
  });
});

// ─── deleteContent ─────────────────────────────────────────

describe('deleteContent', () => {
  it('should cascade delete comments, likes, reservations, S3 file, and content item', async () => {
    const item = makeContentItem();
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: item });
        }
        if (name === 'QueryCommand') {
          // Return some associated records for batch deletion
          return Promise.resolve({ Items: [{ commentId: 'cm1' }, { pk: 'pk1' }], LastEvaluatedKey: undefined });
        }
        return Promise.resolve({});
      }),
    } as any;
    const s3 = createMockS3Client();

    const result = await deleteContent('content-1', dynamo, s3, deleteTables, bucket);

    expect(result.success).toBe(true);

    // Verify S3 DeleteObjectCommand was called
    const s3Calls = s3.send.mock.calls;
    expect(s3Calls.length).toBe(1);
    expect(s3Calls[0][0].constructor.name).toBe('DeleteObjectCommand');

    // Verify DynamoDB calls include: GetCommand, 3x QueryCommand (comments, likes, reservations),
    // 3x BatchWriteCommand, and 1x DeleteCommand for the content item
    const dynamoCalls = dynamo.send.mock.calls;
    const getCall = dynamoCalls.find((c: any) => c[0].constructor.name === 'GetCommand');
    expect(getCall).toBeDefined();

    const queryCalls = dynamoCalls.filter((c: any) => c[0].constructor.name === 'QueryCommand');
    expect(queryCalls.length).toBe(3); // comments, likes, reservations

    const batchCalls = dynamoCalls.filter((c: any) => c[0].constructor.name === 'BatchWriteCommand');
    expect(batchCalls.length).toBe(3); // one per table

    const deleteCall = dynamoCalls.find((c: any) => c[0].constructor.name === 'DeleteCommand');
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key.contentId).toBe('content-1');
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    const dynamo = createMockDynamoClient({ getResult: { Item: undefined } });
    const s3 = createMockS3Client();

    const result = await deleteContent('nonexistent', dynamo, s3, deleteTables, bucket);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });
});


// ─── Category CRUD ─────────────────────────────────────────

describe('createCategory', () => {
  it('should create a category with ULID', async () => {
    const dynamo = createMockDynamoClient();

    const result = await createCategory('New Category', dynamo, categoriesTable);

    expect(result.success).toBe(true);
    expect(result.category).toBeDefined();
    expect(result.category!.name).toBe('New Category');
    expect(result.category!.categoryId).toBeDefined();
    expect(result.category!.categoryId.length).toBeGreaterThan(0);
    expect(result.category!.createdAt).toBeDefined();

    // Verify PutCommand was called
    const putCall = dynamo.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall).toBeDefined();
    expect(putCall![0].input.TableName).toBe(categoriesTable);
  });
});

describe('updateCategory', () => {
  it('should update category name', async () => {
    const existingCategory = { categoryId: 'cat-1', name: 'Old Name', createdAt: '2024-01-01T00:00:00Z' };
    const dynamo = createMockDynamoClient({ getResult: { Item: existingCategory } });

    const result = await updateCategory('cat-1', 'New Name', dynamo, categoriesTable);

    expect(result.success).toBe(true);
    expect(result.category!.name).toBe('New Name');
    expect(result.category!.categoryId).toBe('cat-1');

    // Verify UpdateCommand was called
    const updateCall = dynamo.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':name']).toBe('New Name');
  });

  it('should return CATEGORY_NOT_FOUND for non-existent category', async () => {
    const dynamo = createMockDynamoClient({ getResult: { Item: undefined } });

    const result = await updateCategory('nonexistent', 'Name', dynamo, categoriesTable);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
  });
});

describe('deleteCategory', () => {
  it('should delete an existing category', async () => {
    const existingCategory = { categoryId: 'cat-1', name: 'Category', createdAt: '2024-01-01T00:00:00Z' };
    const dynamo = createMockDynamoClient({ getResult: { Item: existingCategory } });

    const result = await deleteCategory('cat-1', dynamo, categoriesTable);

    expect(result.success).toBe(true);

    // Verify DeleteCommand was called
    const deleteCall = dynamo.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key.categoryId).toBe('cat-1');
  });

  it('should return CATEGORY_NOT_FOUND for non-existent category', async () => {
    const dynamo = createMockDynamoClient({ getResult: { Item: undefined } });

    const result = await deleteCategory('nonexistent', dynamo, categoriesTable);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CATEGORY_NOT_FOUND);
  });
});

describe('listCategories', () => {
  it('should return all categories sorted by createdAt', async () => {
    const categories = [
      { categoryId: 'cat-3', name: 'C', createdAt: '2024-01-03T00:00:00Z' },
      { categoryId: 'cat-1', name: 'A', createdAt: '2024-01-01T00:00:00Z' },
      { categoryId: 'cat-2', name: 'B', createdAt: '2024-01-02T00:00:00Z' },
    ];
    const dynamo = createMockDynamoClient({
      scanResult: { Items: categories },
    });

    const result = await listCategories(dynamo, categoriesTable);

    expect(result.success).toBe(true);
    expect(result.categories).toHaveLength(3);
    // Should be sorted by createdAt ascending
    expect(result.categories[0].categoryId).toBe('cat-1');
    expect(result.categories[1].categoryId).toBe('cat-2');
    expect(result.categories[2].categoryId).toBe('cat-3');
  });

  it('should return empty array when no categories exist', async () => {
    const dynamo = createMockDynamoClient({
      scanResult: { Items: [] },
    });

    const result = await listCategories(dynamo, categoriesTable);

    expect(result.success).toBe(true);
    expect(result.categories).toHaveLength(0);
  });
});
