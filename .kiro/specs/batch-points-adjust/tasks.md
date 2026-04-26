# Implementation Plan: Batch Points Adjustment (批量积分调整)

## Overview

实现 SuperAdmin 对已完成的批量积分发放记录进行调整的功能。按层级从底向上实现：shared types 扩展 → backend 调整差异计算与验证 → backend 原子事务执行 → backend API 路由 → frontend 调整页面（预填表单、参与者增减、Speaker 类型变更、差异摘要、确认弹窗）→ batch-history 页面增加"已调整"标识与调整入口 → i18n 5 语言支持 → SCSS 样式。使用 DynamoDB `TransactWriteCommand` 分批保证原子性，写入 `type: 'adjust'` 修正记录保留完整审计轨迹。

## Tasks

- [x] 1. Update shared types for adjustment fields
  - [x] 1.1 Extend `DistributionRecord` interface in `packages/shared/src/types.ts`
    - Add optional `adjustedAt?: string` field (ISO timestamp)
    - Add optional `adjustedBy?: string` field (SuperAdmin userId)
    - _Requirements: 9.5, 12.1, 12.2_

  - [x] 1.2 Add `'adjust'` to `PointsRecordType` in `packages/shared/src/types.ts`
    - Ensure `PointsRecordType` includes `'adjust'` alongside existing `'earn' | 'spend' | 'refund'`
    - If `PointsRecordType` doesn't exist as a standalone type, check where `type` field is used in PointsRecords and ensure `'adjust'` is accepted
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 2. Export `chunkArray` utility from batch-points.ts
  - Make `chunkArray` in `packages/backend/src/admin/batch-points.ts` an exported function (currently private)
  - This allows `batch-points-adjust.ts` to reuse it without duplication
  - _Requirements: 6.2_

- [x] 3. Implement backend adjustment diff computation and validation
  - [x] 3.1 Create `packages/backend/src/admin/batch-points-adjust.ts` with core interfaces and diff logic
    - Define `AdjustmentInput` interface: `distributionId`, `recipientIds: string[]`, `targetRole`, `speakerType?`, `adjustedBy: string`
    - Define `AdjustmentDiff` interface: `addedUserIds: string[]`, `removedUserIds: string[]`, `retainedUserIds: string[]`, `originalPoints: number`, `newPoints: number`, `pointsDelta: number` (per person for retained), plus per-user adjustment amounts
    - Define `AdjustmentResult` interface: `success: boolean`, `error?: { code: string; message: string }`
    - Implement `computeAdjustmentDiff(original: DistributionRecord, input: AdjustmentInput, config: PointsRuleConfig): AdjustmentDiff`
      - Compute added users: in new `recipientIds` but not in original
      - Compute removed users: in original but not in new `recipientIds`
      - Compute retained users: in both
      - Calculate `newPoints` from `calculateExpectedPoints(input.targetRole, input.speakerType, config)`
      - For removed users: negative adjustment = `-originalPoints`
      - For added users: positive adjustment = `+newPoints`
      - For retained users where points changed: delta = `newPoints - originalPoints`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.2 Implement `validateAdjustmentInput` function in the same file
    - Reject if `recipientIds` is empty → `INVALID_REQUEST`
    - Reject if `targetRole` is `Speaker` and no `speakerType` → `INVALID_REQUEST`
    - Reject if `targetRole` is `Volunteer` and recipient count exceeds `volunteerMaxPerEvent` → `VOLUNTEER_LIMIT_EXCEEDED`
    - Reject if no actual changes detected (same recipients, same role, same speakerType) → `NO_CHANGES`
    - Recalculate points from `PointsRuleConfig` — never accept client-provided points value
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 3.3 Write unit tests for diff computation and validation
    - Test file: `packages/backend/src/admin/batch-points-adjust.test.ts`
    - Test added/removed/retained user computation
    - Test points delta calculation for speaker type changes
    - Test validation: empty recipients, missing speakerType, no changes, volunteer limit
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 4. Implement backend atomic multi-table adjustment execution
  - [x] 4.1 Implement `executeAdjustment` function in `packages/backend/src/admin/batch-points-adjust.ts`
    - Fetch original `DistributionRecord` by `distributionId` using `GetCommand`; return `DISTRIBUTION_NOT_FOUND` if missing
    - Fetch `PointsRuleConfig` via `getFeatureToggles`
    - Call `validateAdjustmentInput` and `computeAdjustmentDiff`
    - Check for negative balance: for each user with negative delta, fetch current `points` balance; reject with `INSUFFICIENT_BALANCE` if any would go negative
    - Build `TransactWriteCommand` items for each affected user:
      - **Update User_Record**: adjust `points`, `earnTotal`, and role-specific `earnTotalSpeaker`/`earnTotalLeader`/`earnTotalVolunteer` by the computed delta
      - **Put Correction_Record**: `type: 'adjust'`, `amount` = delta, `source` = adjustment context string, include `activityId`, `activityUG`, `activityTopic`, `activityDate`, `targetRole`, reference to `distributionId`
    - Handle role changes for retained users: decrease original role's earnTotal, increase new role's earnTotal
    - Split into batches of 25 users (DynamoDB TransactWriteItems limit) and execute each batch
    - If any batch fails, return `ADJUSTMENT_FAILED` error
    - After all user batches succeed, update `DistributionRecord`:
      - Set new `recipientIds`, `recipientDetails`, `targetRole`, `speakerType`
      - Recalculate `points` (per-person), `successCount`, `totalPoints`
      - Set `adjustedAt` = ISO timestamp, `adjustedBy` = SuperAdmin userId
    - Import `ulid` for generating correction record IDs
    - Reuse `calculateExpectedPoints` and `chunkArray` from `batch-points.ts` (export `chunkArray` if not already exported)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.2 Write unit tests for adjustment execution
    - Test file: `packages/backend/src/admin/batch-points-adjust.test.ts`
    - Test successful adjustment with added/removed/retained users
    - Test insufficient balance rejection
    - Test distribution not found
    - Test batch splitting for >25 users
    - Test role change earnTotal adjustments
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Add adjustment API route to admin handler
  - [x] 5.1 Add `POST /api/admin/batch-points/{distributionId}/adjust` route in `packages/backend/src/admin/handler.ts`
    - Add `BATCH_POINTS_ADJUST_REGEX` pattern: `/^\/api\/admin\/batch-points\/([^/]+)\/adjust$/`
    - Add route matching in the POST section, **SuperAdmin only** (check `isSuperAdmin`)
    - Return 403 `FORBIDDEN` for non-SuperAdmin users
    - Parse request body for `recipientIds`, `targetRole`, `speakerType`
    - Call `executeAdjustment` with parsed input and return appropriate JSON response
    - Import `executeAdjustment` from `./batch-points-adjust`
    - Pass `tables` object with `usersTable`, `pointsRecordsTable`, `batchDistributionsTable`, `activitiesTable`
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Write unit tests for the adjustment route handler
    - Test file: `packages/backend/src/admin/handler.test.ts` (add to existing)
    - Test SuperAdmin access succeeds
    - Test non-SuperAdmin returns 403
    - _Requirements: 1.1_

- [x] 6. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement frontend adjustment page
  - [x] 7.1 Create `packages/frontend/src/pages/admin/batch-adjust.tsx` page component
    - Accept `distributionId` as a route parameter (via `Taro.getCurrentInstance().router?.params`)
    - **SuperAdmin gate**: redirect to batch-history if user is not SuperAdmin
    - **Load original data**: fetch `GET /api/admin/batch-points/history/{distributionId}` and pre-fill form
    - Display read-only activity context: activity type badge, UG name, topic, date
    - **Role tabs**: show `targetRole` tabs (UserGroupLeader / Speaker / Volunteer), pre-select original role
    - **Speaker type selector**: show only when `targetRole === 'Speaker'`, pre-select original `speakerType`
    - **Auto points display**: compute per-person points from `PointsRuleConfig` based on selected role + speakerType
    - **User list with checkboxes**: fetch all users for the selected role via `GET /api/admin/users?role={role}`
      - Pre-check users from original `recipientIds`
      - Support search filtering by nickname or email
      - Support select-all / deselect-all for visible users
      - Load more pagination
    - **Diff summary panel**: display count of added users, removed users, original points/person, new points/person, total points delta (±)
    - **Volunteer limit check**: show warning if volunteer count exceeds `volunteerMaxPerEvent`
    - **Reason display**: show original reason as read-only
    - **Submit button**: disabled when no changes detected or validation fails
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4_

  - [x] 7.2 Implement confirmation dialog with diff summary in `batch-adjust.tsx`
    - Show on submit button click
    - Display: count of added users, count of removed users, original points/person, new points/person, total points delta
    - List nicknames of added and removed users
    - Confirm button sends `POST /api/admin/batch-points/{distributionId}/adjust` with `{ recipientIds, targetRole, speakerType? }`
    - Cancel button closes dialog without changes
    - Show loading state during submission, disable confirm button
    - Show success toast and navigate back to batch-history on success
    - Show error toast on failure
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 8. Register adjustment page in Taro app config
  - Add `'pages/admin/batch-adjust'` to the pages array in `packages/frontend/src/app.config.ts`
  - Create `packages/frontend/src/pages/admin/batch-adjust.config.ts` with page title configuration (follow pattern of existing page configs)
  - _Requirements: 2.1_

- [x] 9. Update batch-history page for adjustment indicators and entry point
  - [x] 9.1 Add "Adjusted" badge and adjustment metadata in `packages/frontend/src/pages/admin/batch-history.tsx`
    - In the record summary view: when `record.adjustedAt` exists, display an "已调整" / "Adjusted" badge
    - In the expanded detail view: display `adjustedAt` timestamp and `adjustedBy` SuperAdmin identity
    - _Requirements: 12.1, 12.2_

  - [x] 9.2 Add "Adjust" button entry point in batch-history detail view
    - Add an "调整" / "Adjust" button in the expanded detail section, visible **only** when `isSuperAdmin` is true
    - On click, navigate to `/pages/admin/batch-adjust?distributionId={distributionId}`
    - _Requirements: 1.3, 12.3_

- [x] 10. Add i18n translations for all 5 languages
  - [x] 10.1 Add translation keys to `packages/frontend/src/i18n/zh.ts`
    - Add `batchPoints.adjust.*` keys:
      - `title`: '调整积分发放'
      - `backButton`: '‹ 返回'
      - `loadingDistribution`: '加载发放记录...'
      - `distributionNotFound`: '发放记录不存在'
      - `activityLabel`: '关联活动'
      - `originalRole`: '原始角色'
      - `originalSpeakerType`: '原始 Speaker 类型'
      - `originalPoints`: '原始每人积分'
      - `newPoints`: '调整后每人积分'
      - `diffSummaryTitle`: '变更摘要'
      - `addedCount`: '新增 {count} 人'
      - `removedCount`: '移除 {count} 人'
      - `retainedCount`: '保留 {count} 人'
      - `totalDelta`: '积分总变化'
      - `noChanges`: '未检测到变更'
      - `submitButton`: '提交调整'
      - `confirmTitle`: '确认调整'
      - `confirmAddedUsers`: '新增用户'
      - `confirmRemovedUsers`: '移除用户'
      - `confirmOriginalPointsPerPerson`: '原始每人积分'
      - `confirmNewPointsPerPerson`: '调整后每人积分'
      - `confirmTotalDelta`: '积分总变化'
      - `confirmCancel`: '取消'
      - `confirmSubmit`: '确认调整'
      - `submitting`: '提交中...'
      - `successToast`: '调整成功'
      - `errorToast`: '调整失败，请稍后重试'
    - Add `batchPoints.history.adjustedBadge`: '已调整'
    - Add `batchPoints.history.adjustedAt`: '调整时间'
    - Add `batchPoints.history.adjustedBy`: '调整人'
    - Add `batchPoints.history.adjustButton`: '调整'
    - _Requirements: 2.1, 3.5, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3_

  - [x] 10.2 Add translation keys to `packages/frontend/src/i18n/en.ts`
    - Same keys as 10.1 with English translations
    - _Requirements: 2.1_

  - [x] 10.3 Add translation keys to `packages/frontend/src/i18n/zh-TW.ts`
    - Same keys as 10.1 with Traditional Chinese translations
    - _Requirements: 2.1_

  - [x] 10.4 Add translation keys to `packages/frontend/src/i18n/ja.ts`
    - Same keys as 10.1 with Japanese translations
    - _Requirements: 2.1_

  - [x] 10.5 Add translation keys to `packages/frontend/src/i18n/ko.ts`
    - Same keys as 10.1 with Korean translations
    - _Requirements: 2.1_

- [x] 11. Add SCSS styles for adjustment page and history badges
  - [x] 11.1 Create `packages/frontend/src/pages/admin/batch-adjust.scss`
    - Follow existing patterns from `batch-points.scss` and `batch-history.scss`
    - Use CSS variables from design system: `--bg-surface`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--accent-primary`, `--card-border`, `--space-*`, `--radius-*`, `--transition-*`
    - Style `.batch-adjust` container, toolbar, activity context card (read-only)
    - Style `.ba-diff-summary` panel: added/removed/retained counts, points delta with color coding (`--success` for positive, `--error` for negative)
    - Style `.ba-user-list` with checkboxes, pre-selected state, search bar
    - Style confirmation dialog using existing `.form-overlay` / `.form-modal` pattern
    - Style `.ba-adjusted-badge` for the "Adjusted" indicator
    - Reuse global `.role-badge`, `.btn-primary`, `.btn-danger` classes
    - _Requirements: 3.1, 3.5, 11.1, 12.1_

  - [x] 11.2 Add adjustment-related styles to `packages/frontend/src/pages/admin/batch-history.scss`
    - Add `.bh-adjusted-badge` — small badge using `--warning` or `--info` color to indicate adjusted records
    - Add `.bh-adjust-button` — action button style for the "Adjust" entry point in detail view
    - Add `.bh-adjusted-meta` — styles for adjustedAt timestamp and adjustedBy display
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 12. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design.md is empty, so no Correctness Properties section exists — property-based tests are not included; unit tests cover validation and execution logic
- The `chunkArray` utility is extracted from `batch-points.ts` to avoid duplication
- Original `earn` records are never modified or deleted — only `adjust` correction records are written
- The adjustment page follows the same UI patterns as `batch-points.tsx` (role tabs, speaker type selector, user list with checkboxes, confirmation dialog)
- DynamoDB transactions are split into batches of 25 to respect the `TransactWriteItems` limit
- Points are always recalculated from `PointsRuleConfig` — never accepted from the client
- The `adjustedAt` and `adjustedBy` fields on `DistributionRecord` serve as both audit trail and UI indicator for adjusted records
