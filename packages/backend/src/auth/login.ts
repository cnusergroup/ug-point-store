import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { compare } from 'bcryptjs';

const MAX_LOGIN_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface LoginRequest {
  email: string;
  password: string;
}

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

  // 2. Check if account is locked
  const now = Date.now();
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

  // If lock has expired, we'll proceed with login (lock will be cleared on success)

  // 3. Check if account is disabled
  if (user.status === 'disabled') {
    return {
      success: false,
      error: {
        code: ErrorCodes.ACCOUNT_DISABLED,
        message: ErrorMessages.ACCOUNT_DISABLED,
      },
    };
  }

  // 4. Compare password with bcryptjs
  const passwordMatch = await compare(request.password, user.passwordHash);

  if (!passwordMatch) {
    // Increment loginFailCount
    // Increment loginFailCount
    const newFailCount = (user.loginFailCount || 0) + 1;

    if (newFailCount >= MAX_LOGIN_FAILURES) {
      // Lock the account for 15 minutes
      const lockUntil = now + LOCK_DURATION_MS;
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: user.userId },
          UpdateExpression: 'SET loginFailCount = :count, lockUntil = :lockUntil, #s = :locked, updatedAt = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':count': newFailCount,
            ':lockUntil': lockUntil,
            ':locked': 'locked',
            ':now': new Date().toISOString(),
          },
        }),
      );
    } else {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: user.userId },
          UpdateExpression: 'SET loginFailCount = :count, updatedAt = :now',
          ExpressionAttributeValues: {
            ':count': newFailCount,
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

  // 5. Password correct — reset loginFailCount and clear lockUntil
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId: user.userId },
      UpdateExpression: 'SET loginFailCount = :zero, #s = :active, updatedAt = :now REMOVE lockUntil',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':active': 'active',
        ':now': new Date().toISOString(),
      },
    }),
  );

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
