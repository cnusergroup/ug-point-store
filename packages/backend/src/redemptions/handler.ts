import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ErrorHttpStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { redeemWithPoints } from './points-redemption';
import { redeemWithCode } from './code-redemption';
import { getRedemptionHistory } from './history';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';
const CODES_TABLE = process.env.CODES_TABLE ?? '';
const REDEMPTIONS_TABLE = process.env.REDEMPTIONS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const ADDRESSES_TABLE = process.env.ADDRESSES_TABLE ?? '';
const ORDERS_TABLE = process.env.ORDERS_TABLE ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // POST /api/redemptions/points
  if (method === 'POST' && path === '/api/redemptions/points') {
    return await handleRedeemWithPoints(event);
  }

  // POST /api/redemptions/code
  if (method === 'POST' && path === '/api/redemptions/code') {
    return await handleRedeemWithCode(event);
  }

  // GET /api/redemptions/history
  if (method === 'GET' && path === '/api/redemptions/history') {
    return await handleGetHistory(event);
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

async function handleRedeemWithPoints(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.productId) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: productId', 400);
  }

  const result = await redeemWithPoints(
    {
      productId: body.productId as string,
      userId: event.user.userId,
      addressId: (body.addressId as string) ?? '',
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      productsTable: PRODUCTS_TABLE,
      redemptionsTable: REDEMPTIONS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      addressesTable: ADDRESSES_TABLE,
      ordersTable: ORDERS_TABLE,
    },
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { redemptionId: result.redemptionId, orderId: result.orderId });
}

async function handleRedeemWithCode(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.productId || !body.code) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: productId, code', 400);
  }

  const result = await redeemWithCode(
    {
      productId: body.productId as string,
      code: body.code as string,
      userId: event.user.userId,
      addressId: (body.addressId as string) ?? '',
    },
    dynamoClient,
    {
      codesTable: CODES_TABLE,
      productsTable: PRODUCTS_TABLE,
      redemptionsTable: REDEMPTIONS_TABLE,
      addressesTable: ADDRESSES_TABLE,
      ordersTable: ORDERS_TABLE,
    },
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { redemptionId: result.redemptionId, orderId: result.orderId });
}

async function handleGetHistory(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const page = event.queryStringParameters?.page
    ? parseInt(event.queryStringParameters.page, 10)
    : undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;

  const result = await getRedemptionHistory(
    event.user.userId,
    dynamoClient,
    REDEMPTIONS_TABLE,
    ORDERS_TABLE,
    { page, pageSize },
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { items: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
}
