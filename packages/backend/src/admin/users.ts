import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { UserStatus } from '@points-mall/shared';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

// ---- Interfaces ----

export interface ListUsersOptions {
  role?: string;
  pageSize?: number;
  lastKey?: Record<string, unknown>;
  /** Roles to exclude from results (e.g., SuperAdmin, OrderAdmin for non-SA callers) */
  excludeRoles?: string[];
}

export interface ListUsersResult {
  users: UserListItem[];
  lastKey?: Record<string, unknown>;
}

export interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: UserStatus;
  createdAt: string;
  invitedBy?: string;
}

// ---- Core Functions ----

/**
 * List users with optional role filtering and pagination.
 * Uses DynamoDB Query on entityType-createdAt-index GSI for correct cursor-based pagination.
 * Historical records without `status` field default to 'active'.
 */
export async function listUsers(
  options: ListUsersOptions,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ListUsersResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);

  const expressionAttributeNames: Record<string, string> = {
    '#userId': 'userId',
    '#email': 'email',
    '#nickname': 'nickname',
    '#roles': 'roles',
    '#points': 'points',
    '#status': 'status',
    '#createdAt': 'createdAt',
    '#invitedBy': 'invitedBy',
  };

  const expressionAttributeValues: Record<string, unknown> = {
    ':et': 'user',
  };

  // Build FilterExpression for role and excludeRoles
  const filterParts: string[] = [];

  if (options.role) {
    filterParts.push('contains(#roles, :role)');
    expressionAttributeValues[':role'] = options.role;
  }

  if (options.excludeRoles && options.excludeRoles.length > 0) {
    options.excludeRoles.forEach((r, i) => {
      filterParts.push(`NOT contains(#roles, :exRole${i})`);
      expressionAttributeValues[`:exRole${i}`] = r;
    });
  }

  const params: Record<string, unknown> = {
    TableName: tableName,
    IndexName: 'entityType-createdAt-index',
    KeyConditionExpression: 'entityType = :et',
    ScanIndexForward: false,
    ProjectionExpression: '#userId, #email, #nickname, #roles, #points, #status, #createdAt, #invitedBy',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  if (filterParts.length > 0) {
    params.FilterExpression = filterParts.join(' AND ');
  }

  if (options.lastKey) {
    params.ExclusiveStartKey = options.lastKey;
  }

  // Fetch all matching users (no client-side pagination — frontend uses scrollable list)
  const users: UserListItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(new QueryCommand(params as any));

    for (const item of result.Items ?? []) {
      users.push({
        userId: item.userId,
        email: item.email,
        nickname: item.nickname,
        roles: item.roles instanceof Set ? Array.from(item.roles) : Array.isArray(item.roles) ? item.roles : [],
        points: item.points ?? 0,
        status: (item.status as UserStatus) ?? 'active',
        createdAt: item.createdAt,
        ...(item.invitedBy ? { invitedBy: item.invitedBy } : {}),
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    params.ExclusiveStartKey = lastEvaluatedKey;
  } while (lastEvaluatedKey);

  return {
    users,
  };
}

// ---- SetUserStatus ----

export interface SetUserStatusResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Set a user's status to 'active' or 'disabled'.
 * Enforces permission rules:
 * - SuperAdmin users cannot be disabled
 * - Only SuperAdmin callers can manage Admin users
 */
export async function setUserStatus(
  userId: string,
  status: 'active' | 'disabled',
  callerUserId: string,
  callerRoles: string[],
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<SetUserStatusResult> {
  // Fetch target user
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: tableName, Key: { userId } }),
  );

  const targetUser = getResult.Item;
  if (!targetUser) {
    return {
      success: false,
      error: { code: ErrorCodes.USER_NOT_FOUND, message: ErrorMessages.USER_NOT_FOUND },
    };
  }

  // Convert roles to array for checking
  const targetRoles: string[] = targetUser.roles instanceof Set
    ? Array.from(targetUser.roles)
    : Array.isArray(targetUser.roles)
      ? targetUser.roles
      : [];

  // SuperAdmin cannot be disabled
  if (targetRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.CANNOT_DISABLE_SUPERADMIN, message: ErrorMessages.CANNOT_DISABLE_SUPERADMIN },
    };
  }

  // Only SuperAdmin can manage Admin users
  if (targetRoles.includes('Admin') && !callerRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN, message: ErrorMessages.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN },
    };
  }

  // Only SuperAdmin can manage OrderAdmin users
  if (targetRoles.includes('OrderAdmin') && !callerRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN, message: ErrorMessages.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN },
    };
  }

  // Update status — when activating, also clear any lock state
  const now = new Date().toISOString();
  if (status === 'active') {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { userId },
        UpdateExpression: 'SET #status = :status, loginFailCount = :zero, updatedAt = :now REMOVE lockUntil, firstFailAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':zero': 0, ':now': now },
      }),
    );
  } else {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { userId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':now': now },
      }),
    );
  }

  return { success: true };
}

// ---- DeleteUser ----

export interface DeleteUserResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Delete a user record from the Users table.
 * Enforces permission rules:
 * - Cannot delete self
 * - SuperAdmin users cannot be deleted
 * - Only SuperAdmin callers can delete Admin users
 */
export async function deleteUser(
  userId: string,
  callerUserId: string,
  callerRoles: string[],
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<DeleteUserResult> {
  // Fetch target user
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: tableName, Key: { userId } }),
  );

  const targetUser = getResult.Item;
  if (!targetUser) {
    return {
      success: false,
      error: { code: ErrorCodes.USER_NOT_FOUND, message: ErrorMessages.USER_NOT_FOUND },
    };
  }

  // Cannot delete self
  if (callerUserId === userId) {
    return {
      success: false,
      error: { code: ErrorCodes.CANNOT_DELETE_SELF, message: ErrorMessages.CANNOT_DELETE_SELF },
    };
  }

  // Convert roles to array for checking
  const targetRoles: string[] = targetUser.roles instanceof Set
    ? Array.from(targetUser.roles)
    : Array.isArray(targetUser.roles)
      ? targetUser.roles
      : [];

  // SuperAdmin cannot be deleted
  if (targetRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.CANNOT_DELETE_SUPERADMIN, message: ErrorMessages.CANNOT_DELETE_SUPERADMIN },
    };
  }

  // Only SuperAdmin can delete Admin users
  if (targetRoles.includes('Admin') && !callerRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN, message: ErrorMessages.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN },
    };
  }

  // Only SuperAdmin can delete OrderAdmin users
  if (targetRoles.includes('OrderAdmin') && !callerRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN, message: ErrorMessages.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN },
    };
  }

  // Hard delete the user record
  await dynamoClient.send(
    new DeleteCommand({ TableName: tableName, Key: { userId } }),
  );

  return { success: true };
}

// ---- UnlockUser ----

export interface UnlockUserResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Unlock a locked user account by resetting all lock-related state.
 * - If user not found → return USER_NOT_FOUND
 * - If user is not locked → return success (idempotent)
 * - If locked → reset loginFailCount, remove lockUntil, remove firstFailAt, set status='active'
 */
export async function unlockUser(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<UnlockUserResult> {
  // Fetch target user
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: tableName, Key: { userId } }),
  );

  const targetUser = getResult.Item;
  if (!targetUser) {
    return {
      success: false,
      error: { code: ErrorCodes.USER_NOT_FOUND, message: ErrorMessages.USER_NOT_FOUND },
    };
  }

  // If user is not locked, return success (idempotent)
  if (targetUser.status !== 'locked') {
    return { success: true };
  }

  // Reset all lock state
  const now = new Date().toISOString();
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: 'SET #status = :status, loginFailCount = :zero, updatedAt = :now REMOVE lockUntil, firstFailAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'active',
        ':zero': 0,
        ':now': now,
      },
    }),
  );

  return { success: true };
}
