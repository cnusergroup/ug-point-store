import crypto from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages, InviteRecord, InviteStatus, REGULAR_ROLES, UserRole } from '@points-mall/shared';

// ============================================================
// Token 生成与链接构建
// ============================================================

/**
 * 生成 64 字符十六进制邀请 token（加密安全随机）
 */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 构建邀请注册链接
 */
export function buildInviteLink(token: string, registerBaseUrl: string): string {
  return `${registerBaseUrl}?token=${token}`;
}

// ============================================================
// 结果类型
// ============================================================

export type CreateInviteResult =
  | { success: true; record: InviteRecord; link: string }
  | { success: false; error: { code: string; message: string } };

export type BatchCreateInvitesResult =
  | { success: true; invites: Array<{ token: string; link: string; role: UserRole; expiresAt: string }> }
  | { success: false; error: { code: string; message: string } };

export type ValidateInviteResult =
  | { success: true; role: UserRole }
  | { success: false; error: { code: string; message: string } };

export type ConsumeInviteResult =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 创建单条邀请记录，写入 DynamoDB，返回记录和链接
 */
export async function createInviteRecord(
  role: UserRole,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  registerBaseUrl: string,
): Promise<CreateInviteResult> {
  const token = generateInviteToken();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 86400 * 1000).toISOString();

  const record: InviteRecord = {
    token,
    role,
    status: 'pending',
    createdAt,
    expiresAt,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: invitesTable,
      Item: record,
    }),
  );

  const link = buildInviteLink(token, registerBaseUrl);
  return { success: true, record, link };
}

/**
 * 批量创建邀请记录
 * 校验 count ∈ [1, 100] 和 role ∈ REGULAR_ROLES
 */
export async function batchCreateInvites(
  count: number,
  role: UserRole,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  registerBaseUrl: string,
): Promise<BatchCreateInvitesResult> {
  if (count < 1 || count > 100) {
    return {
      success: false,
      error: { code: 'INVALID_COUNT', message: '数量必须在 1 到 100 之间' },
    };
  }

  if (!REGULAR_ROLES.includes(role)) {
    return {
      success: false,
      error: { code: 'INVALID_ROLE', message: '角色必须为普通角色之一（UserGroupLeader、CommunityBuilder、Speaker、Volunteer）' },
    };
  }

  const results: Array<{ token: string; link: string; role: UserRole; expiresAt: string }> = [];

  for (let i = 0; i < count; i++) {
    const result = await createInviteRecord(role, dynamoClient, invitesTable, registerBaseUrl);
    if (!result.success) {
      return result;
    }
    results.push({
      token: result.record.token,
      link: result.link,
      role: result.record.role,
      expiresAt: result.record.expiresAt,
    });
  }

  return { success: true, invites: results };
}

/**
 * 验证邀请 token：
 * - 不存在 → INVITE_TOKEN_INVALID
 * - status=used → INVITE_TOKEN_USED
 * - 过期 → 惰性更新 status 为 expired，返回 INVITE_TOKEN_EXPIRED
 * - 有效 → 返回 role
 */
export async function validateInviteToken(
  token: string,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
): Promise<ValidateInviteResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: invitesTable,
      Key: { token },
    }),
  );

  if (!result.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.INVITE_TOKEN_INVALID, message: ErrorMessages.INVITE_TOKEN_INVALID },
    };
  }

  const record = result.Item as InviteRecord;

  if (record.status === 'used') {
    return {
      success: false,
      error: { code: ErrorCodes.INVITE_TOKEN_USED, message: ErrorMessages.INVITE_TOKEN_USED },
    };
  }

  const now = new Date();
  const expiresAt = new Date(record.expiresAt);

  if (now > expiresAt) {
    // 惰性更新 status 为 expired（忽略并发更新失败）
    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: invitesTable,
          Key: { token },
          UpdateExpression: 'SET #status = :expired',
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':expired': 'expired' as InviteStatus,
            ':pending': 'pending' as InviteStatus,
          },
        }),
      );
    } catch {
      // 并发更新失败时忽略，仍返回过期错误
    }

    return {
      success: false,
      error: { code: ErrorCodes.INVITE_TOKEN_EXPIRED, message: ErrorMessages.INVITE_TOKEN_EXPIRED },
    };
  }

  return { success: true, role: record.role };
}

/**
 * 消耗邀请 token：使用条件更新将 status 改为 used
 * 捕获 ConditionalCheckFailedException → 返回 INVITE_TOKEN_USED
 */
export async function consumeInviteToken(
  token: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
): Promise<ConsumeInviteResult> {
  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: invitesTable,
        Key: { token },
        UpdateExpression: 'SET #status = :used, usedAt = :now, usedBy = :userId',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':used': 'used' as InviteStatus,
          ':pending': 'pending' as InviteStatus,
          ':now': new Date().toISOString(),
          ':userId': userId,
        },
      }),
    );
    return { success: true };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === 'ConditionalCheckFailedException' ||
        (err as { __type?: string }).__type === 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException')
    ) {
      return {
        success: false,
        error: { code: ErrorCodes.INVITE_TOKEN_USED, message: ErrorMessages.INVITE_TOKEN_USED },
      };
    }
    throw err;
  }
}
