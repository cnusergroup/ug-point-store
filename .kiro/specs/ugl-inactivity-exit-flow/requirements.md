# Requirements Document

## Introduction

The UGL Inactivity Exit Flow feature automates the quarterly detection of User Group Leaders (UGLs) who have zero identity-points activity in a given quarter, gives each detected user a 30-day grace period to remedy the deficit by hosting an activity, and — if the deficit is not remedied — flags the user for manual SuperAdmin review rather than automatically disabling the account. The feature runs at four fixed calendar dates per year, sends a single reminder email at detection time (no follow-up nagging emails during the grace period), tracks which points record was used to satisfy which quarter's deficit so a single make-up activity cannot be counted twice, and provides a SuperAdmin-only administrative list for reviewing and resolving pending-exit cases (confirm exit / restore normal tracking).

This feature builds on activity/eligibility query patterns already implemented in `packages/backend/src/reports/inactive-ugl-query.ts` (`filterEligibleUGLs`, `extractActiveUserIds`, `computeInactiveUGLs`, `findLastActiveDate`) and reuses the existing account-disable function `setUserStatus` in `packages/backend/src/admin/users.ts`. It is a distinct feature from the existing `inactive-ugl-report` reporting feature; that report's logic and output are not modified by this feature.

## Glossary

- **UGL_Detection_Job**: The scheduled backend job that runs at each of the four fixed quarterly detection points (April 1, July 1, October 1, January 1) to evaluate UGL activity for the immediately preceding quarter.
- **Detection_Quarter**: The three-month calendar quarter evaluated by a given run of the UGL_Detection_Job (a run on July 1 evaluates Q2 of the same year; a run on January 1 evaluates Q4 of the previous year).
- **Eligible_UGL**: A user whose `roles` array contains `UserGroupLeader`, whose `status` is `active`, and whose account `createdAt` timestamp is strictly before the start of the Detection_Quarter.
- **Qualifying_Points_Record**: A PointsRecord whose `targetRole` field equals `UserGroupLeader`.
- **Fully_Inactive_UGL**: An Eligible_UGL for whom zero Qualifying_Points_Records with a record date falling within the Detection_Quarter date range exist.
- **Grace_Period**: The 30 calendar day period during which a Fully_Inactive_UGL may remedy a Detection_Quarter's deficit, starting at the moment the Reminder_Email is sent.
- **Grace_Period_Deadline**: The timestamp exactly 30 calendar days after a Reminder_Email is sent.
- **Reminder_Email**: The email sent to a Fully_Inactive_UGL at the moment of detection, informing the user of the deficit and the Grace_Period.
- **Makeup_Record**: A Qualifying_Points_Record created for a given user with a creation date on or after that user's Reminder_Email send date and on or before that user's Grace_Period_Deadline.
- **Consumed_Quarter_Marker**: A data field on a Qualifying_Points_Record indicating which Detection_Quarter's deficit the record has already been used to satisfy, preventing the same record from being counted as evidence of activity for any other Detection_Quarter.
- **UGL_Exit_Service**: The backend module responsible for running the UGL_Detection_Job, sending Reminder_Emails, evaluating Grace_Period outcomes, marking Pending_Exit_UGL status, and sending Exit_Notifications.
- **Pending_Exit_UGL**: A user whose account carries a pending-exit marker, set when a Grace_Period expires without a Makeup_Record.
- **Exit_Notification**: The email sent to a Pending_Exit_UGL and to all SuperAdmin users at the moment a user becomes a Pending_Exit_UGL.
- **Pending_Exit_List**: The SuperAdmin-facing administrative UI page listing all current Pending_Exit_UGL users.
- **Confirm_Exit_Action**: The SuperAdmin action that sets a Pending_Exit_UGL's account `status` to `disabled` and clears the pending-exit marker.
- **Restore_Tracking_Action**: The SuperAdmin action that clears a Pending_Exit_UGL's pending-exit marker without changing account `status`, returning the user to normal quarterly detection.
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
7. WHERE a SuperAdmin manual trigger and an automatic fixed-date execution occur for the same Detection_Quarter, THE UGL_Detection_Job SHALL allow both executions to proceed, with duplicate-prevention governed by Requirement 12.1.

### Requirement 2: Eligible UGL Determination

**User Story:** As a SuperAdmin, I want detection to only consider UGLs who are established members and not already under review, so that new members and already-flagged members are not processed incorrectly.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL identify Eligible_UGL users as those whose `roles` array contains `UserGroupLeader`, whose `status` is `active`, and whose `createdAt` is strictly before the start of the Detection_Quarter, regardless of how recently the user was promoted to the `UserGroupLeader` role.
2. THE UGL_Exit_Service SHALL exclude every user who is a Pending_Exit_UGL at the moment the Eligible_UGL set is computed from that set for the current UGL_Detection_Job run; a user who becomes a Pending_Exit_UGL after the Eligible_UGL set is computed but before that user has been processed SHALL still be processed for the current run.

### Requirement 3: Fully Inactive UGL Determination

**User Story:** As a SuperAdmin, I want the system to identify UGLs with zero identity-points activity in the Detection_Quarter, so that only completely disengaged leaders enter the reminder flow.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL determine, for each Eligible_UGL, whether at least one Qualifying_Points_Record with a record date within the Detection_Quarter date range exists.
2. THE UGL_Exit_Service SHALL classify an Eligible_UGL as a Fully_Inactive_UGL only when zero such Qualifying_Points_Records exist for the Detection_Quarter.
3. THE UGL_Exit_Service SHALL exclude from Detection_Quarter activity determination any Qualifying_Points_Record whose Consumed_Quarter_Marker field is already set.

### Requirement 4: Reminder Email Dispatch

**User Story:** As a UGL, I want to be notified immediately when I am found inactive for a quarter, so that I know I have 30 days to remedy the deficit.

#### Acceptance Criteria

1. WHEN the UGL_Detection_Job classifies a user as a Fully_Inactive_UGL for the Detection_Quarter, THE UGL_Exit_Service SHALL send a Reminder_Email to that user within the same job execution.
2. THE Reminder_Email SHALL state the Detection_Quarter being remedied, the required action (host an activity), and the 30-day Grace_Period.
3. THE UGL_Exit_Service SHALL send the Reminder_Email only to the Fully_Inactive_UGL and to no other recipient.
4. THE UGL_Exit_Service SHALL record the Reminder_Email send timestamp as the start of that user's Grace_Period for the Detection_Quarter.
5. THE UGL_Exit_Service SHALL send at most one Reminder_Email per Fully_Inactive_UGL per Detection_Quarter, with no additional reminder emails sent during the Grace_Period.
6. IF a Reminder_Email fails to send due to a delivery error, THEN THE UGL_Exit_Service SHALL log the failure and continue processing the remaining Fully_Inactive_UGL users in the same job run.

### Requirement 5: Grace Period Outcome Evaluation

**User Story:** As a SuperAdmin, I want the system to automatically check whether a reminded UGL remedied the deficit within 30 days, so that only genuinely unresponsive users proceed to the exit review flow.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL evaluate the Grace_Period outcome for a Fully_Inactive_UGL within 24 hours after that user's Grace_Period_Deadline has passed.
2. WHEN evaluating a Grace_Period outcome, THE UGL_Exit_Service SHALL check whether a Makeup_Record exists for that user.
3. WHEN a Makeup_Record exists at Grace_Period evaluation, THE UGL_Exit_Service SHALL set that record's Consumed_Quarter_Marker to the Detection_Quarter and SHALL treat the Detection_Quarter's deficit as remedied.
4. WHEN more than one Qualifying_Points_Record falls within a user's Grace_Period window, THE UGL_Exit_Service SHALL, at the moment of Grace_Period evaluation described in criterion 5.1 (and not immediately upon record creation), set the Consumed_Quarter_Marker on only the earliest such record, leaving any additional records available for later Detection_Quarter evaluations.
5. IF no Makeup_Record exists for a Fully_Inactive_UGL at Grace_Period evaluation, THEN THE UGL_Exit_Service SHALL mark that user as a Pending_Exit_UGL for the Detection_Quarter.

### Requirement 6: Pending Exit Notification

**User Story:** As a UGL and as a SuperAdmin, I want to be notified when a UGL is marked for pending exit, so that the UGL is aware and the SuperAdmin can take manual action.

#### Acceptance Criteria

1. WHEN a user becomes a Pending_Exit_UGL, THE UGL_Exit_Service SHALL send an Exit_Notification to that user's registered email address.
2. WHEN a user becomes a Pending_Exit_UGL, THE UGL_Exit_Service SHALL send an Exit_Notification to every SuperAdmin user's registered email address.
3. THE Exit_Notification SHALL state that the user has been marked for pending exit, the Detection_Quarter that triggered it, and that manual review is required.
4. THE UGL_Exit_Service SHALL send the Exit_Notification only to the Pending_Exit_UGL and to SuperAdmin users, and to no other recipient.

### Requirement 7: Skip Detection for Pending Exit Users

**User Story:** As a SuperAdmin, I want UGLs already under pending-exit review to be skipped by future detection runs, so that they do not receive duplicate reminders while awaiting manual resolution.

#### Acceptance Criteria

1. WHILE a user's status is Pending_Exit_UGL, THE UGL_Detection_Job SHALL exclude that user from Eligible_UGL evaluation in every subsequent run.
2. WHILE a user's status is Pending_Exit_UGL, THE UGL_Exit_Service SHALL suspend Reminder_Email dispatch that would otherwise originate from a new Fully_Inactive_UGL classification for that user, as a direct consequence of criterion 7.1 excluding the user from evaluation; this criterion does not require independent suspension logic beyond the evaluation exclusion itself.

### Requirement 8: Manual-Only Account Changes

**User Story:** As a SuperAdmin, I want the system to never automatically disable an account or remove a role, so that I retain full control over exit decisions.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL require an explicit Confirm_Exit_Action performed by a SuperAdmin before setting any user's account `status` to `disabled` as part of this feature's flow.
2. THE UGL_Exit_Service SHALL leave a Pending_Exit_UGL's `roles` array and historical PointsRecords unmodified until a SuperAdmin performs a Confirm_Exit_Action or Restore_Tracking_Action.

### Requirement 9: SuperAdmin Pending Exit List

**User Story:** As a SuperAdmin, I want to see a list of all UGLs currently marked for pending exit, so that I can review and resolve each case.

#### Acceptance Criteria

1. THE Pending_Exit_List SHALL display every current Pending_Exit_UGL with nickname, email, UG name, the Detection_Quarter that triggered the pending-exit marker, and the date the marker was set.
2. WHEN a non-SuperAdmin user requests the Pending_Exit_List data, THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`, and THE Pending_Exit_List SHALL immediately hide itself in response to the 403 rather than attempting to render any data, treating backend authorization as authoritative.
3. WHEN a non-SuperAdmin user navigates to the admin interface, THE Pending_Exit_List SHALL not be visible.
4. WHEN the Pending_Exit_List contains zero Pending_Exit_UGL users, THE Pending_Exit_List SHALL display an empty state message.

### Requirement 10: SuperAdmin Exit Review Actions

**User Story:** As a SuperAdmin, I want to confirm a UGL's exit or restore normal tracking for a pending-exit case, so that I can resolve each case according to the actual circumstances.

#### Acceptance Criteria

1. THE Pending_Exit_List SHALL provide a Confirm_Exit_Action control and a Restore_Tracking_Action control for each listed Pending_Exit_UGL.
2. WHEN a SuperAdmin invokes the Confirm_Exit_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL set that user's account `status` to `disabled` and clear the pending-exit marker.
3. WHEN a SuperAdmin invokes the Restore_Tracking_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL clear that user's pending-exit marker without changing the account `status`.
4. WHEN a SuperAdmin invokes the Restore_Tracking_Action for a Pending_Exit_UGL, THE UGL_Exit_Service SHALL make that user eligible for Eligible_UGL evaluation starting with the next UGL_Detection_Job run.
5. IF a non-SuperAdmin user attempts to invoke a Confirm_Exit_Action or Restore_Tracking_Action, THEN THE UGL_Exit_Service SHALL return a 403 Forbidden error with code `FORBIDDEN` and SHALL leave the target user's record unmodified, regardless of whether the target user is currently a Pending_Exit_UGL.
6. IF a SuperAdmin invokes a Confirm_Exit_Action or Restore_Tracking_Action on a user who is not currently a Pending_Exit_UGL, THEN THE UGL_Exit_Service SHALL return a 400 error with code `NOT_PENDING_EXIT`.

### Requirement 11: Durable State Persistence

**User Story:** As a system operator, I want pending-exit status and consumed-record markers to be durably stored, so that repeated or delayed job executions do not lose track of state.

#### Acceptance Criteria

1. THE UGL_Exit_Service SHALL persist each user's Pending_Exit_UGL marker and the triggering Detection_Quarter on the Users table so that the status is durable across job executions.
2. THE UGL_Exit_Service SHALL persist each Qualifying_Points_Record's Consumed_Quarter_Marker on the PointsRecords table so that the record cannot be re-evaluated as unconsumed by a later job execution.

### Requirement 12: Idempotent and Resilient Job Execution

**User Story:** As a system operator, I want detection and grace-period evaluation to be safe to re-run, so that retries or overlapping executions do not produce duplicate emails or inconsistent state.

#### Acceptance Criteria

1. IF the UGL_Detection_Job is executed more than once for the same Detection_Quarter, THEN THE UGL_Exit_Service SHALL avoid sending a duplicate Reminder_Email to any user who already received one for that Detection_Quarter.
2. IF an unexpected error occurs while processing one Eligible_UGL within the UGL_Detection_Job, THEN THE UGL_Exit_Service SHALL log the error and continue processing the remaining Eligible_UGL users without aborting the job run.
3. IF Grace_Period evaluation is executed more than once for the same user and Detection_Quarter, THEN THE UGL_Exit_Service SHALL avoid sending a duplicate Exit_Notification for that user and Detection_Quarter.

## Out of Scope

- Automatic removal of the `UserGroupLeader` role or automatic account disablement — every exit is confirmed manually by a SuperAdmin.
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
