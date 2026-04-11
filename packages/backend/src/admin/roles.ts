import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { UserRole } from '@points-mall/shared';

/** Valid roles that can be assigned via API (includes Admin, excludes SuperAdmin) */
const VALID_ROLES: UserRole[] = [
  'UserGroupLeader',
  // [DISABLED] CommunityBuilder
  // 'CommunityBuilder',
  'Speaker',
  'Volunteer',
  'Admin',
];

export interface RoleOperationResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Validate that all provided roles are valid UserRole values.
 */
export function validateRoles(roles: string[]): roles is UserRole[] {
  return roles.every((r) => VALID_ROLES.includes(r as UserRole));
}

/**
 * Validate role assignment permissions based on caller's roles.
 * - SuperAdmin cannot be assigned via API (by anyone)
 * - Admin role requires caller to have SuperAdmin
 */
export function validateRoleAssignment(callerRoles: string[], targetRoles: string[]): RoleOperationResult {
  if (targetRoles.includes('SuperAdmin')) {
    return { success: false, error: { code: 'SUPERADMIN_ASSIGN_FORBIDDEN', message: '禁止通过 API 分配 SuperAdmin 角色' } };
  }
  if (targetRoles.includes('Admin') && !callerRoles.includes('SuperAdmin')) {
    return { success: false, error: { code: 'ADMIN_ROLE_REQUIRES_SUPERADMIN', message: '仅 SuperAdmin 可分配管理角色' } };
  }
  return { success: true };
}

/**
 * Assign roles to a user (replaces the entire roles list).
 * Uses DynamoDB SET expression with a List to replace all roles.
 */
export async function assignRoles(
  userId: string,
  roles: string[],
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  callerRoles: string[] = [],
): Promise<RoleOperationResult> {
  if (roles.length === 0) {
    return { success: false, error: { code: 'INVALID_ROLES', message: '角色列表不能为空' } };
  }

  // Permission check
  const permCheck = validateRoleAssignment(callerRoles, roles);
  if (!permCheck.success) {
    return permCheck;
  }

  if (!validateRoles(roles)) {
    return {
      success: false,
      error: { code: 'INVALID_ROLES', message: `无效的角色，有效角色为: ${VALID_ROLES.join(', ')}` },
    };
  }

  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: 'SET #roles = :roles, updatedAt = :now',
      ExpressionAttributeNames: { '#roles': 'roles' },
      ExpressionAttributeValues: {
        ':roles': roles,
        ':now': now,
      },
    }),
  );

  return { success: true };
}

/**
 * Revoke a specific role from a user.
 * Reads current roles, removes the target, then writes back.
 */
export async function revokeRole(
  userId: string,
  role: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  callerRoles: string[] = [],
): Promise<RoleOperationResult> {
  // Permission check: revoking Admin requires SuperAdmin
  const permCheck = validateRoleAssignment(callerRoles, [role]);
  if (!permCheck.success) {
    return permCheck;
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    return {
      success: false,
      error: { code: 'INVALID_ROLES', message: `无效的角色，有效角色为: ${VALID_ROLES.join(', ')}` },
    };
  }

  const now = new Date().toISOString();

  // Use list_append/remove approach: filter out the role from the list
  // Since we can't easily remove from a list by value in a single expression,
  // we use a conditional SET with a filtered list via UpdateExpression
  // Simpler approach: read, filter, write back
  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: tableName, Key: { userId }, ProjectionExpression: '#roles', ExpressionAttributeNames: { '#roles': 'roles' } }),
  );
  const currentRoles: string[] = (getResult.Item?.roles as string[]) ?? [];
  const newRoles = currentRoles.filter((r: string) => r !== role);

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: 'SET #roles = :roles, updatedAt = :now',
      ExpressionAttributeNames: { '#roles': 'roles' },
      ExpressionAttributeValues: {
        ':roles': newRoles,
        ':now': now,
      },
    }),
  );

  return { success: true };
}
