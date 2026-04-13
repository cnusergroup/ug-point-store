import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock order module
vi.mock('./order', () => ({
  createOrder: vi.fn(),
  createDirectOrder: vi.fn(),
  getOrders: vi.fn(),
  getOrderDetail: vi.fn(),
}));

// Mock admin-order module
vi.mock('./admin-order', () => ({
  getAdminOrders: vi.fn(),
  getAdminOrderDetail: vi.fn(),
  updateShipping: vi.fn(),
  getOrderStats: vi.fn(),
}));

// Mock feature toggles
vi.mock('../settings/feature-toggles', () => ({
  getFeatureToggles: vi.fn(),
}));

// Mock auth middleware - inject user; roles controlled by mockUserRoles
let mockUserRoles: string[] = ['Speaker'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'test-user-id',
        email: 'test@example.com',
        roles: mockUserRoles,
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { createOrder, createDirectOrder, getOrders, getOrderDetail } from './order';
import { getAdminOrders, getAdminOrderDetail, updateShipping, getOrderStats } from './admin-order';
import { getFeatureToggles } from '../settings/feature-toggles';

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

describe('Order Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['Speaker'];
    // Default: adminOrdersEnabled = true so Admin users pass the toggle check
    vi.mocked(getFeatureToggles).mockResolvedValue({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      contentRolePermissions: {
        Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      },
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
    });
  });

  describe('General routing', () => {
    it('returns 200 for OPTIONS preflight', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/orders' });
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
      vi.mocked(getOrders).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({ httpMethod: 'GET', path: '/api/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('includes CORS headers in responses', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/orders' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });

  // ---- User Routes ----

  describe('POST /api/orders', () => {
    it('routes to createOrder with correct params', async () => {
      vi.mocked(createOrder).mockResolvedValue({ success: true, orderId: 'order-1' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders',
        body: JSON.stringify({
          items: [{ productId: 'p1', quantity: 2 }],
          addressId: 'addr-1',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).orderId).toBe('order-1');
      expect(createOrder).toHaveBeenCalledWith(
        'test-user-id',
        [{ productId: 'p1', quantity: 2 }],
        'addr-1',
        expect.anything(),
        expect.objectContaining({ ordersTable: '' }),
      );
    });

    it('returns 400 when items is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders',
        body: JSON.stringify({ addressId: 'addr-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when addressId is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders',
        body: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({ httpMethod: 'POST', path: '/api/orders', body: null });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns error when createOrder fails', async () => {
      vi.mocked(createOrder).mockResolvedValue({
        success: false,
        error: { code: 'INSUFFICIENT_POINTS', message: '积分不足' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders',
        body: JSON.stringify({
          items: [{ productId: 'p1', quantity: 1 }],
          addressId: 'addr-1',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INSUFFICIENT_POINTS');
    });
  });

  describe('POST /api/orders/direct', () => {
    it('routes to createDirectOrder with correct params', async () => {
      vi.mocked(createDirectOrder).mockResolvedValue({ success: true, orderId: 'order-2' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders/direct',
        body: JSON.stringify({ productId: 'p1', quantity: 1, addressId: 'addr-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).orderId).toBe('order-2');
      expect(createDirectOrder).toHaveBeenCalledWith(
        'test-user-id',
        'p1',
        1,
        'addr-1',
        expect.anything(),
        expect.objectContaining({ ordersTable: '' }),
        undefined,
      );
    });

    it('returns 400 when productId is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders/direct',
        body: JSON.stringify({ addressId: 'addr-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('defaults quantity to 1 when not provided', async () => {
      vi.mocked(createDirectOrder).mockResolvedValue({ success: true, orderId: 'order-3' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders/direct',
        body: JSON.stringify({ productId: 'p1', addressId: 'addr-1' }),
      });
      await handler(event);
      expect(createDirectOrder).toHaveBeenCalledWith(
        'test-user-id',
        'p1',
        1,
        'addr-1',
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('returns error when createDirectOrder fails', async () => {
      vi.mocked(createDirectOrder).mockResolvedValue({
        success: false,
        error: { code: 'OUT_OF_STOCK', message: '库存不足' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/orders/direct',
        body: JSON.stringify({ productId: 'p1', quantity: 1, addressId: 'addr-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('OUT_OF_STOCK');
    });
  });

  describe('GET /api/orders', () => {
    it('routes to getOrders with default pagination', async () => {
      vi.mocked(getOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getOrders).toHaveBeenCalledWith('test-user-id', 1, 10, expect.anything(), '');
    });

    it('passes page and pageSize query params', async () => {
      vi.mocked(getOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 2,
        pageSize: 5,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/orders',
        queryStringParameters: { page: '2', pageSize: '5' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getOrders).toHaveBeenCalledWith('test-user-id', 2, 5, expect.anything(), '');
    });
  });

  describe('GET /api/orders/{orderId}', () => {
    it('routes to getOrderDetail with correct params', async () => {
      const mockOrder = { orderId: 'order-1', userId: 'test-user-id', items: [], totalPoints: 100 };
      vi.mocked(getOrderDetail).mockResolvedValue({ success: true, order: mockOrder as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/orders/order-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).orderId).toBe('order-1');
      expect(getOrderDetail).toHaveBeenCalledWith('order-1', 'test-user-id', expect.anything(), '');
    });

    it('returns error when order not found', async () => {
      vi.mocked(getOrderDetail).mockResolvedValue({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/orders/nonexistent' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('ORDER_NOT_FOUND');
    });
  });

  // ---- Admin Routes ----

  describe('Admin routes - permission check', () => {
    it('returns 403 for non-admin user on admin routes', async () => {
      mockUserRoles = ['Speaker'];
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });

    it('allows Admin role to access admin routes', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('allows SuperAdmin role to access admin routes', async () => {
      mockUserRoles = ['SuperAdmin'];
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('returns 404 for unknown admin routes', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({ httpMethod: 'DELETE', path: '/api/admin/orders/order-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('GET /api/admin/orders', () => {
    beforeEach(() => {
      mockUserRoles = ['Admin'];
    });

    it('routes to getAdminOrders with default pagination', async () => {
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getAdminOrders).toHaveBeenCalledWith(undefined, 1, 10, expect.anything(), '');
    });

    it('passes status, page, and pageSize query params', async () => {
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 2,
        pageSize: 20,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/orders',
        queryStringParameters: { status: 'pending', page: '2', pageSize: '20' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getAdminOrders).toHaveBeenCalledWith('pending', 2, 20, expect.anything(), '');
    });
  });

  describe('GET /api/admin/orders/stats', () => {
    beforeEach(() => {
      mockUserRoles = ['Admin'];
    });

    it('routes to getOrderStats', async () => {
      const mockStats = { pending: 5, shipped: 3, inTransit: 2, delivered: 10, total: 20 };
      vi.mocked(getOrderStats).mockResolvedValue({ success: true, stats: mockStats });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders/stats' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockStats);
      expect(getOrderStats).toHaveBeenCalledWith(expect.anything(), '');
    });
  });

  describe('GET /api/admin/orders/{orderId}', () => {
    beforeEach(() => {
      mockUserRoles = ['Admin'];
    });

    it('routes to getAdminOrderDetail with correct params', async () => {
      const mockOrder = { orderId: 'order-1', userId: 'user-1', items: [], totalPoints: 100 };
      vi.mocked(getAdminOrderDetail).mockResolvedValue({ success: true, order: mockOrder as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders/order-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).orderId).toBe('order-1');
      expect(getAdminOrderDetail).toHaveBeenCalledWith('order-1', expect.anything(), '');
    });

    it('returns error when order not found', async () => {
      vi.mocked(getAdminOrderDetail).mockResolvedValue({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '订单不存在' },
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders/nonexistent' });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('ORDER_NOT_FOUND');
    });
  });

  describe('PATCH /api/admin/orders/{orderId}/shipping', () => {
    beforeEach(() => {
      mockUserRoles = ['Admin'];
    });

    it('routes to updateShipping with correct params', async () => {
      vi.mocked(updateShipping).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/orders/order-1/shipping',
        body: JSON.stringify({ status: 'shipped', trackingNumber: 'SF123456', remark: '已发货' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('物流状态更新成功');
      expect(updateShipping).toHaveBeenCalledWith(
        'order-1',
        'shipped',
        'SF123456',
        '已发货',
        'test-user-id',
        expect.anything(),
        '',
      );
    });

    it('returns 400 when status is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/orders/order-1/shipping',
        body: JSON.stringify({ trackingNumber: 'SF123456' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/orders/order-1/shipping',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns error when updateShipping fails', async () => {
      vi.mocked(updateShipping).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: '物流状态不可回退' },
      });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/orders/order-1/shipping',
        body: JSON.stringify({ status: 'pending' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ---- OrderAdmin Routes ----

  describe('OrderAdmin access to order admin endpoints', () => {
    beforeEach(() => {
      mockUserRoles = ['OrderAdmin'];
    });

    it('OrderAdmin can access GET /api/admin/orders', async () => {
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(getAdminOrders).toHaveBeenCalledWith(undefined, 1, 10, expect.anything(), '');
    });

    it('OrderAdmin can access GET /api/admin/orders/stats', async () => {
      const mockStats = { pending: 5, shipped: 3, inTransit: 2, delivered: 10, total: 20 };
      vi.mocked(getOrderStats).mockResolvedValue({ success: true, stats: mockStats });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders/stats' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockStats);
    });

    it('OrderAdmin can access GET /api/admin/orders/:id', async () => {
      const mockOrder = { orderId: 'order-1', userId: 'user-1', items: [], totalPoints: 100 };
      vi.mocked(getAdminOrderDetail).mockResolvedValue({ success: true, order: mockOrder as any });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders/order-1' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).orderId).toBe('order-1');
      expect(getAdminOrderDetail).toHaveBeenCalledWith('order-1', expect.anything(), '');
    });

    it('OrderAdmin can access PATCH /api/admin/orders/:id/shipping', async () => {
      vi.mocked(updateShipping).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'PATCH',
        path: '/api/admin/orders/order-1/shipping',
        body: JSON.stringify({ status: 'shipped', trackingNumber: 'SF123456', remark: '已发货' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('物流状态更新成功');
      expect(updateShipping).toHaveBeenCalledWith(
        'order-1',
        'shipped',
        'SF123456',
        '已发货',
        'test-user-id',
        expect.anything(),
        '',
      );
    });

    it('OrderAdmin bypasses adminOrdersEnabled toggle when disabled', async () => {
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: false,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: false,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        contentRolePermissions: {
          Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      });
      vi.mocked(getAdminOrders).mockResolvedValue({
        success: true,
        orders: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      // getFeatureToggles should NOT be called for OrderAdmin
      expect(getFeatureToggles).not.toHaveBeenCalled();
    });

    it('Admin is blocked when adminOrdersEnabled toggle is disabled', async () => {
      mockUserRoles = ['Admin'];
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: false,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: false,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        contentRolePermissions: {
          Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      });
      const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/orders' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(getFeatureToggles).toHaveBeenCalled();
    });
  });
});

