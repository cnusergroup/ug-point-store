import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  isBatchRecord,
  isReservationRecord,
  isAdjustmentRecord,
  isDeletionAdjustmentRecord,
  getAnnouncements,
} from './announcements';

// ============================================================
// Constants
// ============================================================

const BATCH_PREFIX = '批量发放:';
const RESERVATION_PREFIX = '预约审批:';
const ADJUST_PREFIX = '积分调整:';
const DELETION_ADJUST_PREFIX = '发放删除:';
const SKILL_RELEASE_PREFIX = '技能释放:';
const SKILL_RELEASE_DELETION_PREFIX = '技能释放(删除):';
const SKILL_ASSIGN_PREFIX = '技能指派:';

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

/** Arbitrary for a generic (non-batch, non-reservation, non-adjust) source string */
const genericSourceArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(s =>
    !s.startsWith(BATCH_PREFIX) &&
    !s.startsWith(RESERVATION_PREFIX) &&
    !s.startsWith(ADJUST_PREFIX) &&
    !s.startsWith(DELETION_ADJUST_PREFIX) &&
    !s.startsWith(SKILL_RELEASE_PREFIX) &&
    !s.startsWith(SKILL_RELEASE_DELETION_PREFIX) &&
    !s.startsWith(SKILL_ASSIGN_PREFIX),
  );

/** Arbitrary for a non-deletion adjust source string (distributor lookup should succeed) */
const nonDeletionAdjustSourceArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }).map(s => `${ADJUST_PREFIX}${s}`),
  fc.string({ minLength: 1, maxLength: 20 }).map(s => `${SKILL_RELEASE_PREFIX}${s}`),
  fc.string({ minLength: 1, maxLength: 20 }).map(s => `${SKILL_ASSIGN_PREFIX}${s}`),
);

/** Arbitrary for a deletion adjust source string (no distributor can be resolved) */
const deletionAdjustSourceArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }).map(s => `${DELETION_ADJUST_PREFIX}${s}`),
  fc.string({ minLength: 1, maxLength: 20 }).map(s => `${SKILL_RELEASE_DELETION_PREFIX}${s}`),
);

/** Arbitrary for any adjust source string */
const anyAdjustSourceArb = fc.oneof(nonDeletionAdjustSourceArb, deletionAdjustSourceArb);

/** Arbitrary for any earn-eligible source string */
const anyEarnSourceArb = fc.oneof(batchSourceArb, reservationSourceArb, genericSourceArb);

/** Arbitrary for a target role */
const targetRoleArb = fc.constantFrom(...TARGET_ROLES);

/** Arbitrary for a single PointsRecord with type="earn" */
const earnRecordArb = fc.record({
  recordId: fc.uuid(),
  userId: fc.uuid(),
  type: fc.constant('earn' as const),
  amount: fc.integer({ min: 1, max: 10000 }),
  source: anyEarnSourceArb,
  createdAt: isoDateArb,
  targetRole: targetRoleArb.map(r => r as string),
  activityId: fc.uuid(),
  activityUG: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  activityDate: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  activityTopic: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  activityType: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

/** Arbitrary for a single PointsRecord with type="adjust" (mix of deletion / non-deletion) */
const adjustRecordArb = fc.record({
  recordId: fc.uuid(),
  userId: fc.uuid(),
  type: fc.constant('adjust' as const),
  // amount can be positive (added recipient / skill assign) or negative (removed/reversal)
  amount: fc.integer({ min: -10000, max: 10000 }).filter(a => a !== 0),
  source: anyAdjustSourceArb,
  createdAt: isoDateArb,
  targetRole: targetRoleArb.map(r => r as string),
  activityId: fc.uuid(),
  activityUG: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  activityDate: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  activityTopic: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  distributionId: fc.uuid(),
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

/** Arbitrary for a mixed list of earn, adjust, AND spend records */
const mixedEarnAdjustSpendRecordsArb = fc.array(
  fc.oneof(earnRecordArb, adjustRecordArb, spendRecordArb),
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
  // Pure function tests: isAdjustmentRecord / isDeletionAdjustmentRecord
  // ----------------------------------------------------------
  describe('isAdjustmentRecord', () => {
    it('returns true for any of the 5 adjust prefixes', () => {
      fc.assert(
        fc.property(anyAdjustSourceArb, (source) => {
          expect(isAdjustmentRecord(source)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('returns false for sources not starting with an adjust prefix', () => {
      fc.assert(
        fc.property(
          fc.oneof(batchSourceArb, reservationSourceArb, genericSourceArb),
          (source) => {
            expect(isAdjustmentRecord(source)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('isDeletionAdjustmentRecord', () => {
    it('returns true only for deletion-related adjust prefixes', () => {
      fc.assert(
        fc.property(deletionAdjustSourceArb, (source) => {
          expect(isDeletionAdjustmentRecord(source)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('returns false for non-deletion adjust prefixes and other sources', () => {
      fc.assert(
        fc.property(
          fc.oneof(nonDeletionAdjustSourceArb, batchSourceArb, reservationSourceArb, genericSourceArb),
          (source) => {
            expect(isDeletionAdjustmentRecord(source)).toBe(false);
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
                  const queriedType = command.input?.ExpressionAttributeValues?.[':type'];
                  if (queriedType === 'adjust') {
                    // No adjust records in this scenario
                    return Promise.resolve({ Items: [], LastEvaluatedKey: undefined });
                  }
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

  // ----------------------------------------------------------
  // getAnnouncements: merged earn + adjust feed (never spend), sorted, paginated correctly
  // ----------------------------------------------------------
  describe('getAnnouncements merges earn and adjust records, excludes spend, sorted correctly', () => {
    it('the merged, sorted result only ever contains earn and adjust types, correctly sorted, with correct distributorNickname handling', async () => {
      await fc.assert(
        fc.asyncProperty(mixedEarnAdjustSpendRecordsArb, async (records) => {
          const earnRecords = records.filter(r => r.type === 'earn');
          const adjustRecords = records.filter(r => r.type === 'adjust');
          // spendRecords exist in `records` but must never surface in the feed

          const sortedEarn = [...earnRecords].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const sortedAdjust = [...adjustRecords].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          // Build user nickname map from unique userIds across earn + adjust
          const userNicknameMap = new Map<string, string>();
          for (const r of [...sortedEarn, ...sortedAdjust]) {
            if (!userNicknameMap.has(r.userId)) {
              userNicknameMap.set(r.userId, `User_${r.userId.slice(0, 6)}`);
            }
          }

          // Distributor nickname resolves for batch earn records AND non-deletion adjust records
          const distributorMap = new Map<string, string>();
          for (const r of sortedEarn) {
            if (isBatchRecord(r.source) && r.activityId && !distributorMap.has(r.activityId)) {
              distributorMap.set(r.activityId, `Distributor_${r.activityId.slice(0, 6)}`);
            }
          }
          for (const r of sortedAdjust) {
            if (!isDeletionAdjustmentRecord(r.source) && r.activityId && !distributorMap.has(r.activityId)) {
              distributorMap.set(r.activityId, `Distributor_${r.activityId.slice(0, 6)}`);
            }
          }

          const mockClient = {
            send: vi.fn().mockImplementation((command: any) => {
              const commandName = command.constructor.name;

              if (commandName === 'QueryCommand') {
                const tableName = command.input?.TableName;
                if (tableName === 'PointsRecords') {
                  const queriedType = command.input?.ExpressionAttributeValues?.[':type'];
                  if (queriedType === 'earn') {
                    return Promise.resolve({ Items: sortedEarn, LastEvaluatedKey: undefined });
                  }
                  if (queriedType === 'adjust') {
                    return Promise.resolve({ Items: sortedAdjust, LastEvaluatedKey: undefined });
                  }
                  return Promise.resolve({ Items: [], LastEvaluatedKey: undefined });
                }
                if (tableName === 'BatchDistributions') {
                  const distItems = Array.from(distributorMap.entries()).map(
                    ([activityId, distributorNickname]) => ({ activityId, distributorNickname }),
                  );
                  return Promise.resolve({ Items: distItems, LastEvaluatedKey: undefined });
                }
              }

              if (commandName === 'BatchGetCommand') {
                const keys = command.input?.RequestItems?.['Users']?.Keys ?? [];
                const items = keys.map((key: any) => ({
                  userId: key.userId,
                  nickname: userNicknameMap.get(key.userId) ?? '',
                }));
                return Promise.resolve({ Responses: { Users: items } });
              }

              return Promise.resolve({ Items: [], Responses: {} });
            }),
          } as any;

          const result = await getAnnouncements(
            { limit: 80 },
            mockClient,
            {
              pointsRecordsTable: 'PointsRecords',
              usersTable: 'Users',
              batchDistributionsTable: 'BatchDistributions',
            },
          );

          expect(result.success).toBe(true);
          const items = result.items!;

          // 1. Count matches earn + adjust only (spend excluded)
          expect(items.length).toBe(sortedEarn.length + sortedAdjust.length);

          // 2. Every returned source corresponds to an earn or adjust record — never a bare spend source
          //    (we verify by checking the recordId set matches earn+adjust recordIds exactly)
          const expectedRecordIds = new Set([...sortedEarn, ...sortedAdjust].map(r => r.recordId));
          for (const item of items) {
            expect(expectedRecordIds.has(item.recordId)).toBe(true);
          }
          expect(items.length).toBe(expectedRecordIds.size);

          // 3. Sorted by createdAt descending across the merged set
          for (let i = 1; i < items.length; i++) {
            expect(items[i - 1].createdAt.localeCompare(items[i].createdAt)).toBeGreaterThanOrEqual(0);
          }

          // 4. distributorNickname present (non-empty string, defined) for batch earn + non-deletion adjust records
          for (const item of items) {
            const isNonDeletionAdjust = isAdjustmentRecord(item.source) && !isDeletionAdjustmentRecord(item.source);
            if (isBatchRecord(item.source) || isNonDeletionAdjust) {
              expect(item.distributorNickname).toBeDefined();
              expect(typeof item.distributorNickname).toBe('string');
            }
          }

          // 5. distributorNickname absent/empty for deletion adjust records
          for (const item of items) {
            if (isDeletionAdjustmentRecord(item.source)) {
              expect(item.distributorNickname ?? '').toBe('');
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
