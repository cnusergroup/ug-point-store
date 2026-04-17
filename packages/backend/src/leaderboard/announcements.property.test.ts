import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { isBatchRecord, isReservationRecord, getAnnouncements } from './announcements';

// ============================================================
// Constants
// ============================================================

const BATCH_PREFIX = '批量发放:';
const RESERVATION_PREFIX = '预约审批:';

const TARGET_ROLES = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for an ISO date string (used as createdAt) */
const isoDateArb = fc
  .integer({ min: new Date('2023-01-01').getTime(), max: new Date('2025-12-31').getTime() })
  .map(ts => new Date(ts).toISOString());

/** Arbitrary for a batch source string */
const batchSourceArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => `${BATCH_PREFIX}${s}`);

/** Arbitrary for a reservation source string */
const reservationSourceArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => `${RESERVATION_PREFIX}${s}`);

/** Arbitrary for a generic (non-batch, non-reservation) source string */
const genericSourceArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(s => !s.startsWith(BATCH_PREFIX) && !s.startsWith(RESERVATION_PREFIX));

/** Arbitrary for any source string */
const anySourceArb = fc.oneof(batchSourceArb, reservationSourceArb, genericSourceArb);

/** Arbitrary for a target role */
const targetRoleArb = fc.constantFrom(...TARGET_ROLES);

/** Arbitrary for a single PointsRecord with type="earn" */
const earnRecordArb = fc.record({
  recordId: fc.uuid(),
  userId: fc.uuid(),
  type: fc.constant('earn' as const),
  amount: fc.integer({ min: 1, max: 10000 }),
  source: anySourceArb,
  createdAt: isoDateArb,
  targetRole: targetRoleArb.map(r => r as string),
  activityId: fc.uuid(),
  activityUG: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  activityDate: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  activityTopic: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  activityType: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

/** Arbitrary for a single PointsRecord with type="spend" */
const spendRecordArb = fc.record({
  recordId: fc.uuid(),
  userId: fc.uuid(),
  type: fc.constant('spend' as const),
  amount: fc.integer({ min: 1, max: 10000 }),
  source: fc.string({ minLength: 1, maxLength: 30 }),
  createdAt: isoDateArb,
  targetRole: targetRoleArb.map(r => r as string),
  activityId: fc.uuid(),
});

/** Arbitrary for a mixed list of earn and spend records */
const mixedRecordsArb = fc.array(
  fc.oneof(earnRecordArb, spendRecordArb),
  { minLength: 1, maxLength: 40 },
);

// ============================================================
// Property 5: Announcement query returns only earn records, sorted by time, with correct fields
// Feature: points-leaderboard, Property 5: Announcement query returns only earn records, sorted by time, with correct fields
// Validates: Requirements 6.1, 6.2, 6.4, 6.5, 11.4
// ============================================================

describe('Feature: points-leaderboard, Property 5: Announcement query returns only earn records, sorted by time, with correct fields', () => {
  // ----------------------------------------------------------
  // Pure function tests: isBatchRecord
  // ----------------------------------------------------------
  describe('isBatchRecord', () => {
    it('returns true for any source starting with "批量发放:"', () => {
      fc.assert(
        fc.property(batchSourceArb, (source) => {
          expect(isBatchRecord(source)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('returns false for sources not starting with "批量发放:"', () => {
      fc.assert(
        fc.property(
          fc.oneof(reservationSourceArb, genericSourceArb),
          (source) => {
            expect(isBatchRecord(source)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ----------------------------------------------------------
  // Pure function tests: isReservationRecord
  // ----------------------------------------------------------
  describe('isReservationRecord', () => {
    it('returns true for any source starting with "预约审批:"', () => {
      fc.assert(
        fc.property(reservationSourceArb, (source) => {
          expect(isReservationRecord(source)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('returns false for sources not starting with "预约审批:"', () => {
      fc.assert(
        fc.property(
          fc.oneof(batchSourceArb, genericSourceArb),
          (source) => {
            expect(isReservationRecord(source)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ----------------------------------------------------------
  // getAnnouncements with mock DynamoDB client
  // ----------------------------------------------------------
  describe('getAnnouncements filters, sorts, and returns correct fields', () => {
    it('only returns type="earn" records, sorted by createdAt descending, with all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(mixedRecordsArb, async (records) => {
          // Separate earn records and sort by createdAt descending (simulating GSI behavior)
          const earnRecords = records
            .filter(r => r.type === 'earn')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          // Build user nickname map from unique userIds
          const userNicknameMap = new Map<string, string>();
          for (const r of earnRecords) {
            if (!userNicknameMap.has(r.userId)) {
              userNicknameMap.set(r.userId, `User_${r.userId.slice(0, 6)}`);
            }
          }

          // Build distributor nickname map for batch records
          const batchRecords = earnRecords.filter(r => isBatchRecord(r.source));
          const distributorMap = new Map<string, string>();
          for (const r of batchRecords) {
            if (r.activityId && !distributorMap.has(r.activityId)) {
              distributorMap.set(r.activityId, `Distributor_${r.activityId.slice(0, 6)}`);
            }
          }

          // Mock DynamoDB client
          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const commandName = command.constructor.name;

              if (commandName === 'QueryCommand') {
                const tableName = command.input?.TableName;
                if (tableName === 'PointsRecords') {
                  // GSI query returns only earn records sorted by createdAt desc
                  return Promise.resolve({
                    Items: earnRecords,
                    LastEvaluatedKey: undefined,
                  });
                }
                if (tableName === 'BatchDistributions') {
                  // Return distributor info
                  const distItems = Array.from(distributorMap.entries()).map(
                    ([activityId, distributorNickname]) => ({
                      activityId,
                      distributorNickname,
                    }),
                  );
                  return Promise.resolve({
                    Items: distItems,
                    LastEvaluatedKey: undefined,
                  });
                }
              }

              if (commandName === 'BatchGetCommand') {
                // Return user nicknames
                const keys = command.input?.RequestItems?.['Users']?.Keys ?? [];
                const items = keys.map((key: any) => ({
                  userId: key.userId,
                  nickname: userNicknameMap.get(key.userId) ?? '',
                }));
                return Promise.resolve({
                  Responses: { Users: items },
                });
              }

              return Promise.resolve({ Items: [], Responses: {} });
            }),
          } as any;

          const result = await getAnnouncements(
            { limit: 50 },
            mockClient,
            {
              pointsRecordsTable: 'PointsRecords',
              usersTable: 'Users',
              batchDistributionsTable: 'BatchDistributions',
            },
          );

          expect(result.success).toBe(true);
          expect(result.items).toBeDefined();
          const items = result.items!;

          // 1. Only earn records are returned (count matches)
          expect(items.length).toBe(earnRecords.length);

          // 2. Results are sorted by createdAt descending
          for (let i = 1; i < items.length; i++) {
            expect(items[i - 1].createdAt.localeCompare(items[i].createdAt)).toBeGreaterThanOrEqual(0);
          }

          // 3. Each item has all required fields
          for (const item of items) {
            expect(typeof item.recordId).toBe('string');
            expect(item.recordId.length).toBeGreaterThan(0);

            expect(typeof item.recipientNickname).toBe('string');

            expect(typeof item.amount).toBe('number');
            expect(item.amount).toBeGreaterThan(0);

            expect(typeof item.source).toBe('string');
            expect(item.source.length).toBeGreaterThan(0);

            expect(typeof item.createdAt).toBe('string');
            expect(item.createdAt.length).toBeGreaterThan(0);

            expect(typeof item.targetRole).toBe('string');
            expect(item.targetRole.length).toBeGreaterThan(0);
          }

          // 4. Batch distribution records have distributorNickname present
          for (const item of items) {
            if (isBatchRecord(item.source)) {
              expect(item.distributorNickname).toBeDefined();
              expect(typeof item.distributorNickname).toBe('string');
            }
          }

          // 5. Non-batch records do not have distributorNickname set
          for (const item of items) {
            if (!isBatchRecord(item.source)) {
              expect(item.distributorNickname).toBeUndefined();
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
