# Implementation Plan: Content Role Settings

## Overview

Extend the existing feature-toggles infrastructure to support two new SuperAdmin-only configurations: an `adminContentReviewEnabled` toggle and a `contentRolePermissions` 3×4 matrix. Backend content APIs enforce these permissions; the frontend settings page exposes the controls and the content hub/detail pages enforce visibility.

## Tasks

- [x] 1. Extend backend types and interfaces
  - Add `RolePermissions`, `ContentRolePermissions` interfaces to `packages/backend/src/settings/feature-toggles.ts`
  - Extend `FeatureToggles` interface with `adminContentReviewEnabled: boolean`, `adminCategoriesEnabled: boolean`, and `contentRolePermissions: ContentRolePermissions`
  - Add `UpdateContentRolePermissionsInput` and `UpdateContentRolePermissionsResult` interfaces
  - Add `DEFAULT_ROLE_PERMISSIONS` and `DEFAULT_CONTENT_ROLE_PERMISSIONS` constants
  - _Requirements: 1.1, 2.1, 15.1_

- [x] 2. Extend `feature-toggles.ts` — getFeatureToggles defaults and updateContentRolePermissions
  - [x] 2.1 Update `getFeatureToggles` to return new fields with safe defaults
    - `adminContentReviewEnabled`: default `false` (use `=== true` pattern)
    - `adminCategoriesEnabled`: default `false` (use `=== true` pattern)
    - `contentRolePermissions`: merge stored value with `DEFAULT_CONTENT_ROLE_PERMISSIONS` so any missing role or permission key falls back to `true`
    - _Requirements: 1.2, 1.3, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 15.2, 15.3_

  - [x] 2.2 Update `updateFeatureToggles` to accept and persist `adminContentReviewEnabled` and `adminCategoriesEnabled`
    - Add both fields to `UpdateFeatureTogglesInput`
    - Add boolean validation for both new fields
    - Include them in the `PutCommand` item and the returned `settings` object
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 15.4_

  - [x] 2.3 Implement `updateContentRolePermissions` function
    - Use `UpdateCommand` (not `PutCommand`) to update only the `contentRolePermissions` attribute, preserving all other feature-toggle fields
    - Validate all 12 permission fields are booleans before writing
    - Return the updated `contentRolePermissions` on success
    - _Requirements: 2.5, 5.5, 5.6_

  - [x] 2.4 Write property tests for feature-toggles new fields
    - **Property 1: getFeatureToggles 始终返回完整的新字段** — for any DynamoDB record state (missing, partial, complete), returned object always has boolean `adminContentReviewEnabled` and complete `contentRolePermissions` with all 12 boolean fields
    - **Property 2: adminContentReviewEnabled 写入读取往返** — write any boolean `v`, read back, get `v`
    - **Property 3: contentRolePermissions 写入读取往返** — write any valid 12-boolean matrix, read back identical value
    - **Property 4: contentRolePermissions 更新幂等性** — two identical writes produce same read result
    - Add to `packages/backend/src/settings/feature-toggles.property.test.ts` (create if not exists)
    - **Validates: Requirements 1.1–1.4, 2.1–2.5, 3.1–3.3**

- [x] 3. Implement `content-permission.ts` pure-function helper
  - Create `packages/backend/src/content/content-permission.ts`
  - Implement `checkContentPermission(userRoles, permission, featureToggles)` with three-layer logic:
    1. `SuperAdmin` in roles → `true`
    2. No Content_Role (Speaker/UserGroupLeader/Volunteer) in roles → `false`
    3. Otherwise → OR of all matching Content_Role permission values
  - Implement `computeEffectivePermissions(userRoles, featureToggles)` returning all four permission booleans by calling `checkContentPermission` four times
  - Implement `checkReviewPermission(userRoles, adminContentReviewEnabled)`:
    1. `SuperAdmin` → `true`
    2. `adminContentReviewEnabled && Admin in roles` → `true`
    3. Otherwise → `false`
  - _Requirements: 6.1–6.6, 7.1–7.6, 8.1–8.7, 9.1–9.7, 10.1–10.4_

  - [x] 3.1 Write property tests for content-permission.ts
    - Create `packages/backend/src/content/content-permission.property.test.ts`
    - **Property 5: checkContentPermission 三层逻辑正确性** — for any roles array, any permission key, any featureToggles: SuperAdmin → true; no Content_Role → false; else OR of matching role permissions
    - **Property 6: checkReviewPermission 审批权限逻辑正确性** — for any roles array and any boolean: SuperAdmin → true; adminEnabled && Admin → true; else false
    - **Property 9: computeEffectivePermissions 与 checkContentPermission 一致性** — for any roles and toggles, the four fields from `computeEffectivePermissions` equal four separate `checkContentPermission` calls
    - **Validates: Requirements 6.1–6.6, 7.1–7.6, 8.1–8.7, 9.1–9.7, 10.1–10.4**

- [x] 4. Extend admin handler — new route and feature-toggles update
  - [x] 4.1 Add `PUT /api/admin/settings/content-role-permissions` route to `packages/backend/src/admin/handler.ts`
    - Import `updateContentRolePermissions` from `feature-toggles.ts`
    - Add route match in the `PUT` block (before the catch-all)
    - Implement `handleUpdateContentRolePermissions`: SuperAdmin check (403 FORBIDDEN if not), validate all 12 fields are booleans (400 INVALID_REQUEST if not), call `updateContentRolePermissions`, return updated matrix
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.2 Extend `handleUpdateFeatureToggles` to accept `adminContentReviewEnabled` and `adminCategoriesEnabled`
    - Parse both fields from request body
    - Pass them through to `updateFeatureToggles` input
    - _Requirements: 4.1, 4.2, 4.3, 15.4_

  - [x] 4.3 Add category management permission guard to `handleCreateCategory`, `handleUpdateCategory`, `handleDeleteCategory`
    - In each handler, call `getFeatureToggles` and check `adminCategoriesEnabled`
    - If `adminCategoriesEnabled` is false and caller is not SuperAdmin, return 403 FORBIDDEN with message "需要超级管理员权限才能管理分类"
    - SuperAdmin always passes through
    - _Requirements: 15.5, 15.6, 15.7, 15.8_

  - [x] 4.4 Write unit tests for admin handler new routes
    - Add to `packages/backend/src/admin/handler.test.ts`
    - Test: non-SuperAdmin calling `PUT /api/admin/settings/content-role-permissions` → 403
    - Test: invalid (non-boolean) field in permissions matrix → 400
    - Test: valid SuperAdmin request → 200 with updated matrix
    - Test: `PUT /api/admin/settings/feature-toggles` with `adminContentReviewEnabled` and `adminCategoriesEnabled` fields → persisted correctly
    - Test: non-SuperAdmin calling category create/update/delete with `adminCategoriesEnabled: false` → 403
    - Test: non-SuperAdmin calling category routes with `adminCategoriesEnabled: true` → allowed
    - Test: SuperAdmin calling category routes with `adminCategoriesEnabled: false` → always allowed
    - _Requirements: 4.1–4.3, 5.1–5.5, 15.5–15.8_

- [x] 5. Enforce permissions in content handler
  - [x] 5.1 Add permission enforcement to read routes (`GET /api/content`, `GET /api/content/:id`)
    - Import `getFeatureToggles` from `feature-toggles.ts` and `checkContentPermission` from `content-permission.ts`
    - At the top of `handleListContentItems` and `handleGetContentDetail`, call `getFeatureToggles` then `checkContentPermission(roles, 'canAccess', toggles)`
    - Return `{ code: 'PERMISSION_DENIED', message: '您没有访问内容中心的权限' }` with 403 if denied
    - _Requirements: 6.1–6.6_

  - [x] 5.2 Add permission enforcement to upload routes (`POST /api/content/upload-url`, `POST /api/content`)
    - In `handleGetUploadUrl` and `handleCreateContentItem`, call `checkContentPermission(roles, 'canUpload', toggles)`
    - Return `{ code: 'PERMISSION_DENIED', message: '您没有上传内容的权限' }` with 403 if denied
    - _Requirements: 7.1–7.6_

  - [x] 5.3 Add permission enforcement to download route (`GET /api/content/:id/download`)
    - In `handleGetDownloadUrl`, call `checkContentPermission(roles, 'canDownload', toggles)`
    - Return `{ code: 'PERMISSION_DENIED', message: '您没有下载内容的权限' }` with 403 if denied
    - _Requirements: 8.1–8.7_

  - [x] 5.4 Add permission enforcement to reserve route (`POST /api/content/:id/reserve`)
    - In `handleCreateReservation`, call `checkContentPermission(roles, 'canReserve', toggles)`
    - Return `{ code: 'PERMISSION_DENIED', message: '您没有预约内容的权限' }` with 403 if denied
    - _Requirements: 9.1–9.7_

  - [x] 5.5 Add review permission enforcement to admin content review route (`PATCH /api/admin/content/:id/review`)
    - In `handleReviewContent` (in `packages/backend/src/admin/handler.ts`), call `getFeatureToggles` then `checkReviewPermission(roles, toggles.adminContentReviewEnabled)`
    - Return `{ code: 'PERMISSION_DENIED', message: '需要超级管理员权限才能审批内容' }` with 403 if denied
    - _Requirements: 10.1–10.4_

- [x] 6. Backend tests
  - [x] 6.1 Write unit tests for content handler permission enforcement
    - Add to `packages/backend/src/content/handler.test.ts`
    - Test: Pure_Admin (only Admin role) calling each protected route → 403 PERMISSION_DENIED
    - Test: SuperAdmin calling each protected route → passes permission check
    - Test: Speaker with `canAccess: false` calling list/detail → 403
    - Test: Speaker with `canUpload: false` calling upload routes → 403
    - Test: Speaker with `canDownload: false` calling download → 403
    - Test: Speaker with `canReserve: false` calling reserve → 403
    - _Requirements: 6.1–6.6, 7.1–7.6, 8.1–8.7, 9.1–9.7_

  - [x] 6.2 Write unit tests for admin content review permission enforcement
    - Add to `packages/backend/src/content/admin.test.ts` or `packages/backend/src/admin/handler.test.ts`
    - Test: Admin with `adminContentReviewEnabled: false` → 403 PERMISSION_DENIED
    - Test: Admin with `adminContentReviewEnabled: true` → allowed
    - Test: SuperAdmin with `adminContentReviewEnabled: false` → still allowed
    - _Requirements: 10.1–10.4_

- [x] 7. Frontend i18n types and translations
  - [x] 7.1 Extend `TranslationDict` in `packages/frontend/src/i18n/types.ts`
    - Add to `admin.settings`: `adminContentReviewLabel`, `adminContentReviewDesc`, `adminCategoriesLabel`, `adminCategoriesDesc`, `contentRolePermissionsTitle`, `contentRolePermissionsDesc`, `permissionCanAccess`, `permissionCanUpload`, `permissionCanDownload`, `permissionCanReserve`, `roleSpeaker`, `roleUserGroupLeader`, `roleVolunteer`
    - Add to `contentHub`: `noAccessTitle`, `noAccessDesc`, `noAccessBack`
    - _Requirements: 14.1, 15.9_

  - [x] 7.2 Add translations to all five locale files
    - Update `packages/frontend/src/i18n/zh.ts`, `en.ts`, `ja.ts`, `ko.ts`, `zh-TW.ts` with all new keys
    - zh: "Admin 内容审批"、"允许 Admin 审批内容"、"Admin 分类管理"、"允许 Admin 管理内容分类（创建/编辑/删除）"、"内容角色权限"、"访问权限"、"上传权限"、"下载权限"、"预约权限" etc.
    - en, ja, ko, zh-TW: equivalent translations for each key
    - _Requirements: 14.2, 14.3_

- [x] 8. Frontend settings page — two new SuperAdmin sections
  - [x] 8.1 Extend `FeatureToggles` interface in `packages/frontend/src/pages/admin/settings.tsx`
    - Add `RolePermissions`, `ContentRolePermissions` local interfaces
    - Extend `FeatureToggles` with `adminContentReviewEnabled`, `adminCategoriesEnabled`, and `contentRolePermissions`
    - Add `contentRolePermissions` state with default all-true values
    - _Requirements: 11.3, 12.3, 15.9_

  - [x] 8.2 Add "内容审批权限" section (SuperAdmin only)
    - Inside `{isSuperAdmin && (...)}`, add a new `settings-section` block with title from `t('admin.settings.adminContentReviewLabel')`
    - Add a `toggle-item` for `adminContentReviewEnabled` using the existing `handleToggle` pattern (extend the PUT payload to include `adminContentReviewEnabled` and `adminCategoriesEnabled`)
    - Add a second `toggle-item` for `adminCategoriesEnabled` with label `t('admin.settings.adminCategoriesLabel')` and description `t('admin.settings.adminCategoriesDesc')`
    - On toggle of either switch, call `PUT /api/admin/settings/feature-toggles` with the full updated payload including both new fields
    - Revert on failure with toast
    - _Requirements: 11.1–11.6, 15.9, 15.10_

  - [x] 8.3 Add "内容角色权限" matrix section (SuperAdmin only)
    - Below the review section, add a `settings-section` block with title from `t('admin.settings.contentRolePermissionsTitle')`
    - Render a 3×4 matrix: rows = Speaker, UserGroupLeader, Volunteer; columns = canAccess, canUpload, canDownload, canReserve
    - Each cell is a `Switch` component; column headers use `permissionCan*` keys; row labels use `role*` keys
    - On any toggle, call `PUT /api/admin/settings/content-role-permissions` with the complete updated matrix
    - Revert the specific cell on failure with toast
    - Add `.permissions-matrix` CSS class to `packages/frontend/src/pages/admin/settings.scss` using existing CSS variable tokens
    - _Requirements: 12.1–12.6_

- [x] 9. Frontend content hub enforcement (canAccess, canUpload)
  - [x] 9.1 Fetch and compute effective permissions in `packages/frontend/src/pages/content/index.tsx`
    - On page load, call `GET /api/settings/feature-toggles` to get `contentRolePermissions`
    - Compute `canAccess` and `canUpload` using the same three-layer logic as the backend (SuperAdmin → always true; Pure_Admin → false; else OR of Content_Role permissions)
    - On fetch failure, degrade conservatively: hide restricted buttons but do not show the no-access page
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 9.2 Enforce `canAccess` — show no-permission page when denied
    - If `canAccess` is `false`, render a no-permission view with `t('contentHub.noAccessTitle')`, `t('contentHub.noAccessDesc')`, and a back button using `t('contentHub.noAccessBack')`
    - Do not render the content list
    - _Requirements: 13.3, 13.5_

  - [x] 9.3 Enforce `canUpload` — conditionally show upload button
    - Conditionally render the upload button only when `canUpload` is `true`
    - _Requirements: 13.6_

- [x] 10. Frontend content detail enforcement (canDownload, canReserve)
  - [x] 10.1 Fetch and compute effective permissions in `packages/frontend/src/pages/content/detail.tsx`
    - On page load, call `GET /api/settings/feature-toggles` (or reuse data passed from the list page if available via navigation params)
    - Compute `canDownload` and `canReserve` using the same three-layer logic
    - On fetch failure, degrade conservatively: hide both buttons
    - _Requirements: 13.7, 13.8, 13.9_

  - [x] 10.2 Enforce `canDownload` — conditionally show download button
    - Conditionally render the download button only when `canDownload` is `true`
    - `canDownload` and `canReserve` are evaluated independently
    - _Requirements: 13.7, 13.9_

  - [x] 10.3 Enforce `canReserve` — conditionally show reserve button
    - Conditionally render the reserve button only when `canReserve` is `true`
    - _Requirements: 13.8, 13.9_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run `vitest --run` from the workspace root and confirm all tests pass
  - Verify the settings page renders both new SuperAdmin sections without errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `updateContentRolePermissions` MUST use `UpdateCommand` (not `PutCommand`) to avoid overwriting other feature-toggle fields
- The three-layer permission logic (SuperAdmin → always allow; Pure_Admin → always deny; Content_Role → OR union) is identical on backend and frontend
- Frontend permission fetch failures degrade conservatively (hide buttons, do NOT show no-access page) to avoid blocking users due to transient network errors
- Property tests use `fast-check` consistent with the existing test suite pattern
