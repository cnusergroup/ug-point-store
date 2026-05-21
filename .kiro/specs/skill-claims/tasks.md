# Implementation Plan: Skill Claims（技能分发放）

## Overview

在现有批量发放（batch-points）系统上扩展"技能分"能力。按层级从底向上实现：CDK 新表定义与权限 → 后端技能分服务模块（验证、查询、事务构建）→ 扩展 batch-points 与 batch-points-adjust → 新增 API 路由 → 前端批量发放页技能图标交互 → 前端调整页技能锁管理 → PointsRuleConfig 配置扩展 → i18n 5 语言支持。使用 DynamoDB `ConditionExpression: attribute_not_exists(activityId)` 实现技能锁互斥，所有技能分写入合并到现有 `TransactWriteCommand` 保证原子性。

## Tasks

- [x] 1. CDK infrastructure: new table and permissions
  - [x] 1.1 Define `PointsMall-ActivitySkillClaims` DynamoDB table in CDK DatabaseStack
    - Add table with PK = `activityId` (String), SK = `skill` (String)
    - Use `PAY_PER_REQUEST` billing mode
    - Follow existing table naming pattern
    - _Requirements: 2.1, 2.3_

  - [x] 1.2 Grant Admin Lambda read/write access and inject environment variable
    - Grant `readWriteData` permission on the new table to Admin Lambda
    - Add environment variable `ACTIVITY_SKILL_CLAIMS_TABLE` with table name
    - Register `GET /api/admin/skill-claims` route in API Gateway (integrated to Admin Lambda)
    - Ensure CORS preflight support for the new route
    - _Requirements: 2.4, 2.5, 15.1, 15.3, 15.4, 15.5_

- [x] 2. Backend: Skill Claims service module
  - [x] 2.1 Create `packages/backend/src/admin/skill-claims.ts` with types and validation
    - Define `SkillType = 'liveSupport' | 'promoWriting'`
    - Define `SkillClaimInput` interface: `{ skill: SkillType; userId: string }`
    - Define `SkillClaimRecord` interface with all fields: `activityId`, `skill`, `userId`, `userNickname`, `claimedAt`, `claimedBy`, `distributionId`, `pointsAwarded`
    - Implement `validateSkillClaimsInput(skillClaims, targetRole, userIds?)` function:
      - Return `DUPLICATE_SKILL_IN_REQUEST` if same skill appears twice
      - Return `INVALID_SKILL_TYPE` if skill not in allowed values
      - Return `SKILL_NOT_ALLOWED_FOR_ROLE` if targetRole !== 'UserGroupLeader' and skillClaims non-empty
    - _Requirements: 2.2, 2.6, 7.1, 7.3, 7.4, 7.7_

  - [x] 2.2 Implement `getSkillClaimsForActivity` query function
    - Query `PointsMall-ActivitySkillClaims` table with PK = activityId
    - Return array of `SkillClaimRecord` (empty array if none found)
    - _Requirements: 6.1, 6.4, 6.5_

  - [x] 2.3 Implement `buildSkillClaimTransactItems` function
    - Build `Put` items for each skill claim with `ConditionExpression: attribute_not_exists(activityId)`
    - Include all required fields: `activityId`, `skill`, `userId`, `userNickname`, `claimedAt` (ISO 8601), `claimedBy`, `distributionId`, `pointsAwarded` (from PointsRuleConfig snapshot)
    - _Requirements: 9.1, 9.3_

  - [ ]* 2.4 Write property test: Property 1 — Mutex (技能锁全局唯一性)
    - **Property 1: Mutex — 技能锁全局唯一性**
    - Generate random activityId + multiple concurrent claim attempts for same (activityId, skill)
    - Verify that buildSkillClaimTransactItems produces ConditionExpression that enforces at most 1 record per (activityId, skill)
    - **Validates: Requirements 16.1, 9.1**

  - [ ]* 2.5 Write property test: Property 6 — Role Restriction (角色限制)
    - **Property 6: Role Restriction — 角色限制**
    - Generate random non-UGL targetRole + non-empty skillClaims
    - Verify validateSkillClaimsInput returns `SKILL_NOT_ALLOWED_FOR_ROLE` and no state changes
    - **Validates: Requirements 16.6, 7.7**

- [x] 3. Backend: Extend PointsRuleConfig with skill points fields
  - [x] 3.1 Add `liveSupportPoints` and `promoWritingPoints` to PointsRuleConfig in `packages/backend/src/settings/feature-toggles.ts`
    - Add fields with default value 30
    - Implement validation: must be positive integer (>= 1)
    - Implement fallback: if field missing on read, return default 30 independently per field
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 3.2 Write property test: Property 8 — Config Snapshot Invariant (配置快照不变量)
    - **Property 8: Config Snapshot Invariant — 配置快照不变量**
    - Generate random PointsRuleConfig values, simulate claim creation, then modify config
    - Verify pointsAwarded in SkillClaimRecord equals the config value at write time, unchanged after config update
    - **Validates: Requirements 16.8**

- [x] 4. Checkpoint - Ensure skill-claims module and config tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Backend: Extend batch-points with skill claims support
  - [x] 5.1 Extend `BatchDistributionInput` in `packages/backend/src/admin/batch-points.ts`
    - Add optional `skillClaims?: SkillClaimInput[]` field
    - Import types from `skill-claims.ts`
    - _Requirements: 7.1_

  - [x] 5.2 Implement skill claims processing in `executeBatchDistribution`
    - Call `validateSkillClaimsInput` early; return error if invalid
    - Validate each userId in skillClaims: must exist, be active, have UGL role → `INVALID_REQUEST`
    - Allow skillClaims userId not in userIds (only-skill scenario) → no error
    - Skip skill processing if skillClaims is empty/undefined (preserve existing behavior)
    - _Requirements: 7.2, 7.5, 7.6, 7.8, 8.5_

  - [x] 5.3 Implement merged points calculation and PointsRecord generation
    - For each unique user across userIds ∪ skillClaims.userIds:
      - Calculate activityPoints (if in userIds)
      - Calculate skillPoints (sum of applicable skill config values if in skillClaims)
      - Total = activityPoints + skillPoints
    - Generate single merged PointsRecord per user with correct `source` format:
      - Only activity: `"批量发放:UserGroupLeader|{ugName}|{topic}|{date}"`
      - Only skill: `"批量发放:技能:liveSupport+promoWriting|{ugName}|{topic}|{date}"`
      - Both: `"批量发放:UserGroupLeader+技能:liveSupport|{ugName}|{topic}|{date}"`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 5.4 Merge skill claim transact items into TransactWriteCommand
    - Call `buildSkillClaimTransactItems` and append to existing transaction items
    - Check total operation count ≤ 100; return `BATCH_TOO_LARGE` if exceeded
    - Handle `ConditionalCheckFailedException` → re-read existing claim → return `SKILL_ALREADY_CLAIMED` with occupant nickname
    - Ensure atomicity: if any skill claim fails, entire transaction rolls back (no partial writes)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 5.5 Extend response and Distribution record
    - Return `distributionId`, `successCount` (deduplicated user count), `totalPoints`, `skillClaims` (written claims with skill/userId/userNickname/pointsAwarded), `totalSkillPoints`
    - Store `skillClaims` summary in Distribution record
    - `recipientIds` only includes userIds (activity participants), not only-skill users
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 5.6 Write property test: Property 2 — Points Conservation (积分守恒)
    - **Property 2: Points Conservation — 积分守恒**
    - Generate random userIds + skillClaims combinations with valid config
    - Verify sum of all Users.points increments equals (userIds.length × activityPoints) + (sum of skill points)
    - **Validates: Requirements 16.2, 10.5**

  - [ ]* 5.7 Write property test: Property 3 — Record Merge Invariant (合并记录不变量)
    - **Property 3: Record Merge Invariant — 合并记录不变量**
    - Generate random distribution scenarios (users in userIds only, skillClaims only, or both)
    - Verify exactly 1 PointsRecord per user and amount equals sum of applicable points
    - **Validates: Requirements 16.3, 10.1, 10.2, 10.3**

  - [ ]* 5.8 Write property test: Property 4 — Transaction Atomicity (技能认领原子性)
    - **Property 4: Transaction Atomicity — 技能认领原子性**
    - Generate requests with conflicting skill claims (pre-existing lock)
    - Verify outcome is either all-success or all-failure (no partial state)
    - **Validates: Requirements 16.4, 9.3, 9.4**

- [x] 6. Backend: Add skill-claims query route to admin handler
  - [x] 6.1 Add `GET /api/admin/skill-claims` route in `packages/backend/src/admin/handler.ts`
    - Parse `activityId` from query parameters
    - Verify caller has Admin or SuperAdmin role → `FORBIDDEN` if not
    - Return `INVALID_REQUEST` if activityId missing or empty
    - Call `getSkillClaimsForActivity` and return JSON array
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 6.2 Write unit tests for skill-claims query route
    - Test successful query returns array
    - Test empty activity returns empty array (not 404)
    - Test missing activityId returns INVALID_REQUEST
    - Test non-admin returns FORBIDDEN
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

- [x] 7. Backend: Extend batch-points-adjust with skill lock management
  - [x] 7.1 Extend `AdjustmentInput` in `packages/backend/src/admin/batch-points-adjust.ts`
    - Add optional `releaseSkills?: Array<{ skill: SkillType }>`
    - Add optional `addSkillClaims?: Array<{ skill: SkillType; userId: string }>`
    - Validate SuperAdmin role for these fields → `FORBIDDEN` if non-SuperAdmin
    - _Requirements: 12.2, 12.4, 12.8_

  - [x] 7.2 Implement `releaseSkills` logic in adjustment execution
    - Delete SkillClaim record from ActivitySkillClaims table
    - Write `type: 'adjust'` PointsRecord with negative amount = `-pointsAwarded`
    - Decrease user's `points`, `earnTotal`, `earnTotalLeader` by `pointsAwarded`
    - _Requirements: 12.3_

  - [x] 7.3 Implement `addSkillClaims` logic in adjustment execution
    - Put new SkillClaim with `attribute_not_exists(activityId)` condition
    - Write `type: 'adjust'` PointsRecord with positive amount from current config
    - Increase user's `points`, `earnTotal`, `earnTotalLeader`
    - Return `SKILL_ALREADY_CLAIMED` if condition fails, rollback entire transaction
    - _Requirements: 12.4, 12.5, 12.6_

  - [x] 7.4 Implement participant removal preserving skill claims
    - When removing participant X who has both activity + skill points in same distribution:
      - Only deduct activity points (distribution's `points` value)
      - Preserve SkillClaim record and skill points in user's balance
    - Execute releaseSkills before addSkillClaims in same transaction
    - _Requirements: 12.7, 12.9_

  - [ ]* 7.5 Write property test: Property 5 — Adjust Preserves Skill Claims (调整保留技能认领)
    - **Property 5: Adjust Preserves Skill Claims — 调整保留技能认领**
    - Generate adjustment scenarios removing participants with both activity + skill points
    - Verify SkillClaim record unchanged, Users.points decrease equals only activity points
    - **Validates: Requirements 16.5, 12.7**

  - [ ]* 7.6 Write property test: Property 7 — Lock Release Authority (释放权限与金额正确性)
    - **Property 7: Lock Release Authority — 释放权限与金额正确性**
    - Generate release scenarios with various pointsAwarded snapshot values
    - Verify deduction equals exactly pointsAwarded (not current config), and non-SuperAdmin is rejected
    - **Validates: Requirements 16.7, 12.3, 12.8**

- [x] 8. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Frontend: Skill icons in batch-points page
  - [x] 9.1 Implement skill icon rendering in batch-points UGL list
    - Render `video-camera` (liveSupport) and `pencil-square` (promoWriting) Heroicons SVG icons
    - Only render when `targetRole === 'UserGroupLeader'` AND activityId is selected
    - Only render for active UGL users
    - Position icons right of "目前积分" column, fixed 24×24 viewBox
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

  - [x] 9.2 Implement skill icon interaction states and mutex logic
    - Clickable state: normal color + cursor-pointer
    - Selected state: highlighted fill color
    - Occupied state: reduced opacity + cursor-not-allowed + i18n tooltip with occupant nickname
    - Frontend mutex: when one UGL selects a skill, disable that skill for all other UGL rows
    - Support selecting both skills for same UGL
    - Support selecting skill without selecting "参与活动" checkbox
    - _Requirements: 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.3 Fetch existing skill locks on page load
    - Call `GET /api/admin/skill-claims?activityId={activityId}` when activityId changes
    - Pre-mark occupied skills with occupant info (disable + tooltip)
    - _Requirements: 5.4, 5.5_

  - [x] 9.4 Include skillClaims in batch-points submission payload
    - Build `skillClaims` array from selected skill icons
    - Submit alongside existing `userIds` in POST request
    - Handle `SKILL_ALREADY_CLAIMED` error: refresh locks and show toast
    - Handle `BATCH_TOO_LARGE` error: show user-friendly message
    - _Requirements: 7.1, 9.2_

- [x] 10. Frontend: Adjust page skill lock management panel
  - [x] 10.1 Add "活动技能锁" panel to batch-adjust page
    - Display liveSupport / promoWriting current occupant nicknames (or "未占用")
    - Fetch skill locks via `GET /api/admin/skill-claims?activityId={activityId}`
    - Only visible to SuperAdmin
    - _Requirements: 13.1_

  - [x] 10.2 Implement "释放" (release) and "指派" (assign) interactions
    - "释放" button → confirmation dialog showing points to be deducted
    - "指派" button → UGL selector from full active UGL list
    - Include `releaseSkills` and `addSkillClaims` in adjust submission
    - Show diff summary with skill-related point changes
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

- [x] 11. Frontend: Distribution history skill claims display
  - [x] 11.1 Show skill claims detail in distribution history detail view
    - Display skill name, occupant nickname, points awarded for each claim
    - _Requirements: 11.4_

- [x] 12. Frontend: Settings page skill points configuration
  - [x] 12.1 Add `liveSupportPoints` and `promoWritingPoints` inputs to settings page
    - Number input fields in "积分规则配置" section
    - Use i18n translation keys for labels and help text
    - Validate positive integer on submit
    - _Requirements: 1.6, 14.4_

- [x] 13. i18n: Add translations for all 5 languages
  - [x] 13.1 Add skill-claims translation keys to `zh.ts`
    - Skill names: liveSupport (直播支持), promoWriting (宣传文案创作)
    - Skill icon tooltips, occupied tooltips with `{nickname}` placeholder
    - Batch-points success/error messages for skill scenarios
    - Adjust page: "活动技能锁" section, release/assign buttons, confirmation dialogs
    - Settings page: liveSupportPoints / promoWritingPoints labels and help text
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 13.2 Add skill-claims translation keys to `en.ts`
    - Same keys as 13.1 with English translations
    - _Requirements: 14.2_

  - [x] 13.3 Add skill-claims translation keys to `zh-TW.ts`
    - Same keys as 13.1 with Traditional Chinese translations
    - _Requirements: 14.2_

  - [x] 13.4 Add skill-claims translation keys to `ja.ts`
    - Same keys as 13.1 with Japanese translations
    - _Requirements: 14.2_

  - [x] 13.5 Add skill-claims translation keys to `ko.ts`
    - Same keys as 13.1 with Korean translations
    - _Requirements: 14.2_

- [x] 14. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check library
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementation follows existing project patterns
- DynamoDB `ConditionExpression: attribute_not_exists(activityId)` enforces skill lock mutex at the database level
- All skill claim writes are merged into existing `TransactWriteCommand` for atomicity (max 100 ops)
- `pointsAwarded` is a snapshot of config at write time — never retroactively updated
- `recipientIds` in Distribution record only tracks activity participants; only-skill users tracked via `skillClaims` field
- Adjustment page participant removal only deducts activity points; skill claims and skill points are preserved

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2"] },
    { "id": 2, "tasks": ["2.4", "2.5", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 4, "tasks": ["5.4", "5.5", "6.2"] },
    { "id": 5, "tasks": ["5.6", "5.7", "5.8", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["7.5", "7.6", "9.1", "13.1", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.1", "12.1"] },
    { "id": 9, "tasks": ["9.4", "10.2", "11.1"] }
  ]
}
```
