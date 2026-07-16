# Implementation Plan: UGL Inactivity Exit Flow

## Overview

This spec was originally implemented with an auto-send reminder flow (detection job sends the Reminder_Email directly) and has already been merged and is pending deployment. The requirements and design have since been reworked: detection now only **records** an Awaiting_Reminder_UGL entry and sends a Detection_Completion_Notification summary; a SuperAdmin must explicitly review the Awaiting_Reminder_List and invoke a new Send_Reminder_Action before any Reminder_Email is ever sent, and the 30-day Grace_Period now starts at that send moment, not at detection time. This plan covers only the **delta** needed to move the already-implemented auto-send version to the new manual-dispatch version — foundational modules that are unaffected by this behavior change (`quarter.ts`, `eligibility.ts`, `grace-evaluation.ts`, `review-actions.ts`, `pending-exit-list.ts`, the CDK table/Lambda/EventBridge infrastructure, the `ugl-exit/handler.ts` EventBridge dispatcher) are already correct and are marked complete below without further changes.

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. Foundational modules unaffected by the rework (already implemented, verified against new design.md)
  - [x] 1.1 `packages/backend/src/ugl-exit/quarter.ts` and its tests — unchanged, no rework needed
  - [x] 1.2 `packages/backend/src/ugl-exit/eligibility.ts` and its tests — unchanged, no rework needed
  - [x] 1.3 `packages/backend/src/ugl-exit/grace-evaluation.ts` and its tests — unchanged, no rework needed
  - [x] 1.4 `packages/backend/src/ugl-exit/review-actions.ts` and its tests — unchanged, no rework needed
  - [x] 1.5 `packages/backend/src/ugl-exit/pending-exit-list.ts` and its tests — unchanged, no rework needed
  - [x] 1.6 `packages/backend/src/ugl-exit/handler.ts` (EventBridge `jobType` dispatch) and its tests — unchanged, no rework needed
  - [x] 1.7 CDK `PointsMall-UGLReminderTracking` table + `outcome-gracePeriodDeadline-index` GSI + `PointsMall-UGLExit` Lambda + two EventBridge rules — unchanged shape, no new CDK resources needed for this rework (per design.md's GSI sparse-index note)

- [x] 2. Reminder tracking module rewrite — 4-state machine
  - [x] 2.1 Rewrite `packages/backend/src/ugl-exit/reminder-tracking.ts`
    - Change `ReminderOutcome` to `'awaiting_reminder' | 'pending' | 'remedied' | 'exited'`; make `reminderSentAt`/`gracePeriodDeadline` optional on `ReminderTrackingRecord`
    - Replace `claimReminderSlot` with `recordAwaitingReminder(userId, quarter, now, dynamoClient, trackingTable)` — conditional `PutCommand` (`attribute_not_exists(userId)`) creating the record in outcome `'awaiting_reminder'` with NO `reminderSentAt`/`gracePeriodDeadline` set; returns `{ recorded: false }` without writing when a record already exists
    - Add `queryAwaitingReminderRecords(dynamoClient, trackingTable)` — `Scan` with `FilterExpression outcome = 'awaiting_reminder'`, paginated (cannot use the GSI since `gracePeriodDeadline` is absent for these records)
    - Add `claimAndStartGracePeriod(userId, quarter, now, dynamoClient, trackingTable)` — conditional `UpdateCommand` (`outcome = :awaitingReminder`) transitioning to `'pending'` and computing/setting `reminderSentAt=now`, `gracePeriodDeadline=computeGracePeriodDeadline(now)` in the same write; returns `{ claimed: false }` when the condition fails
    - Add `revertToAwaitingReminder(userId, quarter, expectedReminderSentAt, dynamoClient, trackingTable)` — conditional `UpdateCommand` (`outcome = :pending AND reminderSentAt = :expected`) transitioning back to `'awaiting_reminder'` and clearing `reminderSentAt`/`gracePeriodDeadline`; returns `{ reverted: false }` when the condition fails
    - Keep `computeGracePeriodDeadline`, `queryDueReminderRecords`, `transitionOutcome` unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 5.8, 15.1, 15.4_

  - [x]* 2.2 Rewrite property test for reminder-tracking idempotency and add claim/revert coverage
    - **Property 10: Grace-period evaluation idempotency** (unchanged from prior `transitionOutcome` coverage)
    - Update `packages/backend/src/ugl-exit/reminder-tracking.property.test.ts`: keep the existing `transitionOutcome` idempotency property test; add new property coverage for `recordAwaitingReminder` dedup (at most one record created per `(userId, quarter)` across repeated calls) and for `claimAndStartGracePeriod`/`revertToAwaitingReminder` round-tripping back to the exact pre-claim state
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 10: Grace-period evaluation idempotency`
    - **Validates: Requirements 15.1, 15.3, 15.4**

  - [x]* 2.3 Update unit tests for the new state machine
    - Update `packages/backend/src/ugl-exit/reminder-tracking.test.ts`: replace `claimReminderSlot` tests with `recordAwaitingReminder` tests (no `reminderSentAt`/`gracePeriodDeadline` written); add tests for `queryAwaitingReminderRecords` Scan+filter pagination, `claimAndStartGracePeriod` success/already-claimed paths, and `revertToAwaitingReminder` success/stale-expected-timestamp paths
    - _Requirements: 4.3, 5.3, 5.8_

- [x] 3. Detection job rewrite — record only, never send Reminder_Email
  - [x] 3.1 Rewrite `runUGLDetectionJob` in `packages/backend/src/ugl-exit/detection-job.ts`
    - Rename `DetectionJobSummary` fields: `remindersSent`→`awaitingReminderRecorded`, `remindersSkippedAlreadyClaimed`→`awaitingReminderSkippedAlreadyRecorded`
    - Replace the per-user `claimReminderSlot` + `sendUGLExitReminderEmail` call with a single `recordAwaitingReminder` call — remove all calls to `sendUGLExitReminderEmail` from this file entirely
    - After the per-user loop completes (success or partial-failure), always call `sendDetectionCompletionNotification(ctx, quarter, awaitingReminderRecorded)` exactly once — including when `awaitingReminderRecorded === 0`
    - Keep per-user `try/catch` error isolation unchanged
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 6.1, 6.2, 15.1, 15.2_

  - [x]* 3.2 Rewrite property test for awaiting-reminder recording idempotency and error isolation
    - **Property 4: Awaiting-reminder recording idempotency and error isolation**
    - Update `packages/backend/src/ugl-exit/detection-job.property.test.ts`: replace the old "exactly one Reminder_Email sent" assertion with "exactly one `awaiting_reminder` tracking record created per Fully_Inactive_UGL across repeated runs"; keep the per-user error isolation property (N attempts regardless of failures)
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 4: Awaiting-reminder recording idempotency and error isolation`
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 15.1, 15.2**

  - [x]* 3.3 Write property test for detection job never sending the Reminder_Email and always sending the completion notification
    - **Property 5: Detection job never sends the Reminder_Email; always sends the Detection_Completion_Notification**
    - File: `packages/backend/src/ugl-exit/detection-job.property.test.ts` (append)
    - Generate arbitrary sets of Fully_Inactive_UGL users (including the empty set); assert `sendUGLExitReminderEmail` is called zero times and `sendDetectionCompletionNotification` is called exactly once per run, with the correct count argument including zero
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 5: Detection job never sends the Reminder_Email; always sends the Detection_Completion_Notification`
    - **Validates: Requirements 4.1, 6.1, 6.2**

  - [x]* 3.4 Update unit test for the happy-path job sequence to include the completion notification and remove the auto-send assumption
    - Update `packages/backend/src/ugl-exit/grace-period-job.test.ts`'s (or `detection-job.test.ts`'s) happy-path example: detection job run → user recorded as `awaiting_reminder`, no email sent, Detection_Completion_Notification sent with count=1 → separately invoke `sendReminderAction` (task 4) to actually send the reminder before continuing the grace-period example
    - _Requirements: 4.1, 6.1_

- [x] 4. New module: Send Reminder Action
  - [x] 4.1 Create `packages/backend/src/ugl-exit/send-reminder-action.ts`
    - Define `SendReminderActionSummary` interface (`sentCount`, `alreadySentCount`, `sendFailedCount`, `errors`)
    - Implement `sendReminderAction(userIds, ctx)`: empty array → no-op returning all-zero counts (not an error); otherwise for each `userId` (wrapped in `try/catch`, error isolation): call `claimAndStartGracePeriod`; on `claimed: false` increment `alreadySentCount` and skip; on `claimed: true` call `sendUGLExitReminderEmail(ctx, userId, quarter, gracePeriodDeadline)` — on `{ sent: true }` increment `sentCount`; on `{ sent: false }` call `revertToAwaitingReminder` (passing the exact `reminderSentAt` just claimed) and increment `sendFailedCount`
    - Need to resolve which `(userId, quarter)` tracking entry to claim per userId — look up each user's current `'awaiting_reminder'` tracking record (single query per user, or reuse a preloaded map from `queryAwaitingReminderRecords`) before attempting the claim
    - _Requirements: 5.3, 5.5, 5.6, 5.7, 5.8, 5.9, 15.4_

  - [x]* 4.2 Write property test for Send_Reminder_Action dispatch, grace-period start timing, and idempotency
    - **Property 6: Send_Reminder_Action dispatch, grace-period start timing, and idempotency**
    - Create `packages/backend/src/ugl-exit/send-reminder-action.property.test.ts`
    - Use an in-memory mock DynamoDB client; invoke `sendReminderAction` multiple times with overlapping/repeated `userIds` selections for the same entries; assert exactly one email per entry across all invocations, `gracePeriodDeadline` computed from the successful claim's own timestamp (not the entry's original `createdAt`), and no recomputation on duplicate calls
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 6: Send_Reminder_Action dispatch, grace-period start timing, and idempotency`
    - **Validates: Requirements 5.3, 5.5, 5.6, 5.7, 15.4**

  - [x]* 4.3 Write property test for Send_Reminder_Action failure isolation, revert, and empty-selection no-op
    - **Property 7: Send_Reminder_Action failure isolation, revert, and empty-selection no-op**
    - File: `packages/backend/src/ugl-exit/send-reminder-action.property.test.ts` (append)
    - Generate arbitrary subsets of `userIds` whose simulated email send fails; assert each failed entry's tracking record is left byte-for-byte identical to its pre-call `'awaiting_reminder'` state, while succeeding entries transition to `'pending'` with both fields set, and one entry's failure never blocks another entry's processing; assert an empty `userIds` array produces zero writes/sends and all-zero counts
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 7: Send_Reminder_Action failure isolation, revert, and empty-selection no-op`
    - **Validates: Requirements 5.8, 5.9**

  - [x]* 4.4 Write unit tests for send-reminder-action edge cases
    - Test file: `packages/backend/src/ugl-exit/send-reminder-action.test.ts`
    - Test a `userId` with no matching `'awaiting_reminder'` entry is skipped without error; test the summary counts match a mixed batch of successes/already-sent/failures
    - _Requirements: 5.6, 5.8, 5.9_

- [x] 5. New module: Awaiting Reminder List
  - [x] 5.1 Create `packages/backend/src/ugl-exit/awaiting-reminder-list.ts`
    - Define `AwaitingReminderRecord` interface (`userId`, `nickname`, `email`, `ugName`, `quarter`, `recordedAt`)
    - Implement `queryAwaitingReminderUGLs(dynamoClient, tables)`: call `queryAwaitingReminderRecords` (reminder-tracking.ts), batch-load matching Users records (`BatchGetCommand`), Scan UGs table to build the `leaderId -> ugName` map (locally reimplemented, same pattern as `pending-exit-list.ts`), and join into `AwaitingReminderRecord[]`
    - _Requirements: 5.1_

  - [x]* 5.2 Write property test for awaiting reminder list correctness
    - File: `packages/backend/src/ugl-exit/awaiting-reminder-list.property.test.ts`
    - Generate arbitrary sets of tracking records (some `'awaiting_reminder'`, some other outcomes) and user/UG records; assert the result includes exactly the `'awaiting_reminder'` entries with correct joined fields, and a user leading no UG gets `ugName: ''`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property (list correctness, supports Requirement 5.1)`
    - **Validates: Requirements 5.1**

  - [x]* 5.3 Write unit test for awaiting-reminder-list pagination and empty UG mapping
    - Test file: `packages/backend/src/ugl-exit/awaiting-reminder-list.test.ts`
    - Test `queryAwaitingReminderRecords` pagination is fully aggregated before the join; test empty result when there are zero `'awaiting_reminder'` records
    - _Requirements: 5.1, 5.11_

- [x] 6. Checkpoint - Ensure reminder-tracking, detection-job, send-reminder-action, and awaiting-reminder-list tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Email notifications: Detection Completion Notification + toggle/template plumbing
  - [x] 7.1 Add `'uglExitDetectionCompletion'` to the `NotificationType` union and template variable map
    - Add to `NotificationType` in `packages/backend/src/email/send.ts`
    - Add `uglExitDetectionCompletion: ['detectionQuarter', 'newlyRecordedCount']` to `TEMPLATE_VARIABLE_MAP` in `packages/backend/src/email/templates.ts`
    - Add `'uglExitDetectionCompletion'` to `VALID_NOTIFICATION_TYPES` in `packages/backend/src/admin/handler.ts`
    - _Requirements: 6.1_

  - [x] 7.2 Implement `sendDetectionCompletionNotification` in `packages/backend/src/email/notifications.ts`
    - Signature: `(ctx: NotificationContext, detectionQuarter: string, newlyRecordedCount: number) => Promise<{ recipientsSent: number; recipientsFailed: number }>`
    - Recipients = union of every current SuperAdmin's registered email (reuse the same Scan shape as `sendUGLExitNotifications`'s admin lookup) and every address in `getFeatureToggles(...).additionalNotificationRecipients`; best-effort per recipient (one failure logged, does not block others); sent even when `newlyRecordedCount === 0`
    - Gated by the `emailUglExitNotificationEnabled` toggle (shared with the other two exit-lifecycle notification types, per design.md's `TOGGLE_MAP`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 7.3 Write property test for detection completion notification recipient correctness
    - **Property 12: Detection completion notification recipient correctness**
    - File: `packages/backend/src/email/notifications.property.test.ts` (append)
    - Generate arbitrary SuperAdmin sets and `additionalNotificationRecipients` lists (including empty and non-account addresses); assert delivery is attempted to exactly the union, and that one recipient's simulated failure never blocks another's delivery
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 12: Detection completion notification recipient correctness`
    - **Validates: Requirements 6.3, 6.4, 6.5**

  - [x] 7.4 Seed default `uglExitDetectionCompletion` template for all 5 locales
    - Add template records (zh / en / ja / ko / zh-TW) to `getDefaultTemplates()` in `packages/backend/src/email/seed.ts`, following the same pattern used for `uglExitReminder`/`uglExitNotification`
    - _Requirements: 6.1_

  - [x]* 7.5 Update email template/toggle integration unit test
    - Update `packages/backend/src/email/seed.test.ts` (or `notifications.test.ts`): assert `getDefaultTemplates()` now includes 4 exit-flow types × 5 locales; assert the new `TEMPLATE_VARIABLE_MAP` entry matches the variables passed by `sendDetectionCompletionNotification`
    - _Requirements: 6.1_

- [x] 8. Feature toggles: Additional Notification Recipients
  - [x] 8.1 Add `additionalNotificationRecipients: string[]` to `packages/backend/src/settings/feature-toggles.ts`
    - Add to `FeatureToggles` interface, `UpdateFeatureTogglesInput`, `DEFAULT_TOGGLES` (default `[]`)
    - In `getFeatureToggles()`: safe-default read (array of strings, else `[]`), same pattern as `contentReviewerIds`
    - In `updateFeatureToggles()`: validate every entry is a string matching the existing email-format regex already used elsewhere in this codebase; on any malformed entry, return `INVALID_REQUEST` (400) and perform no writes; on success, include the field in the `UpdateCommand` and in the returned `settings` object
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [x]* 8.2 Write property test for Additional Notification Recipients CRUD correctness and authorization
    - **Property 13: Additional Notification Recipients CRUD correctness and authorization**
    - Create `packages/backend/src/settings/feature-toggles.property.test.ts` (append if the file already has toggle-update property tests, else create)
    - Generate arbitrary well-formed and malformed email lists; assert well-formed lists persist and read back unchanged, malformed lists are rejected with `INVALID_REQUEST` leaving the prior value untouched; assert the existing `isSuperAdmin` gate in `handleUpdateFeatureToggles` (admin/handler.ts) rejects non-SuperAdmin callers with 403 `FORBIDDEN` without modifying stored state
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 13: Additional Notification Recipients CRUD correctness and authorization`
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x]* 8.3 Write unit test for malformed-email rejection
    - Test file: `packages/backend/src/settings/feature-toggles.test.ts` (extend)
    - Test a single malformed entry among otherwise-valid entries rejects the whole update and leaves the previously stored list unchanged
    - _Requirements: 7.4, 7.5_

- [x] 9. Checkpoint - Ensure email notification and feature-toggle tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Admin Lambda: new routes for Awaiting_Reminder_List and Send_Reminder_Action
  - [x] 10.1 Add two new routes to `packages/backend/src/admin/handler.ts`
    - `GET /api/admin/ugl-exit/awaiting-reminder` (SuperAdmin only) → `queryAwaitingReminderUGLs`; non-SuperAdmin → 403 `FORBIDDEN`
    - `POST /api/admin/ugl-exit/send-reminder` (SuperAdmin only) body `{ userIds: string[] }` → `sendReminderAction`; non-SuperAdmin → 403 `FORBIDDEN`; empty/missing `userIds` → treat as empty array (200 all-zero summary, not a 400)
    - No changes needed to the existing `PUT /api/admin/settings/feature-toggles` route beyond what task 8.1 already wires through `handleUpdateFeatureToggles`
    - _Requirements: 5.9, 5.10_

  - [x]* 10.2 Write property test for authorization gate covering the two new routes
    - Update the existing authorization-gate property test (was **Property 12**, now **Property 16: Authorization gate for awaiting-reminder, send-reminder, pending-exit list, and review action endpoints**) — likely `packages/backend/src/admin/ugl-exit-routes.property.test.ts`
    - Add `GET /api/admin/ugl-exit/awaiting-reminder` and `POST /api/admin/ugl-exit/send-reminder` to the set of routes exercised; assert non-SuperAdmin callers get 403 `FORBIDDEN` with no tracking-table mutation, for all five `ugl-exit` routes now covered
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 16: Authorization gate for awaiting-reminder, send-reminder, pending-exit list, and review action endpoints`
    - **Validates: Requirements 5.10, 12.2, 13.5**

  - [x]* 10.3 Write unit tests for the two new admin route happy paths and edge cases
    - Update `packages/backend/src/admin/handler.test.ts`: test `GET /api/admin/ugl-exit/awaiting-reminder` 200 shape and 403 for non-SuperAdmin; test `POST /api/admin/ugl-exit/send-reminder` 200 with a mixed batch and with an empty `userIds` array (not an error)
    - _Requirements: 5.9, 5.10_

- [x] 11. Checkpoint - Ensure admin route tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Frontend: Awaiting_Reminder_List tab on `ugl-exit-review.tsx`
  - [x] 12.1 Add a two-tab layout to `packages/frontend/src/pages/admin/ugl-exit-review.tsx`
    - Introduce a tab switcher (mirrors the section-navigation pattern already used in `pages/admin/settings.tsx`) with "待发提醒" (Awaiting_Reminder_List, default-active) and "待退出审核" (Pending_Exit_List, existing) tabs, both inside the existing `useSuperAdminGuard`-gated page
    - Tab 1: fetch `GET /api/admin/ugl-exit/awaiting-reminder`; render one row per `AwaitingReminderRecord` with a leading row checkbox, a header "select all" checkbox, columns for nickname/email/ugName/quarter/recordedAt; a "发送提醒" button (disabled when zero rows checked) that `POST`s the checked `userIds` to `/api/admin/ugl-exit/send-reminder`, then refetches the list and shows a toast summarizing `sentCount`/`sendFailedCount`; empty-state message when zero records
    - Tab 2: keep the existing Pending_Exit_List behavior unchanged, just moved under its own tab
    - Each tab independently hides itself and stops calling its API if its own request ever returns 403, per the existing pattern
    - _Requirements: 5.1, 5.2, 5.4, 5.7, 5.8, 5.9, 5.10, 5.11_

  - [x] 12.2 Update `ugl-exit-review.scss` for the tab switcher and checkbox/select-all UI
    - Reuse only existing design-system CSS variables; ensure checkbox/row hover states have `cursor: pointer` and visible focus states; ensure light/dark contrast for the tab switcher per workspace UX rules
    - _Requirements: 5.1_

  - [x]* 12.3 Update unit tests for the two-tab UI
    - Update `packages/frontend/src/pages/admin/ugl-exit-review.test.tsx`: test both tabs render, tab switching works, Awaiting_Reminder_List empty state, select-all checkbox behavior, disabled send button when nothing selected, and independent 403-hides-only-that-tab behavior
    - _Requirements: 5.10, 5.11_

- [x] 13. Frontend: Additional Notification Recipients editor on `settings.tsx`
  - [x] 13.1 Add an Additional_Notification_Recipients editor to `packages/frontend/src/pages/admin/settings.tsx`
    - Reuse the existing add/remove chip-style list-of-strings UI pattern already implemented for `contentReviewerIds`; include a client-side email-format pre-check before allowing add; include the field in the same `PUT /api/admin/settings/feature-toggles` payload as the rest of the toggles form
    - On a malformed-email 400 response, show the error inline without resetting other unsaved toggle values
    - _Requirements: 7.1, 7.2, 7.4_

  - [x]* 13.2 Write unit test for the Additional Notification Recipients editor
    - Update `packages/frontend/src/pages/admin/settings.test.tsx` (extend if exists)
    - Test add/remove of an email chip; test a malformed-email submission shows an inline error and does not clear other unsaved fields
    - _Requirements: 7.1, 7.4_

- [x] 14. i18n updates across all 5 locales
  - [x] 14.1 Add i18n keys for the Awaiting_Reminder_List tab, tab labels, Send_Reminder_Action button/toast/confirmation text, and Additional_Notification_Recipients editor labels/placeholders/validation-error text
    - Add to `packages/frontend/src/i18n/types.ts`, `zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts` — keep the key set identical across all 5 files to pass `i18n.property.test.ts`
    - _Requirements: 5.1, 5.2, 7.1_

- [x] 15. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` from repo root to verify no TypeScript errors across `packages/shared`, `packages/backend`, `packages/frontend`, `packages/cdk`
  - Run `npm test` to verify all unit and property tests pass, including no regression in `inactive-ugl-report` / existing email / leaderboard suites, and no regression in the unchanged foundational modules (task 1)
  - Confirm `sendUGLExitReminderEmail` is called from exactly one place in the codebase: `send-reminder-action.ts`
  - Confirm this feature never modifies `packages/backend/src/reports/inactive-ugl-query.ts`
  - Verify no new CDK resources are required (table/Lambda/EventBridge rules unchanged); confirm CDK synth still passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability against the reworked `requirements.md` (Requirements 1–15)
- Property numbers referenced above match the reworked `design.md`'s Correctness Properties section (Properties 1–19); Properties 1–3, 8, 9, 11, 14 (partially), 15, 17–19 are already covered by the unchanged foundational modules in task 1 and are not re-listed here
- `packages/backend/src/reports/inactive-ugl-query.ts` is never imported or modified by this feature
- The claim-then-compensate pattern (`claimAndStartGracePeriod` + `revertToAwaitingReminder`) is what makes Send_Reminder_Action simultaneously idempotent against duplicate calls (Req 15.4) and safe to leave un-started on a failed send (Req 5.8) — see design.md's "Send Reminder Action Flow" section for the full rationale
- `additionalNotificationRecipients` deliberately reuses the existing `feature-toggles` settings record and its existing SuperAdmin-only PUT endpoint rather than introducing a new settings surface
- All 5 i18n locales (zh / en / zh-TW / ja / ko) must be updated together to keep `i18n.property.test.ts` passing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "7.2", "8.2", "8.3"] },
    { "id": 3, "tasks": ["3.1", "7.3", "7.4"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "7.5"] },
    { "id": 5, "tasks": ["4.1", "5.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "5.2", "5.3"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["9"] },
    { "id": 9, "tasks": ["10.1"] },
    { "id": 10, "tasks": ["10.2", "10.3"] },
    { "id": 11, "tasks": ["11"] },
    { "id": 12, "tasks": ["12.1", "13.1"] },
    { "id": 13, "tasks": ["12.2", "12.3", "13.2", "14.1"] },
    { "id": 14, "tasks": ["15"] }
  ]
}
```
