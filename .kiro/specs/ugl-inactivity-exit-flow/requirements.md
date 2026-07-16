# Requirements Document

## Introduction

The UGL Inactivity Exit Flow feature automates the quarterly detection of User Group Leaders (UGLs) who have zero identity-points activity in a given quarter, and surfaces each detected user to a SuperAdmin-facing review list rather than emailing them automatically. Once a SuperAdmin selects a user from that list and sends the reminder, the user gets a 30-day grace period to remedy the deficit by hosting an activity, and — if the deficit is not remedied — is flagged for a separate round of manual SuperAdmin review rather than having the account automatically disabled. The feature runs quarterly detection at four fixed calendar dates per year, but reminder email dispatch is always a manual SuperAdmin-initiated action performed against the resulting review list (no reminder is ever sent automatically, and no follow-up nagging emails are sent during the grace period). The feature tracks which points record was used to satisfy which quarter's deficit so a single make-up activity cannot be counted twice, and provides three SuperAdmin-only administrative surfaces: one for selecting and dispatching reminders to newly detected users, one for reviewing and resolving pending-exit cases (confirm exit / restore normal tracking), and one for configuring additional email recipients of the detection-completion notification.

This feature builds on activity/eligibility query patterns already implemented in `packages/backend/src/reports/inactive-ugl-query.ts` (`filterEligibleUGLs`, `extractActiveUserIds`, `computeInactiveUGLs`, `findLastActiveDate`) and reuses the existing account-disable function `setUserStatus` in `packages/backend/src/admin/users.ts`. It is a distinct feature from the existing `inactive-ugl-report` reporting feature; that report's logic and output are not modified by this feature.

## Glossary

- **UGL_Detection_Job**: The scheduled backend job that runs at each of the four fixed quarterly detection points (April 1, July 1, October 1, January 1) to evaluate UGL activity for the immediately preceding quarter.
- **Detection_Quarter**: The three-month calendar quarter evaluated by a given run of the UGL_Detection_Job (a run on July 1 evaluates Q2 of the same year; a run on January 1 evaluates Q4 of the previous year).
- **Eligible_UGL**: A user whose `roles` array contains `UserGroupLeader`, whose `status` is `active`, and whose account `createdAt` timestamp is strictly before the start of the Detection_Quarter.
- **Qualifying_Points_Record**: A PointsRecord whose `targetRole` field equals `UserGroupLeader`. This includes both `type: 'earn'` award records and `type: 'adjust'` correction records (written by the batch points adjustment feature when a SuperAdmin adjusts or deletes a distribution); the record's `amount` is treated as a signed value (positive for awards/upward corrections, negative for downward corrections and full reversals).
- **Net_Quarter_Points**: For a given Eligible_UGL and Detection_Quarter, the sum of the signed `amount` of all that user's Qualifying_Points_Records whose Consumed_Quarter_Marker is unset and whose record date falls within the Detection_Quarter date range. An earn award later fully reversed by an adjust correction of equal magnitude nets to zero.
- **Fully_Inactive_UGL**: An Eligible_UGL whose Net_Quarter_Points for the Detection_Quarter are not strictly positive (≤ 0) — i.e. the user either had no qualifying activity at all, or had all of their qualifying activity for the quarter reversed by later adjustments.
- **Awaiting_Reminder_UGL**: A Fully_Inactive_UGL that the UGL_Detection_Job has recorded for a Detection_Quarter but for whom a Reminder_Email has not yet been sent — the user's Grace_Period has not yet started.
- **Awaiting_Reminder_List**: The SuperAdmin-facing administrative UI list of all current Awaiting_Reminder_UGL entries, from which a SuperAdmin selects entries for the Send_Reminder_Action.
- **Send_Reminder_Action**: The SuperAdmin action that selects one or more Awaiting_Reminder_UGL entries from the Awaiting_Reminder_List and dispatches the Reminder_Email for each, starting each selected user's Grace_Period at the moment of dispatch.
- **Grace_Period**: The 30 calendar day period during which a Fully_Inactive_UGL may remedy a Detection_Quarter's deficit, starting at the moment a SuperAdmin's Send_Reminder_Action actually dispatches that user's Reminder_Email.
- **Grace_Period_Deadline**: The timestamp exactly 30 calendar days after a Reminder_Email is dispatched via the Send_Reminder_Action.
- **Reminder_Email**: The email sent to an Awaiting_Reminder_UGL as a direct result of a SuperAdmin's Send_Reminder_Action, informing the user of the deficit and the Grace_Period.
- **Makeup_Record**: A Qualifying_Points_Record created for a given user with a creation date on or after that user's Reminder_Email dispatch date and on or before that user's Grace_Period_Deadline.
- **Consumed_Quarter_Marker**: A data field on a Qualifying_Points_Record indicating which Detection_Quarter's deficit the record has already been used to satisfy, preventing the same record from being counted as evidence of activity for any other Detection_Quarter.
- **UGL_Exit_Service**: The backend module responsible for running the UGL_Detection_Job, recording Awaiting_Reminder_UGL entries, dispatching Reminder_Emails via the Send_Reminder_Action, evaluating Grace_Period outcomes, marking Pending_Exit_UGL status, and sending Exit_Notifications.
- **Pending_Exit_UGL**: A user whose account carries a pending-exit marker, set when a Grace_Period expires without a Makeup_Record.
- **Exit_Notification**: The email sent to a Pending_Exit_UGL and to all SuperAdmin users at the moment a user becomes a Pending_Exit_UGL.
- **Pending_Exit_List**: The SuperAdmin-facing administrative UI list of all current Pending_Exit_UGL users.
- **Confirm_Exit_Action**: The SuperAdmin action that sets a Pending_Exit_UGL's account `status` to `disabled` and clears the pending-exit marker.
- **Restore_Tracking_Action**: The SuperAdmin action that clears a Pending_Exit_UGL's pending-exit marker without changing account `status`, returning the user to normal quarterly detection.
- **Detection_Completion_Notification**: The email sent after every UGL_Detection_Job run summarizing that run's Detection_Quarter and the count of newly recorded Awaiting_Reminder_UGL entries (including zero), so that SuperAdmins know to check the Awaiting_Reminder_List.
- **Additional_Notification_Recipients**: A SuperAdmin-configured list of zero or more email addresses (not necessarily belonging to SuperAdmin accounts) that also receive the Detection_Completion_Notification.
- **SuperAdmin**: A user whose `roles` array contains `SuperAdmin`.

## Requirements

### Requirement 1: Quarterly Detection Scheduling

**User Story:** As a system operator, I want the system to automatically run UGL inactivity detection at four fixed calendar dates each year, so that quarterly compliance is checked without manual intervention.

#### Acceptance Criteria

1. WHEN the calendar date reaches April 1st, THE UGL_Detection_Job SHALL evaluate Q1 of the current year as the Detection_Quarter.
2. WHEN the calendar date reaches July 1st, THE UGL_Detection_Job SHALL evaluate Q2 of the current year as the Detection_Quarter.
3. WHEN the calendar date reaches October 1st, THE UGL_Detection_Job SHALL evaluate Q3 of the current year as the Detection_Quarter.
4. WHEN the calendar date reaches January 1st, THE UGL_Detection_Job SHALL evaluate Q4 of the previous year as the Detection_Quarter.
5. THE UGL_Detection_Job SHALL execute automatically on each of the four fixed dates without requiring a manual trigger.
6. WHERE a SuperAdmin manually triggers the UGL_Detection_Job for a specified Detection_Quarter, THE UGL_Detection_Job SHALL execute using the specified quarter regardless of the current calendar date, without validating that the specified quarter matches the fixed-date mapping in criteria 1.1–1.4 (that mapping governs automatic execution only).
7. WHERE a SuperAdmin manual trigger and an automatic fixed-date execution occur for the same Detection_Quarter, THE UGL_Detection_Job SHALL allow both executions to proceed, with duplicate-prevention governed by Requirement 15.1.

### Requirement 2: Eligible UGL Determination

**User Story:** As a SuperAdmin, I want detection to only consider UGLs who are established members and not already under review, so that new members and already-flagged members are not processed incorrectly.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL identify Eligible_UGL users as those whose `roles` array contains `UserGroupLeader`, whose `status` is `active`, and whose `createdAt` is strictly before the start of the Detection_Quarter, regardless of how recently the user was promoted to the `UserGroupLeader` role.
2. THE UGL_Exit_Service SHALL exclude every user who is a Pending_Exit_UGL at the moment the Eligible_UGL set is computed from that set for the current UGL_Detection_Job run; a user who becomes a Pending_Exit_UGL after the Eligible_UGL set is computed but before that user has been processed SHALL still be processed for the current run.

### Requirement 3: Fully Inactive UGL Determination

**User Story:** As a SuperAdmin, I want the system to identify UGLs with zero identity-points activity in the Detection_Quarter, so that only completely disengaged leaders enter the reminder flow.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL compute, for each Eligible_UGL, that user's Net_Quarter_Points by summing the signed `amount` of every Qualifying_Points_Record (both `type: 'earn'` and `type: 'adjust'`) with a record date within the Detection_Quarter date range and whose Consumed_Quarter_Marker is unset.
2. THE UGL_Exit_Service SHALL classify an Eligible_UGL as a Fully_Inactive_UGL when that user's Net_Quarter_Points are not strictly positive (≤ 0) for the Detection_Quarter.
3. THE UGL_Exit_Service SHALL exclude from Net_Quarter_Points any Qualifying_Points_Record whose Consumed_Quarter_Marker field is already set.
4. WHEN a UGL's only qualifying activity in the Detection_Quarter is fully reversed by a `type: 'adjust'` correction (e.g. an earn of +N followed by an adjust of −N, netting to 0), THE UGL_Exit_Service SHALL classify that UGL as a Fully_Inactive_UGL, since the original `earn` record is preserved by the adjustment feature and existence alone must not be treated as evidence of activity.
5. WHEN a UGL's qualifying activity is only partially reduced by a `type: 'adjust'` correction such that Net_Quarter_Points remain strictly positive (e.g. +50 then −20, netting to 30), THE UGL_Exit_Service SHALL NOT classify that UGL as a Fully_Inactive_UGL, since the UGL did host a qualifying activity that quarter.

### Requirement 4: Awaiting-Reminder Recording

**User Story:** As a SuperAdmin, I want newly detected inactive UGLs surfaced to a review list rather than emailed automatically, so that I can decide who actually receives a reminder before any email goes out.

#### Acceptance Criteria

1. WHEN the UGL_Detection_Job classifies a user as a Fully_Inactive_UGL for the Detection_Quarter, THE UGL_Exit_Service SHALL record that user as an Awaiting_Reminder_UGL for the Detection_Quarter within the same job execution, and SHALL NOT send any email as a result of this classification alone.
2. THE UGL_Exit_Service SHALL NOT start a Grace_Period for a user upon recording them as an Awaiting_Reminder_UGL — the Grace_Period begins only upon a subsequent Send_Reminder_Action for that user (see Requirement 5).
3. THE UGL_Exit_Service SHALL record at most one Awaiting_Reminder_UGL entry per Fully_Inactive_UGL per Detection_Quarter, even if the UGL_Detection_Job is executed more than once for the same Detection_Quarter.
4. IF recording an Awaiting_Reminder_UGL entry fails due to an unexpected error, THEN THE UGL_Exit_Service SHALL log the failure and continue processing the remaining Fully_Inactive_UGL users in the same job run.
5. An Awaiting_Reminder_UGL entry SHALL remain in the Awaiting_Reminder_List indefinitely until a SuperAdmin performs a Send_Reminder_Action for that entry; the entry SHALL NOT be automatically removed, expired, or resolved by any scheduled job.

### Requirement 5: SuperAdmin Awaiting-Reminder Review and Send Action

**User Story:** As a SuperAdmin, I want to see all UGLs currently awaiting a reminder and choose which ones to actually send reminders to, so that I retain full control over who receives the reminder and when.

#### Acceptance Criteria

1. THE Awaiting_Reminder_List SHALL display every current Awaiting_Reminder_UGL with nickname, email, UG name, the Detection_Quarter that triggered the entry, and the date the entry was recorded.
2. THE Awaiting_Reminder_List SHALL provide a selection control allowing a SuperAdmin to select one or more Awaiting_Reminder_UGL entries and a Send_Reminder_Action control to dispatch the Reminder_Email for the selected entries.
3. WHEN a SuperAdmin invokes the Send_Reminder_Action for a selected Awaiting_Reminder_UGL entry, THE UGL_Exit_Service SHALL send the Reminder_Email to that user and SHALL record the send timestamp as the start of that user's Grace_Period for the Detection_Quarter, at the moment of that send — not at the moment the entry was originally recorded.
4. THE Reminder_Email SHALL state the Detection_Quarter being remedied, the required action (host an activity), and the 30-day Grace_Period.
5. THE UGL_Exit_Service SHALL send the Reminder_Email only to the selected Awaiting_Reminder_UGL and to no other recipient.
6. THE UGL_Exit_Service SHALL send at most one Reminder_Email per Fully_Inactive_UGL per Detection_Quarter, with no additional reminder emails sent during the Grace_Period, regardless of how many times a SuperAdmin invokes the Send_Reminder_Action for an entry whose reminder has already been sent.
7. WHEN a Send_Reminder_Action successfully dispatches a Reminder_Email for an Awaiting_Reminder_UGL entry, THE UGL_Exit_Service SHALL remove that entry from the Awaiting_Reminder_List.
8. IF a Reminder_Email fails to send due to a delivery error during a Send_Reminder_Action, THEN THE UGL_Exit_Service SHALL log the failure, leave the entry in the Awaiting_Reminder_List (Grace_Period not started), and continue processing any other entries selected in the same Send_Reminder_Action.
9. IF a SuperAdmin selects zero entries and invokes the Send_Reminder_Action, THEN THE UGL_Exit_Service SHALL take no action and SHALL NOT return an error.
10. WHEN a non-SuperAdmin user requests the Awaiting_Reminder_List data or invokes the Send_Reminder_Action, THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`, and THE Awaiting_Reminder_List SHALL immediately hide itself in response to the 403 rather than attempting to render any data, treating backend authorization as authoritative.
11. WHEN the Awaiting_Reminder_List contains zero Awaiting_Reminder_UGL entries, THE Awaiting_Reminder_List SHALL display an empty state message.

### Requirement 6: Detection Completion Notification

**User Story:** As a SuperAdmin, I want to be emailed after every quarterly detection run, so that I know when new UGLs are waiting for my review without having to check the admin interface proactively.

#### Acceptance Criteria

1. WHEN a UGL_Detection_Job run completes (regardless of manual or automatic trigger), THE UGL_Exit_Service SHALL send a single Detection_Completion_Notification summarizing that run's Detection_Quarter and the count of newly recorded Awaiting_Reminder_UGL entries from that run.
2. THE UGL_Exit_Service SHALL send the Detection_Completion_Notification even when the count of newly recorded Awaiting_Reminder_UGL entries is zero, stating that no new entries were recorded for that Detection_Quarter.
3. THE UGL_Exit_Service SHALL send the Detection_Completion_Notification to every SuperAdmin user's registered email address and to every address in Additional_Notification_Recipients.
4. THE UGL_Exit_Service SHALL send the Detection_Completion_Notification only to SuperAdmin users and to Additional_Notification_Recipients, and to no other recipient.
5. IF the Detection_Completion_Notification fails to send to one recipient due to a delivery error, THEN THE UGL_Exit_Service SHALL log the failure and continue attempting delivery to the remaining recipients.

### Requirement 7: Additional Notification Recipients Configuration

**User Story:** As a SuperAdmin, I want to configure extra email addresses to receive detection-completion notifications, so that people without a SuperAdmin account (e.g. a shared operations mailbox) can also be kept informed.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL provide a SuperAdmin-only settings control for viewing and editing Additional_Notification_Recipients.
2. THE UGL_Exit_Service SHALL allow Additional_Notification_Recipients to contain zero or more email addresses, independent of whether each address belongs to a registered SuperAdmin account.
3. IF a non-SuperAdmin user attempts to view or edit Additional_Notification_Recipients, THEN THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN` and SHALL leave the stored configuration unmodified.
4. IF a SuperAdmin submits a malformed email address when editing Additional_Notification_Recipients, THEN THE UGL_Exit_Service SHALL reject the update with a 400 error and SHALL leave the previously stored configuration unmodified.
5. THE UGL_Exit_Service SHALL persist Additional_Notification_Recipients durably so that the configured list survives across job executions and admin sessions.

### Requirement 8: Grace Period Outcome Evaluation

**User Story:** As a SuperAdmin, I want the system to automatically check whether a reminded UGL remedied the deficit within 30 days, so that only genuinely unresponsive users proceed to the exit review flow.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL evaluate the Grace_Period outcome for a Fully_Inactive_UGL within 24 hours after that user's Grace_Period_Deadline has passed.
2. WHEN evaluating a Grace_Period outcome, THE UGL_Exit_Service SHALL check whether a Makeup_Record exists for that user.
3. WHEN a Makeup_Record exists at Grace_Period evaluation, THE UGL_Exit_Service SHALL set that record's Consumed_Quarter_Marker to the Detection_Quarter and SHALL treat the Detection_Quarter's deficit as remedied.
4. WHEN more than one Qualifying_Points_Record falls within a user's Grace_Period window, THE UGL_Exit_Service SHALL, at the moment of Grace_Period evaluation described in criterion 8.1 (and not immediately upon record creation), set the Consumed_Quarter_Marker on only the earliest such record, leaving any additional records available for later Detection_Quarter evaluations.
5. IF no Makeup_Record exists for a Fully_Inactive_UGL at Grace_Period evaluation, THEN THE UGL_Exit_Service SHALL mark that user as a Pending_Exit_UGL for the Detection_Quarter.

### Requirement 9: Pending Exit Notification

**User Story:** As a UGL and as a SuperAdmin, I want to be notified when a UGL is marked for pending exit, so that the UGL is aware and the SuperAdmin can take manual action.

#### Acceptance Criteria

1. WHEN a user becomes a Pending_Exit_UGL, THE UGL_Exit_Service SHALL send an Exit_Notification to that user's registered email address.
2. WHEN a user becomes a Pending_Exit_UGL, THE UGL_Exit_Service SHALL send an Exit_Notification to every SuperAdmin user's registered email address.
3. THE Exit_Notification SHALL state that the user has been marked for pending exit, the Detection_Quarter that triggered it, and that manual review is required.
4. THE UGL_Exit_Service SHALL send the Exit_Notification only to the Pending_Exit_UGL and to SuperAdmin users, and to no other recipient.

### Requirement 10: Skip Detection for Pending Exit Users

**User Story:** As a SuperAdmin, I want UGLs already under pending-exit review to be skipped by future detection runs, so that they do not receive duplicate reminders while awaiting manual resolution.

#### Acceptance Criteria

1. WHILE a user's status is Pending_Exit_UGL, THE UGL_Detection_Job SHALL exclude that user from Eligible_UGL evaluation in every subsequent run.
2. WHILE a user's status is Pending_Exit_UGL, THE UGL_Exit_Service SHALL suspend Awaiting_Reminder_UGL recording that would otherwise originate from a new Fully_Inactive_UGL classification for that user, as a direct consequence of criterion 10.1 excluding the user from evaluation; this criterion does not require independent suspension logic beyond the evaluation exclusion itself.

### Requirement 11: Manual-Only Account Changes

**User Story:** As a SuperAdmin, I want the system to never automatically disable an account or remove a role, so that I retain full control over exit decisions.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL require an explicit Confirm_Exit_Action performed by a SuperAdmin before setting any user's account `status` to `disabled` as part of this feature's flow.
2. THE UGL_Exit_Service SHALL leave a Pending_Exit_UGL's `roles` array and historical PointsRecords unmodified until a SuperAdmin performs a Confirm_Exit_Action or Restore_Tracking_Action.

### Requirement 12: SuperAdmin Pending Exit List

**User Story:** As a SuperAdmin, I want to see a list of all UGLs currently marked for pending exit, so that I can review and resolve each case.

#### Acceptance Criteria

1. THE Pending_Exit_List SHALL display every current Pending_Exit_UGL with nickname, email, UG name, the Detection_Quarter that triggered the pending-exit marker, and the date the marker was set.
2. WHEN a non-SuperAdmin user requests the Pending_Exit_List data, THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`, and THE Pending_Exit_List SHALL immediately hide itself in response to the 403 rather than attempting to render any data, treating backend authorization as authoritative.
3. WHEN a non-SuperAdmin user navigates to the admin interface, THE Pending_Exit_List SHALL not be visible.
4. WHEN the Pending_Exit_List contains zero Pending_Exit_UGL users, THE Pending_Exit_List SHALL display an empty state message.

### Requirement 13: SuperAdmin Exit Review Actions

**User Story:** As a SuperAdmin, I want to confirm a UGL's exit or restore normal tracking for a pending-exit case, so that I can resolve each case according to the actual circumstances.

#### Acceptance Criteria

1. THE Pending_Exit_List SHALL provide a Confirm_Exit_Action control and a Restore_Tracking_Action control for each listed Pending_Exit_UGL.
2. WHEN a SuperAdmin invokes the Confirm_Exit_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL set that user's account `status` to `disabled` and clear the pending-exit marker.
3. WHEN a SuperAdmin invokes the Restore_Tracking_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL clear that user's pending-exit marker without changing the account `status`.
4. WHEN a SuperAdmin invokes the Restore_Tracking_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL make that user eligible for Eligible_UGL evaluation starting with the next UGL_Detection_Job run.
5. IF a non-SuperAdmin user attempts to invoke a Confirm_Exit_Action or Restore_Tracking_Action, THEN THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN` and SHALL leave the target user's record unmodified, regardless of whether the target user is currently a Pending_Exit_UGL.
6. IF a SuperAdmin invokes a Confirm_Exit_Action or Restore_Tracking_Action on a user who is not currently a Pending_Exit_UGL, THEN THE UGL_Exit_Service SHALL return a 400 error with code `NOT_PENDING_EXIT`.

### Requirement 14: Durable State Persistence

**User Story:** As a system operator, I want pending-exit status and consumed-record markers to be durably stored, so that repeated or delayed job executions do not lose track of state.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL persist each user's Pending_Exit_UGL marker and the triggering Detection_Quarter on the Users table so that the status is durable across job executions.
2. THE UGL_Exit_Service SHALL persist each Qualifying_Points_Record's Consumed_Quarter_Marker on the PointsRecords table so that the record cannot be re-evaluated as unconsumed by a later job execution.

### Requirement 15: Idempotent and Resilient Job Execution

**User Story:** As a system operator, I want detection and grace-period evaluation to be safe to re-run, so that retries or overlapping executions do not produce duplicate emails or inconsistent state.

#### Acceptance Criteria

1. IF the UGL_Detection_Job is executed more than once for the same Detection_Quarter, THEN THE UGL_Exit_Service SHALL avoid recording a duplicate Awaiting_Reminder_UGL entry for any user already recorded for that Detection_Quarter.
2. IF an unexpected error occurs while processing one Eligible_UGL within the UGL_Detection_Job, THEN THE UGL_Exit_Service SHALL log the error and continue processing the remaining Eligible_UGL users without aborting the job run.
3. IF Grace_Period evaluation is executed more than once for the same user and Detection_Quarter, THEN THE UGL_Exit_Service SHALL avoid sending a duplicate Exit_Notification for that user and Detection_Quarter.
4. IF a SuperAdmin invokes the Send_Reminder_Action more than once for the same Awaiting_Reminder_UGL entry (e.g. due to a retried request), THEN THE UGL_Exit_Service SHALL avoid sending a duplicate Reminder_Email and SHALL avoid recomputing the Grace_Period_Deadline for that user and Detection_Quarter.

## Out of Scope

- Automatic removal of the `UserGroupLeader` role or automatic account disablement — every exit is confirmed manually by a SuperAdmin.
- Automatic Reminder_Email dispatch — every Reminder_Email requires a SuperAdmin's explicit Send_Reminder_Action against the Awaiting_Reminder_List.
- Any intermediate reminder or nagging email during the 30-day Grace_Period.
- Any change to the existing `inactive-ugl-report` reporting feature's logic, data, or output — that feature remains independent and is unmodified by this feature.

## Assumptions and Default Decisions

The following technical defaults were not explicitly specified by the user and are assumed for the purpose of this requirements document. They may be revisited during design:

1. **Activity criterion narrower than existing report**: This feature's Qualifying_Points_Record definition uses `targetRole === 'UserGroupLeader'` only. This is intentionally narrower than `extractActiveUserIds` in `inactive-ugl-query.ts`, which also includes `targetRole === 'SpecialActivity'`. This distinction was explicitly confirmed by the user for this feature and does not change the existing report's behavior.
2. **Record date field for quarter-window checks**: "falls within the Detection_Quarter" is assumed to use the record's effective activity date (its `activityDate` field, falling back to `createdAt` when absent), consistent with `findLastActiveDate`'s existing pattern.
3. **Record date field for Makeup_Record checks**: "created within the Grace_Period" is assumed to use the record's `createdAt` timestamp (i.e., when the points record was actually issued), since this reflects when the user's remedial action was recorded by the system.
4. **State field naming**: assumed new fields — `uglExitStatus` (`'pending_exit'` or absent) and `uglExitTriggeredQuarter` on the Users table; `consumedForQuarter` on the PointsRecords table. Exact naming is finalized during design.
5. **Grace-period evaluation cadence**: assumed to run via a daily scheduled check (independent of the quarterly detection cadence), since a 30-day grace period will typically expire in the middle of the next quarter, well before the next fixed detection date. Exact scheduling mechanism (e.g., EventBridge rate-based rule) is finalized during design.
6. **Reminder tracking record**: assumed a per-user, per-Detection_Quarter record (new table or attribute) tracking Reminder_Email send timestamp, computed Grace_Period_Deadline, and outcome status, to support the idempotency and grace-period evaluation requirements above. Exact storage shape is finalized during design.
7. **Awaiting-reminder state representation**: assumed the same per-user, per-Detection_Quarter tracking record (Assumption 6) represents the Awaiting_Reminder_UGL state via an additional outcome value (e.g. `'awaiting_reminder'`) prior to the existing `'pending'`/`'remedied'`/`'exited'` outcomes, rather than a separate table — the record is created at detection time with no `reminderSentAt`/`gracePeriodDeadline` yet, and those fields plus the transition to `'pending'` are populated only by the Send_Reminder_Action. Exact storage shape is finalized during design.
8. **Additional_Notification_Recipients storage**: assumed to be stored as a simple string array on the existing feature-toggles/settings record (mirroring how other admin-configurable lists like `contentReviewerIds` are stored in this codebase), rather than a new table. Exact storage shape is finalized during design.
9. **Detection_Completion_Notification email address validation**: assumed to use the same email format validation already used elsewhere in the admin settings for list-of-emails-style fields; a malformed address is rejected as a single validation failure for the whole update (all-or-nothing), consistent with existing settings-update patterns in this codebase.
