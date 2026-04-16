import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ErrorHttpStatus } from '@points-mall/shared';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { getFeatureToggles } from '../settings/feature-toggles';
import { checkContentPermission } from './content-permission';
import { getContentUploadUrl, createContentItem } from './upload';
import { editContentItem } from './edit';
import { listContentItems, getContentDetail } from './list';
import { addComment, listComments } from './comment';
import { toggleLike } from './like';
import { createReservation, getDownloadUrl, getPreviewUrl } from './reservation';
import { listCategories } from './admin';
import { listMyContent } from './mine';
import { searchTags, getHotTags, getTagCloudTags } from './tags';
import { listReservationActivities } from './reservation-activities';

// Create clients outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const CONTENT_ITEMS_TABLE = process.env.CONTENT_ITEMS_TABLE ?? '';
const CONTENT_TAGS_TABLE = process.env.CONTENT_TAGS_TABLE ?? '';
const CONTENT_CATEGORIES_TABLE = process.env.CONTENT_CATEGORIES_TABLE ?? '';
const CONTENT_COMMENTS_TABLE = process.env.CONTENT_COMMENTS_TABLE ?? '';
const CONTENT_LIKES_TABLE = process.env.CONTENT_LIKES_TABLE ?? '';
const CONTENT_RESERVATIONS_TABLE = process.env.CONTENT_RESERVATIONS_TABLE ?? '';
const USERS_TABLE = process.env.USERS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE ?? '';
const UGS_TABLE = process.env.UGS_TABLE ?? '';
const CONTENT_REWARD_POINTS = parseInt(process.env.CONTENT_REWARD_POINTS ?? '10', 10);

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
const CONTENT_ID_REGEX = /^\/api\/content\/([^/]+)$/;
const CONTENT_COMMENTS_REGEX = /^\/api\/content\/([^/]+)\/comments$/;
const CONTENT_LIKE_REGEX = /^\/api\/content\/([^/]+)\/like$/;
const CONTENT_RESERVE_REGEX = /^\/api\/content\/([^/]+)\/reserve$/;
const CONTENT_DOWNLOAD_REGEX = /^\/api\/content\/([^/]+)\/download$/;

/**
 * Fetch user nickname and first role from Users table.
 */
async function getUserInfo(userId: string): Promise<{ nickname: string; role: string }> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { userId },
      ProjectionExpression: 'nickname, #r',
      ExpressionAttributeNames: { '#r': 'roles' },
    }),
  );
  const nickname = result.Item?.nickname ?? '';
  const roles = result.Item?.roles ?? [];
  return { nickname, role: Array.isArray(roles) && roles.length > 0 ? roles[0] : '' };
}

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // ── POST routes ──────────────────────────────────────────

  if (method === 'POST') {
    if (path === '/api/content/upload-url') {
      return await handleGetUploadUrl(event);
    }

    if (path === '/api/content') {
      return await handleCreateContentItem(event);
    }

    const commentsMatch = path.match(CONTENT_COMMENTS_REGEX);
    if (commentsMatch) {
      return await handleAddComment(commentsMatch[1], event);
    }

    const likeMatch = path.match(CONTENT_LIKE_REGEX);
    if (likeMatch) {
      return await handleToggleLike(likeMatch[1], event);
    }

    const reserveMatch = path.match(CONTENT_RESERVE_REGEX);
    if (reserveMatch) {
      return await handleCreateReservation(reserveMatch[1], event);
    }
  }

  // ── GET routes ───────────────────────────────────────────

  if (method === 'GET') {
    if (path === '/api/content') {
      return await handleListContentItems(event);
    }

    if (path === '/api/content/categories') {
      return await handleListCategories();
    }

    if (path === '/api/content/mine') {
      return await handleListMyContent(event);
    }

    if (path === '/api/content/tags/search') {
      return await handleSearchTags(event);
    }

    if (path === '/api/content/tags/hot') {
      return await handleGetHotTags();
    }

    if (path === '/api/content/tags/cloud') {
      return await handleGetTagCloudTags();
    }

    if (path === '/api/content/reservation-activities') {
      return await handleListReservationActivities(event);
    }

    const downloadMatch = path.match(CONTENT_DOWNLOAD_REGEX);
    if (downloadMatch) {
      return await handleGetDownloadUrl(downloadMatch[1], event);
    }

    const commentsMatch = path.match(CONTENT_COMMENTS_REGEX);
    if (commentsMatch) {
      return await handleListComments(commentsMatch[1], event);
    }

    const idMatch = path.match(CONTENT_ID_REGEX);
    if (idMatch) {
      return await handleGetContentDetail(idMatch[1], event);
    }
  }

  // ── PUT routes ───────────────────────────────────────────

  if (method === 'PUT') {
    const idMatch = path.match(CONTENT_ID_REGEX);
    if (idMatch) {
      return await handleEditContentItem(idMatch[1], event);
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

// ── Route Handlers ─────────────────────────────────────────

async function handleGetUploadUrl(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canUpload', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有上传内容的权限', 403);
  }

  const body = parseBody(event);
  if (!body || !body.fileName || !body.contentType) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: fileName, contentType', 400);
  }

  const result = await getContentUploadUrl(
    {
      userId: event.user.userId,
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

async function handleCreateContentItem(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canUpload', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有上传内容的权限', 403);
  }

  const body = parseBody(event);
  if (!body || !body.title || !body.description || !body.categoryId || !body.fileKey || !body.fileName) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: title, description, categoryId, fileKey, fileName', 400);
  }

  const userInfo = await getUserInfo(event.user.userId);

  const result = await createContentItem(
    {
      userId: event.user.userId,
      userNickname: userInfo.nickname,
      userRole: userInfo.role,
      title: body.title as string,
      description: body.description as string,
      categoryId: body.categoryId as string,
      fileKey: body.fileKey as string,
      fileName: body.fileName as string,
      fileSize: (body.fileSize as number) ?? 0,
      videoUrl: body.videoUrl as string | undefined,
      tags: body.tags as string[] | undefined,
    },
    dynamoClient,
    { contentItemsTable: CONTENT_ITEMS_TABLE, categoriesTable: CONTENT_CATEGORIES_TABLE, contentTagsTable: CONTENT_TAGS_TABLE },
    { s3Client, bucket: IMAGES_BUCKET },
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { item: result.item });
}

async function handleListContentItems(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canAccess', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有访问内容中心的权限', 403);
  }

  const categoryId = event.queryStringParameters?.categoryId;
  const tag = event.queryStringParameters?.tag;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listContentItems(
    { categoryId, tag, pageSize, lastKey },
    dynamoClient,
    CONTENT_ITEMS_TABLE,
  );

  return jsonResponse(200, { items: result.items, lastKey: result.lastKey });
}

async function handleListCategories(): Promise<APIGatewayProxyResult> {
  const result = await listCategories(dynamoClient, CONTENT_CATEGORIES_TABLE);
  return jsonResponse(200, { categories: result.categories });
}

async function handleListMyContent(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status;
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listMyContent(
    { userId: event.user.userId, status, pageSize, lastKey },
    dynamoClient,
    CONTENT_ITEMS_TABLE,
  );

  return jsonResponse(200, { items: result.items, lastKey: result.lastKey });
}

async function handleGetContentDetail(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canAccess', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有访问内容中心的权限', 403);
  }

  const result = await getContentDetail(
    contentId,
    event.user.userId,
    dynamoClient,
    {
      contentItemsTable: CONTENT_ITEMS_TABLE,
      reservationsTable: CONTENT_RESERVATIONS_TABLE,
      likesTable: CONTENT_LIKES_TABLE,
    },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { item: result.item, hasReserved: result.hasReserved, hasLiked: result.hasLiked });
}

async function handleAddComment(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.content) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: content', 400);
  }

  const userInfo = await getUserInfo(event.user.userId);

  const result = await addComment(
    {
      contentId,
      userId: event.user.userId,
      userNickname: userInfo.nickname,
      userRole: userInfo.role,
      content: body.content as string,
    },
    dynamoClient,
    { commentsTable: CONTENT_COMMENTS_TABLE, contentItemsTable: CONTENT_ITEMS_TABLE },
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(201, { comment: result.comment });
}

async function handleListComments(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listComments(
    { contentId, pageSize, lastKey },
    dynamoClient,
    CONTENT_COMMENTS_TABLE,
  );

  return jsonResponse(200, { comments: result.comments, lastKey: result.lastKey });
}

async function handleToggleLike(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const result = await toggleLike(
    { contentId, userId: event.user.userId },
    dynamoClient,
    { likesTable: CONTENT_LIKES_TABLE, contentItemsTable: CONTENT_ITEMS_TABLE },
  );

  return jsonResponse(200, { liked: result.liked, likeCount: result.likeCount });
}

async function handleCreateReservation(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canReserve', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有预约内容的权限', 403);
  }

  const body = parseBody(event);
  const activityId = body?.activityId as string | undefined;
  if (!activityId) {
    return errorResponse('INVALID_REQUEST', 'activityId 为必填字段', 400);
  }

  const activityType = (body?.activityType as string) ?? '';
  const activityUG = (body?.activityUG as string) ?? '';
  const activityTopic = (body?.activityTopic as string) ?? '';
  const activityDate = (body?.activityDate as string) ?? '';

  const result = await createReservation(
    {
      contentId,
      userId: event.user.userId,
      activityId,
      activityType,
      activityUG,
      activityTopic,
      activityDate,
    },
    dynamoClient,
    {
      reservationsTable: CONTENT_RESERVATIONS_TABLE,
      contentItemsTable: CONTENT_ITEMS_TABLE,
      activitiesTable: ACTIVITIES_TABLE,
    },
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { success: true, alreadyReserved: result.alreadyReserved ?? false });
}

async function handleGetDownloadUrl(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
  if (!checkContentPermission(event.user.roles, 'canDownload', toggles)) {
    return errorResponse('PERMISSION_DENIED', '您没有下载内容的权限', 403);
  }

  const result = await getDownloadUrl(
    contentId,
    event.user.userId,
    dynamoClient,
    s3Client,
    { contentItemsTable: CONTENT_ITEMS_TABLE, reservationsTable: CONTENT_RESERVATIONS_TABLE },
    IMAGES_BUCKET,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { downloadUrl: result.downloadUrl });
}

async function handleEditContentItem(contentId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', 'Missing request body', 400);
  }

  const userInfo = await getUserInfo(event.user.userId);

  const result = await editContentItem(
    {
      contentId,
      userId: event.user.userId,
      title: body.title as string | undefined,
      description: body.description as string | undefined,
      categoryId: body.categoryId as string | undefined,
      videoUrl: body.videoUrl as string | undefined,
      fileKey: body.fileKey as string | undefined,
      fileName: body.fileName as string | undefined,
      fileSize: body.fileSize as number | undefined,
      tags: body.tags as string[] | undefined,
    },
    dynamoClient,
    s3Client,
    { contentItemsTable: CONTENT_ITEMS_TABLE, categoriesTable: CONTENT_CATEGORIES_TABLE, contentTagsTable: CONTENT_TAGS_TABLE },
    IMAGES_BUCKET,
  );

  if (!result.success) {
    const statusCode = (ErrorHttpStatus as Record<string, number>)[result.error!.code] ?? 400;
    return jsonResponse(statusCode, result.error);
  }

  return jsonResponse(200, { item: result.item });
}

// ── Tag Route Handlers ─────────────────────────────────────

async function handleListReservationActivities(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const pageSize = event.queryStringParameters?.pageSize
    ? parseInt(event.queryStringParameters.pageSize, 10)
    : undefined;
  const lastKey = event.queryStringParameters?.lastKey;

  const result = await listReservationActivities(
    { pageSize, lastKey },
    dynamoClient,
    { activitiesTable: ACTIVITIES_TABLE, ugsTable: UGS_TABLE },
  );

  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }

  return jsonResponse(200, { activities: result.activities, lastKey: result.lastKey });
}

async function handleSearchTags(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const prefix = event.queryStringParameters?.prefix ?? '';

  const result = await searchTags(
    { prefix },
    dynamoClient,
    CONTENT_TAGS_TABLE,
  );

  return jsonResponse(200, { tags: result.tags });
}

async function handleGetHotTags(): Promise<APIGatewayProxyResult> {
  const result = await getHotTags(dynamoClient, CONTENT_TAGS_TABLE);
  return jsonResponse(200, { tags: result.tags });
}

async function handleGetTagCloudTags(): Promise<APIGatewayProxyResult> {
  const result = await getTagCloudTags(dynamoClient, CONTENT_TAGS_TABLE);
  return jsonResponse(200, { tags: result.tags });
}