// UGL quarterly detection job — orchestrates the full Detection_Quarter flow:
// query all UGL users -> filter to Eligible_UGL -> query qualifying records for the
// quarter -> extract active userIds -> compute Fully_Inactive_UGL set -> for each,
// claim a reminder slot (idempotent) and send the Reminder_Email exactly once.
//
// See design.md Components and Interfaces section 5 ("Job Orchestration") and the
// "Detection Job Flow" sequence diagram for the exact orchestration order.
//
// Shared verbatim between the scheduled Lambda entry point (handler.ts) and the
// manual-trigger Admin route (admin/handler.ts) — there is only one implementation
// of the detection algorithm.

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import {
  queryAllUGLUsersForExit,
  filterEligibleUGLsForExit,
  queryQuarterQualifyingRecords,
  extractActiveUserIdsForQuarter,
  computeFullyInactiveUGLs,
} from './eligibility';
import { claimReminderSlot } from './reminder-tracking';
import { quarterToDateRange, parseQuarter } from './quarter';
import { sendUGLExitReminderEmail } from '../email/notifications';
import type { NotificationContext } from '../email/notifications';

// ============================================================
// Interfaces
// ============================================================

/**
 * Shared DynamoDB/SES/table context for both the detection job and the
 * grace-period evaluation job. A superset of (and structurally compatible
 * with) `NotificationContext` — the fields needed to send email notifications
 * are picked out of this context when calling into email/notifications.ts.
 */
export interface UGLExitServiceContext {
  dynamoClient: DynamoDBDocumentClient;
  sesClient: SESClient;
  usersTable: string;
  pointsRecordsTable: string;
  trackingTable: string;
  senderEmail: string;
  emailTemplatesTable: string;
}

export interface DetectionJobSummary {
  quarter: string;
  eligibleCount: number;
  fullyInactiveCount: number;
  remindersSent: number;
  remindersSkippedAlreadyClaimed: number;
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

// ============================================================
// Job Orchestration
// ============================================================

/**
 * Runs the full quarterly detection flow (see design.md's "Detection Job Flow"
 * sequence diagram):
 *
 * 1. Query all UGL-role users, filter to Eligible_UGL as of quarterStart.
 * 2. Query Qualifying_Points_Records for the quarter window, extract the set of
 *    userIds with at least one such record (the "active" set).
 * 3. Compute Fully_Inactive_UGL = Eligible_UGL - active set.
 * 4. For each Fully_Inactive_UGL, attempt to claim the reminder slot for
 *    (userId, quarter). Claiming is what atomically dedups across repeated/
 *    overlapping job runs (Req 4.5, 12.1) and timestamps the start of the
 *    Grace_Period (Req 4.4). Only a successful claim triggers the Reminder_Email
 *    (Req 4.1, 4.3); an already-claimed slot is skipped without sending.
 *
 * Per-user processing is wrapped in try/catch: an error for one user is logged
 * and counted, and the loop continues to the next user without aborting the
 * run (Req 4.6, 12.2).
 */
export async function runUGLDetectionJob(
  quarter: string,
  ctx: UGLExitServiceContext,
): Promise<DetectionJobSummary> {
  const summary: DetectionJobSummary = {
    quarter,
    eligibleCount: 0,
    fullyInactiveCount: 0,
    remindersSent: 0,
    remindersSkippedAlreadyClaimed: 0,
    errors: 0,
  };

  const parsed = parseQuarter(quarter);
  if (!parsed.valid) {
    throw new Error(`runUGLDetectionJob: invalid quarter "${quarter}": ${parsed.error.message}`);
  }

  const { start: quarterStart, end: quarterEnd } = quarterToDateRange(parsed.year, parsed.quarter);

  const allUGLUsers = await queryAllUGLUsersForExit(ctx.dynamoClient, ctx.usersTable);
  const eligibleUsers = filterEligibleUGLsForExit(allUGLUsers, quarterStart);
  summary.eligibleCount = eligibleUsers.length;

  const qualifyingRecords = await queryQuarterQualifyingRecords(
    ctx.dynamoClient,
    ctx.pointsRecordsTable,
    quarterStart,
    quarterEnd,
  );
  const activeUserIds = extractActiveUserIdsForQuarter(qualifyingRecords, quarterStart, quarterEnd);

  const fullyInactiveUsers = computeFullyInactiveUGLs(eligibleUsers, activeUserIds);
  summary.fullyInactiveCount = fullyInactiveUsers.length;

  const now = new Date().toISOString();

  for (const user of fullyInactiveUsers) {
    try {
      const claimResult = await claimReminderSlot(user.userId, quarter, now, ctx.dynamoClient, ctx.trackingTable);

      if (!claimResult.claimed) {
        summary.remindersSkippedAlreadyClaimed += 1;
        continue;
      }

      const gracePeriodDeadline = claimResult.record!.gracePeriodDeadline;
      // sendUGLExitReminderEmail is itself best-effort (catches and logs its own send
      // errors, never throws — see email/notifications.ts) — Req 4.6's "log and continue
      // on delivery failure" is already satisfied there. Only a genuinely successful send
      // is counted toward remindersSent; the slot remains claimed either way (Req 4.5).
      const { sent } = await sendUGLExitReminderEmail(
        toNotificationContext(ctx),
        user.userId,
        quarter,
        gracePeriodDeadline,
      );
      if (sent) {
        summary.remindersSent += 1;
      }
    } catch (err) {
      console.error(`[UGLDetectionJob] Error processing user ${user.userId} for quarter ${quarter}:`, err);
      summary.errors += 1;
    }
  }

  return summary;
}
