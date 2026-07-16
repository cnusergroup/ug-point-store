import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// ============================================================
// Mock '../email/notifications' for Property 5 (below) — spies on
// sendUGLExitReminderEmail and sendDetectionCompletionNotification so we can assert
// call counts/arguments directly. vi.mock is hoisted to the top of this module, so
// this mock also applies to Property 4 above; Property 4 only asserts against
// tracking-table state and summary counts (never against sentTo or any other
// behavior specific to the real sendDetectionCompletionNotification implementation),
// so replacing it with a no-op spy does not affect Property 4's assertions.
const { sendUGLExitReminderEmailMock, sendDetectionCompletionNotificationMock } = vi.hoisted(() => ({
  sendUGLExitReminderEmailMock: vi.fn(async () => ({ sent: true })),
  sendDetectionCompletionNotificationMock: vi.fn(async () => ({ recipientsSent: 0, recipientsFailed: 0 })),
}));

vi.mock('../email/notifications', () => ({
  sendUGLExitReminderEmail: sendUGLExitReminderEmailMock,
  sendDetectionCompletionNotification: sendDetectionCompletionNotificationMock,
}));

import { runUGLDetectionJob, UGLExitServiceContext } from './detection-job';

// ============================================================
// In-memory mock DynamoDB client
// ============================================================
//
// Backs four "tables" used by runUGLDetectionJob's full call chain:
// - usersTable: queried via entityType-createdAt-index (queryAllUGLUsersForExit), Scanned
//   (SuperAdmin lookup inside sendDetectionCompletionNotification), and fetched via
//   GetCommand by userId (the feature-toggles settings record lookup done by
//   getFeatureToggles).
// - pointsRecordsTable: queried via type-createdAt-index (queryQuarterQualifyingRecords).
// - trackingTable: written via a conditional PutCommand (recordAwaitingReminder), simulating
//   real DynamoDB's attribute_not_exists(userId) conditional-write semantics so that only the
//   first recording for a given (userId, quarter) succeeds.
// - emailTemplatesTable: fetched via GetCommand by (templateId, locale) — always returns a
//   minimal uglExitDetectionCompletion template so sendDetectionCompletionNotification can
//   proceed without throwing (it's best-effort and catches its own errors regardless).
//
// A `putAttempts`/`putSuccesses` counter and a `failingUserIds` set let the error-isolation
// property inject per-user PutCommand failures (a non-ConditionalCheckFailedException error)
// to simulate a DB error during per-user processing, while still recording that the attempt
// happened.

interface MockUser {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
  status: string;
  createdAt: string;
  locale?: string;
}

function createMockDynamoClient(config: {
  usersTable: string;
  pointsRecordsTable: string;
  trackingTable: string;
  emailTemplatesTable: string;
  users: MockUser[];
  qualifyingRecords: unknown[];
  failingUserIds?: Set<string>;
}) {
  const trackingItems = new Map<string, any>();
  const putAttempts = new Map<string, number>();
  const putSuccesses = new Map<string, number>();
  const failingUserIds = config.failingUserIds ?? new Set<string>();

  const client = {
    send: async (command: any) => {
      const input = command.input ?? command;
      const name = command.constructor?.name;

      if (name === 'QueryCommand') {
        if (input.TableName === config.usersTable && input.IndexName === 'entityType-createdAt-index') {
          return { Items: config.users.map((u) => ({ ...u })) };
        }
        if (input.TableName === config.pointsRecordsTable && input.IndexName === 'type-createdAt-index') {
          return { Items: config.qualifyingRecords.map((r) => ({ ...(r as object) })) };
        }
        throw new Error(`Unsupported QueryCommand in mock: ${JSON.stringify(input)}`);
      }

      if (name === 'ScanCommand') {
        // sendDetectionCompletionNotification's SuperAdmin lookup Scan on usersTable.
        if (input.TableName === config.usersTable) {
          return { Items: config.users.map((u) => ({ ...u })) };
        }
        throw new Error(`Unsupported ScanCommand in mock: ${JSON.stringify(input)}`);
      }

      if (name === 'PutCommand') {
        const userId = input.Item.userId as string;
        const key = `${userId}#${input.Item.quarter}`;
        putAttempts.set(userId, (putAttempts.get(userId) ?? 0) + 1);

        if (failingUserIds.has(userId)) {
          throw new Error(`Simulated DB failure for user ${userId}`);
        }

        if (trackingItems.has(key)) {
          const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }

        trackingItems.set(key, { ...input.Item });
        putSuccesses.set(userId, (putSuccesses.get(userId) ?? 0) + 1);
        return {};
      }

      if (name === 'GetCommand') {
        if (input.TableName === config.usersTable) {
          if (input.Key.userId === 'feature-toggles') {
            return {}; // no Item -> getFeatureToggles falls back to defaults (toggle enabled, no additional recipients)
          }
          const user = config.users.find((u) => u.userId === input.Key.userId);
          return user ? { Item: { ...user } } : {};
        }
        if (input.TableName === config.emailTemplatesTable) {
          return {
            Item: {
              templateId: input.Key.templateId,
              locale: input.Key.locale,
              subject: 'Detection complete {{detectionQuarter}}',
              body: 'Quarter {{detectionQuarter}} recorded {{newlyRecordedCount}} new entries',
            },
          };
        }
        throw new Error(`Unsupported GetCommand in mock: ${JSON.stringify(input)}`);
      }

      throw new Error(`Unsupported command in mock: ${name}`);
    },
  };

  return { client, trackingItems, putAttempts, putSuccesses };
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

const QUARTER = '2025-Q2';
const CREATED_BEFORE_QUARTER = '2025-01-01T00:00:00.000Z';

function makeUsers(n: number): MockUser[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    nickname: `nick${i}`,
    email: `user${i}@example.com`,
    roles: ['UserGroupLeader'],
    status: 'active',
    createdAt: CREATED_BEFORE_QUARTER,
    locale: 'zh',
  }));
}

function buildContext(mockClient: ReturnType<typeof createMockDynamoClient>['client'], sesClient: any): UGLExitServiceContext {
  return {
    dynamoClient: mockClient as any,
    sesClient,
    usersTable: 'UsersTable',
    pointsRecordsTable: 'PointsRecordsTable',
    trackingTable: 'TrackingTable',
    senderEmail: 'noreply@example.com',
    emailTemplatesTable: 'EmailTemplatesTable',
  };
}

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 4: Awaiting-reminder recording idempotency and error isolation
//
// For any set of Fully_Inactive_UGL users and any number of times runUGLDetectionJob is
// invoked for the SAME quarter (sequentially, simulating retries/overlapping executions):
// exactly one `awaiting_reminder` tracking record is created per Fully_Inactive_UGL across
// all invocations combined, the record's outcome stays 'awaiting_reminder' with no
// reminderSentAt/gracePeriodDeadline ever set (this job never sends the Reminder_Email and
// never starts a Grace_Period), and any subsequent invocation for the same quarter attempts
// but skips recording for users already recorded.
//
// Also: for any N eligible users where an arbitrary subset fail during per-user recording
// (a simulated DB error), the job still attempts recording for all N users regardless of how
// many fail, with `summary.errors` matching the failing subset size and
// `summary.awaitingReminderRecorded` matching the successful subset size.
//
// **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 15.1, 15.2**
// ============================================================
describe('Property 4: Awaiting-reminder recording idempotency and error isolation', () => {
  it('creates exactly one awaiting_reminder tracking record per Fully_Inactive_UGL across repeated invocations, never sets reminderSentAt/gracePeriodDeadline, and never sends the Reminder_Email', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 5 }),
        async (userCount, invocationCount) => {
          const users = makeUsers(userCount);
          const { client: dynamoClient, trackingItems, putSuccesses } = createMockDynamoClient({
            usersTable: 'UsersTable',
            pointsRecordsTable: 'PointsRecordsTable',
            trackingTable: 'TrackingTable',
            emailTemplatesTable: 'EmailTemplatesTable',
            users,
            qualifyingRecords: [], // no activity records -> every user is Fully_Inactive_UGL
          });
          const { sesClient } = createMockSesClient();
          const ctx = buildContext(dynamoClient, sesClient);

          for (let i = 0; i < invocationCount; i++) {
            const summary = await runUGLDetectionJob(QUARTER, ctx);

            if (i === 0) {
              expect(summary.awaitingReminderRecorded).toBe(userCount);
              expect(summary.awaitingReminderSkippedAlreadyRecorded).toBe(0);
            } else {
              // Every subsequent invocation for the same quarter finds all users already
              // recorded — no new recordings, no duplicates.
              expect(summary.awaitingReminderRecorded).toBe(0);
              expect(summary.awaitingReminderSkippedAlreadyRecorded).toBe(userCount);
            }
          }

          // Exactly one successful PutCommand (i.e. one created record) per user, across all
          // invocations combined — regardless of how many invocations ran.
          for (const user of users) {
            expect(putSuccesses.get(user.userId)).toBe(1);
          }

          // The tracking record stays in outcome='awaiting_reminder' with no
          // reminderSentAt/gracePeriodDeadline ever set — this job never starts a Grace_Period.
          for (const user of users) {
            const key = `${user.userId}#${QUARTER}`;
            const record = trackingItems.get(key);
            expect(record).toBeDefined();
            expect(record.outcome).toBe('awaiting_reminder');
            expect(record.reminderSentAt).toBeUndefined();
            expect(record.gracePeriodDeadline).toBeUndefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('attempts recording for all N users regardless of an arbitrary failing subset (DB failure during recording)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }), async (n, failFlags) => {
        const users = makeUsers(n);
        const failingUserIds = new Set<string>();
        users.forEach((u, i) => {
          if (failFlags[i % failFlags.length]) {
            failingUserIds.add(u.userId);
          }
        });

        const { client: dynamoClient, putAttempts } = createMockDynamoClient({
          usersTable: 'UsersTable',
          pointsRecordsTable: 'PointsRecordsTable',
          trackingTable: 'TrackingTable',
          emailTemplatesTable: 'EmailTemplatesTable',
          users,
          qualifyingRecords: [],
          failingUserIds,
        });
        const { sesClient } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        const summary = await runUGLDetectionJob(QUARTER, ctx);

        // Every user was attempted exactly once, regardless of whether it failed.
        for (const user of users) {
          expect(putAttempts.get(user.userId)).toBe(1);
        }
        expect(putAttempts.size).toBe(n);

        // errors count matches exactly the failing subset; the rest recorded successfully.
        expect(summary.errors).toBe(failingUserIds.size);
        expect(summary.awaitingReminderRecorded).toBe(n - failingUserIds.size);
      }),
      { numRuns: 50 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 5: Detection job never sends the Reminder_Email; always sends the Detection_Completion_Notification
//
// For any set of Fully_Inactive_UGL users (including the empty set), a single
// runUGLDetectionJob invocation:
// - never calls sendUGLExitReminderEmail (this job only records Awaiting_Reminder_UGL
//   entries; the Reminder_Email is sent exclusively by a SuperAdmin's later
//   Send_Reminder_Action, never automatically by detection)
// - calls sendDetectionCompletionNotification exactly once, with the run's quarter and
//   the exact awaitingReminderRecorded count from the run's own summary — including when
//   that count is zero (e.g. an empty Fully_Inactive_UGL set, or every user already
//   recorded from a prior run for the same quarter).
//
// **Validates: Requirements 4.1, 6.1, 6.2**
// ============================================================
describe('Property 5: Detection job never sends the Reminder_Email; always sends the Detection_Completion_Notification', () => {
  it('never calls sendUGLExitReminderEmail and calls sendDetectionCompletionNotification exactly once with the correct count, for any set of Fully_Inactive_UGL users (including empty)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (userCount) => {
        sendUGLExitReminderEmailMock.mockClear();
        sendDetectionCompletionNotificationMock.mockClear();

        const users = makeUsers(userCount);
        const { client: dynamoClient } = createMockDynamoClient({
          usersTable: 'UsersTable',
          pointsRecordsTable: 'PointsRecordsTable',
          trackingTable: 'TrackingTable',
          emailTemplatesTable: 'EmailTemplatesTable',
          users,
          qualifyingRecords: [], // no activity records -> every user is Fully_Inactive_UGL
        });
        const { sesClient } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        const summary = await runUGLDetectionJob(QUARTER, ctx);

        // The Reminder_Email is never sent as a direct result of the detection job.
        expect(sendUGLExitReminderEmailMock).toHaveBeenCalledTimes(0);

        // The Detection_Completion_Notification is always sent exactly once per run,
        // with the run's own awaitingReminderRecorded count (correct even when zero).
        expect(sendDetectionCompletionNotificationMock).toHaveBeenCalledTimes(1);
        expect(sendDetectionCompletionNotificationMock).toHaveBeenCalledWith(
          expect.anything(),
          QUARTER,
          summary.awaitingReminderRecorded,
        );
        expect(summary.awaitingReminderRecorded).toBe(userCount);
      }),
      { numRuns: 50 },
    );
  });

  it('still calls sendDetectionCompletionNotification exactly once with count zero when every Fully_Inactive_UGL user is already recorded from a prior run (empty-set-equivalent for this run)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), async (userCount) => {
        sendUGLExitReminderEmailMock.mockClear();
        sendDetectionCompletionNotificationMock.mockClear();

        const users = makeUsers(userCount);
        const { client: dynamoClient } = createMockDynamoClient({
          usersTable: 'UsersTable',
          pointsRecordsTable: 'PointsRecordsTable',
          trackingTable: 'TrackingTable',
          emailTemplatesTable: 'EmailTemplatesTable',
          users,
          qualifyingRecords: [],
        });
        const { sesClient } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        // First run records everyone; reset the spies before the second (subject) run.
        await runUGLDetectionJob(QUARTER, ctx);
        sendUGLExitReminderEmailMock.mockClear();
        sendDetectionCompletionNotificationMock.mockClear();

        const summary = await runUGLDetectionJob(QUARTER, ctx);

        expect(sendUGLExitReminderEmailMock).toHaveBeenCalledTimes(0);
        expect(sendDetectionCompletionNotificationMock).toHaveBeenCalledTimes(1);
        expect(summary.awaitingReminderRecorded).toBe(0);
        expect(sendDetectionCompletionNotificationMock).toHaveBeenCalledWith(expect.anything(), QUARTER, 0);
      }),
      { numRuns: 30 },
    );
  });
});
