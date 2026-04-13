import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { compare } from 'bcryptjs';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

export interface TransferSuperAdminInput {
  callerId: string;
  targetUserId: string;
  password: string;
}

export interface TransferSuperAdminResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Atomically transfer the SuperAdmin role from the caller to a target Admin user.
 *
 * Steps:
 * 1. Fetch caller record → verify SuperAdmin role → bcrypt.compare(password, passwordHash)
 * 2. Verify targetUserId !== callerId
 * 3. Fetch target record → verify Admin role
 * 4. TransactWriteItems: demote caller (remove SuperAdmin, ensure Admin, update rolesVersion + updatedAt),
 *    promote target (add SuperAdmin, update rolesVersion + updatedAt)
 *    - ConditionExpression on caller: contains(#roles, :superAdmin)
 *    - ConditionExpression on target: contains(#roles, :admin)
 * 5. Catch TransactionCanceledException → return retry error
 */
export async function transferSuperAdmin(
  input: TransferSuperAdminInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<TransferSuperAdminResult> {
  const { callerId, targetUserId, password } = input;

  // 1. Fetch caller record
  const callerResult = await dynamoClient.send(
    new GetCommand({ TableName: usersTable, Key: { userId: callerId } }),
  );

  const caller = callerResult.Item;
  if (!caller) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: ErrorMessages.FORBIDDEN },
    };
  }

  // Normalize roles to array
  const callerRoles: string[] = caller.roles instanceof Set
    ? Array.from(caller.roles)
    : Array.isArray(caller.roles)
      ? caller.roles
      : [];

  // Verify caller has SuperAdmin role
  if (!callerRoles.includes('SuperAdmin')) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: ErrorMessages.FORBIDDEN },
    };
  }

  // Verify password via bcrypt (same mechanism as login flow)
  const passwordMatch = await compare(password, caller.passwordHash as string);
  if (!passwordMatch) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CURRENT_PASSWORD, message: ErrorMessages.INVALID_CURRENT_PASSWORD },
    };
  }

  // 2. Verify target is not the caller
  if (targetUserId === callerId) {
    return {
      success: false,
      error: { code: ErrorCodes.TRANSFER_TARGET_IS_SELF, message: ErrorMessages.TRANSFER_TARGET_IS_SELF },
    };
  }

  // 3. Fetch target record
  const targetResult = await dynamoClient.send(
    new GetCommand({ TableName: usersTable, Key: { userId: targetUserId } }),
  );

  const target = targetResult.Item;
  if (!target) {
    return {
      success: false,
      error: { code: ErrorCodes.TRANSFER_TARGET_NOT_FOUND, message: ErrorMessages.TRANSFER_TARGET_NOT_FOUND },
    };
  }

  // Normalize target roles to array
  const targetRoles: string[] = target.roles instanceof Set
    ? Array.from(target.roles)
    : Array.isArray(target.roles)
      ? target.roles
      : [];

  // Verify target has Admin role
  if (!targetRoles.includes('Admin')) {
    return {
      success: false,
      error: { code: ErrorCodes.TRANSFER_TARGET_NOT_ADMIN, message: ErrorMessages.TRANSFER_TARGET_NOT_ADMIN },
    };
  }

  // 4. Compute new role arrays
  const now = new Date().toISOString();
  const rolesVersion = Date.now();

  // Caller: remove SuperAdmin, ensure Admin is present, keep all other roles
  const newCallerRoles = [
    ...new Set([
      ...callerRoles.filter((r) => r !== 'SuperAdmin'),
      'Admin',
    ]),
  ];

  // Target: add SuperAdmin, keep all existing roles
  const newTargetRoles = [...new Set([...targetRoles, 'SuperAdmin'])];

  // 5. TransactWriteItems — atomic role swap with condition checks
  try {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // Demote caller: remove SuperAdmin, ensure Admin
            Update: {
              TableName: usersTable,
              Key: { userId: callerId },
              UpdateExpression: 'SET #roles = :newRoles, rolesVersion = :rv, updatedAt = :now',
              ConditionExpression: 'contains(#roles, :superAdmin)',
              ExpressionAttributeNames: { '#roles': 'roles' },
              ExpressionAttributeValues: {
                ':newRoles': newCallerRoles,
                ':rv': rolesVersion,
                ':now': now,
                ':superAdmin': 'SuperAdmin',
              },
            },
          },
          {
            // Promote target: add SuperAdmin
            Update: {
              TableName: usersTable,
              Key: { userId: targetUserId },
              UpdateExpression: 'SET #roles = :newRoles, rolesVersion = :rv, updatedAt = :now',
              ConditionExpression: 'contains(#roles, :admin)',
              ExpressionAttributeNames: { '#roles': 'roles' },
              ExpressionAttributeValues: {
                ':newRoles': newTargetRoles,
                ':rv': rolesVersion,
                ':now': now,
                ':admin': 'Admin',
              },
            },
          },
        ],
      }),
    );
  } catch (err: unknown) {
    // TransactionCanceledException means a condition check failed (race condition)
    if (err instanceof Error && err.name === 'TransactionCanceledException') {
      return {
        success: false,
        error: {
          code: 'TRANSACTION_CONFLICT',
          message: '转让操作冲突，请重试',
        },
      };
    }
    throw err;
  }

  return { success: true };
}
