import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock cart module
vi.mock('./cart', () => ({
  addToCart: vi.fn(),
  getCart: vi.fn(),
  updateCartItem: vi.fn(),
  deleteCartItem: vi.fn(),
}));

// Mock address module
vi.mock('./address', () => ({
  getAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  setDefaultAddress: vi.fn(),
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
import { addToCart, getCart, updateCartItem, deleteCartItem } from './cart';
import { getAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress } from './address';

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

describe('Cart Lambda Handler - Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('General routing', () => {
    it('returns 200 for OPTIONS preflight', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/cart' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('returns 404 for unknown routes', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/unknown' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
    });

    it('returns 500 on unexpected errors', async () => {
      vi.mocked(getCart).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({ httpMethod: 'GET', path: '/api/cart' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('includes CORS headers in responses', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/cart' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('GET /api/cart', () => {
    it('routes to getCart and returns cart data', async () => {
      const mockCart = {
        userId: 'test-user-id',
        items: [{ productId: 'p1', productName: 'Test', quantity: 2, subtotal: 200 }],
        totalPoints: 200,
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      vi.mocked(getCart).mockResolvedValue({ success: true, data: mockCart as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/cart' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockCart);
      expect(getCart).toHaveBeenCalledWith('test-user-id', expect.anything(), '', '');
    });

    it('returns error when getCart fails', async () => {
      vi.mocked(getCart).mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/cart' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /api/cart/items', () => {
    it('routes to addToCart with correct params', async () => {
      vi.mocked(addToCart).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/cart/items',
        body: JSON.stringify({ productId: 'prod-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('已加入购物车');
      expect(addToCart).toHaveBeenCalledWith('test-user-id', 'prod-1', expect.anything(), '', '', undefined, '');
    });

    it('passes selectedSize to addToCart when provided', async () => {
      vi.mocked(addToCart).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/cart/items',
        body: JSON.stringify({ productId: 'prod-1', selectedSize: 'L' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(addToCart).toHaveBeenCalledWith('test-user-id', 'prod-1', expect.anything(), '', '', 'L', '');
    });

    it('returns 400 when productId is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/cart/items',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/cart/items',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when addToCart fails', async () => {
      vi.mocked(addToCart).mockResolvedValue({
        success: false,
        error: { code: 'CODE_PRODUCT_NOT_CARTABLE', message: 'Code 专属商品不支持加入购物车' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/cart/items',
        body: JSON.stringify({ productId: 'code-prod' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('CODE_PRODUCT_NOT_CARTABLE');
    });
  });

  describe('PUT /api/cart/items/{productId}', () => {
    it('routes to updateCartItem with correct params', async () => {
      vi.mocked(updateCartItem).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/cart/items/prod-1',
        body: JSON.stringify({ quantity: 3 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('购物车已更新');
      expect(updateCartItem).toHaveBeenCalledWith('test-user-id', 'prod-1', 3, expect.anything(), '');
    });

    it('returns 400 when quantity is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/cart/items/prod-1',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/cart/items/prod-1',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('allows quantity of 0 (delete via update)', async () => {
      vi.mocked(updateCartItem).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/cart/items/prod-1',
        body: JSON.stringify({ quantity: 0 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(updateCartItem).toHaveBeenCalledWith('test-user-id', 'prod-1', 0, expect.anything(), '');
    });

    it('returns error when updateCartItem fails', async () => {
      vi.mocked(updateCartItem).mockResolvedValue({
        success: false,
        error: { code: 'CART_ITEM_NOT_FOUND', message: '购物车项不存在' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/cart/items/nonexistent',
        body: JSON.stringify({ quantity: 2 }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('CART_ITEM_NOT_FOUND');
    });
  });

  describe('DELETE /api/cart/items/{productId}', () => {
    it('routes to deleteCartItem with correct params', async () => {
      vi.mocked(deleteCartItem).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/cart/items/prod-1',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('商品已从购物车移除');
      expect(deleteCartItem).toHaveBeenCalledWith('test-user-id', 'prod-1', expect.anything(), '');
    });

    it('returns error when deleteCartItem fails', async () => {
      vi.mocked(deleteCartItem).mockResolvedValue({
        success: false,
        error: { code: 'CART_ITEM_NOT_FOUND', message: '购物车项不存在' },
      });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/cart/items/nonexistent',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('CART_ITEM_NOT_FOUND');
    });

    it('extracts productId from path correctly', async () => {
      vi.mocked(deleteCartItem).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/cart/items/abc-123-xyz',
      });
      await handler(event);
      expect(deleteCartItem).toHaveBeenCalledWith('test-user-id', 'abc-123-xyz', expect.anything(), '');
    });
  });

  describe('GET /api/addresses', () => {
    it('routes to getAddresses and returns address list', async () => {
      const mockAddresses = [
        { addressId: 'addr-1', recipientName: '张三', phone: '13800138000', detailAddress: '北京市', isDefault: true },
      ];
      vi.mocked(getAddresses).mockResolvedValue({ success: true, data: mockAddresses as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/addresses' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockAddresses);
      expect(getAddresses).toHaveBeenCalledWith('test-user-id', expect.anything(), '');
    });

    it('returns error when getAddresses fails', async () => {
      vi.mocked(getAddresses).mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/addresses' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /api/addresses', () => {
    it('routes to createAddress and returns created address', async () => {
      const mockAddress = { addressId: 'addr-new', recipientName: '张三', phone: '13800138000', detailAddress: '北京市' };
      vi.mocked(createAddress).mockResolvedValue({ success: true, data: mockAddress as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/addresses',
        body: JSON.stringify({ recipientName: '张三', phone: '13800138000', detailAddress: '北京市' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockAddress);
      expect(createAddress).toHaveBeenCalledWith('test-user-id', expect.objectContaining({ recipientName: '张三' }), expect.anything(), '');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({ httpMethod: 'POST', path: '/api/addresses', body: null });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when createAddress fails with validation error', async () => {
      vi.mocked(createAddress).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_PHONE', message: '手机号格式错误' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/addresses',
        body: JSON.stringify({ recipientName: '张三', phone: '12345', detailAddress: '北京市' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_PHONE');
    });
  });

  describe('PUT /api/addresses/{addressId}', () => {
    it('routes to updateAddress with correct params', async () => {
      const mockAddress = { addressId: 'addr-1', recipientName: '李四', phone: '13800138000', detailAddress: '上海市' };
      vi.mocked(updateAddress).mockResolvedValue({ success: true, data: mockAddress as any });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/addresses/addr-1',
        body: JSON.stringify({ recipientName: '李四', phone: '13800138000', detailAddress: '上海市' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockAddress);
      expect(updateAddress).toHaveBeenCalledWith('addr-1', 'test-user-id', expect.objectContaining({ recipientName: '李四' }), expect.anything(), '');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({ httpMethod: 'PUT', path: '/api/addresses/addr-1', body: null });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when address not found', async () => {
      vi.mocked(updateAddress).mockResolvedValue({
        success: false,
        error: { code: 'ADDRESS_NOT_FOUND', message: '收货地址不存在' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/addresses/nonexistent',
        body: JSON.stringify({ recipientName: '李四', phone: '13800138000', detailAddress: '上海市' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('ADDRESS_NOT_FOUND');
    });
  });

  describe('DELETE /api/addresses/{addressId}', () => {
    it('routes to deleteAddress with correct params', async () => {
      vi.mocked(deleteAddress).mockResolvedValue({ success: true });
      const event = makeEvent({ httpMethod: 'DELETE', path: '/api/addresses/addr-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('地址已删除');
      expect(deleteAddress).toHaveBeenCalledWith('addr-1', 'test-user-id', expect.anything(), '');
    });

    it('returns error when address not found', async () => {
      vi.mocked(deleteAddress).mockResolvedValue({
        success: false,
        error: { code: 'ADDRESS_NOT_FOUND', message: '收货地址不存在' },
      });
      const event = makeEvent({ httpMethod: 'DELETE', path: '/api/addresses/nonexistent' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('ADDRESS_NOT_FOUND');
    });

    it('extracts addressId from path correctly', async () => {
      vi.mocked(deleteAddress).mockResolvedValue({ success: true });
      const event = makeEvent({ httpMethod: 'DELETE', path: '/api/addresses/abc-123-xyz' });
      await handler(event);
      expect(deleteAddress).toHaveBeenCalledWith('abc-123-xyz', 'test-user-id', expect.anything(), '');
    });
  });

  describe('PATCH /api/addresses/{addressId}/default', () => {
    it('routes to setDefaultAddress with correct params', async () => {
      const mockAddress = { addressId: 'addr-1', recipientName: '张三', isDefault: true };
      vi.mocked(setDefaultAddress).mockResolvedValue({ success: true, data: mockAddress as any });
      const event = makeEvent({ httpMethod: 'PATCH', path: '/api/addresses/addr-1/default' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockAddress);
      expect(setDefaultAddress).toHaveBeenCalledWith('addr-1', 'test-user-id', expect.anything(), '');
    });

    it('returns error when address not found', async () => {
      vi.mocked(setDefaultAddress).mockResolvedValue({
        success: false,
        error: { code: 'ADDRESS_NOT_FOUND', message: '收货地址不存在' },
      });
      const event = makeEvent({ httpMethod: 'PATCH', path: '/api/addresses/nonexistent/default' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('ADDRESS_NOT_FOUND');
    });
  });
});
