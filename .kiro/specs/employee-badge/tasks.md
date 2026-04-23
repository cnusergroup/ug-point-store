# Implementation Plan: Employee Badge (员工身份标记)

## Overview

This plan implements the `isEmployee` boolean flag across the invite generation, registration, and report export flows. The flag is added as an optional field to `InviteRecord` and `UserRecord`, passed through from invite creation → registration → user record, and exposed only in report exports. The implementation follows a bottom-up approach: shared types first, then backend logic, then frontend UI, and finally report integration.

## Tasks

- [x] 1. Update shared types and add helper function
  - Add `isEmployee?: boolean` to the `InviteRecord` interface in `packages/shared/src/types.ts`
  - Add `getInviteIsEmployee(record: { isEmployee?: boolean }): boolean` helper function that returns `record.isEmployee ?? false`
  - _Requirements: 1.1, 8.3_

- [x] 2. Update invite creation and validation logic
  - [x] 2.1 Update `createInviteRecord` in `packages/backend/src/auth/invite.ts`
    - Add optional `isEmployee?: boolean` parameter
    - Write `isEmployee: isEmployee ?? false` into the `InviteRecord` when creating the DynamoDB item
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.2 Update `batchCreateInvites` in `packages/backend/src/auth/invite.ts`
    - Add optional `isEmployee?: boolean` parameter
    - Pass `isEmployee` through to `createInviteRecord`
    - Include `isEmployee` in each invite result object
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.3 Update `validateInviteToken` in `packages/backend/src/auth/invite.ts`
    - Extend success return type to include `isEmployee: boolean`
    - Read `isEmployee` from the invite record, defaulting to `false` if missing (backward compatibility)
    - _Requirements: 5.3, 5.4, 8.3_

  - [x] 2.4 Update `batchGenerateInvites` in `packages/backend/src/admin/invites.ts`
    - Add optional `isEmployee?: boolean` parameter, pass through to `batchCreateInvites`
    - Update `BatchGenerateInvitesResult` type to include `isEmployee` in each invite
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.5 Update `handleBatchGenerateInvites` in `packages/backend/src/admin/handler.ts`
    - Extract `isEmployee` from request body (optional boolean)
    - Pass `isEmployee` to `batchGenerateInvites`
    - _Requirements: 4.1, 1.4_

  - [x] 2.6 Write property test for invite creation isEmployee round-trip
    - **Property 1: 邀请创建 isEmployee 标记往返一致性**
    - **Validates: Requirements 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4**
    - Test file: `packages/backend/src/admin/employee-badge.property.test.ts`

- [x] 3. Update registration flow to propagate isEmployee
  - [x] 3.1 Update `registerUser` in `packages/backend/src/auth/register.ts`
    - After `validateInviteToken`, extract `isEmployee` from the result
    - When `isEmployee === true`, include `isEmployee: true` in the user record written to DynamoDB
    - When `isEmployee` is `false` or undefined, do not write the field (storage optimization, backward compatible)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.2 Write property test for registration isEmployee propagation
    - **Property 2: 注册流程传递 isEmployee 标记**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Test file: `packages/backend/src/auth/register-employee.property.test.ts`

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update report export to include isEmployee
  - [x] 5.1 Update `batchGetNicknamesForExport` in `packages/backend/src/reports/export.ts`
    - Add `isEmployee` to the `ProjectionExpression` when fetching user data
    - Return `isEmployee` alongside nickname in the result map
    - _Requirements: 7.1_

  - [x] 5.2 Update `batchGetUserDetails` in `packages/backend/src/reports/query.ts`
    - Add `isEmployee` to the `ProjectionExpression`
    - Extend the return type to include `isEmployee?: boolean`
    - _Requirements: 7.1_

  - [x] 5.3 Update column definitions in `packages/backend/src/reports/formatters.ts`
    - Add `{ key: 'isEmployee', label: '员工标记' }` to `USER_RANKING_COLUMNS`
    - Add `{ key: 'isEmployee', label: '员工标记' }` to `POINTS_DETAIL_COLUMNS`
    - Update `formatUserRankingForExport` to map `isEmployee` (`true` → `'是'`, `false`/undefined → `'否'`)
    - Update `formatPointsDetailForExport` to map `isEmployee` similarly
    - _Requirements: 7.1_

  - [x] 5.4 Update `executeExport` in `packages/backend/src/reports/export.ts`
    - For `user-points-ranking` report: fetch `isEmployee` from user details and include in export records
    - For `points-detail` report: fetch `isEmployee` from user details and include in export records
    - Support `filters.isEmployee` parameter (`'true'`/`'false'`): filter user records in memory before export
    - When filter is not specified, export all users with `isEmployee` field included
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.5 Write property test for report export isEmployee filtering
    - **Property 3: 报表导出 isEmployee 筛选正确性**
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - Test file: `packages/backend/src/reports/employee-filter.property.test.ts`

- [x] 6. Update frontend invite management page
  - [x] 6.1 Update invite form in `packages/frontend/src/pages/admin/invites.tsx`
    - Add `isEmployee` state (default `false`) to the generate form
    - Add a toggle/switch UI element below the role selection area, labeled "员工邀请"
    - When toggled on, include `isEmployee: true` in the POST request body
    - When toggled off, include `isEmployee: false` or omit the field
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 6.2 Update invite list display in `packages/frontend/src/pages/admin/invites.tsx`
    - Update `InviteRecord` and `NewInvite` interfaces to include `isEmployee?: boolean`
    - When `isEmployee === true`, render a "员工" badge after the role badges and before the status label
    - Style the badge with `--info` color scheme (blue tone) to distinguish from role badges
    - When `isEmployee` is `false` or undefined, do not render the badge
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.3 Add SCSS styles for employee badge in `packages/frontend/src/pages/admin/invites.scss`
    - Add `.employee-badge` class using `var(--info)` color variables
    - Ensure visual distinction from existing `.role-badge` styles
    - _Requirements: 3.3_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Backward compatibility and helper function tests
  - [x] 8.1 Write property test for getInviteIsEmployee helper
    - **Property 4: 向后兼容默认值**
    - **Validates: Requirements 8.1, 8.2, 8.3**
    - Test file: `packages/backend/src/admin/employee-badge.property.test.ts`

  - [x] 8.2 Write property test for record serialization round-trip
    - **Property 5: 记录序列化往返一致性**
    - **Validates: Requirements 8.4**
    - Test file: `packages/backend/src/admin/employee-badge.property.test.ts`

- [x] 9. Verify UI non-exposure of isEmployee
  - Verify that `isEmployee` is NOT displayed in user list pages, user profile pages, role badge components, or leaderboard
  - This is a code review task: confirm no other frontend files reference or render `isEmployee` on user-facing pages
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `isEmployee` field is only written as `true` to DynamoDB; `false` is represented by field absence (storage optimization)
- All existing invite and user records without `isEmployee` are treated as `false` (backward compatible)
