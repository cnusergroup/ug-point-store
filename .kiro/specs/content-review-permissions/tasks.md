# Implementation Plan: Content Review Permissions (内容审批权限精细化控制)

## Overview

This plan implements fine-grained content review permission control. When the existing `adminContentReviewEnabled` toggle is ON, SuperAdmin can choose between "All Admins" or "Specific Admins" for content review permissions. The implementation follows a bottom-up approach: data model extension first, then backend permission logic, API updates, frontend UI (radio + searchable admin checklist), and finally i18n keys for all 5 locales.

## Tasks

- [x] 1. Extend FeatureToggles data model with contentReviewMode and contentReviewerIds
  - [x] 1.1 Update FeatureToggles interface and defaults
    - Add `contentReviewMode: 'all' | 'specific'` to `FeatureToggles` interface in `packages/backend/src/settings/feature-toggles.ts`
    - Add `contentReviewerIds: string[]` to `FeatureToggles` interface
    - Add `contentReviewMode: 'all'` and `contentReviewerIds: []` to `DEFAULT_TOGGLES`
    - In `getFeatureToggles`, add safe-default reading logic:
      - `contentReviewMode`: if value is `'all'` or `'specific'` use it, otherwise default to `'all'`
      - `contentReviewerIds`: if value is an array of strings use it, otherwise default to `[]`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [x] 1.2 Update UpdateFeatureTogglesInput and updateFeatureToggles
    - Add `contentReviewMode: 'all' | 'specific'` and `contentReviewerIds: string[]` to `UpdateFeatureTogglesInput` interface
    - Add validation in `updateFeatureToggles`: reject if `contentReviewMode` is not `'all'` or `'specific'`, reject if `contentReviewerIds` is not a string array
    - Add `contentReviewMode = :crm` and `contentReviewerIds = :cri` to the UpdateExpression
    - Add `':crm': input.contentReviewMode` and `':cri': input.contentReviewerIds` to ExpressionAttributeValues
    - Include both fields in the returned settings object
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.3 Write unit tests for contentReviewMode and contentReviewerIds in feature toggles
    - Test safe defaults when fields are missing from DynamoDB (backward compatibility)
    - Test invalid `contentReviewMode` values degrade to `'all'`
    - Test invalid `contentReviewerIds` values degrade to `[]`
    - Test update validation rejects invalid contentReviewMode and contentReviewerIds
    - Test that `contentReviewMode: 'specific'` with empty `contentReviewerIds` is accepted
    - Test file: `packages/backend/src/settings/feature-toggles.test.ts` (add new describe block)
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 4.3, 4.4, 4.5_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update checkReviewPermission for fine-grained permission control
  - [x] 3.1 Extend checkReviewPermission function signature and logic
    - Update `checkReviewPermission` in `packages/backend/src/content/content-permission.ts`
    - Extend signature to accept `userId: string`, `contentReviewMode: 'all' | 'specific'`, and `contentReviewerIds: string[]` parameters
    - Keep Layer 1: SuperAdmin → `true`
    - Keep Layer 2: `adminContentReviewEnabled === false` → `false`
    - Update Layer 3: when `adminContentReviewEnabled === true`:
      - If `contentReviewMode === 'all'` and user has `Admin` role → `true`
      - If `contentReviewMode === 'specific'` and user has `Admin` role and `userId` is in `contentReviewerIds` → `true`
      - Otherwise → `false`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 3.2 Write unit tests for updated checkReviewPermission
    - Test SuperAdmin always returns true regardless of mode/reviewerIds
    - Test `adminContentReviewEnabled: false` always returns false
    - Test `mode: 'all'` allows any Admin
    - Test `mode: 'specific'` allows only Admin whose userId is in reviewerIds
    - Test `mode: 'specific'` denies Admin whose userId is NOT in reviewerIds
    - Test file: `packages/backend/src/content/content-permission.test.ts` (add new describe block or update existing)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Update Admin Handler to pass new parameters to checkReviewPermission
  - [x] 4.1 Update handleReviewContent in admin handler
    - In `packages/backend/src/admin/handler.ts`, update the `handleReviewContent` function
    - Pass `event.user.userId`, `toggles.contentReviewMode`, and `toggles.contentReviewerIds` to `checkReviewPermission`
    - Keep the existing 403 `PERMISSION_DENIED` error response when permission is denied
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 4.2 Update handleUpdateFeatureToggles to include new fields
    - In `handleUpdateFeatureToggles`, add `contentReviewMode` and `contentReviewerIds` to the input object passed to `updateFeatureToggles`
    - `contentReviewMode`: use `body.contentReviewMode` with validation (default to `'all'`)
    - `contentReviewerIds`: use `body.contentReviewerIds` with validation (default to `[]`)
    - _Requirements: 4.1, 4.2, 4.6_

  - [ ]* 4.3 Write unit tests for admin handler review permission changes
    - Test Admin with `mode: 'specific'` and userId in reviewerIds → allowed
    - Test Admin with `mode: 'specific'` and userId NOT in reviewerIds → 403
    - Test Admin with `mode: 'all'` → allowed (when adminContentReviewEnabled is true)
    - Test SuperAdmin always allowed regardless of mode
    - Update existing handler tests in `packages/backend/src/admin/handler.test.ts`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update frontend FeatureToggles interface and Settings page UI
  - [x] 6.1 Update frontend FeatureToggles interface
    - Add `contentReviewMode: 'all' | 'specific'` and `contentReviewerIds: string[]` to the frontend `FeatureToggles` interface in `packages/frontend/src/pages/admin/settings.tsx`
    - _Requirements: 1.1, 1.2_

  - [x] 6.2 Add review mode Radio selection UI
    - Below the `adminContentReviewEnabled` toggle item, add a conditionally rendered expand area (only visible when `adminContentReviewEnabled` is ON)
    - Add two Radio options: "所有 Admin" (`'all'`) and "指定 Admin" (`'specific'`), default selected "所有 Admin"
    - Use i18n keys `admin.settings.contentReviewModeLabel`, `admin.settings.contentReviewModeAll`, `admin.settings.contentReviewModeSpecific`
    - When Radio changes, update `contentReviewMode` in settings state and trigger save
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.3 Add searchable Admin checklist component
    - When `contentReviewMode` is `'specific'`, render a searchable Admin checklist below the Radio
    - Fetch Admin user list via `GET /api/admin/users?role=Admin`
    - Each row: checkbox, nickname, email, role badge (using global `.role-badge` class)
    - Add search input at top for filtering by nickname or email
    - Show "已选 N 人" count at bottom
    - Pre-select checkboxes based on current `contentReviewerIds`
    - On checkbox change, update `contentReviewerIds` in settings state
    - When switching from "指定 Admin" back to "所有 Admin", hide checklist but preserve `contentReviewerIds` data
    - Use i18n keys: `admin.settings.contentReviewSearchPlaceholder`, `admin.settings.contentReviewSelectedCount`
    - Use CSS variables for all colors, spacing, and border-radius per frontend design rules
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add i18n keys for all 5 locales
  - [x] 8.1 Add i18n keys to all locale files
    - Add the following keys to all 5 locale files (`packages/frontend/src/i18n/{zh,en,ja,ko,zh-TW}.ts`):
      - `admin.settings.contentReviewModeLabel` — 审批模式标签
      - `admin.settings.contentReviewModeAll` — "所有 Admin" 选项文案
      - `admin.settings.contentReviewModeSpecific` — "指定 Admin" 选项文案
      - `admin.settings.contentReviewSearchPlaceholder` — 搜索框占位符
      - `admin.settings.contentReviewSelectedCount` — "已选 N 人" 计数文案
    - Follow existing `admin.settings.*` naming convention
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The `contentReviewMode` field defaults to `'all'` when missing from DynamoDB (backward compatible)
- The `contentReviewerIds` field defaults to `[]` when missing from DynamoDB (backward compatible)
- SuperAdmin always has review permission regardless of mode settings
- When `adminContentReviewEnabled` is OFF, the new fields are ignored (existing behavior preserved)
- The Admin checklist preserves `contentReviewerIds` data when switching back to "All Admins" mode
