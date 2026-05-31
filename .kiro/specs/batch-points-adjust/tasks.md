# Implementation Plan: Distribution Deletion via Full Recipient Removal

## Overview

Extend the existing batch-points-adjust feature to support Distribution Deletion — when the adjusted `recipientIds` list is empty, the system reverses all awarded points (including skill-claim points), writes correction records for audit trail, and hard-deletes the Distribution_Record. This covers Requirement 13 (Delete Distribution) and the revised Requirement 10 (allowing empty recipientIds to trigger deletion flow instead of rejecting).

Implementation order: backend validation change → executeDeletion function → routing in executeAdjustment → handler response update → backend tests → frontend deletion mode → deletion confirmation dialog → i18n keys → SCSS styling.

## Tasks

- [x] 1. Backend: Modify validateAdjustmentInput to allow empty recipientIds
  - [x] 1.1 Update `validateAdjustmentInput` in `packages/backend/src/admin/batch-points-adjust.ts`
    - Change the `AdjustmentValidationResult` type to include optional `isDeletion?: boolean` on the valid branch
    - Replace the current "reject empty recipientIds" logic with: if `recipientIds` is empty, return `{ valid: true, isDeletion: true }` (skip speakerType, volunteer limit, and NO_CHANGES checks)
    - Keep all existing validations for non-empty recipientIds unchanged
    - Add validation for invalid speakerType values (Requirement 10.7): if targetRole is Speaker and speakerType is not one of `typeA`, `typeB`, `roundtable`, reject with `INVALID_REQUEST`
    - _Requirements: 10.1, 10.6, 10.7, 10.8_

  - [ ]* 1.2 Write property test for validateAdjustmentInput deletion path
    - **Property 1: Empty recipientIds bypasses non-deletion validations and enters deletion flow**
    - Generate random DistributionRecords (any targetRole, any speakerType), call `validateAdjustmentInput` with empty recipientIds → always returns `{ valid: true, isDeletion: true }`
    - Create file `packages/backend/src/admin/batch-points-adjust-deletion.property.test.ts`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 10.1, 10.6**

- [x] 2. Backend: Implement executeDeletion function
  - [x] 2.1 Implement `executeDeletion` in `packages/backend/src/admin/batch-points-adjust.ts`
    - Add `DeletionResult` interface: `{ success: boolean; deleted?: boolean; distributionId?: string; reversedCount?: number; error?: { code: string; message: string } }`
    - Implement `executeDeletion(input, original, client, tables)` function:
      - Fetch skill claims for the activity via `getSkillClaimsForActivity`
      - Compute total reversal per user: `originalPoints` from distribution + any skill-claim `pointsAwarded` for that user
      - Pre-check all users have sufficient balance (fetch via BatchGetCommand); reject with `INSUFFICIENT_BALANCE` if any user's balance < total reversal amount
      - Build transaction items: for each user, Update (reverse points/earnTotal/roleField) + Put correction record; for each skill claim, Delete claim + Update user (reverse skill points from earnTotalLeader) + Put correction record
      - Batch transaction items into groups of ≤25 items (12 users per batch at 2 items each; skill claims at 3 items each prepended to first batch or in separate batch if overflow)
      - Execute batches sequentially; on failure, stop and return `ADJUSTMENT_FAILED`
      - On all batches success, hard-delete the Distribution_Record via `DeleteCommand`
      - Return `{ success: true, deleted: true, distributionId, reversedCount }`
    - Correction record source format: `'发放删除:{targetRole}|{activityUG}|{activityTopic}|{activityDate}'`
    - Skill claim correction record source format: `'技能释放(删除):{skill}|{activityUG}|{activityTopic}|{activityDate}'`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [ ]* 2.2 Write property test: deletion reverses exactly originalPoints for every recipient
    - **Property 2: Deletion reverses exactly originalPoints for every original recipient**
    - Generate random distributions with 1–20 recipients, mock DynamoDB client, execute deletion → verify exactly N Update commands with delta = -originalPoints for each user
    - **Validates: Requirements 13.1, 13.2**

  - [ ]* 2.3 Write property test: skill claims are fully reversed and removed
    - **Property 3: Skill claims tied to the distribution are fully reversed and removed**
    - Generate distributions with 0–3 skill claims, execute deletion → verify skill claim Delete + user Update + correction Put for each claim
    - **Validates: Requirements 13.3**

  - [ ]* 2.4 Write property test: correction records preserve audit trail
    - **Property 4: Correction records preserve the audit trail without deleting existing records**
    - Generate deletions of varying sizes → verify correction record count = N users + M skill claims, no Delete on PointsRecords table
    - **Validates: Requirements 13.4, 13.5**

  - [ ]* 2.5 Write property test: transaction batches never exceed 25 items
    - **Property 5: Transaction batches never exceed 25 items**
    - Generate distributions with 1–50 recipients and 0–3 skill claims → verify all transaction batches ≤ 25 items
    - **Validates: Requirements 13.6**

  - [ ]* 2.6 Write property test: insufficient balance pre-check rejects before any write
    - **Property 6: Insufficient balance pre-check rejects before any write**
    - Generate distributions where at least one user has balance < originalPoints → verify INSUFFICIENT_BALANCE returned and zero TransactWriteCommands sent
    - **Validates: Requirements 13.9**

  - [ ]* 2.7 Write property test: successful deletion response shape
    - **Property 7: Successful deletion response includes distributionId and reversedCount**
    - Generate successful deletions → verify response contains `deleted: true`, correct `distributionId`, and `reversedCount === originalRecipientIds.length`
    - **Validates: Requirements 13.14**

- [x] 3. Backend: Modify executeAdjustment to route to executeDeletion
  - [x] 3.1 Update `executeAdjustment` in `packages/backend/src/admin/batch-points-adjust.ts`
    - After calling `validateAdjustmentInput`, check if result has `isDeletion: true`
    - If isDeletion, call `executeDeletion(input, original, client, tables)` and return its result
    - Otherwise, continue with existing diff-based adjustment flow
    - Update `AdjustmentResult` interface to include optional `deleted?: boolean`, `distributionId?: string`, `reversedCount?: number`
    - _Requirements: 10.1, 13.1_

- [x] 4. Checkpoint - Backend logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Backend: Update handler response for deletion case
  - [x] 5.1 Update `handleBatchPointsAdjust` in `packages/backend/src/admin/handler.ts`
    - Remove the validation that rejects when `recipientIds` is not an array or is empty — allow empty array `[]` to pass through
    - After `executeAdjustment` returns success, check if `result.deleted === true`
    - If deleted, return `{ message: '发放记录已删除', deleted: true, distributionId: result.distributionId, reversedCount: result.reversedCount }`
    - Otherwise, return existing `{ message: '调整成功' }` response
    - _Requirements: 13.14_

  - [ ]* 5.2 Write unit tests for handler deletion response
    - Test that handler returns deletion-specific response shape when `result.deleted === true`
    - Test that handler allows empty `recipientIds` array without returning 400
    - Add tests to `packages/backend/src/admin/handler.test.ts` or `batch-points-adjust.test.ts`
    - _Requirements: 13.14_

- [x] 6. Frontend: Add isDeletionMode logic and allow zero-recipient submission
  - [x] 6.1 Update `packages/frontend/src/pages/admin/batch-adjust.tsx`
    - Add `isDeletionMode` computed: `selectedIds.size === 0 && originalRecord !== null`
    - Update `canSubmit` logic: allow submission when `isDeletionMode` is true (currently requires `selectedIds.size > 0`)
    - Update `hasChanges` logic: return true when `isDeletionMode` (all original recipients removed)
    - In `handleSubmit`, when `isDeletionMode`, send `recipientIds: []` to the API
    - On success response with `deleted: true`, show deletion-specific toast message and navigate back to batch-history
    - _Requirements: 13.12, 13.13, 13.15_

- [x] 7. Frontend: Add distinct deletion confirmation dialog
  - [x] 7.1 Add deletion confirmation dialog in `packages/frontend/src/pages/admin/batch-adjust.tsx`
    - When `isDeletionMode` and user clicks submit, show a distinct confirmation dialog (separate from the normal adjustment confirm dialog)
    - Dialog message: identify the distribution being deleted, state that confirming will delete the entire distribution and reverse all awarded points
    - Use red/danger theme styling (class `ba-confirm--deletion`)
    - Confirm button text: deletion-specific label (e.g., "确认删除发放记录")
    - On confirm, call `handleSubmit` with empty recipientIds
    - On cancel, close dialog
    - _Requirements: 13.11, 13.12, 13.13_

- [x] 8. i18n: Add deletion-specific translation keys
  - [x] 8.1 Add translation keys to all 5 language files
    - Files: `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Keys to add under `batchPoints.adjust`:
      - `deletionConfirmTitle`: Title for deletion confirmation dialog
      - `deletionConfirmMessage`: Message explaining the deletion will reverse all points
      - `deletionConfirmButton`: Confirm button text for deletion
      - `deletionSuccessToast`: Success toast after deletion completes
    - _Requirements: 13.11, 13.15_

- [x] 9. SCSS: Add deletion dialog styling
  - [x] 9.1 Add deletion-mode styles to `packages/frontend/src/pages/admin/batch-adjust.scss`
    - Add `.ba-confirm--deletion` modifier class with danger/red theme
    - Use CSS variables: `--error` for accent color, `--bg-surface` for background
    - Style the confirm button with `--error` background (danger button appearance)
    - Add a warning icon or visual indicator that this is a destructive action
    - Ensure the dialog is visually distinct from the normal adjustment confirmation
    - _Requirements: 13.11_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing adjustment flow (Requirements 1–12) is already implemented and not modified by these tasks
- Transaction batching: 12 users per batch (2 items each = 24), skill claims 3 items each
- i18n covers 5 languages: zh, en, zh-TW, ja, ko

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["7.1", "8.1"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```
