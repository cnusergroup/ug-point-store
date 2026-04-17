import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  executeBatchDistribution,
  type BatchDistributionInput,
} from './batch-points';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for initial earnTotal value (including 0 and undefined) */
const initialEarnTotalArb = fc.oneof(
  fc.constant(undefined as number | undefined),
  fc.constant(0),
  fc.integer({ min: 1, max: 100000 }),
);

/** Arbitrary for positive integer points amount */
const pointsAmountArb = fc.integer({ min: 1, max: 10000 });

/** Arbitrary for valid target roles */
const targetRoleArb = fc.constantFrom('UserGroupLeader' as const, 'Speaker' as const, 'Volunteer' as const);

/** Arbitrary for a user with optional earnTotal */
const userWithEarnTotalArb = fc.record({
  userId: fc.uuid(),
  points: fc.integer({ min: 0, max: 100000 }),
  earnTotal: initialEarnTotalArb,
  nickname: fc.string({ minLength: 1, maxLength: 20 }),
  email: fc.emailAddress(),
});

// ============================================================
// Property 4: earnTotal is atomically incremented by the exact points amount during distribution
// Feature: points-leaderboard, Property 4: earnTotal is atomically incremented by the exact points amount during distribution
// Validates: Requirements 4.1, 4.2, 4.3
// ============================================================

describe('Feature: points-leaderboard, Property 4: earnTotal is atomically incremented by the exact points amount during distribution', () => {
  it('after batch distribution, the TransactWriteCommand UpdateExpression includes both points and earnTotal updates with correct values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(userWithEarnTotalArb, { minLength: 1, maxLength: 10 })
          .map(users => {
            // Ensure unique userIds
            const seen = new Set<string>();
            return users.filter(u => {
              if (seen.has(u.userId)) return false;
              seen.add(u.userId);
              return true;
            });
          })
          .filter(users => users.length > 0),
        pointsAmountArb,
        targetRoleArb,
        async (users, pointsToAdd, targetRole) => {
          const capturedTransactItems: any[] = [];

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
                      ...(u.earnTotal !== undefined ? { earnTotal: u.earnTotal } : {}),
                    })),
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                capturedTransactItems.push(...cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'earnTotal property test',
            targetRole,
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: '00000000-0000-0000-0000-000000000001',
            activityType: '线上活动',
            activityUG: 'TestUG',
            activityTopic: 'TestTopic',
            activityDate: '2024-06-01',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          expect(result.success).toBe(true);

          // Verify each user's Update operation in the transaction
          for (const user of users) {
            const updateItem = capturedTransactItems.find(
              (item: any) => item.Update && item.Update.Key?.userId === user.userId,
            );
            expect(updateItem).toBeDefined();

            const updateExpr: string = updateItem.Update.UpdateExpression;
            const exprValues = updateItem.Update.ExpressionAttributeValues;

            // 1. UpdateExpression includes both points and earnTotal updates
            expect(updateExpr).toContain('points = points + :pv');
            expect(updateExpr).toContain('earnTotal = if_not_exists(earnTotal, :zero) + :pv');

            // 2. ExpressionAttributeValues has correct values
            expect(exprValues[':pv']).toBe(pointsToAdd);
            expect(exprValues[':zero']).toBe(0);
            expect(exprValues[':pk']).toBe('ALL');

            // 3. Both points and earnTotal updates use the same :pv value
            //    (ensuring earnTotal increment equals the distributed points amount)
            //    This is guaranteed by the single :pv reference in both expressions.

            // 4. earnTotal and points updates are in the SAME TransactWriteCommand
            //    (verified by both being in capturedTransactItems from the same send call)
            const earnRecord = capturedTransactItems.find(
              (item: any) => item.Put && item.Put.Item?.userId === user.userId,
            );
            expect(earnRecord).toBeDefined();
            expect(earnRecord.Put.Item.type).toBe('earn');
            expect(earnRecord.Put.Item.amount).toBe(pointsToAdd);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('earnTotal uses if_not_exists pattern to handle users without existing earnTotal', async () => {
    await fc.assert(
      fc.asyncProperty(
        pointsAmountArb,
        async (pointsToAdd) => {
          // User with no earnTotal field (simulating a historical user)
          const userId = '00000000-0000-0000-0000-000000000099';
          const capturedTransactItems: any[] = [];

          const mockClient = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'BatchGetCommand') {
                return Promise.resolve({
                  Responses: {
                    Users: [{
                      userId,
                      points: 500,
                      nickname: 'HistoricalUser',
                      email: 'historical@test.com',
                      // No earnTotal field — simulates a user created before the feature
                    }],
                  },
                });
              }
              if (name === 'TransactWriteCommand') {
                capturedTransactItems.push(...cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: [userId],
            points: pointsToAdd,
            reason: 'if_not_exists test',
            targetRole: 'Speaker',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: '00000000-0000-0000-0000-000000000002',
            activityType: '线下活动',
            activityUG: 'TestUG',
            activityTopic: 'TestTopic',
            activityDate: '2024-07-01',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          expect(result.success).toBe(true);

          const updateItem = capturedTransactItems.find(
            (item: any) => item.Update && item.Update.Key?.userId === userId,
          );
          expect(updateItem).toBeDefined();

          // Verify the if_not_exists pattern is used for earnTotal
          const updateExpr: string = updateItem.Update.UpdateExpression;
          expect(updateExpr).toContain('if_not_exists(earnTotal, :zero)');

          // Verify :zero is 0 so that if earnTotal doesn't exist, it starts from 0
          expect(updateItem.Update.ExpressionAttributeValues[':zero']).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('earnTotal increment and points update are in the same TransactWriteCommand (atomicity)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            points: fc.integer({ min: 0, max: 10000 }),
            nickname: fc.string({ minLength: 1, maxLength: 20 }),
            email: fc.emailAddress(),
          }),
          { minLength: 1, maxLength: 5 },
        )
          .map(users => {
            const seen = new Set<string>();
            return users.filter(u => {
              if (seen.has(u.userId)) return false;
              seen.add(u.userId);
              return true;
            });
          })
          .filter(users => users.length > 0),
        pointsAmountArb,
        async (users, pointsToAdd) => {
          // Track each TransactWriteCommand call separately to verify atomicity
          const transactWriteCalls: any[][] = [];

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
                transactWriteCalls.push(cmd.input.TransactItems);
                return Promise.resolve({});
              }
              if (name === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const input: BatchDistributionInput = {
            userIds: users.map(u => u.userId),
            points: pointsToAdd,
            reason: 'atomicity test',
            targetRole: 'Volunteer',
            distributorId: 'admin-001',
            distributorNickname: 'Admin',
            activityId: '00000000-0000-0000-0000-000000000003',
            activityType: '线上活动',
            activityUG: 'TestUG',
            activityTopic: 'TestTopic',
            activityDate: '2024-08-01',
          };

          const result = await executeBatchDistribution(input, mockClient, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            batchDistributionsTable: 'BatchDistributions',
          });

          expect(result.success).toBe(true);

          // For each user, verify that the Update (containing both points and earnTotal)
          // and the Put (earn record) are in the SAME TransactWriteCommand call
          for (const user of users) {
            let foundInSameCall = false;
            for (const callItems of transactWriteCalls) {
              const hasUpdate = callItems.some(
                (item: any) => item.Update && item.Update.Key?.userId === user.userId,
              );
              const hasPut = callItems.some(
                (item: any) => item.Put && item.Put.Item?.userId === user.userId,
              );
              if (hasUpdate && hasPut) {
                foundInSameCall = true;

                // Additionally verify the Update contains both points and earnTotal
                const updateItem = callItems.find(
                  (item: any) => item.Update && item.Update.Key?.userId === user.userId,
                );
                const updateExpr: string = updateItem.Update.UpdateExpression;
                expect(updateExpr).toContain('points = points + :pv');
                expect(updateExpr).toContain('earnTotal');
                break;
              }
            }
            expect(foundInSameCall).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
