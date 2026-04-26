import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { S3Client } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ErrorHttpStatus, isSuperAdmin, ErrorCodes, ErrorMessages, isOrderAdmin } from '@points-mall/shared';
import type { Product, UserRole } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { assignRoles } from './roles';
import { batchGeneratePointsCodes, generateProductCodes, listCodes, disableCode, deleteCode } from './codes';
import { createPointsProduct, createCodeExclusiveProduct, updateProduct, setProductStatus } from './products';
import { getUploadUrl, getTempUploadUrl, deleteImage } from './images';
import { batchGenerateInvites, listInvites, revokeInvite } from './invites';
import { listUsers, setUserStatus, deleteUser, unlockUser } from './users';
import { executeBatchDistribution, validateBatchDistributionInput, listDistributionHistory, getDistributionDetail, getAwardedUserIds } from './batch-points';
import { executeAdjustment } from './batch-points-adjust';
import { reviewClaim, listAllClaims } from '../claims/review';
import { reviewContent, listAllContent, deleteContent, createCategory, updateCategory, deleteCategory } from '../content/admin';
import { listAllTags, mergeTags, deleteTag } from '../content/admin-tags';
import { updateFeatureToggles, getFeatureToggles, updateContentRolePermissions } from '../settings/feature-toggles';
import type { PointsRuleConfig } from '../settings/feature-toggles';
import { checkReviewPermission } from '../content/content-permission';
import { getInviteSettings, updateInviteSettings } from '../settings/invite-settings';
import { transferSuperAdmin } from './superadmin-transfer';
import { updateTravelSettings, validateTravelSettingsInput } from '../travel/settings';
import { reviewTravelApplication, listAllTravelApplications } from '../travel/review';
import { listTemplates, updateTemplate, validateTemplateInput, getRequiredVariables } from '../email/templates';
import { seedDefaultTemplates } from '../email/seed';
import { sendNewProductNotification, sendNewContentNotification, sendPointsEarnedEmail } from '../email/notifications';
import type { NotificationContext, SubscribedUser } from '../email/notifications';
import type { NotificationType, EmailLocale } from '../email/send';
import { createUG, deleteUG, updateUGStatus, updateUGName, listUGs, assignLeader, removeLeader, getMyUGs } from './ug';
import { listActivities } from './activities';
import { reviewReservation, listReservationApprovals, getVisibleUGNames } from '../content/reservation-approval';
import { queryPointsDetail, queryUGActivitySummary, queryUserPointsRanking, queryActivityPointsSummary } from '../reports/query';
import { executeExport, validateExportInput } from '../reports/export';
import { maskCookie, testMeetupConnection } from '../sync/meetup-api';
import { getMeetupSyncConfig } from '../sync/handler';
import {
  queryPopularProducts,
  queryHotContent,
  queryContentContributors,
  queryInventoryAlert,
  queryTravelStatistics,
  queryInviteConversion,
  queryEmployeeEngagement,
} from '../reports/insight-query';

// Create client outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const sesClient = new SESClient({});
const lambdaClient = new LambdaClient({});

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
const REDEMPTIONS_TABLE = process.env.REDEMPTIONS_TABLE ?? '';
const ORDERS_TABLE = process.env.ORDERS_TABLE ?? '';
const EMAIL_TEMPLATES_TABLE = process.env.EMAIL_TEMPLATES_TABLE ?? '';
const UGS_TABLE = process.env.UGS_TABLE ?? '';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE ?? '';
const SYNC_FUNCTION_NAME = process.env.SYNC_FUNCTION_NAME ?? '';

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
const USERS_UNLOCK_REGEX = /^\/api\/admin\/users\/([^/]+)\/unlock$/;
const USERS_DELETE_REGEX = /^\/api\/admin\/users\/([^/]+)$/;
const CLAIMS_REVIEW_REGEX = /^\/api\/admin\/claims\/([^/]+)\/review$/;
const CONTENT_REVIEW_REGEX = /^\/api\/admin\/content\/([^/]+)\/review$/;
const CONTENT_DELETE_REGEX = /^\/api\/admin\/content\/([^/]+)$/;
const CONTENT_CATEGORIES_UPDATE_REGEX = /^\/api\/admin\/content\/categories\/([^/]+)$/;
const CONTENT_CATEGORIES_DELETE_REGEX = /^\/api\/admin\/content\/categories\/([^/]+)$/;
const BATCH_POINTS_HISTORY_DETAIL_REGEX = /^\/api\/admin\/batch-points\/history\/([^/]+)$/;
const BATCH_POINTS_ADJUST_REGEX = /^\/api\/admin\/batch-points\/([^/]+)\/adjust$/;
const TRAVEL_REVIEW_REGEX = /^\/api\/admin\/travel\/([^/]+)\/review$/;
const TAGS_DELETE_REGEX = /^\/api\/admin\/tags\/([^/]+)$/;
const EMAIL_TEMPLATES_UPDATE_REGEX = /^\/api\/admin\/email-templates\/([^/]+)\/([^/]+)$/;
const UGS_STATUS_REGEX = /^\/api\/admin\/ugs\/([^/]+)\/status$/;
const UGS_RENAME_REGEX = /^\/api\/admin\/ugs\/([^/]+)$/;
const UGS_LEADER_REGEX = /^\/api\/admin\/ugs\/([^/]+)\/leader$/;
const UGS_DELETE_REGEX = /^\/api\/admin\/ugs\/([^/]+)$/;
const RESERVATION_APPROVAL_REVIEW_REGEX = /^\/api\/admin\/reservation-approvals\/([^/]+)\/review$/;

// Meetup sync config key
const MEETUP_SYNC_CONFIG_KEY = 'meetup-sync-config';

// Website sync config key
const WEBSITE_SYNC_CONFIG_KEY = 'website-sync-config';

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

    // PUT /api/admin/ugs/{ugId}/status — SuperAdmin only
    const ugsStatusMatch = path.match(UGS_STATUS_REGEX);
    if (ugsStatusMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateUGStatus(ugsStatusMatch[1], event);
    }

    // PUT /api/admin/ugs/{ugId}/leader — SuperAdmin only
    const ugsLeaderMatch = path.match(UGS_LEADER_REGEX);
    if (ugsLeaderMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleAssignLeader(ugsLeaderMatch[1], event);
    }

    // PUT /api/admin/ugs/{ugId} — rename UG, SuperAdmin only (must be after more-specific routes)
    const ugsRenameMatch = path.match(UGS_RENAME_REGEX);
    if (ugsRenameMatch && path.startsWith('/api/admin/ugs/')) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleRenameUG(ugsRenameMatch[1], event);
    }

    // PUT /api/admin/settings/activity-sync-config — SuperAdmin only
    if (path === '/api/admin/settings/activity-sync-config') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateSyncConfig(event);
    }

    // PUT /api/admin/settings/meetup-sync-config — SuperAdmin only
    if (path === '/api/admin/settings/meetup-sync-config') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateMeetupSyncConfig(event);
    }

    // PUT /api/admin/settings/website-sync-config — SuperAdmin only
    if (path === '/api/admin/settings/website-sync-config') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateWebsiteSyncConfig(event);
    }

    // PUT /api/admin/email-templates/{type}/{locale} — SuperAdmin only
    const emailTemplateMatch = path.match(EMAIL_TEMPLATES_UPDATE_REGEX);
    if (emailTemplateMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUpdateEmailTemplate(emailTemplateMatch[1], emailTemplateMatch[2], event);
    }
  }

  // POST routes
  if (method === 'POST') {
    // POST /api/admin/users/{id}/unlock — SuperAdmin only
    const usersUnlockMatch = path.match(USERS_UNLOCK_REGEX);
    if (usersUnlockMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleUnlockUser(usersUnlockMatch[1]);
    }

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

    // POST /api/admin/batch-points/{distributionId}/adjust — SuperAdmin only
    const batchPointsAdjustMatch = path.match(BATCH_POINTS_ADJUST_REGEX);
    if (batchPointsAdjustMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleBatchPointsAdjust(batchPointsAdjustMatch[1], event);
    }

    if (path === '/api/admin/quarterly-award') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleQuarterlyAward(event);
    }

    // POST /api/admin/ugs — SuperAdmin only
    if (path === '/api/admin/ugs') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleCreateUG(event);
    }

    // POST /api/admin/sync/activities — SuperAdmin only, invoke Sync Lambda
    if (path === '/api/admin/sync/activities') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleManualSync();
    }

    // POST /api/admin/sync/feishu — SuperAdmin only, invoke Sync Lambda with source=feishu
    if (path === '/api/admin/sync/feishu') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleFeishuSync();
    }

    // POST /api/admin/sync/meetup — SuperAdmin only, invoke Sync Lambda with source=meetup
    if (path === '/api/admin/sync/meetup') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleMeetupSync();
    }

    // POST /api/admin/sync/website — SuperAdmin only, placeholder for local script
    if (path === '/api/admin/sync/website') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleWebsiteSync();
    }

    // POST /api/admin/settings/meetup-sync-config/test — SuperAdmin only, test Meetup connection
    if (path === '/api/admin/settings/meetup-sync-config/test') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleTestMeetupConnection(event);
    }
    // POST /api/admin/email-templates/seed — SuperAdmin only, seed default templates
    if (path === '/api/admin/email-templates/seed') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleSeedEmailTemplates();
    }
    // POST /api/admin/email/send-product-notification — trigger new product bulk send
    if (path === '/api/admin/email/send-product-notification') {
      return await handleSendProductNotification(event);
    }
    // POST /api/admin/email/send-content-notification — trigger new content bulk send
    if (path === '/api/admin/email/send-content-notification') {
      return await handleSendContentNotification(event);
    }

    // POST /api/admin/reports/export — SuperAdmin only
    if (path === '/api/admin/reports/export') {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleReportExport(event);
    }
  }

  // GET routes
  if (method === 'GET' && path === '/api/admin/batch-points/history') {
    return await handleListDistributionHistory(event);
  }

  if (method === 'GET' && path === '/api/admin/batch-points/awarded') {
    return await handleGetAwardedUsers(event);
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

  // GET /api/admin/ugs/my-ugs — Admin/SuperAdmin
  if (method === 'GET' && path === '/api/admin/ugs/my-ugs') {
    return await handleGetMyUGs(event);
  }

  // GET /api/admin/ugs — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/ugs') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleListUGs(event);
  }

  // GET /api/admin/activities — Admin/SuperAdmin
  if (method === 'GET' && path === '/api/admin/activities') {
    return await handleListActivities(event);
  }

  // GET /api/admin/reservation-approvals — Admin/SuperAdmin
  if (method === 'GET' && path === '/api/admin/reservation-approvals') {
    return await handleListReservationApprovals(event);
  }

  // GET /api/admin/settings/activity-sync-config — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/settings/activity-sync-config') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleGetSyncConfig();
  }

  // GET /api/admin/settings/meetup-sync-config — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/settings/meetup-sync-config') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleGetMeetupSyncConfig();
  }

  // GET /api/admin/settings/website-sync-config — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/settings/website-sync-config') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleGetWebsiteSyncConfig();
  }

  // GET /api/admin/email-templates — Admin and SuperAdmin can access
  if (method === 'GET' && path === '/api/admin/email-templates') {
    return await handleListEmailTemplates(event);
  }

  if (method === 'GET' && path === '/api/admin/content') {
    return await handleListAllContent(event);
  }

  if (method === 'GET' && path === '/api/admin/travel/applications') {
    return await handleListAllTravelApplications(event);
  }

  // GET /api/admin/reports/* — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/points-detail') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handlePointsDetailReport(event);
  }

  if (method === 'GET' && path === '/api/admin/reports/ug-activity-summary') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleUGActivitySummary(event);
  }

  if (method === 'GET' && path === '/api/admin/reports/user-points-ranking') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleUserPointsRanking(event);
  }

  if (method === 'GET' && path === '/api/admin/reports/activity-points-summary') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleActivityPointsSummary(event);
  }

  // GET /api/admin/reports/popular-products — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/popular-products') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handlePopularProductsReport(event);
  }

  // GET /api/admin/reports/hot-content — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/hot-content') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleHotContentReport(event);
  }

  // GET /api/admin/reports/content-contributors — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/content-contributors') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleContentContributorsReport(event);
  }

  // GET /api/admin/reports/inventory-alert — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/inventory-alert') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleInventoryAlertReport(event);
  }

  // GET /api/admin/reports/travel-statistics — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/travel-statistics') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleTravelStatisticsReport(event);
  }

  // GET /api/admin/reports/invite-conversion — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/invite-conversion') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleInviteConversionReport(event);
  }

  // GET /api/admin/reports/employee-engagement — SuperAdmin only
  if (method === 'GET' && path === '/api/admin/reports/employee-engagement') {
    if (!isSuperAdmin(event.user.roles as UserRole[])) {
      return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
    }
    return await handleEmployeeEngagementReport(event);
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

    // PATCH /api/admin/reservation-approvals/{pk}/review — Admin/SuperAdmin
    const reservationApprovalReviewMatch = path.match(RESERVATION_APPROVAL_REVIEW_REGEX);
    if (reservationApprovalReviewMatch) {
      return await handleReviewReservationApproval(decodeURIComponent(reservationApprovalReviewMatch[1]), event);
    }
  }

  // DELETE routes
  if (method === 'DELETE') {
    // DELETE /api/admin/ugs/{ugId}/leader — SuperAdmin only (must check before UGS_DELETE_REGEX)
    const ugsLeaderDeleteMatch = path.match(UGS_LEADER_REGEX);
    if (ugsLeaderDeleteMatch) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleRemoveLeader(ugsLeaderDeleteMatch[1]);
    }

    // DELETE /api/admin/ugs/{ugId} — SuperAdmin only (must check before generic patterns)
    const ugsDeleteMatch = path.match(UGS_DELETE_REGEX);
    if (ugsDeleteMatch && path.startsWith('/api/admin/ugs/')) {
      if (!isSuperAdmin(event.user.roles as UserRole[])) {
        return errorResponse(ErrorCodes.FORBIDDEN, '需要超级管理员权限', 403);
      }
      return await handleDeleteUG(ugsDeleteMatch[1]);
    }

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
        brand: body.brand as string | undefined,
      },
      dynamoClient,
      PRODUCTS_TABLE,
      s3Client,
      IMAGES_BUCKET,
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
        brand: body.brand as string | undefined,
      },
      dynamoClient,
      PRODUCTS_TABLE,
      s3Client,
      IMAGES_BUCKET,
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

  // Non-SuperAdmin callers: exclude SuperAdmin and OrderAdmin users at DB level
  const callerRoles = (event.user.roles as string[]) ?? [];
  const isSuperAdminCaller = callerRoles.includes('SuperAdmin');
  const excludeRoles = isSuperAdminCaller ? undefined : ['SuperAdmin', 'OrderAdmin'];

  const result = await listUsers({ role, pageSize, lastKey, excludeRoles }, dynamoClient, USERS_TABLE);

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

async function handleUnlockUser(userId: string): Promise<APIGatewayProxyResult> {
  const result = await unlockUser(userId, dynamoClient, USERS_TABLE);

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '用户解锁成功' });
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

  const isEmployee = typeof body.isEmployee === 'boolean' ? body.isEmployee : undefined;

  const result = await batchGenerateInvites(
    body.count as number,
    body.roles as UserRole[],
    dynamoClient,
    INVITES_TABLE,
    REGISTER_BASE_URL,
    expiryMs,
    isEmployee,
    event.user.userId,
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

  // Non-SuperAdmin callers only see invites they created (filtered at DB level)
  const callerRoles = (event.user.roles as string[]) ?? [];
  const callerIsSuperAdmin = callerRoles.includes('SuperAdmin');
  const createdByFilter = callerIsSuperAdmin ? undefined : event.user.userId;

  const result = await listInvites(status as any, lastKey, pageSize, dynamoClient, INVITES_TABLE, createdByFilter);

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

  // Send points earned email after successful claim approval (best-effort)
  if (body.action === 'approve' && result.claim) {
    try {
      const notificationCtx: NotificationContext = {
        sesClient,
        dynamoClient,
        emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
        usersTable: USERS_TABLE,
        senderEmail: 'store@awscommunity.cn',
      };
      // Fetch user's current balance (post-approval) for the email
      const userBalanceResult = await dynamoClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId: result.claim.userId },
          ProjectionExpression: 'points',
        }),
      );
      const currentBalance = userBalanceResult.Item?.points ?? 0;
      await sendPointsEarnedEmail(
        notificationCtx,
        result.claim.userId,
        result.claim.awardedPoints ?? 0,
        '积分申请审批',
        currentBalance,
      );
    } catch (err) {
      console.error('[Email] Failed to send pointsEarned email after claim approval:', err);
    }
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

  const { userIds, points, reason, targetRole, activityId, activityType, activityUG, activityTopic, activityDate, speakerType } = body as Record<string, unknown>;

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
      speakerType: speakerType as 'typeA' | 'typeB' | 'roundtable' | undefined,
      distributorId: event.user.userId,
      distributorNickname,
      activityId: activityId as string,
      activityType: activityType as string,
      activityUG: activityUG as string,
      activityTopic: activityTopic as string,
      activityDate: activityDate as string,
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
      activitiesTable: ACTIVITIES_TABLE,
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  // Send points earned email to each recipient (best-effort)
  try {
    const notificationCtx: NotificationContext = {
      sesClient,
      dynamoClient,
      emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
      usersTable: USERS_TABLE,
      senderEmail: 'store@awscommunity.cn',
    };
    const uniqueUserIds = [...new Set(userIds as string[])];
    for (const userId of uniqueUserIds) {
      try {
        // Fetch user's current balance (post-distribution) for the email
        const userBalanceResult = await dynamoClient.send(
          new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId },
            ProjectionExpression: 'points',
          }),
        );
        const currentBalance = userBalanceResult.Item?.points ?? 0;
        await sendPointsEarnedEmail(
          notificationCtx,
          userId,
          points as number,
          '管理员发放',
          currentBalance,
        );
      } catch (emailErr) {
        console.error(`[Email] Failed to send pointsEarned email to user ${userId}:`, emailErr);
      }
    }
  } catch (err) {
    console.error('[Email] Failed to send pointsEarned emails after batch distribution:', err);
  }

  return jsonResponse(201, {
    distributionId: result.distributionId,
    successCount: result.successCount,
    totalPoints: result.totalPoints,
  });
}

// ---- Batch Points Adjust Handler ----

async function handleBatchPointsAdjust(distributionId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const { recipientIds, targetRole, speakerType } = body as Record<string, unknown>;

  if (!Array.isArray(recipientIds) || !targetRole) {
    return errorResponse('INVALID_REQUEST', '缺少必填字段: recipientIds, targetRole', 400);
  }

  const result = await executeAdjustment(
    {
      distributionId,
      recipientIds: recipientIds as string[],
      targetRole: targetRole as 'UserGroupLeader' | 'Speaker' | 'Volunteer',
      speakerType: speakerType as 'typeA' | 'typeB' | 'roundtable' | undefined,
      adjustedBy: event.user.userId,
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

  return jsonResponse(200, { message: '调整成功' });
}

// ---- Awarded Users Handler ----

async function handleGetAwardedUsers(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const activityId = event.queryStringParameters?.activityId;
  const targetRole = event.queryStringParameters?.targetRole;

  if (!activityId || !targetRole) {
    return errorResponse('INVALID_REQUEST', 'activityId 和 targetRole 为必填参数', 400);
  }

  const validRoles = ['UserGroupLeader', 'Speaker', 'Volunteer'];
  if (!validRoles.includes(targetRole)) {
    return errorResponse('INVALID_REQUEST', 'targetRole 必须为 UserGroupLeader、Speaker 或 Volunteer', 400);
  }

  const userIds = await getAwardedUserIds(activityId, targetRole, dynamoClient, BATCH_DISTRIBUTIONS_TABLE);
  return jsonResponse(200, { userIds });
}

// ---- Quarterly Award Handler ----

async function handleQuarterlyAward(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || typeof body !== 'object') {
    return errorResponse('INVALID_REQUEST', '请求体无效', 400);
  }

  const { userIds, points, reason, targetRole, awardDate } = body as Record<string, unknown>;

  // Validate userIds
  if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every(id => typeof id === 'string' && id.length > 0)) {
    return errorResponse('INVALID_REQUEST', 'userIds 必须为非空字符串数组', 400);
  }
  // Validate points
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 1) {
    return errorResponse('INVALID_REQUEST', 'points 必须为正整数', 400);
  }
  // Validate reason
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 200) {
    return errorResponse('INVALID_REQUEST', 'reason 必须为 1~200 字符的字符串', 400);
  }
  // Validate targetRole
  const VALID_ROLES = ['UserGroupLeader', 'Speaker', 'Volunteer'];
  if (typeof targetRole !== 'string' || !VALID_ROLES.includes(targetRole)) {
    return errorResponse('INVALID_REQUEST', 'targetRole 必须为 UserGroupLeader、Speaker 或 Volunteer', 400);
  }
  // Validate awardDate (YYYY-MM-DD)
  if (typeof awardDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(awardDate)) {
    return errorResponse('INVALID_REQUEST', 'awardDate 格式必须为 YYYY-MM-DD', 400);
  }

  // Fetch distributor nickname
  const distributorResult = await dynamoClient.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { userId: event.user.userId }, ProjectionExpression: 'nickname' }),
  );
  const distributorNickname = distributorResult.Item?.nickname ?? '';

  // Reuse executeBatchDistribution without activity validation
  const result = await executeBatchDistribution(
    {
      userIds: userIds as string[],
      points: points as number,
      reason: reason as string,
      targetRole: targetRole as 'UserGroupLeader' | 'Speaker' | 'Volunteer',
      distributorId: event.user.userId,
      distributorNickname,
      activityId: `quarterly-award:${awardDate}`,
      activityType: '季度贡献奖',
      activityUG: '',
      activityTopic: `季度贡献奖`,
      activityDate: awardDate as string,
      skipPointsValidation: true,
    },
    dynamoClient,
    {
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
      // No activitiesTable — skip activity existence check
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  // Best-effort email notifications
  try {
    const notificationCtx: NotificationContext = {
      sesClient,
      dynamoClient,
      emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
      usersTable: USERS_TABLE,
      senderEmail: 'store@awscommunity.cn',
    };
    const uniqueUserIds = [...new Set(userIds as string[])];
    for (const userId of uniqueUserIds) {
      try {
        const userBalanceResult = await dynamoClient.send(
          new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ProjectionExpression: 'points' }),
        );
        const currentBalance = userBalanceResult.Item?.points ?? 0;
        await sendPointsEarnedEmail(notificationCtx, userId, points as number, '季度贡献奖', currentBalance);
      } catch (emailErr) {
        console.error(`[Email] Failed to send quarterly award email to user ${userId}:`, emailErr);
      }
    }
  } catch (err) {
    console.error('[Email] Failed to send quarterly award emails:', err);
  }

  return jsonResponse(201, {
    distributionId: result.distributionId,
    successCount: result.successCount,
    totalPoints: result.totalPoints,
  });
}

async function handleListDistributionHistory(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  // Admin users can only see their own distribution history
  const distributorId = isSuperAdmin(event.user.roles as UserRole[])
    ? undefined
    : event.user.userId;

  const result = await listDistributionHistory(
    { pageSize, lastKey, distributorId },
    dynamoClient,
    BATCH_DISTRIBUTIONS_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { distributions: result.distributions, lastKey: result.lastKey });
}

async function handleGetDistributionDetail(distributionId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getDistributionDetail(distributionId, dynamoClient, BATCH_DISTRIBUTIONS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'DISTRIBUTION_NOT_FOUND' ? 404 : 400;
    return jsonResponse(statusCode, result.error);
  }

  // Admin users can only view their own distribution records
  if (!isSuperAdmin(event.user.roles as UserRole[]) && result.distribution!.distributorId !== event.user.userId) {
    return errorResponse('FORBIDDEN', '无权查看此发放记录', 403);
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
      contentTagsTable: CONTENT_TAGS_TABLE,
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
      emailPointsEarnedEnabled: body.emailPointsEarnedEnabled === true,   // default false
      emailNewOrderEnabled: body.emailNewOrderEnabled === true,            // default false
      emailOrderShippedEnabled: body.emailOrderShippedEnabled === true,    // default false
      emailNewProductEnabled: body.emailNewProductEnabled === true,        // default false
      emailNewContentEnabled: body.emailNewContentEnabled === true,        // default false
      emailContentUpdatedEnabled: body.emailContentUpdatedEnabled === true, // default false
      emailWeeklyDigestEnabled: body.emailWeeklyDigestEnabled === true,     // default false
      adminEmailProductsEnabled: body.adminEmailProductsEnabled === true,  // default false
      adminEmailContentEnabled: body.adminEmailContentEnabled === true,    // default false
      reservationApprovalPoints: typeof body.reservationApprovalPoints === 'number' && Number.isInteger(body.reservationApprovalPoints) && body.reservationApprovalPoints >= 1
        ? body.reservationApprovalPoints
        : 10,  // default 10
      leaderboardRankingEnabled: body.leaderboardRankingEnabled === true,           // default false
      leaderboardAnnouncementEnabled: body.leaderboardAnnouncementEnabled === true, // default false
      leaderboardUpdateFrequency: (body.leaderboardUpdateFrequency || 'weekly') as 'daily' | 'weekly' | 'monthly',     // default 'weekly', validated in updateFeatureToggles
      pointsRuleConfig: body.pointsRuleConfig as PointsRuleConfig | undefined,
      brandLogoListEnabled: body.brandLogoListEnabled !== false,     // default true
      brandLogoDetailEnabled: body.brandLogoDetailEnabled !== false, // default true
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

// ---- Bulk Email Notification Route Handlers ----

const SENDER_EMAIL = 'store@awscommunity.cn';

function buildNotificationContext(): NotificationContext {
  return {
    sesClient,
    dynamoClient,
    emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
    usersTable: USERS_TABLE,
    senderEmail: SENDER_EMAIL,
  };
}

async function handleSendProductNotification(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Check email toggle first — return 403 if disabled
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!toggles.emailNewProductEnabled) {
    return errorResponse('FORBIDDEN', '新商品邮件通知功能已关闭', 403);
  }

  // Admin permission check: SuperAdmin always passes, Admin requires adminEmailProductsEnabled
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    if (!toggles.adminEmailProductsEnabled) {
      return errorResponse('FORBIDDEN', '管理员暂无新商品邮件通知权限', 403);
    }
  }

  const body = parseBody(event);
  if (!body || !body.productList) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: productList', 400);
  }

  const productList = body.productList as string;

  // Query subscribed users with emailSubscriptions.newProduct === true
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: '#subs.#np = :trueVal',
      ExpressionAttributeNames: {
        '#subs': 'emailSubscriptions',
        '#np': 'newProduct',
      },
      ExpressionAttributeValues: {
        ':trueVal': true,
      },
      ProjectionExpression: 'email, locale',
    }),
  );

  const subscribedUsers: SubscribedUser[] = (scanResult.Items ?? [])
    .filter((item) => item.email)
    .map((item) => ({
      email: item.email as string,
      locale: (item.locale as EmailLocale) ?? 'zh',
    }));

  const ctx = buildNotificationContext();
  const result = await sendNewProductNotification(ctx, productList, subscribedUsers);

  return jsonResponse(200, {
    message: '新商品通知发送完成',
    subscriberCount: subscribedUsers.length,
    totalBatches: result.totalBatches,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });
}

async function handleSendContentNotification(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Check email toggle first — return 403 if disabled
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!toggles.emailNewContentEnabled) {
    return errorResponse('FORBIDDEN', '新内容邮件通知功能已关闭', 403);
  }

  // Admin permission check: SuperAdmin always passes, Admin requires adminEmailContentEnabled
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    if (!toggles.adminEmailContentEnabled) {
      return errorResponse('FORBIDDEN', '管理员暂无新内容邮件通知权限', 403);
    }
  }

  const body = parseBody(event);
  if (!body || !body.contentList) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: contentList', 400);
  }

  const contentList = body.contentList as string;

  // Query subscribed users with emailSubscriptions.newContent === true
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: '#subs.#nc = :trueVal',
      ExpressionAttributeNames: {
        '#subs': 'emailSubscriptions',
        '#nc': 'newContent',
      },
      ExpressionAttributeValues: {
        ':trueVal': true,
      },
      ProjectionExpression: 'email, locale',
    }),
  );

  const subscribedUsers: SubscribedUser[] = (scanResult.Items ?? [])
    .filter((item) => item.email)
    .map((item) => ({
      email: item.email as string,
      locale: (item.locale as EmailLocale) ?? 'zh',
    }));

  const ctx = buildNotificationContext();
  const result = await sendNewContentNotification(ctx, contentList, subscribedUsers);

  return jsonResponse(200, {
    message: '新内容通知发送完成',
    subscriberCount: subscribedUsers.length,
    totalBatches: result.totalBatches,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });
}

// ---- Email Template Route Handlers ----

const VALID_NOTIFICATION_TYPES: NotificationType[] = ['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent', 'contentUpdated', 'weeklyDigest'];
const VALID_LOCALES: EmailLocale[] = ['zh', 'en', 'ja', 'ko', 'zh-TW'];

async function handleListEmailTemplates(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const type = event.queryStringParameters?.type as string | undefined;

  if (type && !VALID_NOTIFICATION_TYPES.includes(type as NotificationType)) {
    return errorResponse('INVALID_REQUEST', `Invalid notification type: ${type}`, 400);
  }

  const templates = await listTemplates(
    dynamoClient,
    EMAIL_TEMPLATES_TABLE,
    type as NotificationType | undefined,
  );

  // Include required variables metadata when filtering by type
  const requiredVariables = type ? getRequiredVariables(type as NotificationType) : undefined;

  return jsonResponse(200, { templates, requiredVariables });
}

async function handleSeedEmailTemplates(): Promise<APIGatewayProxyResult> {
  await seedDefaultTemplates(dynamoClient, EMAIL_TEMPLATES_TABLE);
  return jsonResponse(200, { message: '默认邮件模板初始化完成' });
}

async function handleUpdateEmailTemplate(type: string, locale: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  if (!VALID_NOTIFICATION_TYPES.includes(type as NotificationType)) {
    return errorResponse('INVALID_REQUEST', `Invalid notification type: ${type}`, 400);
  }

  if (!VALID_LOCALES.includes(locale as EmailLocale)) {
    return errorResponse('INVALID_REQUEST', `Invalid locale: ${locale}`, 400);
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  const subject = body.subject as string | undefined;
  const bodyContent = body.body as string | undefined;

  if (subject === undefined && bodyContent === undefined) {
    return errorResponse('INVALID_REQUEST', 'At least one of subject or body must be provided', 400);
  }

  // Validate provided fields
  if (subject !== undefined || bodyContent !== undefined) {
    // For partial updates, we need to validate what's provided
    // Full validation (including merging with existing) happens in updateTemplate
    if (subject !== undefined) {
      const subjectValidation = validateTemplateInput(subject, 'x'); // dummy body for subject-only check
      if (!subjectValidation.valid && subjectValidation.error?.includes('Subject')) {
        return errorResponse('INVALID_REQUEST', subjectValidation.error, 400);
      }
    }
    if (bodyContent !== undefined) {
      const bodyValidation = validateTemplateInput('x', bodyContent); // dummy subject for body-only check
      if (!bodyValidation.valid && bodyValidation.error?.includes('Body')) {
        return errorResponse('INVALID_REQUEST', bodyValidation.error, 400);
      }
    }
  }

  try {
    const template = await updateTemplate(dynamoClient, EMAIL_TEMPLATES_TABLE, {
      templateId: type,
      locale: locale as EmailLocale,
      subject,
      body: bodyContent,
      updatedBy: event.user.userId,
    });

    return jsonResponse(200, { template });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update template';
    return errorResponse('INVALID_REQUEST', message, 400);
  }
}

// ---- UG Management Route Handlers ----

async function handleCreateUG(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.name) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: name', 400);
  }

  const result = await createUG({ name: body.name as string }, dynamoClient, UGS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'DUPLICATE_UG_NAME' ? 409 : (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(201, { ug: result.ug });
}

async function handleListUGs(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status as 'active' | 'inactive' | 'all' | undefined;

  const result = await listUGs({ status: status ?? 'all' }, dynamoClient, UGS_TABLE);

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { ugs: result.ugs });
}

async function handleUpdateUGStatus(ugId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.status) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: status', 400);
  }

  const status = body.status as string;
  if (status !== 'active' && status !== 'inactive') {
    return errorResponse('INVALID_REQUEST', 'status 必须为 active 或 inactive', 400);
  }

  const result = await updateUGStatus(ugId, status, dynamoClient, UGS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'UG_NOT_FOUND' ? 404 : (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: 'UG 状态更新成功' });
}

async function handleDeleteUG(ugId: string): Promise<APIGatewayProxyResult> {
  const result = await deleteUG(ugId, dynamoClient, UGS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'UG_NOT_FOUND' ? 404 : (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: 'UG 已删除' });
}

async function handleRenameUG(ugId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.name) {
    return errorResponse('INVALID_REQUEST', '缺少必填字段: name', 400);
  }

  const result = await updateUGName(ugId, body.name as string, dynamoClient, UGS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'UG_NOT_FOUND' ? 404 : (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: 'UG 名称更新成功' });
}

async function handleAssignLeader(ugId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.leaderId) {
    return errorResponse('INVALID_REQUEST', '缺少必填字段: leaderId', 400);
  }

  const result = await assignLeader(
    { ugId, leaderId: body.leaderId as string },
    dynamoClient,
    UGS_TABLE,
    USERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const statusCode = code === 'UG_NOT_FOUND' || code === 'USER_NOT_FOUND' ? 404
      : (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '负责人分配成功' });
}

async function handleRemoveLeader(ugId: string): Promise<APIGatewayProxyResult> {
  const result = await removeLeader(ugId, dynamoClient, UGS_TABLE);

  if (!result.success) {
    const statusCode = result.error!.code === 'UG_NOT_FOUND' ? 404 : (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { message: '负责人已移除' });
}

async function handleGetMyUGs(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await getMyUGs(event.user.userId, dynamoClient, UGS_TABLE);

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { ugs: result.ugs });
}

// ---- Activity Route Handlers ----

async function handleListActivities(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const ugName = event.queryStringParameters?.ugName;
  const keyword = event.queryStringParameters?.keyword;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  // Default startDate to 2026-01-01 so 2025 activities are excluded from batch distribution
  const startDate = event.queryStringParameters?.startDate || '2026-01-01';

  // Default endDate to today (China time, UTC+8) so future activities are hidden
  let endDate = event.queryStringParameters?.endDate;
  if (!endDate) {
    const chinaOffset = 8 * 60 * 60 * 1000;
    endDate = new Date(Date.now() + chinaOffset).toISOString().split('T')[0];
  }

  const result = await listActivities(
    { ugName, startDate, endDate, keyword, pageSize, lastKey },
    dynamoClient,
    ACTIVITIES_TABLE,
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { activities: result.activities, lastKey: result.lastKey });
}

// ---- Manual Sync Route Handler ----

async function handleManualSync(): Promise<APIGatewayProxyResult> {
  if (!SYNC_FUNCTION_NAME) {
    return errorResponse('INTERNAL_ERROR', '同步 Lambda 未配置', 500);
  }

  try {
    const response = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SYNC_FUNCTION_NAME,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ source: 'all' })),
      }),
    );

    if (response.FunctionError) {
      const errorPayload = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString('utf-8')) : {};
      return errorResponse('SYNC_FAILED', `同步失败: ${errorPayload.errorMessage ?? response.FunctionError}`, 500);
    }

    const payload = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString('utf-8')) : {};
    const syncBody = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload;

    return jsonResponse(200, syncBody);
  } catch (err) {
    console.error('[ManualSync] Failed to invoke Sync Lambda:', err);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('SYNC_FAILED', `同步调用失败: ${message}`, 500);
  }
}

async function handleFeishuSync(): Promise<APIGatewayProxyResult> {
  if (!SYNC_FUNCTION_NAME) {
    return errorResponse('INTERNAL_ERROR', '同步 Lambda 未配置', 500);
  }

  try {
    const response = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SYNC_FUNCTION_NAME,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ source: 'feishu' })),
      }),
    );

    if (response.FunctionError) {
      const errorPayload = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString('utf-8')) : {};
      return errorResponse('SYNC_FAILED', `飞书同步失败: ${errorPayload.errorMessage ?? response.FunctionError}`, 500);
    }

    const payload = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString('utf-8')) : {};
    const syncBody = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload;

    return jsonResponse(200, syncBody);
  } catch (err) {
    console.error('[FeishuSync] Failed to invoke Sync Lambda:', err);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('SYNC_FAILED', `飞书同步调用失败: ${message}`, 500);
  }
}

async function handleMeetupSync(): Promise<APIGatewayProxyResult> {
  if (!SYNC_FUNCTION_NAME) {
    return errorResponse('INTERNAL_ERROR', '同步 Lambda 未配置', 500);
  }

  try {
    const invokeResult = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SYNC_FUNCTION_NAME,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ source: 'meetup' })),
      }),
    );

    if (invokeResult.Payload) {
      const payloadStr = Buffer.from(invokeResult.Payload).toString('utf-8');
      try {
        const lambdaResponse = JSON.parse(payloadStr);
        const body = typeof lambdaResponse.body === 'string' ? JSON.parse(lambdaResponse.body) : lambdaResponse.body;
        return jsonResponse(200, {
          success: body?.success ?? true,
          syncedCount: body?.syncedCount ?? 0,
          skippedCount: body?.skippedCount ?? 0,
          warnings: body?.warnings,
        });
      } catch {
        return jsonResponse(200, { success: true, syncedCount: 0, skippedCount: 0 });
      }
    }

    return jsonResponse(200, { success: true, syncedCount: 0, skippedCount: 0 });
  } catch (err) {
    console.error('[MeetupSync] Failed to invoke Sync Lambda:', err);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('SYNC_FAILED', `Meetup 同步调用失败: ${message}`, 500);
  }
}

// ---- Sync Config Route Handlers ----

const SYNC_CONFIG_KEY = 'activity-sync-config';

async function handleUpdateSyncConfig(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  const { syncIntervalDays, feishuTableUrl, feishuAppId, feishuAppSecret } = body;

  // Validate syncIntervalDays: integer 1~30
  if (syncIntervalDays !== undefined) {
    if (typeof syncIntervalDays !== 'number' || !Number.isInteger(syncIntervalDays) || syncIntervalDays < 1 || syncIntervalDays > 30) {
      return errorResponse('INVALID_REQUEST', 'syncIntervalDays 必须为 1~30 的整数', 400);
    }
  }

  // Validate feishuTableUrl: string
  if (feishuTableUrl !== undefined && typeof feishuTableUrl !== 'string') {
    return errorResponse('INVALID_REQUEST', 'feishuTableUrl 必须为字符串', 400);
  }

  const now = new Date().toISOString();

  // Read existing config first
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: SYNC_CONFIG_KEY },
    }),
  );

  const currentConfig = existing.Item ?? {};

  // If secret is the masked value '***', keep the existing value from DB
  const resolvedSecret =
    feishuAppSecret === '***' || feishuAppSecret === undefined
      ? (currentConfig.feishuAppSecret as string) ?? ''
      : (feishuAppSecret as string);

  const updatedConfig = {
    userId: SYNC_CONFIG_KEY,
    syncIntervalDays: (syncIntervalDays as number) ?? currentConfig.syncIntervalDays ?? 1,
    feishuTableUrl: (feishuTableUrl as string) ?? currentConfig.feishuTableUrl ?? '',
    feishuAppId: (feishuAppId as string) ?? currentConfig.feishuAppId ?? '',
    feishuAppSecret: resolvedSecret,
    updatedAt: now,
    updatedBy: event.user.userId,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: updatedConfig,
    }),
  );

  // Return config without sensitive fields
  return jsonResponse(200, {
    syncIntervalDays: updatedConfig.syncIntervalDays,
    feishuTableUrl: updatedConfig.feishuTableUrl,
    feishuAppId: updatedConfig.feishuAppId,
    feishuAppSecret: updatedConfig.feishuAppSecret ? '***' : '',
    updatedAt: updatedConfig.updatedAt,
    updatedBy: updatedConfig.updatedBy,
  });
}

async function handleGetSyncConfig(): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: SYNC_CONFIG_KEY },
    }),
  );

  if (!result.Item) {
    // Return default config
    return jsonResponse(200, {
      syncIntervalDays: 1,
      feishuTableUrl: '',
      feishuAppId: '',
      feishuAppSecret: '',
      updatedAt: '',
      updatedBy: '',
    });
  }

  return jsonResponse(200, {
    syncIntervalDays: result.Item.syncIntervalDays ?? 1,
    feishuTableUrl: result.Item.feishuTableUrl ?? '',
    feishuAppId: result.Item.feishuAppId ?? '',
    feishuAppSecret: result.Item.feishuAppSecret ? '***' : '',
    updatedAt: result.Item.updatedAt ?? '',
    updatedBy: result.Item.updatedBy ?? '',
  });
}

// ---- Meetup Sync Config Route Handlers ----

async function handleGetMeetupSyncConfig(): Promise<APIGatewayProxyResult> {
  const config = await getMeetupSyncConfig(dynamoClient, USERS_TABLE);

  if (!config) {
    // Return default empty config
    return jsonResponse(200, {
      groups: [],
      meetupToken: '',
      meetupCsrf: '',
      meetupSession: '',
      autoSyncEnabled: false,
      updatedAt: '',
      updatedBy: '',
    });
  }

  return jsonResponse(200, {
    groups: config.groups ?? [],
    meetupToken: maskCookie(config.meetupToken ?? ''),
    meetupCsrf: maskCookie(config.meetupCsrf ?? ''),
    meetupSession: maskCookie(config.meetupSession ?? ''),
    autoSyncEnabled: config.autoSyncEnabled ?? false,
    updatedAt: config.updatedAt ?? '',
    updatedBy: config.updatedBy ?? '',
  });
}

async function handleUpdateMeetupSyncConfig(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  const { groups, meetupToken, meetupCsrf, meetupSession, autoSyncEnabled } = body;

  // Validate groups: must be an array of { urlname, displayName }
  if (groups !== undefined) {
    if (!Array.isArray(groups)) {
      return errorResponse('INVALID_REQUEST', 'groups 必须为数组', 400);
    }
    for (const g of groups) {
      if (!g || typeof g !== 'object' || typeof (g as any).urlname !== 'string' || typeof (g as any).displayName !== 'string') {
        return errorResponse('INVALID_REQUEST', 'groups 中每项必须包含 urlname 和 displayName 字符串', 400);
      }
    }
  }

  // Validate cookie fields: must be strings if provided
  if (meetupToken !== undefined && typeof meetupToken !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupToken 必须为字符串', 400);
  }
  if (meetupCsrf !== undefined && typeof meetupCsrf !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupCsrf 必须为字符串', 400);
  }
  if (meetupSession !== undefined && typeof meetupSession !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupSession 必须为字符串', 400);
  }

  const now = new Date().toISOString();

  // Read existing config to handle masked cookie values
  const existingConfig = await getMeetupSyncConfig(dynamoClient, USERS_TABLE);

  // Resolve cookie values: if value starts with '*', retain existing DB value
  const resolvedToken = resolveMaskedCookie(meetupToken as string | undefined, existingConfig?.meetupToken);
  const resolvedCsrf = resolveMaskedCookie(meetupCsrf as string | undefined, existingConfig?.meetupCsrf);
  const resolvedSession = resolveMaskedCookie(meetupSession as string | undefined, existingConfig?.meetupSession);

  const updatedConfig = {
    userId: MEETUP_SYNC_CONFIG_KEY,
    groups: (groups as any[]) ?? existingConfig?.groups ?? [],
    meetupToken: resolvedToken,
    meetupCsrf: resolvedCsrf,
    meetupSession: resolvedSession,
    autoSyncEnabled: autoSyncEnabled !== undefined ? Boolean(autoSyncEnabled) : (existingConfig?.autoSyncEnabled ?? false),
    updatedAt: now,
    updatedBy: event.user.userId,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: updatedConfig,
    }),
  );

  // Return config with masked cookies
  return jsonResponse(200, {
    groups: updatedConfig.groups,
    meetupToken: maskCookie(updatedConfig.meetupToken),
    meetupCsrf: maskCookie(updatedConfig.meetupCsrf),
    meetupSession: maskCookie(updatedConfig.meetupSession),
    autoSyncEnabled: updatedConfig.autoSyncEnabled,
    updatedAt: updatedConfig.updatedAt,
    updatedBy: updatedConfig.updatedBy,
  });
}

/**
 * Resolve a cookie value from a PUT request.
 * If the value starts with '*', it's a masked value — retain the existing DB value.
 * If undefined, retain the existing DB value.
 * Otherwise, use the new value.
 */
function resolveMaskedCookie(newValue: string | undefined, existingValue: string | undefined): string {
  if (newValue === undefined) return existingValue ?? '';
  if (newValue.startsWith('*')) return existingValue ?? '';
  return newValue;
}

async function handleTestMeetupConnection(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  const { meetupToken, meetupCsrf, meetupSession } = body;

  if (!meetupToken || typeof meetupToken !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupToken 为必填字段', 400);
  }
  if (!meetupCsrf || typeof meetupCsrf !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupCsrf 为必填字段', 400);
  }
  if (!meetupSession || typeof meetupSession !== 'string') {
    return errorResponse('INVALID_REQUEST', 'meetupSession 为必填字段', 400);
  }

  const result = await testMeetupConnection({
    meetupToken: meetupToken as string,
    meetupCsrf: meetupCsrf as string,
    meetupSession: meetupSession as string,
  });

  if (!result.success) {
    return jsonResponse(400, {
      success: false,
      error: result.error,
    });
  }

  return jsonResponse(200, { success: true });
}

// ---- Reservation Approval Route Handlers ----

async function handleListReservationApprovals(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // Get all UGs to determine visibility
  const ugsResult = await dynamoClient.send(
    new ScanCommand({ TableName: UGS_TABLE }),
  );
  const ugs = (ugsResult.Items ?? []) as Array<{ ugId: string; name: string; status: string; leaderId?: string; leaderNickname?: string }>;

  // Determine visible UG names based on role and leader assignments
  const ugNames = getVisibleUGNames(event.user.roles, event.user.userId, ugs as any);

  const status = event.queryStringParameters?.status as 'pending' | 'approved' | 'rejected' | undefined;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listReservationApprovals(
    { status, ugNames, pageSize, lastKey },
    dynamoClient,
    {
      reservationsTable: CONTENT_RESERVATIONS_TABLE,
      contentItemsTable: CONTENT_ITEMS_TABLE,
      usersTable: USERS_TABLE,
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { reservations: result.reservations, lastKey: result.lastKey });
}

async function handleReviewReservationApproval(pk: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.action) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: action', 400);
  }

  const action = body.action as string;
  if (action !== 'approve' && action !== 'reject') {
    return errorResponse('INVALID_REQUEST', 'action must be "approve" or "reject"', 400);
  }

  // Get reservationApprovalPoints from feature toggles (default 10)
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  const rewardPoints = (toggles as any).reservationApprovalPoints ?? 10;

  const result = await reviewReservation(
    {
      pk,
      reviewerId: event.user.userId,
      action: action as 'approve' | 'reject',
    },
    dynamoClient,
    {
      reservationsTable: CONTENT_RESERVATIONS_TABLE,
      contentItemsTable: CONTENT_ITEMS_TABLE,
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
    },
    rewardPoints,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { success: true });
}

// ---- Report Route Handlers ----

async function handlePointsDetailReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryPointsDetail(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      ugName: qs.ugName,
      targetRole: qs.targetRole,
      activityId: qs.activityId,
      type: qs.type as 'earn' | 'spend' | 'all' | undefined,
      pageSize: qs.pageSize ? parseInt(qs.pageSize, 10) : undefined,
      lastKey: qs.lastKey,
    },
    dynamoClient,
    {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      usersTable: USERS_TABLE,
      batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records, lastKey: result.lastKey });
}

async function handleUGActivitySummary(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryUGActivitySummary(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
    },
    dynamoClient,
    { pointsRecordsTable: POINTS_RECORDS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleUserPointsRanking(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryUserPointsRanking(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      targetRole: qs.targetRole,
      pageSize: qs.pageSize ? parseInt(qs.pageSize, 10) : undefined,
      lastKey: qs.lastKey,
    },
    dynamoClient,
    {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      usersTable: USERS_TABLE,
    },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records, lastKey: result.lastKey });
}

async function handleActivityPointsSummary(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryActivityPointsSummary(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      ugName: qs.ugName,
    },
    dynamoClient,
    { pointsRecordsTable: POINTS_RECORDS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleReportExport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空', 400);
  }

  const validation = validateExportInput(body);
  if (!validation.valid) {
    return errorResponse(validation.error!.code, validation.error!.message, 400);
  }

  const result = await executeExport(
    body as any,
    dynamoClient,
    s3Client,
    {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      usersTable: USERS_TABLE,
      batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
      productsTable: PRODUCTS_TABLE,
      ordersTable: ORDERS_TABLE,
      contentItemsTable: CONTENT_ITEMS_TABLE,
      contentCategoriesTable: CONTENT_CATEGORIES_TABLE,
      travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE,
      invitesTable: INVITES_TABLE,
    },
    IMAGES_BUCKET,
    Date.now(),
  );

  if (!result.success) {
    const statusCode = result.error!.code === 'EXPORT_TIMEOUT' ? 504 : 400;
    return errorResponse(result.error!.code, result.error!.message, statusCode);
  }

  return jsonResponse(200, { downloadUrl: result.downloadUrl });
}

// ---- Insight Report Route Handlers ----

async function handlePopularProductsReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryPopularProducts(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      productType: qs.productType as 'points' | 'code_exclusive' | 'all' | undefined,
    },
    dynamoClient,
    { ordersTable: ORDERS_TABLE, productsTable: PRODUCTS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleHotContentReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryHotContent(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      categoryId: qs.categoryId,
    },
    dynamoClient,
    { contentItemsTable: CONTENT_ITEMS_TABLE, contentCategoriesTable: CONTENT_CATEGORIES_TABLE, usersTable: USERS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleContentContributorsReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryContentContributors(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
    },
    dynamoClient,
    { contentItemsTable: CONTENT_ITEMS_TABLE, usersTable: USERS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleInventoryAlertReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryInventoryAlert(
    {
      stockThreshold: Number(qs.stockThreshold) || 5,
      productType: qs.productType as 'points' | 'code_exclusive' | 'all' | undefined,
      productStatus: qs.productStatus as 'active' | 'inactive' | 'all' | undefined,
    },
    dynamoClient,
    { productsTable: PRODUCTS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleTravelStatisticsReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryTravelStatistics(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
      periodType: qs.periodType as 'month' | 'quarter' | undefined,
      category: qs.category as 'domestic' | 'international' | 'all' | undefined,
    },
    dynamoClient,
    { travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { records: result.records });
}

async function handleInviteConversionReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryInviteConversion(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
    },
    dynamoClient,
    { invitesTable: INVITES_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { record: result.record });
}

async function handleEmployeeEngagementReport(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const result = await queryEmployeeEngagement(
    {
      startDate: qs.startDate,
      endDate: qs.endDate,
    },
    dynamoClient,
    { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message, 400);
  }

  return jsonResponse(200, { summary: result.summary, records: result.records });
}

// ---- Website Sync Config Route Handlers ----

async function handleGetWebsiteSyncConfig(): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: WEBSITE_SYNC_CONFIG_KEY },
    }),
  );

  if (!result.Item) {
    // Return default empty config
    return jsonResponse(200, {
      sources: [],
      updatedAt: '',
      updatedBy: '',
    });
  }

  return jsonResponse(200, {
    sources: result.Item.sources ?? [],
    updatedAt: result.Item.updatedAt ?? '',
    updatedBy: result.Item.updatedBy ?? '',
    lastSyncTime: result.Item.lastSyncTime ?? '',
    lastSyncResult: result.Item.lastSyncResult ?? '',
    lastSyncSummary: result.Item.lastSyncSummary ?? '',
  });
}

async function handleUpdateWebsiteSyncConfig(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求参数无效', 400);
  }

  const { sources } = body;

  // Validate sources: must be an array
  if (!Array.isArray(sources)) {
    return errorResponse('INVALID_REQUEST', 'sources 必须为数组', 400);
  }

  // Validate min 1 source
  if (sources.length < 1) {
    return errorResponse('INVALID_REQUEST', '至少需要 1 个同步源', 400);
  }

  // Validate max 20 sources
  if (sources.length > 20) {
    return errorResponse('INVALID_REQUEST', '最多支持 20 个同步源', 400);
  }

  // Validate each source
  for (const s of sources) {
    if (!s || typeof s !== 'object') {
      return errorResponse('INVALID_REQUEST', 'sources 中每项必须为对象', 400);
    }
    const src = s as Record<string, unknown>;
    if (typeof src.url !== 'string' || !src.url.startsWith('https://')) {
      return errorResponse('INVALID_REQUEST', 'URL 必须以 https:// 开头', 400);
    }
    if (typeof src.displayName !== 'string' || src.displayName.trim() === '') {
      return errorResponse('INVALID_REQUEST', 'displayName 不能为空', 400);
    }
  }

  const now = new Date().toISOString();

  // Read existing config to preserve lastSync fields
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId: WEBSITE_SYNC_CONFIG_KEY },
    }),
  );

  const currentConfig = existing.Item ?? {};

  const updatedConfig = {
    userId: WEBSITE_SYNC_CONFIG_KEY,
    sources: (sources as any[]).map((s: any) => ({ url: s.url, displayName: s.displayName })),
    updatedAt: now,
    updatedBy: event.user.userId,
    lastSyncTime: currentConfig.lastSyncTime ?? '',
    lastSyncResult: currentConfig.lastSyncResult ?? '',
    lastSyncSummary: currentConfig.lastSyncSummary ?? '',
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: updatedConfig,
    }),
  );

  return jsonResponse(200, {
    sources: updatedConfig.sources,
    updatedAt: updatedConfig.updatedAt,
    updatedBy: updatedConfig.updatedBy,
    lastSyncTime: updatedConfig.lastSyncTime,
    lastSyncResult: updatedConfig.lastSyncResult,
    lastSyncSummary: updatedConfig.lastSyncSummary,
  });
}

async function handleWebsiteSync(): Promise<APIGatewayProxyResult> {
  try {
    // 1. Read website-sync-config to get sources with displayName
    const configResult = await dynamoClient.send(
      new GetCommand({ TableName: USERS_TABLE, Key: { userId: WEBSITE_SYNC_CONFIG_KEY } }),
    );
    const sources: { url: string; displayName: string }[] = configResult.Item?.sources ?? [];
    if (sources.length === 0) {
      return jsonResponse(200, { success: true, syncedCount: 0, skippedCount: 0 });
    }

    const fetcherClient = new LambdaClient({ region: 'us-east-1' });
    const { parseTaiwanDate } = require('../sync/taiwan-date-parser');
    const { ulid } = require('ulid');
    let syncedCount = 0;
    let skippedCount = 0;

    // Process each source from frontend config
    for (const source of sources) {
      const ugName = source.displayName;
      let events: { topic: string; activityDate: string; sourceUrl: string; activityType: string }[] = [];

      try {
        if (source.url.includes('tw.events.awsug.net')) {
          // Call tw-awsug-scraper Lambda
          const result = await fetcherClient.send(
            new InvokeCommand({
              FunctionName: 'tw-awsug-scraper',
              InvocationType: 'RequestResponse',
              Payload: Buffer.from(JSON.stringify({})),
            }),
          );
          if (result.Payload) {
            const resp = JSON.parse(Buffer.from(result.Payload).toString('utf-8'));
            const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp;
            for (const evt of (body.events ?? [])) {
              if (!evt.title || !evt.time) continue;
              const activityDate = parseTaiwanDate(evt.time);
              if (!activityDate) continue;
              const activityType = evt.location?.includes('Online') || evt.location?.includes('線上') || evt.location?.includes('YouTube') || evt.location?.includes('Zoom') ? '线上活动' : '线下活动';
              events.push({ topic: evt.title, activityDate, sourceUrl: evt.url || source.url, activityType });
            }
          }
        } else if (source.url.includes('awsug.com.tw')) {
          // Call taiwan-ug-fetcher Lambda
          const result = await fetcherClient.send(
            new InvokeCommand({
              FunctionName: 'taiwan-ug-fetcher',
              InvocationType: 'RequestResponse',
              Payload: Buffer.from(JSON.stringify({})),
            }),
          );
          if (result.Payload) {
            const resp = JSON.parse(Buffer.from(result.Payload).toString('utf-8'));
            const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp;
            for (const evt of (body.data ?? [])) {
              if (!evt.date || !evt.speakers || evt.speakers.length === 0) continue;
              const activityDate = parseTaiwanDate(evt.date);
              if (!activityDate) continue;
              events.push({ topic: evt.speakers.join(' / '), activityDate, sourceUrl: evt.link || source.url, activityType: '线下活动' });
            }
          }
        }

        console.log(`[WebsiteSync] ${ugName}: found ${events.length} events`);

        // Write events to DynamoDB with deduplication
        for (const evt of events) {
          const dedupeKey = `${evt.topic}#${evt.activityDate}#${ugName}`;
          const existing = await dynamoClient.send(
            new QueryCommand({
              TableName: ACTIVITIES_TABLE,
              IndexName: 'dedupeKey-index',
              KeyConditionExpression: 'dedupeKey = :dk',
              ExpressionAttributeValues: { ':dk': dedupeKey },
              Limit: 1,
            }),
          );
          if (existing.Items && existing.Items.length > 0) {
            skippedCount++;
            continue;
          }
          await dynamoClient.send(
            new PutCommand({
              TableName: ACTIVITIES_TABLE,
              Item: {
                activityId: ulid(),
                pk: 'ALL',
                activityType: evt.activityType,
                ugName,
                topic: evt.topic,
                activityDate: evt.activityDate,
                dedupeKey,
                syncedAt: new Date().toISOString(),
                sourceUrl: evt.sourceUrl,
              },
            }),
          );
          syncedCount++;
        }
      } catch (srcErr) {
        console.error(`[WebsiteSync] ${ugName} failed:`, srcErr);
      }
    }

    // Update config with lastSync info
    const now = new Date().toISOString();
    try {
      if (configResult.Item) {
        await dynamoClient.send(
          new PutCommand({
            TableName: USERS_TABLE,
            Item: { ...configResult.Item, lastSyncTime: now, lastSyncResult: 'success', lastSyncSummary: `synced=${syncedCount}, skipped=${skippedCount}` },
          }),
        );
      }
    } catch { /* ignore */ }

    return jsonResponse(200, { success: true, syncedCount, skippedCount });
  } catch (err) {
    console.error('[WebsiteSync] Failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('SYNC_FAILED', `台湾 UG 同步失败: ${message}`, 500);
  }
}
