import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock the product modules
vi.mock('./list', () => ({
  listProducts: vi.fn(),
}));
vi.mock('./detail', () => ({
  getProductDetail: vi.fn(),
}));

// Mock auth middleware - wrap the inner handler so we can inject user
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
import { listProducts } from './list';
import { getProductDetail } from './detail';

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

describe('Product Lambda Handler - Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for unknown routes', async () => {
    const event = makeEvent({ httpMethod: 'GET', path: '/api/products/unknown/extra' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/products' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for POST method on products', async () => {
    const event = makeEvent({ httpMethod: 'POST', path: '/api/products' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  describe('GET /api/products', () => {
    it('routes to listProducts and returns product list', async () => {
      const mockResult = {
        items: [{ productId: 'p1', name: 'Test Product', locked: false }],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      vi.mocked(listProducts).mockResolvedValue(mockResult as any);
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockResult);
      expect(listProducts).toHaveBeenCalledWith(
        { type: undefined, roleFilter: undefined, userRoles: ['Speaker'] },
        expect.anything(),
        '',
      );
    });

    it('passes type query param to listProducts', async () => {
      vi.mocked(listProducts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/products',
        queryStringParameters: { type: 'points' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listProducts).toHaveBeenCalledWith(
        { type: 'points', roleFilter: undefined, userRoles: ['Speaker'] },
        expect.anything(),
        '',
      );
    });

    it('passes roleFilter query param to listProducts', async () => {
      vi.mocked(listProducts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/products',
        queryStringParameters: { roleFilter: 'Volunteer' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listProducts).toHaveBeenCalledWith(
        { type: undefined, roleFilter: 'Volunteer', userRoles: ['Speaker'] },
        expect.anything(),
        '',
      );
    });

    it('passes both type and roleFilter query params', async () => {
      vi.mocked(listProducts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/products',
        queryStringParameters: { type: 'code_exclusive', roleFilter: 'Speaker' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listProducts).toHaveBeenCalledWith(
        { type: 'code_exclusive', roleFilter: 'Speaker', userRoles: ['Speaker'] },
        expect.anything(),
        '',
      );
    });
  });

  describe('GET /api/products/{id}', () => {
    it('routes to getProductDetail and returns product data', async () => {
      const mockProduct = { productId: 'p1', name: 'Test', type: 'points', status: 'active' };
      vi.mocked(getProductDetail).mockResolvedValue({ success: true, data: mockProduct as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products/p1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockProduct);
      expect(getProductDetail).toHaveBeenCalledWith('p1', expect.anything(), '');
    });

    it('returns 404 when product not found', async () => {
      vi.mocked(getProductDetail).mockResolvedValue({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: '商品不存在' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products/nonexistent' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('PRODUCT_NOT_FOUND');
    });

    it('extracts productId from path correctly', async () => {
      vi.mocked(getProductDetail).mockResolvedValue({
        success: true,
        data: { productId: 'abc-123' } as any,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products/abc-123' });
      await handler(event);
      expect(getProductDetail).toHaveBeenCalledWith('abc-123', expect.anything(), '');
    });
  });

  describe('Error handling', () => {
    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(listProducts).mockRejectedValue(new Error('DynamoDB timeout'));
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in all responses', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/products/unknown/extra' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });

    it('includes CORS headers in OPTIONS response', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/products' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      });
    });
  });
});
