import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runUGLDetectionJob, UGLExitServiceContext } from './detection-job';

// ============================================================
// In-memory mock DynamoDB client
// ============================================================
//
// Backs three "tables" used by runUGLDetectionJob's full call chain:
// - usersTable: queried via entityType-createdAt-index (queryAllUGLUsersForExit) and
//   fetched via GetCommand by userId (loadUser in email/notifications.ts, plus the
//   feature-toggles record lookup done by getFeatureToggles).
// - pointsRecordsTable: queried via type-createdAt-index (queryQuarterQualifyingRecords).
// - trackingTable: written via a conditional PutCommand (claimReminderSlot), simulating
//   real DynamoDB's attribute_not_exists(userId) conditional-write semantics so that only
//   the first claim for a given (userId, quarter) succeeds.
// - emailTemplatesTable: fetched via GetCommand by (templateId, locale) — always returns
//   a minimal template so sendUGLExitReminderEmail can proceed to "send".
//
// A `putAttempts` counter and a `failingUserIds` set let Property 5's test inject
// per-user PutCommand failures (a non-ConditionalCheckFailedException error) to simulate
// a DB error during per-user processing, while still recording that the attempt happened.

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
        return {};
      }

      if (name === 'GetCommand') {
        if (input.TableName === config.usersTable) {
          if (input.Key.userId === 'feature-toggles') {
            return {}; // no Item -> getFeatureToggles falls back to defaults (toggle enabled)
          }
          const user = config.users.find((u) => u.userId === input.Key.userId);
          return user ? { Item: { ...user } } : {};
        }
        if (input.TableName === config.emailTemplatesTable) {
          return {
            Item: {
              templateId: input.Key.templateId,
              locale: input.Key.locale,
              subject: 'Subject {{nickname}}',
              body: 'Body {{detectionQuarter}} {{gracePeriodDeadline}}',
            },
          };
        }
        throw new Error(`Unsupported GetCommand in mock: ${JSON.stringify(input)}`);
      }

      throw new Error(`Unsupported command in mock: ${name}`);
    },
  };

  return { client, trackingItems, putAttempts };
}

function createMockSesClient(failingEmails?: Set<string>) {
  const sentTo: string[] = [];
  return {
    sesClient: {
      send: async (command: any) => {
        const to = command.input?.Destination?.ToAddresses?.[0];
        if (failingEmails?.has(to)) {
          throw new Error(`Simulated SES failure for ${to}`);
        }
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
// Feature: ugl-inactivity-exit-flow, Property 4: Reminder dispatch correctness and idempotency
//
// For any set of Fully_Inactive_UGL users and any number of times runUGLDetectionJob is
// invoked for the SAME quarter (sequentially, simulating retries/overlapping executions),
// across all invocations combined: (a) exactly one Reminder_Email is sent per
// Fully_Inactive_UGL for that quarter, (b) no user outside the Fully_Inactive_UGL set ever
// receives one, and (c) the persisted gracePeriodDeadline for each such user equals
// reminderSentAt + 30 days, computed once at the first successful claim and never
// recomputed on subsequent runs.
//
// **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 12.1**
// ============================================================
describe('Property 4: Reminder dispatch correctness and idempotency', () => {
  it('sends exactly one email per Fully_Inactive_UGL across repeated invocations, and gracePeriodDeadline is fixed after the first claim', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 5 }),
        async (userCount, invocationCount) => {
          const users = makeUsers(userCount);
          const { client: dynamoClient, trackingItems } = createMockDynamoClient({
            usersTable: 'UsersTable',
            pointsRecordsTable: 'PointsRecordsTable',
            trackingTable: 'TrackingTable',
            emailTemplatesTable: 'EmailTemplatesTable',
            users,
            qualifyingRecords: [], // no activity records -> every user is Fully_Inactive_UGL
          });
          const { sesClient, sentTo } = createMockSesClient();
          const ctx = buildContext(dynamoClient, sesClient);

          const deadlinesAfterFirstRun = new Map<string, string>();

          for (let i = 0; i < invocationCount; i++) {
            await runUGLDetectionJob(QUARTER, ctx);

            if (i === 0) {
              for (const user of users) {
                const key = `${user.userId}#${QUARTER}`;
                deadlinesAfterFirstRun.set(user.userId, trackingItems.get(key)?.gracePeriodDeadline);
              }
            } else {
              // gracePeriodDeadline must never change on subsequent invocations.
              for (const user of users) {
                const key = `${user.userId}#${QUARTER}`;
                expect(trackingItems.get(key)?.gracePeriodDeadline).toBe(deadlinesAfterFirstRun.get(user.userId));
              }
            }
          }

          // Exactly one email sent per Fully_Inactive_UGL, across all invocations combined.
          const sentCounts = new Map<string, number>();
          for (const email of sentTo) {
            sentCounts.set(email, (sentCounts.get(email) ?? 0) + 1);
          }
          for (const user of users) {
            expect(sentCounts.get(user.email)).toBe(1);
          }
          // No user outside the Fully_Inactive_UGL set ever receives one.
          expect(sentTo.length).toBe(users.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 5: Per-user error isolation in the detection job
//
// For any sequence of N eligible users where an arbitrary subset throw an error during
// per-user processing (e.g. a simulated send failure or DB error), runUGLDetectionJob still
// attempts processing for all N users — the total number of per-user processing attempts
// equals N regardless of how many of them fail, and no failure aborts the remaining loop
// iterations.
//
// **Validates: Requirements 4.6, 12.2**
// ============================================================
describe('Property 5: Per-user error isolation in the detection job', () => {
  it('attempts processing for all N users regardless of an arbitrary failing subset (DB failure during claim)', async () => {
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
        const { sesClient, sentTo } = createMockSesClient();
        const ctx = buildContext(dynamoClient, sesClient);

        const summary = await runUGLDetectionJob(QUARTER, ctx);

        // Every user was attempted exactly once, regardless of whether it failed.
        for (const user of users) {
          expect(putAttempts.get(user.userId)).toBe(1);
        }
        expect(putAttempts.size).toBe(n);

        // errors count matches exactly the failing subset; the rest sent successfully.
        expect(summary.errors).toBe(failingUserIds.size);
        expect(summary.remindersSent).toBe(n - failingUserIds.size);
        expect(sentTo.length).toBe(n - failingUserIds.size);
      }),
      { numRuns: 50 },
    );
  });

  it('attempts processing (claim) for all N users regardless of an arbitrary failing send subset (SES send failure)', async () => {
    // sendUGLExitReminderEmail is itself best-effort (catches and logs its own SES errors,
    // never throws — see email/notifications.ts). A send failure therefore does NOT count
    // toward the job's `errors` field, but every user's reminder-slot claim must still have
    // been attempted regardless of which subset failed to send.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }), async (n, failFlags) => {
        const users = makeUsers(n);
        const failingEmails = new Set<string>();
        users.forEach((u, i) => {
          if (failFlags[i % failFlags.length]) {
            failingEmails.add(u.email);
          }
        });

        const { client: dynamoClient, putAttempts } = createMockDynamoClient({
          usersTable: 'UsersTable',
          pointsRecordsTable: 'PointsRecordsTable',
          trackingTable: 'TrackingTable',
          emailTemplatesTable: 'EmailTemplatesTable',
          users,
          qualifyingRecords: [],
        });
        const { sesClient, sentTo } = createMockSesClient(failingEmails);
        const ctx = buildContext(dynamoClient, sesClient);

        const summary = await runUGLDetectionJob(QUARTER, ctx);

        // Every user still had its claim attempted exactly once, even though sending failed for some.
        for (const user of users) {
          expect(putAttempts.get(user.userId)).toBe(1);
        }

        expect(summary.errors).toBe(0);
        expect(summary.remindersSent).toBe(n - failingEmails.size);
        expect(sentTo.length).toBe(n - failingEmails.size);
      }),
      { numRuns: 50 },
    );
  });
});
