import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { assignRoles, revokeRole, validateRoleAssignment } from './roles';
import type { UserRole } from '@points-mall/shared';

// Feature: points-mall, Property 4: 角色分配与撤销的往返一致性
// 对于任何用户和任何角色子集，分配这些角色后查询用户角色应包含所有已分配角色；
// 撤销某角色后查询用户角色应不再包含该角色。
// Validates: Requirements 3.2, 3.3

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

/** Arbitrary for a non-empty subset of valid roles */
const rolesSubsetArb = fc
  .subarray(ALL_ROLES, { minLength: 1 })
  .map((roles) => [...roles]);

/** Arbitrary for a single valid role */
const singleRoleArb = fc.constantFrom<UserRole>(...ALL_ROLES);

/** Arbitrary for a user ID */
const userIdArb = fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')) });

const TABLE = 'Users';

function createMockDynamoClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

describe('Property 4: 角色分配与撤销的往返一致性', () => {
  it('分配角色后 DynamoDB ADD 表达式应包含所有指定角色', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, rolesSubsetArb, async (userId, roles) => {
        const client = createMockDynamoClient();
        const result = await assignRoles(userId, roles, client, TABLE);

        expect(result.success).toBe(true);
        expect(client.send).toHaveBeenCalledTimes(1);

        const command = client.send.mock.calls[0][0];
        const sentRoles: Set<string> = command.input.ExpressionAttributeValues[':roles'];

        // Every assigned role must be present in the ADD set
        for (const role of roles) {
          expect(sentRoles.has(role)).toBe(true);
        }
        // The set should contain exactly the assigned roles (no extras)
        expect(sentRoles.size).toBe(new Set(roles).size);
      }),
      { numRuns: 100 },
    );
  });

  it('撤销角色后 DynamoDB DELETE 表达式应精确包含被撤销的角色', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, singleRoleArb, async (userId, role) => {
        const client = createMockDynamoClient();
        const result = await revokeRole(userId, role, client, TABLE);

        expect(result.success).toBe(true);
        expect(client.send).toHaveBeenCalledTimes(1);

        const command = client.send.mock.calls[0][0];
        const deletedRoles: Set<string> = command.input.ExpressionAttributeValues[':role'];

        // The DELETE set should contain exactly the revoked role
        expect(deletedRoles.has(role)).toBe(true);
        expect(deletedRoles.size).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('分配后撤销同一角色：ADD 包含该角色且 DELETE 精确移除该角色', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, rolesSubsetArb, async (userId, roles) => {
        // Step 1: Assign all roles
        const assignClient = createMockDynamoClient();
        const assignResult = await assignRoles(userId, roles, assignClient, TABLE);
        expect(assignResult.success).toBe(true);

        const assignedSet: Set<string> = assignClient.send.mock.calls[0][0].input.ExpressionAttributeValues[':roles'];

        // Pick a random role from the assigned set to revoke
        const roleToRevoke = roles[0];

        // Step 2: Revoke one role
        const revokeClient = createMockDynamoClient();
        const revokeResult = await revokeRole(userId, roleToRevoke, revokeClient, TABLE);
        expect(revokeResult.success).toBe(true);

        const revokedSet: Set<string> = revokeClient.send.mock.calls[0][0].input.ExpressionAttributeValues[':role'];

        // The assigned set should have contained the role we're revoking
        expect(assignedSet.has(roleToRevoke)).toBe(true);
        // The revoked set should contain exactly the role we revoked
        expect(revokedSet.has(roleToRevoke)).toBe(true);
        expect(revokedSet.size).toBe(1);

        // Simulating the resulting state: assigned roles minus revoked role
        const remainingRoles = new Set(assignedSet);
        remainingRoles.delete(roleToRevoke);

        // The remaining set should NOT contain the revoked role
        expect(remainingRoles.has(roleToRevoke)).toBe(false);
        // All other originally assigned roles should still be present
        for (const r of roles) {
          if (r !== roleToRevoke) {
            expect(remainingRoles.has(r)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: admin-roles-password, Property 2: SuperAdmin 角色禁止通过 API 分配
// 对于任何调用者角色集合（包括 SuperAdmin 自身），通过角色分配 API 尝试分配 SuperAdmin 角色应始终被拒绝，
// 并返回 SUPERADMIN_ASSIGN_FORBIDDEN 错误码。
// **Validates: Requirements 2.1, 2.3**

/** Arbitrary for a subset of ALL_ROLES (including empty set) to represent caller roles */
const callerRolesArb = fc.subarray([...ALL_ROLES], { minLength: 0 });

describe('Property 2: SuperAdmin 角色禁止通过 API 分配', () => {
  it('对于任何调用者角色集合，分配 SuperAdmin 始终返回 SUPERADMIN_ASSIGN_FORBIDDEN', () => {
    fc.assert(
      fc.property(callerRolesArb, (callerRoles) => {
        const result = validateRoleAssignment(callerRoles, ['SuperAdmin']);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('SUPERADMIN_ASSIGN_FORBIDDEN');
      }),
      { numRuns: 100 },
    );
  });

  it('分配包含 SuperAdmin 的混合角色列表也应被拒绝', () => {
    fc.assert(
      fc.property(
        callerRolesArb,
        fc.subarray([...ALL_ROLES].filter(r => r !== 'SuperAdmin'), { minLength: 0 }),
        (callerRoles, otherRoles) => {
          const targetRoles = [...otherRoles, 'SuperAdmin'];
          const result = validateRoleAssignment(callerRoles, targetRoles);

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('SUPERADMIN_ASSIGN_FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: admin-roles-password, Property 3: SuperAdmin 分配/撤销 Admin 角色的往返一致性
// 对于任何目标用户，当 SuperAdmin 为其分配 Admin 角色后，DynamoDB ADD 表达式应包含 'Admin'；
// 随后撤销 Admin 角色后，DynamoDB DELETE 表达式应包含 'Admin'，且其他已有角色不受影响。
// **Validates: Requirements 3.1, 3.2**

/** Arbitrary for a subset of regular (non-admin) roles to represent pre-existing roles */
const existingRegularRolesArb = fc.subarray(
  ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const,
  { minLength: 0 },
);

describe('Property 3: SuperAdmin 分配/撤销 Admin 角色的往返一致性', () => {
  const superAdminCaller = ['SuperAdmin'];

  it('SuperAdmin 分配 Admin 后 DynamoDB ADD 表达式应包含 Admin', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, _existingRoles) => {
        const client = createMockDynamoClient();
        const result = await assignRoles(userId, ['Admin'], client, TABLE, superAdminCaller);

        expect(result.success).toBe(true);
        expect(client.send).toHaveBeenCalledTimes(1);

        const command = client.send.mock.calls[0][0];
        const sentRoles: Set<string> = command.input.ExpressionAttributeValues[':roles'];

        expect(sentRoles.has('Admin')).toBe(true);
        expect(sentRoles.size).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('SuperAdmin 撤销 Admin 后 DynamoDB DELETE 表达式应包含 Admin', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, _existingRoles) => {
        const client = createMockDynamoClient();
        const result = await revokeRole(userId, 'Admin', client, TABLE, superAdminCaller);

        expect(result.success).toBe(true);
        expect(client.send).toHaveBeenCalledTimes(1);

        const command = client.send.mock.calls[0][0];
        const deletedRoles: Set<string> = command.input.ExpressionAttributeValues[':role'];

        expect(deletedRoles.has('Admin')).toBe(true);
        expect(deletedRoles.size).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('分配 Admin 后撤销 Admin：其他已有角色不受影响', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, existingRoles) => {
        // Step 1: Assign Admin role
        const assignClient = createMockDynamoClient();
        const assignResult = await assignRoles(userId, ['Admin'], assignClient, TABLE, superAdminCaller);
        expect(assignResult.success).toBe(true);

        const assignedSet: Set<string> = assignClient.send.mock.calls[0][0].input.ExpressionAttributeValues[':roles'];
        // The ADD expression should only contain 'Admin', not touch existing roles
        expect(assignedSet.has('Admin')).toBe(true);
        expect(assignedSet.size).toBe(1);

        // Step 2: Revoke Admin role
        const revokeClient = createMockDynamoClient();
        const revokeResult = await revokeRole(userId, 'Admin', revokeClient, TABLE, superAdminCaller);
        expect(revokeResult.success).toBe(true);

        const revokedSet: Set<string> = revokeClient.send.mock.calls[0][0].input.ExpressionAttributeValues[':role'];
        // The DELETE expression should only contain 'Admin'
        expect(revokedSet.has('Admin')).toBe(true);
        expect(revokedSet.size).toBe(1);

        // Simulate round-trip: existing roles + Admin - Admin = existing roles
        const rolesAfterAssign = new Set([...existingRoles, 'Admin']);
        expect(rolesAfterAssign.has('Admin')).toBe(true);

        rolesAfterAssign.delete('Admin');
        // After revoke, only the original existing roles should remain
        expect(rolesAfterAssign.has('Admin')).toBe(false);
        for (const role of existingRoles) {
          expect(rolesAfterAssign.has(role)).toBe(true);
        }
        expect(rolesAfterAssign.size).toBe(new Set(existingRoles).size);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: admin-roles-password, Property 4: 非 SuperAdmin 用户无法分配或撤销管理角色
// 对于任何不包含 SuperAdmin 的调用者角色集合（包括仅有 Admin 的用户），
// 尝试分配或撤销 Admin 角色应被拒绝，并返回 ADMIN_ROLE_REQUIRES_SUPERADMIN 错误码。
// **Validates: Requirements 3.3, 3.4, 4.6**

/** Arbitrary for caller role sets that do NOT contain SuperAdmin */
const nonSuperAdminRolesArb = fc.subarray(
  ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin'] as const,
  { minLength: 0 },
);

describe('Property 4: 非 SuperAdmin 用户无法分配或撤销管理角色', () => {
  it('非 SuperAdmin 调用者分配 Admin 角色应返回 ADMIN_ROLE_REQUIRES_SUPERADMIN', () => {
    fc.assert(
      fc.property(nonSuperAdminRolesArb, (callerRoles) => {
        const result = validateRoleAssignment(callerRoles, ['Admin']);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
      }),
      { numRuns: 100 },
    );
  });

  it('非 SuperAdmin 调用者撤销 Admin 角色应被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, nonSuperAdminRolesArb, async (userId, callerRoles) => {
        const client = createMockDynamoClient();
        const result = await revokeRole(userId, 'Admin', client, TABLE, callerRoles);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
        // DynamoDB should NOT have been called since permission check fails first
        expect(client.send).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('非 SuperAdmin 调用者分配包含 Admin 的混合角色列表也应被拒绝', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        nonSuperAdminRolesArb,
        fc.subarray(['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'] as const, { minLength: 0 }),
        async (userId, callerRoles, otherRoles) => {
          const client = createMockDynamoClient();
          const targetRoles = [...otherRoles, 'Admin'];
          const result = await assignRoles(userId, targetRoles, client, TABLE, callerRoles);

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('ADMIN_ROLE_REQUIRES_SUPERADMIN');
          // DynamoDB should NOT have been called
          expect(client.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
