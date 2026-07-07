// UGL review actions module — SuperAdmin-invoked, manual-only account mutation.
// See design.md Components and Interfaces section 6 ("review-actions.ts") for full
// interface definitions and the exact behavior spec.
//
// Per Key Design Decision 2 in design.md: manual-only account mutation (Req 8) stays
// entirely inside this module. Neither the detection job nor the grace-period job ever
// calls setUserStatus or touches `roles` — only confirmExit (invoked exclusively via the
// SuperAdmin-only Confirm_Exit_Action endpoint) does, reusing setUserStatus verbatim from
// ../admin/users.ts.

import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { setUserStatus } from '../admin/users';

// ============================================================
// Interfaces
// ============================================================

export interface ReviewActionResult {
  success: boolean;
  error?: { code: string; message: string };
}

// ============================================================
// Helpers
// ============================================================

/** Loads a user record by id; returns undefined when not found. */
async function loadUser(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await dynamoClient.send(
    new GetCommand({ TableName: usersTable, Key: { userId } }),
  );
  return result.Item;
}

/**
 * Conditionally REMOVEs the three uglExit* tracking fields, guarded by
 * ConditionExpression uglExitStatus = :pending_exit. A ConditionalCheckFailedException
 * here means the record was already cleared by a prior/concurrent call — treated as
 * already-cleared success rather than an error, per design.md (idempotent from the
 * caller's point of view).
 */
async function clearUglExitFields(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<void> {
  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { userId },
        UpdateExpression: 'REMOVE uglExitStatus, uglExitTriggeredQuarter, uglExitMarkedAt',
        ConditionExpression: 'uglExitStatus = :pendingExit',
        ExpressionAttributeValues: { ':pendingExit': 'pending_exit' },
      }),
    );
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }
    // Already cleared by a prior/concurrent call — idempotent success.
  }
}

// ============================================================
// Review Actions
// ============================================================

/**
 * Confirm_Exit_Action (Req 8.1, 10.2, 10.6):
 * 1. Load user; not found -> USER_NOT_FOUND.
 * 2. uglExitStatus !== 'pending_exit' -> NOT_PENDING_EXIT (400), no writes.
 * 3. setUserStatus(userId, 'disabled', ...) — reused verbatim from admin/users.ts. If this
 *    itself fails (e.g. CANNOT_DISABLE_SUPERADMIN), that error is propagated and the
 *    tracking fields are NOT cleared.
 * 4. UpdateCommand REMOVE uglExitStatus, uglExitTriggeredQuarter, uglExitMarkedAt,
 *    ConditionExpression uglExitStatus = :pending_exit (defensive against a concurrent
 *    duplicate call; a ConditionalCheckFailed here is treated as already-cleared and the
 *    action still returns success — idempotent from the caller's point of view).
 */
export async function confirmExit(
  userId: string,
  callerUserId: string,
  callerRoles: string[],
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<ReviewActionResult> {
  const user = await loadUser(userId, dynamoClient, usersTable);
  if (!user) {
    return {
      success: false,
      error: { code: ErrorCodes.USER_NOT_FOUND, message: ErrorMessages.USER_NOT_FOUND },
    };
  }

  if (user.uglExitStatus !== 'pending_exit') {
    return {
      success: false,
      error: { code: ErrorCodes.NOT_PENDING_EXIT, message: ErrorMessages.NOT_PENDING_EXIT },
    };
  }

  const statusResult = await setUserStatus(
    userId,
    'disabled',
    callerUserId,
    callerRoles,
    dynamoClient,
    usersTable,
  );
  if (!statusResult.success) {
    return { success: false, error: statusResult.error };
  }

  await clearUglExitFields(userId, dynamoClient, usersTable);

  return { success: true };
}

/**
 * Restore_Tracking_Action (Req 10.3, 10.4, 10.6):
 * 1. Load user; not found -> USER_NOT_FOUND.
 * 2. uglExitStatus !== 'pending_exit' -> NOT_PENDING_EXIT (400), no writes.
 * 3. UpdateCommand REMOVE uglExitStatus, uglExitTriggeredQuarter, uglExitMarkedAt
 *    (status field is never touched), ConditionExpression uglExitStatus = :pending_exit.
 *    Clearing uglExitStatus is sufficient by itself to make the user pass
 *    filterEligibleUGLsForExit on the next detection run (Req 10.4) — no separate flag
 *    needed. Same idempotent-on-condition-failure treatment as confirmExit.
 */
export async function restoreTracking(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<ReviewActionResult> {
  const user = await loadUser(userId, dynamoClient, usersTable);
  if (!user) {
    return {
      success: false,
      error: { code: ErrorCodes.USER_NOT_FOUND, message: ErrorMessages.USER_NOT_FOUND },
    };
  }

  if (user.uglExitStatus !== 'pending_exit') {
    return {
      success: false,
      error: { code: ErrorCodes.NOT_PENDING_EXIT, message: ErrorMessages.NOT_PENDING_EXIT },
    };
  }

  await clearUglExitFields(userId, dynamoClient, usersTable);

  return { success: true };
}
