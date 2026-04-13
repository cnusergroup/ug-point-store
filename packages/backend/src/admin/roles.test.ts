import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assignRoles, revokeRole, validateRoles, validateRoleAssignment } from './roles';

function createMockDynamoClient(targetRoles: string[] = []) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetCommand') {
        return Promise.resolve({
          Item: { roles: targetRoles },
        });
      }
      return Promise.resolve({});
    }),
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

  it('should return false for CommunityBuilder (currently disabled)', () => {
    expect(validateRoles(['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin'])).toBe(false);
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

  it('should reject assigning OrderAdmin when caller is not SuperAdmin', () => {
    const result = validateRoleAssignment(['Admin'], ['OrderAdmin']);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ORDER_ADMIN_REQUIRES_SUPERADMIN');
  });

  it('should allow assigning OrderAdmin when caller is SuperAdmin', () => {
    const result = validateRoleAssignment(['SuperAdmin'], ['OrderAdmin']);
    expect(result.success).toBe(true);
  });
});

describe('assignRoles', () => {
  it('should assign roles successfully', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Speaker', 'Volunteer'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Non-SuperAdmin caller: GetCommand (read current roles) + UpdateCommand (write)
    expect(client.send).toHaveBeenCalledTimes(2);
    const getCommand = client.send.mock.calls[0][0];
    expect(getCommand.constructor.name).toBe('GetCommand');
    const command = client.send.mock.calls[1][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.Key).toEqual({ userId: 'user-1' });
    expect(command.input.UpdateExpression).toContain('SET');
    expect(command.input.ExpressionAttributeValues[':roles']).toEqual(['Speaker', 'Volunteer']);
    expect(command.input.ExpressionAttributeValues[':now']).toBeDefined();
    expect(command.input.ExpressionAttributeValues[':rv']).toBeDefined();
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

  it('should strip SuperAdmin from submission and reject if no valid roles remain', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['SuperAdmin'], client, tableName, ['SuperAdmin']);

    // SuperAdmin is stripped → empty roles after stripping → validateRoles fails on empty
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ROLES');
  });

  it('should silently strip Admin from non-SuperAdmin submission and preserve existing roles', async () => {
    const client = createMockDynamoClient(['Admin', 'Speaker']);
    const result = await assignRoles('user-1', ['Admin'], client, tableName, ['Admin']);

    // Non-SuperAdmin submitting ['Admin'] → Admin stripped from submission (regular roles = []),
    // existing admin roles merged back from DB. Result succeeds with preserved roles.
    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2); // GetCommand + UpdateCommand
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toContain('Admin');
  });

  it('should allow assigning Admin when caller is SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['Admin'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    // SuperAdmin caller now also does read-before-write (GetCommand + UpdateCommand)
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('should set updatedAt timestamp', async () => {
    const client = createMockDynamoClient();
    await assignRoles('user-1', ['Speaker'], client, tableName, ['Admin']);

    // Non-SuperAdmin caller: calls[0] = GetCommand, calls[1] = UpdateCommand
    const command = client.send.mock.calls[1][0];
    expect(command.input.UpdateExpression).toContain('updatedAt');
    const now = command.input.ExpressionAttributeValues[':now'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});

describe('assignRoles — OrderAdmin exclusivity', () => {
  it('should assign OrderAdmin alone successfully when caller is SuperAdmin', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['OrderAdmin'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2); // GetCommand + UpdateCommand
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toEqual(['OrderAdmin']);
  });

  it('should reject OrderAdmin combined with other roles (EXCLUSIVE_ROLE_CONFLICT)', async () => {
    const client = createMockDynamoClient();
    const result = await assignRoles('user-1', ['OrderAdmin', 'Speaker'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXCLUSIVE_ROLE_CONFLICT');
  });
});

describe('assignRoles — admin role preservation', () => {
  it('should preserve Admin when non-SuperAdmin caller assigns roles to target with Admin', async () => {
    const client = createMockDynamoClient(['Admin', 'Speaker']);
    const result = await assignRoles('user-1', ['Speaker'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    // calls[0] = GetCommand (read current roles), calls[1] = UpdateCommand (write)
    expect(client.send).toHaveBeenCalledTimes(2);
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toContain('Admin');
    expect(writtenRoles).toContain('Speaker');
  });

  it('should preserve SuperAdmin when non-SuperAdmin caller assigns roles to target with SuperAdmin', async () => {
    const client = createMockDynamoClient(['SuperAdmin', 'Volunteer']);
    const result = await assignRoles('user-1', ['Volunteer'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toContain('SuperAdmin');
    expect(writtenRoles).toContain('Volunteer');
  });

  it('should preserve both Admin and SuperAdmin when non-SuperAdmin caller assigns roles to target with both', async () => {
    const client = createMockDynamoClient(['Admin', 'SuperAdmin', 'UserGroupLeader']);
    const result = await assignRoles('user-1', ['UserGroupLeader'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toContain('Admin');
    expect(writtenRoles).toContain('SuperAdmin');
    expect(writtenRoles).toContain('UserGroupLeader');
  });

  it('should allow SuperAdmin caller to remove Admin from target (behavior unchanged)', async () => {
    const client = createMockDynamoClient(['Admin', 'Speaker']);
    const result = await assignRoles('user-1', ['Speaker'], client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    // SuperAdmin caller now does read-before-write: GetCommand + UpdateCommand
    expect(client.send).toHaveBeenCalledTimes(2);
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toEqual(['Speaker']);
    expect(writtenRoles).not.toContain('Admin');
  });

  it('should behave normally when target has no admin roles', async () => {
    const client = createMockDynamoClient(['Speaker']);
    const result = await assignRoles('user-1', ['Speaker', 'Volunteer'], client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);
    const writtenRoles = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':roles'];
    expect(writtenRoles).toEqual(expect.arrayContaining(['Speaker', 'Volunteer']));
    expect(writtenRoles).toHaveLength(2);
  });
});

describe('revokeRole', () => {
  it('should revoke a role successfully', async () => {
    const client = createMockDynamoClient();
    // Mock the GetCommand response for reading current roles
    client.send.mockResolvedValueOnce({ Item: { roles: ['Speaker', 'Volunteer'] } });
    // Mock the UpdateCommand response
    client.send.mockResolvedValueOnce({});

    const result = await revokeRole('user-1', 'Speaker', client, tableName, ['Admin']);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    expect(client.send).toHaveBeenCalledTimes(2);
    const updateCommand = client.send.mock.calls[1][0];
    expect(updateCommand.constructor.name).toBe('UpdateCommand');
    expect(updateCommand.input.Key).toEqual({ userId: 'user-1' });
    expect(updateCommand.input.UpdateExpression).toContain('SET');
    expect(updateCommand.input.ExpressionAttributeValues[':roles']).toEqual(['Volunteer']);
    expect(updateCommand.input.ExpressionAttributeValues[':rv']).toBeDefined();
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
    client.send.mockResolvedValueOnce({ Item: { roles: ['Admin'] } });
    client.send.mockResolvedValueOnce({});
    const result = await revokeRole('user-1', 'Admin', client, tableName, ['SuperAdmin']);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);
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
    client.send.mockResolvedValueOnce({ Item: { roles: ['Volunteer'] } });
    client.send.mockResolvedValueOnce({});
    await revokeRole('user-1', 'Volunteer', client, tableName, ['Admin']);

    const command = client.send.mock.calls[1][0];
    expect(command.input.UpdateExpression).toContain('updatedAt');
    const now = command.input.ExpressionAttributeValues[':now'];
    expect(new Date(now).toISOString()).toBe(now);
  });
});
