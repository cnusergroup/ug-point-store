# Implementation Plan: UGL Inactivity Exit Flow

## Overview

新增自包含后端模块 `packages/backend/src/ugl-exit/`，实现 UGL 季度不活跃检测 → 提醒邮件 → 30 天宽限期 → SuperAdmin 人工审核的完整生命周期。按层级从底向上实现：shared 错误码扩展 → 纯函数模块（quarter 解析、eligibility 判定、reminder-tracking 幂等声明、grace-evaluation）→ 依赖 DynamoDB 的编排模块（review-actions、pending-exit-list、detection-job、grace-period-job）→ Lambda 入口（新 UGLExit Lambda）→ Admin Lambda 新增路由 → 邮件通知扩展（3 类新通知 + 5 语言模板种子 + feature toggle）→ CDK 基础设施（新表 + 新 Lambda + 两条 EventBridge 规则 + Admin Lambda 权限）→ 前端 Pending_Exit_List 页面 + dashboard 卡片 + i18n。本功能不修改 `reports/inactive-ugl-query.ts`，只复用其中的 `quarter-utils.ts` 与 `admin/users.ts` 的 `setUserStatus`。

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. Shared error code extension
  - [x] 1.1 Add `NOT_PENDING_EXIT` error code in `packages/shared/src/errors.ts`
    - Add `NOT_PENDING_EXIT: 'NOT_PENDING_EXIT'` to `ErrorCodes`
    - Add `[ErrorCodes.NOT_PENDING_EXIT]: 400` to `ErrorHttpStatus`
    - Add `[ErrorCodes.NOT_PENDING_EXIT]: '目标用户当前并非待退出复核状态'` to `ErrorMessages`
    - Mirror the exact pattern used by `CANNOT_DISABLE_SUPERADMIN`
    - _Requirements: 10.6_

- [x] 2. Quarter resolution module
  - [x] 2.1 Create `packages/backend/src/ugl-exit/quarter.ts`
    - Import `parseQuarter`, `quarterToDateRange`, `getCurrentQuarter` from `../reports/quarter-utils` (unmodified, verbatim reuse)
    - Implement `getPreviousQuarter(quarter: string): string` — rolls Q1 back to Q4 of the previous year
    - Implement `resolveAutoDetectionQuarter(now?: Date): string` — the quarter immediately preceding `now`'s current quarter
    - Implement `resolveDetectionQuarter(explicitQuarter: string | undefined, now?: Date): DetectionQuarterResolution` — validates an explicit quarter via `parseQuarter` (format + not-future) without checking it against the fixed-date mapping; falls back to `resolveAutoDetectionQuarter` when omitted
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [x]* 2.2 Write property test for detection quarter resolution correctness
    - **Property 1: Detection quarter resolution correctness**
    - Create `packages/backend/src/ugl-exit/quarter.property.test.ts`
    - Use `fast-check`, `numRuns: 100`; tag `// Feature: ugl-inactivity-exit-flow, Property 1: Detection quarter resolution correctness`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6**

  - [x]* 2.3 Write unit tests for quarter resolution edge cases
    - Test file: `packages/backend/src/ugl-exit/quarter.test.ts`
    - Test the four fixed-date-to-quarter mappings (Apr 1 → Q1, Jul 1 → Q2, Oct 1 → Q3, Jan 1 → previous year Q4); test malformed/future explicit quarter rejection
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Eligibility and inactivity determination module
  - [x] 3.1 Implement pure filter functions in `packages/backend/src/ugl-exit/eligibility.ts`
    - Define `ExitEligibleUser` and `ExitQualifyingRecord` interfaces
    - Implement `filterEligibleUGLsForExit(users, quarterStart)` — `roles` contains `'UserGroupLeader'` AND `status === 'active'` AND `createdAt < quarterStart` AND `uglExitStatus !== 'pending_exit'`
    - Implement `extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd)` — counts a record only when `targetRole === 'UserGroupLeader'` AND `consumedForQuarter` unset AND effective date (`activityDate` falling back to `createdAt`'s date part) falls within `[quarterStart, quarterEnd]`
    - Implement `computeFullyInactiveUGLs(eligibleUsers, activeUserIds)` — set difference
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 7.1_

  - [x]* 3.2 Write property test for eligible UGL determination correctness
    - **Property 2: Eligible UGL determination correctness**
    - Create `packages/backend/src/ugl-exit/eligibility.property.test.ts`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 2: Eligible UGL determination correctness`
    - **Validates: Requirements 2.1, 2.2, 7.1**

  - [x]* 3.3 Write property test for fully inactive UGL classification correctness
    - **Property 3: Fully inactive UGL classification correctness**
    - File: `packages/backend/src/ugl-exit/eligibility.property.test.ts` (append)
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 3: Fully inactive UGL classification correctness`
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 3.4 Implement DynamoDB query functions in `packages/backend/src/ugl-exit/eligibility.ts`
    - Implement `queryAllUGLUsersForExit(dynamoClient, usersTable)` — Query `entityType-createdAt-index` (PK=`'user'`) with `FilterExpression` on `roles contains 'UserGroupLeader'`, paginated
    - Implement `queryQuarterQualifyingRecords(dynamoClient, pointsRecordsTable, quarterStart, quarterEnd)` — Query `type-createdAt-index` widened-range + `FilterExpression targetRole = 'UserGroupLeader'`, paginated, mirroring the existing report's widened-range pattern without importing it
    - _Requirements: 2.1, 3.1_

  - [x]* 3.5 Write unit tests for eligibility query pagination
    - Test file: `packages/backend/src/ugl-exit/eligibility.test.ts`
    - Mock DynamoDB client with paginated `LastEvaluatedKey` responses; verify both query functions aggregate all pages
    - _Requirements: 2.1, 3.1_

- [x] 4. Reminder tracking module (idempotency backbone)
  - [x] 4.1 Implement pure and DynamoDB functions in `packages/backend/src/ugl-exit/reminder-tracking.ts`
    - Define `ReminderOutcome`, `ReminderTrackingRecord` types
    - Implement `computeGracePeriodDeadline(sentAt: string): string` — exactly `sentAt + 30*24h`
    - Implement `claimReminderSlot(userId, quarter, now, dynamoClient, trackingTable)` — conditional `PutCommand` (`attribute_not_exists(userId)`); returns `{ claimed: false }` without writing when the condition fails
    - Implement `queryDueReminderRecords(now, dynamoClient, trackingTable)` — Query `outcome-gracePeriodDeadline-index` for `outcome = 'pending' AND gracePeriodDeadline <= :now`, paginated
    - Implement `transitionOutcome(userId, quarter, target, extra, dynamoClient, trackingTable)` — conditional `UpdateCommand` (`outcome = :pending`); returns `{ transitioned: false }` when the condition fails
    - _Requirements: 4.4, 4.5, 5.1, 12.1, 12.3_

  - [x]* 4.2 Write property test for grace-period evaluation idempotency
    - **Property 8: Grace-period evaluation idempotency**
    - Create `packages/backend/src/ugl-exit/reminder-tracking.property.test.ts`
    - Simulate repeated `transitionOutcome` calls for the same `(userId, quarter)` against an in-memory mock DynamoDB client; assert at most one succeeds
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 8: Grace-period evaluation idempotency`
    - **Validates: Requirements 12.3**

  - [x]* 4.3 Write unit tests for reminder tracking claim/transition mechanics
    - Test file: `packages/backend/src/ugl-exit/reminder-tracking.test.ts`
    - Test `computeGracePeriodDeadline` exact 30-day offset; test `claimReminderSlot` returns `claimed: false` on a pre-existing record without issuing a second write; test `queryDueReminderRecords` GSI query shape and pagination
    - _Requirements: 4.4, 5.1_

- [x] 5. Grace-period evaluation module
  - [x] 5.1 Implement pure functions in `packages/backend/src/ugl-exit/grace-evaluation.ts`
    - Implement `selectEarliestMakeupRecord(candidates)` — the single candidate with minimum `createdAt`; `null` for empty input
    - Implement `evaluateGracePeriodOutcome(candidates)` — `{ remedied: true, record }` iff non-empty, else `{ remedied: false }`
    - Implement `queryMakeupCandidates(userId, sentAt, deadline, dynamoClient, pointsRecordsTable)` — Query `userId-createdAt-index` filtered to `targetRole = 'UserGroupLeader'`, `consumedForQuarter` unset, `createdAt` in `[sentAt, deadline]`
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [x]* 5.2 Write property test for grace-period evaluation outcome correctness
    - **Property 6: Grace-period evaluation outcome correctness**
    - Create `packages/backend/src/ugl-exit/grace-evaluation.property.test.ts`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 6: Grace-period evaluation outcome correctness`
    - **Validates: Requirements 5.2, 5.3, 5.5**

  - [x]* 5.3 Write property test for earliest makeup record selection
    - **Property 7: Earliest makeup record selection**
    - File: `packages/backend/src/ugl-exit/grace-evaluation.property.test.ts` (append)
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 7: Earliest makeup record selection`
    - **Validates: Requirements 5.4**

  - [x]* 5.4 Write unit tests for makeup candidate query boundary
    - Test file: `packages/backend/src/ugl-exit/grace-evaluation.test.ts`
    - Test candidates exactly at `sentAt` and exactly at `deadline` boundaries are included; test already-consumed records are excluded from the query filter
    - _Requirements: 5.2, 5.4_

- [x] 6. Checkpoint - Ensure all pure-function module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Job orchestration: detection job
  - [x] 7.1 Implement `runUGLDetectionJob` in `packages/backend/src/ugl-exit/detection-job.ts`
    - Define `DetectionJobSummary` interface and `UGLExitServiceContext` interface (shared by both jobs)
    - Orchestrate: `queryAllUGLUsersForExit` → `filterEligibleUGLsForExit` → `queryQuarterQualifyingRecords` → `extractActiveUserIdsForQuarter` → `computeFullyInactiveUGLs`
    - For each Fully_Inactive_UGL, wrap in `try/catch`: call `claimReminderSlot`; on `claimed: true` call `sendUGLExitReminderEmail` (task 9.2); on `claimed: false` skip without sending
    - Log and continue on any per-user error (increment `errors` count, never abort the loop)
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 12.1, 12.2_

  - [x]* 7.2 Write property test for reminder dispatch correctness and idempotency
    - **Property 4: Reminder dispatch correctness and idempotency**
    - Create `packages/backend/src/ugl-exit/detection-job.property.test.ts`
    - Use an in-memory mock DynamoDB client; invoke `runUGLDetectionJob` multiple times sequentially for the same quarter and same user set; assert exactly one email per Fully_Inactive_UGL across all invocations and `gracePeriodDeadline` computed once
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 4: Reminder dispatch correctness and idempotency`
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 12.1**

  - [x]* 7.3 Write property test for per-user error isolation in the detection job
    - **Property 5: Per-user error isolation in the detection job**
    - File: `packages/backend/src/ugl-exit/detection-job.property.test.ts` (append)
    - Generate N eligible users with an arbitrary subset configured to throw during processing (mocked send/DB failure); assert all N are attempted regardless of failures
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 5: Per-user error isolation in the detection job`
    - **Validates: Requirements 4.6, 12.2**

- [x] 8. Job orchestration: grace-period evaluation job
  - [x] 8.1 Implement `runGracePeriodEvaluationJob` in `packages/backend/src/ugl-exit/grace-period-job.ts`
    - Define `GracePeriodJobSummary` interface
    - Orchestrate: `queryDueReminderRecords(now)` → for each due record (wrapped in `try/catch`): `queryMakeupCandidates` → `evaluateGracePeriodOutcome`
    - On `remedied: true`: conditionally `SET consumedForQuarter` on the earliest record, then `transitionOutcome(..., 'remedied', { consumedRecordId })`
    - On `remedied: false`: `transitionOutcome(..., 'exited', {})`; only when `transitioned: true` does it proceed to `UpdateCommand` on Users (`uglExitStatus`, `uglExitTriggeredQuarter`, `uglExitMarkedAt`) and call `sendUGLExitNotifications` (task 9.3); when `transitioned: false`, skip (already handled by a prior/concurrent run)
    - Log and continue on any per-record error
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.4, 8.1, 8.2, 11.1, 11.2, 12.2, 12.3_

  - [x]* 8.2 Write property test for grace-period-job idempotency invariant (Property 8 combined assertion)
    - Test file: `packages/backend/src/ugl-exit/grace-period-job.property.test.ts`
    - Combined with Property 8 (task 4.2): invoke `runGracePeriodEvaluationJob` repeatedly against the same in-memory mock DynamoDB state for the same due record; assert at most one Exit_Notification is dispatched and at most one `consumedForQuarter` write occurs across all invocations
    - **Validates: Requirements 12.3**

  - [x]* 8.3 Write property test for no unauthorized account or role mutation by background jobs
    - **Property 10: No unauthorized account or role mutation by background jobs**
    - Create `packages/backend/src/ugl-exit/grace-period-job.property.test.ts` (append) — also exercises `runUGLDetectionJob` from task 7.1
    - Generate arbitrary sequences of both jobs' executions over arbitrary user sets with no SuperAdmin action interleaved; assert `roles` and `status` never change, and only the whitelisted fields (`uglExitStatus`, `uglExitTriggeredQuarter`, `uglExitMarkedAt`, `consumedForQuarter`) are ever written
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 10: No unauthorized account or role mutation by background jobs`
    - **Validates: Requirements 8.1, 8.2**

  - [x]* 8.4 Write unit test for happy-path end-to-end job sequence
    - Test file: `packages/backend/src/ugl-exit/grace-period-job.test.ts`
    - One example test: detection job run over a small mocked dataset → reminder sent + tracking record created → simulate deadline passed → grace-period job run with no makeup record → `uglExitStatus` set + Exit_Notification sent
    - _Requirements: 4.1, 5.5, 6.1_

- [x] 9. Checkpoint - Ensure all job orchestration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Email notification extensions
  - [x] 10.1 Add three new `NotificationType` values and template variable maps
    - Add `'uglExitReminder' | 'uglExitNotification' | 'uglExitAdminNotification'` to the `NotificationType` union in `packages/backend/src/email/send.ts`
    - Add `uglExitReminder: ['nickname', 'detectionQuarter', 'gracePeriodDeadline']`, `uglExitNotification: ['nickname', 'detectionQuarter']`, `uglExitAdminNotification: ['affectedNickname', 'affectedEmail', 'detectionQuarter']` to `TEMPLATE_VARIABLE_MAP` in `packages/backend/src/email/templates.ts`
    - Add `'uglExitReminder'`, `'uglExitNotification'`, `'uglExitAdminNotification'` to `VALID_NOTIFICATION_TYPES` in `packages/backend/src/admin/handler.ts`
    - _Requirements: 4.2, 6.3_

  - [x] 10.2 Implement `sendUGLExitReminderEmail` in `packages/backend/src/email/notifications.ts`
    - Signature: `(ctx: NotificationContext, userId: string, detectionQuarter: string, gracePeriodDeadline: string) => Promise<{ sent: boolean }>`
    - Checks the `emailUglExitReminderEnabled` toggle (task 10.4), loads user locale, loads template with fallback, replaces variables, sends via SES; catches and logs its own errors, never throws (mirrors `sendPointsEarnedEmail`)
    - Sends only to the target user's registered email — no other recipient
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 10.3 Implement `sendUGLExitNotifications` in `packages/backend/src/email/notifications.ts`
    - Signature: `(ctx: NotificationContext, affectedUserId: string, detectionQuarter: string) => Promise<{ userSent: boolean; adminsSent: number; adminsFailed: number }>`
    - Sends `uglExitNotification` to the affected user; Scans Users table filtered to `roles contains 'SuperAdmin'` and sends `uglExitAdminNotification` to each (best-effort per recipient, one failure never blocks the others), mirroring `sendNewOrderEmail`'s admin-lookup Scan shape
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 10.4 Add `emailUglExitReminderEnabled` and `emailUglExitNotificationEnabled` toggles in `packages/backend/src/settings/feature-toggles.ts`
    - Add both boolean fields to `FeatureToggles` interface, `UpdateFeatureTogglesInput`, `DEFAULT_TOGGLES` (default `true`, per design decision — account-lifecycle-critical rather than optional-engagement), `getFeatureToggles()`, and `updateFeatureToggles()`
    - Add `uglExitReminder: 'emailUglExitReminderEnabled'`, `uglExitNotification: 'emailUglExitNotificationEnabled'`, `uglExitAdminNotification: 'emailUglExitNotificationEnabled'` to `TOGGLE_MAP` in `packages/backend/src/email/notifications.ts` (last two share one toggle per design.md)
    - _Requirements: 4.1, 6.1, 6.2_

  - [x]* 10.5 Write property test for exit notification recipient correctness
    - **Property 9: Exit notification recipient correctness**
    - File: `packages/backend/src/email/notifications.property.test.ts` (append — existing project convention of one notifications property-test file)
    - Generate arbitrary sets of affected users and current SuperAdmin users; assert `sendUGLExitNotifications` sends to exactly the affected user plus exactly the SuperAdmin set
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 9: Exit notification recipient correctness`
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [x] 10.6 Seed default `uglExitReminder` / `uglExitNotification` / `uglExitAdminNotification` templates for all 5 locales
    - Add template records (zh / en / ja / ko / zh-TW) to `getDefaultTemplates()` / `ALL_TYPES` in `packages/backend/src/email/seed.ts`, following the exact pattern used for `weeklyDigestTemplates`
    - _Requirements: 4.2, 6.3_

  - [x]* 10.7 Write unit test for email template/toggle integration
    - Test file: `packages/backend/src/email/seed.test.ts` (extend if exists, else `packages/backend/src/email/notifications.test.ts`)
    - Assert `getDefaultTemplates()` includes the 3 new types × 5 locales; assert `TEMPLATE_VARIABLE_MAP` entries match the variables passed by `sendUGLExitReminderEmail` / `sendUGLExitNotifications`
    - _Requirements: 4.2, 6.3_

- [x] 11. Checkpoint - Ensure all email notification tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Review actions and pending exit list modules
  - [x] 12.1 Implement `confirmExit` and `restoreTracking` in `packages/backend/src/ugl-exit/review-actions.ts`
    - Define `ReviewActionResult` interface
    - `confirmExit(userId, callerUserId, callerRoles, dynamoClient, usersTable)`: load user (`USER_NOT_FOUND` if missing); `NOT_PENDING_EXIT` (no writes) if `uglExitStatus !== 'pending_exit'`; call `setUserStatus(userId, 'disabled', ...)` reused verbatim from `../admin/users.ts`; conditional `UpdateCommand` REMOVE `uglExitStatus`/`uglExitTriggeredQuarter`/`uglExitMarkedAt` with `ConditionExpression uglExitStatus = :pending_exit`; treat a condition failure here as already-cleared success
    - `restoreTracking(userId, dynamoClient, usersTable)`: same pre-check; conditional `UpdateCommand` REMOVE the three `uglExit*` fields WITHOUT touching `status`
    - _Requirements: 8.1, 10.2, 10.3, 10.4, 10.6_

  - [x]* 12.2 Write property test for confirm exit action correctness
    - **Property 13: Confirm exit action correctness**
    - Create `packages/backend/src/ugl-exit/review-actions.property.test.ts`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 13: Confirm exit action correctness`
    - **Validates: Requirements 10.2**

  - [x]* 12.3 Write property test for restore tracking action correctness
    - **Property 14: Restore tracking action correctness**
    - File: `packages/backend/src/ugl-exit/review-actions.property.test.ts` (append)
    - Include the follow-up assertion: feeding the resulting user record into `filterEligibleUGLsForExit` for the next quarter includes that user
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 14: Restore tracking action correctness`
    - **Validates: Requirements 10.3, 10.4**

  - [x]* 12.4 Write property test for non-pending-exit rejection for review actions
    - **Property 15: Non-pending-exit rejection for review actions**
    - File: `packages/backend/src/ugl-exit/review-actions.property.test.ts` (append)
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 15: Non-pending-exit rejection for review actions`
    - **Validates: Requirements 10.6**

  - [x] 12.5 Implement `queryPendingExitUGLs` in `packages/backend/src/ugl-exit/pending-exit-list.ts`
    - Define `PendingExitRecord` interface
    - Query Users table via `entityType-createdAt-index` (PK=`'user'`) + `FilterExpression uglExitStatus = 'pending_exit'`, same shape as `listUsers` in `admin/users.ts`
    - Scan UGs table to build a `leaderId -> ugName` map, reimplemented locally (not imported from `inactive-ugl-query.ts`)
    - _Requirements: 9.1_

  - [x]* 12.6 Write property test for pending exit list correctness
    - **Property 11: Pending exit list correctness**
    - Create `packages/backend/src/ugl-exit/pending-exit-list.property.test.ts`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 11: Pending exit list correctness`
    - **Validates: Requirements 9.1**

  - [x]* 12.7 Write unit tests for review action pre-check and pending-exit-list empty UG mapping
    - Test file: `packages/backend/src/ugl-exit/review-actions.test.ts` and `packages/backend/src/ugl-exit/pending-exit-list.test.ts`
    - Test `USER_NOT_FOUND` path; test a user leading no UG returns `ugName: ''`
    - _Requirements: 9.1, 10.6_

- [x] 13. Checkpoint - Ensure all review action and pending-exit-list tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. UGLExit Lambda entry point
  - [x] 14.1 Create `packages/backend/src/ugl-exit/handler.ts`
    - Define `UGLExitJobEvent` interface (`jobType: 'detection' | 'graceEvaluation'`, `quarter?: string`)
    - `handler(event)` dispatches: `jobType === 'detection'` → resolve quarter via `resolveDetectionQuarter(event.quarter)` then `runUGLDetectionJob`; `jobType === 'graceEvaluation'` → `runGracePeriodEvaluationJob(now)`
    - Build `UGLExitServiceContext` from environment variables (`USERS_TABLE`, `POINTS_RECORDS_TABLE`, `UGL_REMINDER_TRACKING_TABLE`, `SENDER_EMAIL`, `EMAIL_TEMPLATES_TABLE`)
    - _Requirements: 1.5_

  - [x]* 14.2 Write unit tests for EventBridge event dispatch
    - Test file: `packages/backend/src/ugl-exit/handler.test.ts`
    - Test `jobType='detection'` and `jobType='graceEvaluation'` route to the correct job function; test an unrecognized `jobType` is handled gracefully (logged, no throw)
    - _Requirements: 1.5_

- [x] 15. Admin Lambda routes for manual trigger and SuperAdmin review
  - [x] 15.1 Add four new routes to `packages/backend/src/admin/handler.ts`
    - Add regex constants `UGL_EXIT_CONFIRM_REGEX = /^\/api\/admin\/ugl-exit\/([^/]+)\/confirm-exit$/` and `UGL_EXIT_RESTORE_REGEX = /^\/api\/admin\/ugl-exit\/([^/]+)\/restore-tracking$/`
    - `GET /api/admin/ugl-exit/pending` (SuperAdmin only) → `queryPendingExitUGLs`; non-SuperAdmin → 403 `FORBIDDEN`
    - `POST /api/admin/ugl-exit/detection-job` (SuperAdmin only) body `{ quarter?: string }` → `resolveDetectionQuarter` then `runUGLDetectionJob`; invalid/future quarter → 400 `INVALID_QUARTER_FORMAT`/`FUTURE_QUARTER` (from existing `parseQuarter` errors)
    - `POST /api/admin/ugl-exit/{userId}/confirm-exit` (SuperAdmin only) → `confirmExit`; map `NOT_PENDING_EXIT → 400`, `USER_NOT_FOUND → 404`
    - `POST /api/admin/ugl-exit/{userId}/restore-tracking` (SuperAdmin only) → `restoreTracking`; same error mapping
    - New env vars: `UGL_REMINDER_TRACKING_TABLE`, `UGS_TABLE` (if not already present on Admin Lambda)
    - _Requirements: 1.6, 8.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x]* 15.2 Write property test for authorization gate on pending-exit list and review actions
    - **Property 12: Authorization gate for the pending-exit list and review actions**
    - Create `packages/backend/src/admin/ugl-exit-routes.property.test.ts`
    - Generate arbitrary caller role sets not containing `SuperAdmin`; assert all four routes return 403 `FORBIDDEN` and leave the target user record unmodified regardless of that user's `uglExitStatus`
    - Tag `// Feature: ugl-inactivity-exit-flow, Property 12: Authorization gate for the pending-exit list and review actions`
    - **Validates: Requirements 9.2, 10.5**

  - [x]* 15.3 Write unit tests for admin route happy paths and error codes
    - Test file: `packages/backend/src/admin/handler.test.ts` (extend existing)
    - Test each of the four routes: 403 for non-SuperAdmin, 404 `USER_NOT_FOUND` for a missing `userId`, happy-path 200 shape for a valid SuperAdmin request; test manual detection-job trigger with an explicit quarter that doesn't match the fixed-date mapping still succeeds
    - _Requirements: 1.6, 9.2, 9.3, 10.1, 10.2, 10.3, 10.5, 10.6_

- [x] 16. Checkpoint - Ensure all Lambda entry point and admin route tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. CDK infrastructure: new table, new Lambda, EventBridge rules
  - [x] 17.1 Create `PointsMall-UGLReminderTracking` table in `packages/cdk/lib/database-stack.ts`
    - Partition key `userId` (String), sort key `quarter` (String), `BillingMode.PAY_PER_REQUEST`, `RemovalPolicy.DESTROY`
    - Add GSI `outcome-gracePeriodDeadline-index` with partition key `outcome` (String), sort key `gracePeriodDeadline` (String), projection ALL
    - Add `CfnOutput` for table name and ARN; export the table construct so LambdaStack/ApiStack can reference it
    - _Requirements: 11.1, 11.2_

  - [x] 17.2 Add `uglExitStatus`, `uglExitTriggeredQuarter`, `uglExitMarkedAt` awareness and `consumedForQuarter` — no schema changes needed
    - Confirm no new GSI is required on `PointsMall-Users` or `PointsMall-PointsRecords` (both existing GSIs are reused per design.md); add a brief comment in `database-stack.ts` near the Users table definition documenting the new attribute names for future maintainers
    - _Requirements: 11.1, 11.2_

  - [x] 17.3 Add `UGLExitFunction` Lambda and two EventBridge rules in `packages/cdk/lib/api-stack.ts`
    - `NodejsFunction` `functionName: 'PointsMall-UGLExit'`, `entry: path.join(backendSrcPath, 'ugl-exit/handler.ts')`, `handler: 'handler'`, timeout ≥120s
    - Environment variables: `USERS_TABLE`, `POINTS_RECORDS_TABLE`, `UGL_REMINDER_TRACKING_TABLE`, `UGS_TABLE`, `EMAIL_TEMPLATES_TABLE`, `SENDER_EMAIL`
    - Grant read/write on `PointsMall-Users` (limited to the three `uglExit*` fields is not IAM-expressible — grant table-level read/write), read/write on `PointsMall-PointsRecords` (for `consumedForQuarter`), full read/write on the new `UGLReminderTracking` table, read-only on `UGs` and `EmailTemplates`
    - Grant SES `ses:SendEmail`/`ses:SendRawEmail` scoped to sender identity (mirror `digestFn`'s policy statement)
    - Add `events.Rule` `PointsMall-UGLExitDetectionSchedule` with `schedule: events.Schedule.expression('cron(0 0 1 1,4,7,10 ? *)')`, target the Lambda with input `{ jobType: 'detection' }`
    - Add `events.Rule` `PointsMall-UGLExitGracePeriodSchedule` with `schedule: events.Schedule.rate(cdk.Duration.days(1))`, target the Lambda with input `{ jobType: 'graceEvaluation' }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1_

  - [x] 17.4 Wire Admin Lambda permissions and env vars for the manual trigger + review routes
    - Grant Admin Lambda (`adminFn`) read/write on the new `UGLReminderTracking` table
    - Add env var `UGL_REMINDER_TRACKING_TABLE` to `adminFn`; confirm `UGS_TABLE`/`POINTS_RECORDS_TABLE` env vars already exist on `adminFn` (add if missing)
    - _Requirements: 1.6, 9.1, 10.1_

  - [x]* 17.5 Write CDK synth snapshot assertions
    - Test file: `packages/cdk/test/database-stack.test.ts` and `packages/cdk/test/api-stack.test.ts` (extend if exist, else create)
    - Assert `PointsMall-UGLReminderTracking` table exists with the `outcome-gracePeriodDeadline-index` GSI; assert `PointsMall-UGLExit` Lambda exists; assert the `cron(0 0 1 1,4,7,10 ? *)` rule and the daily rate rule both target it with the correct `jobType` input
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 11.1_

- [x] 18. Checkpoint - Ensure CDK infrastructure configuration passes synth/tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Frontend: Pending Exit List page
  - [x] 19.1 Create `packages/frontend/src/pages/admin/ugl-exit-review.tsx`
    - Gate with the same SuperAdmin-guard pattern used by `pages/admin/reports.tsx` (`useSuperAdminGuard` or equivalent existing hook); render nothing beyond a "not authorized" placeholder and skip the API call entirely when `!isSuperAdmin` once `ready`
    - List view: one row per `PendingExitRecord` (nickname, email, ugName, `triggeredQuarter`, formatted `markedAt`); empty state message when `records.length === 0`, reusing the existing `admin-wishes-empty`/`common.noData` pattern
    - Each row has Confirm_Exit_Action (danger style) and Restore_Tracking_Action (secondary/primary style) buttons, each opening a confirmation dialog before submitting (mirror `pages/admin/wishes.tsx`'s `wish-form-overlay`/`wish-form-modal` pattern)
    - On submit: `POST` to the corresponding endpoint; on success show a toast and refetch the list; on `NOT_PENDING_EXIT` (400) or `FORBIDDEN` (403) show the error inline in the dialog (same `reviewError` pattern as `wishes.tsx`)
    - If any API call ever returns 403, immediately clear the list and switch to the hidden/forbidden state rather than rendering partial data
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x] 19.2 Create `packages/frontend/src/pages/admin/ugl-exit-review.config.ts`
    - Export page config with an i18n-driven `navigationBarTitleText`
    - _Requirements: 9.1_

  - [x] 19.3 Create `packages/frontend/src/pages/admin/ugl-exit-review.scss`
    - Mirror `wishes.scss`; use only design system CSS variables (`--space-*`, `--radius-*`, `--text-*`, `--bg-*`); `cursor: pointer` on clickable rows; light/dark borders + contrast per workspace UX rules
    - _Requirements: 9.1_

  - [x] 19.4 Register page route in `packages/frontend/src/app.config.ts`
    - Append `'pages/admin/ugl-exit-review'` to the `pages` array
    - _Requirements: 9.1_

  - [x]* 19.5 Write unit tests for Pending Exit List rendering and 403 handling
    - Test file: `packages/frontend/src/pages/admin/ugl-exit-review.test.tsx`
    - Test empty-state message renders for zero records; test Confirm/Restore buttons render per row; test opening a confirmation dialog and submitting calls the correct endpoint; test a 403 response hides the page content instead of rendering a partial/error table
    - _Requirements: 9.2, 9.3, 9.4, 10.1_

- [x] 20. Frontend: dashboard card and i18n
  - [x] 20.1 Add UGL Exit Review card to `packages/frontend/src/pages/admin/index.tsx`
    - Append entry to `ADMIN_LINKS`: `key: 'ugl-exit-review'`, `category: 'operations'`, reuse the existing `ClaimIcon` (SVG, not emoji, per workspace UX rules), `titleKey: 'admin.dashboard.uglExitReviewTitle'`, `descKey: 'admin.dashboard.uglExitReviewDesc'`, `url: '/pages/admin/ugl-exit-review'`, `superAdminOnly: true`
    - _Requirements: 9.3_

  - [x] 20.2 Add i18n keys to all 5 locale files
    - Add `admin.dashboard.uglExitReviewTitle`/`Desc` and page-specific keys (nickname/email/ugName/triggeredQuarter/markedAt column labels, Confirm_Exit_Action/Restore_Tracking_Action button labels, confirmation dialog text, empty-state message, error messages for `NOT_PENDING_EXIT`/`FORBIDDEN`/`USER_NOT_FOUND`) to `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Keep the key set identical across all 5 files to pass the existing `i18n.property.test.ts`
    - _Requirements: 9.1, 9.3, 9.4, 10.1_

  - [x]* 20.3 Write unit test for dashboard card visibility
    - Test file: `packages/frontend/src/pages/admin/index.test.tsx` (extend if exists)
    - Test the card is visible only when `user.roles` contains `SuperAdmin`
    - _Requirements: 9.3_

- [x] 21. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` from repo root to verify no TypeScript errors across `packages/shared`, `packages/backend`, `packages/frontend`, `packages/cdk`
  - Run `npm test` to verify all unit and property tests pass, including no regression in `inactive-ugl-report` / existing email / leaderboard suites
  - Confirm this feature never modifies `packages/backend/src/reports/inactive-ugl-query.ts`
  - Verify CDK changes (new `UGLReminderTracking` table, new `UGLExit` Lambda, two EventBridge rules) are documented for manual deployment; do NOT deploy from the agent — instruct the user to run `cdk deploy` manually
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (P1–P15) from `design.md`'s Property → Test File Mapping table; unit tests cover specific examples and edge cases
- `packages/backend/src/reports/inactive-ugl-query.ts` is never imported or modified by this feature — only `quarter-utils.ts` (unmodified) and `admin/users.ts`'s `setUserStatus` (unmodified) are reused verbatim
- Manual-only account mutation is a structural property of the code: only `confirmExit` calls `setUserStatus`; neither job ever does
- Both idempotency guarantees (`claimReminderSlot`, `transitionOutcome`) rely on DynamoDB conditional writes, not application-level locking
- The manual detection-job trigger (Admin Lambda) and the scheduled detection job (UGLExit Lambda) call the exact same `runUGLDetectionJob` function — there is only one implementation of the detection algorithm
- Two separate EventBridge rules target the same `PointsMall-UGLExit` Lambda with different `jobType` payloads, mirroring the existing Digest/Sync Lambda + EventBridge pattern
- Email toggles `emailUglExitReminderEnabled` / `emailUglExitNotificationEnabled` default to `true` (account-lifecycle-critical), unlike the opt-in `pointsEarned`-style toggles
- All 5 i18n locales (zh / en / zh-TW / ja / ko) must be updated together to keep `i18n.property.test.ts` passing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "10.1", "17.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "10.4", "17.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.1", "10.2", "10.3"] },
    { "id": 4, "tasks": ["3.5", "4.2", "4.3", "5.1", "10.5", "10.6"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "6", "10.7"] },
    { "id": 6, "tasks": ["7.1", "12.1", "12.5"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.1", "12.2", "12.3", "12.4", "12.6", "12.7"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4", "13", "14.1"] },
    { "id": 9, "tasks": ["9", "14.2", "15.1"] },
    { "id": 10, "tasks": ["15.2", "15.3", "17.3"] },
    { "id": 11, "tasks": ["16", "17.4"] },
    { "id": 12, "tasks": ["17.5"] },
    { "id": 13, "tasks": ["18", "19.1"] },
    { "id": 14, "tasks": ["19.2", "19.3", "19.4", "20.1"] },
    { "id": 15, "tasks": ["19.5", "20.2"] },
    { "id": 16, "tasks": ["20.3"] },
    { "id": 17, "tasks": ["21"] }
  ]
}
```
