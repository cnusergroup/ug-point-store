import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runGracePeriodEvaluationJob } from './grace-period-job';
import { runUGLDetectionJob } from './detection-job';
import type { UGLExitServiceContext } from './detection-job';

// ============================================================
// In-memory mock DynamoDB client
// ============================================================
//
// Backs four "tables" used by runGracePeriodEvaluationJob's (and, for Property 10,
// runUGLDetectionJob's) full call chain:
// - usersTable: GetCommand (loadUser, feature-toggles lookup), UpdateCommand
//   (markUserPendingExit — unconditional; claimReminderSlot's PutCommand target is the
//   tracking table, not this one), ScanCommand (SuperAdmin lookup for
//   sendUGLExitNotifications), QueryCommand (entityType-createdAt-index for
//   queryAllUGLUsersForExit).
// - pointsRecordsTable: QueryCommand (userId-createdAt-index for queryMakeupCandidates,
//   type-createdAt-index for queryQuarterQualifyingRecords), UpdateCommand
//   (markRecordConsumed — conditional on attribute_not_exists(consumedForQuarter)).
// - trackingTable: QueryCommand (outcome-gracePeriodDeadline-index for
//   queryDueReminderRecords), UpdateCommand (transitionOutcome — conditional on
//   outcome = :pending), PutCommand (claimReminderSlot — conditional on
//   attribute_not_exists(userId), only exercised by Property 10's detection-job leg).
// - emailTemplatesTable: GetCommand (always returns a minimal template).

interface MockUser {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
  status: string;
  createdAt: string;
  locale?: string;
  uglExitStatus?: string;
  uglExitTriggeredQuarter?: string;
  uglExitMarkedAt?: string;
}

interface MockRecord {
  recordId: string;
  userId: string;
  targetRole?: string;
  activityDate?: string;
  createdAt: string;
  consumedForQuarter?: string;
}

interface MockTrackingRecord {
  userId: string;
  quarter: string;
  reminderSentAt: string;
  gracePeriodDeadline: string;
  outcome: 'pending' | 'remedied' | 'exited';
  consumedRecordId?: string;
  createdAt: string;
  updatedAt: string;
}

const USERS_TABLE = 'UsersTable';
const POINTS_RECORDS_TABLE = 'PointsRecordsTable';
const TRACKING_TABLE = 'TrackingTable';
const EMAIL_TEMPLATES_TABLE = 'EmailTemplatesTable';

function createMockDynamoClient(config: { users: MockUser[]; records: MockRecord[]; tracking: MockTrackingRecord[] }) {
  const usersById = new Map<string, MockUser>(config.users.map((u) => [u.userId, { ...u }]));
  const recordsById = new Map<string, MockRecord>(config.records.map((r) => [r.recordId, { ...r }]));
  const trackingByKey = new Map<string, MockTrackingRecord>(
    config.tracking.map((t) => [`${t.userId}#${t.quarter}`, { ...t }]),
  );

  const consumedWrites: string[] = []; // recordId of every successful consumedForQuarter write
  const pendingExitWrites: string[] = []; // userId of every markUserPendingExit write
  const notificationSends: string[] = []; // userId passed to sendUGLExitNotifications (tracked via ScanCommand side channel below)

  const client = {
    send: async (command: any) => {
      const input = command.input ?? command;
      const name = command.constructor?.name;

      if (name === 'QueryCommand') {
        if (input.TableName === TRACKING_TABLE && input.IndexName === 'outcome-gracePeriodDeadline-index') {
          const now = input.ExpressionAttributeValues[':now'];
          const items = Array.from(trackingByKey.values()).filter((t) => t.outcome === 'pending' && t.gracePeriodDeadline <= now);
          return { Items: items.map((t) => ({ ...t })) };
        }
        if (input.TableName === POINTS_RECORDS_TABLE && input.IndexName === 'userId-createdAt-index') {
          const uid = input.ExpressionAttributeValues[':uid'];
          const sentAt = input.ExpressionAttributeValues[':sentAt'];
          const deadline = input.ExpressionAttributeValues[':deadline'];
          const items = Array.from(recordsById.values()).filter(
            (r) =>
              r.userId === uid &&
              r.targetRole === 'UserGroupLeader' &&
              !r.consumedForQuarter &&
              r.createdAt >= sentAt &&
              r.createdAt <= deadline,
          );
          return { Items: items.map((r) => ({ ...r })) };
        }
        if (input.TableName === USERS_TABLE && input.IndexName === 'entityType-createdAt-index') {
          return { Items: Array.from(usersById.values()).map((u) => ({ ...u })) };
        }
        if (input.TableName === POINTS_RECORDS_TABLE && input.IndexName === 'type-createdAt-index') {
          return { Items: [] }; // no pre-existing "earn" activity for the detection-job leg
        }
        throw new Error(`Unsupported QueryCommand in mock: ${JSON.stringify(input)}`);
      }

      if (name === 'UpdateCommand') {
        if (input.TableName === POINTS_RECORDS_TABLE) {
          const recordId = input.Key.recordId as string;
          const record = recordsById.get(recordId);
          if (!record) throw new Error(`Unknown recordId in mock: ${recordId}`);
          if (record.consumedForQuarter) {
            const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
          record.consumedForQuarter = input.ExpressionAttributeValues[':quarter'];
          consumedWrites.push(recordId);
          return {};
        }
        if (input.TableName === TRACKING_TABLE) {
          const key = `${input.Key.userId}#${input.Key.quarter}`;
          const tracking = trackingByKey.get(key);
          if (!tracking) throw new Error(`Unknown tracking key in mock: ${key}`);
          if (tracking.outcome !== 'pending') {
            const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
          tracking.outcome = input.ExpressionAttributeValues[':target'];
          if (input.ExpressionAttributeValues[':consumedRecordId'] !== undefined) {
            tracking.consumedRecordId = input.ExpressionAttributeValues[':consumedRecordId'];
          }
          return {};
        }
        if (input.TableName === USERS_TABLE) {
          const userId = input.Key.userId as string;
          const user = usersById.get(userId);
          if (!user) throw new Error(`Unknown userId in mock: ${userId}`);
          user.uglExitStatus = input.ExpressionAttributeValues[':status'];
          user.uglExitTriggeredQuarter = input.ExpressionAttributeValues[':quarter'];
          user.uglExitMarkedAt = input.ExpressionAttributeValues[':markedAt'];
          pendingExitWrites.push(userId);
          return {};
        }
        throw new Error(`Unsupported UpdateCommand table in mock: ${input.TableName}`);
      }

      if (name === 'PutCommand') {
        // Only exercised by the detection-job leg of Property 10 (claimReminderSlot).
        const userId = input.Item.userId as string;
        const key = `${userId}#${input.Item.quarter}`;
        if (trackingByKey.has(key)) {
          const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
        trackingByKey.set(key, { ...input.Item });
        return {};
      }

      if (name === 'GetCommand') {
        if (input.TableName === USERS_TABLE) {
          if (input.Key.userId === 'feature-toggles') {
            return {}; // no Item -> getFeatureToggles falls back to defaults (toggles enabled)
          }
          const user = usersById.get(input.Key.userId);
          return user ? { Item: { ...user } } : {};
        }
        if (input.TableName === EMAIL_TEMPLATES_TABLE) {
          return {
            Item: {
              templateId: input.Key.templateId,
              locale: input.Key.locale,
              subject: 'Subject {{nickname}}',
              body: 'Body {{detectionQuarter}}',
            },
          };
        }
        throw new Error(`Unsupported GetCommand table in mock: ${input.TableName}`);
      }

      if (name === 'ScanCommand') {
        if (input.TableName === USERS_TABLE) {
          return { Items: Array.from(usersById.values()).map((u) => ({ ...u })) };
        }
        throw new Error(`Unsupported ScanCommand table in mock: ${input.TableName}`);
      }

      throw new Error(`Unsupported command in mock: ${name}`);
    },
  };

  return { client, usersById, recordsById, trackingByKey, consumedWrites, pendingExitWrites };
}

function createMockSesClient() {
  const sentTo: string[] = [];
  return {
    sesClient: {
      send: async (command: any) => {
        const to = command.input?.Destination?.ToAddresses?.[0];
        sentTo.push(to);
        return {};
      },
    } as any,
    sentTo,
  };
}

function buildContext(dynamoClient: any, sesClient: any): UGLExitServiceContext {
  return {
    dynamoClient,
    sesClient,
    usersTable: USERS_TABLE,
    pointsRecordsTable: POINTS_RECORDS_TABLE,
    trackingTable: TRACKING_TABLE,
    senderEmail: 'noreply@example.com',
    emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
  };
}

const QUARTER = '2025-Q2';
const SENT_AT = '2025-07-01T00:00:00.000Z';
const DEADLINE = '2025-07-31T00:00:00.000Z';
const NOW_AFTER_DEADLINE = '2025-08-01T00:00:00.000Z';

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    userId: 'u1',
    nickname: 'nick1',
    email: 'u1@example.com',
    roles: ['UserGroupLeader'],
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    locale: 'zh',
    ...overrides,
  };
}

function makeTrackingRecord(overrides: Partial<MockTrackingRecord> = {}): MockTrackingRecord {
  return {
    userId: 'u1',
    quarter: QUARTER,
    reminderSentAt: SENT_AT,
    gracePeriodDeadline: DEADLINE,
    outcome: 'pending',
    createdAt: SENT_AT,
    updatedAt: SENT_AT,
    ...overrides,
  };
}

// ============================================================
// Task 8.2 — Property 8 (combined assertion for the grace-period job):
// invoke runGracePeriodEvaluationJob repeatedly against the same in-memory mock DynamoDB
// state for the same due record; assert at most one Exit_Notification is dispatched and
// at most one consumedForQuarter write occurs across all invocations.
//
// **Validates: Requirements 12.3**
// ============================================================
describe('Property 8 (grace-period-job): grace-period evaluation idempotency', () => {
  it('dispatches at most one Exit_Notification across repeated invocations for a not-remedied record', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (invocationCount) => {
        const user = makeUser();
        const tracking = makeTrackingRecord();
        const { client: dynamoClient, pendingExitWrites } = createMockDynamoClient({
          users: [user],
          records: [], // no makeup candidates -> not remedied
          tracking: [tracking],
        });
        const { sesClient, sentTo } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        for (let i = 0; i < invocationCount; i++) {
          await runGracePeriodEvaluationJob(NOW_AFTER_DEADLINE, ctx);
        }

        // Users table pending-exit write happens at most once.
        expect(pendingExitWrites.length).toBe(1);
        // sendUGLExitNotifications is called at most once -> the affected user's email
        // (uglExitNotification) appears among sentTo at most once.
        const userEmailCount = sentTo.filter((email) => email === user.email).length;
        expect(userEmailCount).toBeLessThanOrEqual(1);
        expect(userEmailCount).toBe(1); // exactly one on the first run, since the record is due every time
      }),
      { numRuns: 25 },
    );
  });

  it('sets consumedForQuarter at most once across repeated invocations for a remedied record', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (invocationCount) => {
        const user = makeUser();
        const tracking = makeTrackingRecord();
        const makeupRecord: MockRecord = {
          recordId: 'rec-1',
          userId: user.userId,
          targetRole: 'UserGroupLeader',
          createdAt: '2025-07-10T00:00:00.000Z',
        };
        const { client: dynamoClient, consumedWrites } = createMockDynamoClient({
          users: [user],
          records: [makeupRecord],
          tracking: [tracking],
        });
        const { sesClient } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        for (let i = 0; i < invocationCount; i++) {
          // Each invocation re-queries queryDueReminderRecords, which only returns records
          // still outcome='pending' — once transitioned to 'remedied' it drops out of the
          // due set, so subsequent invocations are no-ops for this record.
          await runGracePeriodEvaluationJob(NOW_AFTER_DEADLINE, ctx);
        }

        expect(consumedWrites.length).toBeLessThanOrEqual(1);
        expect(consumedWrites).toEqual(['rec-1']);
      }),
      { numRuns: 25 },
    );
  });
});

// ============================================================
// Task 8.3 — Feature: ugl-inactivity-exit-flow, Property 10: No unauthorized account or
// role mutation by background jobs
//
// For any sequence of runUGLDetectionJob and runGracePeriodEvaluationJob executions over
// any set of users (with no SuperAdmin review action interleaved), every user's roles
// array and every existing PointsRecord's fields other than consumedForQuarter remain
// byte-for-byte identical before and after the sequence, and no user's account status is
// ever changed to 'disabled' by either job — the only fields either job is permitted to
// write are uglExitStatus, uglExitTriggeredQuarter, uglExitMarkedAt on Users and
// consumedForQuarter on PointsRecords (plus the tracking table).
//
// **Validates: Requirements 8.1, 8.2**
// ============================================================
describe('Property 10: No unauthorized account or role mutation by background jobs', () => {
  it('never mutates roles, status, or non-consumedForQuarter PointsRecord fields across arbitrary job sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            hasMakeup: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.array(fc.constantFrom<'detection' | 'grace'>('detection', 'grace'), { minLength: 1, maxLength: 6 }),
        async (userSpecs, jobSequence) => {
          const users: MockUser[] = userSpecs.map((_, i) => makeUser({ userId: `u${i}`, email: `u${i}@example.com` }));
          const trackingRecords: MockTrackingRecord[] = userSpecs.map((_, i) =>
            makeTrackingRecord({ userId: `u${i}` }),
          );
          const records: MockRecord[] = userSpecs.flatMap((spec, i) =>
            spec.hasMakeup
              ? [
                  {
                    recordId: `rec-${i}`,
                    userId: `u${i}`,
                    targetRole: 'UserGroupLeader',
                    createdAt: '2025-07-10T00:00:00.000Z',
                  },
                ]
              : [],
          );

          // Snapshot the roles/status/record-fields-other-than-consumedForQuarter BEFORE
          // any job runs.
          const rolesBefore = new Map(users.map((u) => [u.userId, [...u.roles]]));
          const statusBefore = new Map(users.map((u) => [u.userId, u.status]));
          const recordFieldsBefore = new Map(
            records.map((r) => [r.recordId, { targetRole: r.targetRole, activityDate: r.activityDate, createdAt: r.createdAt, userId: r.userId }]),
          );

          const { client: dynamoClient, usersById, recordsById } = createMockDynamoClient({
            users,
            records,
            tracking: trackingRecords,
          });
          const { sesClient } = createMockSesClient();
          const ctx = buildContext(dynamoClient, sesClient);

          for (const jobType of jobSequence) {
            if (jobType === 'detection') {
              await runUGLDetectionJob(QUARTER, ctx);
            } else {
              await runGracePeriodEvaluationJob(NOW_AFTER_DEADLINE, ctx);
            }
          }

          // roles and status must remain byte-for-byte identical.
          for (const user of users) {
            const current = usersById.get(user.userId)!;
            expect(current.roles).toEqual(rolesBefore.get(user.userId));
            expect(current.status).toBe(statusBefore.get(user.userId));
            expect(current.status).not.toBe('disabled');
          }

          // Every PointsRecord field other than consumedForQuarter must remain unchanged.
          for (const record of records) {
            const current = recordsById.get(record.recordId)!;
            const before = recordFieldsBefore.get(record.recordId)!;
            expect(current.targetRole).toBe(before.targetRole);
            expect(current.activityDate).toBe(before.activityDate);
            expect(current.createdAt).toBe(before.createdAt);
            expect(current.userId).toBe(before.userId);
          }

          // Only the whitelisted user fields may have been written.
          for (const user of users) {
            const current = usersById.get(user.userId)!;
            const allowedKeys = new Set([
              'userId',
              'nickname',
              'email',
              'roles',
              'status',
              'createdAt',
              'locale',
              'uglExitStatus',
              'uglExitTriggeredQuarter',
              'uglExitMarkedAt',
            ]);
            for (const key of Object.keys(current)) {
              expect(allowedKeys.has(key)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
