import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { REGULAR_ROLES } from '@points-mall/shared';
import { getRanking } from './ranking';
import { getAnnouncements, isBatchRecord } from './announcements';

// ============================================================
// Feature: points-leaderboard, Property 3: Paginating through all pages yields the complete sorted dataset
// Validates: Requirements 3.5, 6.3, 10.5, 11.5
// ============================================================

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a non-empty subset of regular roles */
const regularRolesSubsetArb = fc.subarray(
  ['Speaker', 'UserGroupLeader', 'Volunteer'] as string[],
  { minLength: 1 },
);

/** Arbitrary for an eligible user with earnTotal (simulating Users table with earnTotal-index GSI) */
const eligibleUserArb = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }),
  roles: regularRolesSubsetArb,
  earnTotal: fc.integer({ min: 0, max: 100000 }),
  pk: fc.constant('ALL'),
});

/** Arbitrary for a list of eligible users with unique userIds */
const uniqueEligibleUsersArb = fc
  .array(eligibleUserArb, { minLength: 1, maxLength: 40 })
  .map(users => {
    const seen = new Set<string>();
    return users.filter(u => {
      if (seen.has(u.userId)) return false;
      seen.add(u.userId);
      return true;
    });
  })
  .filter(users => users.length > 0);

/** Arbitrary for a valid page size (1~50) */
const pageSizeArb = fc.integer({ min: 1, max: 15 });

/** Arbitrary for an ISO date string */
const isoDateArb = fc
  .integer({ min: new Date('2023-01-01').getTime(), max: new Date('2025-12-31').getTime() })
  .map(ts => new Date(ts).toISOString());

const BATCH_PREFIX = '批量发放:';
const RESERVATION_PREFIX = '预约审批:';

const batchSourceArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => `${BATCH_PREFIX}${s}`);
const reservationSourceArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => `${RESERVATION_PREFIX}${s}`);
const genericSourceArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(s => !s.startsWith(BATCH_PREFIX) && !s.startsWith(RESERVATION_PREFIX));
const anySourceArb = fc.oneof(batchSourceArb, reservationSourceArb, genericSourceArb);

const targetRoleArb = fc.constantFrom('Speaker', 'UserGroupLeader', 'Volunteer');

/** Arbitrary for a single earn record */
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

/** Arbitrary for a list of earn records with unique recordIds */
const uniqueEarnRecordsArb = fc
  .array(earnRecordArb, { minLength: 1, maxLength: 40 })
  .map(records => {
    const seen = new Set<string>();
    return records.filter(r => {
      if (seen.has(r.recordId)) return false;
      seen.add(r.recordId);
      return true;
    });
  })
  .filter(records => records.length > 0);

// ============================================================
// Mock DynamoDB client helpers
// ============================================================

/**
 * Creates a mock DynamoDB client that simulates paginated queries for the
 * Users table earnTotal-index GSI. Data is pre-sorted by earnTotal descending.
 * The mock respects Limit and ExclusiveStartKey to return pages.
 */
function createPaginatedRankingMockClient(
  sortedUsers: Array<Record<string, any>>,
) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'QueryCommand') {
        const limit = command.input?.Limit ?? sortedUsers.length;
        const exclusiveStartKey = command.input?.ExclusiveStartKey;

        let startIndex = 0;
        if (exclusiveStartKey) {
          // Find the position after the ExclusiveStartKey
          const startUserId = exclusiveStartKey.userId;
          const idx = sortedUsers.findIndex(u => u.userId === startUserId);
          startIndex = idx >= 0 ? idx + 1 : sortedUsers.length;
        }

        const pageItems = sortedUsers.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < sortedUsers.length;

        return Promise.resolve({
          Items: pageItems,
          LastEvaluatedKey: hasMore
            ? {
                pk: 'ALL',
                earnTotal: sortedUsers[startIndex + limit - 1].earnTotal,
                userId: sortedUsers[startIndex + limit - 1].userId,
              }
            : undefined,
        });
      }
      return Promise.resolve({ Items: [] });
    }),
  } as any;
}

/**
 * Creates a mock DynamoDB client that simulates paginated queries for the
 * PointsRecords table type-createdAt-index GSI. Data is pre-sorted by createdAt descending.
 * Also handles BatchGet for Users (nicknames) and Query for BatchDistributions.
 */
function createPaginatedAnnouncementsMockClient(
  sortedRecords: Array<Record<string, any>>,
  userNicknameMap: Map<string, string>,
  distributorMap: Map<string, string>,
) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;

      if (commandName === 'QueryCommand') {
        const tableName = command.input?.TableName;

        if (tableName === 'PointsRecords') {
          const limit = command.input?.Limit ?? sortedRecords.length;
          const exclusiveStartKey = command.input?.ExclusiveStartKey;

          let startIndex = 0;
          if (exclusiveStartKey) {
            const startRecordId = exclusiveStartKey.recordId;
            const idx = sortedRecords.findIndex(r => r.recordId === startRecordId);
            startIndex = idx >= 0 ? idx + 1 : sortedRecords.length;
          }

          const pageItems = sortedRecords.slice(startIndex, startIndex + limit);
          const hasMore = startIndex + limit < sortedRecords.length;

          return Promise.resolve({
            Items: pageItems,
            LastEvaluatedKey: hasMore
              ? {
                  type: 'earn',
                  createdAt: sortedRecords[startIndex + limit - 1].createdAt,
                  recordId: sortedRecords[startIndex + limit - 1].recordId,
                }
              : undefined,
          });
        }

        if (tableName === 'BatchDistributions') {
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
}

// ============================================================
// Property 3 Tests
// ============================================================

describe('Feature: points-leaderboard, Property 3: Paginating through all pages yields the complete sorted dataset', () => {
  // ----------------------------------------------------------
  // Ranking pagination completeness
  // ----------------------------------------------------------
  describe('Ranking: paginating through all pages yields the complete sorted dataset', () => {
    it('concatenating all pages equals the full sorted dataset with no duplicates or missing items', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueEligibleUsersArb,
          pageSizeArb,
          async (users, pageSize) => {
            // Sort by earnTotal descending (simulating GSI behavior)
            const sorted = [...users].sort((a, b) => b.earnTotal - a.earnTotal);

            const mockClient = createPaginatedRankingMockClient(sorted);

            // Traverse all pages
            const allItems: Array<{ rank: number; nickname: string; roles: string[]; earnTotal: number }> = [];
            let lastKey: string | undefined;

            for (let page = 0; page < sorted.length + 1; page++) {
              const result = await getRanking(
                { role: 'all', limit: pageSize, ...(lastKey ? { lastKey } : {}) },
                mockClient,
                'Users',
              );

              expect(result.success).toBe(true);
              expect(result.items).toBeDefined();
              allItems.push(...result.items!);

              if (result.lastKey === null || result.lastKey === undefined) {
                break;
              }
              lastKey = result.lastKey;
            }

            // Build expected dataset: all eligible users sorted by earnTotal descending
            const expectedNicknames = sorted.map(u => u.nickname);
            const actualNicknames = allItems.map(item => item.nickname);

            // 1. No items are missing — total count matches
            expect(allItems.length).toBe(sorted.length);

            // 2. No items are duplicated — all nicknames+earnTotal pairs match
            const actualRecordKeys = allItems.map(item => `${item.nickname}|${item.earnTotal}`);
            const expectedRecordKeys = sorted.map(u => `${u.nickname}|${u.earnTotal}`);
            expect(actualRecordKeys).toEqual(expectedRecordKeys);

            // 3. Order is preserved — earnTotal non-increasing across all pages
            for (let i = 1; i < allItems.length; i++) {
              expect(allItems[i - 1].earnTotal).toBeGreaterThanOrEqual(allItems[i].earnTotal);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ----------------------------------------------------------
  // Announcements pagination completeness
  // ----------------------------------------------------------
  describe('Announcements: paginating through all pages yields the complete sorted dataset', () => {
    it('concatenating all pages equals the full sorted dataset with no duplicates or missing items', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueEarnRecordsArb,
          pageSizeArb,
          async (records, pageSize) => {
            // Sort by createdAt descending (simulating GSI behavior)
            const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

            // Build user nickname map
            const userNicknameMap = new Map<string, string>();
            for (const r of sorted) {
              if (!userNicknameMap.has(r.userId)) {
                userNicknameMap.set(r.userId, `User_${r.userId.slice(0, 6)}`);
              }
            }

            // Build distributor nickname map for batch records
            const distributorMap = new Map<string, string>();
            for (const r of sorted) {
              if (isBatchRecord(r.source) && r.activityId && !distributorMap.has(r.activityId)) {
                distributorMap.set(r.activityId, `Dist_${r.activityId.slice(0, 6)}`);
              }
            }

            const mockClient = createPaginatedAnnouncementsMockClient(
              sorted,
              userNicknameMap,
              distributorMap,
            );

            // Traverse all pages
            const allItems: Array<{ recordId: string; createdAt: string; amount: number }> = [];
            let lastKey: string | undefined;

            for (let page = 0; page < sorted.length + 1; page++) {
              const result = await getAnnouncements(
                { limit: pageSize, ...(lastKey ? { lastKey } : {}) },
                mockClient,
                {
                  pointsRecordsTable: 'PointsRecords',
                  usersTable: 'Users',
                  batchDistributionsTable: 'BatchDistributions',
                },
              );

              expect(result.success).toBe(true);
              expect(result.items).toBeDefined();
              allItems.push(...result.items!);

              if (result.lastKey === null || result.lastKey === undefined) {
                break;
              }
              lastKey = result.lastKey;
            }

            // 1. No items are missing — total count matches
            expect(allItems.length).toBe(sorted.length);

            // 2. No items are duplicated — all recordIds are unique and match
            const actualRecordIds = allItems.map(item => item.recordId);
            const expectedRecordIds = sorted.map(r => r.recordId);
            expect(actualRecordIds).toEqual(expectedRecordIds);

            // 3. No duplicates exist
            const uniqueRecordIds = new Set(actualRecordIds);
            expect(uniqueRecordIds.size).toBe(allItems.length);

            // 4. Order is preserved — createdAt non-increasing across all pages
            for (let i = 1; i < allItems.length; i++) {
              expect(allItems[i - 1].createdAt.localeCompare(allItems[i].createdAt)).toBeGreaterThanOrEqual(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
