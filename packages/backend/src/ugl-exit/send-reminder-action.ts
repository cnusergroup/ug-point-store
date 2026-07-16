// UGL Send_Reminder_Action module — the ONLY sender of the Reminder_Email in the codebase
// (design.md Key Decision 3). Invoked exclusively via a SuperAdmin's explicit action against
// the Awaiting_Reminder_List; there is no scheduled path that ever calls this. See design.md
// Components and Interfaces section 5 ("Job Orchestration" -> sendReminderAction) and the
// "Send Reminder Action Flow" sequence diagram for the full behavioral contract.
//
// The critical constraint driving this module's shape is that two requirements pull in
// opposite directions on ordering: Req 15.4 requires that a duplicate/retried
// Send_Reminder_Action call for the same entry never sends a second Reminder_Email (which
// needs an atomic "claim" *before* sending, so two concurrent calls can't both pass a plain
// read-check), while Req 5.8 requires that a failed send leaves the entry back in the
// Awaiting_Reminder_List with the Grace_Period *not* started (which needs the transition to
// only "stick" *after* a successful send). This is resolved with a claim-then-compensate
// pattern: claimAndStartGracePeriod's conditional 'awaiting_reminder' -> 'pending' transition
// (computing reminderSentAt/gracePeriodDeadline) doubles as the atomic claim — it is what makes
// a concurrent duplicate call's own transition attempt fail immediately, before it could ever
// send a second email. If the subsequent send then fails, revertToAwaitingReminder is called
// with the exact reminderSentAt this call's own claim just set, so it can never revert a
// different, later-claimed attempt — restoring the pre-call state so the entry reappears in the
// Awaiting_Reminder_List exactly as Req 5.8 requires.

import { SESClient } from '@aws-sdk/client-ses';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { claimAndStartGracePeriod, revertToAwaitingReminder, queryAwaitingReminderRecords } from './reminder-tracking';
import { sendUGLExitReminderEmail } from '../email/notifications';
import type { NotificationContext } from '../email/notifications';
import type { UGLExitServiceContext } from './detection-job';

// ============================================================
// Interfaces
// ============================================================

export interface SendReminderActionSummary {
  sentCount: number; // successfully claimed + emailed (Req 5.3)
  alreadySentCount: number; // claim failed — not in 'awaiting_reminder' (Req 15.4)
  sendFailedCount: number; // claimed but email delivery failed — reverted (Req 5.8)
  errors: number;
}

// ============================================================
// Helpers
// ============================================================

/** Narrows a UGLExitServiceContext down to the shape sendUGLExitReminderEmail expects. */
function toNotificationContext(ctx: UGLExitServiceContext): NotificationContext {
  return {
    sesClient: ctx.sesClient,
    dynamoClient: ctx.dynamoClient,
    emailTemplatesTable: ctx.emailTemplatesTable,
    usersTable: ctx.usersTable,
    senderEmail: ctx.senderEmail,
  };
}

/**
 * Builds a userId -> quarter map from the full Awaiting_Reminder_List, resolving which
 * (userId, quarter) tracking entry sendReminderAction should claim for each userId. Per
 * design.md's note: if a user somehow has more than one 'awaiting_reminder' entry across
 * different quarters (the dedup mechanism prevents this within a single quarter but not
 * across quarters), the single oldest 'awaiting_reminder' entry for that user (by createdAt)
 * is used.
 */
function buildUserIdToQuarterMap(records: { userId: string; quarter: string; createdAt: string }[]): Map<string, string> {
  const oldestByUserId = new Map<string, { quarter: string; createdAt: string }>();

  for (const record of records) {
    const existing = oldestByUserId.get(record.userId);
    if (!existing || record.createdAt < existing.createdAt) {
      oldestByUserId.set(record.userId, { quarter: record.quarter, createdAt: record.createdAt });
    }
  }

  const result = new Map<string, string>();
  for (const [userId, { quarter }] of oldestByUserId) {
    result.set(userId, quarter);
  }
  return result;
}

// ============================================================
// Job Orchestration
// ============================================================

/**
 * Runs the Send_Reminder_Action for a batch of userIds (see design.md's "Send Reminder Action
 * Flow" sequence diagram for the claim-then-compensate pattern):
 *
 * 1. An empty userIds array is a no-op returning all-zero counts (Req 5.9) — not an error.
 * 2. Otherwise, preloads the full Awaiting_Reminder_List once (queryAwaitingReminderRecords)
 *    and resolves each userId to its (userId, quarter) tracking entry to claim.
 * 3. Per-user try/catch (mirrors the detection job's isolation pattern, Req 4.4 analog): an
 *    error for one user is logged and counted, and the loop continues to the next user without
 *    aborting the run.
 * 4. For a userId with no matching 'awaiting_reminder' entry (e.g. already sent by a concurrent
 *    call, or never was in awaiting_reminder), logs a warning and skips without incrementing any
 *    counter — this is not an error condition, just a no-op for that userId.
 * 5. Otherwise calls claimAndStartGracePeriod. When claimed=false (Req 15.4 — a duplicate/
 *    retried call), increments alreadySentCount and skips. When claimed=true, calls
 *    sendUGLExitReminderEmail: on { sent: true } increments sentCount (Req 5.3, 5.7); on
 *    { sent: false } calls revertToAwaitingReminder with the exact reminderSentAt just claimed
 *    (Req 5.8) and increments sendFailedCount.
 */
export async function sendReminderAction(
  userIds: string[],
  ctx: UGLExitServiceContext,
): Promise<SendReminderActionSummary> {
  const summary: SendReminderActionSummary = {
    sentCount: 0,
    alreadySentCount: 0,
    sendFailedCount: 0,
    errors: 0,
  };

  if (userIds.length === 0) {
    return summary;
  }

  const awaitingReminderRecords = await queryAwaitingReminderRecords(ctx.dynamoClient, ctx.trackingTable);
  const userIdToQuarter = buildUserIdToQuarterMap(awaitingReminderRecords);

  const notificationCtx = toNotificationContext(ctx);

  for (const userId of userIds) {
    try {
      const quarter = userIdToQuarter.get(userId);
      if (quarter === undefined) {
        console.warn(`[SendReminderAction] Skipping user ${userId}: no 'awaiting_reminder' entry found`);
        continue;
      }

      const now = new Date().toISOString();
      const claimResult = await claimAndStartGracePeriod(userId, quarter, now, ctx.dynamoClient, ctx.trackingTable);

      if (!claimResult.claimed) {
        summary.alreadySentCount += 1;
        continue;
      }

      const record = claimResult.record;
      const gracePeriodDeadline = record?.gracePeriodDeadline ?? '';

      const sendResult = await sendUGLExitReminderEmail(notificationCtx, userId, quarter, gracePeriodDeadline);

      if (sendResult.sent) {
        summary.sentCount += 1;
      } else {
        await revertToAwaitingReminder(userId, quarter, now, ctx.dynamoClient, ctx.trackingTable);
        summary.sendFailedCount += 1;
      }
    } catch (err) {
      console.error(`[SendReminderAction] Error processing user ${userId}:`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
