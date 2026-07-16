# Implementation Plan: Announcement Role Transition

## Overview

Make role-change adjustment records self-explanatory in the leaderboard announcement feed. The implementation adds three additive descriptive fields (`originalRole`, `originalPoints`, `newPoints`) to the shared contract, captures them at write time in the Adjustment_Writer (Option A), resolves them at read time in the Announcement_Service — falling back to the earliest Retained_Earn_Record for historical records (Option B) — and renders a role-transition message in the Leaderboard_UI distinct from add/remove/deletion/skill wording, with full i18n across all five locales.

Implementation order: shared type → write-time capture → read-time resolution helper + earn lookup → item assembly + fault isolation → UI signed-delta helper + transition branch → i18n keys and types. Property tests sit next to each pure function they validate. Point/counter/ranking behavior is unchanged (display-and-supporting-data only).

Language: **TypeScript** (matches the existing backend/frontend and the design's code samples).

## Tasks

- [x] 1. Add shared type fields for the role transition contract
  - [x] 1.1 Extend `LeaderboardAnnouncementItem` in `packages/shared/src/types.ts`
    - Add three optional fields: `originalRole?: string`, `originalPoints?: number`, `newPoints?: number`
    - Keep all existing fields unchanged so backend and frontend share one contract
    - _Requirements: 2.1, 2.6_

- [x] 2. Write-time capture in the Adjustment_Writer (Option A)
  - [x] 2.1 Persist original-role fields on role-change Correction_Records in `packages/backend/src/admin/batch-points-adjust.ts`
    - In `executeAdjustment`, inside the retained-user `Put` for the Correction_Record, add `originalRole`, `originalPoints`, `newPoints` only when the recipient is retained AND the role changed (`roleChanged && isRetained`)
    - Source values: `originalRole = original.targetRole`, `originalPoints = diff.originalPoints`, `newPoints = diff.newPoints`
    - Do NOT add these fields for added/removed recipients or same-role adjustments
    - Leave `amount` (Net_Delta), `targetRole` (New_Role), `source`, and all existing fields byte-for-byte unchanged; add no new transaction items and no new point movement
    - _Requirements: 2.2, 2.6, 6.3_

  - [ ]* 2.2 Write unit test for Option A write-path capture
    - Role-change-of-retained-recipient example (Speaker/50 → Volunteer/30) → assert the written Correction_Record carries `originalRole='Speaker'`, `originalPoints=50`, `newPoints=30`, and `amount=-20`
    - Assert exactly one Correction_Record is written per retained user and no additional point-moving record is produced
    - Add to `packages/backend/src/admin/batch-points-adjust.test.ts`
    - _Requirements: 2.2, 6.3_

- [x] 3. Read-time resolution in the Announcement_Service
  - [x] 3.1 Implement `resolveRoleTransition` in `packages/backend/src/leaderboard/announcements.ts`
    - Add the `RoleTransition` interface (`originalRole?`, `originalPoints?`, `newPoints?`, `resolvable: boolean`)
    - Implement the pure helper `resolveRoleTransition(correction, retainedEarnRecords)`:
      - Non-`积分调整:` source → `{ resolvable: false }`
      - Option A: if `correction.originalRole` is present and differs from `correction.targetRole`, return resolvable with persisted fields, deriving `originalPoints = newPoints - correction.amount` (or `newPoints = originalPoints + correction.amount`) when a numeric field is missing
      - Option B: else pick the earliest-created earn record whose `distributionId` (preferred) or `activityId` matches and whose `type==='earn'`; if its `targetRole` differs from `correction.targetRole`, return resolvable inferred from it
      - Else → `{ resolvable: false }`
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [ ]* 3.2 Write property test for role-transition resolution correctness
    - **Property 2: Role-transition resolution correctness**
    - **Validates: Requirements 2.1, 2.3, 2.5**

  - [ ]* 3.3 Write property test for earliest-created Retained_Earn_Record selection
    - **Property 3: Earliest-created Retained_Earn_Record selection**
    - **Validates: Requirements 2.4**

  - [x] 3.4 Add best-effort Retained_Earn_Record lookup in `packages/backend/src/leaderboard/announcements.ts`
    - For adjust records lacking persisted `originalRole`, collect their `userId`s and query `PointsRecords` via the existing `userId-createdAt-index` GSI (`userId = :uid`, `FilterExpression: #type = :earn`)
    - Group results by `userId` in memory and pass the matching earn records to `resolveRoleTransition`
    - Skip the lookup entirely when Option A data is present; on a transient query failure, fall back to `resolvable: false` rather than failing the feed
    - _Requirements: 2.3, 2.4, 3.4_

- [x] 4. Assemble AnnouncementItem with fault isolation
  - [x] 4.1 Populate transition fields and isolate failures in `getAnnouncements` (`packages/backend/src/leaderboard/announcements.ts`)
    - Populate `originalRole`, `originalPoints`, `newPoints` on each `AnnouncementItem` only when `resolveRoleTransition` returns `resolvable: true`
    - Preserve `amount`, `targetRole`, and `source` exactly equal to the source record
    - For Historical_Adjustments lacking the new fields, still return a valid item with New_Role + Net_Delta and never throw
    - Wrap per-item assembly so a record that cannot produce a valid item is omitted (filtered) while remaining records are still returned
    - _Requirements: 2.6, 3.3, 3.4, 6.1_

  - [ ]* 4.2 Write property test for additive fields preserving core semantics
    - **Property 4: Additive fields preserve core semantics**
    - **Validates: Requirements 2.6, 6.1**

  - [ ]* 4.3 Write property test for backward-compatible, fault-isolated assembly
    - **Property 9: Backward-compatible, fault-isolated assembly**
    - **Validates: Requirements 3.3, 3.4**

- [x] 5. Checkpoint - Backend capture, resolution, and assembly complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Leaderboard_UI signed-delta formatter and role-transition rendering
  - [x] 6.1 Add `formatDelta` signed-delta helper in `packages/frontend/src/pages/leaderboard/index.tsx`
    - `n > 0` → `+{n}`, `n < 0` → native `-` sign, `n === 0` → `"0"` (no positive sign)
    - _Requirements: 1.2, 3.2, 5.6_

  - [ ]* 6.2 Write property test for signed delta formatting
    - **Property 1: Signed delta formatting**
    - **Validates: Requirements 1.2, 3.2, 5.6**

  - [x] 6.3 Add the role-transition branch to `formatRecord` in `packages/frontend/src/pages/leaderboard/index.tsx`
    - Add `isRoleTransition` predicate: `积分调整:` source AND `originalRole` present AND `originalRole !== targetRole`
    - Place the transition branch BEFORE the existing sign-based `积分调整:` branches so a positive/negative/zero delta cannot be misrouted
    - Render via `leaderboard.adjustmentRoleTransitionTemplate` using `ROLE_DISPLAY_LABEL` for both the Original_Role and New_Role, plus Original_Points, New_Points, signed `formatDelta(amount)`, recipient nickname, and activity user group + date
    - When `originalRole` is absent, fall through to the existing `adjustmentAddedTemplate` / `adjustmentReversedTemplate` / `adjustmentReversedNoDistributorTemplate` branches (new-role + delta only, no partial original-role text)
    - Keep the defensive `|| '—'` defaults so a missing activity field never yields an empty message
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 3.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 6.4 Write property test for resolvable role-transition render completeness
    - **Property 5: Resolvable role-transition render completeness**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 4.1**

  - [ ]* 6.5 Write property test for unresolvable fallback render
    - **Property 6: Unresolvable fallback render**
    - **Validates: Requirements 1.6, 3.1, 4.2**

  - [ ]* 6.6 Write property test for universal usable-message rendering
    - **Property 7: Every correction record renders a usable message**
    - **Validates: Requirements 3.5**

  - [ ]* 6.7 Write property test for adjustment-kind template selection
    - **Property 8: Adjustment-kind template selection**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

- [x] 7. Internationalization of the role-transition string
  - [x] 7.1 Declare and define the role-transition template key across all five locales
    - Declare `leaderboard.adjustmentRoleTransitionTemplate` in `packages/frontend/src/i18n/types.ts`
    - Define the localized string in `zh`, `en`, `zh-TW`, `ja`, `ko` under `packages/frontend/src/i18n/`
    - Each string SHALL include placeholders for all five values: `{originalRole}`, `{targetRole}`, `{originalPoints}`, `{newPoints}`, `{delta}` (plus recipient/activity context); `{delta}` is pre-signed by `formatDelta`
    - Rely on the existing `adjustmentReversedTemplate` / `adjustmentReversedNoDistributorTemplate` keys (present in all five locales) for the unresolvable fallback — no new fallback key needed
    - Keep all locales sharing an identical key set (no missing or extra keys)
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [ ]* 7.2 Write property test for locale placeholder completeness
    - **Property 10: Locale placeholder completeness**
    - **Validates: Requirements 5.4**

  - [ ]* 7.3 Run the existing i18n key-parity suite
    - Ensure `i18n.property.test.ts` passes with the new `adjustmentRoleTransitionTemplate` key added to `types.ts` and all five locales (identical key set)
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 8. Integration tests for non-goal invariants (point/counter/audit-trail preservation)
  - [ ]* 8.1 Write integration test for transaction atomicity on failure
    - Simulate a failing `TransactWriteCommand`; assert `executeAdjustment` returns `{ success: false, error }` and no partial user updates to `points`/`earnTotal*` persist
    - _Requirements: 6.4_

  - [ ]* 8.2 Write integration test for audit-trail immutability
    - Assert the adjustment transaction issues no `Update`/`Put`/`Delete` against existing `type='earn'` Retained_Earn_Records
    - _Requirements: 6.5_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 10 universal correctness properties from the design document; use `fast-check` + `vitest` with minimum 100 iterations, tagged `// Feature: announcement-role-transition, Property {n}: {text}`
- Property placement: P1 next to `formatDelta`, P2/P3 next to `resolveRoleTransition`, P4/P9 next to item assembly, P5–P8 next to `formatRecord`, P10 next to the i18n dictionaries
- This feature is display-and-supporting-data only: `points`, `earnTotal*` counters, and ranking code are not modified (Requirement 6.2 relies on the existing verified ranking tests)
- i18n covers 5 locales: zh, en, zh-TW, ja, ko; the unresolvable fallback reuses existing template keys

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "6.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "3.4", "6.2", "7.2", "7.3"] },
    { "id": 3, "tasks": ["4.1", "6.3"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.4", "6.5", "6.6", "6.7", "8.1", "8.2"] }
  ]
}
```
