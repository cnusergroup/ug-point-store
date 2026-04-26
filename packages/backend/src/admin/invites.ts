import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { InviteRecord, InviteStatus, UserRole } from '@points-mall/shared';
import { batchCreateInvites } from '../auth/invite';

// ============================================================
// 结果类型
// ============================================================

export type BatchGenerateInvitesResult =
  | { success: true; invites: Array<{ token: string; link: string; roles: UserRole[]; expiresAt: string; isEmployee: boolean }> }
  | { success: false; error: { code: string; message: string } };

export type ListInvitesResult = {
  invites: InviteRecord[];
  lastKey?: string;
};

export type RevokeInviteResult =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

// ============================================================
// 邀请管理逻辑
// ============================================================

/**
 * 批量生成邀请链接
 * 调用 batchCreateInvites，返回 invites 数组（含 token、link、roles、expiresAt）
 */
export async function batchGenerateInvites(
  count: number,
  roles: UserRole[],
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  registerBaseUrl: string,
  expiryMs?: number,
  isEmployee?: boolean,
  createdBy?: string,
): Promise<BatchGenerateInvitesResult> {
  return batchCreateInvites(count, roles, dynamoClient, invitesTable, registerBaseUrl, expiryMs, isEmployee, createdBy);
}

/**
 * 查询邀请列表
 * - status 有值时通过 GSI `status-createdAt-index` 查询
 * - 否则 Scan 全表
 * - 支持分页（ExclusiveStartKey / LastEvaluatedKey）
 */
export async function listInvites(
  status: InviteStatus | undefined,
  lastKey: Record<string, unknown> | undefined,
  pageSize: number = 200,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  createdBy?: string,
): Promise<ListInvitesResult> {
  let invites: InviteRecord[];

  // Build optional FilterExpression for createdBy (non-SuperAdmin callers)
  const filterExpression = createdBy ? 'createdBy = :cb' : undefined;
  const filterValues = createdBy ? { ':cb': createdBy } : undefined;

  if (status) {
    // Query path: loop until we have enough results or index exhausted
    const allInvites: InviteRecord[] = [];
    let queryLastKey: Record<string, unknown> | undefined = lastKey;
    let queryLastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: invitesTable,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status, ...(filterValues || {}) },
          ...(filterExpression ? { FilterExpression: filterExpression } : {}),
          Limit: pageSize * 3,
          ExclusiveStartKey: queryLastKey,
          ScanIndexForward: false,
        }),
      );

      allInvites.push(...((result.Items ?? []) as InviteRecord[]));
      queryLastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      queryLastKey = queryLastEvaluatedKey;
    } while (allInvites.length < pageSize && queryLastEvaluatedKey);

    invites = allInvites.slice(0, pageSize);

    // Lazy-expire: update pending invites that have passed their expiresAt
    const now = new Date();
    const expiredTokens: string[] = [];
    for (const invite of invites) {
      if (invite.status === 'pending' && new Date(invite.expiresAt) < now) {
        expiredTokens.push(invite.token);
      }
    }

    await Promise.allSettled(
      expiredTokens.map((token) =>
        dynamoClient.send(
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
        ),
      ),
    );

    for (const invite of invites) {
      if (expiredTokens.includes(invite.token)) {
        invite.status = 'expired';
      }
    }

    return {
      invites,
      lastKey: allInvites.length >= pageSize ? (queryLastEvaluatedKey ? JSON.stringify(queryLastEvaluatedKey) : undefined) : undefined,
    };
  }

  // Scan path: loop until we have enough results or table exhausted
  const allInvites: InviteRecord[] = [];
  let scanLastKey: Record<string, unknown> | undefined = lastKey;
  let scanLastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: invitesTable,
        Limit: pageSize * 3, // over-fetch to handle FilterExpression
        ExclusiveStartKey: scanLastKey,
        ...(filterExpression ? { FilterExpression: filterExpression, ExpressionAttributeValues: filterValues } : {}),
      }),
    );

    allInvites.push(...((result.Items ?? []) as InviteRecord[]));
    scanLastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    scanLastKey = scanLastEvaluatedKey;
  } while (allInvites.length < pageSize && scanLastEvaluatedKey);

  invites = allInvites.slice(0, pageSize);

  // Lazy-expire for scan results too
  const now = new Date();
  const expiredTokens: string[] = [];
  for (const invite of invites) {
    if (invite.status === 'pending' && new Date(invite.expiresAt) < now) {
      expiredTokens.push(invite.token);
    }
  }

  await Promise.allSettled(
    expiredTokens.map((token) =>
      dynamoClient.send(
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
      ),
    ),
  );

  for (const invite of invites) {
    if (expiredTokens.includes(invite.token)) {
      invite.status = 'expired';
    }
  }

  return {
    invites,
    lastKey: allInvites.length >= pageSize ? (scanLastEvaluatedKey ? JSON.stringify(scanLastEvaluatedKey) : undefined) : undefined,
  };
}

/**
 * 撤销邀请
 * - 查询 token → 不存在返回 INVITE_NOT_FOUND
 * - status 非 pending 返回 INVITE_NOT_REVOCABLE
 * - 条件更新 status 为 expired（ConditionExpression: '#status = :pending'）
 */
export async function revokeInvite(
  token: string,
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
): Promise<RevokeInviteResult> {
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: invitesTable,
      Key: { token },
    }),
  );

  if (!getResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.INVITE_NOT_FOUND, message: ErrorMessages.INVITE_NOT_FOUND },
    };
  }

  const record = getResult.Item as InviteRecord;

  if (record.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.INVITE_NOT_REVOCABLE, message: ErrorMessages.INVITE_NOT_REVOCABLE },
    };
  }

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

  return { success: true };
}
