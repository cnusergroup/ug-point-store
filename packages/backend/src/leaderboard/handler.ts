import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { isOrderAdmin } from '@points-mall/shared';
import type { UserRole } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { validateRankingParams, getRanking } from './ranking';
import { validateAnnouncementParams, getAnnouncements } from './announcements';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const BATCH_DISTRIBUTIONS_TABLE = process.env.BATCH_DISTRIBUTIONS_TABLE ?? '';

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
  const status = statusCode ?? 400;
  return jsonResponse(status, { code, message });
}

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  // OrderAdmin role check — OrderAdmin cannot access leaderboard
  if (isOrderAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '无权访问', 403);
  }

  const method = event.httpMethod;
  const path = event.path;

  // GET /api/leaderboard/ranking
  if (method === 'GET' && path === '/api/leaderboard/ranking') {
    return await handleGetRanking(event);
  }

  // GET /api/leaderboard/announcements
  if (method === 'GET' && path === '/api/leaderboard/announcements') {
    return await handleGetAnnouncements(event);
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

// ---- Route Handlers ----

async function handleGetRanking(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const query = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;

  const validation = validateRankingParams(query);
  if (!validation.valid) {
    return errorResponse(validation.error!.code, validation.error!.message, 400);
  }

  const result = await getRanking(validation.options!, dynamoClient, USERS_TABLE);

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, {
    items: result.items,
    lastKey: result.lastKey,
  });
}

async function handleGetAnnouncements(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const query = (event.queryStringParameters ?? {}) as Record<string, string | undefined>;

  const validation = validateAnnouncementParams(query);
  if (!validation.valid) {
    return errorResponse(validation.error!.code, validation.error!.message, 400);
  }

  const result = await getAnnouncements(validation.options!, dynamoClient, {
    pointsRecordsTable: POINTS_RECORDS_TABLE,
    usersTable: USERS_TABLE,
    batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
  });

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, {
    items: result.items,
    lastKey: result.lastKey,
  });
}
