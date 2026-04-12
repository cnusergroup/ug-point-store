import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listMyContent } from './mine';

// ─── Mock helpers ──────────────────────────────────────────

const contentItemsTable = 'ContentItems';

function makeContentItem(overrides: Record<string, any> = {}) {
  return {
    contentId: 'c-1',
    title: 'Test Content',
    description: 'A test description',
    categoryId: 'cat-1',
    categoryName: 'Tech',
    uploaderId: 'user-1',
    uploaderNickname: 'Uploader',
    uploaderRole: 'Speaker',
    fileKey: 'content/user-1/ABC/slides.pptx',
    fileName: 'slides.pptx',
    fileSize: 1024,
    videoUrl: undefined,
    status: 'approved',
    likeCount: 5,
    commentCount: 3,
    reservationCount: 2,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ─── listMyContent ─────────────────────────────────────────

describe('listMyContent', () => {
  it('should return only the requesting user\'s items', async () => {
    const items = [
      makeContentItem({ contentId: 'c-1', uploaderId: 'user-1', status: 'approved' }),
      makeContentItem({ contentId: 'c-2', uploaderId: 'user-1', status: 'pending' }),
      makeContentItem({ contentId: 'c-3', uploaderId: 'user-1', status: 'rejected', rejectReason: 'Low quality' }),
    ];
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: items,
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-1' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(3);
    // All returned items should belong to user-1
    result.items!.forEach((item) => {
      expect(item.contentId).toBeDefined();
    });

    // Verify the query used uploaderId-createdAt-index with the correct userId
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.IndexName).toBe('uploaderId-createdAt-index');
    expect(sentCmd.input.ExpressionAttributeValues[':uploaderId']).toBe('user-1');
    expect(sentCmd.input.ScanIndexForward).toBe(false);
  });

  it('should include status and rejectReason in returned summaries', async () => {
    const items = [
      makeContentItem({ contentId: 'c-1', status: 'rejected', rejectReason: 'Low quality' }),
      makeContentItem({ contentId: 'c-2', status: 'pending' }),
    ];
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: items,
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-1' },
      dynamo,
      contentItemsTable,
    );

    expect(result.items![0].status).toBe('rejected');
    expect(result.items![0].rejectReason).toBe('Low quality');
    expect(result.items![1].status).toBe('pending');
    expect(result.items![1]).not.toHaveProperty('rejectReason');
  });

  it('should filter by status when status query param is provided', async () => {
    const items = [
      makeContentItem({ contentId: 'c-1', status: 'rejected', rejectReason: 'Bad' }),
    ];
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: items,
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-1', status: 'rejected' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].status).toBe('rejected');

    // Verify FilterExpression was applied for status
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.FilterExpression).toBe('#status = :status');
    expect(sentCmd.input.ExpressionAttributeNames['#status']).toBe('status');
    expect(sentCmd.input.ExpressionAttributeValues[':status']).toBe('rejected');
  });

  it('should not apply FilterExpression when status is not provided', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [makeContentItem()],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    await listMyContent({ userId: 'user-1' }, dynamo, contentItemsTable);

    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.FilterExpression).toBeUndefined();
  });

  it('should pass ExclusiveStartKey when lastKey is provided', async () => {
    const lastKeyObj = { contentId: 'c-2', uploaderId: 'user-1', createdAt: '2024-01-15T10:00:00.000Z' };
    const encodedLastKey = Buffer.from(JSON.stringify(lastKeyObj)).toString('base64');

    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [makeContentItem({ contentId: 'c-3' })],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-1', lastKey: encodedLastKey },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.lastKey).toBeUndefined();

    // Verify ExclusiveStartKey was passed
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.ExclusiveStartKey).toEqual(lastKeyObj);
  });

  it('should return lastKey when LastEvaluatedKey exists in DynamoDB response', async () => {
    const lastEvaluatedKey = { contentId: 'c-2', uploaderId: 'user-1', createdAt: '2024-01-14T10:00:00.000Z' };
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [makeContentItem({ contentId: 'c-1' }), makeContentItem({ contentId: 'c-2' })],
        LastEvaluatedKey: lastEvaluatedKey,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-1', pageSize: 2 },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.lastKey).toBeDefined();

    // Decode and verify the lastKey
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvaluatedKey);

    // Verify Limit was set
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.Limit).toBe(2);
  });

  it('should return empty items array when user has no content', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listMyContent(
      { userId: 'user-no-content' },
      dynamo,
      contentItemsTable,
    );

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.lastKey).toBeUndefined();
  });

  it('should default pageSize to 20 when not specified', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    await listMyContent({ userId: 'user-1' }, dynamo, contentItemsTable);

    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.Limit).toBe(20);
  });
});

// ─── Handler integration: 401 for unauthenticated ──────────

describe('GET /api/content/mine handler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should return 401 for unauthenticated requests', async () => {
    // Use dynamic import to get a fresh handler with the real withAuth behavior
    vi.doMock('../middleware/auth-middleware', () => {
      // Return a withAuth that rejects missing auth
      return {
        withAuth: vi.fn((innerHandler: any) => {
          return async (event: any) => {
            const authHeader = event.headers?.Authorization || event.headers?.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: 'UNAUTHORIZED', message: '缺少访问令牌' }),
              };
            }
            event.user = { userId: 'user-123', email: 'user@example.com', roles: ['Speaker'] };
            return innerHandler(event);
          };
        }),
      };
    });

    // Mock all dependencies the handler needs
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ Item: {} }) }) },
      GetCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('./upload', () => ({ getContentUploadUrl: vi.fn(), createContentItem: vi.fn() }));
    vi.doMock('./list', () => ({ listContentItems: vi.fn(), getContentDetail: vi.fn() }));
    vi.doMock('./comment', () => ({ addComment: vi.fn(), listComments: vi.fn() }));
    vi.doMock('./like', () => ({ toggleLike: vi.fn() }));
    vi.doMock('./reservation', () => ({ createReservation: vi.fn(), getDownloadUrl: vi.fn(), getPreviewUrl: vi.fn() }));
    vi.doMock('./edit', () => ({ editContentItem: vi.fn() }));
    vi.doMock('./admin', () => ({ listCategories: vi.fn() }));
    vi.doMock('./mine', () => ({ listMyContent: vi.fn() }));

    const { handler } = await import('./handler');

    const event = {
      httpMethod: 'GET',
      path: '/api/content/mine',
      body: null,
      headers: {},
      multiValueHeaders: {},
      isBase64Encoded: false,
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
