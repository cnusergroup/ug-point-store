// Lambda handler for community credentials module
// Routes: public credential page + admin CRUD operations

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { renderCredentialPage, render404Page } from './render';
import { batchCreateCredentials } from './batch';
import { revokeCredential } from './revoke';
import type { Credential } from './types';

// ============================================================
// Clients & env vars — created outside handler for container reuse
// ============================================================

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CREDENTIALS_TABLE = process.env.CREDENTIALS_TABLE ?? '';
const CREDENTIAL_SEQUENCES_TABLE = process.env.CREDENTIAL_SEQUENCES_TABLE ?? '';
const BASE_URL = process.env.BASE_URL ?? 'https://store.awscommunity.cn';

// ============================================================
// Constants
// ============================================================

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

// Path patterns
const PUBLIC_CREDENTIAL_REGEX = /^\/c\/([^/]+)$/;
const CREDENTIAL_LIST_PATH = '/api/admin/credentials';
const CREDENTIAL_BATCH_PATH = '/api/admin/credentials/batch';
const CREDENTIAL_DETAIL_REGEX = /^\/api\/admin\/credentials\/([^/]+)$/;
const CREDENTIAL_REVOKE_REGEX = /^\/api\/admin\/credentials\/([^/]+)\/revoke$/;

// ============================================================
// Response helpers
// ============================================================

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(code: string, message: string, statusCode = 400): APIGatewayProxyResult {
  return jsonResponse(statusCode, { code, message });
}

function htmlResponse(statusCode: number, html: string, cacheControl?: string): APIGatewayProxyResult {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
  };
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }
  return { statusCode, headers, body: html };
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

// ============================================================
// Public route: GET /c/{credentialId}
// ============================================================

async function handlePublicCredentialPage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const match = event.path.match(PUBLIC_CREDENTIAL_REGEX);
  if (!match) {
    return htmlResponse(404, render404Page('zh'));
  }

  const credentialId = decodeURIComponent(match[1]);

  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CREDENTIALS_TABLE,
        Key: { credentialId },
      }),
    );

    if (!result.Item) {
      return htmlResponse(404, render404Page('zh'));
    }

    const credential = result.Item as Credential;
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });

    return htmlResponse(200, html, 'public, max-age=3600');
  } catch (err) {
    console.error('Error fetching credential for public page:', err);
    return htmlResponse(500, render404Page('zh'));
  }
}

// ============================================================
// Admin route: GET /api/admin/credentials — list with search/filter/pagination
// ============================================================

async function handleListCredentials(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};
  const search = params.search?.trim() ?? '';
  const statusFilter = params.status ?? '';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize ?? '20', 10) || 20));

  try {
    let items: Record<string, unknown>[];

    if (statusFilter && (statusFilter === 'active' || statusFilter === 'revoked')) {
      // Use GSI for status filtering
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: CREDENTIALS_TABLE,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': statusFilter },
          ScanIndexForward: false, // newest first
        }),
      );
      items = (queryResult.Items ?? []) as Record<string, unknown>[];
    } else {
      // Scan all items
      const scanResult = await dynamoClient.send(
        new ScanCommand({ TableName: CREDENTIALS_TABLE }),
      );
      items = (scanResult.Items ?? []) as Record<string, unknown>[];
      // Sort by createdAt descending
      items.sort((a, b) => {
        const aDate = (a.createdAt as string) ?? '';
        const bDate = (b.createdAt as string) ?? '';
        return bDate.localeCompare(aDate);
      });
    }

    // Apply search filter (client-side for simplicity)
    if (search) {
      const lowerSearch = search.toLowerCase();
      items = items.filter((item) => {
        const id = ((item.credentialId as string) ?? '').toLowerCase();
        const name = ((item.recipientName as string) ?? '').toLowerCase();
        const eventName = ((item.eventName as string) ?? '').toLowerCase();
        return id.includes(lowerSearch) || name.includes(lowerSearch) || eventName.includes(lowerSearch);
      });
    }

    const total = items.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = items.slice(startIndex, startIndex + pageSize);

    return jsonResponse(200, {
      items: paginatedItems,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error('Error listing credentials:', err);
    return errorResponse('INTERNAL_ERROR', '获取凭证列表失败', 500);
  }
}

// ============================================================
// Admin route: GET /api/admin/credentials/{credentialId} — detail
// ============================================================

async function handleGetCredentialDetail(credentialId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: CREDENTIALS_TABLE,
        Key: { credentialId },
      }),
    );

    if (!result.Item) {
      return errorResponse('CREDENTIAL_NOT_FOUND', '凭证不存在', 404);
    }

    return jsonResponse(200, result.Item);
  } catch (err) {
    console.error('Error fetching credential detail:', err);
    return errorResponse('INTERNAL_ERROR', '获取凭证详情失败', 500);
  }
}

// ============================================================
// Admin route: POST /api/admin/credentials/batch — batch create
// ============================================================

async function handleBatchCreate(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空');
  }

  const { eventPrefix, year, season, csvContent } = body as {
    eventPrefix?: string;
    year?: string;
    season?: string;
    csvContent?: string;
  };

  if (!eventPrefix || !year || !season) {
    return errorResponse('MISSING_REQUIRED_FIELD', '缺少必填参数: eventPrefix, year, season');
  }

  if (!csvContent || typeof csvContent !== 'string') {
    return errorResponse('INVALID_CSV', 'CSV 内容不能为空');
  }

  try {
    const result = await batchCreateCredentials({
      dynamoClient,
      credentialsTableName: CREDENTIALS_TABLE,
      sequencesTableName: CREDENTIAL_SEQUENCES_TABLE,
      eventPrefix: eventPrefix as string,
      year: year as string,
      season: season as string,
      csvContent: csvContent as string,
    });

    return jsonResponse(200, result);
  } catch (err) {
    console.error('Error in batch create:', err);
    return errorResponse('INTERNAL_ERROR', '批量生成凭证失败', 500);
  }
}

// ============================================================
// Admin route: PATCH /api/admin/credentials/{credentialId}/revoke
// ============================================================

async function handleRevoke(credentialId: string, event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  // SuperAdmin check
  if (!event.user.roles.includes('SuperAdmin')) {
    return errorResponse('FORBIDDEN', '仅 SuperAdmin 可执行撤销操作', 403);
  }

  const body = parseBody(event);
  const reason = (body?.reason as string) ?? '';

  if (!reason.trim()) {
    return errorResponse('MISSING_REQUIRED_FIELD', '撤销原因不能为空');
  }

  try {
    const result = await revokeCredential({
      dynamoClient,
      tableName: CREDENTIALS_TABLE,
      credentialId,
      revokedBy: event.user.userId,
      revokeReason: reason.trim(),
      callerRole: 'SuperAdmin', // already verified above
    });

    if (!result.success) {
      const statusCode = result.code === 'CREDENTIAL_NOT_FOUND' ? 404
        : result.code === 'ALREADY_REVOKED' ? 400
        : result.code === 'FORBIDDEN' ? 403
        : 400;
      return errorResponse(result.code, result.message, statusCode);
    }

    return jsonResponse(200, result.credential);
  } catch (err) {
    console.error('Error revoking credential:', err);
    return errorResponse('INTERNAL_ERROR', '撤销凭证失败', 500);
  }
}

// ============================================================
// Authenticated handler — all admin routes
// ============================================================

const authenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  // Admin role check
  const hasAdminRole = event.user.roles.some(r => r === 'Admin' || r === 'SuperAdmin');
  if (!hasAdminRole) {
    return errorResponse('FORBIDDEN', '需要管理员权限', 403);
  }

  const method = event.httpMethod;
  const path = event.path;

  // GET /api/admin/credentials — list
  if (method === 'GET' && path === CREDENTIAL_LIST_PATH) {
    return handleListCredentials(event);
  }

  // POST /api/admin/credentials/batch — batch create
  if (method === 'POST' && path === CREDENTIAL_BATCH_PATH) {
    return handleBatchCreate(event);
  }

  // PATCH /api/admin/credentials/{id}/revoke — revoke (must check before detail regex)
  if (method === 'PATCH') {
    const revokeMatch = path.match(CREDENTIAL_REVOKE_REGEX);
    if (revokeMatch) {
      return handleRevoke(decodeURIComponent(revokeMatch[1]), event);
    }
  }

  // GET /api/admin/credentials/{id} — detail
  if (method === 'GET') {
    const detailMatch = path.match(CREDENTIAL_DETAIL_REGEX);
    if (detailMatch) {
      return handleGetCredentialDetail(decodeURIComponent(detailMatch[1]));
    }
  }

  return errorResponse('NOT_FOUND', '路由不存在', 404);
});

// ============================================================
// Main handler — entry point
// ============================================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  // Public route: GET /c/{credentialId} — no auth needed
  if (event.httpMethod === 'GET' && event.path.startsWith('/c/')) {
    return handlePublicCredentialPage(event);
  }

  // All other routes require auth
  return authenticatedHandler(event);
}
