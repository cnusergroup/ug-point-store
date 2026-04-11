import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ Item: { nickname: 'TestUser', roles: ['Speaker'] } }) }) },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'GetCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

// Mock content modules
vi.mock('./upload', () => ({
  getContentUploadUrl: vi.fn(),
  createContentItem: vi.fn(),
}));
vi.mock('./list', () => ({
  listContentItems: vi.fn(),
  getContentDetail: vi.fn(),
}));
vi.mock('./comment', () => ({
  addComment: vi.fn(),
  listComments: vi.fn(),
}));
vi.mock('./like', () => ({
  toggleLike: vi.fn(),
}));
vi.mock('./reservation', () => ({
  createReservation: vi.fn(),
  getDownloadUrl: vi.fn(),
}));
vi.mock('./edit', () => ({
  editContentItem: vi.fn(),
}));
vi.mock('./admin', () => ({
  listCategories: vi.fn(),
}));

// Mock auth middleware
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'user-123',
        email: 'user@example.com',
        roles: ['Speaker'],
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { getContentUploadUrl, createContentItem } from './upload';
import { listContentItems, getContentDetail } from './list';
import { addComment, listComments } from './comment';
import { toggleLike } from './like';
import { createReservation, getDownloadUrl } from './reservation';
import { editContentItem } from './edit';
import { listCategories } from './admin';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    body: null,
    headers: { Authorization: 'Bearer mock-token' },
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    ...overrides,
  };
}

describe('Content Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('General routing', () => {
    it('returns 200 for OPTIONS preflight', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/content' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('returns 404 for unknown routes', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/unknown/path/here' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
    });

    it('returns 500 on unexpected errors', async () => {
      vi.mocked(listContentItems).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('includes CORS headers in responses', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/content' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('POST /api/content/upload-url', () => {
    it('routes to getContentUploadUrl with correct params', async () => {
      vi.mocked(getContentUploadUrl).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.presigned', fileKey: 'content/user-123/abc/doc.pdf' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content/upload-url',
        body: JSON.stringify({ fileName: 'doc.pdf', contentType: 'application/pdf' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getContentUploadUrl).toHaveBeenCalledWith(
        { userId: 'user-123', fileName: 'doc.pdf', contentType: 'application/pdf' },
        expect.anything(),
        '',
      );
    });

    it('returns 400 when fileName is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content/upload-url',
        body: JSON.stringify({ contentType: 'application/pdf' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('POST /api/content', () => {
    it('routes to createContentItem with correct params', async () => {
      vi.mocked(createContentItem).mockResolvedValue({
        success: true,
        item: { contentId: 'c1', title: 'Test', status: 'pending' } as any,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content',
        body: JSON.stringify({
          title: 'Test',
          description: 'Desc',
          categoryId: 'cat-1',
          fileKey: 'content/user-123/abc/doc.pdf',
          fileName: 'doc.pdf',
          fileSize: 1024,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createContentItem).toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content',
        body: JSON.stringify({ title: 'Test' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /api/content', () => {
    it('routes to listContentItems and returns results', async () => {
      vi.mocked(listContentItems).mockResolvedValue({ success: true, items: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ items: [], lastKey: undefined });
    });

    it('passes categoryId, pageSize and lastKey query params', async () => {
      vi.mocked(listContentItems).mockResolvedValue({ success: true, items: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/content',
        queryStringParameters: { categoryId: 'cat-1', pageSize: '10', lastKey: 'some-key' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listContentItems).toHaveBeenCalledWith(
        { categoryId: 'cat-1', pageSize: 10, lastKey: 'some-key' },
        expect.anything(),
        '',
      );
    });
  });

  describe('GET /api/content/categories', () => {
    it('routes to listCategories and returns results', async () => {
      vi.mocked(listCategories).mockResolvedValue({ categories: [{ categoryId: 'c1', name: 'Tech', createdAt: '2024-01-01' }] });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/categories' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).categories).toHaveLength(1);
    });
  });

  describe('GET /api/content/:id', () => {
    it('routes to getContentDetail with correct params', async () => {
      vi.mocked(getContentDetail).mockResolvedValue({
        success: true,
        item: { contentId: 'content-1', title: 'Test' } as any,
        hasReserved: false,
        hasLiked: true,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/content-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.hasLiked).toBe(true);
      expect(body.hasReserved).toBe(false);
      expect(getContentDetail).toHaveBeenCalledWith(
        'content-1',
        'user-123',
        expect.anything(),
        expect.objectContaining({ contentItemsTable: '', reservationsTable: '', likesTable: '' }),
      );
    });

    it('returns error when content not found', async () => {
      vi.mocked(getContentDetail).mockResolvedValue({
        success: false,
        error: { code: 'CONTENT_NOT_FOUND', message: '内容不存在' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/nonexistent' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('POST /api/content/:id/comments', () => {
    it('routes to addComment with correct params', async () => {
      vi.mocked(addComment).mockResolvedValue({
        success: true,
        comment: { commentId: 'cm1', content: 'Great!' } as any,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content/content-1/comments',
        body: JSON.stringify({ content: 'Great!' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(addComment).toHaveBeenCalled();
    });

    it('returns 400 when content field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/content/content-1/comments',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /api/content/:id/comments', () => {
    it('routes to listComments and returns results', async () => {
      vi.mocked(listComments).mockResolvedValue({ success: true, comments: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/content-1/comments' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ comments: [], lastKey: undefined });
    });
  });

  describe('POST /api/content/:id/like', () => {
    it('routes to toggleLike and returns result', async () => {
      vi.mocked(toggleLike).mockResolvedValue({ success: true, liked: true, likeCount: 5 });
      const event = makeEvent({ httpMethod: 'POST', path: '/api/content/content-1/like' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.liked).toBe(true);
      expect(body.likeCount).toBe(5);
    });
  });

  describe('POST /api/content/:id/reserve', () => {
    it('routes to createReservation and returns result', async () => {
      vi.mocked(createReservation).mockResolvedValue({ success: true });
      const event = makeEvent({ httpMethod: 'POST', path: '/api/content/content-1/reserve' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).success).toBe(true);
    });

    it('returns error when reservation fails', async () => {
      vi.mocked(createReservation).mockResolvedValue({
        success: false,
        error: { code: 'CONTENT_NOT_FOUND', message: '内容不存在' },
      });
      const event = makeEvent({ httpMethod: 'POST', path: '/api/content/content-2/reserve' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('GET /api/content/:id/download', () => {
    it('routes to getDownloadUrl and returns result', async () => {
      vi.mocked(getDownloadUrl).mockResolvedValue({
        success: true,
        downloadUrl: 'https://s3.presigned/download',
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/content-1/download' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).downloadUrl).toBe('https://s3.presigned/download');
    });

    it('returns error when user has no reservation', async () => {
      vi.mocked(getDownloadUrl).mockResolvedValue({
        success: false,
        error: { code: 'RESERVATION_REQUIRED', message: '需先完成使用预约才能下载' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/content/content-1/download' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('RESERVATION_REQUIRED');
    });
  });

  describe('PUT /api/content/:id', () => {
    it('routes to editContentItem and returns updated item', async () => {
      vi.mocked(editContentItem).mockResolvedValue({
        success: true,
        item: { contentId: 'content-1', title: 'Updated Title', status: 'pending' } as any,
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/content/content-1',
        body: JSON.stringify({ title: 'Updated Title' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.item.title).toBe('Updated Title');
      expect(editContentItem).toHaveBeenCalled();
    });

    it('returns 400 when request body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/content/content-1',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when editContentItem fails', async () => {
      vi.mocked(editContentItem).mockResolvedValue({
        success: false,
        error: { code: 'CONTENT_NOT_EDITABLE', message: '该内容当前状态不允许编辑' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/content/content-1',
        body: JSON.stringify({ title: 'New Title' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('CONTENT_NOT_EDITABLE');
    });
  });
});
