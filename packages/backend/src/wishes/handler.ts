import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages, ErrorHttpStatus } from '@points-mall/shared';
import type { UserRole } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { getFeatureToggles } from '../settings/feature-toggles';
import {
  createWish,
  voteWish,
  reviewWish,
  updateWishStatus,
  listWishes,
  getMyWishes,
  updateWish,
  deleteWish,
  getMonthlyWishCount,
} from './wish-service';
import type { WishServiceTables, ListWishesInput, UpdateWishStatusInput } from './wish-service';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Environment variables
const USERS_TABLE = process.env.USERS_TABLE ?? '';
const WISHES_TABLE = process.env.WISHES_TABLE ?? '';
const WISH_VOTES_TABLE = process.env.WISH_VOTES_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';

const tables: WishServiceTables = {
  wishesTable: WISHES_TABLE,
  wishVotesTable: WISH_VOTES_TABLE,
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
};

// ---- CORS Headers ----

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

// ---- Response Helpers ----

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

// ---- Route Regex Patterns ----

// User routes
const WISH_VOTE_REGEX = /^\/api\/wishes\/([^/]+)\/vote$/;
const WISH_BY_ID_REGEX = /^\/api\/wishes\/([^/]+)$/;

// Admin routes
const ADMIN_WISH_REVIEW_REGEX = /^\/api\/admin\/wishes\/([^/]+)\/review$/;
const ADMIN_WISH_STATUS_REGEX = /^\/api\/admin\/wishes\/([^/]+)\/status$/;

// ---- Auth Helpers ----

/**
 * Check if the authenticated user has Admin or SuperAdmin role.
 */
function isAdminUser(event: AuthenticatedEvent): boolean {
  return event.user.roles.some(r => r === 'Admin' || r === 'SuperAdmin');
}

/**
 * Check if the authenticated user has SuperAdmin role.
 */
function isSuperAdminUser(event: AuthenticatedEvent): boolean {
  return event.user.roles.some(r => r === 'SuperAdmin');
}

// ---- Handler ----

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // OPTIONS preflight (handled by API Gateway, but just in case)
  if (method === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  // ---- POST routes ----
  if (method === 'POST') {
    // POST /api/wishes — submit a new wish
    if (path === '/api/wishes') {
      return await handleCreateWish(event);
    }

    // POST /api/wishes/:wishId/vote — vote for a wish
    const voteMatch = path.match(WISH_VOTE_REGEX);
    if (voteMatch) {
      return await handleVoteWish(voteMatch[1], event);
    }
  }

  // ---- GET routes ----
  if (method === 'GET') {
    // GET /api/wishes/mine/monthly-count — current user's monthly wish count
    if (path === '/api/wishes/mine/monthly-count') {
      return await handleGetMonthlyCount(event);
    }

    // GET /api/wishes/mine — my wishes (must check before generic /api/wishes/:wishId)
    if (path === '/api/wishes/mine') {
      return await handleGetMyWishes(event);
    }

    // GET /api/wishes — public wish list
    if (path === '/api/wishes') {
      return await handleListWishes(event);
    }

    // GET /api/admin/wishes — admin wish list (SuperAdmin only)
    if (path === '/api/admin/wishes') {
      if (!isSuperAdminUser(event)) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleAdminListWishes(event);
    }
  }

  // ---- PUT routes ----
  if (method === 'PUT') {
    // PUT /api/wishes/:wishId — edit a wish
    const editMatch = path.match(WISH_BY_ID_REGEX);
    if (editMatch) {
      return await handleUpdateWish(editMatch[1], event);
    }
  }

  // ---- DELETE routes ----
  if (method === 'DELETE') {
    // DELETE /api/wishes/:wishId — delete a wish
    const deleteMatch = path.match(WISH_BY_ID_REGEX);
    if (deleteMatch) {
      return await handleDeleteWish(deleteMatch[1], event);
    }
  }

  // ---- PATCH routes (admin) ----
  if (method === 'PATCH') {
    // PATCH /api/admin/wishes/:wishId/review — review a wish (approve/reject)
    const reviewMatch = path.match(ADMIN_WISH_REVIEW_REGEX);
    if (reviewMatch) {
      if (!isSuperAdminUser(event)) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleReviewWish(reviewMatch[1], event);
    }

    // PATCH /api/admin/wishes/:wishId/status — update wish status (adopt/fulfill/close)
    const statusMatch = path.match(ADMIN_WISH_STATUS_REGEX);
    if (statusMatch) {
      if (!isSuperAdminUser(event)) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateWishStatus(statusMatch[1], event);
    }
  }

  // No matching route
  return errorResponse('NOT_FOUND', '路由不存在', 404);
});

// ---- Route Handlers ----

/**
 * POST /api/wishes — Submit a new wish.
 * Requires feature toggle check (wishPoolEnabled).
 */
async function handleCreateWish(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const featureToggles = await getFeatureToggles(dynamoClient, USERS_TABLE);

  const result = await createWish(
    {
      userId: event.user.userId,
      title: body.title as string,
      description: body.description as string,
      imageUrl: body.imageUrl as string | undefined,
    },
    dynamoClient,
    tables,
    featureToggles,
  );

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(201, { wish: result.wish });
}

/**
 * POST /api/wishes/:wishId/vote — Vote for a wish.
 * Requires feature toggle check (wishPoolEnabled).
 */
async function handleVoteWish(wishId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const featureToggles = await getFeatureToggles(dynamoClient, USERS_TABLE);

  const result = await voteWish(
    wishId,
    event.user.userId,
    dynamoClient,
    tables,
    featureToggles,
  );

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(200, { success: true });
}

/**
 * GET /api/wishes — Browse the public wish list.
 * No feature toggle check needed (read-only access allowed even when disabled).
 */
async function handleListWishes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const sortBy = params.sortBy === 'time' ? 'time' : 'votes';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize ?? '20', 10) || 20));

  const input: ListWishesInput = {
    sortBy,
    page,
    pageSize,
    currentUserId: event.user.userId,
  };

  const result = await listWishes(input, dynamoClient, tables);

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  return jsonResponse(200, { wishes: result.wishes, total: result.total });
}

/**
 * GET /api/wishes/mine/monthly-count — Get the current user's wish submission count for the current UTC month.
 * Used by the create wish page to show remaining quota.
 */
async function handleGetMonthlyCount(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const count = await getMonthlyWishCount(event.user.userId, dynamoClient, tables);
  return jsonResponse(200, { success: true, count });
}

/**
 * GET /api/wishes/mine — Get the current user's wishes.
 * No feature toggle check needed (read-only access allowed even when disabled).
 */
async function handleGetMyWishes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize ?? '20', 10) || 20));

  const result = await getMyWishes(
    event.user.userId,
    page,
    pageSize,
    dynamoClient,
    tables,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  return jsonResponse(200, { wishes: result.wishes, remainingWishes: result.remainingWishes, total: result.total });
}

/**
 * PUT /api/wishes/:wishId — Edit a wish (author only, pending status only).
 */
async function handleUpdateWish(wishId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const updates: { title?: string; description?: string; imageUrl?: string } = {};
  if (body.title !== undefined) updates.title = body.title as string;
  if (body.description !== undefined) updates.description = body.description as string;
  if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl as string;

  const result = await updateWish(
    wishId,
    event.user.userId,
    updates,
    dynamoClient,
    tables,
  );

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(200, { wish: result.wish });
}

/**
 * DELETE /api/wishes/:wishId — Delete a wish (author only, pending status only).
 */
async function handleDeleteWish(wishId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await deleteWish(
    wishId,
    event.user.userId,
    dynamoClient,
    tables,
  );

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(200, { success: true });
}

/**
 * PATCH /api/admin/wishes/:wishId/review — Review a wish (approve/reject).
 * Admin role check is done before calling this function.
 */
async function handleReviewWish(wishId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const action = body.action as string;
  if (action !== 'approve' && action !== 'reject') {
    return errorResponse('INVALID_REQUEST', 'action 必须为 approve 或 reject', 400);
  }

  const result = await reviewWish(
    wishId,
    action,
    body.closeReason as string | undefined,
    event.user.userId,
    dynamoClient,
    tables,
  );

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(200, { success: true });
}

/**
 * PATCH /api/admin/wishes/:wishId/status — Update wish status (adopt/fulfill/close).
 * Admin role check is done before calling this function.
 */
async function handleUpdateWishStatus(wishId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const targetStatus = body.targetStatus as string;
  if (targetStatus !== 'adopted' && targetStatus !== 'fulfilled' && targetStatus !== 'closed') {
    return errorResponse('INVALID_REQUEST', 'targetStatus 必须为 adopted、fulfilled 或 closed', 400);
  }

  const featureToggles = await getFeatureToggles(dynamoClient, USERS_TABLE);

  const input: UpdateWishStatusInput = {
    wishId,
    targetStatus,
    operatorId: event.user.userId,
    productId: body.productId as string | undefined,
    closeReason: body.closeReason as string | undefined,
  };

  const result = await updateWishStatus(input, dynamoClient, tables, featureToggles);

  if (!result.success) {
    const status = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return errorResponse(result.error!.code, result.error!.message, status);
  }

  return jsonResponse(200, { success: true });
}

/**
 * GET /api/admin/wishes — Admin wish list with status filtering.
 * Admin role check is done before calling this function.
 */
async function handleAdminListWishes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const sortBy = params.sortBy === 'time' ? 'time' : 'votes';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize ?? '20', 10) || 20));

  // Admin can filter by status (comma-separated)
  const statusFilter = params.status
    ? (params.status.split(',') as Array<'pending' | 'approved' | 'adopted' | 'fulfilled' | 'closed'>)
    : undefined;

  const input: ListWishesInput = {
    status: statusFilter,
    sortBy,
    page,
    pageSize,
    currentUserId: event.user.userId,
  };

  const result = await listWishes(input, dynamoClient, tables);

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  return jsonResponse(200, { wishes: result.wishes, total: result.total });
}

// ---- Lambda Export ----

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  return authenticatedHandler(event);
};
