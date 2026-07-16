# Requirements Document

## Introduction

本功能扩展现有的批量发分调整系统（batch-points-adjust），使其能够处理特殊活动（SpecialActivity）和特殊奖励（SpecialReward）类型的发放记录。当前系统仅支持 UGL/Speaker/Volunteer 三种角色的调整，因为它依赖 PointsRuleConfig 按角色自动计算积分值。特殊活动和特殊奖励的积分金额为手动输入的自由值，不对应固定角色/分值规则，因此需要引入自由金额输入模式来支持调整。

扩展后，SuperAdmin 可在 batch-history 详情视图中对 targetRole 为 SpecialActivity 或 SpecialReward 的发放记录点击"调整"按钮，进入调整页面后自由修改积分金额、添加/移除参与者，并保持与现有调整功能一致的原子性、审计轨迹和确认对话框行为。

## Glossary

- **Adjustment_Service**: 后端调整模块，负责计算原始发放与调整请求之间的差异，并跨 DynamoDB 多表执行原子写入。现有实现位于 `packages/backend/src/admin/batch-points-adjust.ts`
- **Adjustment_UI**: 前端调整页面（`batch-adjust.tsx`），允许 SuperAdmin 修改发放记录的参与者和积分配置
- **Distribution_Record**: `PointsMall-BatchDistributions` 表中的发放记录，由 `distributionId` 标识
- **Points_Record**: `PointsMall-PointsRecords` 表中的积分变动记录，`type` 字段标识类型（`earn`/`spend`/`refund`/`adjust`）
- **User_Record**: `PointsMall-Users` 表中的用户记录，包含余额（`points`）、总获得（`earnTotal`）及各类型累计字段
- **SuperAdmin**: 拥有 SuperAdmin 角色的用户，是唯一被授权执行发放调整的角色
- **SpecialActivity**: targetRole 值为 `"SpecialActivity"` 的发放记录类型，积分累加到 `earnTotalSpecialActivity` 字段
- **SpecialReward**: targetRole 值为 `"SpecialReward"` 的发放记录类型，积分累加到 `earnTotalSpecialReward` 字段
- **Free_Amount_Mode**: 自由金额模式，调整特殊活动/特殊奖励记录时，积分金额由 SuperAdmin 手动输入而非从 PointsRuleConfig 自动计算
- **PointsRuleConfig**: 系统级积分规则配置，定义各角色/Speaker 类型的积分值，仅适用于 UGL/Speaker/Volunteer 角色
- **Correction_Record**: `type: 'adjust'` 的 Points_Record，用于记录积分调整审计轨迹（注：现有 batch-points-adjust 采用原地编辑 earn 记录的模式，不再写入 adjust 类型）
- **Diff_Summary**: 描述原始发放与调整请求之间变更的计算对象，包括添加/移除用户、积分差额等
- **Announcement_Feed**: 排行榜公告流，展示 earn 和 adjust 类型的积分记录，调整后应正确反映新积分值

## Requirements

### Requirement 1: 支持特殊活动和特殊奖励的 targetRole

**User Story:** 作为 SuperAdmin，我希望调整功能能接受 SpecialActivity 和 SpecialReward 作为 targetRole，以便我能调整这两种类型的发放记录。

#### Acceptance Criteria

1. WHEN SuperAdmin 提交一个 targetRole 为 `SpecialActivity` 的调整请求，THE Adjustment_Service SHALL 接受该请求并按特殊活动规则处理调整（使用自由金额而非 PointsRuleConfig 计算）
2. WHEN SuperAdmin 提交一个 targetRole 为 `SpecialReward` 的调整请求，THE Adjustment_Service SHALL 接受该请求并按特殊奖励规则处理调整（使用自由金额而非 PointsRuleConfig 计算）
3. THE Adjustment_Service SHALL 扩展 `AdjustmentInput` 接口的 `targetRole` 类型定义，使其包含 `'SpecialActivity'` 和 `'SpecialReward'` 两个新值
4. THE Adjustment_Service SHALL 扩展 `AdjustmentInput` 接口新增可选字段 `adjustedPoints`（正整数），用于在 Free_Amount_Mode 下指定调整后的每人积分金额

### Requirement 2: 自由金额输入模式

**User Story:** 作为 SuperAdmin，我希望在调整特殊活动或特殊奖励记录时能自由修改积分金额，因为这两种类型的积分不对应固定的角色分值规则。

#### Acceptance Criteria

1. WHILE targetRole 为 `SpecialActivity` 或 `SpecialReward`，THE Adjustment_UI SHALL 显示一个积分金额输入框，默认值为原始发放的 `points` 值，允许 SuperAdmin 输入新的正整数值
2. WHILE targetRole 为 `SpecialActivity` 或 `SpecialReward`，THE Adjustment_UI SHALL 隐藏角色选择 Tab 和 Speaker 类型选择器（因为这些选项不适用于特殊类型调整）
3. WHILE targetRole 为 `SpecialActivity` 或 `SpecialReward`，THE Adjustment_Service SHALL 使用请求中的 `adjustedPoints` 字段作为新的每人积分值，而非从 PointsRuleConfig 计算
4. IF targetRole 为 `SpecialActivity` 或 `SpecialReward` 且 `adjustedPoints` 缺失或不是正整数，THEN THE Adjustment_Service SHALL 返回错误码 `INVALID_REQUEST` 和消息"特殊类型调整必须提供有效的积分金额"
5. THE Adjustment_UI SHALL 对积分金额输入框进行校验，仅接受大于 0 的正整数

### Requirement 3: 特殊活动的 earnTotalSpecialActivity 字段调整

**User Story:** 作为 SuperAdmin，我希望调整特殊活动发放记录时系统正确更新 earnTotalSpecialActivity 字段，以保证排行榜和报表数据准确。

#### Acceptance Criteria

1. WHEN targetRole 为 `SpecialActivity` 且用户被移除，THE Adjustment_Service SHALL 将该用户的 `earnTotalSpecialActivity` 字段减少原始 `points` 值
2. WHEN targetRole 为 `SpecialActivity` 且用户被新增，THE Adjustment_Service SHALL 将该用户的 `earnTotalSpecialActivity` 字段增加新的 `adjustedPoints` 值
3. WHEN targetRole 为 `SpecialActivity` 且积分金额发生变化，THE Adjustment_Service SHALL 将保留用户的 `earnTotalSpecialActivity` 字段调整差额（`adjustedPoints - originalPoints`）
4. THE Adjustment_Service SHALL NOT 在 targetRole 为 `SpecialActivity` 时写入 `earnTotalSpeaker`、`earnTotalLeader`、`earnTotalVolunteer` 或 `earnTotalSpecialReward` 字段

### Requirement 4: 特殊奖励的 earnTotalSpecialReward 字段调整

**User Story:** 作为 SuperAdmin，我希望调整特殊奖励发放记录时系统正确更新 earnTotalSpecialReward 字段，以保证排行榜和报表数据准确。

#### Acceptance Criteria

1. WHEN targetRole 为 `SpecialReward` 且用户被移除，THE Adjustment_Service SHALL 将该用户的 `earnTotalSpecialReward` 字段减少原始 `points` 值
2. WHEN targetRole 为 `SpecialReward` 且用户被新增，THE Adjustment_Service SHALL 将该用户的 `earnTotalSpecialReward` 字段增加新的 `adjustedPoints` 值
3. WHEN targetRole 为 `SpecialReward` 且积分金额发生变化，THE Adjustment_Service SHALL 将保留用户的 `earnTotalSpecialReward` 字段调整差额（`adjustedPoints - originalPoints`）
4. THE Adjustment_Service SHALL NOT 在 targetRole 为 `SpecialReward` 时写入 `earnTotalSpeaker`、`earnTotalLeader`、`earnTotalVolunteer` 或 `earnTotalSpecialActivity` 字段

### Requirement 5: Diff 计算扩展

**User Story:** 作为系统，我需要在 Free_Amount_Mode 下正确计算调整差异，以确保所有用户的积分变动精确无误。

#### Acceptance Criteria

1. WHILE targetRole 为 `SpecialActivity` 或 `SpecialReward`，THE Adjustment_Service SHALL 使用 `adjustedPoints` 作为 `newPoints` 计算 Diff_Summary，而非调用 `calculateExpectedPoints`
2. FOR 被移除用户，THE Adjustment_Service SHALL 计算负向调整金额等于原始发放的 `points` 值（与现有逻辑一致）
3. FOR 被新增用户，THE Adjustment_Service SHALL 计算正向调整金额等于 `adjustedPoints` 值
4. FOR 保留用户且积分金额变化时，THE Adjustment_Service SHALL 计算差额为 `adjustedPoints - originalPoints`
5. WHEN adjustedPoints 等于原始 points 且参与者列表未变化，THE Adjustment_Service SHALL 返回错误码 `NO_CHANGES` 和消息"未检测到任何变更"

### Requirement 6: 原子性多表更新

**User Story:** 作为 SuperAdmin，我希望特殊类型的调整与现有角色调整保持相同的原子性保证，不会出现部分更新。

#### Acceptance Criteria

1. THE Adjustment_Service SHALL 使用 DynamoDB `TransactWriteCommand` 原子更新 User_Record（`points`、`earnTotal`、对应的角色累计字段）和编辑原始 earn 记录
2. WHEN 受影响用户数超过 25（TransactWriteItems 每批次上限），THE Adjustment_Service SHALL 将操作拆分为多个事务批次
3. IF 任一事务批次执行失败，THEN THE Adjustment_Service SHALL 返回错误码 `ADJUSTMENT_FAILED` 和描述性消息
4. THE Adjustment_Service SHALL 在所有用户级事务批次成功后更新 Distribution_Record

### Requirement 7: earn 记录原地编辑

**User Story:** 作为系统，我需要在调整时正确编辑原始 earn 记录，以保持与现有调整逻辑一致的审计方式。

#### Acceptance Criteria

1. FOR 被移除用户，THE Adjustment_Service SHALL 删除（DELETE）该用户的原始 earn PointsRecord（通过 source 前缀匹配定位：SpecialActivity 使用 `特殊活动:` 前缀，SpecialReward 使用 `特殊奖励:` 前缀）
2. FOR 被新增用户，THE Adjustment_Service SHALL 插入（PUT）一条新的 earn PointsRecord，amount 为 `adjustedPoints`，source 格式与原始发放保持一致
3. FOR 保留用户且积分金额变化时，THE Adjustment_Service SHALL 更新（UPDATE）原始 earn PointsRecord 的 `amount` 字段为 `adjustedPoints`
4. THE Adjustment_Service SHALL 保持 earn 记录的 `targetRole`、`activityId`、`activityUG`、`activityTopic`、`activityDate`、`awardTagId`、`awardTagName`（或 `rewardTagId`、`rewardTagName`）等关联字段不变

### Requirement 8: Distribution Record 更新

**User Story:** 作为 SuperAdmin，我希望调整后的发放记录反映最新状态，以便 batch-history 视图展示准确数据。

#### Acceptance Criteria

1. THE Adjustment_Service SHALL 更新 Distribution_Record 的 `recipientIds` 为新的用户 ID 集合
2. THE Adjustment_Service SHALL 更新 `recipientDetails` 包含所有新参与者的 nickname 和 email
3. THE Adjustment_Service SHALL 更新 `points`（每人积分）为 `adjustedPoints` 值
4. THE Adjustment_Service SHALL 重新计算并更新 `successCount` 和 `totalPoints`
5. THE Adjustment_Service SHALL 添加 `adjustedAt` 时间戳和 `adjustedBy`（SuperAdmin userId）到 Distribution_Record
6. THE Adjustment_Service SHALL 保持 Distribution_Record 的 `targetRole`、`activityId`、`activityType`、`awardTagId`/`awardTagName`（或 `rewardTagId`/`rewardTagName`）等字段不变

### Requirement 9: 前端调整入口与路由

**User Story:** 作为 SuperAdmin，我希望在 batch-history 详情视图中能对特殊活动和特殊奖励类型的发放记录点击"调整"按钮进入调整页面。

#### Acceptance Criteria

1. WHEN 当前用户是 SuperAdmin 且发放记录的 targetRole 为 `SpecialActivity`，THE batch-history 详情视图 SHALL 显示"调整"按钮
2. WHEN 当前用户是 SuperAdmin 且发放记录的 targetRole 为 `SpecialReward`，THE batch-history 详情视图 SHALL 显示"调整"按钮
3. WHEN SuperAdmin 点击 SpecialActivity 或 SpecialReward 记录的"调整"按钮，THE Adjustment_UI SHALL 导航至 `batch-adjust` 页面并携带 `distributionId` 参数
4. WHEN Adjustment_UI 加载一个 targetRole 为 `SpecialActivity` 或 `SpecialReward` 的 Distribution_Record，THE Adjustment_UI SHALL 进入 Free_Amount_Mode 显示模式

### Requirement 10: 前端调整表单适配

**User Story:** 作为 SuperAdmin，我希望调整页面能根据发放记录类型自适应显示不同的表单控件，以便我能正确操作。

#### Acceptance Criteria

1. WHILE 调整的 targetRole 为 `SpecialActivity` 或 `SpecialReward`，THE Adjustment_UI SHALL 以只读方式显示 targetRole 标签（如"特殊活动"或"特殊奖励"），不允许修改
2. WHILE 调整的 targetRole 为 `SpecialActivity`，THE Adjustment_UI SHALL 以只读方式显示关联的 awardTag 名称
3. WHILE 调整的 targetRole 为 `SpecialReward`，THE Adjustment_UI SHALL 以只读方式显示关联的 rewardTag 名称
4. THE Adjustment_UI SHALL 显示 Diff_Summary，包含新增用户数、移除用户数、原始每人积分、新每人积分（若变化）和总积分变动量

### Requirement 11: 确认对话框

**User Story:** 作为 SuperAdmin，我希望在提交特殊类型调整前看到清晰的变更摘要确认，以避免误操作。

#### Acceptance Criteria

1. WHEN SuperAdmin 点击提交按钮，THE Adjustment_UI SHALL 显示确认对话框，展示 Diff_Summary 信息
2. THE 确认对话框 SHALL 显示：新增用户数、移除用户数、原始每人积分、新每人积分、总积分变动量
3. WHEN SuperAdmin 确认对话框，THE Adjustment_UI SHALL 发送调整请求到 Adjustment_Service
4. WHEN SuperAdmin 取消对话框，THE Adjustment_UI SHALL 关闭对话框且不执行任何变更
5. WHEN 调整的 recipientIds 为空（删除模式），THE Adjustment_UI SHALL 显示与标准调整不同的删除确认对话框消息

### Requirement 12: 删除模式支持

**User Story:** 作为 SuperAdmin，我希望对特殊活动和特殊奖励记录也支持通过移除所有参与者来删除整条发放记录。

#### Acceptance Criteria

1. WHEN 调整请求的 recipientIds 为空且 targetRole 为 `SpecialActivity`，THE Adjustment_Service SHALL 执行删除流程：反转所有用户的 `points`、`earnTotal`、`earnTotalSpecialActivity`，写入 Correction_Record，并硬删除 Distribution_Record
2. WHEN 调整请求的 recipientIds 为空且 targetRole 为 `SpecialReward`，THE Adjustment_Service SHALL 执行删除流程：反转所有用户的 `points`、`earnTotal`、`earnTotalSpecialReward`，写入 Correction_Record，并硬删除 Distribution_Record
3. IF 删除流程中任一用户的 `points` 余额不足以扣减，THEN THE Adjustment_Service SHALL 在执行任何写入前返回错误码 `INSUFFICIENT_BALANCE`
4. WHEN 删除成功，THE Adjustment_Service SHALL 返回 `{ deleted: true, distributionId, reversedCount }`

### Requirement 13: 公告展示正确性

**User Story:** 作为用户，我希望排行榜公告流中能正确展示调整后的特殊活动/特殊奖励积分值，以反映最新的积分状态。

#### Acceptance Criteria

1. WHEN 特殊活动或特殊奖励的 earn 记录被调整（金额更新），THE Announcement_Feed SHALL 展示调整后的积分 amount 值
2. WHEN 特殊活动或特殊奖励的 earn 记录被删除（用户被移除），THE Announcement_Feed SHALL 不再展示该条记录（因记录已物理删除）
3. WHEN 用户被新增到特殊活动或特殊奖励发放中，THE Announcement_Feed SHALL 展示新创建的 earn 记录及其正确的积分 amount

### Requirement 14: 输入验证

**User Story:** 作为系统，我需要在执行调整前验证所有请求参数，以确保无效请求被尽早拒绝。

#### Acceptance Criteria

1. IF targetRole 为 `SpecialActivity` 或 `SpecialReward` 且 recipientIds 非空且 adjustedPoints 缺失或不是正整数，THEN THE Adjustment_Service SHALL 返回错误码 `INVALID_REQUEST`
2. IF targetRole 为 `SpecialActivity` 或 `SpecialReward` 且 recipientIds 非空且 adjustedPoints 等于原始 points 且参与者列表与原始相同，THEN THE Adjustment_Service SHALL 返回错误码 `NO_CHANGES`
3. IF 调整会导致任何用户的 `points` 余额变为负数，THEN THE Adjustment_Service SHALL 在执行任何写入前返回错误码 `INSUFFICIENT_BALANCE`
4. WHEN recipientIds 为空（删除模式），THE Adjustment_Service SHALL 跳过 adjustedPoints 校验和 NO_CHANGES 校验，直接进入删除流程
5. IF 调整请求的 targetRole 不是 `UserGroupLeader`、`Speaker`、`Volunteer`、`SpecialActivity`、`SpecialReward` 之一，THEN THE Adjustment_Service SHALL 返回错误码 `INVALID_REQUEST`

### Requirement 15: 向后兼容性

**User Story:** 作为系统管理员，我希望新的调整功能不影响现有 UGL/Speaker/Volunteer 类型的调整行为。

#### Acceptance Criteria

1. THE Adjustment_Service SHALL 保持现有 UGL/Speaker/Volunteer 调整的全部逻辑不变，包括从 PointsRuleConfig 自动计算积分、角色选择、Speaker 类型切换和技能锁操作
2. WHEN targetRole 为 `UserGroupLeader`、`Speaker` 或 `Volunteer`，THE Adjustment_Service SHALL 忽略 `adjustedPoints` 字段（即使请求中提供了该字段）
3. THE Adjustment_UI SHALL 在 targetRole 为 UGL/Speaker/Volunteer 时保持现有的角色 Tab 和 Speaker 类型选择器行为不变
4. THE 现有的调整 API 端点 `POST /api/admin/batch-points/{distributionId}/adjust` SHALL 保持不变，通过扩展支持新的 targetRole 值
