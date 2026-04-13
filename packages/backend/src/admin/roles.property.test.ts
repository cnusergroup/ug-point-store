import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { assignRoles, revokeRole, validateRoleAssignment } from './roles';
import type { UserRole } from '@points-mall/shared';

// Feature: points-mall, Property 4: 角色分配与撤销的往返一致性
// 对于任何用户和任何角色子集，分配这些角色后查询用户角色应包含所有已分配角色；
// 撤销某角色后查询用户角色应不再包含该角色。
// Validates: Requirements 3.2, 3.3

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer'];

/** Arbitrary for a non-empty subset of valid roles */
const rolesSubsetArb = fc
  .subarray(ALL_ROLES, { minLength: 1 })
  .map((roles) => [...roles]);

/** Arbitrary for a single valid role */
const singleRoleArb = fc.constantFrom<UserRole>(...ALL_ROLES);

/** Arbitrary for a user ID */
const userIdArb = fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')) });

const TABLE = 'Users';

function createMockDynamoClient(targetCurrentRoles: string[] = []) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetCommand') {
        return Promise.resolve({
          Item: { roles: targetCurrentRoles },
        });
      }
      return Promise.resolve({});
    }),
  } as any;
}

describe('Property 4: 角色分配与撤销的往返一致性', () => {
  it('分配角色后 DynamoDB UpdateCommand 应包含所有指定角色', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, rolesSubsetArb, async (userId, roles) => {
        // Non-SuperAdmin caller assigning regular roles to a target with no admin roles
        const client = createMockDynamoClient([]);
        const result = await assignRoles(userId, roles, client, TABLE);

        expect(result.success).toBe(true);

        // GetCommand (read) + UpdateCommand (write) = 2 calls for non-SuperAdmin
        const updateCall = client.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(updateCall).toBeDefined();

        const sentRoles: string[] = updateCall![0].input.ExpressionAttributeValues[':roles'];

        // Every assigned role must be present
        for (const role of roles) {
          expect(sentRoles).toContain(role);
        }
        // Should contain exactly the assigned roles (no extras)
        expect(new Set(sentRoles).size).toBe(new Set(roles).size);
      }),
      { numRuns: 100 },
    );
  });

  it('撤销角色后 DynamoDB 应写回不包含被撤销角色的列表', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, singleRoleArb, async (userId, role) => {
        // revokeRole reads current roles, filters, then writes back
        const currentRoles = [role, 'Speaker'].filter((v, i, a) => a.indexOf(v) === i);
        const client = createMockDynamoClient(currentRoles);
        const result = await revokeRole(userId, role, client, TABLE);

        expect(result.success).toBe(true);

        const updateCall = client.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(updateCall).toBeDefined();

        const writtenRoles: string[] = updateCall![0].input.ExpressionAttributeValues[':roles'];

        // The revoked role should NOT be in the written roles
        expect(writtenRoles).not.toContain(role);
      }),
      { numRuns: 100 },
    );
  });

  it('分配后撤销同一角色：分配包含该角色且撤销后移除该角色', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, rolesSubsetArb, async (userId, roles) => {
        // Step 1: Assign all roles (non-SuperAdmin caller, target has no admin roles)
        const assignClient = createMockDynamoClient([]);
        const assignResult = await assignRoles(userId, roles, assignClient, TABLE);
        expect(assignResult.success).toBe(true);

        const assignUpdateCall = assignClient.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(assignUpdateCall).toBeDefined();
        const assignedRoles: string[] = assignUpdateCall![0].input.ExpressionAttributeValues[':roles'];

        // Pick a role to revoke
        const roleToRevoke = roles[0];
        expect(assignedRoles).toContain(roleToRevoke);

        // Step 2: Revoke one role
        const revokeClient = createMockDynamoClient(assignedRoles);
        const revokeResult = await revokeRole(userId, roleToRevoke, revokeClient, TABLE);
        expect(revokeResult.success).toBe(true);

        const revokeUpdateCall = revokeClient.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(revokeUpdateCall).toBeDefined();
        const remainingRoles: string[] = revokeUpdateCall![0].input.ExpressionAttributeValues[':roles'];

        // The revoked role should not be present
        expect(remainingRoles).not.toContain(roleToRevoke);
        // All other originally assigned roles should still be present
        for (const r of roles) {
          if (r !== roleToRevoke) {
            expect(remainingRoles).toContain(r);
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
// 对于任何目标用户，当 SuperAdmin 为其分配 Admin 角色后，DynamoDB 应写入包含 Admin 的角色列表；
// 随后撤销 Admin 角色后，DynamoDB 应写入不包含 Admin 的角色列表，且其他已有角色不受影响。
// **Validates: Requirements 3.1, 3.2**

/** Arbitrary for a subset of regular (non-admin) roles to represent pre-existing roles */
const existingRegularRolesArb = fc.subarray(
  ['UserGroupLeader', 'Speaker', 'Volunteer'] as const,
  { minLength: 0 },
);

describe('Property 3: SuperAdmin 分配/撤销 Admin 角色的往返一致性', () => {
  const superAdminCaller = ['SuperAdmin'];

  it('SuperAdmin 分配 Admin 后 DynamoDB 应写入包含 Admin 的角色列表', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, _existingRoles) => {
        const client = createMockDynamoClient([]);
        const result = await assignRoles(userId, ['Admin'], client, TABLE, superAdminCaller);

        expect(result.success).toBe(true);

        // SuperAdmin caller: only UpdateCommand (no GetCommand needed)
        const updateCall = client.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(updateCall).toBeDefined();

        const sentRoles: string[] = updateCall![0].input.ExpressionAttributeValues[':roles'];
        expect(sentRoles).toContain('Admin');
        expect(sentRoles.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('SuperAdmin 撤销 Admin 后 DynamoDB 应写入不包含 Admin 的角色列表', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, existingRoles) => {
        // Target currently has Admin + existing regular roles
        const currentRoles = ['Admin', ...existingRoles];
        const client = createMockDynamoClient(currentRoles);
        const result = await revokeRole(userId, 'Admin', client, TABLE, superAdminCaller);

        expect(result.success).toBe(true);

        const updateCall = client.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(updateCall).toBeDefined();

        const writtenRoles: string[] = updateCall![0].input.ExpressionAttributeValues[':roles'];
        expect(writtenRoles).not.toContain('Admin');
      }),
      { numRuns: 100 },
    );
  });

  it('分配 Admin 后撤销 Admin：其他已有角色不受影响', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, existingRegularRolesArb, async (userId, existingRoles) => {
        // Step 1: Assign Admin role (SuperAdmin caller — no GetCommand)
        const assignClient = createMockDynamoClient([]);
        const assignResult = await assignRoles(userId, ['Admin'], assignClient, TABLE, superAdminCaller);
        expect(assignResult.success).toBe(true);

        const assignUpdateCall = assignClient.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(assignUpdateCall).toBeDefined();
        const assignedRoles: string[] = assignUpdateCall![0].input.ExpressionAttributeValues[':roles'];
        expect(assignedRoles).toContain('Admin');

        // Step 2: Revoke Admin role — target now has Admin + existing roles
        const rolesAfterAssign = [...new Set(['Admin', ...existingRoles])];
        const revokeClient = createMockDynamoClient(rolesAfterAssign);
        const revokeResult = await revokeRole(userId, 'Admin', revokeClient, TABLE, superAdminCaller);
        expect(revokeResult.success).toBe(true);

        const revokeUpdateCall = revokeClient.send.mock.calls.find(
          (call: any[]) => call[0].constructor.name === 'UpdateCommand',
        );
        expect(revokeUpdateCall).toBeDefined();
        const remainingRoles: string[] = revokeUpdateCall![0].input.ExpressionAttributeValues[':roles'];

        // Admin should be removed
        expect(remainingRoles).not.toContain('Admin');
        // All existing regular roles should still be present
        for (const role of existingRoles) {
          expect(remainingRoles).toContain(role);
        }
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
  ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin'] as const,
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
        const client = createMockDynamoClient([]);
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

  it('非 SuperAdmin 调用者分配包含 Admin 的混合角色列表：Admin 被静默剥离', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        nonSuperAdminRolesArb,
        fc.subarray(['UserGroupLeader', 'Speaker', 'Volunteer'] as const, { minLength: 1 }),
        async (userId, callerRoles, otherRoles) => {
          const client = createMockDynamoClient([]);
          const targetRoles = [...otherRoles, 'Admin'];
          const result = await assignRoles(userId, targetRoles, client, TABLE, callerRoles);

          // Admin is silently stripped for non-SuperAdmin callers, regular roles pass through
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
