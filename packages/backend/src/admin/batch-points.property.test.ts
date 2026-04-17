import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  filterUsersBySearch,
  validateBatchDistributionInput,
  executeBatchDistribution,
  listDistributionHistory,
  clampPageSize,
  type SearchableUser,
  type BatchDistributionInput,
} from './batch-points';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a user with nickname and email */
const userArb = fc.record({
  userId: fc.uuid(),
  nickname: fc.string({ minLength: 1, maxLength: 30 }),
  email: fc.emailAddress(),
});

/** Arbitrary for a non-empty search query */
const searchQueryArb = fc.string({ minLength: 1, maxLength: 20 });

/** Arbitrary for valid target roles */
const targetRoleArb = fc.constantFrom('UserGroupLeader' as const, 'Speaker' as const, 'Volunteer' as const);

/** Arbitrary for valid request body */
const validRequestBodyArb = fc.record({
  userIds: fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
  points: fc.integer({ min: 1, max: 100000 }),
  reason: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
  targetRole: targetRoleArb,
  activityId: fc.uuid(),
});

// ============================================================
// Property 1: Client-side search filters correctly by nickname or email
// Feature: admin-batch-points, Property 1: Client-side search filters correctly by nickname or email
// Validates: Requirements 1.5
// ============================================================

describe('Feature: admin-batch-points, Property 1: Client-side search filters correctly by nickname or email', () => {
  it('filtered results only contain users whose nickname or email includes the query (case-insensitive), and no matching user is excluded', () => {
    fc.assert(
      fc.property(
        fc.array(userArb, { minLength: 0, maxLength: 20 }),
        searchQueryArb,
        (users, query) => {
          const result = filterUsersBySearch(users as SearchableUser[], query);
          const lowerQuery = query.toLowerCase();

          // Every returned user must match the query
          for (const user of result) {
            const matchesNickname = user.nickname.toLowerCase().includes(lowerQuery);
            const matchesEmail = user.email.toLowerCase().includes(lowerQuery);
            expect(matchesNickname || matchesEmail).toBe(true);
          }

          // No matching user should be excluded
          for (const user of users) {
            const matchesNickname = user.nickname.toLowerCase().includes(lowerQuery);
            const matchesEmail = user.email.toLowerCase().includes(lowerQuery);
            if (matchesNickname || matchesEmail) {
              expect(result).toContainEqual(user);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty query returns all users', () => {
    fc.assert(
      fc.property(
        fc.array(userArb, { minLength: 0, maxLength: 20 }),
        (users) => {
          const result = filterUsersBySearch(users as SearchableUser[], '');
          expect(result).toHaveLength(users.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Request body validation accepts valid inputs and rejects invalid inputs
// Feature: admin-batch-points, Property 2: Request body validation accepts valid inputs and rejects invalid inputs
// Validates: Requirements 3.2, 3.3, 4.5, 4.6
// ============================================================

describe('Feature: admin-batch-points, Property 2: Request body validation accepts valid inputs and rejects invalid inputs', () => {
  it('valid request bodies are accepted', () => {
    fc.assert(
      fc.property(validRequestBodyArb, (body) => {
        const result = validateBatchDistributionInput(body);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('missing userIds is rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        targetRoleArb,
        (points, reason, targetRole) => {
          const result = validateBatchDistributionInput({ points, reason, targetRole });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-positive-integer points are rejected', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.oneof(
          fc.integer({ min: -1000, max: 0 }),
          fc.double({ min: 0.1, max: 100, noNaN: true }).filter(n => !Number.isInteger(n)),
        ),
        fc.string({ minLength: 1, maxLength: 200 }),
        targetRoleArb,
        (userIds, points, reason, targetRole) => {
          const result = validateBatchDistributionInput({ userIds, points, reason, targetRole });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reason outside 1-200 chars is rejected', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.oneof(
          fc.constant(''),
          fc.string({ minLength: 201, maxLength: 300 }),
        ),
        targetRoleArb,
        (userIds, points, reason, targetRole) => {
          const result = validateBatchDistributionInput({ userIds, points, reason, targetRole });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid targetRole is rejected', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          s => !['UserGroupLeader', 'Speaker', 'Volunteer'].includes(s),
        ),
        (userIds, points, reason, targetRole) => {
          const result = validateBatchDistributionInput({ userIds, points, reason, targetRole });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 3: Batch distribution increases each recipient's balance by exactly the specified points
// Feature: admin-batch-points, Property 3: Batch distribution increases each recipient's balance by exactly the specified points
// Validates: Requirements 4.7, 4.8
// ============================================================

describe('Feature: admin-batch-points, Property 3: Batch distribution increases each recipient\'s balance by exactly the specified points', () => {
  it('each user balance = original + specified points, and earn record exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            points: fc.integer({ min: 0, max: 10000 }),
            nickname: fc.string({ minLength: 1, maxLength: 20 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 10 },
        ).map(users => {
          // Ensure unique userIds
          const seen = new Set<string>();
          return users.filter(u => {
            if (seen.has(u.userId)) return false;
            seen.add(u.userId);
            return true;
          });
        }).filter(users => users.length > 0),
        fc.integer({ min: 1, max: 10000 }),
        async (users, pointsToAdd) => {
          const transactedItems: any[] = [];
          const putItems: any[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: users.map(u => ({
                      userId: u.userId,
                      points: u.points,
                      nickname: u.nickname,
                      email: u.email,
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                transactedItems.push(...cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                putItems.push(cmd.input.Item);
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'test reason',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          expect(result.success).toBe(true);

          // Verify each user's balance update and earn record
          for (const user of users) {
            // Find the Update item for this user
            const updateItem = transactedItems.find(
              (item: any) => item.Update && item.Update.Key?.userId === user.userId,
            );
            expect(updateItem).toBeDefined();
            expect(updateItem.Update.ExpressionAttributeValues[':pv']).toBe(pointsToAdd);

            // Find the Put item (earn record) for this user
            const earnRecord = transactedItems.find(
              (item: any) => item.Put && item.Put.Item?.userId === user.userId,
            );
            expect(earnRecord).toBeDefined();
            expect(earnRecord.Put.Item.type).toBe('earn');
            expect(earnRecord.Put.Item.amount).toBe(pointsToAdd);
            expect(earnRecord.Put.Item.balanceAfter).toBe(user.points + pointsToAdd);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 4: Distribution record and result contain correct aggregated data
// Feature: admin-batch-points, Property 4: Distribution record and result contain correct aggregated data
// Validates: Requirements 4.9, 4.10
// ============================================================

describe('Feature: admin-batch-points, Property 4: Distribution record and result contain correct aggregated data', () => {
  it('successCount=N, totalPoints=N×P, distributionId is non-empty', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 15 }).map(ids => [...new Set(ids)]).filter(ids => ids.length > 0),
        fc.integer({ min: 1, max: 10000 }),
        async (uniqueUserIds, points) => {
          let savedDistributionRecord: any = null;

          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: uniqueUserIds.map(id => ({
                      userId: id,
                      points: 0,
                      nickname: 'user',
                      email: 'user@test.com',
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                savedDistributionRecord = cmd.input.Item;
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: uniqueUserIds,
            points,
            reason: 'test',
            targetRole: 'Volunteer',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          const N = uniqueUserIds.length;

          // Verify result
          expect(result.success).toBe(true);
          expect(result.successCount).toBe(N);
          expect(result.totalPoints).toBe(N * points);
          expect(result.distributionId).toBeDefined();
          expect(result.distributionId!.length).toBeGreaterThan(0);

          // Verify saved distribution record
          expect(savedDistributionRecord).toBeDefined();
          expect(savedDistributionRecord.successCount).toBe(N);
          expect(savedDistributionRecord.totalPoints).toBe(N * points);
          expect(savedDistributionRecord.distributionId).toBe(result.distributionId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 5: Duplicate userIds are deduplicated before distribution
// Feature: admin-batch-points, Property 5: Duplicate userIds are deduplicated before distribution
// Validates: Requirements 5.1, 5.2
// ============================================================

describe('Feature: admin-batch-points, Property 5: Duplicate userIds are deduplicated before distribution', () => {
  it('successCount equals deduplicated count, each user receives points exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate an array of userIds with guaranteed duplicates
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }).chain(baseIds =>
          fc.shuffledSubarray(baseIds, { minLength: 1 }).map(extras => [...baseIds, ...extras]),
        ),
        fc.integer({ min: 1, max: 10000 }),
        async (userIdsWithDupes, points) => {
          const uniqueIds = [...new Set(userIdsWithDupes)];
          const transactedItems: any[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: uniqueIds.map(id => ({
                      userId: id,
                      points: 100,
                      nickname: 'user',
                      email: 'user@test.com',
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                transactedItems.push(...cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: userIdsWithDupes,
            points,
            reason: 'dedup test',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          expect(result.success).toBe(true);
          expect(result.successCount).toBe(uniqueIds.length);

          // Each unique user should have exactly one Update and one Put (earn record)
          for (const userId of uniqueIds) {
            const updates = transactedItems.filter(
              (item: any) => item.Update && item.Update.Key?.userId === userId,
            );
            const puts = transactedItems.filter(
              (item: any) => item.Put && item.Put.Item?.userId === userId,
            );
            expect(updates).toHaveLength(1);
            expect(puts).toHaveLength(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 6: Distribution history returns records with all required fields in descending time order
// Feature: admin-batch-points, Property 6: Distribution history returns records with all required fields in descending time order
// Validates: Requirements 6.3, 6.4
// ============================================================

describe('Feature: admin-batch-points, Property 6: Distribution history returns records with all required fields in descending time order', () => {
  it('each record has all required fields and records are sorted by createdAt descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            distributionId: fc.uuid(),
            distributorId: fc.uuid(),
            distributorNickname: fc.string({ minLength: 1, maxLength: 20 }),
            targetRole: targetRoleArb,
            recipientIds: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
            points: fc.integer({ min: 1, max: 10000 }),
            reason: fc.string({ minLength: 1, maxLength: 200 }),
            successCount: fc.integer({ min: 1, max: 50 }),
            totalPoints: fc.integer({ min: 1, max: 500000 }),
            createdAt: fc.date({
              min: new Date('2024-01-01'),
              max: new Date('2025-12-31'),
            }).map(d => d.toISOString()),
          }),
          { minLength: 1, maxLength: 10 },
        ).map(records =>
          // Sort descending by createdAt to simulate DynamoDB GSI behavior
          [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ),
        async (sortedRecords) => {
          const mockClient = {
            send: vi.fn().mockResolvedValue({
              Items: sortedRecords,
              LastEvaluatedKey: undefined,
            }),
          } as any;

          const result = await listDistributionHistory(
            { pageSize: 20 },
            mockClient,
            'BatchDistributions',
          );

          expect(result.success).toBe(true);
          expect(result.distributions).toBeDefined();

          const distributions = result.distributions!;

          // Verify each record has all required fields
          for (const record of distributions) {
            expect(record.distributionId).toBeDefined();
            expect(typeof record.distributionId).toBe('string');
            expect(record.distributorNickname).toBeDefined();
            expect(typeof record.distributorNickname).toBe('string');
            expect(record.targetRole).toBeDefined();
            expect(['UserGroupLeader', 'Speaker', 'Volunteer']).toContain(record.targetRole);
            expect(record.recipientIds).toBeDefined();
            expect(Array.isArray(record.recipientIds)).toBe(true);
            expect(record.recipientIds.length).toBeGreaterThan(0);
            expect(record.points).toBeDefined();
            expect(typeof record.points).toBe('number');
            expect(record.reason).toBeDefined();
            expect(typeof record.reason).toBe('string');
            expect(record.createdAt).toBeDefined();
            expect(typeof record.createdAt).toBe('string');
          }

          // Verify descending order by createdAt
          for (let i = 1; i < distributions.length; i++) {
            expect(distributions[i - 1].createdAt >= distributions[i].createdAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: Pagination pageSize is clamped to valid range
// Feature: admin-batch-points, Property 7: Pagination pageSize is clamped to valid range
// Validates: Requirement 6.5
// ============================================================

describe('Feature: admin-batch-points, Property 7: Pagination pageSize is clamped to valid range', () => {
  it('undefined pageSize defaults to 20', () => {
    fc.assert(
      fc.property(fc.constant(undefined), (_) => {
        expect(clampPageSize(undefined)).toBe(20);
      }),
      { numRuns: 100 },
    );
  });

  it('pageSize < 1 is clamped to 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10000, max: 0 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pageSize > 100 is clamped to 100', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 100000 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(100);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pageSize in [1, 100] is used as-is', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (pageSize) => {
          expect(clampPageSize(pageSize)).toBe(pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('effective pageSize is always in [1, 100] for any numeric input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100000, max: 100000 }),
          fc.constant(undefined as unknown as number),
        ),
        (pageSize) => {
          const result = clampPageSize(pageSize);
          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 7: Distribution record and points records contain complete activity metadata
// Feature: activity-points-tracking, Property 7: Distribution record and points records contain complete activity metadata
// Validates: Requirements 15.1, 15.2
// ============================================================

/** Arbitrary for activity type */
const activityTypeArb = fc.constantFrom('线上活动', '线下活动');

/** Arbitrary for activity metadata */
const activityMetadataArb = fc.record({
  activityId: fc.uuid(),
  activityType: activityTypeArb,
  activityUG: fc.string({ minLength: 1, maxLength: 50 }),
  activityTopic: fc.string({ minLength: 1, maxLength: 200 }),
  activityDate: fc.date({
    min: new Date('2023-01-01'),
    max: new Date('2025-12-31'),
  }).map(d => d.toISOString().slice(0, 10)),
});

describe('Feature: activity-points-tracking, Property 7: Distribution record and points records contain complete activity metadata', () => {
  it('Distribution_Record contains all activity metadata fields and every PointsRecord contains matching activityId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            points: fc.integer({ min: 0, max: 10000 }),
            nickname: fc.string({ minLength: 1, maxLength: 20 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 10 },
        ).map(users => {
          const seen = new Set<string>();
          return users.filter(u => {
            if (seen.has(u.userId)) return false;
            seen.add(u.userId);
            return true;
          });
        }).filter(users => users.length > 0),
        fc.integer({ min: 1, max: 10000 }),
        activityMetadataArb,
        async (users, pointsToAdd, activityMeta) => {
          const transactedItems: any[] = [];
          let savedDistributionRecord: any = null;

          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'GetCommand') {
                // Activity existence check — return the activity as existing
                return Promise.resolve({
                  Item: {
                    activityId: activityMeta.activityId,
                    activityType: activityMeta.activityType,
                    ugName: activityMeta.activityUG,
                    topic: activityMeta.activityTopic,
                    activityDate: activityMeta.activityDate,
                  },
                });
              }
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: users.map(u => ({
                      userId: u.userId,
                      points: u.points,
                      nickname: u.nickname,
                      email: u.email,
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                transactedItems.push(...cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                savedDistributionRecord = cmd.input.Item;
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'activity metadata test',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: activityMeta.activityId,
            activityType: activityMeta.activityType,
            activityUG: activityMeta.activityUG,
            activityTopic: activityMeta.activityTopic,
            activityDate: activityMeta.activityDate,
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
            activitiesTable: 'Activities',
          });

          expect(result.success).toBe(true);

          // Verify Distribution_Record contains all activity metadata fields
          expect(savedDistributionRecord).toBeDefined();
          expect(savedDistributionRecord.activityId).toBe(activityMeta.activityId);
          expect(savedDistributionRecord.activityType).toBe(activityMeta.activityType);
          expect(savedDistributionRecord.activityUG).toBe(activityMeta.activityUG);
          expect(savedDistributionRecord.activityTopic).toBe(activityMeta.activityTopic);
          expect(savedDistributionRecord.activityDate).toBe(activityMeta.activityDate);

          // Verify every PointsRecord contains activityId matching the distribution's activityId
          const pointsRecordPuts = transactedItems.filter(
            (item: any) => item.Put && item.Put.Item?.type === 'earn',
          );
          expect(pointsRecordPuts.length).toBe(users.length);

          for (const putItem of pointsRecordPuts) {
            expect(putItem.Put.Item.activityId).toBe(activityMeta.activityId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 8: Batch distribution validates activityId existence
// Feature: activity-points-tracking, Property 8: Batch distribution validates activityId existence
// Validates: Requirements 15.3, 16.1, 16.3
// ============================================================

/** Safe arbitrary for activity metadata that avoids invalid date values */
const safeActivityMetadataArb = fc.record({
  activityId: fc.uuid(),
  activityType: activityTypeArb,
  activityUG: fc.string({ minLength: 1, maxLength: 50 }),
  activityTopic: fc.string({ minLength: 1, maxLength: 200 }),
  activityDate: fc.integer({ min: 2023, max: 2025 }).chain(year =>
    fc.integer({ min: 1, max: 12 }).chain(month =>
      fc.integer({ min: 1, max: 28 }).map(day =>
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ),
    ),
  ),
});

describe('Feature: activity-points-tracking, Property 8: Batch distribution validates activityId existence', () => {
  it('existing activityId passes validation and distribution succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(
          fc.record({
            userId: fc.uuid(),
            points: fc.integer({ min: 0, max: 10000 }),
            nickname: fc.string({ minLength: 1, maxLength: 20 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 5 },
        ).map(users => {
          const seen = new Set<string>();
          return users.filter(u => {
            if (seen.has(u.userId)) return false;
            seen.add(u.userId);
            return true;
          });
        }).filter(users => users.length > 0),
        fc.integer({ min: 1, max: 10000 }),
        safeActivityMetadataArb,
        async (existingActivityId, users, pointsToAdd, activityMeta) => {
          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'GetCommand') {
                // Activity exists in the table
                return Promise.resolve({
                  Item: {
                    activityId: existingActivityId,
                    activityType: activityMeta.activityType,
                    ugName: activityMeta.activityUG,
                    topic: activityMeta.activityTopic,
                    activityDate: activityMeta.activityDate,
                  },
                });
              }
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: users.map(u => ({
                      userId: u.userId,
                      points: u.points,
                      nickname: u.nickname,
                      email: u.email,
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          // Validate input first — activityId is present
          const validationResult = validateBatchDistributionInput({
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'test reason',
            targetRole: 'Speaker',
            activityId: existingActivityId,
          });
          expect(validationResult.valid).toBe(true);

          // Execute distribution — activity exists, should succeed
          const input: BatchDistributionInput = {
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'test reason',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: existingActivityId,
            activityType: activityMeta.activityType,
            activityUG: activityMeta.activityUG,
            activityTopic: activityMeta.activityTopic,
            activityDate: activityMeta.activityDate,
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
            activitiesTable: 'Activities',
          });

          expect(result.success).toBe(true);
          expect(result.distributionId).toBeDefined();
          expect(result.successCount).toBe(users.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-existent activityId returns ACTIVITY_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 10000 }),
        safeActivityMetadataArb,
        async (nonExistentActivityId, userIds, pointsToAdd, activityMeta) => {
          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'GetCommand') {
                // Activity does NOT exist
                return Promise.resolve({ Item: undefined });
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds,
            points: pointsToAdd,
            reason: 'test reason',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: nonExistentActivityId,
            activityType: activityMeta.activityType,
            activityUG: activityMeta.activityUG,
            activityTopic: activityMeta.activityTopic,
            activityDate: activityMeta.activityDate,
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
            activitiesTable: 'Activities',
          });

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('ACTIVITY_NOT_FOUND');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('missing or empty activityId returns INVALID_REQUEST from validateBatchDistributionInput', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
        targetRoleArb,
        fc.oneof(
          // missing activityId (undefined)
          fc.constant(undefined),
          // empty string activityId
          fc.constant(''),
        ),
        (userIds, points, reason, targetRole, activityId) => {
          const body: Record<string, unknown> = { userIds, points, reason, targetRole };
          if (activityId !== undefined) {
            body.activityId = activityId;
          }

          const result = validateBatchDistributionInput(body);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
