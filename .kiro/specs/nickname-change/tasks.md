# Implementation Plan: Nickname Change（昵称修改）

## Overview

在设置页新增「修改昵称」能力，复用现有修改密码的 UI 模式与后端更新模式。实现顺序：共享错误码 → 后端验证函数 → 后端核心逻辑 → 路由挂载 → 前端 store → 前端 UI → i18n。

技术栈：TypeScript（后端 Lambda + DynamoDB，前端 Taro + React）

## Tasks

- [x] 1. Shared: Add nickname error codes
  - [x] 1.1 Add nickname-related error codes to `packages/shared/src/errors.ts`
    - Add error codes: `NICKNAME_EMPTY`, `NICKNAME_TOO_LONG`, `NICKNAME_INVALID_CHARS`, `NICKNAME_SAME_AS_CURRENT`, `NICKNAME_ALREADY_TAKEN`, `NICKNAME_CHANGE_TOO_FREQUENT`
    - Add corresponding error messages (Chinese): 昵称不能为空、昵称不能超过20个字符、昵称包含非法字符、新昵称与当前昵称相同、该昵称已被使用、改名过于频繁请稍后再试
    - Add HTTP status mappings: NICKNAME_EMPTY→400, NICKNAME_TOO_LONG→400, NICKNAME_INVALID_CHARS→400, NICKNAME_SAME_AS_CURRENT→400, NICKNAME_ALREADY_TAKEN→409, NICKNAME_CHANGE_TOO_FREQUENT→429
    - _Requirements: 1.6, 1.7, 2.3, 2.4, 2.6, 3.2, 4.3_

- [x] 2. Backend: Implement nickname validation function
  - [x] 2.1 Create `packages/backend/src/user/nickname-validators.ts`
    - Export `NicknameValidationResult` interface: `{ valid: boolean; trimmed: string; error?: { code: string; message: string } }`
    - Implement `validateNickname(nickname: string): NicknameValidationResult`
    - Validation pipeline (fixed order): (1) trim → empty check → NICKNAME_EMPTY; (2) `[...trimmed].length > 20` → NICKNAME_TOO_LONG; (3) `/[\x00-\x1F\x7F\u0080-\u009F]/.test(trimmed)` → NICKNAME_INVALID_CHARS
    - Return first failing validation; if all pass return `{ valid: true, trimmed }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x]* 2.2 Write property test for nickname format validation
    - **Property 1: Nickname format validation**
    - Create file `packages/backend/src/user/nickname-validators.property.test.ts`
    - Generate random Unicode strings (varying lengths 0–50, with/without control chars, with whitespace padding)
    - Verify `validateNickname` accepts iff trimmed value has 1–20 codepoints and no control chars
    - Verify error priority order: NICKNAME_EMPTY > NICKNAME_TOO_LONG > NICKNAME_INVALID_CHARS
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

  - [x]* 2.3 Write unit tests for nickname validation edge cases
    - Create file `packages/backend/src/user/nickname-validators.test.ts`
    - Test: empty string → NICKNAME_EMPTY; whitespace-only → NICKNAME_EMPTY; exactly 20 chars → valid; 21 chars → NICKNAME_TOO_LONG; emoji (valid) → accept; control char `\n` → NICKNAME_INVALID_CHARS; mixed fail (empty + control) → NICKNAME_EMPTY (first rule wins)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 3. Backend: Implement changeNickname core function
  - [x] 3.1 Create `packages/backend/src/user/change-nickname.ts`
    - Export `NicknameHistoryEntry` interface: `{ previousNickname: string; changedAt: string }`
    - Export `ChangeNicknameResult` interface: `{ success: boolean; error?: { code: string; message: string } }`
    - Implement `changeNickname(userId, newNickname, dynamoClient, tableName, nicknameIndexName): Promise<ChangeNicknameResult>`
    - Implementation steps:
      1. Call `validateNickname(newNickname)` → return error if invalid
      2. GetCommand to fetch user record (nickname, nicknameHistory, nicknameChangedAt)
      3. If user not found → return USER_NOT_FOUND
      4. If trimmed === currentNickname → return NICKNAME_SAME_AS_CURRENT
      5. Rate limit: if nicknameChangedAt exists and (now - nicknameChangedAt) < 86400000ms → return NICKNAME_CHANGE_TOO_FREQUENT with remaining time
      6. GSI Query on nickname-index for newNickname → if result has userId ≠ self → return NICKNAME_ALREADY_TAKEN
      7. UpdateCommand: SET nickname, nicknameChangedAt, updatedAt, list_append nicknameHistory
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 3.1, 3.2, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.2, 8.4_

  - [ ]* 3.2 Write property test for same-nickname rejection
    - **Property 2: Same-nickname rejection**
    - Create file `packages/backend/src/user/change-nickname.property.test.ts`
    - Generate random valid nicknames, mock user record with that nickname as current
    - Verify changeNickname rejects with NICKNAME_SAME_AS_CURRENT and no DynamoDB Update call
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 1.6**

  - [ ]* 3.3 Write property test for uniqueness enforcement
    - **Property 3: Uniqueness enforcement**
    - Add to `packages/backend/src/user/change-nickname.property.test.ts`
    - Generate random sets of existing users with random nicknames, attempt rename to various targets
    - Verify uniqueness check correctly accepts/rejects based on GSI query results and ignores historical nicknames
    - **Validates: Requirements 3.1, 3.2, 3.4**

  - [ ]* 3.4 Write property test for rate limit cooldown
    - **Property 4: Rate limit cooldown**
    - Add to `packages/backend/src/user/change-nickname.property.test.ts`
    - Generate random `nicknameChangedAt` timestamps and current times
    - Verify rate limit rejects when elapsed < 24h, accepts when elapsed >= 24h, and undefined nicknameChangedAt always passes
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [ ]* 3.5 Write property test for successful change correctness
    - **Property 5: Successful change correctness**
    - Add to `packages/backend/src/user/change-nickname.property.test.ts`
    - Generate random valid nicknames, mock all validations to pass
    - Verify UpdateCommand sets nickname=trimmedNew, appends history entry with previousNickname, sets nicknameChangedAt, and preserves other fields
    - **Validates: Requirements 1.3, 5.1, 5.2, 5.3, 6.2, 8.4**

  - [ ]* 3.6 Write unit tests for changeNickname
    - Create file `packages/backend/src/user/change-nickname.test.ts`
    - Test: valid change → success; missing field → NICKNAME_EMPTY; same as current → NICKNAME_SAME_AS_CURRENT (no updatedAt change); already taken → NICKNAME_ALREADY_TAKEN; within 24h → NICKNAME_CHANGE_TOO_FREQUENT with remaining time; first-time change (no nicknameChangedAt) → no rate limit; nicknameHistory initialized from undefined → array created; uniqueness check excludes self; emoji nickname → success
    - _Requirements: 1.2, 1.3, 1.6, 3.1, 3.2, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_

- [x] 4. Backend: Add route to auth handler
  - [x] 4.1 Add `POST /api/user/change-nickname` route in `packages/backend/src/auth/handler.ts`
    - Import `changeNickname` from `../user/change-nickname`
    - Add route matching for `POST /api/user/change-nickname`
    - Add `handleChangeNickname` function following `handleChangePassword` pattern:
      1. Extract and verify JWT from Authorization header
      2. Extract userId from token payload
      3. Parse body for `newNickname` field; if missing return NICKNAME_EMPTY error
      4. Call `changeNickname(userId, newNickname, dynamoClient, USERS_TABLE, NICKNAME_INDEX_NAME)`
      5. On success return `{ message: '昵称修改成功' }`
      6. On error return appropriate HTTP status + error code
    - Add `NICKNAME_INDEX_NAME` env var (default `'nickname-index'`)
    - _Requirements: 1.2, 1.3, 1.7, 8.1, 8.2_

  - [ ]* 4.2 Write property test for self-only authorization
    - **Property 6: Self-only authorization**
    - Create file `packages/backend/src/user/change-nickname-auth.property.test.ts`
    - Generate random userId pairs, verify that the handler always uses the JWT userId regardless of request body content
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2**

  - [ ]* 4.3 Write unit tests for handler route
    - Add tests to `packages/backend/src/auth/handler.test.ts`
    - Test: valid request → 200 with success message; missing auth → 401; missing newNickname → 400; service error codes correctly mapped to HTTP status
    - _Requirements: 1.3, 1.7, 8.1, 8.2_

- [x] 5. Checkpoint - Backend logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend: Add changeNickname action to store
  - [x] 6.1 Add `changeNickname` action in `packages/frontend/src/store/index.ts`
    - Add `changeNickname(newNickname: string)` action following existing `changePassword` pattern
    - POST to `/api/user/change-nickname` with `{ newNickname }`
    - On success call `fetchProfile()` to refresh local user data
    - Return result with success/error for UI consumption
    - _Requirements: 1.4, 7.1_

- [x] 7. Frontend: Add nickname change form to Settings page
  - [x] 7.1 Update `packages/frontend/src/pages/settings/index.tsx`
    - Add state: `showNicknameForm`, `newNickname`, `nicknameError`, `nicknameLoading`, `nicknameSuccess`
    - Add "修改昵称" item with expand/collapse chevron (positioned above "修改密码" entry)
    - Add expandable form: single Input for new nickname + submit button (following change-password UI pattern)
    - On submit: call store `changeNickname`, handle error codes by mapping to i18n keys
    - On success: show success message, collapse form after 1.5s
    - Display current nickname in the form header/label area
    - _Requirements: 1.1, 1.4, 1.5, 4.3_

  - [ ]* 7.2 Write unit tests for Settings page nickname form
    - Test: form renders with current nickname displayed; submit triggers API call; loading state disables button; success message shown; error messages correctly displayed by error code; form collapses after success
    - _Requirements: 1.1, 1.4_

- [x] 8. Frontend: Add i18n keys for nickname change
  - [x] 8.1 Add nickname-related translation keys to all 5 locale files
    - Files: `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Keys to add under `settings` namespace:
      - `changeNickname`: 修改昵称 / Change Nickname / ...
      - `newNicknamePlaceholder`: 请输入新昵称 / Enter new nickname / ...
      - `nicknameChangeSuccess`: 昵称修改成功 / Nickname changed successfully / ...
      - `nicknameEmpty`: 昵称不能为空 / Nickname cannot be empty / ...
      - `nicknameTooLong`: 昵称不能超过20个字符 / Nickname cannot exceed 20 characters / ...
      - `nicknameInvalidChars`: 昵称包含非法字符 / Nickname contains invalid characters / ...
      - `nicknameSameAsCurrent`: 新昵称与当前昵称相同 / New nickname is same as current / ...
      - `nicknameAlreadyTaken`: 该昵称已被使用 / This nickname is already taken / ...
      - `nicknameTooFrequent`: 改名过于频繁，请稍后再试 / Nickname change too frequent, please try later / ...
    - _Requirements: 1.1, 2.3, 2.4, 2.6, 3.2, 4.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The route is mounted in the auth handler (alongside change-password) since it shares JWT verification logic
- DynamoDB GSI `nickname-index` must exist on the Users table; if not present, it needs to be created via CDK/CloudFormation (out of scope for this task list—handled by infrastructure)
- i18n covers 5 languages: zh, en, zh-TW, ja, ko

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "6.1"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2"] }
  ]
}
```
