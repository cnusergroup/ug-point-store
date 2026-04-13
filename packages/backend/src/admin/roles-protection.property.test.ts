import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { assignRoles } from './roles';
import { setUserStatus, deleteUser } from './users';
import type { UserRole } from '@points-mall/shared';
import { ADMIN_ROLES, REGULAR_ROLES as SHARED_REGULAR_ROLES } from '@points-mall/shared';

/**
 * Bug Condition Exploration Test — Admin/SuperAdmin Role Stripping via assignRoles
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * Bug Condition:
 *   isBugCondition(input) =
 *     (NOT callerIsSuperAdmin)
 *     AND (targetHasAdmin OR targetHasSuperAdmin)
 *     AND (newRolesOmitAdmin OR newRolesOmitSuperAdmin)
 *
 * Expected Behavior (after fix):
 *   Admin/SuperAdmin roles are preserved in the final roles list
 *   regardless of what the non-SuperAdmin caller submitted.
 *
 * On UNFIXED code this test is EXPECTED TO FAIL — failure confirms the bug exists.
 */

const TABLE = 'Users';

/** Regular (non-admin) roles that any caller can assign */
const REGULAR_ROLES: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer'];

/**
 * Arbitrary: non-SuperAdmin caller roles
 * Subsets of ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin'] that do NOT contain 'SuperAdmin'.
 * Must have at least one role so the caller is a valid admin-level user.
 */
const nonSuperAdminCallerRolesArb = fc
  .subarray(['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin'] as UserRole[], { minLength: 1 })
  .map((roles) => [...roles]);

/**
 * Arbitrary: target current roles containing at least one admin-level role.
 * We pick a non-empty subset of ADMIN_ROLES and combine with a subset of REGULAR_ROLES.
 */
const targetCurrentRolesWithAdminArb = fc
  .tuple(
    fc.subarray([...ADMIN_ROLES] as UserRole[], { minLength: 1 }),
    fc.subarray([...REGULAR_ROLES], { minLength: 0 }),
  )
  .map(([adminRoles, regularRoles]) => [...new Set([...adminRoles, ...regularRoles])]);

/**
 * Arbitrary: new roles that omit at least one existing admin-level role from the target.
 * Given targetCurrentRoles, we generate a roles list from REGULAR_ROLES only (omitting all admin roles).
 * This guarantees the bug condition: newRolesOmitAdmin OR newRolesOmitSuperAdmin.
 */
const newRolesOmittingAdminArb = fc
  .subarray([...REGULAR_ROLES], { minLength: 1 })
  .map((roles) => [...roles]);

/**
 * Create a mock DynamoDB client that:
 * - Returns targetCurrentRoles for GetCommand (if the function reads before writing)
 * - Captures UpdateCommand input for inspection
 */
function createMockDynamoClient(targetCurrentRoles: UserRole[]) {
  const capturedUpdates: any[] = [];

  const client = {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetCommand') {
        // Return the target user's current roles
        return Promise.resolve({
          Item: { userId: 'target-user', roles: targetCurrentRoles },
        });
      }
      if (commandName === 'UpdateCommand') {
        // Capture the update for inspection
        capturedUpdates.push(command.input);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;

  return { client, capturedUpdates };
}

describe('Property 1: Bug Condition — Admin/SuperAdmin Role Stripping via assignRoles', () => {
  it('non-SuperAdmin caller cannot strip Admin/SuperAdmin roles by omission', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonSuperAdminCallerRolesArb,
        targetCurrentRolesWithAdminArb,
        newRolesOmittingAdminArb,
        async (callerRoles, targetCurrentRoles, newRoles) => {
          // Verify bug condition holds for this input
          const callerIsSuperAdmin = callerRoles.includes('SuperAdmin');
          const targetHasAdmin = targetCurrentRoles.includes('Admin');
          const targetHasSuperAdmin = targetCurrentRoles.includes('SuperAdmin');
          const newRolesOmitAdmin = targetHasAdmin && !newRoles.includes('Admin');
          const newRolesOmitSuperAdmin = targetHasSuperAdmin && !newRoles.includes('SuperAdmin');

          // Pre-condition: this IS a bug condition input
          fc.pre(!callerIsSuperAdmin);
          fc.pre(targetHasAdmin || targetHasSuperAdmin);
          fc.pre(newRolesOmitAdmin || newRolesOmitSuperAdmin);

          const { client, capturedUpdates } = createMockDynamoClient(targetCurrentRoles);

          const result = await assignRoles(
            'target-user',
            newRoles,
            client,
            TABLE,
            callerRoles,
          );

          // The function should succeed (it doesn't reject regular role assignments)
          expect(result.success).toBe(true);

          // Inspect the roles actually written to DynamoDB
          expect(capturedUpdates.length).toBeGreaterThan(0);
          const writtenRoles: string[] = capturedUpdates[capturedUpdates.length - 1]
            .ExpressionAttributeValues[':roles'];

          // EXPECTED BEHAVIOR (after fix):
          // All original admin-level roles from targetCurrentRoles must be preserved
          if (targetHasAdmin) {
            expect(writtenRoles).toContain('Admin');
          }
          if (targetHasSuperAdmin) {
            expect(writtenRoles).toContain('SuperAdmin');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 2: Preservation — Non-Buggy assignRoles Behavior Unchanged
// ============================================================

/**
 * Preservation Property Tests — Verify non-buggy behavior is unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 *
 * These tests capture the CURRENT (unfixed) behavior for inputs where
 * isBugCondition returns false. They MUST PASS on unfixed code to
 * establish a baseline that the fix must preserve.
 *
 * Non-buggy inputs:
 *   1. Caller IS SuperAdmin → can assign any valid roles freely
 *   2. Target does NOT have Admin/SuperAdmin roles → any caller can assign regular roles
 *   3. Non-SuperAdmin caller assigns roles that include all existing admin roles (no omission)
 *      — Note: validateRoleAssignment blocks non-SuperAdmin from submitting Admin in new roles,
 *        so this case is only reachable when target admin roles are NOT in the new list (bug condition)
 *        or when the caller IS SuperAdmin. We test the SuperAdmin case in scenario 1.
 *
 * On UNFIXED code: assignRoles writes caller-provided roles directly to DynamoDB.
 * These tests verify that exact behavior.
 */

/**
 * Arbitrary: SuperAdmin caller roles — must include 'SuperAdmin', may include others.
 */
const superAdminCallerRolesArb = fc
  .subarray([...REGULAR_ROLES, 'Admin'] as UserRole[], { minLength: 0 })
  .map((extras) => [...new Set(['SuperAdmin' as UserRole, ...extras])]);

/**
 * Arbitrary: target roles with NO admin-level roles (only regular roles).
 */
const targetRolesNoAdminArb = fc
  .subarray([...REGULAR_ROLES], { minLength: 0 })
  .map((roles) => [...roles]);

/**
 * Arbitrary: any caller roles (at least one role, may or may not include admin roles).
 */
const anyCallerRolesArb = fc
  .subarray([...REGULAR_ROLES, 'Admin'] as UserRole[], { minLength: 1 })
  .map((roles) => [...roles]);

/**
 * Arbitrary: valid new roles for assignment — only regular roles (no Admin/SuperAdmin).
 * These are always accepted by validateRoleAssignment regardless of caller.
 */
const regularNewRolesArb = fc
  .subarray([...REGULAR_ROLES], { minLength: 1 })
  .map((roles) => [...roles]);

/**
 * Arbitrary: valid new roles that a SuperAdmin can assign — regular roles + optionally Admin.
 * SuperAdmin can include Admin in the new roles list.
 * SuperAdmin is excluded because validateRoles rejects it (not in VALID_ROLES).
 */
const superAdminNewRolesArb = fc
  .subarray([...REGULAR_ROLES, 'Admin'] as UserRole[], { minLength: 1 })
  .map((roles) => [...roles]);

/**
 * Arbitrary: any target current roles (may include admin roles).
 */
const anyTargetCurrentRolesArb = fc
  .subarray([...REGULAR_ROLES, ...ADMIN_ROLES] as UserRole[], { minLength: 0 })
  .map((roles) => [...roles]);

describe('Property 2: Preservation — Non-Buggy assignRoles Behavior Unchanged', () => {
  /**
   * Scenario 1: SuperAdmin caller assigning any valid roles to any target.
   * On unfixed code, assignRoles writes the caller-provided roles directly.
   * This behavior must be preserved after the fix.
   *
   * **Validates: Requirements 3.1, 3.3**
   */
  it('SuperAdmin caller assigns roles → roles written with target SuperAdmin preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        superAdminCallerRolesArb,
        anyTargetCurrentRolesArb,
        superAdminNewRolesArb,
        async (callerRoles, targetCurrentRoles, newRoles) => {
          // Pre-condition: caller IS SuperAdmin
          fc.pre(callerRoles.includes('SuperAdmin'));

          const { client, capturedUpdates } = createMockDynamoClient(targetCurrentRoles);

          const result = await assignRoles(
            'target-user',
            newRoles,
            client,
            TABLE,
            callerRoles,
          );

          expect(result.success).toBe(true);

          expect(capturedUpdates.length).toBeGreaterThan(0);
          const writtenRoles: string[] = capturedUpdates[capturedUpdates.length - 1]
            .ExpressionAttributeValues[':roles'];

          // SuperAdmin caller: submitted roles (minus SuperAdmin) + target's existing SuperAdmin (if any)
          const expectedRoles = [...new Set([
            ...newRoles.filter((r: string) => r !== 'SuperAdmin'),
            ...(targetCurrentRoles.includes('SuperAdmin') ? ['SuperAdmin'] : []),
          ])];
          expect(writtenRoles.slice().sort()).toEqual(expectedRoles.slice().sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Scenario 2: Any caller assigning regular-only roles to a target WITHOUT admin roles.
   * On unfixed code, assignRoles writes the caller-provided roles directly.
   * This behavior must be preserved after the fix.
   *
   * **Validates: Requirements 3.3**
   */
  it('any caller assigns regular roles to non-admin target → roles written as-is', async () => {
    await fc.assert(
      fc.asyncProperty(
        anyCallerRolesArb,
        targetRolesNoAdminArb,
        regularNewRolesArb,
        async (callerRoles, targetCurrentRoles, newRoles) => {
          // Pre-condition: target has NO admin roles
          fc.pre(!targetCurrentRoles.some((r: string) => ADMIN_ROLES.includes(r as UserRole)));
          // Pre-condition: new roles contain no admin roles (regular only)
          fc.pre(!newRoles.some((r: string) => ADMIN_ROLES.includes(r as UserRole)));

          const { client, capturedUpdates } = createMockDynamoClient(targetCurrentRoles);

          const result = await assignRoles(
            'target-user',
            newRoles,
            client,
            TABLE,
            callerRoles,
          );

          expect(result.success).toBe(true);

          // On unfixed code, assignRoles writes exactly the caller-provided roles
          expect(capturedUpdates.length).toBeGreaterThan(0);
          const writtenRoles: string[] = capturedUpdates[capturedUpdates.length - 1]
            .ExpressionAttributeValues[':roles'];

          expect(writtenRoles.slice().sort()).toEqual(newRoles.slice().sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Scenario 3: SuperAdmin caller can freely add/remove Admin role.
   * Specifically tests that SuperAdmin can assign Admin to a target, and can also
   * assign roles WITHOUT Admin to a target who currently has Admin (removing it).
   *
   * **Validates: Requirements 3.1**
   */
  it('SuperAdmin caller can add Admin role to any target', async () => {
    await fc.assert(
      fc.asyncProperty(
        superAdminCallerRolesArb,
        anyTargetCurrentRolesArb,
        regularNewRolesArb,
        async (callerRoles, targetCurrentRoles, baseRoles) => {
          fc.pre(callerRoles.includes('SuperAdmin'));

          // New roles include Admin
          const newRoles: UserRole[] = [...new Set(['Admin' as UserRole, ...baseRoles])];

          const { client, capturedUpdates } = createMockDynamoClient(targetCurrentRoles);

          const result = await assignRoles(
            'target-user',
            newRoles,
            client,
            TABLE,
            callerRoles,
          );

          expect(result.success).toBe(true);
          expect(capturedUpdates.length).toBeGreaterThan(0);

          const writtenRoles: string[] = capturedUpdates[capturedUpdates.length - 1]
            .ExpressionAttributeValues[':roles'];

          // Admin should be in the written roles
          expect(writtenRoles).toContain('Admin');
          // SuperAdmin from target is preserved if it existed
          const expectedRoles = [...new Set([
            ...newRoles.filter((r: string) => r !== 'SuperAdmin'),
            ...(targetCurrentRoles.includes('SuperAdmin') ? ['SuperAdmin'] : []),
          ])];
          expect(writtenRoles.slice().sort()).toEqual(expectedRoles.slice().sort());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('SuperAdmin caller can remove Admin role from target by omission', async () => {
    await fc.assert(
      fc.asyncProperty(
        superAdminCallerRolesArb,
        regularNewRolesArb,
        async (callerRoles, newRoles) => {
          fc.pre(callerRoles.includes('SuperAdmin'));
          // New roles do NOT include Admin
          fc.pre(!newRoles.includes('Admin'));

          // Target currently has Admin
          const targetCurrentRoles: UserRole[] = ['Admin', 'Speaker'];

          const { client, capturedUpdates } = createMockDynamoClient(targetCurrentRoles);

          const result = await assignRoles(
            'target-user',
            newRoles,
            client,
            TABLE,
            callerRoles,
          );

          expect(result.success).toBe(true);
          expect(capturedUpdates.length).toBeGreaterThan(0);

          const writtenRoles: string[] = capturedUpdates[capturedUpdates.length - 1]
            .ExpressionAttributeValues[':roles'];

          // Admin should NOT be in the written roles (SuperAdmin can remove it)
          expect(writtenRoles).not.toContain('Admin');
          expect(writtenRoles.slice().sort()).toEqual(newRoles.slice().sort());
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ============================================================
// Property 2 (continued): Preservation of setUserStatus and deleteUser permission checks
// ============================================================

/**
 * Preservation tests for setUserStatus and deleteUser.
 * These functions already have correct permission checks.
 * We verify those checks are unchanged on the current (unfixed) code.
 *
 * **Validates: Requirements 3.4, 3.5, 3.6, 3.7**
 */

/**
 * Create a mock DynamoDB client for setUserStatus/deleteUser tests.
 * Returns the target user with specified roles for GetCommand.
 * Captures UpdateCommand/DeleteCommand for inspection.
 */
function createMockDynamoClientForUserOps(targetUserId: string, targetRoles: string[]) {
  const capturedOps: { type: string; input: any }[] = [];

  const client = {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetCommand') {
        return Promise.resolve({
          Item: { userId: targetUserId, roles: targetRoles },
        });
      }
      if (commandName === 'UpdateCommand') {
        capturedOps.push({ type: 'update', input: command.input });
        return Promise.resolve({});
      }
      if (commandName === 'DeleteCommand') {
        capturedOps.push({ type: 'delete', input: command.input });
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;

  return { client, capturedOps };
}

describe('Property 2 (continued): Preservation of setUserStatus permission checks', () => {
  /**
   * SuperAdmin targets cannot be disabled by anyone.
   *
   * **Validates: Requirements 3.6**
   */
  it('SuperAdmin targets cannot be disabled by any caller', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...REGULAR_ROLES, ...ADMIN_ROLES] as UserRole[], { minLength: 1 }),
        async (callerRoles) => {
          const targetRoles: UserRole[] = ['SuperAdmin'];
          const { client } = createMockDynamoClientForUserOps('superadmin-user', targetRoles);

          const result = await setUserStatus(
            'superadmin-user',
            'disabled',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('CANNOT_DISABLE_SUPERADMIN');
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * SuperAdmin caller can disable Admin targets.
   *
   * **Validates: Requirements 3.5**
   */
  it('SuperAdmin caller can disable Admin targets', async () => {
    await fc.assert(
      fc.asyncProperty(
        superAdminCallerRolesArb,
        async (callerRoles) => {
          fc.pre(callerRoles.includes('SuperAdmin'));

          const targetRoles: UserRole[] = ['Admin'];
          const { client, capturedOps } = createMockDynamoClientForUserOps('admin-user', targetRoles);

          const result = await setUserStatus(
            'admin-user',
            'disabled',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(true);
          expect(capturedOps.length).toBe(1);
          expect(capturedOps[0].type).toBe('update');
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Non-SuperAdmin caller is blocked from disabling Admin targets.
   *
   * **Validates: Requirements 3.4 (inverse — non-SuperAdmin blocked)**
   */
  it('non-SuperAdmin caller is blocked from disabling Admin targets', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonSuperAdminCallerRolesArb,
        async (callerRoles) => {
          fc.pre(!callerRoles.includes('SuperAdmin'));

          const targetRoles: UserRole[] = ['Admin'];
          const { client } = createMockDynamoClientForUserOps('admin-user', targetRoles);

          const result = await setUserStatus(
            'admin-user',
            'disabled',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ADMIN');
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('Property 2 (continued): Preservation of deleteUser permission checks', () => {
  /**
   * SuperAdmin targets cannot be deleted by anyone.
   *
   * **Validates: Requirements 3.7**
   */
  it('SuperAdmin targets cannot be deleted by any caller', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...REGULAR_ROLES, ...ADMIN_ROLES] as UserRole[], { minLength: 1 }),
        async (callerRoles) => {
          const targetRoles: UserRole[] = ['SuperAdmin'];
          const { client } = createMockDynamoClientForUserOps('superadmin-user', targetRoles);

          const result = await deleteUser(
            'superadmin-user',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('CANNOT_DELETE_SUPERADMIN');
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * SuperAdmin caller can delete Admin targets.
   *
   * **Validates: Requirements 3.5**
   */
  it('SuperAdmin caller can delete Admin targets', async () => {
    await fc.assert(
      fc.asyncProperty(
        superAdminCallerRolesArb,
        async (callerRoles) => {
          fc.pre(callerRoles.includes('SuperAdmin'));

          const targetRoles: UserRole[] = ['Admin'];
          const { client, capturedOps } = createMockDynamoClientForUserOps('admin-user', targetRoles);

          const result = await deleteUser(
            'admin-user',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(true);
          expect(capturedOps.length).toBe(1);
          expect(capturedOps[0].type).toBe('delete');
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Non-SuperAdmin caller is blocked from deleting Admin targets.
   *
   * **Validates: Requirements 3.4 (inverse — non-SuperAdmin blocked)**
   */
  it('non-SuperAdmin caller is blocked from deleting Admin targets', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonSuperAdminCallerRolesArb,
        async (callerRoles) => {
          fc.pre(!callerRoles.includes('SuperAdmin'));

          const targetRoles: UserRole[] = ['Admin'];
          const { client } = createMockDynamoClientForUserOps('admin-user', targetRoles);

          const result = await deleteUser(
            'admin-user',
            'caller-user',
            callerRoles,
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ADMIN');
        },
      ),
      { numRuns: 50 },
    );
  });
});
