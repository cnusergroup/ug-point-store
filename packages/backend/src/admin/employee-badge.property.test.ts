import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { batchCreateInvites } from '../auth/invite';
import { REGULAR_ROLES, UserRole } from '@points-mall/shared';

/**
 * Feature: employee-badge, Property 1: 邀请创建 isEmployee 标记往返一致性
 *
 * For any valid roles combination `roles`, count ∈ [1, 100], and boolean `isEmployee`,
 * calling `batchCreateInvites(count, roles, ..., isEmployee)` should produce `count`
 * invite records where each record's `isEmployee` field equals the passed `isEmployee` value.
 * When `isEmployee` is not passed, all records should have `isEmployee === false`.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4**
 */

const invitesTable = 'InvitesTable';
const registerBaseUrl = 'https://example.com/register';

function createMockClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

describe('Feature: employee-badge, Property 1: 邀请创建 isEmployee 标记往返一致性', () => {
  it('batchCreateInvites(count, roles, ..., isEmployee) should produce count records each with matching isEmployee', async () => {
    await fc.assert(
      fc.asyncProperty(
        // count ∈ [1, 100] — use smaller upper bound to keep tests fast
        fc.integer({ min: 1, max: 10 }),
        // isEmployee boolean
        fc.boolean(),
        async (count, isEmployee) => {
          // When isEmployee is true, roles must be ['Speaker'] only
          const roles: UserRole[] = isEmployee
            ? ['Speaker' as UserRole]
            : (fc.sample(fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 }), 1)[0]);
          const client = createMockClient();

          const result = await batchCreateInvites(
            count,
            roles,
            client,
            invitesTable,
            registerBaseUrl,
            undefined,
            isEmployee,
          );

          expect(result.success).toBe(true);
          if (!result.success) return;

          // Should produce exactly `count` invite records
          expect(result.invites).toHaveLength(count);

          // Each record's isEmployee field should equal the passed isEmployee value
          for (const invite of result.invites) {
            expect(invite.isEmployee).toBe(isEmployee);
          }

          // Verify DynamoDB writes: each PutCommand should contain the correct isEmployee
          expect(client.send).toHaveBeenCalledTimes(count);
          for (let i = 0; i < count; i++) {
            const putInput = client.send.mock.calls[i][0].input;
            const writtenItem = putInput.Item;
            expect(writtenItem.isEmployee).toBe(isEmployee);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('batchCreateInvites(count, roles, ...) without isEmployee should produce records with isEmployee === false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.subarray(REGULAR_ROLES as unknown as UserRole[], { minLength: 1 }),
        async (count, roles) => {
          const client = createMockClient();

          // Call without isEmployee parameter
          const result = await batchCreateInvites(
            count,
            roles,
            client,
            invitesTable,
            registerBaseUrl,
          );

          expect(result.success).toBe(true);
          if (!result.success) return;

          expect(result.invites).toHaveLength(count);

          // All records should default to isEmployee === false
          for (const invite of result.invites) {
            expect(invite.isEmployee).toBe(false);
          }

          // Verify DynamoDB writes default to false
          expect(client.send).toHaveBeenCalledTimes(count);
          for (let i = 0; i < count; i++) {
            const putInput = client.send.mock.calls[i][0].input;
            const writtenItem = putInput.Item;
            expect(writtenItem.isEmployee).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('batchCreateInvites with isEmployee=true and non-Speaker roles should fail with EMPLOYEE_SPEAKER_ONLY', async () => {
    const nonSpeakerRoles: UserRole[][] = [
      ['UserGroupLeader' as UserRole],
      ['Volunteer' as UserRole],
      ['UserGroupLeader' as UserRole, 'Speaker' as UserRole],
    ];
    for (const roles of nonSpeakerRoles) {
      const client = createMockClient();
      const result = await batchCreateInvites(1, roles, client, invitesTable, registerBaseUrl, undefined, true);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('EMPLOYEE_SPEAKER_ONLY');
      }
    }
  });
});

/**
 * Feature: employee-badge, Property 4: 向后兼容默认值
 *
 * For any record without `isEmployee` field (old data), `getInviteIsEmployee({})`
 * should return `false`. For `getInviteIsEmployee({ isEmployee: true })` should
 * return `true`. For `getInviteIsEmployee({ isEmployee: false })` should return `false`.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */
import { getInviteIsEmployee } from '@points-mall/shared';

describe('Feature: employee-badge, Property 4: 向后兼容默认值', () => {
  it('getInviteIsEmployee should faithfully return the isEmployee value when present', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (isEmployee) => {
          const result = getInviteIsEmployee({ isEmployee });
          expect(result).toBe(isEmployee);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getInviteIsEmployee should return false for records without isEmployee field (old data)', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary record-like objects that never have isEmployee
        fc.record({
          token: fc.string(),
          status: fc.string(),
          createdAt: fc.string(),
        }),
        (record) => {
          // Ensure no isEmployee field exists
          const oldRecord: { isEmployee?: boolean } = { ...record } as any;
          delete oldRecord.isEmployee;

          const result = getInviteIsEmployee(oldRecord);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getInviteIsEmployee({}) should return false (empty object — backward compatible default)', () => {
    fc.assert(
      fc.property(
        fc.constant({}),
        (emptyRecord) => {
          const result = getInviteIsEmployee(emptyRecord);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getInviteIsEmployee should return false when isEmployee is undefined', () => {
    fc.assert(
      fc.property(
        fc.constant({ isEmployee: undefined }),
        (record) => {
          const result = getInviteIsEmployee(record as { isEmployee?: boolean });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: employee-badge, Property 5: 记录序列化往返一致性
 *
 * For any invite record or user record (with or without isEmployee field),
 * serializing to JSON and deserializing should produce an equivalent object.
 * The isEmployee field's presence/absence and value should be preserved
 * through the round-trip.
 *
 * **Validates: Requirements 8.4**
 */

describe('Feature: employee-badge, Property 5: 记录序列化往返一致性', () => {
  // Generate safe ISO date strings from integer timestamps to avoid Invalid Date issues
  const safeISOString = fc
    .integer({ min: 946684800000, max: 4102444799000 }) // 2000-01-01 to 2099-12-31
    .map(ts => new Date(ts).toISOString());

  // Arbitrary for InviteRecord with isEmployee present
  const inviteRecordWithIsEmployee = fc.record({
    token: fc.string({ minLength: 1, maxLength: 50 }),
    role: fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin', 'OrderAdmin') as fc.Arbitrary<UserRole>,
    roles: fc.option(
      fc.array(
        fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin', 'OrderAdmin') as fc.Arbitrary<UserRole>,
        { minLength: 1, maxLength: 3 },
      ),
      { nil: undefined },
    ),
    status: fc.constantFrom('pending', 'used', 'expired') as fc.Arbitrary<'pending' | 'used' | 'expired'>,
    createdAt: safeISOString,
    expiresAt: safeISOString,
    usedAt: fc.option(safeISOString, { nil: undefined }),
    usedBy: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    isEmployee: fc.option(fc.boolean(), { nil: undefined }),
  });

  // Arbitrary for a user-like record with optional isEmployee
  const userRecordWithIsEmployee = fc.record({
    userId: fc.string({ minLength: 1, maxLength: 30 }),
    nickname: fc.string({ minLength: 1, maxLength: 50 }),
    email: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
    roles: fc.array(
      fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin', 'OrderAdmin') as fc.Arbitrary<UserRole>,
      { minLength: 1, maxLength: 3 },
    ),
    points: fc.integer({ min: 0, max: 100000 }),
    createdAt: safeISOString,
    isEmployee: fc.option(fc.boolean(), { nil: undefined }),
  });

  it('InviteRecord round-trip: JSON.parse(JSON.stringify(record)) should produce an equivalent object', () => {
    fc.assert(
      fc.property(
        inviteRecordWithIsEmployee,
        (record) => {
          const serialized = JSON.stringify(record);
          const deserialized = JSON.parse(serialized);

          // The round-trip should produce a deep-equal object
          expect(deserialized).toEqual(record);

          // Specifically verify isEmployee field preservation
          if (record.isEmployee !== undefined) {
            expect(deserialized.isEmployee).toBe(record.isEmployee);
            expect('isEmployee' in deserialized).toBe(true);
          } else {
            // When isEmployee is undefined, JSON.stringify omits it
            expect('isEmployee' in deserialized).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('User record round-trip: JSON.parse(JSON.stringify(record)) should produce an equivalent object', () => {
    fc.assert(
      fc.property(
        userRecordWithIsEmployee,
        (record) => {
          const serialized = JSON.stringify(record);
          const deserialized = JSON.parse(serialized);

          // The round-trip should produce a deep-equal object
          expect(deserialized).toEqual(record);

          // Specifically verify isEmployee field preservation
          if (record.isEmployee !== undefined) {
            expect(deserialized.isEmployee).toBe(record.isEmployee);
            expect('isEmployee' in deserialized).toBe(true);
          } else {
            expect('isEmployee' in deserialized).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isEmployee=true is preserved through serialization round-trip', () => {
    fc.assert(
      fc.property(
        inviteRecordWithIsEmployee.map(r => ({ ...r, isEmployee: true })),
        (record) => {
          const deserialized = JSON.parse(JSON.stringify(record));
          expect(deserialized.isEmployee).toBe(true);
          expect('isEmployee' in deserialized).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isEmployee=false is preserved through serialization round-trip', () => {
    fc.assert(
      fc.property(
        inviteRecordWithIsEmployee.map(r => ({ ...r, isEmployee: false })),
        (record) => {
          const deserialized = JSON.parse(JSON.stringify(record));
          expect(deserialized.isEmployee).toBe(false);
          expect('isEmployee' in deserialized).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('absence of isEmployee field is preserved through serialization round-trip', () => {
    fc.assert(
      fc.property(
        inviteRecordWithIsEmployee.map(r => {
          const { isEmployee: _, ...rest } = r;
          return rest;
        }),
        (record) => {
          const deserialized = JSON.parse(JSON.stringify(record));
          expect(deserialized).toEqual(record);
          expect('isEmployee' in deserialized).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
