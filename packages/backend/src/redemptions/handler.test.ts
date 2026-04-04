import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock the redemption modules
vi.mock('./points-redemption', () => ({
  redeemWithPoints: vi.fn(),
}));
vi.mock('./code-redemption', () => ({
  redeemWithCode: vi.fn(),
}));
vi.mock('./history', () => ({
  getRedemptionHistory: vi.fn(),
}));

// Mock auth middleware
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'test-user-id',
        email: 'test@example.com',
        roles: ['Speaker'],
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { redeemWithPoints } from './points-redemption';
import { redeemWithCode } from './code-redemption';
import { getRedemptionHistory } from './history';

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

describe('Redemptions Lambda Handler - Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for unknown routes', async () => {
    const event = makeEvent({ httpMethod: 'GET', path: '/api/redemptions/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/redemptions/points' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  describe('POST /api/redemptions/points', () => {
    it('routes to redeemWithPoints with addressId and returns redemptionId + orderId on success', async () => {
      vi.mocked(redeemWithPoints).mockResolvedValue({ success: true, redemptionId: 'rdm-001', orderId: 'ord-001' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: JSON.stringify({ productId: 'prod-1', addressId: 'addr-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ redemptionId: 'rdm-001', orderId: 'ord-001' });
      expect(redeemWithPoints).toHaveBeenCalledWith(
        { productId: 'prod-1', userId: 'test-user-id', addressId: 'addr-1' },
        expect.anything(),
        expect.objectContaining({
          usersTable: '',
          productsTable: '',
          redemptionsTable: '',
          pointsRecordsTable: '',
          addressesTable: '',
          ordersTable: '',
        }),
      );
    });

    it('passes empty addressId when not provided in body', async () => {
      vi.mocked(redeemWithPoints).mockResolvedValue({ success: true, redemptionId: 'rdm-001', orderId: 'ord-001' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: JSON.stringify({ productId: 'prod-1' }),
      });
      await handler(event);
      expect(redeemWithPoints).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: '' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns error when redeemWithPoints fails with INSUFFICIENT_POINTS', async () => {
      vi.mocked(redeemWithPoints).mockResolvedValue({
        success: false,
        error: { code: 'INSUFFICIENT_POINTS', message: '积分不足' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: JSON.stringify({ productId: 'prod-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INSUFFICIENT_POINTS');
    });

    it('returns 400 when body is missing productId', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('POST /api/redemptions/code', () => {
    it('routes to redeemWithCode with addressId and returns redemptionId + orderId on success', async () => {
      vi.mocked(redeemWithCode).mockResolvedValue({ success: true, redemptionId: 'rdm-002', orderId: 'ord-002' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/code',
        body: JSON.stringify({ productId: 'prod-2', code: 'CODE123', addressId: 'addr-2' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ redemptionId: 'rdm-002', orderId: 'ord-002' });
      expect(redeemWithCode).toHaveBeenCalledWith(
        { productId: 'prod-2', code: 'CODE123', userId: 'test-user-id', addressId: 'addr-2' },
        expect.anything(),
        expect.objectContaining({
          codesTable: '',
          productsTable: '',
          redemptionsTable: '',
          addressesTable: '',
          ordersTable: '',
        }),
      );
    });

    it('passes empty addressId when not provided in body', async () => {
      vi.mocked(redeemWithCode).mockResolvedValue({ success: true, redemptionId: 'rdm-002', orderId: 'ord-002' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/code',
        body: JSON.stringify({ productId: 'prod-2', code: 'CODE123' }),
      });
      await handler(event);
      expect(redeemWithCode).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: '' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns error when redeemWithCode fails with CODE_PRODUCT_MISMATCH', async () => {
      vi.mocked(redeemWithCode).mockResolvedValue({
        success: false,
        error: { code: 'CODE_PRODUCT_MISMATCH', message: '兑换码与商品不匹配' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/code',
        body: JSON.stringify({ productId: 'prod-2', code: 'BAD' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('CODE_PRODUCT_MISMATCH');
    });

    it('returns 400 when body is missing productId or code', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/code',
        body: JSON.stringify({ productId: 'prod-2' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/code',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/redemptions/history', () => {
    it('routes to getRedemptionHistory and returns items with page-based pagination', async () => {
      const mockItems = [
        {
          redemptionId: 'rdm-001',
          userId: 'test-user-id',
          productId: 'prod-1',
          productName: 'Test Product',
          method: 'points' as const,
          pointsSpent: 100,
          status: 'success' as const,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(getRedemptionHistory).mockResolvedValue({
        success: true,
        items: mockItems,
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/redemptions/history',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toEqual(mockItems);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(getRedemptionHistory).toHaveBeenCalledWith(
        'test-user-id',
        expect.anything(),
        '',
        '',
        { page: undefined, pageSize: undefined },
      );
    });

    it('passes page and pageSize from query params', async () => {
      vi.mocked(getRedemptionHistory).mockResolvedValue({
        success: true,
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/redemptions/history',
        queryStringParameters: { page: '2', pageSize: '10' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(10);
      expect(body.total).toBe(0);
      expect(body.items).toEqual([]);
      expect(getRedemptionHistory).toHaveBeenCalledWith(
        'test-user-id',
        expect.anything(),
        '',
        '',
        { page: 2, pageSize: 10 },
      );
    });

    it('returns error when history query fails', async () => {
      vi.mocked(getRedemptionHistory).mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '查询失败' },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/redemptions/history',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Error handling', () => {
    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(redeemWithPoints).mockRejectedValue(new Error('DynamoDB timeout'));
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/redemptions/points',
        body: JSON.stringify({ productId: 'prod-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in all responses', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/redemptions/unknown' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });
});
