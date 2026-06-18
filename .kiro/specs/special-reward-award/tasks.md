# Implementation Plan: Special Reward Award (特殊奖励颁发)

## Overview

实现 SuperAdmin 向特定活动获奖者发放"特殊奖励积分"的独立通道。新增**全新且完全独立的积分类型** `earnTotalSpecialReward`，通过独立 `executeSpecialRewardDistribution` 函数发放（既不复用 `executeBatchDistribution`，也不复用 `executeSpecialActivityDistribution`，与身份分及特殊活动积分严格隔离），并新建独立 `PointsMall-RewardTags` 元数据表（与 ContentTags / AwardTags 完全隔离），配套排行榜 / 报表 / 历史扩展。

按层级从底向上实现：CDK 基础设施（先于业务代码部署）→ shared types 扩展 → backend reward-tags CRUD → backend executeSpecialRewardDistribution → backend handler 路由 + 邮件 → backend ranking / reports 扩展 → frontend RewardTagPicker 组件 → frontend special-reward-award 页面 → frontend dashboard 卡片 + leaderboard / batch-history / reports 扩展 → i18n（5 语言）→ SCSS 样式。使用 DynamoDB `TransactWriteCommand` 保证发放原子性；RewardTag usageCount 在主事务前以独立 upsert 完成（最终一致折衷已在 design.md 记录）。

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. CDK infrastructure changes (Batch 1 - deploy before code)
  - [x] 1.1 Add `earnTotalSpecialReward-index` GSI to Users table in `packages/cdk/lib/database-stack.ts`
    - In the Users table definition block, append `addGlobalSecondaryIndex` with `indexName: 'earnTotalSpecialReward-index'`, partitionKey `pk: STRING`, sortKey `earnTotalSpecialReward: NUMBER`, projection ALL
    - Ensure this is the ONLY new GSI added to the Users table in this deployment batch (DynamoDB CFN constraint)
    - _Requirements: 10.1, 10.2_

  - [x] 1.2 Create `PointsMall-RewardTags` table with `tagName-index` GSI in `packages/cdk/lib/database-stack.ts`
    - Define `rewardTagsTable` (mirror `awardTagsTable` structure): partitionKey `tagId: STRING`, `BillingMode.PAY_PER_REQUEST`, `RemovalPolicy.DESTROY`
    - Add GSI `tagName-index` with partitionKey `tagName: STRING`, projection ALL
    - Add `CfnOutput` for `RewardTagsTableName` and `RewardTagsTableArn`
    - Export `rewardTagsTable` so LambdaStack can reference it
    - _Requirements: 10.3, 10.4, 14.1, 14.2_

  - [x] 1.3 Wire `rewardTagsTable` permissions and env vars in `packages/cdk/lib/lambda-stack.ts`
    - Pass `rewardTagsTable` from DatabaseStack into LambdaStack via constructor props
    - On the admin Lambda, call `rewardTagsTable.grantReadWriteData(adminLambda)`
    - Inject env var `REWARD_TAGS_TABLE: rewardTagsTable.tableName`
    - Verify admin Lambda has Users table read/write + Query permission on the new `earnTotalSpecialReward-index` (the existing Users index ARN grant should already cover it)
    - _Requirements: 10.1, 10.3, 14.3_

  - [ ]* 1.4 Add CDK synth snapshot assertions
    - Test file: `packages/cdk/test/database-stack.test.ts` (extend if exists, otherwise create)
    - Assert `PointsMall-Users` table contains a GSI named `earnTotalSpecialReward-index`
    - Assert `PointsMall-RewardTags` table exists with `tagName-index` GSI
    - _Requirements: 10.1, 10.3, 14.1, 14.2_

- [x] 2. Extend shared types for SpecialReward targetRole and RewardTag fields
  - [x] 2.1 Update `DistributionRecord`, `PointsRecord`, `UserRankingRecord` and add `RewardTag` type in `packages/shared/src/types.ts`
    - Extend `DistributionRecord.targetRole` union to include `'SpecialReward'`
    - Add optional fields `rewardTagId?: string`, `rewardTagName?: string`, `rewardTagDisplayName?: string` to `DistributionRecord`
    - Extend `PointsRecord.targetRole` union (or field) to include `'SpecialReward'` and add `rewardTagId?: string`, `rewardTagName?: string`
    - Add new exported interface `RewardTag` with fields: `tagId: string`, `tagName: string`, `displayName: string`, `usageCount: number`, `createdAt: string`, `updatedAt: string`, `createdBy: string`
    - Extend `UserRankingRecord` with optional `earnTotalSpecialReward?: number`
    - Reuse the shared tag constants (forbidden chars `` <>"'/\|*?:& `` and max length 30) already introduced by special-activity-award; do NOT duplicate them
    - _Requirements: 6.7, 6.8, 7.4, 7.5, 7.6, 14.1, 10.10_

- [x] 3. Backend RewardTag normalization, validation, and CRUD module
  - [x] 3.1 Create `packages/backend/src/admin/reward-tags.ts` reusing shared normalize/validate pure functions
    - Reuse `normalizeTagName` and `validateAwardTagName` (rename to a shared `validateTagName` if already exported from `packages/shared/`) — normalization rule: trim, collapse whitespace runs to single space, toLowerCase; validation: normalized length in [1, 30], no forbidden chars `` <>"'/\|*?:& ``, only Chinese/English/digits/spaces
    - Storage is fully isolated: this module operates ONLY on `PointsMall-RewardTags` (env `REWARD_TAGS_TABLE`), never touches `PointsMall-AwardTags` or `PointsMall-ContentTags`
    - Export a thin `validateRewardTagName` wrapper for clarity (delegating to the shared rule)
    - _Requirements: 3.7, 3.8, 3.9, 6.15, 6.16, 14.9, 14.10_

  - [ ]* 3.2 Write property test for RewardTag name validation (Property 1) and normalization (Property 2)
    - Test file: `packages/backend/src/admin/reward-tags-validate.property.test.ts`
    - **Property 1: RewardTag name validation completeness**
    - **Validates: Requirements 3.7, 3.8, 3.9, 6.15, 6.16, 14.10**
    - **Property 2: normalizeTagName idempotency + displayName immutability**
    - **Validates: Requirements 3.10, 6.9, 14.9, 14.11**
    - Use fast-check; include comment header `// Feature: special-reward-award, Property 1/2: ...`

  - [x] 3.3 Implement RewardTag CRUD functions in `packages/backend/src/admin/reward-tags.ts`
    - `searchRewardTags(prefix, limit, ddb, table)` — normalize prefix, query `tagName-index` with `begins_with(tagName, :p)`, sort by `usageCount` desc in-memory, cap limit at 50 / default 10 / clamp out-of-range to nearest boundary; return `[]` for empty normalized prefix
    - `getHotRewardTags(ddb, table)` — Scan/Query sorted by `usageCount` desc, take top **20** (note: 20, not AwardTags' 10 — Requirement 14.13)
    - `createRewardTag({ displayName, createdBy }, ddb, table)` — normalize to tagName, query `tagName-index` to check existence, return `{ code: 'TAG_ALREADY_EXISTS' }` if exists; else `PutCommand` with `ConditionExpression: attribute_not_exists(tagId)`, `tagId = ulid()`, `usageCount = 0`, `displayName` = original input (preserve case/whitespace, max 30)
    - `deleteRewardTag(tagId, ddb, table)` — `DeleteCommand` with `ConditionExpression: attribute_exists(tagId) AND usageCount = :zero`; map `ConditionalCheckFailed` to `TAG_IN_USE`, missing item to `TAG_NOT_FOUND`
    - `upsertRewardTagUsage(displayName, createdBy, ddb, table)` — query `tagName-index`; if exists `UpdateCommand ADD usageCount :one SET updatedAt = :now`; else `PutCommand` with `ConditionExpression: attribute_not_exists(tagId)`, `usageCount = 1`. Returns `{ tagId, tagName, displayName }`
    - Use `ulid` for new tagIds; reuse existing dynamoClient utilities
    - _Requirements: 6.10, 14.5, 14.6, 14.7, 14.8, 14.11, 14.12, 14.13, 14.14_

  - [ ]* 3.4 Write property test for RewardTag upsert and delete behavior (Properties 8 and 9)
    - Test file: `packages/backend/src/admin/reward-tags.property.test.ts`
    - **Property 8: RewardTag upsert usageCount counting and uniqueness**
    - **Validates: Requirements 6.10, 14.5, 14.6, 14.14**
    - **Property 9: RewardTag delete restriction**
    - **Validates: Requirements 14.7, 14.8**
    - Use in-memory mock DDB pattern (see `packages/backend/src/admin/batch-points.property.test.ts`)

  - [ ]* 3.5 Write unit tests for RewardTag CRUD edge cases
    - Test file: `packages/backend/src/admin/reward-tags.test.ts`
    - Cover: empty prefix returns `[]`, hot returns top 20 by usageCount, limit clamps out-of-range to nearest boundary, create rejects duplicate with 409 code, delete rejects when usageCount > 0 (TAG_IN_USE), delete returns TAG_NOT_FOUND for missing tagId
    - _Requirements: 14.12, 14.13, 14.14, 14.7, 14.8_

- [x] 4. Backend executeSpecialRewardDistribution module
  - [x] 4.1 Create `packages/backend/src/admin/special-reward-award.ts` with input validation and dedup query
    - Define `SpecialRewardAwardInput` interface: `activityId: string`, `points: number`, `rewardTagName: string` (raw user input), `userIds: string[]`, `awardDate: string` (YYYY-MM-DD), `distributorId`, `distributorNickname`
    - Define `SpecialRewardAwardResult` interface: `success`, `distributionId?`, `successCount?`, `totalPoints?`, `rewardTagId?`, `rewardTagName?`, `error?: { code, message, duplicateUserIds? }`
    - Implement `validateSpecialRewardInput(input)`: rejects empty `userIds` (`INVALID_REQUEST` "userIds 必须为非空数组"), non-positive-integer `points` ("points 必须为正整数"), missing/empty `rewardTagName` ("rewardTagName 必填"), invalid `rewardTagName` (delegate to `validateRewardTagName` → length / forbidden chars messages), invalid `awardDate` regex `/^\d{4}-\d{2}-\d{2}$/`
    - Implement `getRewardedUserIdsByTag(activityId, rewardTagName, ddb, distributionsTable)` — query `BatchDistributions` `createdAt-index` with `FilterExpression: activityId = :aid AND rewardTagName = :tag AND targetRole = :role`, role literal `'SpecialReward'`; flatten and return Set of rewarded userIds across all matched distributions
    - _Requirements: 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 8.1_

  - [x] 4.2 Implement `executeSpecialRewardDistribution` orchestration in the same file
    - Step 1: validate input via `validateSpecialRewardInput`; return error on failure (BEFORE any write, including RewardTags upsert — Requirement 6.17)
    - Step 2: `GetCommand` Activities table by `activityId`; return `ACTIVITY_NOT_FOUND` ("关联活动不存在") if missing
    - Step 3: normalize `rewardTagName`; call `upsertRewardTagUsage(displayName=input.rewardTagName, createdBy=distributorId)` to get `{ tagId, tagName }`
    - Step 4: call `getRewardedUserIdsByTag(activityId, normalizedTagName)`, intersect with `input.userIds`; if any overlap return `DUPLICATE_REWARD_TAG_DISTRIBUTION` ("以下用户已在此活动的该奖励标签下获得过特殊奖励积分") with full `duplicateUserIds[]`, and perform NO writes to Users/PointsRecords/BatchDistributions
    - Step 5: pre-flight transaction size check: if `userIds.length * 2 > 100` return `BATCH_TOO_LARGE`
    - Step 6: build `TransactWriteCommand` items:
      - For each userId: `Update Users` with `SET points = if_not_exists(points, :zero) + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, earnTotalSpecialReward = if_not_exists(earnTotalSpecialReward, :zero) + :pv, pk = if_not_exists(pk, :ALL)`
      - For each userId: `Put PointsRecords` with `recordId = ulid()`, `userId`, `type: 'earn'`, `amount: points`, `targetRole: 'SpecialReward'`, `rewardTagId`, `rewardTagName: normalizedTagName`, `source: '特殊奖励:' + topic + '|' + ug + '|' + awardDate + '|' + normalizedTagName`, `activityId`, `createdAt: now`
    - Step 7: execute transaction; on failure log `CancellationReasons` and return `INTERNAL_ERROR`
    - Step 8: `PutCommand` BatchDistributions with full DistributionRecord (`distributionId = ulid()`, `targetRole: 'SpecialReward'`, `activityType: '特殊奖励'`, `rewardTagId`, `rewardTagName: normalizedTagName`, `rewardTagDisplayName: input.rewardTagName`, `successCount`, `totalPoints`, NO `speakerType`, NO `awardTagId / awardTagName` fields)
    - Return `{ success: true, distributionId, successCount, totalPoints, rewardTagId, rewardTagName }`
    - **Important**: do NOT write `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer / earnTotalSpecialActivity`; do NOT call `executeBatchDistribution` or `executeSpecialActivityDistribution`; do NOT read/write `PointsMall-AwardTags`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.18, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.3, 8.4, 8.5, 9.1, 9.2, 16.2_

  - [ ]* 4.3 Write property test for distribution field isolation and increments (Property 5)
    - Test file: `packages/backend/src/admin/special-reward-award.property.test.ts`
    - **Property 5: executeSpecialRewardDistribution writes only points/earnTotal/earnTotalSpecialReward with exact increments; isolates other point types**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6, 7.1, 7.2, 9.1, 9.2, 16.2**
    - Generate random Users with random pre-existing `earnTotalSpeaker/Leader/Volunteer/SpecialActivity` values, run on in-memory mock DDB; assert `points`, `earnTotal`, `earnTotalSpecialReward` increase by P; assert the four isolation fields unchanged (including missing case)

  - [ ]* 4.4 Write property test for record field contract (Property 6)
    - Test file: `packages/backend/src/admin/special-reward-award.property.test.ts`
    - **Property 6: PointsRecord/DistributionRecord field contract**
    - **Validates: Requirements 6.4, 6.5, 6.7, 6.8, 6.9, 7.3, 7.4, 7.5, 7.6**

  - [ ]* 4.5 Write property test for dedup tuple semantics (Property 7)
    - Test file: `packages/backend/src/admin/special-reward-award.property.test.ts`
    - **Property 7: dedup granularity is (activityId, rewardTagName, userId) triple**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5**

  - [ ]* 4.6 Write property test for invalid input rejection (Property 10)
    - Test file: `packages/backend/src/admin/special-reward-award.property.test.ts`
    - **Property 10: invalid input rejection with zero side effects**
    - **Validates: Requirements 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17**

  - [ ]* 4.7 Write unit tests for executeSpecialRewardDistribution happy path and error branches
    - Test file: `packages/backend/src/admin/special-reward-award.test.ts`
    - Cover: success path, ACTIVITY_NOT_FOUND, DUPLICATE_REWARD_TAG_DISTRIBUTION, BATCH_TOO_LARGE, TransactionCanceled → INTERNAL_ERROR
    - _Requirements: 6.11, 6.18, 8.1, 8.5_

- [x] 5. Wire backend HTTP routes in admin handler
  - [x] 5.1 Add reward-tags routes to `packages/backend/src/admin/handler.ts`
    - `GET /api/admin/reward-tags?prefix=...&limit=10` (SuperAdmin only) → `searchRewardTags`
    - `GET /api/admin/reward-tags/hot` (SuperAdmin only) → `getHotRewardTags`
    - `POST /api/admin/reward-tags` (SuperAdmin only) body `{ displayName }` → `createRewardTag`; map `TAG_ALREADY_EXISTS` to HTTP 409
    - `DELETE /api/admin/reward-tags/{tagId}` (SuperAdmin only) → `deleteRewardTag`; map `TAG_IN_USE` to 400, `TAG_NOT_FOUND` to 404
    - Add regex constant `REWARD_TAG_BY_ID_REGEX = /^\/api\/admin\/reward-tags\/([^/]+)$/`
    - Non-SuperAdmin → 403 `FORBIDDEN`; missing/invalid credentials → 401 `UNAUTHORIZED`
    - _Requirements: 1.3, 1.4, 14.3, 14.4_

  - [x] 5.2 Add `POST /api/admin/special-reward-award` route in `packages/backend/src/admin/handler.ts`
    - SuperAdmin gate; non-SuperAdmin → 403 `FORBIDDEN` message `'需要超级管理员权限'`; missing/invalid credentials → 401 `UNAUTHORIZED`
    - Parse body `{ activityId, points, rewardTagName, userIds, awardDate }`
    - Call `executeSpecialRewardDistribution` with `distributorId = event.user.userId` and `distributorNickname = event.user.nickname`
    - On success: HTTP 201 `{ distributionId, successCount, totalPoints, rewardTagId, rewardTagName }`, then send emails (see 5.3)
    - On error: map `INVALID_REQUEST → 400`, `ACTIVITY_NOT_FOUND → 400`, `DUPLICATE_REWARD_TAG_DISTRIBUTION → 400` with `duplicateUserIds`, `BATCH_TOO_LARGE → 400`, `INTERNAL_ERROR → 500`
    - _Requirements: 1.3, 1.4, 13.2_

  - [x] 5.3 Send `points_earned` emails best-effort after successful distribution (in handler.ts)
    - After `executeSpecialRewardDistribution` returns success, iterate unique `userIds`
    - For each user: `GetCommand` Users table with `ProjectionExpression: 'points'` to read post-distribution balance; call `sendPointsEarnedEmail(notificationCtx, userId, points, '特殊奖励', currentBalance)`
    - Wrap each iteration in try/catch — log error but do not throw; do not block 201 response
    - Mirror the pattern used by special-activity-award / `handleQuarterlyAward`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 5.4 Write unit tests for handler routing
    - Test file: `packages/backend/src/admin/handler.test.ts` (extend existing)
    - Test SuperAdmin succeeds on POST /special-reward-award; Admin/regular user → 403; missing credentials → 401; non-existent route still returns 404
    - Test reward-tags GET/POST/DELETE routing matrix (SuperAdmin only → 403 for others)
    - _Requirements: 1.3, 1.4, 13.2, 14.3, 14.4_

- [x] 6. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Backend leaderboard and reports extensions
  - [x] 7.1 Extend `ROLE_GSI_MAP` and `VALID_ROLES` in `packages/backend/src/leaderboard/ranking.ts`
    - Add `'SpecialReward'` to `VALID_ROLES` const tuple
    - Add `SpecialReward: { indexName: 'earnTotalSpecialReward-index', sortKeyField: 'earnTotalSpecialReward' }` to `ROLE_GSI_MAP`
    - Update role-eligibility logic so `role === 'SpecialReward'` does NOT require Speaker/UGL/Volunteer membership — any user appearing on the GSI is eligible (mirror `SpecialActivity`)
    - If the GSI query fails or index not ACTIVE, return an explicit error response (not an empty leaderboard) and do not affect other ranking dimensions
    - _Requirements: 10.5, 10.6, 10.7, 10.11_

  - [ ]* 7.2 Write unit tests for SpecialReward ranking branch
    - Test file: `packages/backend/src/leaderboard/ranking.test.ts` (extend if exists)
    - Test query uses `earnTotalSpecialReward-index` and `earnTotalSpecialReward` field; non-Speaker/UGL/Volunteer users still returned; GSI query error returns explicit error response
    - _Requirements: 10.5, 10.6, 10.7, 10.11_

  - [x] 7.3 Extend reports query/export to support `targetRole='SpecialReward'` and earnTotalSpecialReward column
    - In `packages/backend/src/reports/query.ts`: add `'SpecialReward'` to `targetRole` whitelist; existing FilterExpression on `targetRole` picks up records automatically; treat missing `earnTotalSpecialReward` as 0
    - In `packages/backend/src/reports/export.ts`: append `'特殊奖励积分'` column mapped to `earnTotalSpecialReward` field; update `formatUserRankingForExport` (or equivalent)
    - _Requirements: 10.9, 10.10, 16.3_

  - [ ]* 7.4 Write unit tests for reports extension
    - Test files: `packages/backend/src/reports/query.test.ts` and `packages/backend/src/reports/export.test.ts`
    - Test `targetRole='SpecialReward'` filter; test export includes "特殊奖励积分" header and value; missing field exported as 0
    - _Requirements: 10.9, 10.10, 16.3_

- [x] 8. Frontend RewardTagPicker component
  - [x] 8.1 Create `packages/frontend/src/components/RewardTagPicker/index.tsx`
    - Props: `value: string`, `onChange: (displayName: string) => void`, `disabled?: boolean`
    - Internal state: input text, dropdown open, suggestions list, loading
    - Empty input on focus → call `GET /api/admin/reward-tags/hot` for default suggestions
    - Non-empty input → debounce 300ms then `GET /api/admin/reward-tags?prefix={input}&limit=10`
    - When input does not match any returned tag exactly, append `+ 新建 "{rawInput}"` row at the end of the dropdown
    - Click suggestion or `+ 新建` row → `onChange(displayName)` and close dropdown
    - Inline validation: call shared `validateRewardTagName`/`validateTagName` (reuse pure helpers from `packages/shared/`) — show red error text on invalid input
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12_

  - [x] 8.2 Create `packages/frontend/src/components/RewardTagPicker/index.scss`
    - Style dropdown panel, list items, active/hover states; use only design system CSS variables (`--space-*`, `--radius-*`, `--text-*`, `--bg-*`, `--accent-primary`)
    - Add `cursor: pointer` on suggestion rows; smooth `transition: background-color 200ms`; no layout-shifting transforms on hover; ensure light/dark border + text contrast
    - _Requirements: 3.4_

  - [ ]* 8.3 Write component unit tests for RewardTagPicker
    - Test file: `packages/frontend/src/components/RewardTagPicker/index.test.tsx`
    - Cover: empty input shows hot tags, prefix search hits, no-match shows `+ 新建` option, invalid input shows error, onChange invoked with correct value
    - _Requirements: 3.4, 3.5, 3.6_

- [x] 9. Frontend special-reward-award page
  - [x] 9.1 Create `packages/frontend/src/pages/admin/special-reward-award.tsx`
    - SuperAdmin gate: redirect to `/pages/admin/index` if not SuperAdmin; redirect to login if unauthenticated (render guard before any form content)
    - Page layout (mirror `special-activity-award.tsx`): PageToolbar, Form Card "发放配置" (ActivityPicker with list sorted by activityDate desc + theme fuzzy search, date Picker default today, points Input number positive-int only, RewardTagPicker), User Selection Card with search + select-all + paginated list (`GET /api/admin/users?pageSize=50&lastKey=...`, frontend `status === 'active'` filter, "加载更多" pagination), live selected-count, Footer with Submit + ConfirmModal
    - Implement pure helper `filterUsersBySearch(users, q)` (case-insensitive match on nickname or email; empty query returns original list preserving order)
    - Implement pure helper `canSubmit(state)` — combinator over `(selectedActivity, points, rewardTagName, userIds, awardDate)` returning boolean
    - Implement pure helper `sortActivitiesByDateDesc(activities)` — stable non-ascending sort by `activityDate`, returns a permutation of input
    - When activity + tag both selected, mark already-rewarded users (derive from dedup query path keyed by `(activityId, rewardTagName)`)
    - Confirm modal shows: activity name, awardDate, count, perPersonPoints, totalPoints, rewardTagName; "确认发放" → POST; while pending disable button + show "发放中..."; success toast with successCount + totalPoints; on 400 `DUPLICATE_REWARD_TAG_DISTRIBUTION` highlight `duplicateUserIds` + toast; "取消" closes without submitting
    - Submit handler: `POST /api/admin/special-reward-award` with `{ activityId, points, rewardTagName, userIds, awardDate }`; client-side refuse submit when `userIds.length > 50` (BATCH_TOO_LARGE pre-check)
    - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.2_

  - [x] 9.2 Create `packages/frontend/src/pages/admin/special-reward-award.config.ts`
    - Export page config with `navigationBarTitleText: '特殊奖励积分颁发'` (or i18n equivalent)
    - _Requirements: 13.1_

  - [x] 9.3 Create `packages/frontend/src/pages/admin/special-reward-award.scss`
    - Mirror `special-activity-award.scss`; use only design system CSS variables (`--space-*`, `--radius-*`, `--text-*`)
    - Style cards, lists, footer, ConfirmModal, "已发放" badge for rewarded users; `cursor: pointer` on clickable rows; light/dark borders + contrast per workspace UX rules
    - _Requirements: 2.1, 4.1_

  - [x] 9.4 Register page route in `packages/frontend/src/app.config.ts`
    - Append `'pages/admin/special-reward-award'` to the `pages` array
    - _Requirements: 13.1_

  - [ ]* 9.5 Write property test for filterUsersBySearch contains semantic (Property 3)
    - Test file: `packages/frontend/src/pages/admin/special-reward-award.users-filter.property.test.ts`
    - **Property 3: filterUsersBySearch contains semantic**
    - **Validates: Requirements 4.2**

  - [ ]* 9.6 Write property test for canSubmit gating equivalence (Property 4)
    - Test file: `packages/frontend/src/pages/admin/special-reward-award.canSubmit.property.test.tsx`
    - **Property 4: canSubmit equivalent to required-fields conjunction**
    - **Validates: Requirements 2.4, 3.1, 3.11, 3.12, 4.5**

  - [ ]* 9.7 Write property test for activity descending sort (Property 11)
    - Test file: `packages/frontend/src/pages/admin/special-reward-award.activity-sort.property.test.tsx`
    - **Property 11: activity list sorted by date descending (permutation preserving)**
    - **Validates: Requirements 2.2**

- [x] 10. Wire admin dashboard card and i18n keys
  - [x] 10.1 Add SpecialReward card to `packages/frontend/src/pages/admin/index.tsx`
    - Append entry to `ADMIN_LINKS`: `key: 'special-reward-award'`, `category: 'operations'`, `icon: TrophyIcon` (trophy/medal SVG, distinct from special-activity card's GiftIcon — NOT emoji per workspace UX rules), `titleKey: 'admin.dashboard.specialRewardAwardTitle'`, `descKey: 'admin.dashboard.specialRewardAwardDesc'`, `url: '/pages/admin/special-reward-award'`, `superAdminOnly: true`
    - _Requirements: 13.3, 13.4, 13.5_

  - [x] 10.2 Add i18n keys to all 5 locale files
    - Add `admin.dashboard.specialRewardAwardTitle` and `admin.dashboard.specialRewardAwardDesc` to `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Add `leaderboard.roleSpecialReward` (e.g. zh: '特殊奖励', en: 'Special Reward', etc.)
    - Add page-specific keys: form labels (活动 / 日期 / 积分 / 奖励标签 / 用户), confirm modal labels, error messages (`DUPLICATE_REWARD_TAG_DISTRIBUTION`, `ACTIVITY_NOT_FOUND`, `INVALID_REQUEST`, `TAG_IN_USE`, `TAG_ALREADY_EXISTS`, `TAG_NOT_FOUND`, `BATCH_TOO_LARGE`, `FORBIDDEN`, `UNAUTHORIZED`)
    - Add RewardTagPicker labels: 输入奖励标签 / 新建 "%s" / 暂无热门标签 / 奖励标签长度必须为 1~30 个字符 / 奖励标签包含非法字符
    - Keep key set identical across all 5 files to pass existing `i18n.property.test.ts`
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 11. Frontend leaderboard, batch-history, and reports integration
  - [x] 11.1 Add SpecialReward Tab to leaderboard in `packages/frontend/src/pages/leaderboard/index.tsx`
    - Extend `RoleFilter` type union to include `'SpecialReward'`
    - Append `{ value: 'SpecialReward', labelKey: 'leaderboard.roleSpecialReward' }` to `ROLE_TABS`
    - Ensure existing tab switching logic accommodates the new role (reuses `?role=` query param); existing identity + SpecialActivity tabs unchanged
    - _Requirements: 10.8, 16.4_

  - [x] 11.2 Add "特殊奖励" filter to batch-history in `packages/frontend/src/pages/admin/batch-history.tsx`
    - SuperAdmin gate: redirect non-SuperAdmin to admin home
    - Add an `'特殊奖励'` entry to the activityType filter dropdown; send `activityType=特殊奖励` (or `targetRole=SpecialReward`) to existing `GET /api/admin/batch-points/history` (verify param forwarding; if not supported, extend `listDistributionHistory` to accept optional filter)
    - List columns: 发放时间 / 关联活动(主题+UG+日期) / 发放人数 / 合计积分 / 操作人 / 奖励 Tag (`rewardTagDisplayName`); descending by time; reuse pageSize+lastKey pagination
    - Secondary filter on `rewardTagName`; detail view reuses `GET /api/admin/batch-points/history/{distributionId}` showing rewarded user list + reward Tag
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 11.3 Add "特殊奖励" filter option and column to reports in `packages/frontend/src/pages/admin/reports.tsx`
    - Append `'SpecialReward'` to the `targetRole` filter options
    - Add `earnTotalSpecialReward` column to the user ranking table view
    - _Requirements: 10.9, 10.10_

  - [ ]* 11.4 Write unit tests for leaderboard/batch-history/reports integration
    - Test files: extend existing tests in `packages/frontend/src/pages/leaderboard/`, `pages/admin/batch-history.test.tsx`, `pages/admin/reports.test.tsx`
    - Cover: SpecialReward tab visible in leaderboard; batch-history filter sends correct param + redirects non-SuperAdmin; reports column renders earnTotalSpecialReward
    - _Requirements: 10.8, 10.9, 12.2, 12.3_

- [x] 12. Final checkpoint - Ensure all tests pass, build succeeds, and backward compatibility holds
  - Run `npm run build` from repo root to verify no TypeScript errors across `packages/shared`, `packages/backend`, `packages/frontend`, `packages/cdk`
  - Run `npm test` to verify all unit and property tests pass, including existing special-activity-award / identity-points suites (confirm no regression — Requirements 16.1, 16.4, 16.5)
  - Confirm special-reward flow never reads/writes `earnTotalSpecialActivity` or `PointsMall-AwardTags` (Requirement 16.2)
  - Verify CDK Batch 1 (GSI + RewardTags table) is documented in deployment notes; do NOT deploy from agent — instruct user to deploy CDK Batch 1 first (wait for Users GSI ACTIVE), then Lambda + frontend in Batch 2 (per design.md "部署节奏")
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements (granular sub-requirement numbers) for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (P1–P11) from `design.md`; unit tests cover specific examples and edge cases
- **Deployment order is critical**: CDK Batch 1 (Tasks 1.1–1.3, the new Users `earnTotalSpecialReward-index` GSI + `PointsMall-RewardTags` table) MUST deploy and the Users GSI MUST reach `ACTIVE` before Batch 2 (Lambda code). The agent should NOT trigger CDK deploy; the user runs `cdk deploy` manually
- The new `executeSpecialRewardDistribution` is **deliberately separate** from both `executeBatchDistribution` and `executeSpecialActivityDistribution` — it writes only `points / earnTotal / earnTotalSpecialReward` and never touches `earnTotalSpeaker / earnTotalLeader / earnTotalVolunteer / earnTotalSpecialActivity`
- RewardTag `usageCount` upsert occurs **before** the main TransactWrite (not inside it). If the main transaction fails after upsert, usageCount is over-counted by 1 — accepted as eventual-consistency tradeoff (see design.md Error Handling §3)
- Dedup uses `(activityId, rewardTagName, userId)` triple via FilterExpression on the existing `createdAt-index` GSI. SuperAdmin operations are infrequent enough that the GSI eventual-consistency window (<1s) is acceptable
- `PointsMall-RewardTags` table is fully isolated from `PointsMall-AwardTags` and `PointsMall-ContentTags` — no shared records, key space, API, or GSI
- `getHotRewardTags` returns up to **20** tags (Requirement 14.13), differing from AwardTags' 10
- Normalize/validate pure functions are reused from `packages/shared/` so frontend pre-validation matches backend exactly (rules identical to AwardTags; storage isolated)
- All 5 i18n locales (zh / en / zh-TW / ja / ko) must be updated together to keep `i18n.property.test.ts` passing

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
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "11.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["10.1", "10.2", "11.4"] }
  ]
}
```
