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
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { withAuth, type AuthenticatedEvent } from '../middleware/auth-middleware';
import { renderCredentialPage, render404Page } from './render';
import { batchCreateCredentials } from './batch';
import { revokeCredential } from './revoke';
import { exportCredentialsToFeishu, type FeishuExportField } from './feishu-export';
import { getMyApplications } from './eligibility';
import { applyForCredential } from './self-apply';
import { getMyCredentials } from './my-credentials';
import {
  assertSuperAdmin,
  createAssociation,
  deleteAssociation,
  listAssociations,
  updateAssociation,
} from './association';
import type { Credential, SourceRole } from './types';

// ============================================================
// Clients & env vars — created outside handler for container reuse
// ============================================================

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CREDENTIALS_TABLE = process.env.CREDENTIALS_TABLE ?? '';
const CREDENTIAL_SEQUENCES_TABLE = process.env.CREDENTIAL_SEQUENCES_TABLE ?? '';
const USERS_TABLE = process.env.USERS_TABLE ?? '';
const ASSOCIATIONS_TABLE = process.env.ASSOCIATIONS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE ?? '';
const BASE_URL = process.env.BASE_URL ?? 'https://creds.awscommunity.cn';
const CF_DISTRIBUTION_ID = process.env.CF_DISTRIBUTION_ID ?? '';

const cfClient = CF_DISTRIBUTION_ID ? new CloudFrontClient({}) : null;

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
const CREDENTIAL_EXPORT_FEISHU_PATH = '/api/admin/credentials/export-feishu';
const CREDENTIAL_DETAIL_REGEX = /^\/api\/admin\/credentials\/([^/]+)$/;
const CREDENTIAL_REVOKE_REGEX = /^\/api\/admin\/credentials\/([^/]+)\/revoke$/;

// User-side self-application routes (any authenticated user)
const USER_CREDENTIALS_PREFIX = '/api/credentials/';
const MY_APPLICATIONS_PATH = '/api/credentials/my-applications';
const APPLY_PATH = '/api/credentials/apply';
const MY_CREDENTIALS_PATH = '/api/credentials/my-credentials';

// Admin-side association routes (SuperAdmin only)
const ASSOCIATION_LIST_PATH = '/api/admin/credential-associations';
const ASSOCIATION_DETAIL_REGEX = /^\/api\/admin\/credential-associations\/([^/]+)$/;

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
  // Redirect store.awscommunity.cn/c/* to creds.awscommunity.cn/c/*
  const host = event.headers?.['X-Forwarded-Host'] || event.headers?.['x-forwarded-host'] || event.headers?.Host || event.headers?.host || '';
  if (host.includes('store.awscommunity.cn') && event.path.startsWith('/c/')) {
    return {
      statusCode: 301,
      headers: { Location: `https://creds.awscommunity.cn${event.path}` },
      body: '',
    };
  }

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
// Admin route: POST /api/admin/credentials/export-feishu — export to Feishu Bitable
// ============================================================

const SYNC_CONFIG_KEY = 'activity-sync-config';

async function handleExportFeishu(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空');
  }

  const { fields, statusFilter, search: searchQuery, title } = body as {
    fields?: FeishuExportField[];
    statusFilter?: string;
    search?: string;
    title?: string;
  };

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return errorResponse('MISSING_REQUIRED_FIELD', '请至少选择一个导出字段');
  }

  try {
    // 1. Get Feishu credentials from sync config
    const configResult = await dynamoClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: SYNC_CONFIG_KEY },
      }),
    );

    const config = configResult.Item;
    if (!config?.feishuAppId || !config?.feishuAppSecret) {
      return errorResponse('MISSING_CONFIG', '飞书 API 凭证未配置（请在同步设置中配置 App ID 和 App Secret）', 400);
    }

    // 2. Fetch credentials to export (same logic as list, but without pagination)
    let items: Record<string, unknown>[];

    if (statusFilter && (statusFilter === 'active' || statusFilter === 'revoked')) {
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: CREDENTIALS_TABLE,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': statusFilter },
          ScanIndexForward: false,
        }),
      );
      items = (queryResult.Items ?? []) as Record<string, unknown>[];
    } else {
      const scanResult = await dynamoClient.send(
        new ScanCommand({ TableName: CREDENTIALS_TABLE }),
      );
      items = (scanResult.Items ?? []) as Record<string, unknown>[];
      items.sort((a, b) => {
        const aDate = (a.createdAt as string) ?? '';
        const bDate = (b.createdAt as string) ?? '';
        return bDate.localeCompare(aDate);
      });
    }

    // Apply search filter
    if (searchQuery) {
      const lowerSearch = searchQuery.toLowerCase();
      items = items.filter((item) => {
        const id = ((item.credentialId as string) ?? '').toLowerCase();
        const name = ((item.recipientName as string) ?? '').toLowerCase();
        const eventName = ((item.eventName as string) ?? '').toLowerCase();
        return id.includes(lowerSearch) || name.includes(lowerSearch) || eventName.includes(lowerSearch);
      });
    }

    const credentials = items as unknown as Credential[];

    // 3. Export to Feishu
    const result = await exportCredentialsToFeishu({
      appId: config.feishuAppId as string,
      appSecret: config.feishuAppSecret as string,
      credentials,
      fields,
      title,
      baseUrl: BASE_URL,
    });

    if (!result.success) {
      return errorResponse(result.error?.code ?? 'EXPORT_FAILED', result.error?.message ?? '导出失败', 500);
    }

    return jsonResponse(200, {
      tableUrl: result.tableUrl,
      recordCount: result.recordCount,
    });
  } catch (err) {
    console.error('Error exporting to Feishu:', err);
    return errorResponse('INTERNAL_ERROR', '导出到飞书失败', 500);
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

    // Invalidate CloudFront cache for the revoked credential page
    if (cfClient && CF_DISTRIBUTION_ID) {
      try {
        await cfClient.send(new CreateInvalidationCommand({
          DistributionId: CF_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `revoke-${credentialId}-${Date.now()}`,
            Paths: { Quantity: 1, Items: [`/c/${credentialId}`] },
          },
        }));
      } catch (cfErr) {
        console.warn('CloudFront invalidation failed (non-blocking):', cfErr);
      }
    }

    return jsonResponse(200, result.credential);
  } catch (err) {
    console.error('Error revoking credential:', err);
    return errorResponse('INTERNAL_ERROR', '撤销凭证失败', 500);
  }
}

// ============================================================
// User route handlers — /api/credentials/* (any authenticated user)
// ============================================================

// GET /api/credentials/my-applications — eligible + applied items
async function handleMyApplications(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  try {
    const result = await getMyApplications(event.user.userId, dynamoClient, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      associationsTable: ASSOCIATIONS_TABLE,
      credentialsTable: CREDENTIALS_TABLE,
    });
    return jsonResponse(200, result);
  } catch (err) {
    console.error('Error computing my applications:', err);
    return errorResponse('INTERNAL_ERROR', '获取可申请项失败', 500);
  }
}

// POST /api/credentials/apply — submit application & generate credential
async function handleApply(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空');
  }

  // Use ONLY the authenticated userId; ignore any client-supplied identifier (Req 9.5).
  const input = {
    activityId: typeof body.activityId === 'string' ? body.activityId : '',
    sourceRole: body.sourceRole as SourceRole,
    recipientName: typeof body.recipientName === 'string' ? body.recipientName : '',
  };

  try {
    const result = await applyForCredential(
      event.user.userId,
      input,
      dynamoClient,
      {
        credentialsTable: CREDENTIALS_TABLE,
        associationsTable: ASSOCIATIONS_TABLE,
        pointsRecordsTable: POINTS_RECORDS_TABLE,
        credentialSequencesTable: CREDENTIAL_SEQUENCES_TABLE,
      },
      BASE_URL,
    );

    if (!result.success) {
      return errorResponse(result.code, result.message, result.statusCode);
    }

    return jsonResponse(200, { credentialId: result.credentialId, url: result.url });
  } catch (err) {
    console.error('Error applying for credential:', err);
    return errorResponse('INTERNAL_ERROR', '申请证书失败', 500);
  }
}

// GET /api/credentials/my-credentials — all self-applied credentials for the user
async function handleMyCredentials(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  try {
    const result = await getMyCredentials(
      event.user.userId,
      dynamoClient,
      { credentialsTable: CREDENTIALS_TABLE },
      BASE_URL,
    );
    return jsonResponse(200, result);
  } catch (err) {
    console.error('Error fetching my credentials:', err);
    return errorResponse('INTERNAL_ERROR', '获取我的证书失败', 500);
  }
}

// ============================================================
// User authenticated handler — /api/credentials/* (no admin gate)
// ============================================================

const userAuthenticatedHandler = withAuth(async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // GET /api/credentials/my-applications
  if (method === 'GET' && path === MY_APPLICATIONS_PATH) {
    return handleMyApplications(event);
  }

  // POST /api/credentials/apply
  if (method === 'POST' && path === APPLY_PATH) {
    return handleApply(event);
  }

  // GET /api/credentials/my-credentials
  if (method === 'GET' && path === MY_CREDENTIALS_PATH) {
    return handleMyCredentials(event);
  }

  return errorResponse('NOT_FOUND', '路由不存在', 404);
});

// ============================================================
// Admin route handlers — /api/admin/credential-associations/* (SuperAdmin only)
// ============================================================

// GET /api/admin/credential-associations — list associations
async function handleListAssociations(): Promise<APIGatewayProxyResult> {
  try {
    const result = await listAssociations({
      dynamoClient,
      associationsTable: ASSOCIATIONS_TABLE,
    });
    if (!result.success) {
      return errorResponse(result.code, result.message, result.statusCode);
    }
    return jsonResponse(200, { associations: result.associations });
  } catch (err) {
    console.error('Error listing associations:', err);
    return errorResponse('INTERNAL_ERROR', '获取关联列表失败', 500);
  }
}

// POST /api/admin/credential-associations — create association
async function handleCreateAssociation(event: AuthenticatedEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空');
  }

  try {
    const result = await createAssociation({
      input: body,
      createdBy: event.user.userId,
      dynamoClient,
      associationsTable: ASSOCIATIONS_TABLE,
      activitiesTable: ACTIVITIES_TABLE,
    });
    if (!result.success) {
      return errorResponse(result.code, result.message, result.statusCode);
    }
    return jsonResponse(200, result.association);
  } catch (err) {
    console.error('Error creating association:', err);
    return errorResponse('INTERNAL_ERROR', '创建关联失败', 500);
  }
}

// GET /api/admin/credential-associations/{id} — association detail
async function handleGetAssociationDetail(associationId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: ASSOCIATIONS_TABLE,
        Key: { associationId },
      }),
    );
    if (!result.Item) {
      return errorResponse('ASSOCIATION_NOT_FOUND', '证书模版关联不存在', 404);
    }
    return jsonResponse(200, result.Item);
  } catch (err) {
    console.error('Error fetching association detail:', err);
    return errorResponse('INTERNAL_ERROR', '获取关联详情失败', 500);
  }
}

// PUT /api/admin/credential-associations/{id} — update association
async function handleUpdateAssociation(
  associationId: string,
  event: AuthenticatedEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse('INVALID_REQUEST', '请求体不能为空');
  }

  try {
    const result = await updateAssociation({
      associationId,
      input: body,
      updatedBy: event.user.userId,
      dynamoClient,
      associationsTable: ASSOCIATIONS_TABLE,
      activitiesTable: ACTIVITIES_TABLE,
    });
    if (!result.success) {
      return errorResponse(result.code, result.message, result.statusCode);
    }
    return jsonResponse(200, result.association);
  } catch (err) {
    console.error('Error updating association:', err);
    return errorResponse('INTERNAL_ERROR', '更新关联失败', 500);
  }
}

// DELETE /api/admin/credential-associations/{id} — delete association
async function handleDeleteAssociation(associationId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await deleteAssociation({
      associationId,
      dynamoClient,
      associationsTable: ASSOCIATIONS_TABLE,
    });
    if (!result.success) {
      return errorResponse(result.code, result.message, result.statusCode);
    }
    return jsonResponse(200, { associationId: result.associationId });
  } catch (err) {
    console.error('Error deleting association:', err);
    return errorResponse('INTERNAL_ERROR', '删除关联失败', 500);
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

  // ---- Activity_Template_Association routes (SuperAdmin only) ----
  // These are matched BEFORE the credentials routes; the 'credential-associations'
  // literal differs from 'credentials/' so there is no overlap with the
  // CREDENTIAL_DETAIL_REGEX (/^\/api\/admin\/credentials\/([^/]+)$/).
  if (path === ASSOCIATION_LIST_PATH || ASSOCIATION_DETAIL_REGEX.test(path)) {
    // Tighten authorization to SuperAdmin for all association operations
    // (Requirements 2.8, 2.9, 9.7, 9.8, 10.6, 10.7).
    const auth = assertSuperAdmin(event.user.roles);
    if (!auth.authorized) {
      return errorResponse(auth.code, auth.message, auth.statusCode);
    }

    if (path === ASSOCIATION_LIST_PATH) {
      if (method === 'GET') return handleListAssociations();
      if (method === 'POST') return handleCreateAssociation(event);
      return errorResponse('NOT_FOUND', '路由不存在', 404);
    }

    const detailMatch = path.match(ASSOCIATION_DETAIL_REGEX);
    if (detailMatch) {
      const associationId = decodeURIComponent(detailMatch[1]);
      if (method === 'GET') return handleGetAssociationDetail(associationId);
      if (method === 'PUT') return handleUpdateAssociation(associationId, event);
      if (method === 'DELETE') return handleDeleteAssociation(associationId);
      return errorResponse('NOT_FOUND', '路由不存在', 404);
    }
  }

  // GET /api/admin/credentials — list
  if (method === 'GET' && path === CREDENTIAL_LIST_PATH) {
    return handleListCredentials(event);
  }

  // POST /api/admin/credentials/batch — batch create
  if (method === 'POST' && path === CREDENTIAL_BATCH_PATH) {
    return handleBatchCreate(event);
  }

  // POST /api/admin/credentials/export-feishu — export to Feishu
  if (method === 'POST' && path === CREDENTIAL_EXPORT_FEISHU_PATH) {
    return handleExportFeishu(event);
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

  // User-side self-application routes: /api/credentials/* — any authenticated user
  // (NOT gated to admins). Kept separate from the admin handler so ordinary users
  // can reach them while admin routes retain their Admin/SuperAdmin gate.
  if (event.path.startsWith(USER_CREDENTIALS_PREFIX)) {
    return userAuthenticatedHandler(event);
  }

  // All other routes require auth (admin)
  return authenticatedHandler(event);
}
