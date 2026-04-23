# Implementation Plan: Employee Engagement Report (活跃员工报表)

## Overview

This plan implements the 11th report tab "活跃员工" in the existing Reports Page. The feature queries employee users' points records, aggregates engagement metrics per employee, and displays summary cards + detail table with CSV/Excel export support. Implementation follows a bottom-up approach: pure aggregation functions first, then query logic, formatters, export integration, handler routing, and finally frontend UI.

## Tasks

- [x] 1. Implement pure aggregation functions in insight-query.ts
  - [x] 1.1 Add `aggregateEmployeeEngagement` pure function
    - Add `EmployeeEngagementFilter`, `EmployeeEngagementRecord`, `EmployeeEngagementSummary`, `EmployeeEngagementResult` interfaces to `packages/backend/src/reports/insight-query.ts`
    - Implement `aggregateEmployeeEngagement(records)` that groups by `userId`, computes `totalPoints` (sum of amount), `activityCount` (distinct activityId count), `lastActiveTime` (max createdAt), `primaryRoles` (Set of non-empty targetRole), `ugSet` (Set of non-empty activityUG)
    - Export the function for property testing
    - _Requirements: 6.1, 9.1, 9.2, 9.3, 9.4_

  - [x] 1.2 Add `calculateEngagementRate` pure function
    - Implement `calculateEngagementRate(activeCount, totalCount)` returning `activeCount / totalCount × 100` rounded to one decimal place; return `0` when `totalCount === 0`
    - Export the function for property testing
    - _Requirements: 2.5, 6.3, 9.5_

  - [x]* 1.3 Write property tests for aggregation functions (Properties 1-5)
    - **Property 1: 积分守恒 (Points Conservation)** — sum of all aggregated `totalPoints` equals sum of all input `amount` values
    - **Validates: Requirements 2.6, 3.5, 6.1, 9.1**
    - **Property 2: 用户计数一致性 (User Count Consistency)** — number of aggregated entries equals number of distinct `userId` values in input
    - **Validates: Requirements 2.4, 6.5, 9.2**
    - **Property 3: 活动数上界 (Activity Count Upper Bound)** — each employee's `activityCount` ≤ that employee's total record count
    - **Validates: Requirements 3.6, 9.3**
    - **Property 4: 最后活跃时间为最大值 (Last Active Time is Maximum)** — each employee's `lastActiveTime` ≥ all of that employee's `createdAt` values
    - **Validates: Requirements 3.7, 9.4**
    - **Property 5: 活跃率公式正确性与范围 (Engagement Rate Formula and Range)** — result is in [0, 100], equals 0 when totalCount=0, matches formula otherwise
    - **Validates: Requirements 2.5, 6.3, 9.5**
    - Test file: `packages/backend/src/reports/employee-engagement.property.test.ts`

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement backend query function
  - [x] 3.1 Add `queryEmployeeEngagement` async function in `packages/backend/src/reports/insight-query.ts`
    - Scan Users table with `FilterExpression: isEmployee = :true` to get employee userId set
    - Query PointsRecords `type-createdAt-index` GSI with `type=earn` and date range (use `applyDefaultDateRange` from `query.ts` for defaults)
    - Filter records in memory to keep only employee userIds
    - Call `aggregateEmployeeEngagement` on filtered records
    - BatchGet Users table for nicknames
    - Sort by `totalPoints` desc, tiebreak by `lastActiveTime` desc
    - Assign `rank = index + 1`
    - Compute summary: `totalEmployees` (from scan), `activeEmployees` (records.length), `engagementRate` (via `calculateEngagementRate`), `totalPoints` (sum), `totalActivities` (union of all activityId sets)
    - Return `{ success: true, summary, records }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x]* 3.2 Write property tests for summary-detail consistency and ranking (Properties 6-8)
    - **Property 6: 汇总与明细一致性 (Summary-Detail Consistency)** — `summary.activeEmployees === records.length` and `summary.totalPoints === sum of records[].totalPoints`
    - **Validates: Requirements 4.4, 6.5, 6.6**
    - **Property 7: 排名排序正确性 (Ranking Order Correctness)** — ranks are 1..N consecutive, sorted by totalPoints desc then lastActiveTime desc
    - **Validates: Requirements 3.3, 6.4**
    - **Property 8: 员工集合完整性 (Per-Employee Set Completeness)** — each employee's roles set contains all non-empty targetRole values, ugSet contains all non-empty activityUG values
    - **Validates: Requirements 3.8, 3.9**
    - Test file: `packages/backend/src/reports/employee-engagement.property.test.ts`

  - [x]* 3.3 Write unit tests for `queryEmployeeEngagement`
    - Mock DynamoDB client to test full query flow
    - Test empty employee set returns zero metrics
    - Test date range filtering
    - Test correct ranking with tied points
    - Test file: `packages/backend/src/reports/employee-engagement.test.ts`
    - _Requirements: 5.1, 5.3, 5.7_

- [x] 4. Implement formatters and column definitions
  - [x] 4.1 Update `ReportType` and add column definitions in `packages/backend/src/reports/formatters.ts`
    - Add `'employee-engagement'` to the `ReportType` union type
    - Add `EMPLOYEE_ENGAGEMENT_COLUMNS` array with 7 columns: 排名, 用户昵称, 积分总额, 参与活动数, 最后活跃时间, 主要角色, 参与UG列表
    - Add `'employee-engagement'` case to `getColumnDefs` switch
    - Import `EmployeeEngagementRecord` type from `insight-query.ts`
    - _Requirements: 8.1_

  - [x] 4.2 Add `formatEmployeeEngagementForExport` function in `packages/backend/src/reports/formatters.ts`
    - Map each record: `lastActiveTime` → `YYYY-MM-DD HH:mm:ss` format (reuse existing `formatDateTime`), `ugList` as-is (already comma-separated), other fields direct mapping
    - Return `Record<string, unknown>[]`
    - _Requirements: 8.2, 8.3, 8.4_

  - [x]* 4.3 Write property test for formatter (Property 9)
    - **Property 9: 格式化函数确定性与正确性 (Formatter Determinism and Correctness)** — output row count equals input count, each row has all 7 column keys, `lastActiveTime` matches `YYYY-MM-DD HH:mm:ss` pattern, deterministic on same input
    - **Validates: Requirements 7.3, 8.1, 8.2, 8.3, 8.4**
    - Test file: `packages/backend/src/reports/employee-engagement.property.test.ts`

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Integrate export support
  - [x] 6.1 Register `employee-engagement` in export module `packages/backend/src/reports/export.ts`
    - Add `'employee-engagement'` to `VALID_REPORT_TYPES` array
    - Add `employee-engagement` branch in `executeExport`: call `queryEmployeeEngagement`, then `formatEmployeeEngagementForExport`, then `generateCSV`/`generateExcel`
    - Import `queryEmployeeEngagement` from `insight-query.ts` and `formatEmployeeEngagementForExport` from `formatters.ts`
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6_

- [x] 7. Add backend handler route
  - [x] 7.1 Add GET route in `packages/backend/src/admin/handler.ts`
    - Add import for `queryEmployeeEngagement` from `../reports/insight-query`
    - Add `GET /api/admin/reports/employee-engagement` route with SuperAdmin permission check
    - Parse `startDate` and `endDate` from query parameters
    - Call `queryEmployeeEngagement` and return `{ summary, records }` as JSON response
    - _Requirements: 5.1, 5.2, 1.3_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update frontend reports page
  - [x] 9.1 Add `employee-engagement` tab type and filter state in `packages/frontend/src/pages/admin/reports.tsx`
    - Add `'employee-engagement'` to `ReportTab` union type
    - Add `'employee-engagement'` entry to `TabFilterState` interface with `{ startDate: string; endDate: string }`
    - Add tab entry to `REPORT_TABS` array with `labelKey: 'admin.reports.tabEmployeeEngagement'`
    - Add `'employee-engagement'` mappings to `tabToReportType` and `tabToEndpoint`
    - Add default filters in `getDefaultFilters`
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 9.2 Add `EmployeeEngagementSummary` and `EmployeeEngagementRecord` interfaces
    - Define TypeScript interfaces matching the backend response shape
    - Add state for summary data (`employeeEngagementSummary`)
    - Update data fetch logic: when tab is `employee-engagement`, extract `summary` and `records` from response
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

  - [x] 9.3 Add `EmployeeMetricCards` component
    - Create a card row component displaying 5 metrics: 员工总数, 活跃员工数, 活跃率 (with % suffix), 员工积分总额, 参与活动数
    - Follow the same card layout pattern used by `invite-conversion` tab (metric cards above table)
    - Use CSS variables for colors and spacing per frontend design rules
    - Render the cards above the data table when `activeTab === 'employee-engagement'`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 9.4 Add table column definitions for `employee-engagement` in `getColumns`
    - Add 7 columns: 排名 (rank), 昵称 (nickname), 积分总额 (totalPoints), 参与活动数 (activityCount), 最后活跃时间 (lastActiveTime), 主要角色 (primaryRoles), 参与UG列表 (ugList)
    - Format `lastActiveTime` using existing `formatTime` helper
    - Style rank column with accent color and display font (matching user-ranking pattern)
    - Style totalPoints with display font and bold weight
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 10. Add i18n keys for both languages
  - [x] 10.1 Update `packages/frontend/src/i18n/types.ts`
    - Add new i18n key type definitions for employee engagement report: `tabEmployeeEngagement`, `metricTotalEmployees`, `metricActiveEmployees`, `metricEngagementRate`, `metricEmployeeTotalPoints`, `metricTotalActivities`, `colLastActiveTime`, `colPrimaryRoles`, `colUGList`
    - _Requirements: 1.1_

  - [x] 10.2 Update `packages/frontend/src/i18n/zh.ts`
    - Add Chinese translations for all new i18n keys under `admin.reports`
    - _Requirements: 1.1_

  - [x] 10.3 Update `packages/frontend/src/i18n/en.ts`
    - Add English translations for all new i18n keys under `admin.reports`
    - _Requirements: 1.1_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 9 correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- The feature reads existing `isEmployee` and `PointsRecords` data — no new DynamoDB tables or fields are created
- All aggregation logic is implemented as exported pure functions for testability
- The frontend follows the existing invite-conversion tab pattern (summary cards + detail table)
