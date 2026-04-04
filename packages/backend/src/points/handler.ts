import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ErrorHttpStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { redeemCode } from './redeem-code';
import { getPointsBalance } from './balance';
import { getPointsRecords } from './records';
import { getUserProfile } from '../user/profile';
import { submitClaim, listMyClaims } from '../claims/submit';
import { getClaimUploadUrl } from '../claims/images';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const CODES_TABLE = process.env.CODES_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const CLAIMS_TABLE = process.env.CLAIMS_TABLE ?? '';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';

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

  // POST /api/points/redeem-code
  if (method === 'POST' && path === '/api/points/redeem-code') {
    return await handleRedeemCode(event);
  }

  // GET /api/points/balance
  if (method === 'GET' && path === '/api/points/balance') {
    return await handleGetBalance(event);
  }

  // GET /api/points/records
  if (method === 'GET' && path === '/api/points/records') {
    return await handleGetRecords(event);
  }

  // GET /api/user/profile
  if (method === 'GET' && path === '/api/user/profile') {
    return await handleGetProfile(event);
  }

  // POST /api/claims
  if (method === 'POST' && path === '/api/claims') {
    return await handleSubmitClaim(event);
  }

  // POST /api/claims/upload-url
  if (method === 'POST' && path === '/api/claims/upload-url') {
    return await handleClaimUploadUrl(event);
  }

  // GET /api/claims
  if (method === 'GET' && path === '/api/claims') {
    return await handleListMyClaims(event);
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

async function handleRedeemCode(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.code) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: code', 400);
  }

  const result = await redeemCode(
    { code: body.code as string, userId: event.user.userId },
    dynamoClient,
    {
      codesTable: CODES_TABLE,
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
    },
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { earnedPoints: result.earnedPoints });
}

async function handleGetBalance(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getPointsBalance(event.user.userId, dynamoClient, USERS_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { points: result.points });
}

async function handleGetRecords(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const page = event.queryStringParameters?.page
    ? parseInt(event.queryStringParameters.page, 10)
    : undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;

  const result = await getPointsRecords(
    event.user.userId,
    dynamoClient,
    POINTS_RECORDS_TABLE,
    { page, pageSize },
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { items: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
}

async function handleGetProfile(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getUserProfile(event.user.userId, dynamoClient, USERS_TABLE);

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { success: true, profile: result.profile });
}

async function handleSubmitClaim(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  // Fetch user profile to get nickname
  const profileResult = await getUserProfile(event.user.userId, dynamoClient, USERS_TABLE);
  const nickname = profileResult.success && profileResult.profile
    ? profileResult.profile.nickname
    : '';

  const result = await submitClaim(
    {
      userId: event.user.userId,
      userRoles: event.user.roles,
      userNickname: nickname,
      selectedRole: body.selectedRole as string | undefined,
      title: body.title as string,
      description: body.description as string,
      imageUrls: body.imageUrls as string[] | undefined,
      activityUrl: body.activityUrl as string | undefined,
    },
    dynamoClient,
    CLAIMS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(201, { success: true, claim: result.claim });
}

async function handleListMyClaims(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey ?? undefined;

  const result = await listMyClaims(
    { userId: event.user.userId, status, pageSize, lastKey },
    dynamoClient,
    CLAIMS_TABLE,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { claims: result.claims, lastKey: result.lastKey });
}

async function handleClaimUploadUrl(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.fileName || !body.contentType) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: fileName, contentType', 400);
  }

  const result = await getClaimUploadUrl(
    {
      userId: event.user.userId,
      fileName: body.fileName as string,
      contentType: body.contentType as string,
    },
    s3Client,
    IMAGES_BUCKET,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, result.data);
}
