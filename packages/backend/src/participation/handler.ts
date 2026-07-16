/**
 * Query Lambda 入口 (`packages/backend/src/participation/handler.ts`)。
 *
 * 完全独立于商城 Auth/Admin Lambda：独立路由、独立 DynamoDB 表、独立 JWT 密钥。
 * 公开路由：`POST /api/query/login`。
 * 受保护路由（`withQuerySession` 包装）：四类查询数据接口 + 导出接口。
 * `POST /api/query/logout` 无需会话校验，直接返回 200（JWT 无状态，客户端清除本地存储）。
 *
 * See design.md "8. Lambda 入口"。
 * Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 7.1, 8.1, 9.1, 13.1。
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand as DDBQueryCommand, BatchGetCommand as DDBBatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ErrorCodes, ErrorMessages, ErrorHttpStatus } from '@points-mall/shared';
import type { ErrorCode } from '@points-mall/shared';
import { getOrBootstrapCredential, verifyCredential } from './credential';
import { getBootstrapDefaults } from './bootstrap-defaults';
import {
  evaluateLockout,
  getLockoutState,
  recordFailure,
  recordSuccess,
  saveLockoutState,
} from './login-lockout';
import { issueQuerySession } from './session';
import { withQuerySession } from './auth-middleware';
import {
  querySpeakerSupport,
  queryVolunteerSupport,
  queryTotalCount,
  queryEmployeeActivityDetail,
  queryActivityDetail,
  queryImpactSummary,
} from './query';
import type { QueryContext, ViewFilter, ActivityViewFilter } from './query';
import { executeParticipationExport } from './export';
import type { ExportContext } from './export';
import type { ParticipationView, ExportFormat } from './formatters';

// Create clients outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const QUERY_CREDENTIALS_TABLE = process.env.QUERY_CREDENTIALS_TABLE ?? '';
const QUERY_LOGIN_ATTEMPTS_TABLE = process.env.QUERY_LOGIN_ATTEMPTS_TABLE ?? '';

// 只读业务表（Users/PointsRecords/BatchDistributions/Activities）与导出用图片 S3 桶，
// 与 Admin Lambda 沿用相同的环境变量命名（`IMAGES_BUCKET`）以保持一致。
const USERS_TABLE = process.env.USERS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const BATCH_DISTRIBUTIONS_TABLE = process.env.BATCH_DISTRIBUTIONS_TABLE ?? '';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE ?? '';
const IMAGES_BUCKET = process.env.IMAGES_BUCKET ?? '';
const CONTENT_ITEMS_TABLE = process.env.CONTENT_ITEMS_TABLE ?? '';

const queryContext: QueryContext = {
  dynamoClient,
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
  activitiesTable: ACTIVITIES_TABLE,
};

const exportContext: ExportContext = {
  ...queryContext,
  s3Client,
  bucket: IMAGES_BUCKET,
};

const VALID_PARTICIPATION_VIEWS: ParticipationView[] = [
  'speaker-support',
  'volunteer-support',
  'total-count',
  'employee-activity-detail',
  'activity-detail',
];

/** 将查询/导出模块返回的错误码映射到 HTTP 状态码；未知错误码回退为 500。 */
function errorStatusFor(code: string): number {
  return code in ErrorHttpStatus ? ErrorHttpStatus[code as ErrorCode] : 500;
}

/** 用户名/密码长度上限，Requirement 3.2 */
const MAX_CREDENTIAL_FIELD_LENGTH = 64;

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

function errorResponse(code: string, message: string, statusCode: number): APIGatewayProxyResult {
  return jsonResponse(statusCode, { code, message });
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

/**
 * 提取客户端来源 IP。请求经 CloudFront 到达 API Gateway 时，
 * `requestContext.identity.sourceIp` 是 CloudFront 边缘节点 IP，
 * 真实客户端 IP 是 `X-Forwarded-For` 头的第一个条目（模式参考 `auth/handler.ts`）。
 */
function extractClientIp(event: APIGatewayProxyEvent): string | undefined {
  const xff = event.headers?.['X-Forwarded-For'] ?? event.headers?.['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return event.requestContext?.identity?.sourceIp;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  try {
    // POST /api/query/login（公开）
    if (method === 'POST' && path === '/api/query/login') {
      return await handleLogin(event);
    }

    // POST /api/query/logout（无需会话校验，JWT 无状态，客户端清除本地存储即可）
    if (method === 'POST' && path === '/api/query/logout') {
      return jsonResponse(200, { success: true });
    }

    // 公开路由（无需会话校验）：驱动 store.awscommunity.cn 的公开榜单页
    // （Top Speakers / Top Volunteers / Event Contribution Record）。
    // 这三个视图仅暴露花名、邮箱与支持次数/活动记录，供社区公开展示。
    if (method === 'GET' && path === '/api/query/speaker-support') {
      return await handleSpeakerSupport(event);
    }
    if (method === 'GET' && path === '/api/query/volunteer-support') {
      return await handleVolunteerSupport(event);
    }
    if (method === 'GET' && path === '/api/query/activity-detail') {
      return await handleActivityDetail(event);
    }
    if (method === 'GET' && path === '/api/query/impact-summary') {
      return await handleImpactSummary(event);
    }
    if (method === 'GET' && path === '/api/query/content-contributors') {
      return await handleContentContributors(event);
    }

    // 受保护路由：withQuerySession 包装（内部查询工具使用，需登录）
    if (method === 'GET' && path === '/api/query/total-count') {
      return await withQuerySession(handleTotalCount)(event);
    }
    if (method === 'GET' && path === '/api/query/employee-activity-detail') {
      return await withQuerySession(handleEmployeeActivityDetail)(event);
    }
    if (method === 'POST' && path === '/api/query/export') {
      return await withQuerySession(handleExport)(event);
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  } catch (err) {
    console.error('Unhandled error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * POST /api/query/login
 *
 * 流程：
 * 1. 校验用户名/密码存在且长度均不超过 64 字符
 * 2. 提取客户端来源 IP
 * 3. 检查该来源是否处于锁定状态；锁定则返回 403 QUERY_LOGIN_LOCKED（含剩余锁定时长）
 * 4. 未锁定则确保凭证表已 bootstrap，再校验用户名密码
 * 5. 校验成功：重置该来源失败计数，签发 Query_Session，返回 200
 * 6. 校验失败：累加该来源失败计数，返回 401 QUERY_INVALID_CREDENTIALS
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3。
 */
async function handleLogin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const username = body?.username;
  const password = body?.password;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return errorResponse('INVALID_REQUEST', '缺少必填字段：username、password', 400);
  }

  if (username.length > MAX_CREDENTIAL_FIELD_LENGTH || password.length > MAX_CREDENTIAL_FIELD_LENGTH) {
    return errorResponse('INVALID_REQUEST', '用户名或密码长度不能超过 64 个字符', 400);
  }

  const sourceIp = extractClientIp(event) ?? 'unknown';

  const lockoutState = await getLockoutState(sourceIp, dynamoClient, QUERY_LOGIN_ATTEMPTS_TABLE);
  const lockoutCheck = evaluateLockout(lockoutState, Date.now());

  if (lockoutCheck.locked) {
    return jsonResponse(403, {
      code: ErrorCodes.QUERY_LOGIN_LOCKED,
      message: ErrorMessages[ErrorCodes.QUERY_LOGIN_LOCKED],
      remainingMs: lockoutCheck.remainingMs,
    });
  }

  // 确保查询凭证表已初始化（表为空时使用注入的默认用户名/密码哈希创建默认记录）
  const defaults = await getBootstrapDefaults();
  await getOrBootstrapCredential(dynamoClient, QUERY_CREDENTIALS_TABLE, defaults);

  const verifyResult = await verifyCredential(username, password, dynamoClient, QUERY_CREDENTIALS_TABLE);

  if (!verifyResult.valid) {
    const newState = recordFailure(lockoutState, Date.now());
    await saveLockoutState(sourceIp, newState, dynamoClient, QUERY_LOGIN_ATTEMPTS_TABLE);
    return errorResponse(
      ErrorCodes.QUERY_INVALID_CREDENTIALS,
      ErrorMessages[ErrorCodes.QUERY_INVALID_CREDENTIALS],
      401,
    );
  }

  const resetState = recordSuccess();
  await saveLockoutState(sourceIp, resetState, dynamoClient, QUERY_LOGIN_ATTEMPTS_TABLE);

  const token = await issueQuerySession({ credentialVersion: verifyResult.version! });

  return jsonResponse(200, { token });
}

/**
 * GET /api/query/speaker-support
 *
 * 解析查询字符串参数（keyword、startDate、endDate）为 ViewFilter，调用 querySpeakerSupport。
 * Requirements: 6.1, 10.1, 11.1。
 */
async function handleSpeakerSupport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseViewFilter(event);
  const result = await querySpeakerSupport(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { rows: result.rows });
}

/**
 * GET /api/query/volunteer-support
 * Requirements: 7.1, 10.1, 11.1。
 */
async function handleVolunteerSupport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseViewFilter(event);
  const result = await queryVolunteerSupport(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { rows: result.rows });
}

/**
 * GET /api/query/total-count
 *
 * Speaker 与志愿者身份按 activityId 去重合并后的总支持次数视图。
 */
async function handleTotalCount(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseViewFilter(event);
  const result = await queryTotalCount(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { rows: result.rows });
}

/**
 * GET /api/query/employee-activity-detail
 * Requirements: 8.1, 10.1, 11.1。
 */
async function handleEmployeeActivityDetail(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseViewFilter(event);
  const result = await queryEmployeeActivityDetail(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { rows: result.rows });
}

/**
 * GET /api/query/activity-detail
 *
 * 解析查询字符串参数（activityId、topicKeyword、startDate、endDate、page）为 ActivityViewFilter，
 * 调用 queryActivityDetail（分页版本）。
 * Requirements: 9.1, 9.7, 11.1。
 */
async function handleActivityDetail(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseActivityViewFilter(event);
  const result = await queryActivityDetail(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, {
    rows: result.rows,
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
  });
}

/**
 * GET /api/query/impact-summary（公开）
 *
 * 解析 startDate、endDate 查询参数，返回顶部影响力汇总：
 * RSVP 总数 / SA Impacted RSVP / Meetup 场次总数 / SA 参加场次数。
 */
async function handleImpactSummary(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const filter = parseActivityViewFilter(event);
  const result = await queryImpactSummary(filter, queryContext);

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { summary: result.summary });
}

/**
 * GET /api/query/content-contributors（公开）
 *
 * 查询内容贡献者排行：仅员工（isEmployee=true），按 approved 内容数量降序排列。
 * 并列排名（同一数量的人获得相同排名）。
 * 返回每人的内容数量和去重后的 tags 合集。
 */
async function handleContentContributors(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const startDate = qs.startDate ?? undefined;
  const endDate = qs.endDate ?? undefined;

  try {
    // 1. Query ContentItems using status-createdAt-index GSI (status=approved)
    let keyCondition = '#status = :status';
    const exprValues: Record<string, unknown> = { ':status': 'approved' };
    const exprNames: Record<string, string> = { '#status': 'status' };

    if (startDate && endDate) {
      keyCondition += ' AND createdAt BETWEEN :startDate AND :endDate';
      exprValues[':startDate'] = startDate;
      exprValues[':endDate'] = endDate;
    } else if (startDate) {
      keyCondition += ' AND createdAt >= :startDate';
      exprValues[':startDate'] = startDate;
    } else if (endDate) {
      keyCondition += ' AND createdAt <= :endDate';
      exprValues[':endDate'] = endDate;
    }

    // Paginate through all results
    const allItems: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await dynamoClient.send(
        new DDBQueryCommand({
          TableName: CONTENT_ITEMS_TABLE,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        }),
      );
      allItems.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // 2. Aggregate by uploaderId: count + tags
    const uploaderMap = new Map<string, { count: number; tags: Set<string> }>();
    for (const item of allItems) {
      const uploaderId = (item.uploaderId as string) ?? '';
      if (!uploaderId) continue;
      const existing = uploaderMap.get(uploaderId);
      const itemTags = (item.tags as string[]) ?? [];
      if (existing) {
        existing.count++;
        for (const tag of itemTags) existing.tags.add(tag);
      } else {
        uploaderMap.set(uploaderId, { count: 1, tags: new Set(itemTags) });
      }
    }

    if (uploaderMap.size === 0) {
      return jsonResponse(200, { rows: [] });
    }

    // 3. BatchGet Users to get nickname + isEmployee filter
    const userIds = [...uploaderMap.keys()];
    const userMap = new Map<string, { nickname: string; email: string; isEmployee: boolean }>();
    for (let i = 0; i < userIds.length; i += 100) {
      const chunk = userIds.slice(i, i + 100);
      const batchResult = await dynamoClient.send(
        new DDBBatchGetCommand({
          RequestItems: {
            [USERS_TABLE]: {
              Keys: chunk.map(userId => ({ userId })),
              ProjectionExpression: 'userId, nickname, email, isEmployee',
            },
          },
        }),
      );
      const items = batchResult.Responses?.[USERS_TABLE] ?? [];
      for (const u of items) {
        userMap.set(u.userId as string, {
          nickname: (u.nickname as string) ?? '',
          email: (u.email as string) ?? '',
          isEmployee: (u.isEmployee as boolean) ?? false,
        });
      }
    }

    // 4. Filter to employees only, build sorted list
    const rows: { nickname: string; email: string; contentCount: number; tags: string[] }[] = [];
    for (const [userId, data] of uploaderMap) {
      const user = userMap.get(userId);
      if (!user || !user.isEmployee) continue;
      rows.push({
        nickname: user.nickname,
        email: user.email,
        contentCount: data.count,
        tags: [...data.tags].sort(),
      });
    }

    // Sort by contentCount desc, tiebreak by nickname asc
    rows.sort((a, b) => b.contentCount - a.contentCount || a.nickname.localeCompare(b.nickname));

    // 5. Assign ranks with tie handling (same count = same rank)
    let currentRank = 1;
    const rankedRows = rows.map((row, idx) => {
      if (idx > 0 && row.contentCount < rows[idx - 1].contentCount) {
        currentRank = idx + 1;
      }
      return { rank: currentRank, ...row };
    });

    return jsonResponse(200, { rows: rankedRows });
  } catch (err) {
    console.error('handleContentContributors error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * POST /api/query/export
 *
 * 解析请求体 { view, format, filter }，调用 executeParticipationExport。
 * Requirements: 13.1。
 */
async function handleExport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  const view = body?.view;
  const format = body?.format;
  const filter = (body?.filter as ViewFilter | ActivityViewFilter | undefined) ?? {};

  if (typeof view !== 'string' || !VALID_PARTICIPATION_VIEWS.includes(view as ParticipationView)) {
    return errorResponse('INVALID_REQUEST', '缺少或不合法的 view 字段', 400);
  }

  const result = await executeParticipationExport(
    { view: view as ParticipationView, format: format as ExportFormat, filter },
    exportContext,
  );

  if (!result.success) {
    const { code, message } = result.error!;
    return errorResponse(code, message, errorStatusFor(code));
  }

  return jsonResponse(200, { downloadUrl: result.downloadUrl });
}

/** 从查询字符串参数解析人员类视图（Speaker/志愿者/员工总计）的筛选条件 */
function parseViewFilter(event: APIGatewayProxyEvent): ViewFilter {
  const qs = event.queryStringParameters ?? {};
  return {
    keyword: qs.keyword ?? undefined,
    startDate: qs.startDate ?? undefined,
    endDate: qs.endDate ?? undefined,
  };
}

/** 从查询字符串参数解析活动明细视图的筛选条件 */
function parseActivityViewFilter(event: APIGatewayProxyEvent): ActivityViewFilter {
  const qs = event.queryStringParameters ?? {};
  const page = qs.page ? Number.parseInt(qs.page, 10) : undefined;
  return {
    activityId: qs.activityId ?? undefined,
    topicKeyword: qs.topicKeyword ?? undefined,
    startDate: qs.startDate ?? undefined,
    endDate: qs.endDate ?? undefined,
    page: page && Number.isFinite(page) && page > 0 ? page : undefined,
  };
}
