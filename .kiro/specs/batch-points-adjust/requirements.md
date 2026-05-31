# Requirements Document

## Introduction

The Batch Points Adjustment feature allows a SuperAdmin to modify a previously completed batch distribution record. From the batch-history detail view, the SuperAdmin can adjust participants (add or remove users) and change the Speaker type classification, which recalculates points amounts. All changes are applied atomically across four DynamoDB tables (Users, PointsRecords, BatchDistributions, Activities) while preserving a full audit trail through correction records (`type: 'adjust'`).

## Glossary

- **Adjustment_Service**: The backend module responsible for computing diffs between the original distribution and the requested changes, and executing atomic writes across all affected DynamoDB tables.
- **Adjustment_UI**: The frontend page accessible from the batch-history detail view that allows a SuperAdmin to modify participants and speaker type for an existing distribution record.
- **Distribution_Record**: A record in the `PointsMall-BatchDistributions` table representing a single batch points distribution event, identified by `distributionId`.
- **Points_Record**: A record in the `PointsMall-PointsRecords` table representing a single points transaction for a user, with `type` field indicating `earn`, `spend`, `refund`, or `adjust`.
- **User_Record**: A record in the `PointsMall-Users` table containing user balance (`points`), total earned (`earnTotal`), and role-specific earned totals (`earnTotalSpeaker`, `earnTotalLeader`, `earnTotalVolunteer`).
- **Diff_Summary**: A computed object describing the changes between the original distribution and the adjustment request, including added users, removed users, role/speakerType changes, and net points delta.
- **PointsRuleConfig**: The system-wide configuration defining points values per role and speaker type, stored in the feature-toggles settings record.
- **SuperAdmin**: A user with the `SuperAdmin` role, the only role authorized to perform batch points adjustments.
- **Correction_Record**: A Points_Record with `type: 'adjust'` that documents a points adjustment without deleting the original `earn` record, preserving the audit trail.
- **Distribution_Deletion**: An adjustment in which the adjusted `recipientIds` list is empty, causing every original recipient to be removed and the Distribution_Record itself to be deleted while the points audit trail is preserved via Correction_Records.

## Requirements

### Requirement 1: SuperAdmin Authorization

**User Story:** As a SuperAdmin, I want only SuperAdmin users to access the adjustment feature, so that unauthorized users cannot modify distribution records.

#### Acceptance Criteria

1. WHEN a non-SuperAdmin user requests access to the adjustment API endpoint, THE Adjustment_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`.
2. WHEN a non-SuperAdmin user navigates to the Adjustment_UI route, THE Adjustment_UI SHALL redirect the user back to the batch-history page.
3. THE Adjustment_UI SHALL render the "Adjust" entry point button only WHEN the current user has the `SuperAdmin` role.

### Requirement 2: Load Original Distribution Data

**User Story:** As a SuperAdmin, I want the adjustment form to be pre-filled with the original distribution data, so that I can see the current state before making changes.

#### Acceptance Criteria

1. WHEN the SuperAdmin opens the Adjustment_UI for a given `distributionId`, THE Adjustment_UI SHALL fetch the full Distribution_Record and pre-fill the form with `targetRole`, `speakerType`, `recipientIds`, `recipientDetails`, `points`, `activityId`, and `reason`.
2. WHEN the Distribution_Record does not exist for the given `distributionId`, THE Adjustment_Service SHALL return a 404 error with code `DISTRIBUTION_NOT_FOUND`.
3. THE Adjustment_UI SHALL display the associated activity information (type, UG name, topic, date) as read-only context.

### Requirement 3: Adjust Participants

**User Story:** As a SuperAdmin, I want to add or remove participants from a distribution, so that I can correct who received points.

#### Acceptance Criteria

1. THE Adjustment_UI SHALL display a user list with checkboxes, pre-selecting users from the original `recipientIds`.
2. WHEN the SuperAdmin checks a user not in the original `recipientIds`, THE Adjustment_UI SHALL add that user to the "added users" set in the Diff_Summary.
3. WHEN the SuperAdmin unchecks a user from the original `recipientIds`, THE Adjustment_UI SHALL add that user to the "removed users" set in the Diff_Summary.
4. THE Adjustment_UI SHALL support search filtering by nickname or email within the user list.
5. THE Adjustment_UI SHALL display the Diff_Summary showing the count of added users, removed users, and net points change (±) before submission.

### Requirement 4: Adjust Speaker Type

**User Story:** As a SuperAdmin, I want to change the speaker type classification of a distribution, so that points amounts are recalculated correctly.

#### Acceptance Criteria

1. WHILE the `targetRole` is `Speaker`, THE Adjustment_UI SHALL display speaker type options (`typeA`, `typeB`, `roundtable`) with the original value pre-selected.
2. WHEN the SuperAdmin selects a different speaker type, THE Adjustment_UI SHALL recalculate the per-person points value using the current PointsRuleConfig.
3. WHEN the speaker type changes, THE Diff_Summary SHALL reflect the per-person points difference and the total points delta for all remaining participants.
4. IF the `targetRole` is not `Speaker`, THEN THE Adjustment_UI SHALL hide the speaker type selector.

### Requirement 5: Compute Adjustment Diff

**User Story:** As a SuperAdmin, I want the system to compute the exact diff between original and adjusted state, so that only the necessary corrections are applied.

#### Acceptance Criteria

1. THE Adjustment_Service SHALL compute the set of added users (in new `recipientIds` but not in original), removed users (in original but not in new `recipientIds`), and retained users.
2. WHEN the speaker type or target role changes, THE Adjustment_Service SHALL compute the per-person points delta as `newPoints - originalPoints` for all retained and added users.
3. FOR removed users, THE Adjustment_Service SHALL compute a negative adjustment equal to the original `points` value.
4. FOR added users, THE Adjustment_Service SHALL compute a positive adjustment equal to the new `points` value.
5. FOR retained users where points changed (due to speaker type change), THE Adjustment_Service SHALL compute the delta as `newPoints - originalPoints`.

### Requirement 6: Atomic Multi-Table Update

**User Story:** As a SuperAdmin, I want all table updates to be applied atomically, so that no partial state exists if a failure occurs.

#### Acceptance Criteria

1. THE Adjustment_Service SHALL use DynamoDB `TransactWriteCommand` to update User_Records, write Correction_Records, and update the Distribution_Record within a single transaction.
2. WHEN the total number of affected users exceeds 25 (the TransactWriteItems limit per batch), THE Adjustment_Service SHALL split operations into multiple transaction batches.
3. IF any transaction batch fails, THEN THE Adjustment_Service SHALL return an error with code `ADJUSTMENT_FAILED` and a descriptive message.
4. THE Adjustment_Service SHALL update the Distribution_Record only after all user-level transaction batches succeed.

### Requirement 7: Update User Balances and Earned Totals

**User Story:** As a SuperAdmin, I want user balances and role-specific earned totals to be precisely adjusted, so that leaderboard rankings remain accurate.

#### Acceptance Criteria

1. FOR each affected user, THE Adjustment_Service SHALL update the `points` (balance) field by the computed delta (positive or negative).
2. FOR each affected user, THE Adjustment_Service SHALL update the `earnTotal` field by the computed delta.
3. FOR each affected user, THE Adjustment_Service SHALL update the role-specific earned total field (`earnTotalSpeaker`, `earnTotalLeader`, or `earnTotalVolunteer`) corresponding to the original `targetRole` by the computed delta.
4. WHEN the `targetRole` changes between roles (e.g., Speaker to Volunteer), THE Adjustment_Service SHALL decrease the original role's earned total and increase the new role's earned total for retained users.
5. IF the adjustment would cause a user's `points` balance to become negative, THEN THE Adjustment_Service SHALL reject the adjustment with error code `INSUFFICIENT_BALANCE`.

### Requirement 8: Write Correction Records

**User Story:** As a SuperAdmin, I want correction records to be written for every adjustment, so that the audit trail is preserved and reports remain accurate.

#### Acceptance Criteria

1. FOR each removed user, THE Adjustment_Service SHALL write a Correction_Record with `type: 'adjust'`, negative `amount` equal to the original points, and `source` indicating the adjustment context.
2. FOR each added user, THE Adjustment_Service SHALL write a Correction_Record with `type: 'adjust'`, positive `amount` equal to the new points, and `source` indicating the adjustment context.
3. FOR each retained user where points changed, THE Adjustment_Service SHALL write a Correction_Record with `type: 'adjust'` and `amount` equal to the delta.
4. THE Correction_Record SHALL include `activityId`, `activityUG`, `activityTopic`, `activityDate`, `targetRole`, and a reference to the original `distributionId`.
5. THE Adjustment_Service SHALL preserve the original `earn` records and not delete or modify them.

### Requirement 9: Update Distribution Record

**User Story:** As a SuperAdmin, I want the distribution record to reflect the adjusted state, so that the batch-history view shows accurate data.

#### Acceptance Criteria

1. THE Adjustment_Service SHALL update the Distribution_Record's `recipientIds` to the new set of user IDs.
2. THE Adjustment_Service SHALL update `recipientDetails` to include nickname and email for all new recipients.
3. THE Adjustment_Service SHALL update `targetRole` and `speakerType` to the new values.
4. THE Adjustment_Service SHALL recalculate and update `points` (per-person), `successCount`, and `totalPoints` based on the adjusted state.
5. THE Adjustment_Service SHALL add an `adjustedAt` timestamp and `adjustedBy` (SuperAdmin userId) to the Distribution_Record.

### Requirement 10: Adjustment Validation

**User Story:** As a SuperAdmin, I want the system to validate the adjustment request before execution, so that invalid adjustments are rejected early.

#### Acceptance Criteria

1. WHEN the adjusted `recipientIds` list is empty (contains zero user IDs), THE Adjustment_Service SHALL treat the request as a full deletion of the Distribution_Record and process it according to Requirement 13 rather than rejecting it.
2. IF the adjusted `recipientIds` list is non-empty AND the `targetRole` is `Speaker` AND no `speakerType` is provided, THEN THE Adjustment_Service SHALL reject the request with error code `INVALID_REQUEST` and leave the Distribution_Record unchanged.
3. IF the adjusted `recipientIds` list is non-empty AND the `targetRole` is `Volunteer` AND the adjusted recipient count exceeds `volunteerMaxPerEvent` from PointsRuleConfig, THEN THE Adjustment_Service SHALL reject the request with error code `VOLUNTEER_LIMIT_EXCEEDED` and leave the Distribution_Record unchanged.
4. WHILE the adjusted `recipientIds` list is non-empty, THE Adjustment_Service SHALL recalculate the per-person points value from the current PointsRuleConfig rather than accepting a client-provided points value.
5. IF the adjusted `recipientIds` list is non-empty AND no actual changes are detected (identical set of recipient user IDs, identical `targetRole`, and identical `speakerType` compared to the current Distribution_Record), THEN THE Adjustment_Service SHALL reject the request with error code `NO_CHANGES` and an error message indicating that no changes were detected.
6. WHEN the adjusted `recipientIds` list is empty, THE Adjustment_Service SHALL skip the `speakerType`, `VOLUNTEER_LIMIT_EXCEEDED`, and `NO_CHANGES` validations and proceed to the deletion flow defined in Requirement 13.
7. IF the adjusted `recipientIds` list is non-empty AND the `targetRole` is `Speaker` AND the provided `speakerType` is not one of `typeA`, `typeB`, or `roundtable`, THEN THE Adjustment_Service SHALL reject the request with error code `INVALID_REQUEST` and leave the Distribution_Record unchanged.
8. IF the adjustment request fails any validation, THEN THE Adjustment_Service SHALL reject the request before performing any write to the Users, PointsRecords, BatchDistributions, or Activities tables, leaving the Distribution_Record and all User_Records unchanged.

### Requirement 11: Confirmation Dialog with Diff Summary

**User Story:** As a SuperAdmin, I want to see a clear summary of all changes before confirming, so that I can verify the adjustment is correct.

#### Acceptance Criteria

1. WHEN the SuperAdmin clicks the submit button, THE Adjustment_UI SHALL display a confirmation dialog showing the Diff_Summary.
2. THE confirmation dialog SHALL display: count of added users, count of removed users, original points per person, new points per person, and total points delta.
3. THE confirmation dialog SHALL list the nicknames of added and removed users.
4. WHEN the SuperAdmin confirms the dialog, THE Adjustment_UI SHALL send the adjustment request to the Adjustment_Service.
5. WHEN the SuperAdmin cancels the dialog, THE Adjustment_UI SHALL close the dialog without making changes.

### Requirement 12: Adjustment History Tracking

**User Story:** As a SuperAdmin, I want to see that a distribution has been adjusted in the history view, so that I can distinguish adjusted records from original ones.

#### Acceptance Criteria

1. WHEN a Distribution_Record has an `adjustedAt` field, THE batch-history detail view SHALL display an "Adjusted" badge alongside the record.
2. THE batch-history detail view SHALL display the `adjustedAt` timestamp and the `adjustedBy` SuperAdmin's identity.
3. THE Adjustment_UI SHALL be accessible from the batch-history detail view via an "Adjust" button visible only to SuperAdmin users.

### Requirement 13: Delete Distribution via Full Recipient Removal

**User Story:** As a SuperAdmin, I want removing all recipients from a distribution to delete the entire distribution and reverse every awarded point, so that I can fully undo a distribution that was created in error.

#### Acceptance Criteria

1. WHEN the adjusted `recipientIds` list is empty, THE Adjustment_Service SHALL treat the request as a Distribution_Deletion in which every user in the original `recipientIds` is a removed user.
2. FOR each removed user in a Distribution_Deletion, THE Adjustment_Service SHALL reverse the `points` balance, `earnTotal`, and the role-specific earned total field (`earnTotalSpeaker`, `earnTotalLeader`, or `earnTotalVolunteer`) corresponding to the original `targetRole` by the amount that user originally received from the Distribution_Record.
3. WHERE skill-claim points are tied to the Distribution_Record being deleted, THE Adjustment_Service SHALL reverse each affected user's `points` balance, `earnTotal`, and `earnTotalLeader` by the `pointsAwarded` of the associated skill claim and remove the corresponding skill-claim record.
4. FOR each removed user in a Distribution_Deletion, THE Adjustment_Service SHALL write a Correction_Record with `type: 'adjust'`, negative `amount` equal to the points being reversed, and `source` indicating the deletion context, before the Distribution_Record is deleted.
5. THE Adjustment_Service SHALL preserve the original `earn` records and the written Correction_Records in the `PointsRecords` table so that the points audit trail remains intact after the Distribution_Record is deleted.
6. THE Adjustment_Service SHALL apply all User_Record balance reversals, Correction_Record writes, skill-claim removals, and the Distribution_Record deletion as a single atomic operation, using DynamoDB `TransactWriteCommand` and splitting into multiple transaction batches of at most 25 items each (the DynamoDB TransactWriteItems limit per Requirement 6.2) WHEN the affected item count exceeds 25.
7. WHEN every user-level transaction batch of a Distribution_Deletion succeeds, THE Adjustment_Service SHALL hard-delete the Distribution_Record from the `BatchDistributions` table, consistent with the hard-delete pattern used elsewhere in the system.
8. IF any transaction batch of a Distribution_Deletion fails, THEN THE Adjustment_Service SHALL stop processing further batches, return an error with code `ADJUSTMENT_FAILED`, and leave the Distribution_Record in place without deleting it.
9. IF reversing points during a Distribution_Deletion would cause any user's `points` balance to become negative, THEN THE Adjustment_Service SHALL perform this check before any reversal write and reject the deletion with error code `INSUFFICIENT_BALANCE`, leaving the Distribution_Record and all User_Records unchanged, consistent with Requirement 7.5.
10. WHEN a non-SuperAdmin user requests a Distribution_Deletion, THE Adjustment_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`, consistent with Requirement 1.
11. WHEN the SuperAdmin removes all recipients and clicks the submit button, THE Adjustment_UI SHALL display a confirmation dialog whose message identifies the distribution being deleted, states that confirming will delete the entire distribution and reverse all awarded points, and differs from the standard adjustment confirmation message.
12. WHEN the adjusted recipient list is empty, THE Adjustment_UI SHALL allow the SuperAdmin to proceed with the submit and confirm path with zero recipients.
13. WHEN the SuperAdmin confirms a Distribution_Deletion, THE Adjustment_UI SHALL send the adjustment request with an empty `recipientIds` list to the Adjustment_Service.
14. WHEN a Distribution_Deletion completes successfully, THE Adjustment_Service SHALL return a success response that includes the deleted `distributionId` and the count of users whose points were reversed.
15. WHEN a Distribution_Deletion completes successfully, THE Adjustment_UI SHALL display a success notification and navigate back to the batch-history view.
