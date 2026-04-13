import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ErrorHttpStatus, isSuperAdmin, ErrorCodes, ErrorMessages, isOrderAdmin } from '@points-mall/shared';
import type { Product, UserRole } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { assignRoles } from './roles';
import { batchGeneratePointsCodes, generateProductCodes, listCodes, disableCode, deleteCode } from './codes';
import { createPointsProduct, createCodeExclusiveProduct, updateProduct, setProductStatus } from './products';
import { getUploadUrl, getTempUploadUrl, deleteImage } from './images';
import { batchGenerateInvites, listInvites, revokeInvite } from './invites';
import { listUsers, setUserStatus, deleteUser } from './users';
import { executeBatchDistribution, validateBatchDistributionInput, listDistributionHistory, getDistributionDetail } from './batch-points';
import { reviewClaim, listAllClaims } from '../claims/review';
import { reviewContent, listAllContent, deleteContent, createCategory, updateCategory, deleteCategory } from '../content/admin';
import { listAllTags, mergeTags, deleteTag } from '../content/admin-tags';
import { updateFeatureToggles, getFeatureToggles, updateContentRolePermissions } from '../settings/feature-toggles';
import { checkReviewPermission } from '../content/content-permission';
import { getInviteSettings, updateInviteSettings } from '../settings/invite-settings';
import { transferSuperAdmin } from './superadmin-transfer';
import { updateTravelSettings, validateTravelSettingsInput } from '../travel/settings';
import { reviewTravelApplication, listAllTravelApplications } from '../travel/review';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';
const CODES_TABLE = process.env.CODES_TABLE ?? '';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';
const INVITES_TABLE = process.env.INVITES_TABLE ?? '';
const REGISTER_BASE_URL = process.env.REGISTER_BASE_URL ?? '';
const CLAIMS_TABLE = process.env.CLAIMS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const CONTENT_ITEMS_TABLE = process.env.CONTENT_ITEMS_TABLE ?? '';
const CONTENT_CATEGORIES_TABLE = process.env.CONTENT_CATEGORIES_TABLE ?? '';
const CONTENT_COMMENTS_TABLE = process.env.CONTENT_COMMENTS_TABLE ?? '';
const CONTENT_LIKES_TABLE = process.env.CONTENT_LIKES_TABLE ?? '';
const CONTENT_RESERVATIONS_TABLE = process.env.CONTENT_RESERVATIONS_TABLE ?? '';
const BATCH_DISTRIBUTIONS_TABLE = process.env.BATCH_DISTRIBUTIONS_TABLE ?? '';
const CONTENT_TAGS_TABLE = process.env.CONTENT_TAGS_TABLE ?? '';
const TRAVEL_APPLICATIONS_TABLE = process.env.TRAVEL_APPLICATIONS_TABLE ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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
const USERS_ROLES_REGEX = /^\/api\/admin\/users\/([^/]+)\/roles$/;
const CODES_DISABLE_REGEX = /^\/api\/admin\/codes\/([^/]+)\/disable$/;
const CODES_DELETE_REGEX = /^\/api\/admin\/codes\/([^/]+)$/;
const PRODUCTS_UPDATE_REGEX = /^\/api\/admin\/products\/([^/]+)$/;
const PRODUCTS_STATUS_REGEX = /^\/api\/admin\/products\/([^/]+)\/status$/;
const PRODUCTS_UPLOAD_URL_REGEX = /^\/api\/admin\/products\/([^/]+)\/upload-url$/;
const PRODUCTS_DELETE_IMAGE_REGEX = /^\/api\/admin\/products\/([^/]+)\/images\/(.+)$/;
const INVITES_REVOKE_REGEX = /^\/api\/admin\/invites\/([^/]+)\/revoke$/;
const USERS_STATUS_REGEX = /^\/api\/admin\/users\/([^/]+)\/status$/;
const USERS_DELETE_REGEX = /^\/api\/admin\/users\/([^/]+)$/;
const CLAIMS_REVIEW_REGEX = /^\/api\/admin\/claims\/([^/]+)\/review$/;
const CONTENT_REVIEW_REGEX = /^\/api\/admin\/content\/([^/]+)\/review$/;
const CONTENT_DELETE_REGEX = /^\/api\/admin\/content\/([^/]+)$/;
const CONTENT_CATEGORIES_UPDATE_REGEX = /^\/api\/admin\/content\/categories\/([^/]+)$/;
const CONTENT_CATEGORIES_DELETE_REGEX = /^\/api\/admin\/content\/categories\/([^/]+)$/;
const BATCH_POINTS_HISTORY_DETAIL_REGEX = /^\/api\/admin\/batch-points\/history\/([^/]+)$/;
const TRAVEL_REVIEW_REGEX = /^\/api\/admin\/travel\/([^/]+)\/review$/;
const TAGS_DELETE_REGEX = /^\/api\/admin\/tags\/([^/]+)$/;

/**
 * Check if the authenticated user has admin privileges.
 * Users with Admin, SuperAdmin, or OrderAdmin role are considered admins.
 */
function isAdmin(event: AuthenticatedEvent): boolean {
  return event.user.roles.some(r => r === 'Admin' || r === 'SuperAdmin' || r === 'OrderAdmin');
}

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  // Admin role check
  if (!isAdmin(event)) {
    return errorResponse('FORBIDDEN', '需要管理员权限', 403);
  }

  // OrderAdmin 白名单：仅允许访问订单相关路由
  // 订单路由由 orders handler 处理，不经过 admin handler
  // admin handler 中没有订单路由，所以 OrderAdmin 在此一律 403
  if (isOrderAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', 'OrderAdmin 仅可访问订单管理功能', 403);
  }

  const method = event.httpMethod;
  const path = event.path;

  // PUT /api/admin/users/{id}/roles
  if (method === 'PUT') {
    const usersMatch = path.match(USERS_ROLES_REGEX);
    if (usersMatch) {
      return await handleAssignRoles(usersMatch[1], event);
    }

    // PUT /api/admin/products/{id}
    const productsMatch = path.match(PRODUCTS_UPDATE_REGEX);
    if (productsMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleUpdateProduct(productsMatch[1], event);
    }

    // PUT /api/admin/content/categories/{id}
    const contentCategoriesUpdateMatch = path.match(CONTENT_CATEGORIES_UPDATE_REGEX);
    if (contentCategoriesUpdateMatch) {
      return await handleUpdateCategory(contentCategoriesUpdateMatch[1], event);
    }

    // PUT /api/admin/settings/feature-toggles
    if (path === '/api/admin/settings/feature-toggles') {
      return await handleUpdateFeatureToggles(event);
    }

    // PUT /api/admin/settings/travel-sponsorship
    if (path === '/api/admin/settings/travel-sponsorship') {
      return await handleUpdateTravelSettings(event);
    }

    // PUT /api/admin/settings/invite-settings — SuperAdmin only
    if (path === '/api/admin/settings/invite-settings') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateInviteSettings(event);
    }

    // PUT /api/admin/settings/content-role-permissions — SuperAdmin only
    if (path === '/api/admin/settings/content-role-permissions') {
      return await handleUpdateContentRolePermissions(event);
    }
  }

  // POST routes
  if (method === 'POST') {
    // POST /api/admin/images/upload-url — temp upload for product creation (no productId needed)
    if (path === '/api/admin/images/upload-url') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleGetTempUploadUrl(event);
    }

    const uploadUrlMatch = path.match(PRODUCTS_UPLOAD_URL_REGEX);
    if (uploadUrlMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleGetUploadUrl(uploadUrlMatch[1], event);
    }
    if (path === '/api/admin/codes/batch-generate') {
      return await handleBatchGenerateCodes(event);
    }
    if (path === '/api/admin/codes/product-code') {
      return await handleGenerateProductCodes(event);
    }
    if (path === '/api/admin/products') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleCreateProduct(event);
    }
    if (path === '/api/admin/invites/batch') {
      return await handleBatchGenerateInvites(event);
    }
    if (path === '/api/admin/content/categories') {
      return await handleCreateCategory(event);
    }
    if (path === '/api/admin/tags/merge') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
      }
      return await handleMergeTags(event);
    }
    if (path === '/api/admin/superadmin/transfer') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleTransferSuperAdmin(event);
    }
    if (path === '/api/admin/batch-points') {
      return await handleBatchDistribution(event);
    }
  }

  // GET routes
  if (method === 'GET' && path === '/api/admin/batch-points/history') {
    return await handleListDistributionHistory(event);
  }

  if (method === 'GET') {
    const batchPointsDetailMatch = path.match(BATCH_POINTS_HISTORY_DETAIL_REGEX);
    if (batchPointsDetailMatch) {
      return await handleGetDistributionDetail(batchPointsDetailMatch[1], event);
    }
  }

  if (method === 'GET' && path === '/api/admin/codes') {
    return await handleListCodes(event);
  }

  if (method === 'GET' && path === '/api/admin/invites') {
    return await handleListInvites(event);
  }

  if (method === 'GET' && path === '/api/admin/users') {
    return await handleListUsers(event);
  }

  if (method === 'GET' && path === '/api/admin/claims') {
    return await handleListAllClaims(event);
  }

  if (method === 'GET' && path === '/api/admin/tags') {
    return await handleListAllTags();
  }

  if (method === 'GET' && path === '/api/admin/content') {
    return await handleListAllContent(event);
  }

  if (method === 'GET' && path === '/api/admin/travel/applications') {
    return await handleListAllTravelApplications(event);
  }

  // PATCH routes
  if (method === 'PATCH') {
    const codesMatch = path.match(CODES_DISABLE_REGEX);
    if (codesMatch) {
      return await handleDisableCode(codesMatch[1]);
    }

    const statusMatch = path.match(PRODUCTS_STATUS_REGEX);
    if (statusMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleSetProductStatus(statusMatch[1], event);
    }

    const invitesRevokeMatch = path.match(INVITES_REVOKE_REGEX);
    if (invitesRevokeMatch) {
      return await handleRevokeInvite(invitesRevokeMatch[1]);
    }

    const usersStatusMatch = path.match(USERS_STATUS_REGEX);
    if (usersStatusMatch) {
      return await handleSetUserStatus(usersStatusMatch[1], event);
    }

    const claimsReviewMatch = path.match(CLAIMS_REVIEW_REGEX);
    if (claimsReviewMatch) {
      return await handleReviewClaim(claimsReviewMatch[1], event);
    }

    const contentReviewMatch = path.match(CONTENT_REVIEW_REGEX);
    if (contentReviewMatch) {
      return await handleReviewContent(contentReviewMatch[1], event);
    }

    const travelReviewMatch = path.match(TRAVEL_REVIEW_REGEX);
    if (travelReviewMatch) {
      return await handleReviewTravelApplication(travelReviewMatch[1], event);
    }
  }

  // DELETE routes
  if (method === 'DELETE') {
    // DELETE /api/admin/tags/:id — must check before generic content delete
    const tagsDeleteMatch = path.match(TAGS_DELETE_REGEX);
    if (tagsDeleteMatch && path.startsWith('/api/admin/tags/')) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
      }
      return await handleDeleteTag(tagsDeleteMatch[1]);
    }

    const deleteImageMatch = path.match(PRODUCTS_DELETE_IMAGE_REGEX);
    if (deleteImageMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
        if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      return await handleDeleteImage(deleteImageMatch[1], deleteImageMatch[2]);
    }

    const codesDeleteMatch = path.match(CODES_DELETE_REGEX);
    if (codesDeleteMatch) {
      return await handleDeleteCode(codesDeleteMatch[1]);
    }

    const usersDeleteMatch = path.match(USERS_DELETE_REGEX);
    if (usersDeleteMatch) {
      return await handleDeleteUser(usersDeleteMatch[1], event);
    }

    // DELETE /api/admin/content/categories/{id} — must check before CONTENT_DELETE_REGEX
    const contentCategoriesDeleteMatch = path.match(CONTENT_CATEGORIES_DELETE_REGEX);
    if (contentCategoriesDeleteMatch && path.includes('/categories/')) {
      return await handleDeleteCategory(contentCategoriesDeleteMatch[1], event);
    }

    // DELETE /api/admin/content/{id}
    const contentDeleteMatch = path.match(CONTENT_DELETE_REGEX);
    if (contentDeleteMatch) {
      return await handleDeleteContent(contentDeleteMatch[1]);
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

// ---- Route Handlers ----

async function handleAssignRoles(userId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !Array.isArray(body.roles)) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: roles (array)', 400);
  }

  const result = await assignRoles(userId, body.roles as string[], dynamoClient, USERS_TABLE, event.user.roles);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: '角色分配成功' });
}

async function handleBatchGenerateCodes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.count || !body.pointsValue || !body.maxUses) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: count, pointsValue, maxUses', 400);
  }

  const result = await batchGeneratePointsCodes(
    {
      count: body.count as number,
      pointsValue: body.pointsValue as number,
      maxUses: body.maxUses as number,
      name: (body.name as string) || undefined,
    },
    dynamoClient,
    CODES_TABLE,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { codes: result.data });
}

async function handleGenerateProductCodes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.productId || !body.count) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: productId, count', 400);
  }

  const result = await generateProductCodes(
    { productId: body.productId as string, count: body.count as number },
    dynamoClient,
    CODES_TABLE,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { codes: result.data });
}

async function handleListCodes(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKeyStr = event.queryStringParameters?.lastKey;
  let lastKey: Record<string, unknown> | undefined;
  if (lastKeyStr) {
    try {
      lastKey = JSON.parse(lastKeyStr);
    } catch {
      // ignore invalid lastKey
    }
  }

  const result = await listCodes(dynamoClient, CODES_TABLE, { pageSize, lastKey });

  return jsonResponse(200, { codes: result.codes, lastKey: result.lastKey });
}

async function handleDisableCode(codeId: string): Promise<APIGatewayProxyResult> {
  const result = await disableCode(codeId, dynamoClient, CODES_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: 'Code 已禁用' });
}

async function handleDeleteCode(codeId: string): Promise<APIGatewayProxyResult> {
  const result = await deleteCode(codeId, dynamoClient, CODES_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: 'Code 已删除' });
}

async function handleCreateProduct(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.type || !body.name) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: type, name', 400);
  }

  if (body.type === 'points') {
    const result = await createPointsProduct(
      {
        name: body.name as string,
        description: (body.description as string) ?? '',
        imageUrl: (body.imageUrl as string) ?? '',
        pointsCost: body.pointsCost as number,
        stock: (body.stock as number) ?? 0,
        allowedRoles: (body.allowedRoles as any) ?? 'all',
        images: body.images as any,
        sizeOptions: body.sizeOptions as any,
        purchaseLimitEnabled: body.purchaseLimitEnabled as boolean | undefined,
        purchaseLimitCount: body.purchaseLimitCount as number | undefined,
      },
      dynamoClient,
      PRODUCTS_TABLE,
    );

    if (!result.success) {
      return jsonResponse(400, result.error);
    }

    return jsonResponse(201, result.data);
  }

  if (body.type === 'code_exclusive') {
    const result = await createCodeExclusiveProduct(
      {
        name: body.name as string,
        description: (body.description as string) ?? '',
        imageUrl: (body.imageUrl as string) ?? '',
        eventInfo: (body.eventInfo as string) ?? '',
        stock: (body.stock as number) ?? 0,
        images: body.images as any,
        sizeOptions: body.sizeOptions as any,
        purchaseLimitEnabled: body.purchaseLimitEnabled as boolean | undefined,
        purchaseLimitCount: body.purchaseLimitCount as number | undefined,
      },
      dynamoClient,
      PRODUCTS_TABLE,
    );

    if (!result.success) {
      return jsonResponse(400, result.error);
    }

    return jsonResponse(201, result.data);
  }

  return errorResponse('INVALID_REQUEST', 'Invalid product type, must be "points" or "code_exclusive"', 400);
}

async function handleUpdateProduct(productId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  const result = await updateProduct(productId, body, dynamoClient, PRODUCTS_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: '商品更新成功' });
}

async function handleSetProductStatus(productId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.status) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: status', 400);
  }

  const result = await setProductStatus(
    productId,
    body.status as 'active' | 'inactive',
    dynamoClient,
    PRODUCTS_TABLE,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: '商品状态更新成功' });
}

async function handleGetUploadUrl(productId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.fileName || !body.contentType) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: fileName, contentType', 400);
  }

  // Fetch product to check current image count
  const productResult = await dynamoClient.send(
    new GetCommand({
      TableName: PRODUCTS_TABLE,
      Key: { productId },
    }),
  );

  const product = productResult.Item as Product | undefined;
  if (!product) {
    return errorResponse('NOT_FOUND', '商品不存在', 404);
  }

  const currentImageCount = product.images?.length ?? 0;

  const result = await getUploadUrl(
    {
      productId,
      fileName: body.fileName as string,
      contentType: body.contentType as string,
    },
    currentImageCount,
    s3Client,
    IMAGES_BUCKET,
  );

  if (!result.success) {
    return jsonResponse(result.error!.code === 'IMAGE_LIMIT_EXCEEDED' ? 400 : 400, result.error);
  }

  return jsonResponse(200, result.data);
}

async function handleDeleteImage(productId: string, imageKey: string): Promise<APIGatewayProxyResult> {
  // Fetch product to find the image in the images array
  const productResult = await dynamoClient.send(
    new GetCommand({
      TableName: PRODUCTS_TABLE,
      Key: { productId },
    }),
  );

  const product = productResult.Item as Product | undefined;
  if (!product) {
    return errorResponse('NOT_FOUND', '商品不存在', 404);
  }

  const images = product.images ?? [];
  const fullKey = `products/${productId}/images/${imageKey}`;

  // Try matching with the full constructed key first, then the raw imageKey
  const imageIndex = images.findIndex(img => img.key === fullKey || img.key === imageKey);
  if (imageIndex === -1) {
    return errorResponse('IMAGE_NOT_FOUND', '图片不存在', 404);
  }

  const actualKey = images[imageIndex].key;

  // Delete from S3
  await deleteImage(actualKey, s3Client, IMAGES_BUCKET);

  // Remove image from the array
  const updatedImages = images.filter((_, i) => i !== imageIndex);

  // Sync imageUrl: first image url or empty string
  const newImageUrl = updatedImages.length > 0 ? updatedImages[0].url : '';

  // Update product record
  await updateProduct(
    productId,
    { images: updatedImages, imageUrl: newImageUrl },
    dynamoClient,
    PRODUCTS_TABLE,
  );

  return jsonResponse(200, { message: '图片删除成功' });
}

async function handleListUsers(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const role = event.queryStringParameters?.role;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKeyStr = event.queryStringParameters?.lastKey;
  let lastKey: Record<string, unknown> | undefined;
  if (lastKeyStr) {
    try {
      lastKey = JSON.parse(lastKeyStr);
    } catch {
      // ignore invalid lastKey
    }
  }

  const result = await listUsers({ role, pageSize, lastKey }, dynamoClient, USERS_TABLE);

  return jsonResponse(200, { users: result.users, lastKey: result.lastKey });
}

async function handleSetUserStatus(userId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.status) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: status', 400);
  }

  const result = await setUserStatus(
    userId,
    body.status as 'active' | 'disabled',
    event.user.userId,
    event.user.roles,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '用户状态更新成功' });
}

async function handleDeleteUser(userId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await deleteUser(
    userId,
    event.user.userId,
    event.user.roles,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '用户删除成功' });
}

async function handleBatchGenerateInvites(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || body.count === undefined || !Array.isArray(body.roles)) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: count, roles (array)', 400);
  }

  const roles = body.roles as UserRole[];

  // OrderAdmin 邀请仅 SuperAdmin 可创建
  if (roles.includes('OrderAdmin') && !isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '仅 SuperAdmin 可创建 OrderAdmin 邀请', 403);
  }

  const inviteSettings = await getInviteSettings(dynamoClient, USERS_TABLE);
  const expiryMs = inviteSettings.inviteExpiryDays * 86400000;

  const result = await batchGenerateInvites(
    body.count as number,
    body.roles as UserRole[],
    dynamoClient,
    INVITES_TABLE,
    REGISTER_BASE_URL,
    expiryMs,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { invites: result.invites });
}

async function handleListInvites(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as string | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKeyStr = event.queryStringParameters?.lastKey;
  let lastKey: Record<string, unknown> | undefined;
  if (lastKeyStr) {
    try {
      lastKey = JSON.parse(lastKeyStr);
    } catch {
      // ignore invalid lastKey
    }
  }

  const result = await listInvites(status as any, lastKey, pageSize, dynamoClient, INVITES_TABLE);

  return jsonResponse(200, { invites: result.invites, lastKey: result.lastKey });
}

async function handleRevokeInvite(token: string): Promise<APIGatewayProxyResult> {
  const result = await revokeInvite(token, dynamoClient, INVITES_TABLE);

  if (!result.success) {
    const statusCode = result.error.code === 'INVITE_NOT_FOUND' ? 404 : 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '邀请已撤销' });
}

async function handleListAllClaims(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listAllClaims({ status, pageSize, lastKey }, dynamoClient, CLAIMS_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { claims: result.claims, lastKey: result.lastKey });
}

async function handleReviewClaim(claimId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.action) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: action', 400);
  }

  // Fetch reviewer nickname from Users table
  const reviewerResult = await dynamoClient.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { userId: event.user.userId }, ProjectionExpression: 'nickname' }),
  );
  const reviewerNickname = reviewerResult.Item?.nickname ?? '';

  const result = await reviewClaim(
    {
      claimId,
      reviewerId: event.user.userId,
      reviewerNickname,
      action: body.action as 'approve' | 'reject',
      awardedPoints: body.awardedPoints as number | undefined,
      rejectReason: body.rejectReason as string | undefined,
    },
    dynamoClient,
    { claimsTable: CLAIMS_TABLE, usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { claim: result.claim });
}

// ---- Batch Points Route Handlers ----

async function handleBatchDistribution(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const validation = validateBatchDistributionInput(body);
  if (!validation.valid) {
    return errorResponse(validation.error.code, validation.error.message, 400);
  }

  const { userIds, points, reason, targetRole } = body as Record<string, unknown>;

  // Fetch distributor's nickname from Users table
  const distributorResult = await dynamoClient.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { userId: event.user.userId }, ProjectionExpression: 'nickname' }),
  );
  const distributorNickname = distributorResult.Item?.nickname ?? '';

  const result = await executeBatchDistribution(
    {
      userIds: userIds as string[],
      points: points as number,
      reason: reason as string,
      targetRole: targetRole as 'UserGroupLeader' | 'Speaker' | 'Volunteer',
      distributorId: event.user.userId,
      distributorNickname,
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  return jsonResponse(201, {
    distributionId: result.distributionId,
    successCount: result.successCount,
    totalPoints: result.totalPoints,
  });
}

async function handleListDistributionHistory(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '需要超级管理员权限', 403);
  }

  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listDistributionHistory(
    { pageSize, lastKey },
    dynamoClient,
    BATCH_DISTRIBUTIONS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { distributions: result.distributions, lastKey: result.lastKey });
}

async function handleGetDistributionDetail(distributionId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '需要超级管理员权限', 403);
  }

  const result = await getDistributionDetail(distributionId, dynamoClient, BATCH_DISTRIBUTIONS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'DISTRIBUTION_NOT_FOUND' ? 404 : 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { distribution: result.distribution });
}

// ---- Content Management Route Handlers ----

async function handleListAllContent(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listAllContent({ status, pageSize, lastKey }, dynamoClient, CONTENT_ITEMS_TABLE);

  return jsonResponse(200, { items: result.items, lastKey: result.lastKey });
}

async function handleReviewContent(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkReviewPermission(event.user.roles, toggles.adminContentReviewEnabled)) {
    return errorResponse('PERMISSION_DENIED', '需要超级管理员权限才能审批内容', 403);
  }

  const body = parseBody(event);
  if (!body || !body.action) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: action', 400);
  }

  const result = await reviewContent(
    {
      contentId,
      reviewerId: event.user.userId,
      action: body.action as 'approve' | 'reject',
      rejectReason: body.rejectReason as string | undefined,
    },
    dynamoClient,
    CONTENT_ITEMS_TABLE,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { item: result.item });
}

async function handleDeleteContent(contentId: string): Promise<APIGatewayProxyResult> {
  const result = await deleteContent(
    contentId,
    dynamoClient,
    s3Client,
    {
      contentItemsTable: CONTENT_ITEMS_TABLE,
      commentsTable: CONTENT_COMMENTS_TABLE,
      likesTable: CONTENT_LIKES_TABLE,
      reservationsTable: CONTENT_RESERVATIONS_TABLE,
    },
    IMAGES_BUCKET,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '内容已删除' });
}

async function handleCreateCategory(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Category management permission guard
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    if (!toggles.adminCategoriesEnabled) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限才能管理分类', 403);
    }
  }

  const body = parseBody(event);
  if (!body || !body.name) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: name', 400);
  }

  const result = await createCategory(body.name as string, dynamoClient, CONTENT_CATEGORIES_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { category: result.category });
}

async function handleUpdateCategory(categoryId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Category management permission guard
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    if (!toggles.adminCategoriesEnabled) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限才能管理分类', 403);
    }
  }

  const body = parseBody(event);
  if (!body || !body.name) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: name', 400);
  }

  const result = await updateCategory(categoryId, body.name as string, dynamoClient, CONTENT_CATEGORIES_TABLE);

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { category: result.category });
}

async function handleDeleteCategory(categoryId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Category management permission guard
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    if (!toggles.adminCategoriesEnabled) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限才能管理分类', 403);
    }
  }

  const result = await deleteCategory(categoryId, dynamoClient, CONTENT_CATEGORIES_TABLE);

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '分类已删除' });
}

async function handleUpdateFeatureToggles(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  const result = await updateFeatureToggles(
    {
      codeRedemptionEnabled: body.codeRedemptionEnabled as boolean,
      pointsClaimEnabled: body.pointsClaimEnabled as boolean,
      adminProductsEnabled: body.adminProductsEnabled !== false, // default true if not provided
      adminOrdersEnabled: body.adminOrdersEnabled !== false,     // default true if not provided
      adminContentReviewEnabled: body.adminContentReviewEnabled === true, // default false
      adminCategoriesEnabled: body.adminCategoriesEnabled === true,       // default false
      updatedBy: event.user.userId,
    },
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { settings: result.settings });
}

async function handleGetTempUploadUrl(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.fileName || !body.contentType) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: fileName, contentType', 400);
  }

  const result = await getTempUploadUrl(
    {
      fileName: body.fileName as string,
      contentType: body.contentType as string,
    },
    s3Client,
    IMAGES_BUCKET,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, result.data);
}

// ---- Travel Sponsorship Route Handlers ----

async function handleUpdateTravelSettings(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
  }

  const body = parseBody(event);
  const validation = validateTravelSettingsInput(body);
  if (!validation.valid) {
    return errorResponse(validation.error.code, validation.error.message, 400);
  }

  const result = await updateTravelSettings(
    {
      travelSponsorshipEnabled: (body as Record<string, unknown>).travelSponsorshipEnabled as boolean,
      domesticThreshold: (body as Record<string, unknown>).domesticThreshold as number,
      internationalThreshold: (body as Record<string, unknown>).internationalThreshold as number,
      updatedBy: event.user.userId,
    },
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { settings: result.settings });
}

async function handleListAllTravelApplications(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
  }

  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listAllTravelApplications(
    { status, pageSize, lastKey },
    dynamoClient,
    TRAVEL_APPLICATIONS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { applications: result.applications, lastKey: result.lastKey });
}

async function handleReviewTravelApplication(applicationId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限');
  }

  const body = parseBody(event);
  if (!body || !body.action) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: action', 400);
  }

  // Fetch reviewer nickname from Users table
  const reviewerResult = await dynamoClient.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { userId: event.user.userId }, ProjectionExpression: 'nickname' }),
  );
  const reviewerNickname = reviewerResult.Item?.nickname ?? '';

  const result = await reviewTravelApplication(
    {
      applicationId,
      reviewerId: event.user.userId,
      reviewerNickname,
      action: body.action as 'approve' | 'reject',
      rejectReason: body.rejectReason as string | undefined,
    },
    dynamoClient,
    { usersTable: USERS_TABLE, travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { application: result.application });
}

// ---- Tag Management Route Handlers ----

async function handleListAllTags(): Promise<APIGatewayProxyResult> {
  const result = await listAllTags(dynamoClient, CONTENT_TAGS_TABLE);

  return jsonResponse(200, { tags: result.tags });
}

async function handleMergeTags(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.sourceTagId || !body.targetTagId) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: sourceTagId, targetTagId', 400);
  }

  const result = await mergeTags(
    {
      sourceTagId: body.sourceTagId as string,
      targetTagId: body.targetTagId as string,
    },
    dynamoClient,
    { contentTagsTable: CONTENT_TAGS_TABLE, contentItemsTable: CONTENT_ITEMS_TABLE },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '标签合并成功' });
}

async function handleDeleteTag(tagId: string): Promise<APIGatewayProxyResult> {
  const result = await deleteTag(
    tagId,
    dynamoClient,
    { contentTagsTable: CONTENT_TAGS_TABLE, contentItemsTable: CONTENT_ITEMS_TABLE },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '标签已删除' });
}

// ---- SuperAdmin Transfer Route Handler ----

async function handleTransferSuperAdmin(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.targetUserId || !body.password) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: targetUserId, password', 400);
  }

  const result = await transferSuperAdmin(
    {
      callerId: event.user.userId,
      targetUserId: body.targetUserId as string,
      password: body.password as string,
    },
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { success: true });
}

// ---- Invite Settings Route Handler ----

async function handleUpdateInviteSettings(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || body.inviteExpiryDays === undefined) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: inviteExpiryDays', 400);
  }

  const result = await updateInviteSettings(
    body.inviteExpiryDays as number,
    event.user.userId,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { inviteExpiryDays: body.inviteExpiryDays });
}

// ---- Content Role Permissions Route Handler ----

async function handleUpdateContentRolePermissions(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin permission check
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  // Validate all 12 permission fields are booleans
  const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
  const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
  const crp = body.contentRolePermissions as Record<string, Record<string, unknown>> | undefined;

  if (!crp) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  for (const role of roles) {
    for (const perm of perms) {
      if (typeof crp[role]?.[perm] !== 'boolean') {
        return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
      }
    }
  }

  const result = await updateContentRolePermissions(
    {
      contentRolePermissions: crp as any,
      updatedBy: event.user.userId,
    },
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { contentRolePermissions: result.contentRolePermissions });
}
