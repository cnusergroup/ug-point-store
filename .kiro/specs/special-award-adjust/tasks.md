# Implementation Plan: 特殊活动/特殊奖励发放记录调整 (Special Award Adjust)

## Overview

扩展现有 `batch-points-adjust` 模块，使其支持 `SpecialActivity` 和 `SpecialReward` 类型发放记录的调整。核心变化是引入 Free Amount Mode（自由金额模式）：特殊类型调整时，积分金额由 SuperAdmin 手动指定 `adjustedPoints`，而非从 PointsRuleConfig 自动计算。

实现顺序：后端接口扩展 → 验证逻辑 → diff 计算 → roleFieldMap + buildBaseEarnSource → earn 记录操作 → Distribution_Record 更新 → executeDeletion 扩展 → 属性测试 → 前端入口 → 前端 Free Amount Mode UI → 确认对话框 → i18n → SCSS。

## Tasks

- [x] 1. Backend: AdjustmentInput 接口扩展与验证逻辑
  - [x] 1.1 扩展 `AdjustmentInput` 接口并新增 validation 逻辑
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 中扩展 `AdjustmentInput` 的 `targetRole` 类型定义，添加 `'SpecialActivity' | 'SpecialReward'`
    - 新增可选字段 `adjustedPoints?: number`
    - 在 `validateAdjustmentInput` 中新增：targetRole 有效性校验（VALID_TARGET_ROLES Set）
    - 新增特殊类型 adjustedPoints 校验：当 targetRole 为 SpecialActivity/SpecialReward 且 recipientIds 非空时，adjustedPoints 必须为正整数，否则返回 `INVALID_REQUEST`
    - 新增特殊类型 NO_CHANGES 检测：adjustedPoints === original.points 且 recipientIds 相同时返回 `NO_CHANGES`
    - 删除模式（recipientIds 为空）时跳过 adjustedPoints 和 NO_CHANGES 校验
    - _Requirements: 1.3, 1.4, 2.4, 5.5, 14.1, 14.2, 14.4, 14.5_

  - [ ]* 1.2 Write property test: 无效 adjustedPoints 拒绝且零副作用
    - **Property 6: 无效 adjustedPoints 拒绝且零副作用**
    - 生成 targetRole ∈ {SpecialActivity, SpecialReward}，recipientIds 非空，adjustedPoints 为缺失/0/负数/浮点数的随机输入 → 必须返回 INVALID_REQUEST
    - Create file `packages/backend/src/admin/batch-points-adjust-special.property.test.ts`
    - **Validates: Requirements 2.4, 14.1**

  - [ ]* 1.3 Write property test: 特殊类型 NO_CHANGES 检测
    - **Property 7: 特殊类型的 NO_CHANGES 检测**
    - 生成 adjustedPoints === original.points 且 recipientIds 完全相同的输入 → 必须返回 NO_CHANGES
    - **Validates: Requirements 5.5, 14.2**

  - [ ]* 1.4 Write property test: 删除模式跳过 adjustedPoints 校验
    - **Property 10: 删除模式跳过 adjustedPoints 和 NO_CHANGES 校验**
    - 生成 recipientIds 为空、adjustedPoints 为任意值（含缺失/0/负数）的输入 → 必须返回 `{ valid: true, isDeletion: true }`
    - **Validates: Requirements 14.4**

- [x] 2. Backend: computeAdjustmentDiff Free Amount Mode
  - [x] 2.1 实现 `computeAdjustmentDiff` 的 Free Amount Mode 分支
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 的 `computeAdjustmentDiff` 函数中添加分支：
    - 当 `targetRole === 'SpecialActivity' || targetRole === 'SpecialReward'` 时，`newPoints = input.adjustedPoints!`（已在 validate 中确保）
    - 否则继续使用 `calculateExpectedPoints(targetRole, speakerType, config)`
    - 确保 diff 中 removed 用户 delta = -originalPoints，added 用户 delta = +newPoints，retained 用户 delta = newPoints - originalPoints
    - _Requirements: 2.3, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 2.2 Write property test: Free Amount Mode 使用 adjustedPoints 作为 newPoints
    - **Property 1: Free Amount Mode 使用 adjustedPoints 作为 newPoints**
    - 生成特殊类型输入和任意 PointsRuleConfig → computeAdjustmentDiff 返回的 newPoints 必须等于 input.adjustedPoints
    - **Validates: Requirements 1.1, 1.2, 2.3, 5.1**

  - [ ]* 2.3 Write property test: Diff 差额计算正确性
    - **Property 2: Diff 差额计算正确性**
    - 生成任意 original（points=P）和 input（adjustedPoints=Q），验证 removed delta=-P，added delta=+Q，retained delta=Q-P
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [ ]* 2.4 Write property test: 向后兼容 — 传统角色忽略 adjustedPoints
    - **Property 12: 向后兼容 — 传统角色忽略 adjustedPoints**
    - 生成 targetRole ∈ {UGL, Speaker, Volunteer} 的输入（附带随机 adjustedPoints）→ newPoints 必须等于 calculateExpectedPoints 的结果
    - **Validates: Requirements 15.1, 15.2**

- [x] 3. Backend: roleFieldMap + buildBaseEarnSource 扩展
  - [x] 3.1 扩展 `roleFieldMap` 和 `buildBaseEarnSource`
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 中扩展 `roleFieldMap`：
      - `SpecialActivity: 'earnTotalSpecialActivity'`
      - `SpecialReward: 'earnTotalSpecialReward'`
    - 实现/扩展 `buildBaseEarnSource` 函数：
      - SpecialActivity: `特殊活动:{topic}|{ug}|{awardDate}|{tagName}`
      - SpecialReward: `特殊奖励:{tagName}|{awardDate}`
    - 确保 executeAdjustment 和 executeDeletion 均使用扩展后的 roleFieldMap
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3_

  - [ ]* 3.2 Write property test: 角色累计字段隔离与增量精确
    - **Property 3: 角色累计字段隔离与增量精确**
    - Mock DDB 执行特殊类型调整 → SpecialActivity 仅变动 earnTotalSpecialActivity，SpecialReward 仅变动 earnTotalSpecialReward，其余四个角色字段不变
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4**

- [x] 4. Backend: Earn 记录操作（add/update/delete for special types）
  - [x] 4.1 实现特殊类型的 earn 记录 add/update/delete 操作
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 的 executeAdjustment 中：
    - **删除（移除用户）**：通过 `buildBaseEarnSource` 定位原始 earn 记录并 DELETE
    - **新增（添加用户）**：PUT 新 earn 记录，amount = adjustedPoints，source 使用 buildBaseEarnSource 格式，携带关联字段（SpecialActivity: awardTagId/awardTagName；SpecialReward: rewardTagId/rewardTagName）
    - **更新（保留用户金额变化）**：UPDATE earn 记录的 amount 为 adjustedPoints，其余字段不变（targetRole、activityId、activityUG、activityTopic、activityDate、tag 字段）
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 4.2 Write property test: Earn 记录原地编辑正确性
    - **Property 4: Earn 记录原地编辑正确性**
    - Mock 执行特殊类型调整 → 验证 removed 用户 earn 被 DELETE、added 用户获得正确 PUT、retained 用户 earn amount 被 UPDATE
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 5. Backend: Distribution_Record 更新
  - [x] 5.1 实现特殊类型调整后的 Distribution_Record 更新逻辑
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 中：
    - 更新 `recipientIds` 为新用户集合
    - 更新 `recipientDetails` 包含所有新参与者 nickname 和 email
    - 更新 `points` 为 `adjustedPoints`（Free Amount Mode）
    - 重新计算 `successCount = recipientIds.length`、`totalPoints = successCount × adjustedPoints`
    - 添加 `adjustedAt` 时间戳和 `adjustedBy`（SuperAdmin userId）
    - 保持 `targetRole`、`activityId`、`activityType`、`awardTagId/awardTagName` 或 `rewardTagId/rewardTagName` 不变
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 5.2 Write property test: Distribution_Record 更新正确性
    - **Property 5: Distribution_Record 更新正确性**
    - Mock 执行特殊类型调整 → 验证 recipientIds、points=adjustedPoints、successCount、totalPoints、adjustedAt/adjustedBy 正确，targetRole 和 tag 字段不变
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**

- [x] 6. Backend: executeDeletion 扩展
  - [x] 6.1 扩展 `executeDeletion` 支持特殊类型删除
    - 在 `packages/backend/src/admin/batch-points-adjust.ts` 中：
    - 确保 `executeDeletion` 使用扩展后的 `roleFieldMap` 正确映射 SpecialActivity → earnTotalSpecialActivity、SpecialReward → earnTotalSpecialReward
    - Correction record source 格式：`发放删除:SpecialActivity|{ug}|{topic}|{date}` / `发放删除:SpecialReward|{ug}|{topic}|{date}`
    - 余额预检：若任一用户 points < originalPoints 则返回 INSUFFICIENT_BALANCE
    - 删除成功返回 `{ deleted: true, distributionId, reversedCount }`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 6.2 Write property test: 特殊类型删除模式反转正确角色字段
    - **Property 8: 特殊类型删除模式反转正确的角色字段**
    - Mock 特殊类型删除 → SpecialActivity 反转 points/earnTotal/earnTotalSpecialActivity，SpecialReward 反转 points/earnTotal/earnTotalSpecialReward，其余字段不变
    - **Validates: Requirements 12.1, 12.2, 12.4**

  - [ ]* 6.3 Write property test: 余额预检在写入前拒绝
    - **Property 9: 余额预检在写入前拒绝**
    - 生成至少一个用户余额不足的场景 → 返回 INSUFFICIENT_BALANCE 且零 TransactWriteCommand 发送
    - **Validates: Requirements 12.3, 14.3**

  - [ ]* 6.4 Write property test: 事务批次不超过 25 项
    - **Property 11: 事务批次不超过 25 项**
    - 生成 1~50 个用户的调整 → 验证所有 TransactWriteCommand 批次 ≤ 25 items
    - **Validates: Requirements 6.2**

- [x] 7. Checkpoint - 后端逻辑完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Frontend: batch-history 调整按钮可见性
  - [x] 8.1 更新 `packages/frontend/src/pages/admin/batch-history.tsx` 调整按钮可见性
    - 在发放详情视图中，当 `targetRole` 为 `SpecialActivity` 或 `SpecialReward` 且当前用户是 SuperAdmin 时显示"调整"按钮
    - 点击按钮导航至 `batch-adjust` 页面并携带 `distributionId` 参数
    - 与现有 UGL/Speaker/Volunteer 的调整按钮逻辑保持一致
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 9. Frontend: batch-adjust Free Amount Mode UI
  - [x] 9.1 实现 `packages/frontend/src/pages/admin/batch-adjust.tsx` 的 Free Amount Mode
    - 添加 `isFreeAmountMode` 计算：`originalRecord?.targetRole === 'SpecialActivity' || 'SpecialReward'`
    - 添加 `adjustedPoints` state，初始化为 `originalRecord.points`
    - Free Amount Mode 下隐藏角色选择 Tab 和 Speaker 类型选择器
    - 显示只读 targetRole 标签（"特殊活动"/"特殊奖励"）
    - 显示只读关联 Tag 名称（SpecialActivity: awardTagName，SpecialReward: rewardTagName）
    - 显示积分金额输入框，校验仅接受 > 0 的正整数
    - Diff Summary 展示：新增用户数、移除用户数、原始每人积分、新每人积分、总积分变动量
    - 提交请求体附加 `adjustedPoints` 字段，省略 `speakerType`
    - _Requirements: 2.1, 2.2, 2.5, 9.4, 10.1, 10.2, 10.3, 10.4_

- [x] 10. Frontend: 确认对话框
  - [x] 10.1 实现特殊类型调整的确认对话框
    - 在 `packages/frontend/src/pages/admin/batch-adjust.tsx` 中：
    - 点击提交按钮时显示确认对话框，展示 Diff_Summary（新增用户数、移除用户数、原始每人积分、新每人积分、总积分变动量）
    - 确认后发送调整请求，取消则关闭对话框
    - 当 recipientIds 为空（删除模式）时显示与调整模式不同的删除确认对话框消息
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 11. i18n: 添加特殊类型调整相关翻译键
  - [x] 11.1 添加翻译键到所有 5 个语言文件
    - Files: `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Keys to add under `batchPoints.adjust`:
      - `specialActivityLabel`: 特殊活动标签
      - `specialRewardLabel`: 特殊奖励标签
      - `adjustedPointsLabel`: 调整后积分输入框标签
      - `adjustedPointsPlaceholder`: 输入框占位文本
      - `adjustedPointsError`: 无效积分金额错误提示
      - `freeAmountDiffOriginal`: 原始每人积分
      - `freeAmountDiffNew`: 新每人积分
      - `freeAmountDiffTotal`: 总积分变动量
      - `specialAdjustConfirmTitle`: 特殊类型调整确认标题
      - `specialAdjustConfirmMessage`: 确认消息
      - `specialDeleteConfirmTitle`: 特殊类型删除确认标题
      - `specialDeleteConfirmMessage`: 删除确认消息
    - _Requirements: 2.1, 10.1, 10.2, 10.3, 11.1, 11.2, 11.5_

- [x] 12. SCSS: 添加 Free Amount Mode 样式
  - [x] 12.1 添加样式到 `packages/frontend/src/pages/admin/batch-adjust.scss`
    - 添加 `.ba-free-amount` 容器样式（积分输入框区域）
    - 添加 `.ba-free-amount__input` 输入框样式（含 invalid 状态使用 `--error` 色彩变量）
    - 添加 `.ba-free-amount__label` 只读标签样式（targetRole + tag 名称）
    - 添加 `.ba-diff-special` 差异摘要区域样式（展示积分变动信息）
    - 确保与现有调整页面视觉风格一致
    - _Requirements: 2.1, 2.5, 10.1, 10.4_

- [x] 13. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (12 properties)
- All property tests go in a single file: `packages/backend/src/admin/batch-points-adjust-special.property.test.ts`
- i18n covers 5 languages: zh, en, zh-TW, ja, ko
- 现有 UGL/Speaker/Volunteer 调整逻辑不受影响（Requirements 15）
- Transaction batching: 每批次最多 12 用户（2 items/user = 24 ≤ 25）
- 公告展示正确性（Requirement 13）由 earn 记录的正确性（Property 4）隐式保证，无需额外实现

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "8.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["10.1", "11.1"] },
    { "id": 9, "tasks": ["12.1"] }
  ]
}
```
