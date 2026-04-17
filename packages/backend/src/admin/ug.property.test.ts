import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { validateUGName, createUG, updateUGStatus, assignLeader } from './ug';

// ============================================================
// Property 1: UG name validation accepts valid names and rejects invalid names
// Feature: activity-points-tracking, Property 1: UG name validation accepts valid names and rejects invalid names
// **Validates: Requirements 2.2**
// ============================================================

describe('Feature: activity-points-tracking, Property 1: UG name validation accepts valid names and rejects invalid names', () => {
  it('accepts non-empty strings of 1~50 characters (after trimming)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        (name) => {
          const result = validateUGName(name);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects empty strings', () => {
    const result = validateUGName('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('rejects whitespace-only strings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }).map(n => ' '.repeat(n)),
        (name) => {
          const result = validateUGName(name);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects strings longer than 50 characters after trimming', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 51, maxLength: 200 }).filter(s => s.trim().length > 50),
        (name) => {
          const result = validateUGName(name);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects non-string types', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double({ noNaN: true }),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.anything()),
          fc.dictionary(fc.string(), fc.anything()),
        ),
        (input) => {
          const result = validateUGName(input);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('valid=true if and only if input is a string with trimmed length in [1, 50]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 0, maxLength: 200 }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (input) => {
          const result = validateUGName(input);
          const shouldBeValid =
            typeof input === 'string' &&
            input.trim().length >= 1 &&
            input.trim().length <= 50;

          expect(result.valid).toBe(shouldBeValid);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 2: UG name uniqueness is case-insensitive
// Feature: activity-points-tracking, Property 2: UG name uniqueness is case-insensitive
// **Validates: Requirements 2.3**
// ============================================================

/**
 * Generate a case variant of a string by randomly toggling the case of each character.
 * Uses a boolean array from fast-check to decide per-character toggling.
 */
function makeCaseVariant(name: string, toggles: boolean[]): string {
  return name
    .split('')
    .map((ch, i) => {
      if (toggles[i % toggles.length]) {
        return ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
      }
      return ch;
    })
    .join('');
}

describe('Feature: activity-points-tracking, Property 2: UG name uniqueness is case-insensitive', () => {
  const UGS_TABLE = 'UGs';

  it('rejects creation of a UG whose name matches an existing UG name case-insensitively', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a valid UG name (1-50 chars, non-empty after trim)
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        // Generate toggle array for case variant
        fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
        async (originalName, toggles) => {
          const trimmedOriginal = originalName.trim();
          const caseVariant = makeCaseVariant(trimmedOriginal, toggles);

          // The variant must also be a valid name (1-50 chars after trim)
          if (caseVariant.trim().length === 0 || caseVariant.trim().length > 50) return;

          // Create a mock DynamoDB client that simulates the first UG already existing
          const mockClient = {
            send: vi.fn()
              // ScanCommand for uniqueness check — returns the existing UG name
              .mockResolvedValueOnce({ Items: [{ name: trimmedOriginal }] }),
          } as any;

          // Attempt to create a UG with the case variant — should be rejected
          const result = await createUG({ name: caseVariant }, mockClient, UGS_TABLE);
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('DUPLICATE_UG_NAME');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows creation when no case-insensitive match exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        async (name) => {
          const mockClient = {
            send: vi.fn()
              // ScanCommand — no existing UGs
              .mockResolvedValueOnce({ Items: [] })
              // PutCommand — succeeds
              .mockResolvedValueOnce({}),
          } as any;

          const result = await createUG({ name }, mockClient, UGS_TABLE);
          expect(result.success).toBe(true);
          expect(result.ug).toBeDefined();
          expect(result.ug!.name).toBe(name.trim());
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 3: UG status toggle is a round-trip
// Feature: activity-points-tracking, Property 3: UG status toggle is a round-trip
// **Validates: Requirements 4.1, 4.2**
// ============================================================

describe('Feature: activity-points-tracking, Property 3: UG status toggle is a round-trip', () => {
  const UGS_TABLE = 'UGs';

  it('toggling active→inactive→active results in status "active" with updated updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random UG id
        fc.string({ minLength: 10, maxLength: 26 }).filter(s => s.trim().length > 0),
        // Generate a random UG name
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        async (ugId, ugName) => {
          const originalCreatedAt = '2024-01-01T00:00:00.000Z';
          const originalUpdatedAt = '2024-01-01T00:00:00.000Z';

          // Track UpdateCommand calls to capture status and updatedAt values
          const updateCalls: { status: string; updatedAt: string }[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const commandName = command.constructor.name;
              if (commandName === 'GetCommand') {
                // UG exists
                return Promise.resolve({
                  Item: {
                    ugId,
                    name: ugName.trim(),
                    status: 'active',
                    createdAt: originalCreatedAt,
                    updatedAt: originalUpdatedAt,
                  },
                });
              }
              if (commandName === 'UpdateCommand') {
                const exprValues = command.input.ExpressionAttributeValues;
                updateCalls.push({
                  status: exprValues[':status'],
                  updatedAt: exprValues[':now'],
                });
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          // Step 1: Toggle active → inactive
          const result1 = await updateUGStatus(ugId, 'inactive', mockClient, UGS_TABLE);
          expect(result1.success).toBe(true);

          // Step 2: Toggle inactive → active
          const result2 = await updateUGStatus(ugId, 'active', mockClient, UGS_TABLE);
          expect(result2.success).toBe(true);

          // Verify two UpdateCommands were issued
          expect(updateCalls).toHaveLength(2);

          // First toggle set status to inactive
          expect(updateCalls[0].status).toBe('inactive');
          // Second toggle set status back to active
          expect(updateCalls[1].status).toBe('active');

          // Both updatedAt values should be valid ISO timestamps and different from original
          for (const call of updateCalls) {
            expect(new Date(call.updatedAt).toISOString()).toBe(call.updatedAt);
            expect(call.updatedAt >= originalUpdatedAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('toggling inactive→active→inactive results in status "inactive" with updated updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 26 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        async (ugId, ugName) => {
          const originalCreatedAt = '2024-01-01T00:00:00.000Z';
          const originalUpdatedAt = '2024-01-01T00:00:00.000Z';

          const updateCalls: { status: string; updatedAt: string }[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const commandName = command.constructor.name;
              if (commandName === 'GetCommand') {
                return Promise.resolve({
                  Item: {
                    ugId,
                    name: ugName.trim(),
                    status: 'inactive',
                    createdAt: originalCreatedAt,
                    updatedAt: originalUpdatedAt,
                  },
                });
              }
              if (commandName === 'UpdateCommand') {
                const exprValues = command.input.ExpressionAttributeValues;
                updateCalls.push({
                  status: exprValues[':status'],
                  updatedAt: exprValues[':now'],
                });
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          // Step 1: Toggle inactive → active
          const result1 = await updateUGStatus(ugId, 'active', mockClient, UGS_TABLE);
          expect(result1.success).toBe(true);

          // Step 2: Toggle active → inactive
          const result2 = await updateUGStatus(ugId, 'inactive', mockClient, UGS_TABLE);
          expect(result2.success).toBe(true);

          expect(updateCalls).toHaveLength(2);

          // First toggle set status to active
          expect(updateCalls[0].status).toBe('active');
          // Second toggle set status back to inactive
          expect(updateCalls[1].status).toBe('inactive');

          // Both updatedAt values should be valid ISO timestamps
          for (const call of updateCalls) {
            expect(new Date(call.updatedAt).toISOString()).toBe(call.updatedAt);
            expect(call.updatedAt >= originalUpdatedAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('status field always reflects the most recent update', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 26 }).filter(s => s.trim().length > 0),
        // Generate a random sequence of status toggles (at least 2)
        fc.array(fc.constantFrom('active' as const, 'inactive' as const), { minLength: 2, maxLength: 10 }),
        async (ugId, statusSequence) => {
          const updateCalls: { status: string; updatedAt: string }[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const commandName = command.constructor.name;
              if (commandName === 'GetCommand') {
                return Promise.resolve({
                  Item: {
                    ugId,
                    name: 'TestUG',
                    status: 'active',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    updatedAt: '2024-01-01T00:00:00.000Z',
                  },
                });
              }
              if (commandName === 'UpdateCommand') {
                const exprValues = command.input.ExpressionAttributeValues;
                updateCalls.push({
                  status: exprValues[':status'],
                  updatedAt: exprValues[':now'],
                });
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          // Apply each status in the sequence
          for (const status of statusSequence) {
            const result = await updateUGStatus(ugId, status, mockClient, UGS_TABLE);
            expect(result.success).toBe(true);
          }

          // The last UpdateCommand should have the last status in the sequence
          expect(updateCalls).toHaveLength(statusSequence.length);
          const lastCall = updateCalls[updateCalls.length - 1];
          expect(lastCall.status).toBe(statusSequence[statusSequence.length - 1]);

          // All updatedAt values should be valid ISO timestamps
          for (const call of updateCalls) {
            expect(new Date(call.updatedAt).toISOString()).toBe(call.updatedAt);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 4: UG list filtering returns correct results in descending order
// Feature: activity-points-tracking, Property 4: UG list filtering returns correct results in descending order
// **Validates: Requirements 5.1, 5.2, 5.3**
// ============================================================

import { listUGs } from './ug';

/** Generate a valid ISO 8601 timestamp string within a reasonable range */
const isoDateArb = fc.integer({
  min: new Date('2020-01-01T00:00:00.000Z').getTime(),
  max: new Date('2030-12-31T23:59:59.999Z').getTime(),
}).map(ts => new Date(ts).toISOString());

/** Arbitrary for generating a random UG record with a given status */
const ugRecordArb = (status: 'active' | 'inactive') =>
  fc.record({
    ugId: fc.string({ minLength: 10, maxLength: 26 }).filter(s => s.trim().length > 0),
    name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1),
    status: fc.constant(status),
    createdAt: isoDateArb,
    updatedAt: isoDateArb,
  });

/** Generate a mixed set of active and inactive UG records */
const mixedUGSetArb = fc.tuple(
  fc.array(ugRecordArb('active'), { minLength: 0, maxLength: 10 }),
  fc.array(ugRecordArb('inactive'), { minLength: 0, maxLength: 10 }),
).map(([activeUGs, inactiveUGs]) => ({
  activeUGs,
  inactiveUGs,
  allUGs: [...activeUGs, ...inactiveUGs],
}));

describe('Feature: activity-points-tracking, Property 4: UG list filtering returns correct results in descending order', () => {
  const UGS_TABLE = 'UGs';

  it('filtering by "active" returns only active UGs in descending createdAt order', async () => {
    await fc.assert(
      fc.asyncProperty(mixedUGSetArb, async ({ activeUGs }) => {
        // For status-specific queries, listUGs uses QueryCommand on status-index GSI.
        // The GSI returns results already sorted by createdAt descending (ScanIndexForward=false).
        const sortedActive = [...activeUGs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const mockClient = {
          send: vi.fn().mockResolvedValueOnce({ Items: sortedActive }),
        } as any;

        const result = await listUGs({ status: 'active' }, mockClient, UGS_TABLE);

        expect(result.success).toBe(true);
        expect(result.ugs).toBeDefined();
        // All returned UGs must have status "active"
        for (const ug of result.ugs!) {
          expect(ug.status).toBe('active');
        }
        // Count must match
        expect(result.ugs!.length).toBe(activeUGs.length);
        // Must be sorted by createdAt descending
        for (let i = 1; i < result.ugs!.length; i++) {
          expect(result.ugs![i - 1].createdAt >= result.ugs![i].createdAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('filtering by "inactive" returns only inactive UGs in descending createdAt order', async () => {
    await fc.assert(
      fc.asyncProperty(mixedUGSetArb, async ({ inactiveUGs }) => {
        const sortedInactive = [...inactiveUGs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const mockClient = {
          send: vi.fn().mockResolvedValueOnce({ Items: sortedInactive }),
        } as any;

        const result = await listUGs({ status: 'inactive' }, mockClient, UGS_TABLE);

        expect(result.success).toBe(true);
        expect(result.ugs).toBeDefined();
        // All returned UGs must have status "inactive"
        for (const ug of result.ugs!) {
          expect(ug.status).toBe('inactive');
        }
        // Count must match
        expect(result.ugs!.length).toBe(inactiveUGs.length);
        // Must be sorted by createdAt descending
        for (let i = 1; i < result.ugs!.length; i++) {
          expect(result.ugs![i - 1].createdAt >= result.ugs![i].createdAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('filtering by "all" returns all UGs in descending createdAt order', async () => {
    await fc.assert(
      fc.asyncProperty(mixedUGSetArb, async ({ allUGs, activeUGs, inactiveUGs }) => {
        // For "all", listUGs uses ScanCommand and sorts in application layer.
        // We return items in random order to verify the sort logic.
        const mockClient = {
          send: vi.fn().mockResolvedValueOnce({ Items: [...allUGs] }),
        } as any;

        const result = await listUGs({ status: 'all' }, mockClient, UGS_TABLE);

        expect(result.success).toBe(true);
        expect(result.ugs).toBeDefined();
        // Count must match total
        expect(result.ugs!.length).toBe(allUGs.length);
        // Must contain all active and inactive UGs
        const activeCount = result.ugs!.filter(ug => ug.status === 'active').length;
        const inactiveCount = result.ugs!.filter(ug => ug.status === 'inactive').length;
        expect(activeCount).toBe(activeUGs.length);
        expect(inactiveCount).toBe(inactiveUGs.length);
        // Must be sorted by createdAt descending
        for (let i = 1; i < result.ugs!.length; i++) {
          expect(result.ugs![i - 1].createdAt >= result.ugs![i].createdAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('default status (undefined) behaves the same as "all"', async () => {
    await fc.assert(
      fc.asyncProperty(mixedUGSetArb, async ({ allUGs }) => {
        const mockClient = {
          send: vi.fn().mockResolvedValueOnce({ Items: [...allUGs] }),
        } as any;

        const result = await listUGs({}, mockClient, UGS_TABLE);

        expect(result.success).toBe(true);
        expect(result.ugs).toBeDefined();
        expect(result.ugs!.length).toBe(allUGs.length);
        // Must be sorted by createdAt descending
        for (let i = 1; i < result.ugs!.length; i++) {
          expect(result.ugs![i - 1].createdAt >= result.ugs![i].createdAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 1: Leader assignment validates role and updates fields correctly
// Feature: ug-leader-assignment, Property 1: Leader assignment validates role and updates fields correctly
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7**
// ============================================================

/** Arbitrary for a UG ID (non-empty alphanumeric-like string) */
const ugIdArb = fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) });

/** Arbitrary for a user ID */
const leaderUserIdArb = fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) });

/** Arbitrary for a nickname (non-empty string) */
const nicknameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);

/** Arbitrary for a UG name */
const ugNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50);

/** Arbitrary for non-Admin role sets (roles that do NOT include 'Admin') */
const nonAdminRolesArb = fc.subarray(['Member', 'Speaker', 'Volunteer', 'UserGroupLeader'] as const, { minLength: 1 });

/** Arbitrary for Admin role sets (roles that include 'Admin') */
const adminRolesArb = fc.subarray(['Admin', 'Speaker', 'Volunteer', 'UserGroupLeader'] as const, { minLength: 1 }).filter(roles => roles.includes('Admin'));

describe('Feature: ug-leader-assignment, Property 1: Leader assignment validates role and updates fields correctly', () => {
  const UGS_TBL = 'UGs';
  const USERS_TBL = 'Users';

  it('UG exists + user exists + user has Admin role → success with correct leaderId/leaderNickname/updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(ugIdArb, ugNameArb, leaderUserIdArb, nicknameArb, adminRolesArb, async (ugId, ugName, leaderId, nickname, roles) => {
        const updateCalls: any[] = [];

        const mockClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const cmdName = command.constructor.name;
            if (cmdName === 'GetCommand') {
              const tableName = command.input.TableName;
              if (tableName === UGS_TBL) {
                // UG exists
                return Promise.resolve({
                  Item: { ugId, name: ugName, status: 'active', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
                });
              }
              if (tableName === USERS_TBL) {
                // User exists with Admin role
                return Promise.resolve({
                  Item: { userId: leaderId, nickname, roles },
                });
              }
            }
            if (cmdName === 'UpdateCommand') {
              updateCalls.push(command.input);
              return Promise.resolve({});
            }
            return Promise.resolve({});
          }),
        } as any;

        const result = await assignLeader({ ugId, leaderId }, mockClient, UGS_TBL, USERS_TBL);

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();

        // Verify UpdateCommand was called with correct values
        expect(updateCalls).toHaveLength(1);
        const update = updateCalls[0];
        expect(update.Key).toEqual({ ugId });
        expect(update.ExpressionAttributeValues[':leaderId']).toBe(leaderId);
        expect(update.ExpressionAttributeValues[':leaderNickname']).toBe(nickname);
        // updatedAt should be a valid ISO timestamp
        const updatedAt = update.ExpressionAttributeValues[':now'];
        expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
      }),
      { numRuns: 100 },
    );
  });

  it('UG does not exist → UG_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(ugIdArb, leaderUserIdArb, async (ugId, leaderId) => {
        const mockClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const cmdName = command.constructor.name;
            if (cmdName === 'GetCommand') {
              // UG not found
              return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
          }),
        } as any;

        const result = await assignLeader({ ugId, leaderId }, mockClient, UGS_TBL, USERS_TBL);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('UG_NOT_FOUND');
        // Only one GetCommand should have been called (for UG check)
        expect(mockClient.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  it('User does not exist → USER_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(ugIdArb, ugNameArb, leaderUserIdArb, async (ugId, ugName, leaderId) => {
        let getCallCount = 0;

        const mockClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const cmdName = command.constructor.name;
            if (cmdName === 'GetCommand') {
              getCallCount++;
              if (getCallCount === 1) {
                // UG exists
                return Promise.resolve({
                  Item: { ugId, name: ugName, status: 'active' },
                });
              }
              // User not found
              return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
          }),
        } as any;

        const result = await assignLeader({ ugId, leaderId }, mockClient, UGS_TBL, USERS_TBL);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('USER_NOT_FOUND');
        // Two GetCommands: UG check + User check, no UpdateCommand
        expect(mockClient.send).toHaveBeenCalledTimes(2);
      }),
      { numRuns: 100 },
    );
  });

  it('User without Admin role → INVALID_LEADER_ROLE', async () => {
    await fc.assert(
      fc.asyncProperty(ugIdArb, ugNameArb, leaderUserIdArb, nicknameArb, nonAdminRolesArb, async (ugId, ugName, leaderId, nickname, roles) => {
        let getCallCount = 0;

        const mockClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const cmdName = command.constructor.name;
            if (cmdName === 'GetCommand') {
              getCallCount++;
              if (getCallCount === 1) {
                // UG exists
                return Promise.resolve({
                  Item: { ugId, name: ugName, status: 'active' },
                });
              }
              // User exists but without Admin role
              return Promise.resolve({
                Item: { userId: leaderId, nickname, roles },
              });
            }
            return Promise.resolve({});
          }),
        } as any;

        const result = await assignLeader({ ugId, leaderId }, mockClient, UGS_TBL, USERS_TBL);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_LEADER_ROLE');
        // Two GetCommands: UG check + User check, no UpdateCommand
        expect(mockClient.send).toHaveBeenCalledTimes(2);
      }),
      { numRuns: 100 },
    );
  });

  it('Same Admin can be assigned to multiple UGs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(ugIdArb, { minLength: 2, maxLength: 5 }),
        leaderUserIdArb,
        nicknameArb,
        async (ugIds, leaderId, nickname) => {
          // Ensure unique UG IDs
          const uniqueUgIds = [...new Set(ugIds)];
          if (uniqueUgIds.length < 2) return;

          for (const ugId of uniqueUgIds) {
            const mockClient = {
              send: vi.fn().mockImplementation((command: any) => {
                const cmdName = command.constructor.name;
                if (cmdName === 'GetCommand') {
                  const tableName = command.input.TableName;
                  if (tableName === UGS_TBL) {
                    return Promise.resolve({
                      Item: { ugId, name: 'UG-' + ugId, status: 'active' },
                    });
                  }
                  if (tableName === USERS_TBL) {
                    return Promise.resolve({
                      Item: { userId: leaderId, nickname, roles: ['Admin'] },
                    });
                  }
                }
                if (cmdName === 'UpdateCommand') {
                  return Promise.resolve({});
                }
                return Promise.resolve({});
              }),
            } as any;

            const result = await assignLeader({ ugId, leaderId }, mockClient, UGS_TBL, USERS_TBL);
            expect(result.success).toBe(true);

            // Verify the UpdateCommand wrote the same leaderId for each UG
            const updateCall = mockClient.send.mock.calls.find(
              (call: any[]) => call[0].constructor.name === 'UpdateCommand',
            );
            expect(updateCall).toBeDefined();
            expect(updateCall![0].input.ExpressionAttributeValues[':leaderId']).toBe(leaderId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 2: Leader removal is idempotent and clears fields
// Feature: ug-leader-assignment, Property 2: Leader removal is idempotent and clears fields
// **Validates: Requirements 3.1, 3.2, 3.3**
// ============================================================

import { removeLeader } from './ug';

describe('Feature: ug-leader-assignment, Property 2: Leader removal is idempotent and clears fields', () => {
  const UGS_TBL = 'UGs';

  it('after removal, UpdateCommand uses REMOVE expression to clear leaderId/leaderNickname and updates updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        ugIdArb,
        ugNameArb,
        leaderUserIdArb,
        nicknameArb,
        async (ugId, ugName, leaderId, nickname) => {
          const updateCalls: any[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const cmdName = command.constructor.name;
              if (cmdName === 'GetCommand') {
                // UG exists with a leader assigned
                return Promise.resolve({
                  Item: {
                    ugId,
                    name: ugName,
                    status: 'active',
                    leaderId,
                    leaderNickname: nickname,
                    createdAt: '2024-01-01T00:00:00.000Z',
                    updatedAt: '2024-01-01T00:00:00.000Z',
                  },
                });
              }
              if (cmdName === 'UpdateCommand') {
                updateCalls.push(command.input);
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const result = await removeLeader(ugId, mockClient, UGS_TBL);

          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();

          // Verify UpdateCommand was called
          expect(updateCalls).toHaveLength(1);
          const update = updateCalls[0];

          // Verify REMOVE expression clears leaderId and leaderNickname
          expect(update.UpdateExpression).toContain('REMOVE');
          expect(update.UpdateExpression).toContain('leaderId');
          expect(update.UpdateExpression).toContain('leaderNickname');

          // Verify updatedAt is set and is a valid ISO timestamp
          const updatedAt = update.ExpressionAttributeValues[':now'];
          expect(updatedAt).toBeDefined();
          expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
          // updatedAt should be at or after the original
          expect(updatedAt >= '2024-01-01T00:00:00.000Z').toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('calling removeLeader twice on the same UG produces the same result (idempotent)', async () => {
    await fc.assert(
      fc.asyncProperty(
        ugIdArb,
        ugNameArb,
        async (ugId, ugName) => {
          const updateCalls: any[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const cmdName = command.constructor.name;
              if (cmdName === 'GetCommand') {
                // UG exists (no leader — simulates after first removal)
                return Promise.resolve({
                  Item: {
                    ugId,
                    name: ugName,
                    status: 'active',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    updatedAt: '2024-06-01T00:00:00.000Z',
                  },
                });
              }
              if (cmdName === 'UpdateCommand') {
                updateCalls.push(command.input);
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          // First removal
          const result1 = await removeLeader(ugId, mockClient, UGS_TBL);
          expect(result1.success).toBe(true);
          expect(result1.error).toBeUndefined();

          // Second removal (idempotent — UG has no leader)
          const result2 = await removeLeader(ugId, mockClient, UGS_TBL);
          expect(result2.success).toBe(true);
          expect(result2.error).toBeUndefined();

          // Both calls should have issued UpdateCommands with REMOVE expression
          expect(updateCalls).toHaveLength(2);
          for (const update of updateCalls) {
            expect(update.UpdateExpression).toContain('REMOVE');
            expect(update.UpdateExpression).toContain('leaderId');
            expect(update.UpdateExpression).toContain('leaderNickname');
            // updatedAt should be a valid ISO timestamp
            const updatedAt = update.ExpressionAttributeValues[':now'];
            expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
          }

          // Both results are identical in structure (both success)
          expect(result1.success).toBe(result2.success);
          expect(result1.error).toBe(result2.error);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('removeLeader on non-existent UG returns UG_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(ugIdArb, async (ugId) => {
        const mockClient = {
          send: vi.fn().mockImplementation((command: any) => {
            const cmdName = command.constructor.name;
            if (cmdName === 'GetCommand') {
              // UG does not exist
              return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
          }),
        } as any;

        const result = await removeLeader(ugId, mockClient, UGS_TBL);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('UG_NOT_FOUND');
        // Only one GetCommand should have been called, no UpdateCommand
        expect(mockClient.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 3: getMyUGs returns exactly the active UGs where leaderId matches
// Feature: ug-leader-assignment, Property 3: getMyUGs returns exactly the active UGs where leaderId matches
// **Validates: Requirements 6.1, 6.2, 8.1, 8.2, 8.3**
// ============================================================

import { getMyUGs } from './ug';

/** Arbitrary for generating a UG record with optional leader and status */
const ugRecordWithLeaderArb = fc.record({
  ugId: fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
  name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
  status: fc.constantFrom('active' as const, 'inactive' as const),
  leaderId: fc.option(
    fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
    { nil: undefined },
  ),
  leaderNickname: fc.option(
    fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    { nil: undefined },
  ),
  createdAt: isoDateArb,
  updatedAt: isoDateArb,
});

describe('Feature: ug-leader-assignment, Property 3: getMyUGs returns exactly the active UGs where leaderId matches', () => {
  const UGS_TBL = 'UGs';

  it('returns exactly those UGs where leaderId matches the given userId AND status is active', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a target userId to query
        fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
        // Generate a set of UG records with mixed leaderIds and statuses
        fc.array(ugRecordWithLeaderArb, { minLength: 0, maxLength: 20 }),
        async (userId, allUGs) => {
          // Compute expected results: leaderId matches userId AND status is active
          const expected = allUGs.filter(
            ug => ug.leaderId === userId && ug.status === 'active',
          );

          // The mock DynamoDB client simulates the ScanCommand's FilterExpression behavior:
          // it returns only items where leaderId = userId AND status = 'active'
          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const cmdName = command.constructor.name;
              if (cmdName === 'ScanCommand') {
                // Simulate DynamoDB FilterExpression: leaderId = :userId AND #status = :active
                const filtered = allUGs.filter(
                  ug => ug.leaderId === userId && ug.status === 'active',
                );
                return Promise.resolve({ Items: filtered });
              }
              return Promise.resolve({});
            }),
          } as any;

          const result = await getMyUGs(userId, mockClient, UGS_TBL);

          expect(result.success).toBe(true);
          expect(result.ugs).toBeDefined();

          // Returned results should match exactly the expected set
          expect(result.ugs!.length).toBe(expected.length);

          // No matching UG is excluded
          for (const exp of expected) {
            const found = result.ugs!.some(ug => ug.ugId === exp.ugId);
            expect(found).toBe(true);
          }

          // No non-matching UG is included
          for (const ug of result.ugs!) {
            expect(ug.leaderId).toBe(userId);
            expect(ug.status).toBe('active');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns empty array when no UG has leaderId matching the given userId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
        // Generate UGs where none have the target userId as leaderId
        fc.array(ugRecordWithLeaderArb, { minLength: 1, maxLength: 10 }),
        async (userId, allUGs) => {
          // Ensure none of the UGs have the target userId as leaderId
          const ugsWithoutMatch = allUGs.map(ug => ({
            ...ug,
            leaderId: ug.leaderId === userId ? undefined : ug.leaderId,
          }));

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const cmdName = command.constructor.name;
              if (cmdName === 'ScanCommand') {
                // No matches since we ensured no UG has the target userId
                const filtered = ugsWithoutMatch.filter(
                  ug => ug.leaderId === userId && ug.status === 'active',
                );
                return Promise.resolve({ Items: filtered });
              }
              return Promise.resolve({});
            }),
          } as any;

          const result = await getMyUGs(userId, mockClient, UGS_TBL);

          expect(result.success).toBe(true);
          expect(result.ugs).toBeDefined();
          expect(result.ugs!.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('excludes inactive UGs even when leaderId matches', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 26, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
        // Generate UGs that all have the target userId as leaderId but are inactive
        fc.array(
          ugRecordWithLeaderArb.map(ug => ({ ...ug, status: 'inactive' as const })),
          { minLength: 1, maxLength: 10 },
        ),
        async (userId, inactiveUGs) => {
          // Set all UGs to have the target userId as leaderId
          const ugsWithLeader = inactiveUGs.map(ug => ({
            ...ug,
            leaderId: userId,
          }));

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const cmdName = command.constructor.name;
              if (cmdName === 'ScanCommand') {
                // DynamoDB filter: leaderId = userId AND status = 'active'
                // All UGs are inactive, so nothing matches
                const filtered = ugsWithLeader.filter(
                  ug => ug.leaderId === userId && ug.status === 'active',
                );
                return Promise.resolve({ Items: filtered });
              }
              return Promise.resolve({});
            }),
          } as any;

          const result = await getMyUGs(userId, mockClient, UGS_TBL);

          expect(result.success).toBe(true);
          expect(result.ugs).toBeDefined();
          expect(result.ugs!.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
