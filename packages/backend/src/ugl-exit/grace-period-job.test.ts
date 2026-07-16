import { describe, it, expect } from 'vitest';
import { runUGLDetectionJob } from './detection-job';
import { runGracePeriodEvaluationJob } from './grace-period-job';
import type { UGLExitServiceContext } from './detection-job';
import { claimAndStartGracePeriod } from './reminder-tracking';
import { sendUGLExitReminderEmail } from '../email/notifications';

// ============================================================
// Happy-path end-to-end job sequence:
// detection job run over a small mocked dataset -> user recorded as
// 'awaiting_reminder' (no Reminder_Email sent yet) + a single
// Detection_Completion_Notification sent -> a SuperAdmin's Send_Reminder_Action is
// simulated by directly invoking claimAndStartGracePeriod + sendUGLExitReminderEmail
// (the same underlying primitives sendReminderAction — task 4, not yet implemented —
// will use internally) -> tracking record transitions to 'pending' with the
// Grace_Period started -> simulate deadline passed -> grace-period job run with no
// makeup record -> uglExitStatus set + Exit_Notification sent.
//
// Validates: Requirements 4.1, 6.1
// ============================================================

const USERS_TABLE = 'UsersTable';
const POINTS_RECORDS_TABLE = 'PointsRecordsTable';
const TRACKING_TABLE = 'TrackingTable';
const EMAIL_TEMPLATES_TABLE = 'EmailTemplatesTable';

function createMockDynamoClient(users: any[]) {
  const usersById = new Map<string, any>(users.map((u) => [u.userId, { ...u }]));
  const trackingByKey = new Map<string, any>();
  const recordsById = new Map<string, any>();

  const client = {
    send: async (command: any) => {
      const input = command.input ?? command;
      const name = command.constructor?.name;

      if (name === 'QueryCommand') {
        if (input.TableName === USERS_TABLE && input.IndexName === 'entityType-createdAt-index') {
          return { Items: Array.from(usersById.values()).map((u) => ({ ...u })) };
        }
        if (input.TableName === POINTS_RECORDS_TABLE && input.IndexName === 'type-createdAt-index') {
          return { Items: [] }; // no existing activity -> every user is Fully_Inactive_UGL
        }
        if (input.TableName === TRACKING_TABLE && input.IndexName === 'outcome-gracePeriodDeadline-index') {
          const now = input.ExpressionAttributeValues[':now'];
          const items = Array.from(trackingByKey.values()).filter(
            (t: any) => t.outcome === 'pending' && t.gracePeriodDeadline <= now,
          );
          return { Items: items.map((t: any) => ({ ...t })) };
        }
        if (input.TableName === POINTS_RECORDS_TABLE && input.IndexName === 'userId-createdAt-index') {
          return { Items: [] }; // no makeup record -> not remedied
        }
        throw new Error(`Unsupported QueryCommand in mock: ${JSON.stringify(input)}`);
      }

      if (name === 'PutCommand') {
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

      if (name === 'UpdateCommand') {
        if (input.TableName === TRACKING_TABLE) {
          const key = `${input.Key.userId}#${input.Key.quarter}`;
          const tracking = trackingByKey.get(key);
          if (!tracking) throw new Error(`Unknown tracking key in mock: ${key}`);
          const values = input.ExpressionAttributeValues;
          const conditionFailed = (): never => {
            const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
            err.name = 'ConditionalCheckFailedException';
            throw err;
          };

          if (':awaitingReminder' in values && ':pending' in values && !(':expected' in values)) {
            // claimAndStartGracePeriod: 'awaiting_reminder' -> 'pending'
            if (tracking.outcome !== 'awaiting_reminder') conditionFailed();
            tracking.outcome = 'pending';
            tracking.reminderSentAt = values[':now'];
            tracking.gracePeriodDeadline = values[':deadline'];
            tracking.updatedAt = values[':now'];
            return { Attributes: { ...tracking } };
          }

          if (':expected' in values) {
            // revertToAwaitingReminder: 'pending' -> 'awaiting_reminder'
            if (tracking.outcome !== 'pending' || tracking.reminderSentAt !== values[':expected']) {
              conditionFailed();
            }
            tracking.outcome = 'awaiting_reminder';
            delete tracking.reminderSentAt;
            delete tracking.gracePeriodDeadline;
            tracking.updatedAt = values[':updatedAt'];
            return {};
          }

          if (':target' in values) {
            // transitionOutcome: 'pending' -> target ('remedied' | 'exited')
            if (tracking.outcome !== 'pending') conditionFailed();
            tracking.outcome = values[':target'];
            if (input.ExpressionAttributeValues[':consumedRecordId'] !== undefined) {
              tracking.consumedRecordId = values[':consumedRecordId'];
            }
            return {};
          }

          throw new Error(`Unsupported UpdateCommand shape for TRACKING_TABLE in mock: ${JSON.stringify(values)}`);
        }
        if (input.TableName === USERS_TABLE) {
          const userId = input.Key.userId as string;
          const user = usersById.get(userId);
          if (!user) throw new Error(`Unknown userId in mock: ${userId}`);
          user.uglExitStatus = input.ExpressionAttributeValues[':status'];
          user.uglExitTriggeredQuarter = input.ExpressionAttributeValues[':quarter'];
          user.uglExitMarkedAt = input.ExpressionAttributeValues[':markedAt'];
          return {};
        }
        if (input.TableName === POINTS_RECORDS_TABLE) {
          const recordId = input.Key.recordId as string;
          const record = recordsById.get(recordId);
          if (!record) throw new Error(`Unknown recordId in mock: ${recordId}`);
          record.consumedForQuarter = input.ExpressionAttributeValues[':quarter'];
          return {};
        }
        throw new Error(`Unsupported UpdateCommand table in mock: ${input.TableName}`);
      }

      if (name === 'GetCommand') {
        if (input.TableName === USERS_TABLE) {
          if (input.Key.userId === 'feature-toggles') {
            return {};
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
              body: 'Body {{detectionQuarter}} {{gracePeriodDeadline}}',
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

  return { client, usersById, trackingByKey };
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

describe('Happy-path end-to-end job sequence', () => {
  it('detection job records awaiting_reminder + sends completion notification; Send_Reminder_Action primitives start the grace period; grace-period job (no makeup) marks pending-exit + sends Exit_Notification', async () => {
    const QUARTER = '2025-Q2';
    const user = {
      userId: 'u1',
      nickname: 'Nick',
      email: 'u1@example.com',
      roles: ['UserGroupLeader'],
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      locale: 'zh',
    };

    const { client: dynamoClient, usersById, trackingByKey } = createMockDynamoClient([user]);
    const { sesClient, sentTo } = createMockSesClient();

    const ctx: UGLExitServiceContext = {
      dynamoClient: dynamoClient as any,
      sesClient,
      usersTable: USERS_TABLE,
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      trackingTable: TRACKING_TABLE,
      senderEmail: 'noreply@example.com',
      emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
    };

    // Step 1: run the detection job — user has zero qualifying activity, so it should
    // be classified Fully_Inactive_UGL and recorded as an Awaiting_Reminder_UGL. No
    // Reminder_Email is sent as a result of this classification (Req 4.1) — the mock has
    // no SuperAdmins/additional recipients, so the Detection_Completion_Notification the
    // job always sends (Req 6.1) is a no-op that doesn't throw and delivers to nobody.
    const detectionSummary = await runUGLDetectionJob(QUARTER, ctx);
    expect(detectionSummary.fullyInactiveCount).toBe(1);
    expect(detectionSummary.awaitingReminderRecorded).toBe(1);
    expect(sentTo).not.toContain(user.email);

    const trackingKey = `${user.userId}#${QUARTER}`;
    const awaitingReminderRecord = trackingByKey.get(trackingKey);
    expect(awaitingReminderRecord).toBeDefined();
    expect(awaitingReminderRecord.outcome).toBe('awaiting_reminder');
    expect(awaitingReminderRecord.reminderSentAt).toBeUndefined();
    expect(awaitingReminderRecord.gracePeriodDeadline).toBeUndefined();

    // Step 2: simulate a SuperAdmin's Send_Reminder_Action for this entry. sendReminderAction
    // (task 4) is not yet implemented, so invoke the exact same underlying primitives it will
    // use internally: claimAndStartGracePeriod (atomically transitions the tracking record to
    // 'pending' and computes reminderSentAt/gracePeriodDeadline), then sendUGLExitReminderEmail.
    const sendNow = new Date().toISOString();
    const claimResult = await claimAndStartGracePeriod(
      user.userId,
      QUARTER,
      sendNow,
      dynamoClient as any,
      TRACKING_TABLE,
    );
    expect(claimResult.claimed).toBe(true);
    expect(claimResult.record).toBeDefined();
    expect(claimResult.record!.gracePeriodDeadline).toBeDefined();

    const reminderResult = await sendUGLExitReminderEmail(
      {
        sesClient,
        dynamoClient: dynamoClient as any,
        emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
        usersTable: USERS_TABLE,
        senderEmail: 'noreply@example.com',
      },
      user.userId,
      QUARTER,
      claimResult.record!.gracePeriodDeadline!,
    );
    expect(reminderResult.sent).toBe(true);
    expect(sentTo).toContain(user.email);

    const pendingTrackingRecord = trackingByKey.get(trackingKey);
    expect(pendingTrackingRecord.outcome).toBe('pending');
    expect(pendingTrackingRecord.reminderSentAt).toBe(sendNow);
    expect(pendingTrackingRecord.gracePeriodDeadline).toBeDefined();

    // Step 3: simulate the deadline having passed — evaluate at a "now" past the
    // recorded gracePeriodDeadline.
    const now = new Date(new Date(pendingTrackingRecord.gracePeriodDeadline).getTime() + 1000).toISOString();

    // Step 4: run the grace-period job — no makeup record exists, so the user should
    // be marked pending-exit and receive the Exit_Notification (plus any SuperAdmins,
    // of which there are none here).
    const graceSummary = await runGracePeriodEvaluationJob(now, ctx);
    expect(graceSummary.evaluated).toBe(1);
    expect(graceSummary.remedied).toBe(0);
    expect(graceSummary.markedPendingExit).toBe(1);

    const updatedUser = usersById.get(user.userId);
    expect(updatedUser.uglExitStatus).toBe('pending_exit');
    expect(updatedUser.uglExitTriggeredQuarter).toBe(QUARTER);
    expect(updatedUser.uglExitMarkedAt).toBeDefined();

    expect(trackingByKey.get(trackingKey).outcome).toBe('exited');

    // sendUGLExitNotifications sends uglExitNotification to the affected user (email
    // present in sentTo a second time, from this second job run).
    const userEmailCount = sentTo.filter((email) => email === user.email).length;
    expect(userEmailCount).toBe(2); // once for the reminder, once for the exit notification
  });
});
