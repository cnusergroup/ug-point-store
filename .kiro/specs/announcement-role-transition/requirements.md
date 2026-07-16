# Requirements Document

## Introduction

The积分发放公告栏 (leaderboard announcement feed, `GET /api/leaderboard/announcements`) renders `type='earn'` and `type='adjust'` PointsRecords as human-readable messages. When an administrator edits an existing distribution so that a retained recipient changes role (for example, Peter changes from Speaker awarded 50 points to Volunteer awarded 30 points), the system today writes a single net correction record (`type='adjust'`, `amount = -20`, `targetRole = Volunteer`) and the feed shows only the net delta and the NEW role. Viewers cannot tell what the original role was or how the point value changed.

This feature makes role-change adjustment records self-explanatory in the announcement feed: they must state the original role, the new role, and the point change (both the original and new point values, and the net delta). The feature covers the supporting data capture needed to display the original role, backward-compatible handling of historical adjustment records that lack this data, wording that distinguishes role-change adjustments from other adjustment kinds, and full internationalization across all five supported locales.

This feature is display-and-supporting-data only. It does NOT change how point totals, denormalized role counters (`earnTotal*`), or rankings are computed; those are already verified correct in production.

## Glossary

- **Announcement_Feed**: The leaderboard dynamic stream returned by `GET /api/leaderboard/announcements`, backed by `packages/backend/src/leaderboard/announcements.ts`.
- **Announcement_Service**: The backend module `packages/backend/src/leaderboard/announcements.ts` that queries PointsRecords, resolves nicknames/distributors, and assembles `AnnouncementItem` objects.
- **Adjustment_Writer**: The backend module `packages/backend/src/admin/batch-points-adjust.ts` (`executeAdjustment`) that writes `type='adjust'` correction records.
- **Leaderboard_UI**: The frontend page `packages/frontend/src/pages/leaderboard/index.tsx` that renders each `AnnouncementItem` using per-source i18n templates.
- **PointsRecord**: An item in the PointsRecords table. Relevant fields include `recordId`, `userId`, `type` (`earn` | `adjust` | `spend`), `amount`, `source`, `createdAt`, `targetRole`, `activityId`, `activityUG`, `activityTopic`, `activityDate`, `distributionId`.
- **Correction_Record**: A PointsRecord with `type='adjust'` written by the Adjustment_Writer.
- **Role_Change_Adjustment**: A Correction_Record produced when a retained recipient's role changes during a distribution edit (original role differs from new role). Source prefix `积分调整:`.
- **Same_Role_Adjustment**: A Correction_Record for adding or removing recipients without a role change (source prefix `积分调整:`, positive delta for additions, negative delta for removals).
- **Deletion_Adjustment**: A Correction_Record produced by a full distribution deletion (source prefix `发放删除:` or `技能释放(删除):`).
- **Skill_Adjustment**: A Correction_Record for skill lock release or assignment (source prefix `技能释放:` or `技能指派:`), always `targetRole='UserGroupLeader'`.
- **Original_Role**: The role a retained recipient held before a Role_Change_Adjustment (e.g. Speaker).
- **New_Role**: The role a retained recipient holds after a Role_Change_Adjustment (e.g. Volunteer).
- **Original_Points**: The point value awarded under the Original_Role (e.g. 50).
- **New_Points**: The point value awarded under the New_Role (e.g. 30).
- **Net_Delta**: `New_Points − Original_Points` (e.g. -20), the `amount` stored on the Correction_Record.
- **Historical_Adjustment**: A Correction_Record written before this feature ships, which lacks the new original-role/original-points/new-points fields.
- **Retained_Earn_Record**: The original `type='earn'` PointsRecord for the recipient, retained as an audit trail, still carrying the Original_Role in its `targetRole` and linked by `distributionId`/`activityId`.
- **Role_Display_Label**: The localized, user-facing label for a role (e.g. Speaker → 讲师), resolved by `ROLE_DISPLAY_LABEL` in Leaderboard_UI.
- **Supported_Locales**: The five locale files `zh`, `en`, `zh-TW`, `ja`, `ko` under `packages/frontend/src/i18n/`, validated by `i18n.property.test.ts`.

## Requirements

### Requirement 1: Role-change adjustment display shows role transition and point change

**User Story:** As a leaderboard viewer, I want a role-change adjustment record to clearly state the original role, the new role, and how the points changed, so that I understand why a recipient's points were adjusted without guessing.

#### Acceptance Criteria

1. WHEN the Leaderboard_UI renders a Role_Change_Adjustment that has resolvable original-role data, THE Leaderboard_UI SHALL display the Original_Role, the New_Role, the Original_Points, and the New_Points together within a single message.
2. WHEN the Leaderboard_UI renders a Role_Change_Adjustment that has resolvable original-role data, THE Leaderboard_UI SHALL display the Net_Delta computed as New_Points − Original_Points, including a sign indicator that distinguishes an increase (positive), a decrease (negative), and no change (zero).
3. WHERE role labels are shown for a Role_Change_Adjustment, THE Leaderboard_UI SHALL use the Role_Display_Label for both the Original_Role and the New_Role.
4. WHEN the Leaderboard_UI renders a Role_Change_Adjustment, THE Leaderboard_UI SHALL identify the recipient by recipient nickname.
5. WHEN the Leaderboard_UI renders a Role_Change_Adjustment, THE Leaderboard_UI SHALL identify the activity by activity user group and activity date.
6. IF the Leaderboard_UI renders a Role_Change_Adjustment whose original-role data cannot be resolved, THEN THE Leaderboard_UI SHALL still display the record in the feed showing the New_Role and New_Points, and SHALL indicate that the original role and Net_Delta are unavailable.

### Requirement 2: Capture data needed to display the original role

**User Story:** As a product owner, I want the system to make the original role and point values available to the Announcement_Feed for role-change adjustments, so that the transition can be displayed accurately.

#### Acceptance Criteria

1. WHEN the Announcement_Service assembles an `AnnouncementItem` for a Role_Change_Adjustment whose Original_Role is determinable (either persisted on the Correction_Record or inferable from the Retained_Earn_Record), THE Announcement_Service SHALL include the Original_Role, Original_Points, and New_Points on that `AnnouncementItem`.
2. WHERE the Adjustment_Writer records a Role_Change_Adjustment for a retained recipient, THE Adjustment_Writer SHALL persist the Original_Role, Original_Points, and New_Points on the Correction_Record (Option A: capture at write time).
3. WHERE the original-role data is not persisted on a Correction_Record, THE Announcement_Service SHALL derive the Original_Role and Original_Points from the Retained_Earn_Record linked by `distributionId` or `activityId` at read time (Option B: infer at read time).
4. IF multiple Retained_Earn_Records match the same `distributionId` or `activityId` for a recipient, THEN THE Announcement_Service SHALL derive the Original_Role and Original_Points from the earliest-created matching Retained_Earn_Record.
5. IF neither a persisted original-role field nor a Retained_Earn_Record is available for a Role_Change_Adjustment, THEN THE Announcement_Service SHALL return the `AnnouncementItem` without original-role fields while preserving the New_Role, Net_Delta, and source.
6. THE system SHALL preserve the existing `amount` (Net_Delta), `targetRole` (New_Role), and `source` semantics of the Correction_Record when adding original-role data.

> Note: Requirement 2.2 (Option A) and Requirement 2.3 (Option B) are alternative data-capture strategies. The design phase SHALL select one primary approach; Requirement 2.1 states the outcome that must hold regardless of approach.

### Requirement 3: Backward-compatible display for historical adjustment records

**User Story:** As a leaderboard viewer, I want older adjustment records that lack original-role data to still render a clear message, so that historical entries remain readable after the feature ships.

#### Acceptance Criteria

1. IF a Correction_Record is a Role_Change_Adjustment for which no Original_Role can be resolved (neither persisted nor inferable), THEN THE Leaderboard_UI SHALL display an adjustment message that includes the New_Role label and the Net_Delta value and SHALL NOT display any text asserting an original role.
2. WHEN the Leaderboard_UI displays a Net_Delta, THE Leaderboard_UI SHALL prefix the value with a "+" sign when the Net_Delta is greater than zero and a "-" sign when the Net_Delta is less than zero, so that the direction of the adjustment is unambiguous.
3. WHEN the Announcement_Service processes a Historical_Adjustment that lacks original-role fields, THE Announcement_Service SHALL return a valid `AnnouncementItem` populated with the New_Role and the Net_Delta and SHALL NOT raise an error.
4. IF the Announcement_Service cannot construct a valid `AnnouncementItem` from a Historical_Adjustment, THEN THE Announcement_Service SHALL omit that record from the Announcement_Feed and SHALL NOT abort processing of the remaining Correction_Records.
5. THE Leaderboard_UI SHALL render every Correction_Record returned by the Announcement_Feed as a non-empty message that contains both a role label and a Net_Delta value, regardless of whether original-role data is present.

### Requirement 4: Distinguish adjustment kinds in displayed wording

**User Story:** As a leaderboard viewer, I want different kinds of adjustments to read differently, so that a role change is not confused with a simple add, removal, deletion, or skill change.

#### Acceptance Criteria

1. WHEN the Leaderboard_UI renders a Role_Change_Adjustment (a `积分调整:` Correction_Record whose Original_Role differs from its New_Role) with resolvable original-role data, THE Leaderboard_UI SHALL use wording that names both the Original_Role and the New_Role and describes a transition from the former to the latter.
2. IF the Leaderboard_UI renders a `积分调整:` Correction_Record whose original-role data cannot be resolved, THEN THE Leaderboard_UI SHALL use the existing adjustment wording referencing the New_Role and Net_Delta and SHALL NOT display partial or empty original-role text.
3. WHEN the Leaderboard_UI renders a Same_Role_Adjustment with a Net_Delta greater than zero (added recipient), THE Leaderboard_UI SHALL use the supplemental-award wording that references the New_Role only.
4. WHEN the Leaderboard_UI renders a Same_Role_Adjustment with a Net_Delta less than zero (removed recipient) where the role is unchanged, THE Leaderboard_UI SHALL use the existing adjustment wording that references the affected role and the Net_Delta.
5. WHEN the Leaderboard_UI renders a Deletion_Adjustment, THE Leaderboard_UI SHALL use the existing deletion/reversal wording and SHALL NOT present it as a role transition.
6. WHEN the Leaderboard_UI renders a Skill_Adjustment (`技能释放:`, `技能释放(删除):`, or `技能指派:`), THE Leaderboard_UI SHALL use the existing skill wording and SHALL NOT present it as a role transition.

### Requirement 5: Internationalization of new display strings

**User Story:** As a non-Chinese-speaking viewer, I want the role-transition message available in my language, so that the feed is consistent across locales and passes localization validation.

#### Acceptance Criteria

1. WHERE a new display string is introduced for the role-transition message, THE system SHALL define that string in each of the five Supported_Locales (`zh`, `en`, `zh-TW`, `ja`, `ko`).
2. THE system SHALL declare any new leaderboard template key in the i18n type definition (`packages/frontend/src/i18n/types.ts`) so that all Supported_Locales share an identical key set with no missing or extra keys.
3. WHEN `i18n.property.test.ts` runs after new strings are added, THE test suite SHALL pass.
4. WHERE the role-transition message includes the Original_Role, New_Role, Original_Points, New_Points, and Net_Delta, THE localized string in each Supported_Locale SHALL include a placeholder for each of those five values.
5. WHERE the fallback message for an unresolvable original role is rendered, THE localized string SHALL exist in all five Supported_Locales and reference the New_Role and Net_Delta.
6. WHEN a localized string displays the Net_Delta, THE localized string SHALL present it with a sign indicating an increase (positive) or a decrease (negative).

### Requirement 6: Preserve point, counter, and ranking behavior (non-goals)

**User Story:** As a product owner, I want this feature to change only display and supporting data, so that existing correct point calculations and rankings are not affected.

#### Acceptance Criteria

1. WHEN identical inputs are supplied before and after this feature is deployed, THE system SHALL produce identical values for user `points`, `earnTotal`, and role-specific counters (`earnTotalSpeaker`, `earnTotalVolunteer`, `earnTotalLeader`), such that the computed value for each field matches exactly (no numeric difference).
2. WHEN identical inputs are supplied before and after this feature is deployed, THE system SHALL produce an identical leaderboard ranking order, such that every recipient occupies the same rank position as before the feature.
3. WHEN a role change is applied to a retained recipient, THE Adjustment_Writer SHALL write exactly one net Correction_Record for that recipient and SHALL NOT create any additional point-moving record attributable to this feature.
4. IF applying a role change to a retained recipient fails before the single net Correction_Record is committed, THEN THE Adjustment_Writer SHALL leave the recipient's `points`, `earnTotal`, and role-specific counters at their pre-change values and SHALL surface an indication that the correction did not complete.
5. THE system SHALL retain each Retained_Earn_Record as an unmodified audit trail, such that no field of an existing Retained_Earn_Record is altered or removed by this feature.
