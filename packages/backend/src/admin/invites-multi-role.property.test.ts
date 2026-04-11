import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { batchCreateInvites } from '../auth/invite';
import { REGULAR_ROLES, UserRole } from '@points-mall/shared';

/**
 * Feature: invite-multi-role, Property 1: 邀请创建往返一致性（Invite creation round-trip）
 *
 * For any non-empty REGULAR_ROLES subset `roles`, calling `batchCreateInvites(1, roles, ...)`
 * should create an invite record where the `roles` field matches the deduplicated input roles
 * array, and the `role` field equals `roles[0]`.
 *
 * **Validates: Requirements 2.1, 2.5, 3.1**
 */

const invitesTable = 'InvitesTable';
const registerBaseUrl = 'https://example.com/register';

function createMockClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

describe('Feature: invite-multi-role, Property 1: 邀请创建往返一致性（Invite creation round-trip）', () => {
  it('batchCreateInvites(1, roles) should produce an invite whose roles match deduplicated input and role equals roles[0]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 }),
        async (roles) => {
          const client = createMockClient();

          const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

          expect(result.success).toBe(true);
          if (!result.success) return;

          expect(result.invites).toHaveLength(1);

          const invite = result.invites[0];
          const expectedRoles = [...new Set(roles)];

          // roles field matches deduplicated input
          expect(invite.roles).toEqual(expectedRoles);

          // Verify what was written to DynamoDB via PutCommand
          expect(client.send).toHaveBeenCalledTimes(1);
          const putInput = client.send.mock.calls[0][0].input;
          const writtenItem = putInput.Item;

          // role field equals roles[0]
          expect(writtenItem.role).toBe(expectedRoles[0]);
          // roles field in DynamoDB matches deduplicated input
          expect(writtenItem.roles).toEqual(expectedRoles);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: invite-multi-role, Property 2: 角色去重幂等性（Roles deduplication idempotence）
 *
 * For any array of UserRole values `rolesWithDups` that contains duplicate elements,
 * calling `batchCreateInvites` should store `roles` equal to `[...new Set(rolesWithDups)]`.
 * For the same set of roles, no matter how many duplicates in the input, the result is the same.
 *
 * **Validates: Requirements 2.4**
 */
describe('Feature: invite-multi-role, Property 2: 角色去重幂等性（Roles deduplication idempotence）', () => {
  it('batchCreateInvites with duplicated roles should store deduplicated roles equal to [...new Set(input)]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...(REGULAR_ROLES as unknown as UserRole[])), { minLength: 1 }),
        async (rolesWithDups) => {
          const client = createMockClient();

          const result = await batchCreateInvites(1, rolesWithDups, client, invitesTable, registerBaseUrl);

          expect(result.success).toBe(true);
          if (!result.success) return;

          const expectedRoles = [...new Set(rolesWithDups)];

          // Returned roles match deduplicated input
          const invite = result.invites[0];
          expect(invite.roles).toEqual(expectedRoles);

          // DynamoDB written roles match deduplicated input
          const putInput = client.send.mock.calls[0][0].input;
          const writtenItem = putInput.Item;
          expect(writtenItem.roles).toEqual(expectedRoles);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: invite-multi-role, Property 3: 非法角色拒绝（Invalid role rejection）
 *
 * For any role array, if it contains at least one value not in `REGULAR_ROLES`
 * (such as 'Admin', 'SuperAdmin', or any arbitrary string), `batchCreateInvites`
 * should return `success: false` with an invalid role error code.
 *
 * **Validates: Requirements 2.3**
 */
describe('Feature: invite-multi-role, Property 3: 非法角色拒绝（Invalid role rejection）', () => {
  it('batchCreateInvites should return success: false with INVALID_ROLE when roles contain a non-REGULAR_ROLES value', async () => {
    const knownInvalidRoles = ['Admin', 'SuperAdmin'] as UserRole[];

    // Generator: produce an array that contains at least one invalid role
    const rolesWithInvalid = fc
      .tuple(
        // Some valid roles (possibly empty)
        fc.array(fc.constantFrom(...(REGULAR_ROLES as unknown as UserRole[])), { minLength: 0, maxLength: 3 }),
        // At least one invalid role: either a known admin role or an arbitrary non-REGULAR string
        fc.oneof(
          fc.constantFrom(...knownInvalidRoles),
          fc.string({ minLength: 1 }).filter((s) => !(REGULAR_ROLES as unknown as string[]).includes(s)),
        ),
      )
      .map(([validRoles, invalidRole]) => {
        // Insert the invalid role at a random-ish position
        const combined = [...validRoles];
        combined.splice(Math.floor(combined.length / 2), 0, invalidRole as UserRole);
        return combined;
      });

    await fc.assert(
      fc.asyncProperty(rolesWithInvalid, async (roles) => {
        const client = createMockClient();

        const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

        expect(result.success).toBe(false);
        if (result.success) return;

        expect(result.error.code).toBe('INVALID_ROLE');
        expect(result.error.message).toBeTruthy();

        // DynamoDB should NOT have been called
        expect(client.send).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: invite-multi-role, Property 5: 角色数组长度不变量（Roles array length invariant）
 *
 * For all successfully created `InviteRecord`, its `roles` array length should satisfy
 * `1 ≤ roles.length ≤ 4`.
 *
 * **Validates: Requirements 3.3**
 */
describe('Feature: invite-multi-role, Property 5: 角色数组长度不变量（Roles array length invariant）', () => {
  it('batchCreateInvites should produce invites whose roles array length is between 1 and 4 inclusive', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 }),
        async (roles) => {
          const client = createMockClient();

          const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl);

          expect(result.success).toBe(true);
          if (!result.success) return;

          const invite = result.invites[0];

          // roles array length invariant: 1 ≤ length ≤ 4
          expect(invite.roles.length).toBeGreaterThanOrEqual(1);
          expect(invite.roles.length).toBeLessThanOrEqual(4);
        },
      ),
      { numRuns: 100 },
    );
  });
});
