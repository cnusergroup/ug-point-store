import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

const { mockDynamoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: mockDynamoSend }) },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'GetCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

// Mock admin modules
vi.mock('./roles', () => ({
  assignRoles: vi.fn(),
}));
vi.mock('./codes', () => ({
  batchGeneratePointsCodes: vi.fn(),
  generateProductCodes: vi.fn(),
  listCodes: vi.fn(),
  disableCode: vi.fn(),
}));
vi.mock('./products', () => ({
  createPointsProduct: vi.fn(),
  createCodeExclusiveProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductStatus: vi.fn(),
}));
vi.mock('./images', () => ({
  getUploadUrl: vi.fn(),
  deleteImage: vi.fn(),
}));
vi.mock('./users', () => ({
  listUsers: vi.fn(),
  setUserStatus: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('./invites', () => ({
  batchGenerateInvites: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock('../claims/review', () => ({
  reviewClaim: vi.fn(),
  listAllClaims: vi.fn(),
}));

// Mock auth middleware - inject user with admin role by default
let mockUserRoles: string[] = ['Admin'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'admin-user-id',
        email: 'admin@example.com',
        roles: mockUserRoles,
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { assignRoles } from './roles';
import { batchGeneratePointsCodes, generateProductCodes, listCodes, disableCode } from './codes';
import { createPointsProduct, createCodeExclusiveProduct, updateProduct, setProductStatus } from './products';
import { getUploadUrl, deleteImage } from './images';
import { listUsers, setUserStatus, deleteUser } from './users';
import { reviewClaim, listAllClaims } from '../claims/review';

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

describe('Admin Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['Admin'];
  });

  describe('General routing', () => {
    it('returns 200 for OPTIONS preflight', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('returns 404 for unknown routes', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/unknown' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
    });

    it('returns 500 on unexpected errors', async () => {
      vi.mocked(listCodes).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('includes CORS headers in responses', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('Admin authorization', () => {
    it('returns 403 when user has no roles (not admin)', async () => {
      mockUserRoles = [];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns 403 when user has only regular roles (not admin)', async () => {
      mockUserRoles = ['Speaker', 'Volunteer'];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('allows access for Admin role', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(listCodes).mockResolvedValue({ codes: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('allows access for SuperAdmin role', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listCodes).mockResolvedValue({ codes: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('PUT /api/admin/users/{id}/roles', () => {
    it('routes to assignRoles with correct params', async () => {
      vi.mocked(assignRoles).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/users/user-123/roles',
        body: JSON.stringify({ roles: ['Speaker', 'Volunteer'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(assignRoles).toHaveBeenCalledWith(
        'user-123',
        ['Speaker', 'Volunteer'],
        expect.anything(),
        '',
        ['Admin'],
      );
    });

    it('returns 400 when roles field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/users/user-123/roles',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when assignRoles fails', async () => {
      vi.mocked(assignRoles).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_ROLES', message: '无效的角色' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/users/user-123/roles',
        body: JSON.stringify({ roles: ['InvalidRole'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_ROLES');
    });
  });

  describe('POST /api/admin/codes/batch-generate', () => {
    it('routes to batchGeneratePointsCodes with correct params', async () => {
      const mockCodes = [{ codeId: 'c1', codeValue: 'ABC123' }];
      vi.mocked(batchGeneratePointsCodes).mockResolvedValue({ success: true, data: mockCodes as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/codes/batch-generate',
        body: JSON.stringify({ count: 5, pointsValue: 100, maxUses: 3 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).codes).toEqual(mockCodes);
      expect(batchGeneratePointsCodes).toHaveBeenCalledWith(
        { count: 5, pointsValue: 100, maxUses: 3 },
        expect.anything(),
        '',
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/codes/batch-generate',
        body: JSON.stringify({ count: 5 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('POST /api/admin/codes/product-code', () => {
    it('routes to generateProductCodes with correct params', async () => {
      const mockCodes = [{ codeId: 'c1', codeValue: 'XYZ789' }];
      vi.mocked(generateProductCodes).mockResolvedValue({ success: true, data: mockCodes as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/codes/product-code',
        body: JSON.stringify({ productId: 'prod-1', count: 10 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(generateProductCodes).toHaveBeenCalledWith(
        { productId: 'prod-1', count: 10 },
        expect.anything(),
        '',
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/codes/product-code',
        body: JSON.stringify({ productId: 'prod-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /api/admin/codes', () => {
    it('routes to listCodes and returns results', async () => {
      vi.mocked(listCodes).mockResolvedValue({ codes: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ codes: [], lastKey: undefined });
    });

    it('passes pageSize and lastKey query params', async () => {
      vi.mocked(listCodes).mockResolvedValue({ codes: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/codes',
        queryStringParameters: {
          pageSize: '20',
          lastKey: JSON.stringify({ codeId: 'last-code' }),
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listCodes).toHaveBeenCalledWith(
        expect.anything(),
        '',
        { pageSize: 20, lastKey: { codeId: 'last-code' } },
      );
    });
  });

  describe('PATCH /api/admin/codes/{id}/disable', () => {
    it('routes to disableCode with correct codeId', async () => {
      vi.mocked(disableCode).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/codes/code-456/disable',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(disableCode).toHaveBeenCalledWith('code-456', expect.anything(), '');
    });

    it('returns error when disableCode fails', async () => {
      vi.mocked(disableCode).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CODE_ID', message: 'Code ID 不能为空' },
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/codes//disable',
      });
      // This won't match the regex since empty id, so 404
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('POST /api/admin/products', () => {
    it('creates a points product', async () => {
      const mockProduct = { productId: 'p1', name: 'Test', type: 'points' };
      vi.mocked(createPointsProduct).mockResolvedValue({ success: true, data: mockProduct as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products',
        body: JSON.stringify({
          type: 'points',
          name: 'Test Product',
          description: 'A test product',
          pointsCost: 100,
          stock: 50,
          allowedRoles: 'all',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createPointsProduct).toHaveBeenCalled();
    });

    it('creates a code_exclusive product', async () => {
      const mockProduct = { productId: 'p2', name: 'Exclusive', type: 'code_exclusive' };
      vi.mocked(createCodeExclusiveProduct).mockResolvedValue({ success: true, data: mockProduct as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products',
        body: JSON.stringify({
          type: 'code_exclusive',
          name: 'Exclusive Product',
          eventInfo: 'Event 2024',
          stock: 10,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createCodeExclusiveProduct).toHaveBeenCalled();
    });

    it('returns 400 for invalid product type', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products',
        body: JSON.stringify({ type: 'invalid', name: 'Bad Product' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when required fields are missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('PUT /api/admin/products/{id}', () => {
    it('routes to updateProduct with correct params', async () => {
      vi.mocked(updateProduct).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/products/prod-1',
        body: JSON.stringify({ name: 'Updated Name', stock: 99 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateProduct).toHaveBeenCalledWith(
        'prod-1',
        { name: 'Updated Name', stock: 99 },
        expect.anything(),
        '',
      );
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/products/prod-1',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/admin/products/{id}/status', () => {
    it('routes to setProductStatus with correct params', async () => {
      vi.mocked(setProductStatus).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/products/prod-1/status',
        body: JSON.stringify({ status: 'inactive' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(setProductStatus).toHaveBeenCalledWith(
        'prod-1',
        'inactive',
        expect.anything(),
        '',
      );
    });

    it('returns 400 when status field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/products/prod-1/status',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('POST /api/admin/products/{id}/upload-url', () => {
    it('returns upload URL when product exists and has room for images', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1', images: [{ key: 'k1', url: '/images/k1' }] },
      });
      vi.mocked(getUploadUrl).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.presigned', key: 'products/prod-1/abc.jpg', url: '/images/products/prod-1/abc.jpg' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-1/upload-url',
        body: JSON.stringify({ fileName: 'photo.jpg', contentType: 'image/jpeg' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.uploadUrl).toBe('https://s3.presigned');
      expect(getUploadUrl).toHaveBeenCalledWith(
        { productId: 'prod-1', fileName: 'photo.jpg', contentType: 'image/jpeg' },
        1,
        expect.anything(),
        '',
      );
    });

    it('passes 0 as currentImageCount when product has no images', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1' },
      });
      vi.mocked(getUploadUrl).mockResolvedValue({
        success: true,
        data: { uploadUrl: 'https://s3.presigned', key: 'k', url: '/images/k' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-1/upload-url',
        body: JSON.stringify({ fileName: 'photo.jpg', contentType: 'image/jpeg' }),
      });
      await handler(event);
      expect(getUploadUrl).toHaveBeenCalledWith(
        expect.anything(),
        0,
        expect.anything(),
        '',
      );
    });

    it('returns 404 when product does not exist', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-999/upload-url',
        body: JSON.stringify({ fileName: 'photo.jpg', contentType: 'image/jpeg' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('returns 400 when fileName is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-1/upload-url',
        body: JSON.stringify({ contentType: 'image/jpeg' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when contentType is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-1/upload-url',
        body: JSON.stringify({ fileName: 'photo.jpg' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns error when getUploadUrl fails (image limit)', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1', images: Array(5).fill({ key: 'k', url: '/u' }) },
      });
      vi.mocked(getUploadUrl).mockResolvedValue({
        success: false,
        error: { code: 'IMAGE_LIMIT_EXCEEDED', message: '图片数量已达上限' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products/prod-1/upload-url',
        body: JSON.stringify({ fileName: 'photo.jpg', contentType: 'image/jpeg' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('IMAGE_LIMIT_EXCEEDED');
    });
  });

  describe('DELETE /api/admin/products/{id}/images/{key}', () => {
    it('deletes image and updates product record', async () => {
      const images = [
        { key: 'products/prod-1/images/abc.jpg', url: '/images/products/prod-1/images/abc.jpg' },
        { key: 'products/prod-1/images/def.png', url: '/images/products/prod-1/images/def.png' },
      ];
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1', images },
      });
      vi.mocked(deleteImage).mockResolvedValue({ success: true });
      vi.mocked(updateProduct).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/products/prod-1/images/abc.jpg',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(deleteImage).toHaveBeenCalledWith(
        'products/prod-1/images/abc.jpg',
        expect.anything(),
        '',
      );
      expect(updateProduct).toHaveBeenCalledWith(
        'prod-1',
        {
          images: [images[1]],
          imageUrl: images[1].url,
        },
        expect.anything(),
        '',
      );
    });

    it('sets imageUrl to empty string when last image is deleted', async () => {
      const images = [
        { key: 'products/prod-1/images/abc.jpg', url: '/images/products/prod-1/images/abc.jpg' },
      ];
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1', images },
      });
      vi.mocked(deleteImage).mockResolvedValue({ success: true });
      vi.mocked(updateProduct).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/products/prod-1/images/abc.jpg',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateProduct).toHaveBeenCalledWith(
        'prod-1',
        { images: [], imageUrl: '' },
        expect.anything(),
        '',
      );
    });

    it('returns 404 when product does not exist', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/products/prod-999/images/abc.jpg',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('returns 404 when image key is not found in product', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1', images: [{ key: 'other-key', url: '/other' }] },
      });

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/products/prod-1/images/nonexistent.jpg',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('IMAGE_NOT_FOUND');
    });

    it('returns 404 when product has no images', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { productId: 'prod-1' },
      });

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/products/prod-1/images/abc.jpg',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('IMAGE_NOT_FOUND');
    });
  });

  describe('GET /api/admin/users', () => {
    it('routes to listUsers and returns results', async () => {
      vi.mocked(listUsers).mockResolvedValue({ users: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/users' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ users: [], lastKey: undefined });
    });

    it('passes role, pageSize and lastKey query params', async () => {
      vi.mocked(listUsers).mockResolvedValue({ users: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/users',
        queryStringParameters: {
          role: 'Admin',
          pageSize: '10',
          lastKey: JSON.stringify({ userId: 'last-user' }),
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listUsers).toHaveBeenCalledWith(
        { role: 'Admin', pageSize: 10, lastKey: { userId: 'last-user' } },
        expect.anything(),
        '',
      );
    });
  });

  describe('PATCH /api/admin/users/{id}/status', () => {
    it('routes to setUserStatus with correct params', async () => {
      vi.mocked(setUserStatus).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/users/user-123/status',
        body: JSON.stringify({ status: 'disabled' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(setUserStatus).toHaveBeenCalledWith(
        'user-123',
        'disabled',
        'admin-user-id',
        ['Admin'],
        expect.anything(),
        '',
      );
    });

    it('returns 400 when status field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/users/user-123/status',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error with correct HTTP status when setUserStatus fails', async () => {
      vi.mocked(setUserStatus).mockResolvedValue({
        success: false,
        error: { code: 'CANNOT_DISABLE_SUPERADMIN', message: '禁止停用 SuperAdmin 用户' },
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/users/user-123/status',
        body: JSON.stringify({ status: 'disabled' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('CANNOT_DISABLE_SUPERADMIN');
    });
  });

  describe('DELETE /api/admin/users/{id}', () => {
    it('routes to deleteUser with correct params', async () => {
      vi.mocked(deleteUser).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/users/user-456',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(deleteUser).toHaveBeenCalledWith(
        'user-456',
        'admin-user-id',
        ['Admin'],
        expect.anything(),
        '',
      );
    });

    it('returns error with correct HTTP status when deleteUser fails', async () => {
      vi.mocked(deleteUser).mockResolvedValue({
        success: false,
        error: { code: 'CANNOT_DELETE_SELF', message: '禁止删除自身账号' },
      });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/users/admin-user-id',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('CANNOT_DELETE_SELF');
    });

    it('does not conflict with PUT /api/admin/users/{id}/roles', async () => {
      vi.mocked(assignRoles).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/users/user-123/roles',
        body: JSON.stringify({ roles: ['Speaker'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(assignRoles).toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/admin/claims', () => {
    it('routes to listAllClaims and returns results', async () => {
      vi.mocked(listAllClaims).mockResolvedValue({ success: true, claims: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/claims' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ claims: [], lastKey: undefined });
      expect(listAllClaims).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined }),
        expect.anything(),
        '',
      );
    });

    it('passes status, pageSize and lastKey query params', async () => {
      vi.mocked(listAllClaims).mockResolvedValue({ success: true, claims: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/claims',
        queryStringParameters: { status: 'pending', pageSize: '10', lastKey: 'some-key' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listAllClaims).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', pageSize: 10, lastKey: 'some-key' }),
        expect.anything(),
        '',
      );
    });

    it('returns error when listAllClaims fails', async () => {
      vi.mocked(listAllClaims).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/claims' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_PAGINATION_KEY');
    });
  });

  describe('PATCH /api/admin/claims/{id}/review', () => {
    it('routes to reviewClaim with correct params on approve', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      const mockClaim = {
        claimId: 'claim-1',
        userId: 'user-1',
        applicantNickname: 'User1',
        applicantRole: 'Speaker',
        title: 'Talk',
        description: 'Gave a talk',
        imageUrls: [],
        status: 'approved' as const,
        awardedPoints: 500,
        reviewerId: 'admin-user-id',
        reviewedAt: '2024-01-02T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(reviewClaim).mockResolvedValue({ success: true, claim: mockClaim });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/claims/claim-1/review',
        body: JSON.stringify({ action: 'approve', awardedPoints: 500 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).claim).toEqual(mockClaim);
      expect(reviewClaim).toHaveBeenCalledWith(
        {
          claimId: 'claim-1',
          reviewerId: 'admin-user-id',
          reviewerNickname: 'AdminUser',
          action: 'approve',
          awardedPoints: 500,
          rejectReason: undefined,
        },
        expect.anything(),
        { claimsTable: '', usersTable: '', pointsRecordsTable: '' },
      );
    });

    it('routes to reviewClaim with correct params on reject', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      const mockClaim = {
        claimId: 'claim-2',
        userId: 'user-2',
        applicantNickname: 'User2',
        applicantRole: 'Volunteer',
        title: 'Event',
        description: 'Organized event',
        imageUrls: [],
        status: 'rejected' as const,
        rejectReason: 'Not enough evidence',
        reviewerId: 'admin-user-id',
        reviewedAt: '2024-01-02T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(reviewClaim).mockResolvedValue({ success: true, claim: mockClaim });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/claims/claim-2/review',
        body: JSON.stringify({ action: 'reject', rejectReason: 'Not enough evidence' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).claim).toEqual(mockClaim);
      expect(reviewClaim).toHaveBeenCalledWith(
        {
          claimId: 'claim-2',
          reviewerId: 'admin-user-id',
          reviewerNickname: 'AdminUser',
          action: 'reject',
          awardedPoints: undefined,
          rejectReason: 'Not enough evidence',
        },
        expect.anything(),
        { claimsTable: '', usersTable: '', pointsRecordsTable: '' },
      );
    });

    it('returns 400 when action field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/claims/claim-1/review',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error with correct HTTP status when reviewClaim fails', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      vi.mocked(reviewClaim).mockResolvedValue({
        success: false,
        error: { code: 'CLAIM_ALREADY_REVIEWED', message: '该申请已被审批' },
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/claims/claim-1/review',
        body: JSON.stringify({ action: 'approve', awardedPoints: 100 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('CLAIM_ALREADY_REVIEWED');
    });
  });
});
