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
  PutCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'PutCommand', input })),
  ScanCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'ScanCommand', input })),
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
vi.mock('../content/admin', () => ({
  reviewContent: vi.fn(),
  listAllContent: vi.fn(),
  deleteContent: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock('../content/content-permission', () => ({
  checkReviewPermission: vi.fn(),
}));
vi.mock('../settings/feature-toggles', () => ({
  updateFeatureToggles: vi.fn(),
  updateContentRolePermissions: vi.fn(),
  getFeatureToggles: vi.fn(),
}));
vi.mock('../content/admin-tags', () => ({
  listAllTags: vi.fn(),
  mergeTags: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('./batch-points', () => ({
  executeBatchDistribution: vi.fn(),
  validateBatchDistributionInput: vi.fn(),
  listDistributionHistory: vi.fn(),
  getDistributionDetail: vi.fn(),
}));
vi.mock('../travel/settings', () => ({
  updateTravelSettings: vi.fn(),
  validateTravelSettingsInput: vi.fn(),
}));
vi.mock('../travel/review', () => ({
  reviewTravelApplication: vi.fn(),
  listAllTravelApplications: vi.fn(),
}));
vi.mock('../settings/invite-settings', () => ({
  getInviteSettings: vi.fn(),
  updateInviteSettings: vi.fn(),
}));
vi.mock('./ug', () => ({
  createUG: vi.fn(),
  deleteUG: vi.fn(),
  updateUGStatus: vi.fn(),
  listUGs: vi.fn(),
  assignLeader: vi.fn(),
  removeLeader: vi.fn(),
  getMyUGs: vi.fn(),
}));
vi.mock('./activities', () => ({
  listActivities: vi.fn(),
}));
vi.mock('../content/reservation-approval', () => ({
  reviewReservation: vi.fn(),
  listReservationApprovals: vi.fn(),
  getVisibleUGNames: vi.fn(),
}));
vi.mock('../reports/query', () => ({
  queryPointsDetail: vi.fn(),
  queryUGActivitySummary: vi.fn(),
  queryUserPointsRanking: vi.fn(),
  queryActivityPointsSummary: vi.fn(),
}));
vi.mock('../reports/export', () => ({
  executeExport: vi.fn(),
  validateExportInput: vi.fn(),
}));
vi.mock('../reports/insight-query', () => ({
  queryPopularProducts: vi.fn(),
  queryHotContent: vi.fn(),
  queryContentContributors: vi.fn(),
  queryInventoryAlert: vi.fn(),
  queryTravelStatistics: vi.fn(),
  queryInviteConversion: vi.fn(),
}));

const { mockLambdaSend } = vi.hoisted(() => ({
  mockLambdaSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'InvokeCommand', input })),
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
import { batchGenerateInvites } from './invites';
import { reviewClaim, listAllClaims } from '../claims/review';
import { reviewContent, listAllContent, deleteContent, createCategory, updateCategory, deleteCategory } from '../content/admin';
import { checkReviewPermission } from '../content/content-permission';
import { listAllTags, mergeTags, deleteTag } from '../content/admin-tags';
import { updateFeatureToggles, updateContentRolePermissions, getFeatureToggles } from '../settings/feature-toggles';
import { executeBatchDistribution, validateBatchDistributionInput, listDistributionHistory, getDistributionDetail } from './batch-points';
import { updateTravelSettings, validateTravelSettingsInput } from '../travel/settings';
import { reviewTravelApplication, listAllTravelApplications } from '../travel/review';
import { getInviteSettings } from '../settings/invite-settings';
import { createUG, deleteUG, updateUGStatus, listUGs, assignLeader, removeLeader, getMyUGs } from './ug';
import { listActivities } from './activities';
import { reviewReservation, listReservationApprovals, getVisibleUGNames } from '../content/reservation-approval';
import { queryPointsDetail, queryUGActivitySummary, queryUserPointsRanking, queryActivityPointsSummary } from '../reports/query';
import { executeExport, validateExportInput } from '../reports/export';
import { queryPopularProducts, queryHotContent, queryContentContributors, queryInventoryAlert, queryTravelStatistics, queryInviteConversion } from '../reports/insight-query';

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
    // Default getFeatureToggles mock — all toggles enabled so existing tests pass
    vi.mocked(getFeatureToggles).mockResolvedValue({
      codeRedemptionEnabled: true,
      pointsClaimEnabled: true,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: true,
      contentRolePermissions: {
        Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      },
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 10,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
    } as any);
    // Default checkReviewPermission: Admin is denied (adminContentReviewEnabled: false), SuperAdmin is allowed
    vi.mocked(checkReviewPermission).mockImplementation((roles: string[]) =>
      roles.includes('SuperAdmin'),
    );
    // Default getInviteSettings mock
    vi.mocked(getInviteSettings).mockResolvedValue({ inviteExpiryDays: 1 });
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

  describe('POST /api/admin/invites/batch', () => {
    it('routes to batchGenerateInvites with roles array from body', async () => {
      const mockInvites = [
        {
          token: 'tok-1',
          link: 'https://example.com/register?token=tok-1',
          roles: ['Speaker', 'Volunteer'],
          expiresAt: '2025-01-02T00:00:00.000Z',
        },
      ];
      vi.mocked(batchGenerateInvites).mockResolvedValue({ success: true, invites: mockInvites });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ count: 1, roles: ['Speaker', 'Volunteer'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).invites).toEqual(mockInvites);
      expect(batchGenerateInvites).toHaveBeenCalledWith(
        1,
        ['Speaker', 'Volunteer'],
        expect.anything(),
        '',
        '',
        86400000,
      );
    });

    it('returns 400 when roles is not an array', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ count: 5, roles: 'Speaker' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when roles field is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ count: 5 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when count is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ roles: ['Speaker'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when batchGenerateInvites fails', async () => {
      vi.mocked(batchGenerateInvites).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_ROLES', message: '请至少选择一个角色' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ count: 1, roles: [] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_ROLES');
    });
  });

  // ── Content Management Routes ──────────────────────────────

  describe('GET /api/admin/content', () => {
    it('routes to listAllContent and returns results', async () => {
      vi.mocked(listAllContent).mockResolvedValue({ items: [], lastKey: undefined });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/content' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ items: [], lastKey: undefined });
    });

    it('passes status, pageSize and lastKey query params', async () => {
      vi.mocked(listAllContent).mockResolvedValue({ items: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/content',
        queryStringParameters: { status: 'pending', pageSize: '10', lastKey: 'some-key' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listAllContent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', pageSize: 10, lastKey: 'some-key' }),
        expect.anything(),
        '',
      );
    });
  });

  describe('PATCH /api/admin/content/:id/review', () => {
    it('Admin with adminContentReviewEnabled: false → 403 PERMISSION_DENIED', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(checkReviewPermission).mockReturnValue(false);
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/content/content-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('PERMISSION_DENIED');
    });

    it('Admin with adminContentReviewEnabled: true → allowed (200)', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(checkReviewPermission).mockReturnValue(true);
      vi.mocked(reviewContent).mockResolvedValue({
        success: true,
        item: { contentId: 'content-1', status: 'approved' } as any,
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/content/content-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(reviewContent).toHaveBeenCalledWith(
        expect.objectContaining({ contentId: 'content-1', reviewerId: 'admin-user-id', action: 'approve' }),
        expect.anything(),
        '',
      );
    });

    it('SuperAdmin with adminContentReviewEnabled: false → still allowed (200)', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(checkReviewPermission).mockReturnValue(true);
      vi.mocked(reviewContent).mockResolvedValue({
        success: true,
        item: { contentId: 'content-1', status: 'approved' } as any,
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/content/content-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(reviewContent).toHaveBeenCalledWith(
        expect.objectContaining({ contentId: 'content-1', reviewerId: 'admin-user-id', action: 'approve' }),
        expect.anything(),
        '',
      );
    });

    it('returns 400 when action field is missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(checkReviewPermission).mockReturnValue(true);
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/content/content-1/review',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('DELETE /api/admin/content/:id', () => {
    it('routes to deleteContent with correct contentId', async () => {
      vi.mocked(deleteContent).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/content/content-1',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(deleteContent).toHaveBeenCalledWith(
        'content-1',
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ contentItemsTable: '' }),
        '',
      );
    });
  });

  describe('POST /api/admin/content/categories', () => {
    it('routes to createCategory with correct name', async () => {
      vi.mocked(createCategory).mockResolvedValue({
        success: true,
        category: { categoryId: 'cat-1', name: 'Tech', createdAt: '2024-01-01' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/content/categories',
        body: JSON.stringify({ name: 'Tech' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createCategory).toHaveBeenCalledWith('Tech', expect.anything(), '');
    });

    it('returns 400 when name is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/content/categories',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('PUT /api/admin/content/categories/:id', () => {
    it('routes to updateCategory with correct params', async () => {
      vi.mocked(updateCategory).mockResolvedValue({
        success: true,
        category: { categoryId: 'cat-1', name: 'Updated', createdAt: '2024-01-01' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/content/categories/cat-1',
        body: JSON.stringify({ name: 'Updated' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateCategory).toHaveBeenCalledWith('cat-1', 'Updated', expect.anything(), '');
    });

    it('returns 400 when name is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/content/categories/cat-1',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/admin/content/categories/:id', () => {
    it('routes to deleteCategory with correct categoryId', async () => {
      vi.mocked(deleteCategory).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/content/categories/cat-1',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(deleteCategory).toHaveBeenCalledWith('cat-1', expect.anything(), '');
    });
  });

  // ── Tag Management Routes ──────────────────────────────

  describe('GET /api/admin/tags', () => {
    it('routes to listAllTags and returns results', async () => {
      vi.mocked(listAllTags).mockResolvedValue({
        success: true,
        tags: [
          { tagId: 'tag-1', tagName: 'angular', usageCount: 3, createdAt: '2024-01-01' },
          { tagId: 'tag-2', tagName: 'react', usageCount: 10, createdAt: '2024-01-01' },
        ],
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/tags' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.tags).toHaveLength(2);
      expect(body.tags[0].tagName).toBe('angular');
      expect(listAllTags).toHaveBeenCalledWith(expect.anything(), '');
    });

    it('Admin role can list tags', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(listAllTags).mockResolvedValue({ success: true, tags: [] });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/tags' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('POST /api/admin/tags/merge', () => {
    it('routes to mergeTags when user is SuperAdmin', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(mergeTags).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/tags/merge',
        body: JSON.stringify({ sourceTagId: 'src-1', targetTagId: 'tgt-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('标签合并成功');
      expect(mergeTags).toHaveBeenCalledWith(
        { sourceTagId: 'src-1', targetTagId: 'tgt-1' },
        expect.anything(),
        { contentTagsTable: '', contentItemsTable: '' },
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN for merge', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/tags/merge',
        body: JSON.stringify({ sourceTagId: 'src-1', targetTagId: 'tgt-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(mergeTags).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/tags/merge',
        body: JSON.stringify({ sourceTagId: 'src-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when mergeTags fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(mergeTags).mockResolvedValue({
        success: false,
        error: { code: 'TAG_MERGE_SELF_ERROR', message: '不能将标签合并到自身' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/tags/merge',
        body: JSON.stringify({ sourceTagId: 'tag-1', targetTagId: 'tag-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('TAG_MERGE_SELF_ERROR');
    });
  });

  describe('DELETE /api/admin/tags/:id', () => {
    it('routes to deleteTag when user is SuperAdmin', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(deleteTag).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/tags/tag-123',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('标签已删除');
      expect(deleteTag).toHaveBeenCalledWith(
        'tag-123',
        expect.anything(),
        { contentTagsTable: '', contentItemsTable: '' },
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN for delete', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/tags/tag-123',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(deleteTag).not.toHaveBeenCalled();
    });

    it('returns 404 when tag not found', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(deleteTag).mockResolvedValue({
        success: false,
        error: { code: 'TAG_NOT_FOUND', message: '标签不存在' },
      });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/tags/nonexistent',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('TAG_NOT_FOUND');
    });
  });

  describe('PUT /api/admin/settings/feature-toggles', () => {
    it('SuperAdmin can update feature toggles successfully', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateFeatureToggles).mockResolvedValue({
        success: true,
        settings: {
          codeRedemptionEnabled: true,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          contentRolePermissions: {
            Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailPointsEarnedEnabled: false,
          emailNewOrderEnabled: false,
          emailOrderShippedEnabled: false,
          emailNewProductEnabled: false,
          emailNewContentEnabled: false,
          adminEmailProductsEnabled: false,
          adminEmailContentEnabled: false,
          reservationApprovalPoints: 10,
          leaderboardRankingEnabled: false,
          leaderboardAnnouncementEnabled: false,
          leaderboardUpdateFrequency: 'weekly',
          updatedAt: '2024-01-01T00:00:00.000Z',
          updatedBy: 'admin-user-id',
        },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ codeRedemptionEnabled: true, pointsClaimEnabled: false }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.settings.codeRedemptionEnabled).toBe(true);
      expect(body.settings.pointsClaimEnabled).toBe(false);
      expect(updateFeatureToggles).toHaveBeenCalledWith(
        {
          codeRedemptionEnabled: true,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          emailPointsEarnedEnabled: false,
          emailNewOrderEnabled: false,
          emailOrderShippedEnabled: false,
          emailNewProductEnabled: false,
          emailNewContentEnabled: false,
          adminEmailProductsEnabled: false,
          adminEmailContentEnabled: false,
          reservationApprovalPoints: 10,
          leaderboardRankingEnabled: false,
          leaderboardAnnouncementEnabled: false,
          leaderboardUpdateFrequency: 'weekly',
          updatedBy: 'admin-user-id',
        },
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ codeRedemptionEnabled: true, pointsClaimEnabled: false }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('invalid request body gets 400 INVALID_REQUEST', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  // ── Batch Points Routes ──────────────────────────────

  describe('POST /api/admin/batch-points', () => {
    it('dispatches to batch distribution handler and returns 201', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(validateBatchDistributionInput).mockReturnValue({ valid: true });
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      vi.mocked(executeBatchDistribution).mockResolvedValue({
        success: true,
        distributionId: 'dist-001',
        successCount: 3,
        totalPoints: 300,
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/batch-points',
        body: JSON.stringify({
          userIds: ['u1', 'u2', 'u3'],
          points: 100,
          reason: '季度奖励',
          targetRole: 'Speaker',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.distributionId).toBe('dist-001');
      expect(body.successCount).toBe(3);
      expect(body.totalPoints).toBe(300);
      expect(executeBatchDistribution).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: ['u1', 'u2', 'u3'],
          points: 100,
          reason: '季度奖励',
          targetRole: 'Speaker',
          distributorId: 'admin-user-id',
          distributorNickname: 'AdminUser',
        }),
        expect.anything(),
        expect.objectContaining({
          usersTable: '',
          pointsRecordsTable: '',
          batchDistributionsTable: '',
        }),
      );
    });

    it('returns 400 when validation fails', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(validateBatchDistributionInput).mockReturnValue({
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'userIds 必须为非空数组' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/batch-points',
        body: JSON.stringify({ points: 100 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('Admin can execute batch distribution', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(validateBatchDistributionInput).mockReturnValue({ valid: true });
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'Admin1' } });
      vi.mocked(executeBatchDistribution).mockResolvedValue({
        success: true,
        distributionId: 'dist-002',
        successCount: 1,
        totalPoints: 50,
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/batch-points',
        body: JSON.stringify({
          userIds: ['u1'],
          points: 50,
          reason: '测试发放',
          targetRole: 'Volunteer',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
    });

    it('returns error when executeBatchDistribution fails', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(validateBatchDistributionInput).mockReturnValue({ valid: true });
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'Admin1' } });
      vi.mocked(executeBatchDistribution).mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '批量发放事务执行失败' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/batch-points',
        body: JSON.stringify({
          userIds: ['u1'],
          points: 50,
          reason: '测试',
          targetRole: 'Speaker',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/admin/batch-points/history', () => {
    it('dispatches to list distribution history handler for SuperAdmin', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listDistributionHistory).mockResolvedValue({
        success: true,
        distributions: [
          {
            distributionId: 'dist-001',
            distributorId: 'admin-1',
            distributorNickname: 'Admin1',
            targetRole: 'Speaker',
            recipientIds: ['u1', 'u2'],
            points: 100,
            reason: '季度奖励',
            successCount: 2,
            totalPoints: 200,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.distributions).toHaveLength(1);
      expect(body.distributions[0].distributionId).toBe('dist-001');
      expect(listDistributionHistory).toHaveBeenCalledWith(
        { pageSize: undefined, lastKey: undefined },
        expect.anything(),
        '',
      );
    });

    it('passes pageSize and lastKey query params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listDistributionHistory).mockResolvedValue({
        success: true,
        distributions: [],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history',
        queryStringParameters: { pageSize: '10', lastKey: 'some-cursor' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listDistributionHistory).toHaveBeenCalledWith(
        { pageSize: 10, lastKey: 'some-cursor' },
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin (Admin) can view own history with distributorId filter', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(listDistributionHistory).mockResolvedValue({
        success: true,
        distributions: [],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listDistributionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ distributorId: 'admin-user-id' }),
        expect.anything(),
        '',
      );
    });

    it('SuperAdmin can view history', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listDistributionHistory).mockResolvedValue({
        success: true,
        distributions: [],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('GET /api/admin/batch-points/history/{id}', () => {
    it('dispatches to get distribution detail handler for SuperAdmin', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(getDistributionDetail).mockResolvedValue({
        success: true,
        distribution: {
          distributionId: 'dist-001',
          distributorId: 'admin-1',
          distributorNickname: 'Admin1',
          targetRole: 'Speaker',
          recipientIds: ['u1', 'u2'],
          recipientDetails: [
            { userId: 'u1', nickname: 'User1', email: 'u1@test.com' },
            { userId: 'u2', nickname: 'User2', email: 'u2@test.com' },
          ],
          points: 100,
          reason: '季度奖励',
          successCount: 2,
          totalPoints: 200,
          createdAt: '2024-01-01T00:00:00Z',
        },
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history/dist-001',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.distribution.distributionId).toBe('dist-001');
      expect(body.distribution.recipientDetails).toHaveLength(2);
      expect(getDistributionDetail).toHaveBeenCalledWith(
        'dist-001',
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin can view own distribution detail', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getDistributionDetail).mockResolvedValue({
        success: true,
        distribution: {
          distributionId: 'dist-001',
          distributorId: 'admin-user-id',
          distributorNickname: 'Admin1',
          targetRole: 'Speaker',
          recipientIds: ['u1'],
          recipientDetails: [{ userId: 'u1', nickname: 'User1', email: 'u1@test.com' }],
          points: 100,
          reason: '测试',
          successCount: 1,
          totalPoints: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history/dist-001',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getDistributionDetail).toHaveBeenCalled();
    });

    it('non-SuperAdmin cannot view other admin distribution detail (returns 403)', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getDistributionDetail).mockResolvedValue({
        success: true,
        distribution: {
          distributionId: 'dist-002',
          distributorId: 'other-admin-id',
          distributorNickname: 'OtherAdmin',
          targetRole: 'Speaker',
          recipientIds: ['u1'],
          recipientDetails: [{ userId: 'u1', nickname: 'User1', email: 'u1@test.com' }],
          points: 100,
          reason: '测试',
          successCount: 1,
          totalPoints: 100,
          createdAt: '2024-01-01T00:00:00Z',
        },
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history/dist-002',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns 404 when distribution not found', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(getDistributionDetail).mockResolvedValue({
        success: false,
        error: { code: 'DISTRIBUTION_NOT_FOUND', message: '发放记录不存在' },
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/batch-points/history/nonexistent',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('DISTRIBUTION_NOT_FOUND');
    });
  });

  // ── Travel Sponsorship Routes ──────────────────────────────

  describe('PUT /api/admin/settings/travel-sponsorship', () => {
    it('SuperAdmin can update travel sponsorship settings', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(validateTravelSettingsInput).mockReturnValue({ valid: true });
      vi.mocked(updateTravelSettings).mockResolvedValue({
        success: true,
        settings: {
          userId: 'travel-sponsorship',
          travelSponsorshipEnabled: true,
          domesticThreshold: 500,
          internationalThreshold: 1000,
          updatedAt: '2024-01-01T00:00:00.000Z',
          updatedBy: 'admin-user-id',
        },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/travel-sponsorship',
        body: JSON.stringify({
          travelSponsorshipEnabled: true,
          domesticThreshold: 500,
          internationalThreshold: 1000,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.settings.travelSponsorshipEnabled).toBe(true);
      expect(body.settings.domesticThreshold).toBe(500);
      expect(body.settings.internationalThreshold).toBe(1000);
      expect(updateTravelSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          travelSponsorshipEnabled: true,
          domesticThreshold: 500,
          internationalThreshold: 1000,
          updatedBy: 'admin-user-id',
        }),
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/travel-sponsorship',
        body: JSON.stringify({
          travelSponsorshipEnabled: true,
          domesticThreshold: 500,
          internationalThreshold: 1000,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(updateTravelSettings).not.toHaveBeenCalled();
    });

    it('returns 400 when validation fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(validateTravelSettingsInput).mockReturnValue({
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'domesticThreshold 必须为正整数（最小值 1）' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/travel-sponsorship',
        body: JSON.stringify({
          travelSponsorshipEnabled: true,
          domesticThreshold: 0,
          internationalThreshold: 1000,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/admin/travel/applications', () => {
    it('SuperAdmin can list all travel applications', async () => {
      mockUserRoles = ['SuperAdmin'];
      const mockApplications = [
        {
          applicationId: 'app-1',
          userId: 'user-1',
          applicantNickname: 'Speaker1',
          category: 'domestic',
          communityRole: 'Hero',
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
          totalCost: 1500,
          status: 'pending',
          earnDeducted: 500,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(listAllTravelApplications).mockResolvedValue({
        success: true,
        applications: mockApplications as any,
        lastKey: undefined,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/travel/applications',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.applications).toEqual(mockApplications);
      expect(listAllTravelApplications).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined }),
        expect.anything(),
        '',
      );
    });

    it('passes status, pageSize and lastKey query params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listAllTravelApplications).mockResolvedValue({
        success: true,
        applications: [],
        lastKey: undefined,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/travel/applications',
        queryStringParameters: { status: 'pending', pageSize: '10', lastKey: 'some-cursor' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listAllTravelApplications).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', pageSize: 10, lastKey: 'some-cursor' }),
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/travel/applications',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(listAllTravelApplications).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/admin/travel/{id}/review', () => {
    it('SuperAdmin can approve a travel application', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      const mockApplication = {
        applicationId: 'app-1',
        userId: 'user-1',
        applicantNickname: 'Speaker1',
        category: 'domestic',
        communityRole: 'Hero',
        eventLink: 'https://example.com/event',
        cfpScreenshotUrl: 'https://example.com/screenshot.png',
        flightCost: 1000,
        hotelCost: 500,
        totalCost: 1500,
        status: 'approved',
        earnDeducted: 500,
        reviewerId: 'admin-user-id',
        reviewerNickname: 'AdminUser',
        reviewedAt: '2024-01-02T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      vi.mocked(reviewTravelApplication).mockResolvedValue({
        success: true,
        application: mockApplication as any,
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/travel/app-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).application).toEqual(mockApplication);
      expect(reviewTravelApplication).toHaveBeenCalledWith(
        {
          applicationId: 'app-1',
          reviewerId: 'admin-user-id',
          reviewerNickname: 'AdminUser',
          action: 'approve',
          rejectReason: undefined,
        },
        expect.anything(),
        { usersTable: '', travelApplicationsTable: '' },
      );
    });

    it('SuperAdmin can reject a travel application with reason', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      const mockApplication = {
        applicationId: 'app-2',
        userId: 'user-2',
        applicantNickname: 'Speaker2',
        category: 'international',
        communityRole: 'UGL',
        eventLink: 'https://example.com/event2',
        cfpScreenshotUrl: 'https://example.com/screenshot2.png',
        flightCost: 3000,
        hotelCost: 1500,
        totalCost: 4500,
        status: 'rejected',
        earnDeducted: 1000,
        rejectReason: '费用过高',
        reviewerId: 'admin-user-id',
        reviewerNickname: 'AdminUser',
        reviewedAt: '2024-01-02T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      vi.mocked(reviewTravelApplication).mockResolvedValue({
        success: true,
        application: mockApplication as any,
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/travel/app-2/review',
        body: JSON.stringify({ action: 'reject', rejectReason: '费用过高' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).application).toEqual(mockApplication);
      expect(reviewTravelApplication).toHaveBeenCalledWith(
        {
          applicationId: 'app-2',
          reviewerId: 'admin-user-id',
          reviewerNickname: 'AdminUser',
          action: 'reject',
          rejectReason: '费用过高',
        },
        expect.anything(),
        { usersTable: '', travelApplicationsTable: '' },
      );
    });

    it('returns 400 when action field is missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/travel/app-1/review',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/travel/app-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(reviewTravelApplication).not.toHaveBeenCalled();
    });

    it('returns error with correct HTTP status when reviewTravelApplication fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({ Item: { nickname: 'AdminUser' } });
      vi.mocked(reviewTravelApplication).mockResolvedValue({
        success: false,
        error: { code: 'APPLICATION_ALREADY_REVIEWED', message: '该申请已被审批' },
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/travel/app-1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('APPLICATION_ALREADY_REVIEWED');
    });
  });

  // ── Content Role Permissions Routes ──────────────────────────────

  describe('PUT /api/admin/settings/content-role-permissions', () => {
    const validPermissions = {
      contentRolePermissions: {
        Speaker:         { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
        UserGroupLeader: { canAccess: true,  canUpload: false, canDownload: true,  canReserve: false },
        Volunteer:       { canAccess: false, canUpload: false, canDownload: false, canReserve: false },
      },
    };

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/content-role-permissions',
        body: JSON.stringify(validPermissions),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(updateContentRolePermissions).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_REQUEST when a permission field is not boolean', async () => {
      mockUserRoles = ['SuperAdmin'];
      const invalidPermissions = {
        contentRolePermissions: {
          Speaker:         { canAccess: 'yes', canUpload: true,  canDownload: true,  canReserve: true  },
          UserGroupLeader: { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
          Volunteer:       { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
        },
      };
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/content-role-permissions',
        body: JSON.stringify(invalidPermissions),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
      expect(updateContentRolePermissions).not.toHaveBeenCalled();
    });

    it('SuperAdmin with valid permissions gets 200 with updated matrix', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateContentRolePermissions).mockResolvedValue({
        success: true,
        contentRolePermissions: validPermissions.contentRolePermissions as any,
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/content-role-permissions',
        body: JSON.stringify(validPermissions),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.contentRolePermissions).toEqual(validPermissions.contentRolePermissions);
      expect(updateContentRolePermissions).toHaveBeenCalledWith(
        {
          contentRolePermissions: validPermissions.contentRolePermissions,
          updatedBy: 'admin-user-id',
        },
        expect.anything(),
        '',
      );
    });
  });

  // ── Feature Toggles — new fields ──────────────────────────────

  describe('PUT /api/admin/settings/feature-toggles — new fields', () => {
    it('persists adminContentReviewEnabled when provided as true', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateFeatureToggles).mockResolvedValue({
        success: true,
        settings: {
          codeRedemptionEnabled: true,
          pointsClaimEnabled: true,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: true,
          adminCategoriesEnabled: false,
          contentRolePermissions: {
            Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailPointsEarnedEnabled: false,
          emailNewOrderEnabled: false,
          emailOrderShippedEnabled: false,
          emailNewProductEnabled: false,
          emailNewContentEnabled: false,
          adminEmailProductsEnabled: false,
          adminEmailContentEnabled: false,
          reservationApprovalPoints: 10,
          leaderboardRankingEnabled: false,
          leaderboardAnnouncementEnabled: false,
          leaderboardUpdateFrequency: 'weekly',
          updatedAt: '2024-01-01T00:00:00.000Z',
          updatedBy: 'admin-user-id',
        },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ adminContentReviewEnabled: true }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateFeatureToggles).toHaveBeenCalledWith(
        expect.objectContaining({ adminContentReviewEnabled: true }),
        expect.anything(),
        '',
      );
      expect(JSON.parse(result.body).settings.adminContentReviewEnabled).toBe(true);
    });

    it('persists adminCategoriesEnabled when provided as true', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateFeatureToggles).mockResolvedValue({
        success: true,
        settings: {
          codeRedemptionEnabled: true,
          pointsClaimEnabled: true,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: true,
          contentRolePermissions: {
            Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailPointsEarnedEnabled: false,
          emailNewOrderEnabled: false,
          emailOrderShippedEnabled: false,
          emailNewProductEnabled: false,
          emailNewContentEnabled: false,
          adminEmailProductsEnabled: false,
          adminEmailContentEnabled: false,
          reservationApprovalPoints: 10,
          leaderboardRankingEnabled: false,
          leaderboardAnnouncementEnabled: false,
          leaderboardUpdateFrequency: 'weekly',
          updatedAt: '2024-01-01T00:00:00.000Z',
          updatedBy: 'admin-user-id',
        },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ adminCategoriesEnabled: true }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateFeatureToggles).toHaveBeenCalledWith(
        expect.objectContaining({ adminCategoriesEnabled: true }),
        expect.anything(),
        '',
      );
      expect(JSON.parse(result.body).settings.adminCategoriesEnabled).toBe(true);
    });
  });

  // ── Category management with adminCategoriesEnabled guard ──────────────────────────────

  describe('POST /api/admin/content/categories — adminCategoriesEnabled guard', () => {
    it('non-SuperAdmin gets 403 when adminCategoriesEnabled is false', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: true,
        pointsClaimEnabled: true,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        contentRolePermissions: {
          Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        updatedAt: '2024-01-01T00:00:00.000Z',
        updatedBy: 'admin-user-id',
      } as any);
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/content/categories',
        body: JSON.stringify({ name: 'Tech' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(createCategory).not.toHaveBeenCalled();
    });

    it('non-SuperAdmin is allowed when adminCategoriesEnabled is true', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: true,
        pointsClaimEnabled: true,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: true,
        contentRolePermissions: {
          Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        updatedAt: '2024-01-01T00:00:00.000Z',
        updatedBy: 'admin-user-id',
      } as any);
      vi.mocked(createCategory).mockResolvedValue({
        success: true,
        category: { categoryId: 'cat-1', name: 'Tech', createdAt: '2024-01-01' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/content/categories',
        body: JSON.stringify({ name: 'Tech' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createCategory).toHaveBeenCalledWith('Tech', expect.anything(), '');
    });

    it('SuperAdmin is always allowed even when adminCategoriesEnabled is false', async () => {
      mockUserRoles = ['SuperAdmin'];
      // getFeatureToggles should NOT be called for SuperAdmin (guard is skipped)
      vi.mocked(createCategory).mockResolvedValue({
        success: true,
        category: { categoryId: 'cat-2', name: 'Science', createdAt: '2024-01-01' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/content/categories',
        body: JSON.stringify({ name: 'Science' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(createCategory).toHaveBeenCalledWith('Science', expect.anything(), '');
      expect(getFeatureToggles).not.toHaveBeenCalled();
    });
  });

  describe('OrderAdmin rejection (all admin handler routes return 403)', () => {
    beforeEach(() => {
      mockUserRoles = ['OrderAdmin'];
    });

    it('rejects GET /api/admin/users with 403', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/users' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects POST /api/admin/invites/batch with 403', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/invites/batch',
        body: JSON.stringify({ count: 1, roles: ['Speaker'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects PUT /api/admin/users/:id/roles with 403', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/users/user-123/roles',
        body: JSON.stringify({ roles: ['Speaker'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects GET /api/admin/codes with 403', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/codes' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects POST /api/admin/products with 403', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/products',
        body: JSON.stringify({ type: 'points', name: 'Test' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects GET /api/admin/claims with 403', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/claims' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects GET /api/admin/content with 403', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/content' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('rejects PUT /api/admin/settings/feature-toggles with 403', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ adminProductsEnabled: true }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('OrderAdmin 仅可访问订单管理功能');
    });

    it('still allows OPTIONS preflight (no auth check)', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/admin/users' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  // ── UG Management Routes ──────────────────────────────

  describe('POST /api/admin/ugs', () => {
    it('SuperAdmin can create a UG', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(createUG).mockResolvedValue({
        success: true,
        ug: { ugId: 'ug-001', name: 'Tokyo', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/ugs',
        body: JSON.stringify({ name: 'Tokyo' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.ug.ugId).toBe('ug-001');
      expect(body.ug.name).toBe('Tokyo');
      expect(createUG).toHaveBeenCalledWith(
        { name: 'Tokyo' },
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/ugs',
        body: JSON.stringify({ name: 'Tokyo' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(createUG).not.toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/ugs',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 409 when UG name is duplicate', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(createUG).mockResolvedValue({
        success: false,
        error: { code: 'DUPLICATE_UG_NAME', message: 'UG 名称已存在' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/ugs',
        body: JSON.stringify({ name: 'Tokyo' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).code).toBe('DUPLICATE_UG_NAME');
    });
  });

  describe('GET /api/admin/ugs', () => {
    it('SuperAdmin can list UGs', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listUGs).mockResolvedValue({
        success: true,
        ugs: [
          { ugId: 'ug-001', name: 'Tokyo', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        ],
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugs' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.ugs).toHaveLength(1);
      expect(body.ugs[0].name).toBe('Tokyo');
      expect(listUGs).toHaveBeenCalledWith(
        { status: 'all' },
        expect.anything(),
        '',
      );
    });

    it('passes status query param', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listUGs).mockResolvedValue({ success: true, ugs: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/ugs',
        queryStringParameters: { status: 'active' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listUGs).toHaveBeenCalledWith(
        { status: 'active' },
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugs' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(listUGs).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/admin/ugs/{ugId}/status', () => {
    it('SuperAdmin can update UG status', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateUGStatus).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/status',
        body: JSON.stringify({ status: 'inactive' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('UG 状态更新成功');
      expect(updateUGStatus).toHaveBeenCalledWith(
        'ug-001',
        'inactive',
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/status',
        body: JSON.stringify({ status: 'inactive' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(updateUGStatus).not.toHaveBeenCalled();
    });

    it('returns 400 when status field is missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/status',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when status is invalid', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/status',
        body: JSON.stringify({ status: 'deleted' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 404 when UG not found', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(updateUGStatus).mockResolvedValue({
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/nonexistent/status',
        body: JSON.stringify({ status: 'active' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('UG_NOT_FOUND');
    });
  });

  describe('DELETE /api/admin/ugs/{ugId}', () => {
    it('SuperAdmin can delete a UG', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(deleteUG).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/ug-001',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('UG 已删除');
      expect(deleteUG).toHaveBeenCalledWith(
        'ug-001',
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/ug-001',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(deleteUG).not.toHaveBeenCalled();
    });

    it('returns 404 when UG not found', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(deleteUG).mockResolvedValue({
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/nonexistent',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('UG_NOT_FOUND');
    });
  });

  // ── UG Leader Routes ──────────────────────────────

  describe('PUT /api/admin/ugs/{ugId}/leader', () => {
    it('routes to assignLeader with correct params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(assignLeader).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/leader',
        body: JSON.stringify({ leaderId: 'user-123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('负责人分配成功');
      expect(assignLeader).toHaveBeenCalledWith(
        { ugId: 'ug-001', leaderId: 'user-123' },
        expect.anything(),
        '',
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/leader',
        body: JSON.stringify({ leaderId: 'user-123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(assignLeader).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_REQUEST when leaderId is missing', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/leader',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
      expect(assignLeader).not.toHaveBeenCalled();
    });

    it('returns error when assignLeader fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(assignLeader).mockResolvedValue({
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/ugs/ug-001/leader',
        body: JSON.stringify({ leaderId: 'user-123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('UG_NOT_FOUND');
    });
  });

  describe('DELETE /api/admin/ugs/{ugId}/leader', () => {
    it('routes to removeLeader with correct ugId', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(removeLeader).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/ug-001/leader',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('负责人已移除');
      expect(removeLeader).toHaveBeenCalledWith(
        'ug-001',
        expect.anything(),
        '',
      );
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/ug-001/leader',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(removeLeader).not.toHaveBeenCalled();
    });

    it('returns error when removeLeader fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(removeLeader).mockResolvedValue({
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/ugs/ug-001/leader',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('UG_NOT_FOUND');
    });
  });

  describe('GET /api/admin/ugs/my-ugs', () => {
    it('routes to getMyUGs and returns UG list', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getMyUGs).mockResolvedValue({
        success: true,
        ugs: [
          { ugId: 'ug-001', name: 'Tokyo', status: 'active', leaderId: 'admin-user-id', leaderNickname: 'Admin', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        ],
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugs/my-ugs' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.ugs).toHaveLength(1);
      expect(body.ugs[0].name).toBe('Tokyo');
      expect(getMyUGs).toHaveBeenCalledWith(
        'admin-user-id',
        expect.anything(),
        '',
      );
    });

    it('SuperAdmin can also access my-ugs', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(getMyUGs).mockResolvedValue({ success: true, ugs: [] });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugs/my-ugs' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).ugs).toEqual([]);
    });

    it('non-admin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Speaker'];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugs/my-ugs' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(getMyUGs).not.toHaveBeenCalled();
    });
  });

  // ── Activity Routes ──────────────────────────────

  describe('GET /api/admin/activities', () => {
    it('Admin can list activities', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(listActivities).mockResolvedValue({
        success: true,
        activities: [
          {
            activityId: 'act-001',
            activityType: '线下活动',
            ugName: 'Tokyo',
            topic: 'AWS Summit',
            activityDate: '2024-06-15',
            syncedAt: '2024-06-01T00:00:00Z',
            sourceUrl: 'https://feishu.cn/table/123',
          },
        ],
        lastKey: undefined,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/activities' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.activities).toHaveLength(1);
      expect(body.activities[0].topic).toBe('AWS Summit');
      expect(listActivities).toHaveBeenCalledWith(
        expect.objectContaining({
          ugName: undefined,
          startDate: undefined,
          endDate: undefined,
          keyword: undefined,
          pageSize: undefined,
          lastKey: undefined,
        }),
        expect.anything(),
        '',
      );
    });

    it('SuperAdmin can list activities', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(listActivities).mockResolvedValue({
        success: true,
        activities: [],
        lastKey: undefined,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/activities' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('passes query params for filtering', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(listActivities).mockResolvedValue({
        success: true,
        activities: [],
        lastKey: undefined,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/activities',
        queryStringParameters: {
          ugName: 'Tokyo',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          keyword: 'summit',
          pageSize: '10',
          lastKey: 'some-cursor',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listActivities).toHaveBeenCalledWith(
        expect.objectContaining({
          ugName: 'Tokyo',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          keyword: 'summit',
          pageSize: 10,
          lastKey: 'some-cursor',
        }),
        expect.anything(),
        '',
      );
    });

    it('non-admin is rejected with 403', async () => {
      mockUserRoles = ['Speaker'];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/activities' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(listActivities).not.toHaveBeenCalled();
    });
  });

  // ── Sync Config Routes ──────────────────────────────

  describe('PUT /api/admin/settings/activity-sync-config', () => {
    it('SuperAdmin can update sync config', async () => {
      mockUserRoles = ['SuperAdmin'];
      // Mock GetCommand for existing config
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
      // Mock PutCommand
      mockDynamoSend.mockResolvedValueOnce({});
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/activity-sync-config',
        body: JSON.stringify({
          syncIntervalDays: 7,
          feishuTableUrl: 'https://feishu.cn/table/123',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.syncIntervalDays).toBe(7);
      expect(body.feishuTableUrl).toBe('https://feishu.cn/table/123');
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/activity-sync-config',
        body: JSON.stringify({ syncIntervalDays: 7 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns 400 when syncIntervalDays is out of range', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/activity-sync-config',
        body: JSON.stringify({ syncIntervalDays: 50 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/activity-sync-config',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/admin/settings/activity-sync-config', () => {
    it('SuperAdmin can get sync config', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          userId: 'activity-sync-config',
          syncIntervalDays: 7,
          feishuTableUrl: 'https://feishu.cn/table/123',
          feishuAppId: 'app-id',
          feishuAppSecret: 'secret',
          updatedAt: '2024-01-01T00:00:00Z',
          updatedBy: 'admin-user-id',
        },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/activity-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.syncIntervalDays).toBe(7);
      expect(body.feishuTableUrl).toBe('https://feishu.cn/table/123');
      expect(body.feishuAppSecret).toBe('***');
    });

    it('returns default config when none exists', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/activity-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.syncIntervalDays).toBe(1);
      expect(body.feishuTableUrl).toBe('');
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/activity-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── Manual Sync Route ──────────────────────────────

  describe('POST /api/admin/sync/activities', () => {
    it('SuperAdmin can trigger manual sync (returns 500 when SYNC_FUNCTION_NAME not configured)', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/activities',
      });
      const result = await handler(event);
      // SYNC_FUNCTION_NAME is empty in test env, so handler returns 500
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('non-SuperAdmin gets 403 FORBIDDEN', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/activities',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── Reservation Approval Routes ──────────────────────

  describe('GET /api/admin/reservation-approvals', () => {
    it('Admin can list reservation approvals', async () => {
      mockUserRoles = ['Admin'];
      // Mock ScanCommand for UGs
      mockDynamoSend.mockResolvedValueOnce({
        Items: [
          { ugId: 'ug-1', name: 'Tokyo', status: 'active' },
        ],
      });
      vi.mocked(getVisibleUGNames).mockReturnValue(['Tokyo']);
      vi.mocked(listReservationApprovals).mockResolvedValue({
        success: true,
        reservations: [
          {
            pk: 'user1#content1',
            userId: 'user1',
            contentId: 'content1',
            contentTitle: 'Test Content',
            reserverNickname: 'User One',
            activityId: 'act-001',
            activityType: '线下活动',
            activityUG: 'Tokyo',
            activityTopic: 'AWS Summit',
            activityDate: '2024-06-15',
            status: 'pending',
            createdAt: '2024-06-01T00:00:00Z',
          },
        ],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reservation-approvals',
        queryStringParameters: { status: 'pending' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.reservations).toHaveLength(1);
      expect(body.reservations[0].activityTopic).toBe('AWS Summit');
      expect(getVisibleUGNames).toHaveBeenCalled();
      expect(listReservationApprovals).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          ugNames: ['Tokyo'],
        }),
        expect.anything(),
        expect.objectContaining({
          reservationsTable: '',
          contentItemsTable: '',
          usersTable: '',
        }),
      );
    });

    it('SuperAdmin can list all reservation approvals', async () => {
      mockUserRoles = ['SuperAdmin'];
      mockDynamoSend.mockResolvedValueOnce({ Items: [] });
      vi.mocked(getVisibleUGNames).mockReturnValue(undefined as any);
      vi.mocked(listReservationApprovals).mockResolvedValue({
        success: true,
        reservations: [],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reservation-approvals',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reservations).toEqual([]);
    });

    it('non-admin is rejected with 403', async () => {
      mockUserRoles = ['Speaker'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reservation-approvals',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(listReservationApprovals).not.toHaveBeenCalled();
    });

    it('passes pageSize and lastKey query params', async () => {
      mockUserRoles = ['Admin'];
      mockDynamoSend.mockResolvedValueOnce({ Items: [] });
      vi.mocked(getVisibleUGNames).mockReturnValue([]);
      vi.mocked(listReservationApprovals).mockResolvedValue({
        success: true,
        reservations: [],
        lastKey: undefined,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reservation-approvals',
        queryStringParameters: {
          status: 'approved',
          pageSize: '10',
          lastKey: 'some-cursor',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listReservationApprovals).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          pageSize: 10,
          lastKey: 'some-cursor',
        }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('PATCH /api/admin/reservation-approvals/{pk}/review', () => {
    it('Admin can approve a reservation', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(reviewReservation).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).success).toBe(true);
      expect(reviewReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: 'user1#content1',
          reviewerId: 'admin-user-id',
          action: 'approve',
        }),
        expect.anything(),
        expect.objectContaining({
          reservationsTable: '',
          contentItemsTable: '',
          usersTable: '',
          pointsRecordsTable: '',
        }),
        10, // default reservationApprovalPoints
      );
    });

    it('Admin can reject a reservation', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(reviewReservation).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'reject' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(reviewReservation).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject' }),
        expect.anything(),
        expect.anything(),
        10,
      );
    });

    it('returns 400 when action field is missing', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
      expect(reviewReservation).not.toHaveBeenCalled();
    });

    it('returns 400 when action is invalid', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'invalid' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
      expect(reviewReservation).not.toHaveBeenCalled();
    });

    it('non-admin is rejected with 403', async () => {
      mockUserRoles = ['Speaker'];
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(reviewReservation).not.toHaveBeenCalled();
    });

    it('returns error when reviewReservation fails', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(reviewReservation).mockResolvedValue({
        success: false,
        error: { code: 'RESERVATION_ALREADY_REVIEWED', message: '该预约已被审批' },
      });

      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).code).toBe('RESERVATION_ALREADY_REVIEWED');
    });

    it('uses reservationApprovalPoints from feature toggles when available', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: true,
        pointsClaimEnabled: true,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: true,
        contentRolePermissions: {
          Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 25,
      } as any);
      vi.mocked(reviewReservation).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(reviewReservation).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        25, // custom reservationApprovalPoints
      );
    });

    it('SuperAdmin can review a reservation', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(reviewReservation).mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/reservation-approvals/user1%23content1/review',
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).success).toBe(true);
    });
  });

  // ---- Report Routes ----

  describe('GET /api/admin/reports/points-detail', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/points-detail',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryPointsDetail).mockResolvedValue({
        success: true,
        records: [{ recordId: 'r1', createdAt: '2024-01-01', userId: 'u1', nickname: 'User1', amount: 10, type: 'earn', source: 'batch', activityUG: 'UG1', activityTopic: 'Topic1', activityId: 'a1', targetRole: 'Speaker', distributorNickname: 'Admin1' }],
        lastKey: undefined,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/points-detail',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          ugName: 'UG1',
          targetRole: 'Speaker',
          type: 'earn',
          pageSize: '50',
          lastKey: 'abc123',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryPointsDetail).toHaveBeenCalledWith(
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          ugName: 'UG1',
          targetRole: 'Speaker',
          activityId: undefined,
          type: 'earn',
          pageSize: 50,
          lastKey: 'abc123',
        },
        expect.anything(),
        expect.objectContaining({
          pointsRecordsTable: expect.any(String),
          usersTable: expect.any(String),
          batchDistributionsTable: expect.any(String),
        }),
      );
    });

    it('passes undefined for missing query params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryPointsDetail).mockResolvedValue({ success: true, records: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/points-detail',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(queryPointsDetail).toHaveBeenCalledWith(
        {
          startDate: undefined,
          endDate: undefined,
          ugName: undefined,
          targetRole: undefined,
          activityId: undefined,
          type: undefined,
          pageSize: undefined,
          lastKey: undefined,
        },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('GET /api/admin/reports/ug-activity-summary', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/ug-activity-summary',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns summary data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryUGActivitySummary).mockResolvedValue({
        success: true,
        records: [{ ugName: 'UG1', activityCount: 5, totalPoints: 100, participantCount: 10 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/ug-activity-summary',
        queryStringParameters: { startDate: '2024-01-01', endDate: '2024-06-30' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).records).toHaveLength(1);
      expect(queryUGActivitySummary).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30' },
        expect.anything(),
        expect.objectContaining({ pointsRecordsTable: expect.any(String) }),
      );
    });
  });

  describe('GET /api/admin/reports/user-points-ranking', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/user-points-ranking',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns ranking data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryUserPointsRanking).mockResolvedValue({
        success: true,
        records: [{ rank: 1, userId: 'u1', nickname: 'User1', totalEarnPoints: 500, targetRole: 'Speaker' }],
        lastKey: 'nextPage',
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/user-points-ranking',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          targetRole: 'Speaker',
          pageSize: '25',
          lastKey: 'prevPage',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(body.lastKey).toBe('nextPage');
      expect(queryUserPointsRanking).toHaveBeenCalledWith(
        {
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          targetRole: 'Speaker',
          pageSize: 25,
          lastKey: 'prevPage',
        },
        expect.anything(),
        expect.objectContaining({
          pointsRecordsTable: expect.any(String),
          usersTable: expect.any(String),
        }),
      );
    });
  });

  describe('GET /api/admin/reports/activity-points-summary', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/activity-points-summary',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns activity summary for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryActivityPointsSummary).mockResolvedValue({
        success: true,
        records: [{ activityId: 'a1', activityTopic: 'Topic1', activityDate: '2024-03-15', activityUG: 'UG1', totalPoints: 200, participantCount: 15, uglCount: 2, speakerCount: 5, volunteerCount: 8 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/activity-points-summary',
        queryStringParameters: { startDate: '2024-01-01', ugName: 'UG1' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).records).toHaveLength(1);
      expect(queryActivityPointsSummary).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: undefined, ugName: 'UG1' },
        expect.anything(),
        expect.objectContaining({ pointsRecordsTable: expect.any(String) }),
      );
    });
  });

  describe('POST /api/admin/reports/export', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/reports/export',
        body: JSON.stringify({ reportType: 'points-detail', format: 'csv', filters: {} }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns 400 when body is empty', async () => {
      mockUserRoles = ['SuperAdmin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/reports/export',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when validation fails', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(validateExportInput).mockReturnValue({
        valid: false,
        error: { code: 'INVALID_REPORT_TYPE', message: '不支持的报表类型' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/reports/export',
        body: JSON.stringify({ reportType: 'invalid', format: 'csv', filters: {} }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REPORT_TYPE');
    });

    it('returns download URL on successful export', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(validateExportInput).mockReturnValue({ valid: true });
      vi.mocked(executeExport).mockResolvedValue({
        success: true,
        downloadUrl: 'https://s3.presigned/export.csv',
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/reports/export',
        body: JSON.stringify({
          reportType: 'points-detail',
          format: 'csv',
          filters: { startDate: '2024-01-01', endDate: '2024-01-31' },
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).downloadUrl).toBe('https://s3.presigned/export.csv');
      expect(executeExport).toHaveBeenCalledWith(
        { reportType: 'points-detail', format: 'csv', filters: { startDate: '2024-01-01', endDate: '2024-01-31' } },
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          pointsRecordsTable: expect.any(String),
          usersTable: expect.any(String),
          batchDistributionsTable: expect.any(String),
        }),
        expect.any(String),
        expect.any(Number),
      );
    });

    it('returns 504 on export timeout', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(validateExportInput).mockReturnValue({ valid: true });
      vi.mocked(executeExport).mockResolvedValue({
        success: false,
        error: { code: 'EXPORT_TIMEOUT', message: '导出超时，请缩小筛选范围后重试' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/reports/export',
        body: JSON.stringify({ reportType: 'points-detail', format: 'xlsx', filters: {} }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(504);
      expect(JSON.parse(result.body).code).toBe('EXPORT_TIMEOUT');
    });
  });

  // ---- Insight Report Routes ----

  describe('GET /api/admin/reports/popular-products', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/popular-products',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryPopularProducts).mockResolvedValue({
        success: true,
        records: [{ productId: 'p1', productName: 'Product1', productType: 'points', redemptionCount: 10, totalPointsSpent: 500, currentStock: 5, stockConsumptionRate: 66.7 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/popular-products',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-06-30',
          productType: 'points',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryPopularProducts).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30', productType: 'points' },
        expect.anything(),
        expect.objectContaining({ ordersTable: expect.any(String), productsTable: expect.any(String) }),
      );
    });

    it('passes undefined for missing query params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryPopularProducts).mockResolvedValue({ success: true, records: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/popular-products',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(queryPopularProducts).toHaveBeenCalledWith(
        { startDate: undefined, endDate: undefined, productType: undefined },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('GET /api/admin/reports/hot-content', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/hot-content',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryHotContent).mockResolvedValue({
        success: true,
        records: [{ contentId: 'c1', title: 'Hot Article', uploaderNickname: 'Author1', categoryName: 'Tech', likeCount: 50, commentCount: 20, reservationCount: 5, engagementScore: 75 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/hot-content',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-06-30',
          categoryId: 'cat-1',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryHotContent).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30', categoryId: 'cat-1' },
        expect.anything(),
        expect.objectContaining({ contentItemsTable: expect.any(String), contentCategoriesTable: expect.any(String), usersTable: expect.any(String) }),
      );
    });
  });

  describe('GET /api/admin/reports/content-contributors', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/content-contributors',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryContentContributors).mockResolvedValue({
        success: true,
        records: [{ rank: 1, userId: 'u1', nickname: 'TopContributor', approvedCount: 15, totalLikes: 200, totalComments: 80 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/content-contributors',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-06-30',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryContentContributors).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30' },
        expect.anything(),
        expect.objectContaining({ contentItemsTable: expect.any(String), usersTable: expect.any(String) }),
      );
    });
  });

  describe('GET /api/admin/reports/inventory-alert', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/inventory-alert',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryInventoryAlert).mockResolvedValue({
        success: true,
        records: [{ productId: 'p1', productName: 'LowStockItem', productType: 'points', currentStock: 2, totalStock: 2, productStatus: 'active' }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/inventory-alert',
        queryStringParameters: {
          stockThreshold: '10',
          productType: 'points',
          productStatus: 'active',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryInventoryAlert).toHaveBeenCalledWith(
        { stockThreshold: 10, productType: 'points', productStatus: 'active' },
        expect.anything(),
        expect.objectContaining({ productsTable: expect.any(String) }),
      );
    });

    it('defaults stockThreshold to 5 when not provided or invalid', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryInventoryAlert).mockResolvedValue({ success: true, records: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/inventory-alert',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(queryInventoryAlert).toHaveBeenCalledWith(
        { stockThreshold: 5, productType: undefined, productStatus: undefined },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('GET /api/admin/reports/travel-statistics', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/travel-statistics',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns report data for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryTravelStatistics).mockResolvedValue({
        success: true,
        records: [{ period: '2024-01', totalApplications: 20, approvedCount: 15, rejectedCount: 3, pendingCount: 2, approvalRate: 75.0, totalSponsoredAmount: 50000 }],
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/travel-statistics',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-06-30',
          periodType: 'month',
          category: 'domestic',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.records).toHaveLength(1);
      expect(queryTravelStatistics).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30', periodType: 'month', category: 'domestic' },
        expect.anything(),
        expect.objectContaining({ travelApplicationsTable: expect.any(String) }),
      );
    });
  });

  describe('GET /api/admin/reports/invite-conversion', () => {
    it('returns 403 for non-SuperAdmin', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/invite-conversion',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('returns single record for SuperAdmin with filters', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryInviteConversion).mockResolvedValue({
        success: true,
        record: { totalInvites: 100, usedCount: 60, expiredCount: 25, pendingCount: 15, conversionRate: 60.0 },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/invite-conversion',
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-06-30',
        },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.record).toBeDefined();
      expect(body.record.totalInvites).toBe(100);
      expect(body.record.conversionRate).toBe(60.0);
      expect(queryInviteConversion).toHaveBeenCalledWith(
        { startDate: '2024-01-01', endDate: '2024-06-30' },
        expect.anything(),
        expect.objectContaining({ invitesTable: expect.any(String) }),
      );
    });

    it('passes undefined for missing query params', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(queryInviteConversion).mockResolvedValue({
        success: true,
        record: { totalInvites: 0, usedCount: 0, expiredCount: 0, pendingCount: 0, conversionRate: 0 },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/reports/invite-conversion',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(queryInviteConversion).toHaveBeenCalledWith(
        { startDate: undefined, endDate: undefined },
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
