import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ErrorHttpStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { addToCart, getCart, updateCartItem, deleteCartItem } from './cart';
import { getAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress } from './address';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const CART_TABLE = process.env.CART_TABLE ?? '';
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';
const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE ?? '';
const ORDERS_TABLE = process.env.ORDERS_TABLE ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
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
const CART_ITEM_REGEX = /^\/api\/cart\/items\/([^/]+)$/;
const ADDRESS_REGEX = /^\/api\/addresses\/([^/]+)$/;
const ADDRESS_DEFAULT_REGEX = /^\/api\/addresses\/([^/]+)\/default$/;

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // ---- Cart Routes ----

  // GET /api/cart
  if (method === 'GET' && path === '/api/cart') {
    return await handleGetCart(event);
  }

  // POST /api/cart/items
  if (method === 'POST' && path === '/api/cart/items') {
    return await handleAddToCart(event);
  }

  // PUT /api/cart/items/{productId}
  if (method === 'PUT') {
    const cartMatch = path.match(CART_ITEM_REGEX);
    if (cartMatch) {
      return await handleUpdateCartItem(cartMatch[1], event);
    }
  }

  // DELETE /api/cart/items/{productId}
  if (method === 'DELETE') {
    const cartMatch = path.match(CART_ITEM_REGEX);
    if (cartMatch) {
      return await handleDeleteCartItem(cartMatch[1], event);
    }
  }

  // ---- Address Routes ----

  // PATCH /api/addresses/{addressId}/default
  if (method === 'PATCH') {
    const defaultMatch = path.match(ADDRESS_DEFAULT_REGEX);
    if (defaultMatch) {
      return await handleSetDefaultAddress(defaultMatch[1], event);
    }
  }

  // GET /api/addresses
  if (method === 'GET' && path === '/api/addresses') {
    return await handleGetAddresses(event);
  }

  // POST /api/addresses
  if (method === 'POST' && path === '/api/addresses') {
    return await handleCreateAddress(event);
  }

  // PUT /api/addresses/{addressId}
  if (method === 'PUT') {
    const addressMatch = path.match(ADDRESS_REGEX);
    if (addressMatch) {
      return await handleUpdateAddress(addressMatch[1], event);
    }
  }

  // DELETE /api/addresses/{addressId}
  if (method === 'DELETE') {
    const addressMatch = path.match(ADDRESS_REGEX);
    if (addressMatch) {
      return await handleDeleteAddress(addressMatch[1], event);
    }
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

// ---- Cart Route Handlers ----

async function handleGetCart(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getCart(event.user.userId, dynamoClient, CART_TABLE, PRODUCTS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}

async function handleAddToCart(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.productId) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: productId', 400);
  }

  const result = await addToCart(
    event.user.userId,
    body.productId as string,
    dynamoClient,
    CART_TABLE,
    PRODUCTS_TABLE,
    body.selectedSize as string | undefined,
    ORDERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '已加入购物车' });
}

async function handleUpdateCartItem(productId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || body.quantity === undefined) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: quantity', 400);
  }

  const result = await updateCartItem(
    event.user.userId,
    productId,
    body.quantity as number,
    dynamoClient,
    CART_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '购物车已更新' });
}

async function handleDeleteCartItem(productId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await deleteCartItem(
    event.user.userId,
    productId,
    dynamoClient,
    CART_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '商品已从购物车移除' });
}

// ---- Address Route Handlers ----

async function handleGetAddresses(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getAddresses(event.user.userId, dynamoClient, ADDRESSES_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}

async function handleCreateAddress(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  const result = await createAddress(
    event.user.userId,
    body as any,
    dynamoClient,
    ADDRESSES_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}

async function handleUpdateAddress(addressId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  const result = await updateAddress(
    addressId,
    event.user.userId,
    body as any,
    dynamoClient,
    ADDRESSES_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}

async function handleDeleteAddress(addressId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await deleteAddress(
    addressId,
    event.user.userId,
    dynamoClient,
    ADDRESSES_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '地址已删除' });
}

async function handleSetDefaultAddress(addressId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await setDefaultAddress(
    addressId,
    event.user.userId,
    dynamoClient,
    ADDRESSES_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}
