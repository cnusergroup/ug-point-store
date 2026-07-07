// UGLExit Lambda entry point — EventBridge-triggered. Dispatches on event.jobType to
// either the quarterly detection job or the daily grace-period evaluation job.
//
// See design.md section 8 ("Lambda Entry Point") and the "UGLExit Lambda" architecture
// subgraph: two separate EventBridge rules target this same Lambda with different
// `jobType` payloads (mirroring the existing Digest Lambda + EventBridge pattern).
//
// This is a background job, not an API route — there is no caller to receive an error
// response, so per design.md's error-isolation philosophy, invalid input or per-run
// failures are logged and the invocation returns gracefully rather than throwing.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { resolveDetectionQuarter } from './quarter';
import { runUGLDetectionJob } from './detection-job';
import type { UGLExitServiceContext } from './detection-job';
import { runGracePeriodEvaluationJob } from './grace-period-job';

// ============================================================
// Clients (module-level singletons)
// ============================================================

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sesClient = new SESClient({});

// ============================================================
// Environment variables
// ============================================================

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const POINTS_RECORDS_TABLE = process.env.POINTS_RECORDS_TABLE ?? '';
const UGL_REMINDER_TRACKING_TABLE = process.env.UGL_REMINDER_TRACKING_TABLE ?? '';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? '';
const EMAIL_TEMPLATES_TABLE = process.env.EMAIL_TEMPLATES_TABLE ?? '';

const ctx: UGLExitServiceContext = {
  dynamoClient,
  sesClient,
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  trackingTable: UGL_REMINDER_TRACKING_TABLE,
  senderEmail: SENDER_EMAIL,
  emailTemplatesTable: EMAIL_TEMPLATES_TABLE,
};

// ============================================================
// Event shape
// ============================================================

export interface UGLExitJobEvent {
  jobType: 'detection' | 'graceEvaluation';
  /** Only meaningful for jobType='detection'; omitted -> auto-resolved. */
  quarter?: string;
}

// ============================================================
// Handler
// ============================================================

/** EventBridge-triggered handler. Dispatches on event.jobType. */
export async function handler(event: UGLExitJobEvent): Promise<void> {
  if (event.jobType === 'detection') {
    const resolution = resolveDetectionQuarter(event.quarter);
    if (!resolution.valid) {
      console.error(
        `[UGLExit] Invalid detection quarter "${event.quarter}": ${resolution.error.code} - ${resolution.error.message}`,
      );
      return;
    }

    console.log(`[UGLExit] Starting detection job for quarter ${resolution.quarter}`);
    const summary = await runUGLDetectionJob(resolution.quarter, ctx);
    console.log('[UGLExit] Detection job summary:', JSON.stringify(summary));
    return;
  }

  if (event.jobType === 'graceEvaluation') {
    const now = new Date().toISOString();
    console.log(`[UGLExit] Starting grace-period evaluation job at ${now}`);
    const summary = await runGracePeriodEvaluationJob(now, ctx);
    console.log('[UGLExit] Grace-period evaluation job summary:', JSON.stringify(summary));
    return;
  }

  console.error(`[UGLExit] Unrecognized jobType: ${JSON.stringify((event as { jobType?: unknown })?.jobType)}`);
}
