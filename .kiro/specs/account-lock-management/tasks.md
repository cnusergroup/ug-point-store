# Implementation Plan: Account Lock Management

## Overview

Implement sliding-window login failure counting, dynamic lock messages, SuperAdmin manual unlock, and locked status visibility across the shared types, backend, and frontend layers. Tasks are ordered so each step builds on the previous: shared types first, then backend logic, then frontend enhancements, and finally integration wiring.

## Tasks

- [x] 1. Add 'locked' to shared UserStatus type
  - [x] 1.1 Update UserStatus union type in `packages/shared/src/types.ts`
    - Change `export type UserStatus = 'active' | 'disabled'` to `'active' | 'disabled' | 'locked'`
    - _Requirements: 7.1_

  - [ ]* 1.2 Write unit test for UserStatus type
    - Verify `'locked'` is a valid `UserStatus` value in `packages/shared/src/types.test.ts`
    - _Requirements: 7.1_

- [x] 2. Implement sliding-window login logic in backend
  - [x] 2.1 Refactor `loginUser()` in `packages/backend/src/auth/login.ts`
    - Add `SLIDING_WINDOW_MS = 15 * 60 * 1000` constant
    - Implement sliding window: check `firstFailAt`, reset if absent or stale (>15 min), increment if within window
    - On lock expiry (`lockUntil` in the past): reset `loginFailCount`, remove `lockUntil`, remove `firstFailAt`, set `status='active'` before credential validation
    - On password failure reaching threshold: set `lockUntil`, `status='locked'`, return `ACCOUNT_LOCKED` with `lockRemainingMs`
    - On password success: reset `loginFailCount=0`, remove `lockUntil`, remove `firstFailAt`, set `status='active'`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2_

  - [ ]* 2.2 Write property test: Sliding window reset on stale/missing firstFailAt
    - **Property 1: Sliding window reset on stale or missing firstFailAt**
    - Generate random user records with absent or stale `firstFailAt`, verify `loginFailCount` resets to 1 and `firstFailAt` is set to current time
    - Create test file `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 2.3 Write property test: In-window failure increments count
    - **Property 2: In-window failure increments count**
    - Generate random user records with recent `firstFailAt` and `loginFailCount` 1–3, verify count increments by 1 and `firstFailAt` unchanged
    - Add to `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 1.3**

  - [ ]* 2.4 Write property test: Lock triggers at threshold
    - **Property 3: Lock triggers at threshold**
    - Generate random user records with recent `firstFailAt` and `loginFailCount=4`, verify `status='locked'`, `lockUntil` set, `ACCOUNT_LOCKED` returned with positive `lockRemainingMs`
    - Add to `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 1.4**

  - [ ]* 2.5 Write property test: Successful login resets all lock state
    - **Property 4: Successful login resets all lock state**
    - Generate random user records with various lock states + correct password, verify full reset
    - Add to `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 1.5**

  - [ ]* 2.6 Write property test: Expired lock auto-resets before credential validation
    - **Property 5: Expired lock auto-resets before credential validation**
    - Generate random user records with past `lockUntil`, verify state reset before password check
    - Add to `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 2.1**

  - [ ]* 2.7 Write property test: Active lock rejects with correct remaining time
    - **Property 6: Active lock rejects with correct remaining time**
    - Generate random user records with future `lockUntil`, verify `ACCOUNT_LOCKED` with correct `lockRemainingMs`
    - Add to `packages/backend/src/auth/login-sliding-window.property.test.ts`
    - **Validates: Requirements 2.2**

  - [ ]* 2.8 Update existing login unit tests
    - Update `packages/backend/src/auth/login.test.ts` to cover sliding window scenarios
    - Test: stale firstFailAt resets count; in-window failures accumulate; lock triggers at 5; expired lock auto-resets; success clears all state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2_

- [x] 3. Implement SuperAdmin unlock API in backend
  - [x] 3.1 Add `unlockUser()` function in `packages/backend/src/admin/users.ts`
    - Implement `UnlockUserResult` interface and `unlockUser()` function
    - Fetch user, return `USER_NOT_FOUND` if missing
    - If status is not `locked`, return success (idempotent)
    - If locked: set `loginFailCount=0`, remove `lockUntil`, remove `firstFailAt`, set `status='active'`
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 3.2 Add unlock route in `packages/backend/src/admin/handler.ts`
    - Add `USERS_UNLOCK_REGEX = /^\/api\/admin\/users\/([^/]+)\/unlock$/`
    - Add `POST /api/admin/users/{id}/unlock` route in the POST section
    - Enforce SuperAdmin-only access check before calling `unlockUser()`
    - Import `unlockUser` from `./users`
    - _Requirements: 5.2_

  - [ ]* 3.3 Write property test: Unlock clears all lock state for locked users
    - **Property 9: Unlock clears all lock state for locked users**
    - Generate random locked user records, verify full state reset and `{ success: true }`
    - Create test file `packages/backend/src/admin/users-unlock.property.test.ts`
    - **Validates: Requirements 5.1**

  - [ ]* 3.4 Write property test: Unlock is idempotent for non-locked users
    - **Property 10: Unlock is idempotent for non-locked users**
    - Generate random non-locked user records (`active`/`disabled`), verify `{ success: true }` without modification
    - Add to `packages/backend/src/admin/users-unlock.property.test.ts`
    - **Validates: Requirements 5.3**

  - [ ]* 3.5 Update admin users unit tests
    - Update `packages/backend/src/admin/users.test.ts` to cover unlock scenarios
    - Test: unlock locked user succeeds; unlock non-locked user is idempotent; unlock non-existent user returns USER_NOT_FOUND
    - _Requirements: 5.1, 5.3, 5.4_

- [x] 4. Checkpoint — Backend verification
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 5. Enhance RequestError in frontend
  - [x] 5.1 Add `data` property to `RequestError` class in `packages/frontend/src/utils/request.ts`
    - Add optional `data?: Record<string, unknown>` property to `RequestError`
    - Update constructor to accept and assign `data` parameter
    - Update the `request()` function to extract extra fields from error responses and pass them as `data`
    - _Requirements: 4.1, 4.2_

  - [ ]* 5.2 Write property test: RequestError preserves extra response fields
    - **Property 8: RequestError preserves extra response fields**
    - Generate random error response objects with extra fields beyond `code` and `message`, verify all extra fields preserved in `data`
    - Create test file `packages/frontend/src/utils/request.property.test.ts`
    - **Validates: Requirements 4.1**

- [x] 6. Implement dynamic lock message on login page
  - [x] 6.1 Update login page error handling in `packages/frontend/src/pages/login/index.tsx`
    - When catching `ACCOUNT_LOCKED`, extract `lockRemainingMs` from `err.data`
    - If `lockRemainingMs` is available and positive, compute `minutes = Math.ceil(lockRemainingMs / 60000)` and display `t('login.errorAccountLockedWithTime', { minutes })`
    - Fall back to `t('login.errorAccountLocked')` if `lockRemainingMs` is not available
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 6.2 Write property test: Lock remaining minutes rounds up
    - **Property 7: Lock remaining minutes rounds up**
    - Generate random positive `lockRemainingMs` values (1–900000), verify displayed minutes equals `Math.ceil(lockRemainingMs / 60000)`
    - Create test file `packages/frontend/src/pages/login/lock-message.property.test.ts`
    - **Validates: Requirements 3.2**

- [x] 7. Implement locked badge and unlock button on admin users page
  - [x] 7.1 Update `UserListItem` interface and status rendering in `packages/frontend/src/pages/admin/users.tsx`
    - Add `'locked'` to the `status` union type in the `UserListItem` interface
    - Add locked status badge rendering with `user-status--locked` class and `t('admin.users.statusLocked')` label
    - _Requirements: 7.2, 7.3_

  - [x] 7.2 Add unlock button and handler in `packages/frontend/src/pages/admin/users.tsx`
    - Show unlock button only when `isSuperAdmin && user.status === 'locked'`
    - Implement `handleUnlock()` that calls `POST /api/admin/users/{userId}/unlock`
    - Show success toast `t('admin.users.unlockSuccess')` and refresh user list on success
    - Show error toast `t('admin.users.unlockFailed')` on failure
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.3 Add locked status styles in `packages/frontend/src/pages/admin/users.scss`
    - Add `user-status--locked` style with warning color (`var(--warning)`) and matching background
    - Add `user-row__action-btn--unlock` style for the unlock button
    - _Requirements: 7.3_

- [x] 8. Add i18n keys and translations
  - [x] 8.1 Update `TranslationDict` in `packages/frontend/src/i18n/types.ts`
    - Add `errorAccountLockedWithTime: string` to the `login` section
    - Add `statusLocked: string`, `unlockUser: string`, `unlockSuccess: string`, `unlockFailed: string` to the `admin.users` section
    - _Requirements: 8.1, 8.2_

  - [x] 8.2 Add Chinese (zh) translations in `packages/frontend/src/i18n/zh.ts`
    - `login.errorAccountLockedWithTime`: `'账号已锁定，请 {minutes} 分钟后重试'`
    - `admin.users.statusLocked`: `'已锁定'`
    - `admin.users.unlockUser`: `'解锁'`
    - `admin.users.unlockSuccess`: `'已解锁'`
    - `admin.users.unlockFailed`: `'解锁失败'`
    - _Requirements: 8.3_

  - [x] 8.3 Add English (en) translations in `packages/frontend/src/i18n/en.ts`
    - `login.errorAccountLockedWithTime`: `'Account locked, please try again in {minutes} minutes'`
    - `admin.users.statusLocked`: `'Locked'`
    - `admin.users.unlockUser`: `'Unlock'`
    - `admin.users.unlockSuccess`: `'Unlocked'`
    - `admin.users.unlockFailed`: `'Unlock failed'`
    - _Requirements: 8.3_

  - [x] 8.4 Add Japanese (ja) translations in `packages/frontend/src/i18n/ja.ts`
    - `login.errorAccountLockedWithTime`: `'アカウントがロックされました。{minutes}分後に再試行してください'`
    - `admin.users.statusLocked`: `'ロック中'`
    - `admin.users.unlockUser`: `'ロック解除'`
    - `admin.users.unlockSuccess`: `'ロック解除しました'`
    - `admin.users.unlockFailed`: `'ロック解除に失敗しました'`
    - _Requirements: 8.3_

  - [x] 8.5 Add Korean (ko) translations in `packages/frontend/src/i18n/ko.ts`
    - `login.errorAccountLockedWithTime`: `'계정이 잠겼습니다. {minutes}분 후에 다시 시도해주세요'`
    - `admin.users.statusLocked`: `'잠김'`
    - `admin.users.unlockUser`: `'잠금 해제'`
    - `admin.users.unlockSuccess`: `'잠금 해제됨'`
    - `admin.users.unlockFailed`: `'잠금 해제 실패'`
    - _Requirements: 8.3_

  - [x] 8.6 Add Traditional Chinese (zh-TW) translations in `packages/frontend/src/i18n/zh-TW.ts`
    - `login.errorAccountLockedWithTime`: `'帳號已鎖定，請 {minutes} 分鐘後重試'`
    - `admin.users.statusLocked`: `'已鎖定'`
    - `admin.users.unlockUser`: `'解鎖'`
    - `admin.users.unlockSuccess`: `'已解鎖'`
    - `admin.users.unlockFailed`: `'解鎖失敗'`
    - _Requirements: 8.3_

- [x] 9. Final checkpoint — Full verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–10)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout, matching the existing codebase
