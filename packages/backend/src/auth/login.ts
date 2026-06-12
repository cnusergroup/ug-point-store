import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { compare } from 'bcryptjs';

const MAX_LOGIN_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const SLIDING_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface LoginRequest {
  email: string;
  password: string;
}

/** 登录审计信息（来源于 API Gateway requestContext / 请求头） */
export interface LoginAuditInfo {
  ip?: string;
  userAgent?: string;
}

/** 单条登录历史记录 */
export interface LoginHistoryEntry {
  at: string;        // ISO 时间
  ip: string;        // 来源 IP
  userAgent?: string;
}

/** 每个账号保留的最近登录历史条数 */
export const MAX_LOGIN_HISTORY = 20;

export interface LoginResult {
  success: boolean;
  user?: {
    userId: string;
    email: string;
    nickname: string;
    roles: string[];
    points: number;
    emailVerified: boolean;
  };
  error?: { code: string; message: string; lockRemainingMs?: number };
}

export async function loginUser(
  request: LoginRequest,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  audit?: LoginAuditInfo,
): Promise<LoginResult> {
  // 1. Query user by email GSI
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': request.email },
      Limit: 1,
    }),
  );

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_CREDENTIALS,
        message: ErrorMessages.INVALID_CREDENTIALS,
      },
    };
  }

  const user = queryResult.Items[0];
  const now = Date.now();

  // 2. Check if account is actively locked (lockUntil in the future)
  if (user.lockUntil && user.lockUntil > now) {
    const lockRemainingMs = user.lockUntil - now;
    return {
      success: false,
      error: {
        code: ErrorCodes.ACCOUNT_LOCKED,
        message: ErrorMessages.ACCOUNT_LOCKED,
        lockRemainingMs,
      },
    };
  }

  // 3. If lock has expired (lockUntil in the past), reset state before credential validation
  if (user.lockUntil && user.lockUntil <= now) {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { userId: user.userId },
        UpdateExpression: 'SET loginFailCount = :zero, #s = :active, updatedAt = :now REMOVE lockUntil, firstFailAt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':active': 'active',
          ':now': new Date().toISOString(),
        },
      }),
    );
    // Update local user object to reflect reset state
    user.loginFailCount = 0;
    user.status = 'active';
    delete user.lockUntil;
    delete user.firstFailAt;
  }

  // 4. Check if account is disabled
  if (user.status === 'disabled') {
    return {
      success: false,
      error: {
        code: ErrorCodes.ACCOUNT_DISABLED,
        message: ErrorMessages.ACCOUNT_DISABLED,
      },
    };
  }

  // 5. Compare password with bcryptjs
  const passwordMatch = await compare(request.password, user.passwordHash);

  if (!passwordMatch) {
    // Sliding window check for failure counting
    let newFailCount: number;
    let newFirstFailAt: number;

    if (!user.firstFailAt || (now - user.firstFailAt) > SLIDING_WINDOW_MS) {
      // No prior failure or window has expired — start a new window
      newFirstFailAt = now;
      newFailCount = 1;
    } else {
      // Within the sliding window — increment
      newFirstFailAt = user.firstFailAt;
      newFailCount = (user.loginFailCount || 0) + 1;
    }

    if (newFailCount >= MAX_LOGIN_FAILURES) {
      // Lock the account
      const lockUntil = now + LOCK_DURATION_MS;
      const lockRemainingMs = LOCK_DURATION_MS;
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: user.userId },
          UpdateExpression: 'SET loginFailCount = :count, lockUntil = :lockUntil, #s = :locked, firstFailAt = :firstFailAt, updatedAt = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':count': newFailCount,
            ':lockUntil': lockUntil,
            ':locked': 'locked',
            ':firstFailAt': newFirstFailAt,
            ':now': new Date().toISOString(),
          },
        }),
      );

      return {
        success: false,
        error: {
          code: ErrorCodes.ACCOUNT_LOCKED,
          message: ErrorMessages.ACCOUNT_LOCKED,
          lockRemainingMs,
        },
      };
    } else {
      // Not yet at threshold — record failure with sliding window
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: user.userId },
          UpdateExpression: 'SET loginFailCount = :count, firstFailAt = :firstFailAt, updatedAt = :now',
          ExpressionAttributeValues: {
            ':count': newFailCount,
            ':firstFailAt': newFirstFailAt,
            ':now': new Date().toISOString(),
          },
        }),
      );
    }

    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_CREDENTIALS,
        message: ErrorMessages.INVALID_CREDENTIALS,
      },
    };
  }

  // 6. Password correct — full reset of lock state + record login audit
  const nowIso = new Date().toISOString();

  // Build the new login-history entry (only when we have a usable IP)
  const auditIp = (audit?.ip && audit.ip.trim()) ? audit.ip.trim() : undefined;
  const newEntry: LoginHistoryEntry | undefined = auditIp
    ? { at: nowIso, ip: auditIp, ...(audit?.userAgent ? { userAgent: audit.userAgent } : {}) }
    : undefined;

  if (newEntry) {
    // Prepend new entry, keep only the most recent MAX_LOGIN_HISTORY
    const existingHistory: LoginHistoryEntry[] = Array.isArray(user.loginHistory)
      ? (user.loginHistory as LoginHistoryEntry[])
      : [];
    const updatedHistory = [newEntry, ...existingHistory].slice(0, MAX_LOGIN_HISTORY);

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { userId: user.userId },
        UpdateExpression:
          'SET loginFailCount = :zero, #s = :active, updatedAt = :now, lastLoginAt = :now, lastLoginIp = :ip, loginHistory = :hist REMOVE lockUntil, firstFailAt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':active': 'active',
          ':now': nowIso,
          ':ip': auditIp,
          ':hist': updatedHistory,
        },
      }),
    );
  } else {
    // No IP available — fall back to the original reset-only update
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { userId: user.userId },
        UpdateExpression: 'SET loginFailCount = :zero, #s = :active, updatedAt = :now REMOVE lockUntil, firstFailAt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':active': 'active',
          ':now': nowIso,
        },
      }),
    );
  }

  return {
    success: true,
    user: {
      userId: user.userId,
      email: user.email,
      nickname: user.nickname,
      // DynamoDB StringSet comes back as a Set object — convert to array
      roles: user.roles instanceof Set
        ? Array.from(user.roles) as string[]
        : Array.isArray(user.roles) ? user.roles : [],
      points: user.points || 0,
      emailVerified: user.emailVerified ?? false,
    },
  };
}
