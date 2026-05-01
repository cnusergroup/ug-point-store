import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { S3Client } from '@aws-sdk/client-s3';
import { ErrorHttpStatus, ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { getFeatureToggles } from '../settings/feature-toggles';
import { isEmployeeStoreBlocked } from '../middleware/employee-store-check';
import { getInviteSettings } from '../settings/invite-settings';
import { redeemCode } from './redeem-code';
import { getPointsBalance } from './balance';
import { getPointsRecords } from './records';
import { getUserProfile } from '../user/profile';
import { submitClaim, listMyClaims } from '../claims/submit';
import { getClaimUploadUrl } from '../claims/images';
import { getTravelSettings } from '../travel/settings';
import { sendPointsEarnedEmail } from '../email/notifications';
import type { NotificationContext } from '../email/notifications';
import {
  getTravelQuota,
  submitTravelApplication,
  listMyTravelApplications,
  resubmitTravelApplication,
  validateTravelApplicationInput,
} from '../travel/apply';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const sesClient = new SESClient({});

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const CODES_TABLE = process.env.CODES_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const CLAIMS_TABLE = process.env.CLAIMS_TABLE ?? '';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';
const TRAVEL_APPLICATIONS_TABLE = process.env.TRAVEL_APPLICATIONS_TABLE ?? '';
const EMAIL_TEMPLATES_TABLE = process.env.EMAIL_TEMPLATES_TABLE ?? '';

const TRAVEL_APPLICATIONS_RESUBMIT_REGEX = /^\/api\/travel\/applications\/([^/]+)$/;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    if (isEmployeeStoreBlocked(event.user.isEmployee, toggles.employeeStoreEnabled)) {
      return errorResponse('EMPLOYEE_STORE_DISABLED', '员工商城功能暂时关闭', 403);
    }
    if (!toggles.codeRedemptionEnabled) {
      return errorResponse(ErrorCodes.FEATURE_DISABLED, ErrorMessages[ErrorCodes.FEATURE_DISABLED], 403);
    }
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
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    if (!toggles.pointsClaimEnabled) {
      return errorResponse(ErrorCodes.FEATURE_DISABLED, ErrorMessages[ErrorCodes.FEATURE_DISABLED], 403);
    }
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

  // GET /api/travel/quota
  if (method === 'GET' && path === '/api/travel/quota') {
    if (!event.user.roles.includes('Speaker')) {
      return errorResponse(ErrorCodes.TRAVEL_SPEAKER_ONLY, ErrorMessages[ErrorCodes.TRAVEL_SPEAKER_ONLY], 403);
    }
    return await handleGetTravelQuota(event);
  }

  // POST /api/travel/apply
  if (method === 'POST' && path === '/api/travel/apply') {
    if (!event.user.roles.includes('Speaker')) {
      return errorResponse(ErrorCodes.TRAVEL_SPEAKER_ONLY, ErrorMessages[ErrorCodes.TRAVEL_SPEAKER_ONLY], 403);
    }
    const travelSettings = await getTravelSettings(dynamoClient, USERS_TABLE);
    if (!travelSettings.travelSponsorshipEnabled) {
      return errorResponse(ErrorCodes.FEATURE_DISABLED, ErrorMessages[ErrorCodes.FEATURE_DISABLED], 403);
    }
    return await handleSubmitTravelApplication(event);
  }

  // GET /api/travel/my-applications
  if (method === 'GET' && path === '/api/travel/my-applications') {
    if (!event.user.roles.includes('Speaker')) {
      return errorResponse(ErrorCodes.TRAVEL_SPEAKER_ONLY, ErrorMessages[ErrorCodes.TRAVEL_SPEAKER_ONLY], 403);
    }
    return await handleListMyTravelApplications(event);
  }

  // PUT /api/travel/applications/{id}
  const resubmitMatch = path.match(TRAVEL_APPLICATIONS_RESUBMIT_REGEX);
  if (method === 'PUT' && resubmitMatch) {
    if (!event.user.roles.includes('Speaker')) {
      return errorResponse(ErrorCodes.TRAVEL_SPEAKER_ONLY, ErrorMessages[ErrorCodes.TRAVEL_SPEAKER_ONLY], 403);
    }
    return await handleResubmitTravelApplication(event, resubmitMatch[1]);
  }

  // GET /api/user/email-subscriptions
  if (method === 'GET' && path === '/api/user/email-subscriptions') {
    return await handleGetEmailSubscriptions(event);
  }

  // PUT /api/user/email-subscriptions
  if (method === 'PUT' && path === '/api/user/email-subscriptions') {
    return await handleUpdateEmailSubscriptions(event);
  }

  return errorResponse('NOT_FOUND', 'Route not found', 404);
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  // Public route: GET /api/settings/feature-toggles (no auth required)
  if (event.httpMethod === 'GET' && event.path === '/api/settings/feature-toggles') {
    try {
      const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
      return jsonResponse(200, toggles);
    } catch (err) {
      console.error('Failed to get feature toggles:', err);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
    }
  }

  // Public route: GET /api/settings/travel-sponsorship (no auth required)
  if (event.httpMethod === 'GET' && event.path === '/api/settings/travel-sponsorship') {
    try {
      const settings = await getTravelSettings(dynamoClient, USERS_TABLE);
      return jsonResponse(200, settings);
    } catch (err) {
      console.error('Failed to get travel sponsorship settings:', err);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
    }
  }

  // Public route: GET /api/settings/invite-settings (no auth required)
  if (event.httpMethod === 'GET' && event.path === '/api/settings/invite-settings') {
    try {
      const settings = await getInviteSettings(dynamoClient, USERS_TABLE);
      return jsonResponse(200, settings);
    } catch (err) {
      console.error('Failed to get invite settings:', err);
      return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
    }
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

  // Send points earned email notification (best-effort, never fails parent operation)
  try {
    const notificationCtx: NotificationContext = {
      sesClient,
      dynamoClient,
      emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
      usersTable: USERS_TABLE,
      senderEmail: 'store@awscommunity.cn',
    };
    await sendPointsEarnedEmail(
      notificationCtx,
      event.user.userId,
      result.earnedPoints ?? 0,
      '积分码兑换',
      result.newBalance ?? 0,
    );
  } catch (err) {
    console.error('[Email] Failed to send pointsEarned email after code redemption:', err);
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


async function handleGetTravelQuota(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const quota = await getTravelQuota(
    event.user.userId,
    dynamoClient,
    { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE, travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE },
  );

  return jsonResponse(200, quota);
}

async function handleSubmitTravelApplication(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const validation = validateTravelApplicationInput(body);
  if (!validation.valid) {
    return errorResponse(validation.error.code, validation.error.message, 400);
  }

  // Fetch user profile to get nickname
  const profileResult = await getUserProfile(event.user.userId, dynamoClient, USERS_TABLE);
  const nickname = profileResult.success && profileResult.profile
    ? profileResult.profile.nickname
    : '';

  const result = await submitTravelApplication(
    {
      userId: event.user.userId,
      userNickname: nickname,
      category: validation.data.category,
      communityRole: validation.data.communityRole,
      eventLink: validation.data.eventLink,
      cfpScreenshotUrl: validation.data.cfpScreenshotUrl,
      flightCost: validation.data.flightCost,
      hotelCost: validation.data.hotelCost,
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE,
    },
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(201, { success: true, application: result.application });
}

async function handleListMyTravelApplications(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey ?? undefined;

  const result = await listMyTravelApplications(
    { userId: event.user.userId, status, pageSize, lastKey },
    dynamoClient,
    TRAVEL_APPLICATIONS_TABLE,
  );

  return jsonResponse(200, { applications: result.applications, lastKey: result.lastKey });
}

async function handleResubmitTravelApplication(event: AuthenticatedEvent, applicationId: string): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const validation = validateTravelApplicationInput(body);
  if (!validation.valid) {
    return errorResponse(validation.error.code, validation.error.message, 400);
  }

  // Fetch user profile to get nickname
  const profileResult = await getUserProfile(event.user.userId, dynamoClient, USERS_TABLE);
  const nickname = profileResult.success && profileResult.profile
    ? profileResult.profile.nickname
    : '';

  const result = await resubmitTravelApplication(
    {
      applicationId,
      userId: event.user.userId,
      userNickname: nickname,
      category: validation.data.category,
      communityRole: validation.data.communityRole,
      eventLink: validation.data.eventLink,
      cfpScreenshotUrl: validation.data.cfpScreenshotUrl,
      flightCost: validation.data.flightCost,
      hotelCost: validation.data.hotelCost,
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE,
    },
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { success: true, application: result.application });
}

async function handleGetEmailSubscriptions(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: event.user.userId },
    }),
  );

  if (!result.Item) {
    return errorResponse('USER_NOT_FOUND', '用户不存在', 404);
  }

  const subscriptions = result.Item.emailSubscriptions ?? {};

  return jsonResponse(200, {
    newProduct: subscriptions.newProduct === true,
    newContent: subscriptions.newContent === true,
  });
}

async function handleUpdateEmailSubscriptions(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  // Validate that provided fields are booleans
  const updates: Record<string, boolean> = {};
  if ('newProduct' in body) {
    if (typeof body.newProduct !== 'boolean') {
      return errorResponse('INVALID_REQUEST', 'newProduct must be a boolean', 400);
    }
    updates.newProduct = body.newProduct;
  }
  if ('newContent' in body) {
    if (typeof body.newContent !== 'boolean') {
      return errorResponse('INVALID_REQUEST', 'newContent must be a boolean', 400);
    }
    updates.newContent = body.newContent;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('INVALID_REQUEST', 'At least one of newProduct or newContent is required', 400);
  }

  // First, ensure the emailSubscriptions map exists on the user record.
  // DynamoDB cannot SET nested attributes on a map that doesn't exist yet.
  await dynamoClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: event.user.userId },
      UpdateExpression: 'SET emailSubscriptions = if_not_exists(emailSubscriptions, :emptyMap)',
      ExpressionAttributeValues: { ':emptyMap': {} },
    }),
  );

  // Build update expression for only the provided fields
  const expressionParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};

  if ('newProduct' in updates) {
    expressionParts.push('emailSubscriptions.newProduct = :newProduct');
    expressionValues[':newProduct'] = updates.newProduct;
  }
  if ('newContent' in updates) {
    expressionParts.push('emailSubscriptions.newContent = :newContent');
    expressionValues[':newContent'] = updates.newContent;
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: event.user.userId },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeValues: expressionValues,
    }),
  );

  // Read back the full subscription state
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: event.user.userId },
    }),
  );

  const subscriptions = getResult.Item?.emailSubscriptions ?? {};

  return jsonResponse(200, {
    newProduct: subscriptions.newProduct === true,
    newContent: subscriptions.newContent === true,
  });
}
