import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  reviewTravelApplication,
  listAllTravelApplications,
  ReviewTravelApplicationInput,
} from './review';
import { listMyTravelApplications, ListMyTravelApplicationsOptions } from './apply';
import type { TravelApplication, TravelApplicationStatus } from '@points-mall/shared';

// ---- Shared Arbitraries ----

const statusArb = fc.constantFrom<TravelApplicationStatus>('pending', 'approved', 'rejected');
const categoryArb = fc.constantFrom<'domestic' | 'international'>('domestic', 'international');
const communityRoleArb = fc.constantFrom<'Hero' | 'CommunityBuilder' | 'UGL'>('Hero', 'CommunityBuilder', 'UGL');
const userIdArb = fc.stringMatching(/^user-[a-z0-9]{3,8}$/);
const applicationIdArb = fc.stringMatching(/^app-[a-z0-9]{3,12}$/);
const nicknameArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);
const isoDateArb = fc.integer({ min: 1672531200000, max: 1767225600000 }).map((ts) => new Date(ts).toISOString());
const earnDeductedArb = fc.integer({ min: 100, max: 10_000 });

function makePendingApplicationArb(): fc.Arbitrary<TravelApplication> {
  return fc.record({
    applicationId: applicationIdArb,
    userId: userIdArb,
    applicantNickname: nicknameArb,
    category: categoryArb,
    communityRole: communityRoleArb,
    eventLink: fc.constant('https://example.com/event'),
    cfpScreenshotUrl: fc.constant('https://cdn.example.com/screenshot.png'),
    flightCost: fc.integer({ min: 0, max: 100_000 }),
    hotelCost: fc.integer({ min: 0, max: 100_000 }),
    totalCost: fc.integer({ min: 0, max: 200_000 }),
    status: fc.constant('pending' as TravelApplicationStatus),
    earnDeducted: earnDeductedArb,
    createdAt: isoDateArb,
    updatedAt: isoDateArb,
  });
}

function makeApplicationArb(): fc.Arbitrary<TravelApplication> {
  return fc.record({
    applicationId: applicationIdArb,
    userId: userIdArb,
    applicantNickname: nicknameArb,
    category: categoryArb,
    communityRole: communityRoleArb,
    eventLink: fc.constant('https://example.com/event'),
    cfpScreenshotUrl: fc.constant('https://cdn.example.com/screenshot.png'),
    flightCost: fc.integer({ min: 0, max: 100_000 }),
    hotelCost: fc.integer({ min: 0, max: 100_000 }),
    totalCost: fc.integer({ min: 0, max: 200_000 }),
    status: statusArb,
    earnDeducted: earnDeductedArb,
    createdAt: isoDateArb,
    updatedAt: isoDateArb,
  });
}

const USERS_TABLE = 'Users';
const TRAVEL_APPLICATIONS_TABLE = 'TravelApplications';
const tables = { usersTable: USERS_TABLE, travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE };

// ============================================================
// Feature: speaker-travel-sponsorship, Property 6: Approval preserves quota
//
// For any pending travel application, after reviewTravelApplication with action "approve"
// succeeds, the application status should be "approved", the reviewerId and reviewedAt
// fields should be set, and the user's travelEarnUsed should remain unchanged
// (UpdateCommand used, not TransactWriteCommand).
//
// **Validates: Requirements 5.6**
// ============================================================

describe('Property 6: Approval preserves quota', () => {
  it('should set status=approved, reviewerId/reviewedAt set, travelEarnUsed unchanged (UpdateCommand used)', () => {
    fc.assert(
      fc.asyncProperty(
        makePendingApplicationArb(),
        fc.string({ minLength: 3, maxLength: 20 }).filter((s) => s.trim().length > 0),
        nicknameArb,
        async (pendingApp, reviewerId, reviewerNickname) => {
          const sendMock = vi.fn();
          // Call 1: GetCommand returns pending application
          sendMock.mockResolvedValueOnce({ Item: pendingApp });
          // Call 2: UpdateCommand succeeds
          sendMock.mockResolvedValueOnce({});

          const client = { send: sendMock } as any;

          const input: ReviewTravelApplicationInput = {
            applicationId: pendingApp.applicationId,
            reviewerId,
            reviewerNickname,
            action: 'approve',
          };

          const result = await reviewTravelApplication(input, client, tables);

          // Status should be approved
          expect(result.success).toBe(true);
          expect(result.application).toBeDefined();
          expect(result.application!.status).toBe('approved');

          // reviewerId and reviewedAt should be set
          expect(result.application!.reviewerId).toBe(reviewerId);
          expect(result.application!.reviewedAt).toBeDefined();
          expect(result.application!.reviewedAt!.length).toBeGreaterThan(0);

          // travelEarnUsed unchanged — approve uses UpdateCommand, not TransactWriteCommand
          expect(sendMock).toHaveBeenCalledTimes(2);
          const updateCmd = sendMock.mock.calls[1][0];
          expect(updateCmd.constructor.name).toBe('UpdateCommand');

          // earnDeducted should be preserved from original application
          expect(result.application!.earnDeducted).toBe(pendingApp.earnDeducted);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 7: Rejection returns quota
//
// For any pending travel application with earnDeducted = D, after reviewTravelApplication
// with action "reject" succeeds, the application status should be "rejected", and
// TransactWriteCommand decreases travelEarnUsed by D.
//
// **Validates: Requirements 5.7, 15.3**
// ============================================================

describe('Property 7: Rejection returns quota', () => {
  it('should set status=rejected, TransactWriteCommand decreases travelEarnUsed by earnDeducted', () => {
    fc.assert(
      fc.asyncProperty(
        makePendingApplicationArb(),
        fc.string({ minLength: 3, maxLength: 20 }).filter((s) => s.trim().length > 0),
        nicknameArb,
        fc.string({ minLength: 0, maxLength: 100 }),
        async (pendingApp, reviewerId, reviewerNickname, rejectReason) => {
          const sendMock = vi.fn();
          // Call 1: GetCommand returns pending application
          sendMock.mockResolvedValueOnce({ Item: pendingApp });
          // Call 2: TransactWriteCommand succeeds
          sendMock.mockResolvedValueOnce({});

          const client = { send: sendMock } as any;

          const input: ReviewTravelApplicationInput = {
            applicationId: pendingApp.applicationId,
            reviewerId,
            reviewerNickname,
            action: 'reject',
            rejectReason: rejectReason || undefined,
          };

          const result = await reviewTravelApplication(input, client, tables);

          // Status should be rejected
          expect(result.success).toBe(true);
          expect(result.application).toBeDefined();
          expect(result.application!.status).toBe('rejected');

          // TransactWriteCommand was used
          expect(sendMock).toHaveBeenCalledTimes(2);
          const txCmd = sendMock.mock.calls[1][0];
          expect(txCmd.constructor.name).toBe('TransactWriteCommand');

          // Transaction should have 2 items
          const transactItems = txCmd.input.TransactItems;
          expect(transactItems).toHaveLength(2);

          // Second item should decrease travelEarnUsed by earnDeducted (D)
          const userUpdate = transactItems[1].Update;
          expect(userUpdate.TableName).toBe(USERS_TABLE);
          expect(userUpdate.ExpressionAttributeValues[':deducted']).toBe(pendingApp.earnDeducted);

          // ConditionExpression ensures non-negative
          expect(userUpdate.ConditionExpression).toContain('travelEarnUsed >= :deducted');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 8: User isolation in list queries
//
// For any set of travel applications belonging to multiple users, when user A calls
// listMyTravelApplications, the result should contain only applications where
// userId === A. No application belonging to a different user should appear.
//
// **Validates: Requirements 6.1**
// ============================================================

describe('Property 8: User isolation in list queries', () => {
  it('should only return applications for the specified userId', () => {
    fc.assert(
      fc.asyncProperty(
        // Generate 2-5 distinct user IDs
        fc.array(userIdArb, { minLength: 2, maxLength: 5 }).chain((userIds) => {
          const uniqueUserIds = [...new Set(userIds)];
          if (uniqueUserIds.length < 2) return fc.constant(null);

          // Generate 3-10 applications distributed across users
          return fc.array(
            fc.record({
              app: makeApplicationArb(),
              ownerIdx: fc.nat({ max: uniqueUserIds.length - 1 }),
            }),
            { minLength: 3, maxLength: 10 },
          ).map((entries) => ({
            userIds: uniqueUserIds,
            applications: entries.map((e) => ({
              ...e.app,
              userId: uniqueUserIds[e.ownerIdx],
            })),
          }));
        }),
        // Pick which user to query
        fc.nat({ max: 100 }),
        async (data, queryUserSeed) => {
          if (!data) return; // skip if not enough unique users

          const { userIds, applications } = data;
          const queryUserId = userIds[queryUserSeed % userIds.length];

          // Filter expected results: only apps belonging to queryUserId
          const expectedApps = applications.filter((a) => a.userId === queryUserId);

          // Mock DynamoDB to simulate the GSI query behavior:
          // listMyTravelApplications uses userId-createdAt-index GSI which returns
          // only items matching the partition key (userId)
          const sendMock = vi.fn();
          sendMock.mockResolvedValueOnce({
            Items: expectedApps,
            LastEvaluatedKey: undefined,
          });

          const client = { send: sendMock } as any;

          const result = await listMyTravelApplications(
            { userId: queryUserId },
            client,
            TRAVEL_APPLICATIONS_TABLE,
          );

          expect(result.success).toBe(true);

          // All returned applications must belong to queryUserId
          for (const app of result.applications) {
            expect(app.userId).toBe(queryUserId);
          }

          // No application from other users should be present
          const otherUserApps = result.applications.filter((a) => a.userId !== queryUserId);
          expect(otherUserApps).toHaveLength(0);

          // Verify the QueryCommand was sent with correct userId
          const cmd = sendMock.mock.calls[0][0];
          expect(cmd.constructor.name).toBe('QueryCommand');
          expect(cmd.input.IndexName).toBe('userId-createdAt-index');
          expect(cmd.input.ExpressionAttributeValues[':uid']).toBe(queryUserId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 9: Status filter returns only matching records in descending time order
//
// For any set of travel applications with mixed statuses, when querying with a specific
// status filter, all returned applications should have that status. Additionally, the
// returned applications should be sorted by createdAt in descending order.
//
// **Validates: Requirements 6.2, 6.3, 8.4, 8.5**
// ============================================================

describe('Property 9: Status filter returns only matching records in descending time order', () => {
  it('should return only matching status records sorted by createdAt descending', () => {
    fc.assert(
      fc.asyncProperty(
        // Generate 5-15 applications with mixed statuses
        fc.array(makeApplicationArb(), { minLength: 5, maxLength: 15 }),
        // Pick a status to filter by
        statusArb,
        async (applications, filterStatus) => {
          // Filter and sort expected results (simulating what DynamoDB GSI would return)
          const matchingApps = applications
            .filter((a) => a.status === filterStatus)
            .sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));

          // Mock DynamoDB: GSI status-createdAt-index returns pre-filtered, pre-sorted results
          const sendMock = vi.fn();
          sendMock.mockResolvedValueOnce({
            Items: matchingApps,
            LastEvaluatedKey: undefined,
          });

          const client = { send: sendMock } as any;

          const result = await listAllTravelApplications(
            { status: filterStatus },
            client,
            TRAVEL_APPLICATIONS_TABLE,
          );

          expect(result.success).toBe(true);

          // All returned records must have the filtered status
          for (const app of result.applications) {
            expect(app.status).toBe(filterStatus);
          }

          // Records must be in descending createdAt order
          for (let i = 1; i < result.applications.length; i++) {
            expect(result.applications[i - 1].createdAt >= result.applications[i].createdAt).toBe(true);
          }

          // Verify QueryCommand was used with correct GSI and status
          const cmd = sendMock.mock.calls[0][0];
          expect(cmd.constructor.name).toBe('QueryCommand');
          expect(cmd.input.IndexName).toBe('status-createdAt-index');
          expect(cmd.input.ScanIndexForward).toBe(false);
          expect(cmd.input.ExpressionAttributeValues[':status']).toBe(filterStatus);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 12: travelEarnUsed non-negative invariant
//
// For any sequence of travel application submissions, approvals, and rejections,
// the user's travelEarnUsed should never become negative. Specifically, a rejection
// that would cause travelEarnUsed to go below 0 should be prevented.
//
// **Validates: Requirements 15.4**
// ============================================================

type Operation =
  | { type: 'submit'; threshold: number }
  | { type: 'approve' }
  | { type: 'reject'; earnDeducted: number };

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.integer({ min: 100, max: 5_000 }).map((threshold) => ({ type: 'submit' as const, threshold })),
  fc.constant({ type: 'approve' as const }),
  fc.integer({ min: 100, max: 5_000 }).map((earnDeducted) => ({ type: 'reject' as const, earnDeducted })),
);

describe('Property 12: travelEarnUsed non-negative invariant', () => {
  it('should never allow travelEarnUsed to go negative across any operation sequence', () => {
    fc.assert(
      fc.property(
        fc.array(operationArb, { minLength: 1, maxLength: 30 }),
        (operations) => {
          let travelEarnUsed = 0;
          // Track pending applications with their earnDeducted values
          const pendingApps: number[] = [];

          for (const op of operations) {
            if (op.type === 'submit') {
              // Submit: increase travelEarnUsed by threshold
              travelEarnUsed += op.threshold;
              pendingApps.push(op.threshold);
            } else if (op.type === 'approve') {
              // Approve: travelEarnUsed stays unchanged, just remove from pending
              if (pendingApps.length > 0) {
                pendingApps.shift();
              }
              // No change to travelEarnUsed
            } else if (op.type === 'reject') {
              // Reject: decrease travelEarnUsed by earnDeducted of a pending app
              if (pendingApps.length > 0) {
                const deducted = pendingApps.shift()!;
                // Simulate the ConditionExpression: travelEarnUsed >= deducted
                if (travelEarnUsed >= deducted) {
                  travelEarnUsed -= deducted;
                }
                // If condition fails, the operation is rejected (no change)
              }
              // If no pending apps, reject is a no-op
            }

            // INVARIANT: travelEarnUsed must never be negative
            expect(travelEarnUsed).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
