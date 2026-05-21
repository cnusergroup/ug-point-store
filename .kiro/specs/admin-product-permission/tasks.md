# Implementation Plan: Admin Product Permission (商品管理权限精细化控制)

## Overview

This plan implements fine-grained product management permission control. When the existing `adminProductsEnabled` toggle is ON, SuperAdmin can choose between "All Admins" or "Specific Admins" for product management permissions. The implementation follows the same pattern as `contentReviewMode` / `contentReviewerIds`: data model extension first, then backend permission logic, API updates, frontend UI (radio + searchable admin checklist), and finally i18n keys for all 5 locales.

## Tasks

- [x] 1. Extend FeatureToggles data model with productManagementMode and productManagerIds
  - [x] 1.1 Update FeatureToggles interface and defaults
    - Add `productManagementMode: 'all' | 'specific'` to `FeatureToggles` interface in `packages/backend/src/settings/feature-toggles.ts`
    - Add `productManagerIds: string[]` to `FeatureToggles` interface
    - Add `productManagementMode: 'all'` and `productManagerIds: []` to `DEFAULT_TOGGLES`
    - In `getFeatureToggles`, add safe-default reading logic:
      - `productManagementMode`: if value is `'all'` or `'specific'` use it, otherwise default to `'all'`
      - `productManagerIds`: if value is an array of strings use it, otherwise default to `[]`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [x] 1.2 Update UpdateFeatureTogglesInput and updateFeatureToggles
    - Add `productManagementMode: 'all' | 'specific'` and `productManagerIds: string[]` to `UpdateFeatureTogglesInput` interface
    - Add validation in `updateFeatureToggles`: reject if `productManagementMode` is not `'all'` or `'specific'`, reject if `productManagerIds` is not a string array
    - Add `productManagementMode = :pmm` and `productManagerIds = :pmi` to the UpdateExpression
    - Add `':pmm': input.productManagementMode` and `':pmi': input.productManagerIds` to ExpressionAttributeValues
    - Include both fields in the returned settings object
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.3 Write property tests for productManagementMode and productManagerIds validation
    - **Property 4: Invalid productManagementMode safe degradation**
    - **Property 5: Invalid productManagerIds safe degradation**
    - **Validates: Requirements 2.3, 2.4, 4.3, 4.4**
    - Test file: `packages/backend/src/settings/feature-toggles.test.ts`

  - [ ]* 1.4 Write property test for Feature Toggles round-trip consistency
    - **Property 6: Feature Toggles read/write round-trip consistency**
    - **Validates: Requirements 2.5**
    - Test file: `packages/backend/src/settings/feature-toggles.test.ts`

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement checkProductPermission function
  - [x] 3.1 Create product-permission.ts with checkProductPermission
    - Create new file `packages/backend/src/admin/product-permission.ts`
    - Implement `checkProductPermission(userRoles, adminProductsEnabled, userId?, productManagementMode?, productManagerIds?): boolean`
    - Layer 1: if `userRoles` includes `SuperAdmin` → return `true`
    - Layer 2: if `adminProductsEnabled === false` → return `false`
    - Layer 3: if `productManagementMode === 'all'` (or undefined) and user has `Admin` role → return `true`
    - Layer 3: if `productManagementMode === 'specific'` and user has `Admin` role and `userId` is in `productManagerIds` → return `true`
    - Otherwise → return `false`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.2 Write property test for SuperAdmin always has permission
    - **Property 1: SuperAdmin always has product management permission**
    - **Validates: Requirements 3.1**
    - Test file: `packages/backend/src/admin/product-permission.property.test.ts`

  - [ ]* 3.3 Write property test for toggle-off ignores mode and manager list
    - **Property 2: Toggle off ignores mode and manager list**
    - **Validates: Requirements 1.4, 3.2**
    - Test file: `packages/backend/src/admin/product-permission.property.test.ts`

  - [ ]* 3.4 Write property test for product management mode permission correctness
    - **Property 3: Product management mode permission check correctness**
    - **Validates: Requirements 3.3, 3.4, 3.5**
    - Test file: `packages/backend/src/admin/product-permission.property.test.ts`

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update Admin Handler to use checkProductPermission
  - [x] 5.1 Replace product route permission checks in admin handler
    - In `packages/backend/src/admin/handler.ts`, import `checkProductPermission` from `./product-permission`
    - Replace all existing product permission checks (6 routes) from:
      ```typescript
      if (!toggles.adminProductsEnabled) return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      ```
      to:
      ```typescript
      if (!checkProductPermission(event.user.roles, toggles.adminProductsEnabled, event.user.userId, toggles.productManagementMode, toggles.productManagerIds)) {
        return errorResponse('FORBIDDEN', '管理员暂无商品管理权限', 403);
      }
      ```
    - Affected routes: `PUT /api/admin/products/{id}`, `PATCH /api/admin/products/{id}/status`, `POST /api/admin/products`, `POST /api/admin/products/{id}/upload-url`, `POST /api/admin/images/upload-url`, `DELETE /api/admin/products/{id}/images/{key}`
    - _Requirements: 3.6, 7.1, 7.2, 7.3_

  - [x] 5.2 Update handleUpdateFeatureToggles to include new fields
    - In `handleUpdateFeatureToggles`, extract `productManagementMode` and `productManagerIds` from request body
    - Pass them to `updateFeatureToggles` input object
    - _Requirements: 4.1, 4.2, 4.6_

  - [ ]* 5.3 Write unit tests for admin handler product permission changes
    - Test Admin with `mode: 'specific'` and userId in productManagerIds → allowed
    - Test Admin with `mode: 'specific'` and userId NOT in productManagerIds → 403
    - Test Admin with `mode: 'all'` → allowed (when adminProductsEnabled is true)
    - Test SuperAdmin always allowed regardless of mode
    - Update existing handler tests in `packages/backend/src/admin/handler.test.ts`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update frontend Settings page UI
  - [x] 7.1 Update frontend FeatureToggles interface
    - Add `productManagementMode: 'all' | 'specific'` and `productManagerIds: string[]` to the frontend `FeatureToggles` interface in `packages/frontend/src/pages/admin/settings.tsx`
    - _Requirements: 1.1, 1.2_

  - [x] 7.2 Add product management mode Radio selection UI
    - Below the `adminProductsEnabled` toggle item, add a conditionally rendered expand area (only visible when `adminProductsEnabled` is ON)
    - Add two Radio options: "所有 Admin" (`'all'`) and "指定 Admin" (`'specific'`), default selected "所有 Admin"
    - Use i18n keys `admin.settings.productManagementModeLabel`, `admin.settings.productManagementModeAll`, `admin.settings.productManagementModeSpecific`
    - When Radio changes, update `productManagementMode` in settings state and trigger save
    - Reuse existing `.review-mode-expand` / `.review-mode-option` CSS classes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.3 Add searchable Admin checklist for product managers
    - When `productManagementMode` is `'specific'`, render a searchable Admin checklist below the Radio
    - Reuse existing `adminUsers` state (fetched via `GET /api/admin/users?role=Admin`)
    - Each row: checkbox, nickname, email, role badge (using global `.role-badge` class)
    - Add search input at top for filtering by nickname or email
    - Show "已选 N 人" count at bottom using i18n key `admin.settings.productManagerSelectedCount`
    - Pre-select checkboxes based on current `productManagerIds`
    - On checkbox change, update `productManagerIds` in settings state
    - When switching from "指定 Admin" back to "所有 Admin", hide checklist but preserve `productManagerIds` data
    - Reuse existing `.reviewer-checklist` CSS class
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add i18n keys for all 5 locales
  - [x] 9.1 Add i18n keys to all locale files
    - Add the following keys to all 5 locale files (`packages/frontend/src/i18n/{zh,en,ja,ko,zh-TW}.ts`):
      - `admin.settings.productManagementModeLabel` — 管理模式 / Management Mode
      - `admin.settings.productManagementModeAll` — 所有 Admin / All Admins
      - `admin.settings.productManagementModeSpecific` — 指定 Admin / Specific Admins
      - `admin.settings.productManagerSearchPlaceholder` — 搜索昵称或邮箱 / Search by nickname or email
      - `admin.settings.productManagerSelectedCount` — 已选 {count} 人 / {count} selected
    - Follow existing `admin.settings.*` naming convention
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The `productManagementMode` field defaults to `'all'` when missing from DynamoDB (backward compatible)
- The `productManagerIds` field defaults to `[]` when missing from DynamoDB (backward compatible)
- SuperAdmin always has product management permission regardless of mode settings
- When `adminProductsEnabled` is OFF, the new fields are ignored (existing behavior preserved)
- The Admin checklist preserves `productManagerIds` data when switching back to "All Admins" mode
- Implementation follows the exact same pattern as `contentReviewMode` / `contentReviewerIds`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["5.1", "5.2"] },
    { "id": 4, "tasks": ["5.3", "7.1"] },
    { "id": 5, "tasks": ["7.2", "9.1"] },
    { "id": 6, "tasks": ["7.3"] }
  ]
}
```
