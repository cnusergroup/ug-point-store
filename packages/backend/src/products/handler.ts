import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ErrorHttpStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { listProducts } from './list';
import { getProductDetail } from './detail';
import type { UserRole } from '@points-mall/shared';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

const PRODUCT_DETAIL_REGEX = /^\/api\/products\/([^/]+)$/;

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // GET /api/products
  if (method === 'GET' && path === '/api/products') {
    return await handleListProducts(event);
  }

  // GET /api/products/{id}
  if (method === 'GET') {
    const match = path.match(PRODUCT_DETAIL_REGEX);
    if (match) {
      return await handleGetProductDetail(match[1], event);
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

async function handleListProducts(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const type = params.type as 'points' | 'code_exclusive' | undefined;
  const roleFilter = params.roleFilter as UserRole | undefined;
  const userRoles = event.user.roles as UserRole[];

  const result = await listProducts(
    { type, roleFilter, userRoles },
    dynamoClient,
    PRODUCTS_TABLE,
  );

  return jsonResponse(200, result);
}

async function handleGetProductDetail(productId: string, _event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getProductDetail(productId, dynamoClient, PRODUCTS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 404;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}
