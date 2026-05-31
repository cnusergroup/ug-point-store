# Implementation Plan: Inactive UGL Report (不活跃UGL报表)

## Overview

为 SuperAdmin 实现按季度查看不活跃 UGL 的报表功能。实现路径：季度工具函数 → 核心纯函数（eligible 过滤、inactive 集合差、lastActiveDate） → DynamoDB 查询模块 → handler 路由注册 → export 格式化扩展 → 前端 Tab 组件 → i18n 翻译。复用现有 `type-createdAt-index` GSI 查询模式和 export 流程，新增 `inactive-ugl` reportType。

## Tasks

- [x] 1. Implement quarter utility functions
  - [x] 1.1 Create `packages/backend/src/reports/quarter-utils.ts`
    - Export `QuarterValidationResult` type (valid/invalid union)
    - Export `QuarterDateRange` interface with `start` and `end` ISO strings
    - Implement `parseQuarter(quarter: string): QuarterValidationResult` — validate `YYYY-QN` format, check not future quarter
    - Implement `getCurrentQuarter(): string` — return current quarter as `"YYYY-QN"`
    - Implement `quarterToDateRange(year, quarter): QuarterDateRange` — convert to UTC start/end timestamps
    - Implement `getAvailableQuarters(): string[]` — generate list from 2024-Q1 to current quarter, descending
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 1.2 Write property test for quarter format validation
    - **Property 1: Quarter Format Validation**
    - Test file: `packages/backend/src/reports/quarter-utils.property.test.ts`
    - Use `fast-check` to generate random strings and valid/invalid YYYY-QN formats
    - Verify: `parseQuarter` returns `valid: true` iff string matches `^\d{4}-Q[1-4]$` AND quarter start ≤ now
    - Verify: invalid format returns `INVALID_QUARTER_FORMAT` error code
    - Verify: future quarter returns `FUTURE_QUARTER` error code
    - Minimum 100 iterations
    - **Validates: Requirements 2.1, 2.3, 2.4**

- [x] 2. Implement core pure functions for inactive UGL computation
  - [x] 2.1 Add pure functions in `packages/backend/src/reports/inactive-ugl-query.ts`
    - Export `EligibleUser` interface with `userId`, `nickname`, `email`, `roles`, `status`, `createdAt`
    - Export `InactiveUGLRecord` interface with `userId`, `nickname`, `email`, `ugName`, `createdAt`, `lastActiveDate`
    - Implement `filterEligibleUGLs(users, quarterStart)` — filter users with UGL role, active status, createdAt < quarterStart
    - Implement `extractActiveUserIds(records)` — extract unique userId set from records with targetRole UGL or SpecialActivity
    - Implement `computeInactiveUGLs(eligibleUsers, activeUserIds)` — set difference: eligible minus active
    - Implement `findLastActiveDate(userId, records)` — find max createdAt for matching userId with qualifying targetRole
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.2, 5.3_

  - [ ]* 2.2 Write property test for eligible UGL identification
    - **Property 2: Eligible UGL Identification**
    - Test file: `packages/backend/src/reports/inactive-ugl.property.test.ts`
    - Use `fast-check` to generate random user lists with mixed roles, statuses, and createdAt values
    - Verify: `filterEligibleUGLs` returns exactly users where roles contains 'UserGroupLeader' AND status === 'active' AND createdAt < quarterStart
    - Minimum 100 iterations
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 2.3 Write property test for inactive UGL set-difference
    - **Property 3: Inactive UGL Set-Difference Computation**
    - Test file: `packages/backend/src/reports/inactive-ugl.property.test.ts` (append)
    - Use `fast-check` to generate random eligible user sets and random PointsRecords
    - Verify: `computeInactiveUGLs` + `extractActiveUserIds` produces exactly eligible users whose userId is NOT in any qualifying record
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 2.4 Write property test for last active date computation
    - **Property 4: Last Active Date Computation**
    - Test file: `packages/backend/src/reports/inactive-ugl.property.test.ts` (append)
    - Use `fast-check` to generate random userId and random records list
    - Verify: `findLastActiveDate` returns max createdAt among matching records, or null if none
    - Minimum 100 iterations
    - **Validates: Requirements 5.2, 5.3**

- [x] 3. Implement DynamoDB query module for inactive UGL report
  - [x] 3.1 Add `queryInactiveUGLs` function in `packages/backend/src/reports/inactive-ugl-query.ts`
    - Export `InactiveUGLFilter` interface with optional `quarter` field
    - Export `InactiveUGLResult` interface with `success`, `records`, `quarter`, `totalCount`, `error`
    - Implement `queryInactiveUGLs(filter, dynamoClient, tables)`:
      - Parse and validate quarter (default to current quarter via `getCurrentQuarter`)
      - Query Users table via `entityType-createdAt-index` (PK=`user`) + FilterExpression for UGL role and active status
      - Filter eligible users by createdAt < quarterStart
      - Query PointsRecords via `type-createdAt-index` (type=`earn`, createdAt BETWEEN quarterStart AND quarterEnd) + FilterExpression for targetRole
      - Compute inactive set using pure functions
      - Scan UGs table to build `leaderId → ugName` mapping
      - For each inactive UGL, query last active date (reverse query on `type-createdAt-index` with userId filter, Limit=1)
      - Assemble and return `InactiveUGLResult`
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 11.1, 11.2, 11.3, 11.4_

- [x] 4. Register API route in admin handler
  - [x] 4.1 Add `GET /api/admin/reports/inactive-ugl` route in `packages/backend/src/admin/handler.ts`
    - Import `queryInactiveUGLs` from `../reports/inactive-ugl-query`
    - Add route matching: `method === 'GET' && path === '/api/admin/reports/inactive-ugl'`
    - Check `isSuperAdmin(event.user.roles)` — return 403 FORBIDDEN if not SuperAdmin
    - Extract `quarter` from query string parameters
    - Call `queryInactiveUGLs({ quarter }, dynamoClient, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE, ugsTable: UGS_TABLE })`
    - Return JSON response with `success`, `quarter`, `totalCount`, `records` or error
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 11.1, 11.2, 11.3_

- [x] 5. Checkpoint - Ensure backend compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend export module for inactive-ugl report type
  - [x] 6.1 Add `inactive-ugl` to `ReportType` and column definitions in `packages/backend/src/reports/formatters.ts`
    - Add `'inactive-ugl'` to `ReportType` union type
    - Add `INACTIVE_UGL_COLUMNS` array: nickname(用户昵称), email(邮箱), ugName(负责UG), createdAt(注册时间), lastActiveDate(最后活跃时间)
    - Add case `'inactive-ugl'` to `getColumnDefs` switch
    - Implement `formatInactiveUGLForExport(records)` — format createdAt/lastActiveDate with `formatDateTime`, use '-' for null lastActiveDate
    - _Requirements: 8.3, 10.3_

  - [x] 6.2 Add `inactive-ugl` export handling in `packages/backend/src/reports/export.ts`
    - Add `'inactive-ugl'` to `VALID_REPORT_TYPES` array
    - Import `queryInactiveUGLs` and `formatInactiveUGLForExport`
    - Add `else if (reportType === 'inactive-ugl')` branch in `executeExport`:
      - Extract `quarter` from `filters.quarter`
      - Call `queryInactiveUGLs({ quarter }, dynamoClient, tables)`
      - Format records with `formatInactiveUGLForExport`
      - Generate CSV/Excel buffer
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

  - [ ]* 6.3 Write property test for export formatter completeness
    - **Property 5: Export Formatter Completeness**
    - Test file: `packages/backend/src/reports/inactive-ugl.property.test.ts` (append)
    - Use `fast-check` to generate random `InactiveUGLRecord` arrays
    - Verify: each formatted row contains all 5 fields (nickname, email, ugName, createdAt, lastActiveDate)
    - Verify: lastActiveDate is formatted date when non-null, '-' when null
    - Minimum 100 iterations
    - **Validates: Requirements 8.3, 5.1**

- [x] 7. Implement frontend Inactive UGL Tab
  - [x] 7.1 Add `inactive-ugl` tab type and filter state in `packages/frontend/src/pages/admin/reports.tsx`
    - Add `'inactive-ugl'` to `ReportTab` union type
    - Add `'inactive-ugl': { quarter: string }` to `TabFilterState` interface
    - Add tab config entry: `{ key: 'inactive-ugl', labelKey: 'admin.reports.tabInactiveUGL' }`
    - Conditionally render tab only when user has SuperAdmin role (use `useSuperAdminGuard` or role check)
    - _Requirements: 1.2, 9.1, 9.2_

  - [x] 7.2 Implement quarter selector and data table for inactive UGL tab in `packages/frontend/src/pages/admin/reports.tsx`
    - Add quarter selector Picker defaulting to current quarter (compute from `new Date()`)
    - Generate available quarters list (2024-Q1 to current, descending)
    - On quarter change, fetch `GET /api/admin/reports/inactive-ugl?quarter=YYYY-QN`
    - Display total count above table: `t('admin.reports.inactiveUGL.totalCount', { count })`
    - Render data table with columns: nickname, email, ugName, createdAt, lastActiveDate
    - Show empty state message when records array is empty
    - Display '-' or `t('admin.reports.inactiveUGL.noLastActive')` for null lastActiveDate
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3_

  - [x] 7.3 Add export buttons for inactive UGL tab in `packages/frontend/src/pages/admin/reports.tsx`
    - Add CSV and Excel export buttons following existing report tab patterns
    - On click, POST to export API with `reportType: 'inactive-ugl'`, `format`, and `filters: { quarter }`
    - Handle presigned URL response and trigger download
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 7.4 Add SCSS styles for inactive UGL tab in `packages/frontend/src/pages/admin/reports.scss`
    - Follow existing tab content layout patterns (filter panel, data table, export buttons)
    - Use CSS variables for colors, spacing, and border-radius per frontend design steering
    - _Requirements: 9.3_

- [x] 8. Add i18n translations for all 5 locale files
  - [x] 8.1 Add translation keys to `packages/frontend/src/i18n/zh.ts`
    - `admin.reports.tabInactiveUGL`: `'不活跃UGL'`
    - `admin.reports.inactiveUGL.quarterLabel`: `'季度'`
    - `admin.reports.inactiveUGL.totalCount`: `'共 {count} 位不活跃UGL'`
    - `admin.reports.inactiveUGL.emptyState`: `'该季度所有UGL均有活跃记录'`
    - `admin.reports.inactiveUGL.colNickname`: `'用户昵称'`
    - `admin.reports.inactiveUGL.colEmail`: `'邮箱'`
    - `admin.reports.inactiveUGL.colUGName`: `'负责UG'`
    - `admin.reports.inactiveUGL.colCreatedAt`: `'注册时间'`
    - `admin.reports.inactiveUGL.colLastActive`: `'最后活跃'`
    - `admin.reports.inactiveUGL.noLastActive`: `'从未活跃'`
    - _Requirements: 10.1, 10.2_

  - [x] 8.2 Add translation keys to `packages/frontend/src/i18n/en.ts`
    - `admin.reports.tabInactiveUGL`: `'Inactive UGLs'`
    - `admin.reports.inactiveUGL.quarterLabel`: `'Quarter'`
    - `admin.reports.inactiveUGL.totalCount`: `'{count} inactive UGLs'`
    - `admin.reports.inactiveUGL.emptyState`: `'All UGLs were active this quarter'`
    - `admin.reports.inactiveUGL.colNickname`: `'Nickname'`
    - `admin.reports.inactiveUGL.colEmail`: `'Email'`
    - `admin.reports.inactiveUGL.colUGName`: `'UG Name'`
    - `admin.reports.inactiveUGL.colCreatedAt`: `'Registered'`
    - `admin.reports.inactiveUGL.colLastActive`: `'Last Active'`
    - `admin.reports.inactiveUGL.noLastActive`: `'Never active'`
    - _Requirements: 10.1, 10.2_

  - [x] 8.3 Add translation keys to `packages/frontend/src/i18n/zh-TW.ts`
    - `admin.reports.tabInactiveUGL`: `'不活躍UGL'`
    - `admin.reports.inactiveUGL.quarterLabel`: `'季度'`
    - `admin.reports.inactiveUGL.totalCount`: `'共 {count} 位不活躍UGL'`
    - `admin.reports.inactiveUGL.emptyState`: `'該季度所有UGL均有活躍記錄'`
    - `admin.reports.inactiveUGL.colNickname`: `'用戶暱稱'`
    - `admin.reports.inactiveUGL.colEmail`: `'郵箱'`
    - `admin.reports.inactiveUGL.colUGName`: `'負責UG'`
    - `admin.reports.inactiveUGL.colCreatedAt`: `'註冊時間'`
    - `admin.reports.inactiveUGL.colLastActive`: `'最後活躍'`
    - `admin.reports.inactiveUGL.noLastActive`: `'從未活躍'`
    - _Requirements: 10.1, 10.2_

  - [x] 8.4 Add translation keys to `packages/frontend/src/i18n/ja.ts`
    - `admin.reports.tabInactiveUGL`: `'非アクティブUGL'`
    - `admin.reports.inactiveUGL.quarterLabel`: `'四半期'`
    - `admin.reports.inactiveUGL.totalCount`: `'{count}名の非アクティブUGL'`
    - `admin.reports.inactiveUGL.emptyState`: `'この四半期のすべてのUGLはアクティブでした'`
    - `admin.reports.inactiveUGL.colNickname`: `'ニックネーム'`
    - `admin.reports.inactiveUGL.colEmail`: `'メール'`
    - `admin.reports.inactiveUGL.colUGName`: `'担当UG'`
    - `admin.reports.inactiveUGL.colCreatedAt`: `'登録日'`
    - `admin.reports.inactiveUGL.colLastActive`: `'最終活動'`
    - `admin.reports.inactiveUGL.noLastActive`: `'活動なし'`
    - _Requirements: 10.1, 10.2_

  - [x] 8.5 Add translation keys to `packages/frontend/src/i18n/ko.ts`
    - `admin.reports.tabInactiveUGL`: `'비활성 UGL'`
    - `admin.reports.inactiveUGL.quarterLabel`: `'분기'`
    - `admin.reports.inactiveUGL.totalCount`: `'{count}명의 비활성 UGL'`
    - `admin.reports.inactiveUGL.emptyState`: `'이번 분기 모든 UGL이 활동했습니다'`
    - `admin.reports.inactiveUGL.colNickname`: `'닉네임'`
    - `admin.reports.inactiveUGL.colEmail`: `'이메일'`
    - `admin.reports.inactiveUGL.colUGName`: `'담당 UG'`
    - `admin.reports.inactiveUGL.colCreatedAt`: `'가입일'`
    - `admin.reports.inactiveUGL.colLastActive`: `'마지막 활동'`
    - `admin.reports.inactiveUGL.noLastActive`: `'활동 없음'`
    - _Requirements: 10.1, 10.2_

- [x] 9. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `xlsx` library is already available in backend dependencies
- Quarter utility functions are pure and easily testable
- Core logic (filterEligibleUGLs, extractActiveUserIds, computeInactiveUGLs, findLastActiveDate) is extracted as pure functions for property-based testing
- UGs table is small (< 50 records), Scan is acceptable
- For lastActiveDate, individual reverse queries per inactive UGL (typically < 100) are acceptable for performance
- Frontend tab visibility is gated by SuperAdmin role check, consistent with existing patterns
- Export flow reuses existing `executeExport` → S3 → presigned URL pipeline

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["4.1", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3"] },
    { "id": 5, "tasks": ["7.1", "8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] }
  ]
}
```
