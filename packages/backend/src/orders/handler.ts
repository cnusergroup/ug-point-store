import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ErrorHttpStatus, hasAdminAccess, isSuperAdmin } from '@points-mall/shared';
import type { UserRole, ShippingStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { createOrder, createDirectOrder, getOrders, getOrderDetail } from './order';
import { getAdminOrders, getAdminOrderDetail, updateShipping, getOrderStats } from './admin-order';
import { getFeatureToggles } from '../settings/feature-toggles';
import type { OrderTableNames } from './order';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';
const ORDERS_TABLE = process.env.ORDERS_TABLE ?? '';
const CART_TABLE = process.env.CART_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE ?? '';

const tables: OrderTableNames = {
  usersTable: USERS_TABLE,
  productsTable: PRODUCTS_TABLE,
  ordersTable: ORDERS_TABLE,
  cartTable: CART_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  addressesTable: ADDRESSES_TABLE,
};

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(code: string, message: string, statusCode?: number): APIGatewayProxyResult {
  const status = statusCode ?? (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
  return jsonResponse(status, { code, message });
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

// Path patterns for routes with path parameters
const ORDER_DETAIL_REGEX = /^\/api\/orders\/([^/]+)$/;
const ADMIN_ORDER_DETAIL_REGEX = /^\/api\/admin\/orders\/([^/]+)$/;
const ADMIN_ORDER_SHIPPING_REGEX = /^\/api\/admin\/orders\/([^/]+)\/shipping$/;

function isAdmin(event: AuthenticatedEvent): boolean {
  return hasAdminAccess(event.user.roles as UserRole[]);
}

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // ---- Admin Routes (require admin role) ----
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(event)) {
      return errorResponse('FORBIDDEN', '需要管理员权限', 403);
    }

    // Non-SuperAdmin: check adminOrdersEnabled toggle
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
      if (!toggles.adminOrdersEnabled) {
        return errorResponse('FORBIDDEN', '管理员暂无订单管理权限', 403);
      }
    }

    // GET /api/admin/orders/stats (must be checked before the detail regex)
    if (method === 'GET' && path === '/api/admin/orders/stats') {
      return await handleGetOrderStats();
    }

    // PATCH /api/admin/orders/{orderId}/shipping
    if (method === 'PATCH') {
      const shippingMatch = path.match(ADMIN_ORDER_SHIPPING_REGEX);
      if (shippingMatch) {
        return await handleUpdateShipping(shippingMatch[1], event);
      }
    }

    // GET /api/admin/orders/{orderId}
    if (method === 'GET') {
      const detailMatch = path.match(ADMIN_ORDER_DETAIL_REGEX);
      if (detailMatch) {
        return await handleGetAdminOrderDetail(detailMatch[1]);
      }
    }

    // GET /api/admin/orders
    if (method === 'GET' && path === '/api/admin/orders') {
      return await handleGetAdminOrders(event);
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  }

  // ---- User Routes ----

  // POST /api/orders/direct
  if (method === 'POST' && path === '/api/orders/direct') {
    return await handleCreateDirectOrder(event);
  }

  // POST /api/orders
  if (method === 'POST' && path === '/api/orders') {
    return await handleCreateOrder(event);
  }

  // GET /api/orders/{orderId}
  if (method === 'GET') {
    const detailMatch = path.match(ORDER_DETAIL_REGEX);
    if (detailMatch) {
      return await handleGetOrderDetail(detailMatch[1], event);
    }
  }

  // GET /api/orders
  if (method === 'GET' && path === '/api/orders') {
    return await handleGetOrders(event);
  }

  return errorResponse('NOT_FOUND', 'Route not found', 404);
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  try {
    return await authenticatedHandler(event);
  } catch (err) {
    console.error('Unhandled error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

// ---- User Route Handlers ----

async function handleCreateOrder(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !Array.isArray(body.items) || !body.addressId) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: items (array), addressId', 400);
  }

  const result = await createOrder(
    event.user.userId,
    body.items as { productId: string; quantity: number; selectedSize?: string }[],
    body.addressId as string,
    dynamoClient,
    tables,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { orderId: result.orderId });
}

async function handleCreateDirectOrder(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.productId || !body.addressId) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: productId, addressId', 400);
  }

  const quantity = (body.quantity as number) ?? 1;

  const result = await createDirectOrder(
    event.user.userId,
    body.productId as string,
    quantity,
    body.addressId as string,
    dynamoClient,
    tables,
    body.selectedSize as string | undefined,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { orderId: result.orderId });
}

async function handleGetOrders(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const page = event.queryStringParameters?.page
    ? parseInt(event.queryStringParameters.page, 10)
    : 1;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : 10;

  const result = await getOrders(event.user.userId, page, pageSize, dynamoClient, ORDERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, {
    orders: result.orders,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}

async function handleGetOrderDetail(orderId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getOrderDetail(orderId, event.user.userId, dynamoClient, ORDERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.order);
}

// ---- Admin Route Handlers ----

async function handleGetAdminOrders(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as ShippingStatus | undefined;
  const page = event.queryStringParameters?.page
    ? parseInt(event.queryStringParameters.page, 10)
    : 1;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : 10;

  const result = await getAdminOrders(status, page, pageSize, dynamoClient, ORDERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, {
    orders: result.orders,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}

async function handleGetAdminOrderDetail(orderId: string): Promise<APIGatewayProxyResult> {
  const result = await getAdminOrderDetail(orderId, dynamoClient, ORDERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.order);
}

async function handleUpdateShipping(orderId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.status) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: status', 400);
  }

  const result = await updateShipping(
    orderId,
    body.status as ShippingStatus,
    body.trackingNumber as string | undefined,
    body.remark as string | undefined,
    event.user.userId,
    dynamoClient,
    ORDERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '物流状态更新成功' });
}

async function handleGetOrderStats(): Promise<APIGatewayProxyResult> {
  const result = await getOrderStats(dynamoClient, ORDERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.stats);
}
