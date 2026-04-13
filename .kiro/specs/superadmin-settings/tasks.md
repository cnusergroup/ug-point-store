# Implementation Plan: SuperAdmin Settings

## Overview

Add two SuperAdmin-exclusive sections to the **existing** settings page (`/pages/admin/settings`):
1. **Invite Link Expiry** — global config stored in DynamoDB (`invite-settings` key), SuperAdmin sets 1/3/7 days, all Admin invite generation uses this value automatically.
2. **SuperAdmin Transfer** — password-confirmed atomic role swap via `TransactWriteItems`.

No new pages or menu items. Implementation order: shared types → backend invite settings → backend transfer → handler routes → frontend settings page sections → i18n.

## Tasks

- [x] 1. Add new error codes to shared package
  - In `packages/shared/src/errors.ts` (or wherever error codes are defined), add:
    - `TRANSFER_TARGET_NOT_ADMIN` (400)
    - `TRANSFER_TARGET_NOT_FOUND` (404)
    - `TRANSFER_TARGET_IS_SELF` (400)
    - `INVALID_EXPIRY_VALUE` (400)
    - `INVALID_CURRENT_PASSWORD` (400) — if not already present
  - Add corresponding entries in `ErrorHttpStatus` and `ErrorMessages` maps
  - _Requirements: 2.5, 3.5, 5.5_

- [x] 2. Backend invite settings module
  - [x] 2.1 Create `packages/backend/src/settings/invite-settings.ts`
    - Define `InviteSettings` interface: `{ inviteExpiryDays: 1 | 3 | 7 }`
    - `INVITE_SETTINGS_KEY = 'invite-settings'`, `ALLOWED_EXPIRY_DAYS = [1, 3, 7]`, `DEFAULT_EXPIRY_DAYS = 1`
    - Implement `getInviteSettings(dynamoClient, usersTable)`: GetCommand on `{userId: 'invite-settings'}`, return default `{inviteExpiryDays: 1}` if not found
    - Implement `updateInviteSettings(inviteExpiryDays, updatedBy, dynamoClient, usersTable)`: validate against allowlist, PutCommand with `{userId: 'invite-settings', inviteExpiryDays, updatedAt, updatedBy}`
    - _Requirements: 5.2, 5.3, 5.5, 6.1, 6.2_

  - [x] 2.2 Write unit tests in `packages/backend/src/settings/invite-settings.test.ts`
    - Test `getInviteSettings` returns default 1 when record absent
    - Test `getInviteSettings` returns stored value when record exists
    - Test `updateInviteSettings` succeeds for each of {1, 3, 7}
    - Test `updateInviteSettings` rejects values not in {1, 3, 7}
    - _Requirements: 5.5, 6.1, 6.2_

- [x] 3. Modify invite creation to use global expiry setting
  - [x] 3.1 Modify `packages/backend/src/auth/invite.ts`
    - Add optional `expiryMs?: number` parameter to `createInviteRecord` (default `86400000`)
    - Add optional `expiryMs?: number` parameter to `batchCreateInvites`, pass through to `createInviteRecord`
    - Replace hardcoded `86400 * 1000` with `expiryMs ?? 86400000`
    - _Requirements: 6.1, 6.2_

  - [x] 3.2 Modify `packages/backend/src/admin/invites.ts`
    - Add optional `expiryMs?: number` parameter to `batchGenerateInvites`, pass through to `batchCreateInvites`
    - _Requirements: 6.1_

- [x] 4. Backend SuperAdmin transfer module
  - [x] 4.1 Create `packages/backend/src/admin/superadmin-transfer.ts`
    - Implement `transferSuperAdmin(input, dynamoClient, usersTable)`:
      1. Fetch caller record → verify SuperAdmin role → `bcryptjs.compare(password, passwordHash)`
      2. Verify `targetUserId !== callerId`
      3. Fetch target record → verify Admin role
      4. `TransactWriteItems`: demote caller (remove SuperAdmin, ensure Admin, update rolesVersion + updatedAt), promote target (add SuperAdmin, update rolesVersion + updatedAt)
      5. ConditionExpression on caller: `contains(#roles, :superAdmin)`, on target: `contains(#roles, :admin)`
      6. Catch `TransactionCanceledException` → return retry error
    - _Requirements: 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.2 Write unit tests in `packages/backend/src/admin/superadmin-transfer.test.ts`
    - Test successful transfer with correct password and valid Admin target
    - Test rejection when caller is not SuperAdmin
    - Test rejection when target is self
    - Test rejection when target does not exist
    - Test rejection when target is not Admin
    - Test rejection when password is incorrect
    - _Requirements: 2.4, 2.5, 3.1, 3.5, 3.6_

- [x] 5. Backend handler routing
  - [x] 5.1 Modify `packages/backend/src/admin/handler.ts`
    - Import `transferSuperAdmin` from `./superadmin-transfer`
    - Import `getInviteSettings`, `updateInviteSettings` from `../settings/invite-settings`
    - Add `POST /api/admin/superadmin/transfer` route (SuperAdmin-only guard)
    - Add `PUT /api/admin/settings/invite-settings` route (SuperAdmin-only guard): validate `inviteExpiryDays` in {1,3,7}, call `updateInviteSettings`
    - Modify `handleBatchGenerateInvites`: call `getInviteSettings` before `batchGenerateInvites`, pass `expiryMs = inviteExpiryDays * 86400000`
    - _Requirements: 2.4, 5.5, 6.1_

  - [x] 5.2 Modify public settings handler to expose invite settings
    - Find the public settings handler (handles `/api/settings/feature-toggles`, `/api/settings/travel-sponsorship`)
    - Add `GET /api/settings/invite-settings` route: call `getInviteSettings`, return result (no auth required, same pattern as feature-toggles)
    - _Requirements: 5.2_

- [x] 6. Checkpoint — Backend verification
  - Run `npx vitest run packages/backend/src/settings/invite-settings.test.ts`
  - Run `npx vitest run packages/backend/src/admin/superadmin-transfer.test.ts`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend settings page — Invite Expiry section
  - [x] 7.1 Modify `packages/frontend/src/pages/admin/settings.tsx`
    - Add `inviteSettings` state: `{ inviteExpiryDays: 1 | 3 | 7 }`, default `{ inviteExpiryDays: 1 }`
    - Fetch `/api/settings/invite-settings` on mount (alongside existing settings fetches), only if `isSuperAdmin`
    - Add Invite Expiry section (SuperAdmin-only): section title, three option buttons (1天/3天/7天), highlight active option
    - On option click: PUT `/api/admin/settings/invite-settings {inviteExpiryDays}`, update local state, show success/error toast
    - Use CSS variables per design system (no hardcoded colors)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Frontend settings page — SuperAdmin Transfer section
  - [x] 8.1 Modify `packages/frontend/src/pages/admin/settings.tsx`
    - Add transfer state: `adminUsers`, `selectedTarget`, `transferPassword`, `transferring`, `transferError`
    - Fetch Admin users from `/api/admin/users?role=Admin` on mount, only if `isSuperAdmin`
    - Add SuperAdmin Transfer section (SuperAdmin-only): section title, Admin user selector list, password input, confirm button
    - Handle empty Admin users list (show message, disable button)
    - On submit: POST `/api/admin/superadmin/transfer {targetUserId, password}`
    - On success: update local user store roles (remove SuperAdmin, keep Admin), show success message, redirect to admin dashboard after 2s delay
    - On error: show error message from API response
    - Use CSS variables per design system
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_

- [x] 9. Checkpoint — Frontend verification
  - Ensure the settings page renders correctly for SuperAdmin and non-SuperAdmin users
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. i18n translations
  - [x] 10.1 Update `packages/frontend/src/i18n/types.ts`
    - Add to `admin.settings`: `inviteExpiryTitle`, `inviteExpiryDesc`, `inviteExpiryDays1`, `inviteExpiryDays3`, `inviteExpiryDays7`
    - Add to `admin.settings`: `transferTitle`, `transferDesc`, `selectTargetLabel`, `noEligibleTargets`, `passwordLabel`, `passwordPlaceholder`, `confirmTransfer`, `transferring`, `transferSuccess`, `errorPasswordRequired`, `errorSelectTarget`, `errorPasswordIncorrect`, `errorTargetNotAdmin`, `errorTargetNotFound`
    - _Requirements: 7.1, 7.2_

  - [x] 10.2 Add translations in `packages/frontend/src/i18n/zh.ts`
    - 邀请有效期: 邀请有效期设置 / 设置新生成邀请链接的默认有效期 / 1天 / 3天 / 7天
    - 转让: 转让 SuperAdmin / 将 SuperAdmin 权限转让给其他管理员 / 选择目标管理员 / 暂无可选管理员 / 当前密码 / 请输入当前密码 / 确认转让 / 转让中... / 转让成功 / 请输入密码 / 请选择目标管理员 / 密码错误 / 目标用户不是管理员 / 目标用户不存在
    - _Requirements: 7.1, 7.2_

  - [x] 10.3 Add translations in `packages/frontend/src/i18n/zh-TW.ts`
    - Traditional Chinese translations for all new keys
    - _Requirements: 7.1, 7.2_

  - [x] 10.4 Add translations in `packages/frontend/src/i18n/en.ts`
    - English translations for all new keys
    - _Requirements: 7.1, 7.2_

  - [x] 10.5 Add translations in `packages/frontend/src/i18n/ja.ts`
    - Japanese translations for all new keys
    - _Requirements: 7.1, 7.2_

  - [x] 10.6 Add translations in `packages/frontend/src/i18n/ko.ts`
    - Korean translations for all new keys
    - _Requirements: 7.1, 7.2_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run `npx vitest run packages/backend/src/settings`
  - Run `npx vitest run packages/backend/src/admin/superadmin-transfer`
  - Ensure all tests pass, ask the user if questions arise.
