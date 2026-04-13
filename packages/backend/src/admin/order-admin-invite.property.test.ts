import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { batchCreateInvites } from '../auth/invite';
import { ALL_ROLES, EXCLUSIVE_ROLES, UserRole } from '@points-mall/shared';

/**
 * Feature: order-admin-role, Property 4: 独占角色邀请创建一致性
 *
 * For any invite creation request containing an exclusive role:
 * - If roles array is exactly ['OrderAdmin'], creation should succeed
 *   and stored roles should be exactly ['OrderAdmin']
 * - If roles array contains OrderAdmin AND other roles, creation should
 *   fail with EXCLUSIVE_ROLE_CONFLICT error
 *
 * **Validates: Requirements 2.5, 10.3**
 */

const invitesTable = 'InvitesTable';
const registerBaseUrl = 'https://example.com/register';

function createMockClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

describe('Feature: order-admin-role, Property 4: 独占角色邀请创建一致性', () => {
  it('batchCreateInvites with exactly [OrderAdmin] should succeed and store roles as [OrderAdmin]', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate exactly the exclusive role alone
        fc.constantFrom(...(EXCLUSIVE_ROLES as UserRole[])),
        async (exclusiveRole) => {
          const client = createMockClient();
          const roles: UserRole[] = [exclusiveRole];

          const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

          expect(result.success).toBe(true);
          if (!result.success) return;

          expect(result.invites).toHaveLength(1);

          const invite = result.invites[0];
          // Stored roles should be exactly the exclusive role
          expect(invite.roles).toEqual([exclusiveRole]);

          // Verify DynamoDB write
          expect(client.send).toHaveBeenCalledTimes(1);
          const putInput = client.send.mock.calls[0][0].input;
          const writtenItem = putInput.Item;
          expect(writtenItem.roles).toEqual([exclusiveRole]);
          expect(writtenItem.role).toBe(exclusiveRole);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('batchCreateInvites with OrderAdmin AND other roles should fail with EXCLUSIVE_ROLE_CONFLICT', async () => {
    // Generate role arrays that contain at least one exclusive role AND at least one other role,
    // but with at most 4 unique roles total (to avoid hitting the max-roles-length check first).
    const nonExclusiveRoles = ALL_ROLES.filter(r => !EXCLUSIVE_ROLES.includes(r));

    const rolesWithExclusiveAndOthers = fc
      .tuple(
        fc.constantFrom(...(EXCLUSIVE_ROLES as UserRole[])),
        fc.subarray(nonExclusiveRoles as UserRole[], { minLength: 1, maxLength: 3 }),
      )
      .map(([exclusive, others]) => {
        // Combine exclusive role with others (total unique ≤ 4)
        const combined = [...others, exclusive];
        return combined;
      });

    await fc.assert(
      fc.asyncProperty(rolesWithExclusiveAndOthers, async (roles) => {
        const client = createMockClient();

        const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error.code).toBe('EXCLUSIVE_ROLE_CONFLICT');
        expect(result.error.message).toBeTruthy();

        // DynamoDB should NOT have been called
        expect(client.send).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('batchCreateInvites with roles NOT containing any exclusive role should not trigger EXCLUSIVE_ROLE_CONFLICT', async () => {
    const nonExclusiveRoles = ALL_ROLES.filter(r => !EXCLUSIVE_ROLES.includes(r));
    // Only use REGULAR_ROLES subset to avoid INVALID_ROLE errors from Admin/SuperAdmin
    const regularNonExclusive = nonExclusiveRoles.filter(
      r => !['Admin', 'SuperAdmin'].includes(r),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(regularNonExclusive as UserRole[], { minLength: 1 }),
        async (roles) => {
          const client = createMockClient();

          const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

          // Should succeed (no exclusive role conflict)
          expect(result.success).toBe(true);
          if (!result.success) return;

          // The error code should never be EXCLUSIVE_ROLE_CONFLICT
          expect(result.invites).toHaveLength(1);
          expect(result.invites[0].roles).toEqual([...new Set(roles)]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
