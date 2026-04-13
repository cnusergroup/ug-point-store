import {
  DynamoDBDocumentClient,
  ScanCommand,
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
}

// ---- Core Functions ----

/**
 * List users with optional role filtering and pagination.
 * Uses DynamoDB Scan with ProjectionExpression for needed fields only.
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
  };

  const params: Record<string, unknown> = {
    TableName: tableName,
    Limit: pageSize,
    ProjectionExpression: '#userId, #email, #nickname, #roles, #points, #status, #createdAt',
    ExpressionAttributeNames: expressionAttributeNames,
  };

  if (options.role) {
    params.FilterExpression = 'contains(#roles, :role)';
    params.ExpressionAttributeValues = { ':role': options.role };
  }

  if (options.lastKey) {
    params.ExclusiveStartKey = options.lastKey;
  }

  const result = await dynamoClient.send(new ScanCommand(params as any));

  const users: UserListItem[] = (result.Items ?? []).map((item: any) => ({
    userId: item.userId,
    email: item.email,
    nickname: item.nickname,
    roles: item.roles instanceof Set ? Array.from(item.roles) : Array.isArray(item.roles) ? item.roles : [],
    points: item.points ?? 0,
    status: (item.status as UserStatus) ?? 'active',
    createdAt: item.createdAt,
  }));

  return {
    users,
    lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
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

  // Update status
  const now = new Date().toISOString();
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': now },
    }),
  );

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
