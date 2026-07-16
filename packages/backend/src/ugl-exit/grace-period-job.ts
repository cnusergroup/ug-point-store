// UGL grace-period evaluation job — orchestrates the full daily Grace_Period
// outcome evaluation flow: query all due reminder-tracking records -> for each,
// query makeup candidates -> evaluate remedied/not-remedied -> on remedied, mark
// the earliest makeup record consumed; on not-remedied, transition the tracking
// record to 'exited' and (only when this call "won" the idempotency race) mark
// the user as pending-exit and send the Exit_Notification.
//
// See design.md Components and Interfaces section 5 ("Job Orchestration") and the
// "Grace-Period Evaluation Job Flow" sequence diagram for the exact orchestration order.
//
// Per Key Design Decision 2 in design.md: this job NEVER calls setUserStatus or touches
// `roles` — the only fields it is permitted to write are `uglExitStatus`,
// `uglExitTriggeredQuarter`, `uglExitMarkedAt` on Users and `consumedForQuarter` on
// PointsRecords (plus the tracking table). Manual-only account mutation (Req 8) stays
// entirely inside review-actions.ts.

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { queryDueReminderRecords, transitionOutcome } from './reminder-tracking';
import type { ReminderTrackingRecord } from './reminder-tracking';
import { queryMakeupCandidates, evaluateGracePeriodOutcome } from './grace-evaluation';
import { sendUGLExitNotifications } from '../email/notifications';
import type { NotificationContext } from '../email/notifications';
import type { UGLExitServiceContext } from './detection-job';

// ============================================================
// Interfaces
// ============================================================

export interface GracePeriodJobSummary {
  evaluated: number;
  remedied: number;
  markedPendingExit: number;
  skippedAlreadyTransitioned: number;
  errors: number;
}

// ============================================================
// Helpers
// ============================================================

/** Narrows a UGLExitServiceContext down to the shape sendUGLExitNotifications expects. */
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
 * Conditionally sets consumedForQuarter on the earliest makeup record, guarded by
 * attribute_not_exists(consumedForQuarter) so a concurrent/duplicate evaluation run can
 * never double-consume the same record. A ConditionalCheckFailedException here means
 * another run already consumed this record — treated as a no-op, not an error.
 */
async function markRecordConsumed(
  recordId: string,
  quarter: string,
  ctx: UGLExitServiceContext,
): Promise<void> {
  try {
    await ctx.dynamoClient.send(
      new UpdateCommand({
        TableName: ctx.pointsRecordsTable,
        Key: { recordId },
        UpdateExpression: 'SET consumedForQuarter = :quarter',
        ConditionExpression: 'attribute_not_exists(consumedForQuarter)',
        ExpressionAttributeValues: { ':quarter': quarter },
      }),
    );
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    // Already consumed by a prior/concurrent run — no-op.
  }
}

/** Marks a user as Pending_Exit_UGL on the Users table (plain UpdateCommand, no condition needed). */
async function markUserPendingExit(
  userId: string,
  quarter: string,
  markedAt: string,
  ctx: UGLExitServiceContext,
): Promise<void> {
  await ctx.dynamoClient.send(
    new UpdateCommand({
      TableName: ctx.usersTable,
      Key: { userId },
      UpdateExpression:
        'SET uglExitStatus = :status, uglExitTriggeredQuarter = :quarter, uglExitMarkedAt = :markedAt',
      ExpressionAttributeValues: {
        ':status': 'pending_exit',
        ':quarter': quarter,
        ':markedAt': markedAt,
      },
    }),
  );
}

// ============================================================
// Job Orchestration
// ============================================================

/**
 * Runs the full daily grace-period evaluation flow (see design.md's "Grace-Period
 * Evaluation Job Flow" sequence diagram):
 *
 * 1. Query all tracking records due for evaluation (outcome='pending' AND
 *    gracePeriodDeadline <= now).
 * 2. For each due record, query makeup candidates within the grace-period window and
 *    evaluate the outcome:
 *    - Remedied: conditionally mark the earliest makeup record consumed, then
 *      transition the tracking record's outcome to 'remedied'.
 *    - Not remedied: transition the tracking record's outcome to 'exited'. Only when
 *      this call actually "wins" the transition (transitioned: true) does the job
 *      proceed to mark the user pending-exit on the Users table and send the
 *      Exit_Notification — a transitioned: false result means a prior/concurrent run
 *      already handled this record, so this run skips the Users update and the
 *      notification entirely (Req 12.3's dedup guarantee).
 *
 * Per-record processing is wrapped in try/catch: an error for one record is logged
 * and counted, and the loop continues to the next record without aborting the run
 * (Req 12.2 analog).
 */
export async function runGracePeriodEvaluationJob(
  now: string,
  ctx: UGLExitServiceContext,
): Promise<GracePeriodJobSummary> {
  const summary: GracePeriodJobSummary = {
    evaluated: 0,
    remedied: 0,
    markedPendingExit: 0,
    skippedAlreadyTransitioned: 0,
    errors: 0,
  };

  const dueRecords = await queryDueReminderRecords(now, ctx.dynamoClient, ctx.trackingTable);

  for (const trackingRecord of dueRecords) {
    summary.evaluated += 1;
    try {
      await processDueRecord(trackingRecord, now, ctx, summary);
    } catch (err) {
      console.error(
        `[GracePeriodEvaluationJob] Error processing user ${trackingRecord.userId} for quarter ${trackingRecord.quarter}:`,
        err,
      );
      summary.errors += 1;
    }
  }

  return summary;
}

/** Extracted per-record processing so the summary counters stay easy to reason about. */
async function processDueRecord(
  trackingRecord: ReminderTrackingRecord,
  now: string,
  ctx: UGLExitServiceContext,
  summary: GracePeriodJobSummary,
): Promise<void> {
  const { userId, quarter, reminderSentAt, gracePeriodDeadline } = trackingRecord;

  // A due record is always outcome='pending' (queryDueReminderRecords filters on that plus
  // gracePeriodDeadline <= now), so both timestamps are guaranteed set. Guard defensively so
  // the optional fields on ReminderTrackingRecord narrow to string for queryMakeupCandidates.
  if (!reminderSentAt || !gracePeriodDeadline) {
    return;
  }

  const candidates = await queryMakeupCandidates(
    userId,
    reminderSentAt,
    gracePeriodDeadline,
    ctx.dynamoClient,
    ctx.pointsRecordsTable,
  );
  const outcome = evaluateGracePeriodOutcome(candidates);

  if (outcome.remedied) {
    await markRecordConsumed(outcome.record.recordId, quarter, ctx);
    await transitionOutcome(
      userId,
      quarter,
      'remedied',
      { consumedRecordId: outcome.record.recordId },
      ctx.dynamoClient,
      ctx.trackingTable,
    );
    summary.remedied += 1;
    return;
  }

  const { transitioned } = await transitionOutcome(
    userId,
    quarter,
    'exited',
    {},
    ctx.dynamoClient,
    ctx.trackingTable,
  );

  if (!transitioned) {
    // Already handled by a prior/concurrent run — skip the Users update and notification
    // entirely to avoid a duplicate Exit_Notification (Req 12.3).
    summary.skippedAlreadyTransitioned += 1;
    return;
  }

  await markUserPendingExit(userId, quarter, now, ctx);
  await sendUGLExitNotifications(toNotificationContext(ctx), userId, quarter);
  summary.markedPendingExit += 1;
}
