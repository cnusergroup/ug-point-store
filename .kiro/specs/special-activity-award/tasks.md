# Implementation Plan: Special Activity Award (特殊活动积分颁发)

## Overview

实现 SuperAdmin 向特定活动获奖者发放"特殊活动积分"的独立通道，新增独立 `executeSpecialActivityDistribution` 函数（与身份分严格隔离）、独立 `PointsMall-AwardTags` 元数据表，以及配套的排行榜/报表/历史扩展。按层级从底向上实现：CDK 基础设施（先于业务代码部署）→ shared types 扩展 → backend award-tags CRUD → backend executeSpecialActivityDistribution → backend handler 路由 → backend ranking/reports 扩展 → frontend AwardTagPicker 组件 → frontend special-activity-award 页面 → frontend dashboard 卡片 + leaderboard / batch-history / reports 扩展 → i18n（5 语言）→ SCSS 样式。使用 DynamoDB `TransactWriteCommand` 保证发放原子性，AwardTag usageCount 在主事务前以独立 upsert 完成（最终一致折衷已在 design.md 记录）。

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. CDK infrastructure changes (Batch 1 - deploy before code)
  - [x] 1.1 Add `earnTotalSpecialActivity-index` GSI to Users table in `packages/cdk/lib/database-stack.ts`
    - In the Users table definition block, append `addGlobalSecondaryIndex` with `indexName: 'earnTotalSpecialActivity-index'`, partitionKey `pk: STRING`, sortKey `earnTotalSpecialActivity: NUMBER`
    - Ensure this is the ONLY new GSI added to the Users table in this deployment batch (DynamoDB CFN constraint)
    - _Requirements: 10.1, 10.2_

  - [x] 1.2 Create `PointsMall-AwardTags` table with `tagName-index` GSI in `packages/cdk/lib/database-stack.ts`
    - Define `awardTagsTable` (mirror `contentTagsTable` structure): partitionKey `tagId: STRING`, `BillingMode.PAY_PER_REQUEST`, `RemovalPolicy.DESTROY`
    - Add GSI `tagName-index` with partitionKey `tagName: STRING`, projection ALL
    - Add `CfnOutput` for `AwardTagsTableName` and `AwardTagsTableArn`
    - Export `awardTagsTable` so LambdaStack can reference it
    - _Requirements: 10.3, 10.4, 14.1, 14.2_

  - [x] 1.3 Wire `awardTagsTable` permissions and env vars in `packages/cdk/lib/lambda-stack.ts`
    - Pass `awardTagsTable` from DatabaseStack into LambdaStack via constructor props
    - On the admin Lambda, call `awardTagsTable.grantReadWriteData(adminLambda)`
    - Inject env var `AWARD_TAGS_TABLE: awardTagsTable.tableName`
    - Also ensure existing admin Lambda already has Users table read/write permissions (no change needed but verify the new GSI is accessible — IAM `dynamodb:Query` on Users index ARN should already cover it)
    - _Requirements: 10.1, 10.3, 14.3_

  - [ ]* 1.4 Add CDK synth snapshot assertions
    - Test file: `packages/cdk/test/database-stack.test.ts` (extend if exists, otherwise create)
    - Assert `PointsMall-Users` table contains a GSI named `earnTotalSpecialActivity-index`
    - Assert `PointsMall-AwardTags` table exists with `tagName-index` GSI
    - _Requirements: 10.1, 10.3, 14.1, 14.2_

- [x] 2. Extend shared types for SpecialActivity targetRole and AwardTag fields
  - [x] 2.1 Update `DistributionRecord`, `PointsRecord` and add `AwardTag` types in `packages/shared/src/types.ts`
    - Extend `DistributionRecord.targetRole` union to include `'SpecialActivity'`
    - Add optional fields `awardTagId?: string`, `awardTagName?: string`, `awardTagDisplayName?: string` to `DistributionRecord`
    - Extend `PointsRecord.targetRole` union (or add field) to include `'SpecialActivity'` and add `awardTagId?: string`, `awardTagName?: string`
    - Add new exported interface `AwardTag` with fields: `tagId: string`, `tagName: string`, `displayName: string`, `usageCount: number`, `createdAt: string`, `updatedAt: string`, `createdBy: string`
    - Export shared constants: `AWARD_TAG_FORBIDDEN_CHARS = `<>"'/\\|*?:&`` and `AWARD_TAG_MAX_LENGTH = 30`
    - _Requirements: 6.7, 6.8, 7.4, 7.5, 7.6, 14.1_

- [x] 3. Backend AwardTag normalization, validation, and CRUD module
  - [x] 3.1 Create `packages/backend/src/admin/award-tags.ts` with normalization and validation pure functions
    - Implement `normalizeTagName(s: string): string` — trim, collapse whitespace runs to single space, toLowerCase (mirror `packages/backend/src/content/tags.ts` rules)
    - Implement `validateAwardTagName(s: string): { valid: boolean; code?: string; message?: string }` — checks normalized length in [1, 30], no forbidden chars `<>"'/\|*?:&`, only Chinese/English/digits/spaces
    - Export both as pure functions (no IO) for shared use by handler and PBT
    - _Requirements: 3.7, 3.8, 3.9, 6.15, 6.16, 14.8, 14.9_

  - [ ]* 3.2 Write property test for AwardTag name validation (Property 1) and normalization (Property 2)
    - Test file: `packages/backend/src/admin/award-tags-validate.property.test.ts`
    - **Property 1: AwardTag name validation completeness**
    - **Validates: Requirements 3.7, 3.8, 3.9, 6.15, 6.16, 14.9**
    - **Property 2: normalizeTagName idempotency + displayName immutability**
    - **Validates: Requirements 3.10, 6.9, 14.8, 14.10**
    - Use fast-check; include comment header `// Feature: special-activity-award, Property 1/2: ...`

  - [x] 3.3 Implement AwardTag CRUD functions in `packages/backend/src/admin/award-tags.ts`
    - `searchAwardTags(prefix: string, limit: number, ddb, table)` — normalize prefix, query `tagName-index` with `begins_with(tagName, :p)`, sort by `usageCount` desc in-memory, cap limit at 50 default 10; return `[]` for empty normalized prefix
    - `getHotAwardTags(ddb, table)` — Scan or Query (acceptable since AwardTags is small) sorted by `usageCount` desc, take top 10
    - `createAwardTag({ displayName, createdBy }, ddb, table)` — normalize to tagName, query `tagName-index` to check existence, return `{ code: 'TAG_ALREADY_EXISTS' }` if exists; else `PutCommand` with `ConditionExpression: attribute_not_exists(tagId)`, `tagId = ulid()`, `usageCount = 0`, `displayName` = original input (preserve case/whitespace)
    - `deleteAwardTag(tagId, ddb, table)` — `DeleteCommand` with `ConditionExpression: attribute_exists(tagId) AND usageCount = :zero`; map `ConditionalCheckFailed` to `TAG_IN_USE`, missing item to `TAG_NOT_FOUND`
    - `upsertAwardTagUsage(displayName, createdBy, ddb, table)` — used by special-activity-award flow: query `tagName-index` first; if exists `UpdateCommand ADD usageCount :one SET updatedAt = :now`; else `PutCommand` with `ConditionExpression: attribute_not_exists(tagId)`, `usageCount = 1`. Returns `{ tagId, tagName, displayName }`
    - Use `ulid` for new tagIds; reuse existing dynamoClient utilities
    - _Requirements: 6.10, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 14.12_

  - [ ]* 3.4 Write property test for AwardTag upsert and delete behavior (Properties 8 and 9)
    - Test file: `packages/backend/src/admin/award-tags.property.test.ts`
    - **Property 8: AwardTag upsert usageCount uniqueness and counting**
    - **Validates: Requirements 6.10, 14.4, 14.5, 14.12**
    - **Property 9: AwardTag delete restriction**
    - **Validates: Requirements 14.6, 14.7**
    - Use in-memory mock DDB pattern (see `packages/backend/src/admin/batch-points.property.test.ts`)

  - [ ]* 3.5 Write unit tests for AwardTag CRUD edge cases
    - Test file: `packages/backend/src/admin/award-tags.test.ts`
    - Cover: empty prefix returns `[]`, hot returns top 10 by usageCount, create rejects duplicate with 409 code, delete rejects when usageCount > 0, delete returns TAG_NOT_FOUND for missing tagId
    - _Requirements: 14.3, 14.6, 14.7, 14.12_

- [x] 4. Backend executeSpecialActivityDistribution module
  - [x] 4.1 Create `packages/backend/src/admin/special-activity-award.ts` with input validation and dedup query
    - Define `SpecialActivityAwardInput` interface: `activityId: string`, `points: number`, `awardTagName: string` (raw user input), `userIds: string[]`, `awardDate: string` (YYYY-MM-DD), `distributorId`, `distributorNickname`
    - Define `SpecialActivityAwardResult` interface: `success`, `distributionId?`, `successCount?`, `totalPoints?`, `awardTagId?`, `awardTagName?`, `error?: { code, message, duplicateUserIds? }`
    - Implement `validateSpecialActivityInput(input)`: rejects empty `userIds`, non-positive-integer `points`, invalid `awardTagName` (delegate to `validateAwardTagName`), invalid `awardDate` regex `/^\d{4}-\d{2}-\d{2}$/`
    - Implement `getAwardedUserIdsByTag(activityId, awardTagName, ddb, distributionsTable)` — query `BatchDistributions` `createdAt-index` with `FilterExpression: activityId = :aid AND awardTagName = :tag AND targetRole = :role`, role literal `'SpecialActivity'`; flatten and return Set of awarded userIds across all matched distributions
    - _Requirements: 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 8.1_

  - [x] 4.2 Implement `executeSpecialActivityDistribution` orchestration in the same file
    - Step 1: validate input via `validateSpecialActivityInput`; return error on failure
    - Step 2: `GetCommand` Activities table by `activityId`; return `ACTIVITY_NOT_FOUND` if missing
    - Step 3: normalize `awardTagName`; call `upsertAwardTagUsage(displayName=input.awardTagName, createdBy=distributorId)` to get `{ tagId, tagName }`
    - Step 4: call `getAwardedUserIdsByTag(activityId, normalizedTagName)`, intersect with `input.userIds`; return `DUPLICATE_AWARD_TAG_DISTRIBUTION` with `duplicateUserIds[]` on conflict
    - Step 5: pre-flight transaction size check: if `userIds.length * 2 > 100` return `BATCH_TOO_LARGE`
    - Step 6: build `TransactWriteCommand` items:
      - For each userId: `Update Users` with `SET points = if_not_exists(points, :zero) + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, earnTotalSpecialActivity = if_not_exists(earnTotalSpecialActivity, :zero) + :pv, pk = if_not_exists(pk, :ALL)`
      - For each userId: `Put PointsRecords` with `recordId = ulid()`, `userId`, `type: 'earn'`, `amount: points`, `targetRole: 'SpecialActivity'`, `awardTagId`, `awardTagName: normalizedTagName`, `source: '特殊活动:' + topic + '|' + ug + '|' + awardDate + '|' + normalizedTagName`, `activityId`, `createdAt: now`
    - Step 7: execute transaction; on failure log `CancellationReasons` and return `INTERNAL_ERROR`
    - Step 8: `PutCommand` BatchDistributions with full DistributionRecord (`distributionId = ulid()`, `targetRole: 'SpecialActivity'`, `activityType: '特殊活动'`, `awardTagId`, `awardTagName: normalizedTagName`, `awardTagDisplayName: input.awardTagName`, `successCount`, `totalPoints`, NO `speakerType` field, NO `skillClaims` field)
    - Return `{ success: true, distributionId, successCount, totalPoints, awardTagId, awardTagName }`
    - **Important**: do NOT write `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer`; do NOT call into `executeBatchDistribution`
    - Import `ulid`, `TransactWriteCommand`, `PutCommand`, `GetCommand` from existing dependencies
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3, 8.4, 9.1, 9.2_

  - [ ]* 4.3 Write property test for distribution field isolation and increments (Property 5)
    - Test file: `packages/backend/src/admin/special-activity-award.property.test.ts`
    - **Property 5: executeSpecialActivityDistribution writes only three fields with exact increments**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 7.1, 7.2, 9.1, 9.2**
    - Generate random Users (with random pre-existing earnTotalSpeaker/Leader/Volunteer values), random valid input, run on in-memory mock DDB; assert `points`, `earnTotal`, `earnTotalSpecialActivity` increase by P; assert `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer` unchanged

  - [ ]* 4.4 Write property test for record field contract (Property 6)
    - Test file: `packages/backend/src/admin/special-activity-award.property.test.ts`
    - **Property 6: PointsRecord/DistributionRecord field contract**
    - **Validates: Requirements 6.4, 6.5, 6.7, 6.8, 7.3, 7.4, 7.5, 7.6**

  - [ ]* 4.5 Write property test for dedup tuple semantics (Property 7)
    - Test file: `packages/backend/src/admin/special-activity-award.property.test.ts`
    - **Property 7: dedup granularity is (activityId, awardTagName, userId) triple**
    - **Validates: Requirements 8.1, 8.3, 8.4**

  - [ ]* 4.6 Write property test for invalid input rejection (Property 10)
    - Test file: `packages/backend/src/admin/special-activity-award.property.test.ts`
    - **Property 10: invalid input rejection with zero side effects**
    - **Validates: Requirements 6.11, 6.12, 6.13, 6.14, 6.15, 6.16**

  - [ ]* 4.7 Write unit tests for executeSpecialActivityDistribution happy path and error branches
    - Test file: `packages/backend/src/admin/special-activity-award.test.ts`
    - Cover: success path, ACTIVITY_NOT_FOUND, DUPLICATE_AWARD_TAG_DISTRIBUTION, BATCH_TOO_LARGE, TransactionCanceled handling
    - _Requirements: 6.11, 6.12, 6.13, 6.14, 8.1_

- [x] 5. Wire backend HTTP routes in admin handler
  - [x] 5.1 Add award-tags routes to `packages/backend/src/admin/handler.ts`
    - `GET /api/admin/award-tags?prefix=...&limit=10` (SuperAdmin only) → `searchAwardTags`
    - `GET /api/admin/award-tags/hot` (SuperAdmin only) → `getHotAwardTags`
    - `POST /api/admin/award-tags` (SuperAdmin only) body `{ displayName }` → `createAwardTag`; map `TAG_ALREADY_EXISTS` to HTTP 409
    - `DELETE /api/admin/award-tags/{tagId}` (SuperAdmin only) → `deleteAwardTag`; map `TAG_IN_USE` to 400, `TAG_NOT_FOUND` to 404
    - Add regex constant `AWARD_TAG_BY_ID_REGEX = /^\/api\/admin\/award-tags\/([^/]+)$/`
    - Non-SuperAdmin → 403 `FORBIDDEN`
    - _Requirements: 1.1, 1.2, 14.3_

  - [x] 5.2 Add `POST /api/admin/special-activity-award` route in `packages/backend/src/admin/handler.ts`
    - SuperAdmin gate; non-SuperAdmin → 403 `FORBIDDEN` message `'需要超级管理员权限'`
    - Parse body `{ activityId, points, awardTagName, userIds, awardDate }`
    - Call `executeSpecialActivityDistribution` with `distributorId = event.user.userId` and `distributorNickname = event.user.nickname`
    - On success: HTTP 201 `{ distributionId, successCount, totalPoints, awardTagId, awardTagName }`, then send emails (see 5.3)
    - On error: map `INVALID_REQUEST → 400`, `ACTIVITY_NOT_FOUND → 400`, `DUPLICATE_AWARD_TAG_DISTRIBUTION → 400` with `duplicateUserIds`, `BATCH_TOO_LARGE → 400`, `INTERNAL_ERROR → 500`
    - _Requirements: 1.1, 1.2, 13.2_

  - [x] 5.3 Send `points_earned` emails best-effort after successful distribution (in handler.ts)
    - After `executeSpecialActivityDistribution` returns success, iterate unique `userIds`
    - For each user: `GetCommand` Users table with `ProjectionExpression: 'points'` to read post-distribution balance; call `sendPointsEarnedEmail(notificationCtx, userId, points, '特殊活动', currentBalance)`
    - Wrap each iteration in try/catch — log error but do not throw; do not block 201 response
    - Mirror the pattern from `handleQuarterlyAward`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 5.4 Write unit tests for handler routing
    - Test file: `packages/backend/src/admin/handler.test.ts` (extend existing)
    - Test SuperAdmin succeeds on POST /special-activity-award; Admin/regular user → 403; non-existent route still returns 404
    - Test award-tags GET/POST/DELETE routing matrix (SuperAdmin only)
    - _Requirements: 1.1, 1.2, 14.3_

- [x] 6. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Backend leaderboard and reports extensions
  - [x] 7.1 Extend `ROLE_GSI_MAP` and `VALID_ROLES` in `packages/backend/src/leaderboard/ranking.ts`
    - Add `'SpecialActivity'` to `VALID_ROLES` const tuple
    - Add `SpecialActivity: { indexName: 'earnTotalSpecialActivity-index', sortKeyField: 'earnTotalSpecialActivity' }` to `ROLE_GSI_MAP`
    - Update `isEligibleForRanking` (or equivalent role-filter logic) so `role === 'SpecialActivity'` does NOT require Speaker/UGL/Volunteer membership — any user appearing on the GSI is eligible
    - _Requirements: 10.5, 10.6_

  - [ ]* 7.2 Write unit tests for SpecialActivity ranking branch
    - Test file: `packages/backend/src/leaderboard/ranking.test.ts` (extend if exists)
    - Test query uses correct GSI name and sortKeyField; non-Speaker/UGL/Volunteer users are still returned
    - _Requirements: 10.5, 10.6_

  - [x] 7.3 Extend reports query/export to support `targetRole='SpecialActivity'` and earnTotalSpecialActivity column
    - In `packages/backend/src/reports/query.ts`: add `'SpecialActivity'` to `targetRole` whitelist; existing FilterExpression on `targetRole` will pick up records automatically
    - In `packages/backend/src/reports/export.ts`: append `'特殊活动积分'` column mapped to `earnTotalSpecialActivity` field; update `formatUserRankingForExport` (or equivalent)
    - In shared types: extend `UserRankingRecord` with optional `earnTotalSpecialActivity?: number`
    - _Requirements: 10.8, 10.9_

  - [ ]* 7.4 Write unit tests for reports extension
    - Test file: `packages/backend/src/reports/query.test.ts` and `packages/backend/src/reports/export.test.ts`
    - Test `targetRole='SpecialActivity'` filter; test export includes new column header and value
    - _Requirements: 10.8, 10.9_

- [x] 8. Frontend AwardTagPicker component
  - [x] 8.1 Create `packages/frontend/src/components/AwardTagPicker/index.tsx`
    - Props: `value: string`, `onChange: (displayName: string) => void`, `disabled?: boolean`
    - Internal state: input text, dropdown open, suggestions list, loading
    - Empty input on focus → call `GET /api/admin/award-tags/hot` for default suggestions
    - Non-empty input → debounce 300ms then `GET /api/admin/award-tags?prefix={input}&limit=10`
    - When input does not match any returned tag exactly, append `+ 新建 "{rawInput}"` row at the end of the dropdown
    - Click suggestion or `+ 新建` row → `onChange(displayName)` and close dropdown
    - Inline validation: call shared `validateAwardTagName` (move pure helpers to `packages/shared/src/award-tag.ts` and re-export from both backend and frontend) — show red error text on invalid input
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12_

  - [x] 8.2 Create `packages/frontend/src/components/AwardTagPicker/index.scss`
    - Style dropdown panel, list items, active/hover states; use only design system CSS variables (`--space-*`, `--radius-*`, `--text-*`, `--bg-*`, `--accent-primary`)
    - Add `cursor: pointer` on suggestion rows (per workspace UX rules)
    - Smooth `transition: background-color 200ms`; no layout-shifting transforms on hover
    - _Requirements: 3.4_

  - [ ]* 8.3 Write component unit tests for AwardTagPicker
    - Test file: `packages/frontend/src/components/AwardTagPicker/index.test.tsx`
    - Cover: empty input shows hot tags, prefix search hits, no-match shows `+ 新建` option, invalid input shows error, onChange invoked with correct value
    - _Requirements: 3.4, 3.5, 3.6_

- [ ] 9. Frontend special-activity-award page
  - [x] 9.1 Create `packages/frontend/src/pages/admin/special-activity-award.tsx`
    - SuperAdmin gate: redirect to `/pages/admin/index` if not SuperAdmin
    - Page layout (mirror `quarterly-award.tsx`): PageToolbar, Form Card "发放配置" (ActivityPicker, date Picker default today, points Input number, AwardTagPicker), User Selection Card with search + select-all + paginated list (`GET /api/admin/users?pageSize=50&lastKey=...` with frontend `status === 'active'` filter), Footer with Submit + ConfirmModal
    - Implement pure helper `filterUsersBySearch(users, q)` (case-insensitive match on nickname or email)
    - Implement pure helper `canSubmit(state)` — combinator over `(selectedActivity, points, awardTagName, userIds, awardDate)` returning boolean
    - Pre-load `GET /api/admin/batch-points/awarded?activityId=...&awardTagName=...` (or equivalent — derive from existing dedup query path) to mark already-awarded users when activity + tag both selected
    - On submit confirm modal: show activity name, awardDate, count, perPersonPoints, totalPoints, awardTagName
    - Submit handler: `POST /api/admin/special-activity-award` with `{ activityId, points, awardTagName, userIds, awardDate }`; on 400 `DUPLICATE_AWARD_TAG_DISTRIBUTION`, highlight `duplicateUserIds` in user list and show toast
    - On client side, refuse submit when `userIds.length > 50` (BATCH_TOO_LARGE pre-check)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 9.2 Create `packages/frontend/src/pages/admin/special-activity-award.config.ts`
    - Export page config with `navigationBarTitleText: '特殊活动积分颁发'` (or i18n equivalent)
    - _Requirements: 13.1_

  - [x] 9.3 Create `packages/frontend/src/pages/admin/special-activity-award.scss`
    - Mirror `quarterly-award.scss`; use only design system CSS variables (`--space-*`, `--radius-*`, `--text-*`)
    - Style cards, lists, footer, ConfirmModal, "已发放" badge for awarded users
    - Add `cursor: pointer` on clickable rows; light/dark mode borders/contrast per workspace UX rules
    - _Requirements: 2.1, 4.1_

  - [x] 9.4 Register page route in `packages/frontend/src/app.config.ts`
    - Append `'pages/admin/special-activity-award'` to the `pages` array
    - _Requirements: 13.1_

  - [ ]* 9.5 Write property test for filterUsersBySearch contains semantic (Property 3)
    - Test file: `packages/frontend/src/pages/admin/special-activity-award.users-filter.property.test.ts`
    - **Property 3: filterUsersBySearch contains semantic**
    - **Validates: Requirements 4.2**

  - [ ]* 9.6 Write property test for canSubmit gating equivalence (Property 4)
    - Test file: `packages/frontend/src/pages/admin/special-activity-award.canSubmit.property.test.tsx`
    - **Property 4: canSubmit equivalent to required-fields conjunction**
    - **Validates: Requirements 2.4, 3.11, 3.12, 4.5**

- [x] 10. Wire admin dashboard card and i18n keys
  - [x] 10.1 Add SpecialActivity card to `packages/frontend/src/pages/admin/index.tsx`
    - Append entry to `ADMIN_LINKS`: `key: 'special-activity-award'`, `category: 'operations'`, `icon: GiftIcon` (or appropriate award/gift SVG icon — NOT emoji per workspace UX rules), `titleKey: 'admin.dashboard.specialActivityAwardTitle'`, `descKey: 'admin.dashboard.specialActivityAwardDesc'`, `url: '/pages/admin/special-activity-award'`, `superAdminOnly: true`
    - _Requirements: 13.3, 13.4, 13.5_

  - [x] 10.2 Add i18n keys to all 5 locale files
    - Add `admin.dashboard.specialActivityAwardTitle` and `admin.dashboard.specialActivityAwardDesc` plus all page-internal strings to `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Add `leaderboard.roleSpecialActivity` (e.g. zh: '特殊活动', en: 'Special Activity', etc.)
    - Add page-specific keys: form labels (活动 / 日期 / 积分 / 奖项标签 / 用户), confirm modal labels, error messages (`DUPLICATE_AWARD_TAG_DISTRIBUTION`, `ACTIVITY_NOT_FOUND`, `INVALID_REQUEST`, `TAG_IN_USE`, `TAG_ALREADY_EXISTS`, `BATCH_TOO_LARGE`, `FORBIDDEN`)
    - Add AwardTagPicker labels: 输入奖项标签 / 新建 "%s" / 暂无热门标签 / 标签长度必须为 1~30 个字符 / 标签包含非法字符
    - _Requirements: 1.2, 3.7, 3.8, 5.4, 5.5, 6.11–6.16, 8.1, 13.3, 14.6, 14.7, 14.12_

- [x] 11. Frontend leaderboard, batch-history, and reports integration
  - [x] 11.1 Add SpecialActivity Tab to leaderboard in `packages/frontend/src/pages/leaderboard/index.tsx`
    - Extend `RoleFilter` type union to include `'SpecialActivity'`
    - Append `{ value: 'SpecialActivity', labelKey: 'leaderboard.roleSpecialActivity' }` to `ROLE_TABS`
    - Ensure existing tab switching logic accommodates the new role without further changes (reuses `?role=` query param)
    - _Requirements: 10.7_

  - [x] 11.2 Add "特殊活动" filter option to batch-history in `packages/frontend/src/pages/admin/batch-history.tsx`
    - Add an `'特殊活动'` entry to the activityType filter dropdown
    - Ensure list call sends `activityType=特殊活动` to existing `GET /api/admin/batch-points/history` (verify query param is forwarded; if not, extend `listDistributionHistory` in backend to accept optional `activityType` filter)
    - In detail expansion, render `awardTagDisplayName` field when present
    - Implement secondary filter on awardTagName (frontend or via additional query param) for the SpecialActivity filtered view
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 11.3 Add "特殊活动" filter option and column to reports in `packages/frontend/src/pages/admin/reports.tsx`
    - Append `'SpecialActivity'` to the `targetRole` filter options
    - Add `earnTotalSpecialActivity` column to the user ranking table view
    - _Requirements: 10.8, 10.9_

  - [ ]* 11.4 Write unit tests for leaderboard/batch-history/reports integration
    - Test files: extend existing tests in `packages/frontend/src/pages/leaderboard/`, `pages/admin/batch-history.test.tsx`, `pages/admin/reports.test.tsx`
    - Cover: SpecialActivity tab visible in leaderboard, batch-history filter sends correct param, reports column renders earnTotalSpecialActivity
    - _Requirements: 10.7, 10.9, 12.3_

- [x] 12. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` from repo root to verify no TypeScript errors across `packages/shared`, `packages/backend`, `packages/frontend`, `packages/cdk`
  - Run `npm test` to verify all unit and property tests pass
  - Verify CDK Batch 1 (GSI + AwardTags table) is documented in deployment notes; do not deploy from agent — instruct user to deploy CDK Batch 1 first, then Lambda + frontend in Batch 2 (per design.md "部署节奏")
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (P1–P10) from `design.md`; unit tests cover specific examples and edge cases
- **Deployment order is critical**: CDK Batch 1 (Tasks 1.1–1.3, the new Users GSI + AwardTags table) MUST deploy and the Users GSI MUST reach `ACTIVE` state before Batch 2 (Lambda code). The agent should NOT trigger CDK deploy; the user runs `cdk deploy` manually
- The new `executeSpecialActivityDistribution` is **deliberately separate** from `executeBatchDistribution` — it writes only `points / earnTotal / earnTotalSpecialActivity` and never touches `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer`
- AwardTag `usageCount` upsert occurs **before** the main TransactWrite (not inside it). If the main transaction fails after upsert, usageCount is over-counted by 1 — accepted as eventual-consistency tradeoff (see design.md Error Handling §3)
- Dedup uses `(activityId, awardTagName, userId)` triple via FilterExpression on the existing `createdAt-index` GSI. SuperAdmin operations are infrequent enough that the GSI eventual-consistency window (<1s) is acceptable
- AwardTags table is fully isolated from ContentTags table — no shared API, no shared GSI
- All 5 i18n locales (zh / en / zh-TW / ja / ko) must be updated together to keep `i18n.property.test.ts` passing
- `validateAwardTagName` and `normalizeTagName` should live in `packages/shared/` so frontend pre-validation matches backend exactly

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "8.1"] },
    { "id": 3, "tasks": ["3.4", "3.5", "4.1", "8.2", "8.3"] },
    { "id": 4, "tasks": ["4.2", "7.1", "7.3"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "5.1", "5.2", "7.2", "7.4"] },
    { "id": 6, "tasks": ["5.3", "5.4", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "11.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["10.1", "10.2", "11.4"] }
  ]
}
```
