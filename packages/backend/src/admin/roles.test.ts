import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assignRoles, revokeRole, validateRoles, validateRoleAssignment } from './roles';

function createMockDynamoClient() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const tableName = 'Users';

describe('validateRoles', () => {
  it('should return true for valid roles', () => {
    expect(validateRoles(['UserGroupLeader', 'Speaker'])).toBe(true);
  });

  it('should return true for a single valid role', () => {
    expect(validateRoles(['Volunteer'])).toBe(true);
  });

  it('should return true for Admin role (now valid)', () => {
    expect(validateRoles(['Admin'])).toBe(true);
  });

  it('should return false for SuperAdmin (not assignable via API)', () => {
    expect(validateRoles(['SuperAdmin'])).toBe(false);
  });

  it('should return false when mix of valid and invalid roles', () => {
    expect(validateRoles(['Speaker', 'InvalidRole'])).toBe(false);
  });

  it('should return true for all five assignable roles', () => {
    expect(validateRoles(['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin'])).toBe(true);
  });
});

describe('validateRoleAssignment', () => {
  it('should reject assigning SuperAdmin regardless of caller', () => {
    const result = validateRoleAssignment(['SuperAdmin'], ['SuperAdmin']);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SUPERADMIN_ASSIGN_FORBIDDEN');
  });

  it('should reject assigning Admin when caller is not SuperAdmin', () => {
    const result = validateRoleAssignment(['Admin'], ['Admin']);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
  });

  it('should allow assigning Admin when caller is SuperAdmin', () => {
    const result = validateRoleAssignment(['SuperAdmin'], ['Admin']);
    expect(result.success).toBe(true);
  });

  it('should allow assigning regular roles for any caller', () => {
    const result = validateRoleAssignment(['Admin'], ['Speaker', 'Volunteer']);
    expect(result.success).toBe(true);
  });

  it('should allow assigning regular roles with empty caller roles', () => {
    const result = validateRoleAssignment([], ['Speaker']);
    expect(result.success).toBe(true);
  });
});

describe('assignRoles', () => {
  it('should assign roles successfully with ADD expression', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Speaker', 'Volunteer'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.Key).toEqual({ userId: 'user-1' });
    expect(command.input.UpdateExpression).toContain('ADD');
    expect(command.input.ExpressionAttributeValues[':roles']).toEqual(new Set(['Speaker', 'Volunteer']));
    expect(command.input.ExpressionAttributeValues[':now']).toBeDefined();
  });

  it('should reject empty roles array', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', [], client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ROLES');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject invalid role values', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['BadRole'], client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ROLES');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when any role in the array is invalid', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Speaker', 'BadRole'], client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ROLES');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject assigning SuperAdmin via API', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['SuperAdmin'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SUPERADMIN_ASSIGN_FORBIDDEN');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject assigning Admin when caller is not SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Admin'], client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should allow assigning Admin when caller is SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Admin'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should set updatedAt timestamp', async () => {
    const client = createMockDynamoClient();
    await assignRoles('user-1', ['Speaker'], client, tableName, ['Admin']);

    const command = client.send.mock.calls[0][0];
    expect(command.input.UpdateExpression).toContain('updatedAt');
    const now = command.input.ExpressionAttributeValues[':now'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe('revokeRole', () => {
  it('should revoke a role successfully with DELETE expression', async () => {
    const client = createMockDynamoClient();
    const result = await revokeRole('user-1', 'Speaker', client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.Key).toEqual({ userId: 'user-1' });
    expect(command.input.UpdateExpression).toContain('DELETE');
    expect(command.input.ExpressionAttributeValues[':role']).toEqual(new Set(['Speaker']));
  });

  it('should reject invalid role', async () => {
    const client = createMockDynamoClient();
    const result = await revokeRole('user-1', 'InvalidRole', client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ROLES');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject revoking Admin when caller is not SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await revokeRole('user-1', 'Admin', client, tableName, ['Admin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should allow revoking Admin when caller is SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await revokeRole('user-1', 'Admin', client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should reject revoking SuperAdmin via API', async () => {
    const client = createMockDynamoClient();
    const result = await revokeRole('user-1', 'SuperAdmin', client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SUPERADMIN_ASSIGN_FORBIDDEN');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should set updatedAt timestamp', async () => {
    const client = createMockDynamoClient();
    await revokeRole('user-1', 'Volunteer', client, tableName, ['Admin']);

    const command = client.send.mock.calls[0][0];
    expect(command.input.UpdateExpression).toContain('updatedAt');
    const now = command.input.ExpressionAttributeValues[':now'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});
