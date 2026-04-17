import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validateRoleExclusivity } from '@points-mall/shared';
import type { UserRole } from '@points-mall/shared';

/** Valid roles that can be assigned via API (includes Admin, excludes SuperAdmin) */
const VALID_ROLES: UserRole[] = [
  'UserGroupLeader',
  // [DISABLED] CommunityBuilder
  // 'CommunityBuilder',
  'Speaker',
  'Volunteer',
  'Admin',
  'OrderAdmin',
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
  if (targetRoles.includes('OrderAdmin') && !callerRoles.includes('SuperAdmin')) {
    return { success: false, error: { code: 'ORDER_ADMIN_REQUIRES_SUPERADMIN', message: '仅 SuperAdmin 可分配 OrderAdmin 角色' } };
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

  // Filter out SuperAdmin from ALL submissions — SuperAdmin role is never assigned/removed
  // via regular role editing (it uses a dedicated transfer flow instead).
  // For non-SuperAdmin callers, also filter out Admin role.
  const ADMIN_LEVEL_ROLES = ['Admin', 'SuperAdmin'];
  const callerIsSuperAdmin = callerRoles.includes('SuperAdmin');
  const submittedRegularRoles = callerIsSuperAdmin
    ? roles.filter((r) => r !== 'SuperAdmin')  // SuperAdmin caller: only strip SuperAdmin, keep Admin
    : roles.filter((r) => !ADMIN_LEVEL_ROLES.includes(r));  // Non-SuperAdmin: strip both

  // Permission check: only validate the roles the caller is actually trying to assign
  // For non-SuperAdmin callers, we strip admin roles from their submission and merge
  // existing admin roles back later, so we only validate the regular roles here
  const permCheck = validateRoleAssignment(callerRoles, submittedRegularRoles);
  if (!permCheck.success) {
    return permCheck;
  }

  if (!validateRoles(callerIsSuperAdmin ? roles : submittedRegularRoles)) {
    return {
      success: false,
      error: { code: 'INVALID_ROLES', message: `无效的角色，有效角色为: ${VALID_ROLES.join(', ')}` },
    };
  }

  // Read-before-write: fetch target user's current roles to preserve SuperAdmin role
  // SuperAdmin callers: preserve target's SuperAdmin (if any), write submitted roles as-is otherwise
  // Non-SuperAdmin callers: preserve all admin-level roles from target
  let finalRoles: string[] = submittedRegularRoles;

  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
      ProjectionExpression: '#roles',
      ExpressionAttributeNames: { '#roles': 'roles' },
    }),
  );
  const currentRoles: string[] = (getResult.Item?.roles as string[]) ?? [];

  if (callerIsSuperAdmin) {
    // SuperAdmin caller: preserve target's SuperAdmin role (if any), everything else is caller-controlled
    const existingSuperAdmin = currentRoles.filter((r) => r === 'SuperAdmin');
    finalRoles = [...new Set([...submittedRegularRoles, ...existingSuperAdmin])];
  } else {
    // Non-SuperAdmin caller: preserve all admin-level roles from target
    const existingAdminRoles = currentRoles.filter((r) => ADMIN_LEVEL_ROLES.includes(r));
    finalRoles = [...new Set([...submittedRegularRoles, ...existingAdminRoles])];
  }

  // Exclusive role check: OrderAdmin cannot coexist with other roles
  const exclusivityCheck = validateRoleExclusivity(finalRoles as UserRole[]);
  if (!exclusivityCheck.valid) {
    return { success: false, error: { code: 'EXCLUSIVE_ROLE_CONFLICT', message: exclusivityCheck.message! } };
  }

  const now = new Date().toISOString();
  const rolesVersion = Date.now(); // ms timestamp — used by auth-middleware to detect stale tokens

  // Initialize leaderboard earnTotal fields for newly assigned roles (if_not_exists preserves existing values)
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
  };
  const extraSetExprs: string[] = [];
  const extraExprNames: Record<string, string> = {};
  const extraExprValues: Record<string, any> = {};

  for (const role of finalRoles) {
    const field = roleFieldMap[role];
    if (field) {
      const placeholder = `:${field}`;
      const nameAlias = `#${field}`;
      extraSetExprs.push(`${nameAlias} = if_not_exists(${nameAlias}, ${placeholder})`);
      extraExprNames[nameAlias] = field;
      extraExprValues[placeholder] = 0;
    }
  }
  // Ensure pk="ALL" exists for GSI partition key
  extraSetExprs.push('pk = if_not_exists(pk, :pkVal)');
  extraExprValues[':pkVal'] = 'ALL';
  // Ensure earnTotal exists
  extraSetExprs.push('earnTotal = if_not_exists(earnTotal, :etZero)');
  extraExprValues[':etZero'] = 0;

  const updateExpression = `SET #roles = :roles, updatedAt = :now, rolesVersion = :rv${extraSetExprs.length > 0 ? ', ' + extraSetExprs.join(', ') : ''}`;

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#roles': 'roles', ...extraExprNames },
      ExpressionAttributeValues: {
        ':roles': finalRoles,
        ':now': now,
        ':rv': rolesVersion,
        ...extraExprValues,
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
  const rolesVersion = Date.now();

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
      UpdateExpression: 'SET #roles = :roles, updatedAt = :now, rolesVersion = :rv',
      ExpressionAttributeNames: { '#roles': 'roles' },
      ExpressionAttributeValues: {
        ':roles': newRoles,
        ':now': now,
        ':rv': rolesVersion,
      },
    }),
  );

  return { success: true };
}
