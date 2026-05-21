# Requirements Document

需求文档：技能分发放（Skill Claims）

## Introduction

在管理员"批量发放积分"页面上扩展能力：当本次发放的目标角色为 UserGroupLeader（UGL）时，允许管理员对每位 UGL 单独勾选其在该活动中提供的"技能贡献"，并据此发放额外的"技能分"。

技能分独立于活动分：一位 UGL 即便没有参加这场活动（左侧"参与"复选框未勾选），只要管理员在该 UGL 行勾选了某项技能图标，系统也会单独发放对应的技能分；同时也支持"既发活动分，又发技能分"。

每场活动（按 `activityId`，跨多次发放全局唯一）中，每种技能（`liveSupport` / `promoWriting`）只能被 1 位 UGL 占用一次。技能锁通过 DynamoDB ConditionExpression 强制互斥。SuperAdmin 可在批量发放调整页（batch-adjust）释放或重新分配某场活动的技能锁。技能分数额由 SuperAdmin 在控制中心的积分规则配置中维护（默认 30/30，必须为正整数）。

## Glossary

- **Skill（技能）**：UGL 在一场社区活动中可贡献的两类支持。本功能仅识别两个值：
  - **liveSupport（直播支持）**：在活动直播过程中提供技术或主持支持
  - **promoWriting（宣传文案创作）**：为活动撰写宣传/推广文案
- **Skill_Claim（技能认领）**：一条记录"某活动的某技能由某 UGL 提供"的数据条目，存储在 `PointsMall-ActivitySkillClaims` 表中
- **Skill_Lock（技能锁）**：每场活动每种技能最多 1 条 Skill_Claim 的全局唯一约束，按 `(activityId, skill)` 复合键加锁
- **Skill_Points（技能分）**：因技能贡献而发放的积分，独立于活动参与积分（活动分）
- **Activity_Points（活动分）**：UGL 因参加活动而获得的常规积分，由 `pointsRuleConfig.uglPointsPerEvent` 决定
- **UGL（UserGroupLeader）**：用户角色之一，是技能分功能唯一适用的目标角色
- **Activity（活动）**：由 `activityId` 唯一标识的一场社区活动；同一场活动可存在多次批量发放（多个 `distributionId`）
- **Distribution（一次发放）**：管理员一次提交"批量发放"操作产生的记录，由 `distributionId` 唯一标识
- **Skill_Service（技能分服务）**：后端处理技能认领写入、查询、释放的逻辑模块（位于 `batch-points.ts` 与 `batch-points-adjust.ts` 中的技能相关代码路径）
- **Skill_API（技能分接口）**：服务于前端的 HTTP 接口集合：
  - `POST /api/admin/batch-points`（扩展，接受 `skillClaims` 字段）
  - `GET /api/admin/skill-claims?activityId={activityId}`（查询某活动当前所有技能锁）
  - `POST /api/admin/batch-points/{distributionId}/adjust`（扩展，支持调整技能锁）
- **Skill_UI（技能分界面）**：批量发放页与批量调整页中与技能勾选、技能图标、占用提示相关的前端组件
- **Skill_Icon（技能图标）**：使用 Heroicons SVG 渲染的两个图标（`video-camera` 表示 liveSupport，`pencil-square` 表示 promoWriting），位于每行 UGL 列表项最右侧、紧邻"目前积分"列
- **Skill_Lock_Owner（技能锁占用者）**：当前已认领某活动某技能的 UGL，其 `userId`、`userNickname`、`claimedAt`、`claimedBy`、`distributionId`、`pointsAwarded` 被记录在 Skill_Claim 中
- **PointsRuleConfig**：`feature-toggles` 设置中的积分规则配置对象，扩展后包含 `liveSupportPoints` 和 `promoWritingPoints` 两个新字段（默认值 30，必须为正整数）
- **SuperAdmin**：唯一可在批量调整页面释放或重新分配技能锁的角色
- **Distributor（发放人）**：拥有 Admin 或 SuperAdmin 角色、执行批量发放的管理员
- **ActivitySkillClaims_Table**：DynamoDB 表 `PointsMall-ActivitySkillClaims`，PK = `activityId`、SK = `skill`

## Requirements

### Requirement 1: 技能积分配置项

**User Story:** 作为 SuperAdmin，我希望在控制中心的"积分规则配置"中维护技能分数额，以便在不重新部署的情况下调整发放金额。

#### Acceptance Criteria

1. THE PointsRuleConfig SHALL 新增两个字段：`liveSupportPoints`（直播支持技能分）和 `promoWritingPoints`（宣传文案创作技能分）
2. THE PointsRuleConfig SHALL 将 `liveSupportPoints` 默认值定义为 30，`promoWritingPoints` 默认值定义为 30
3. WHEN SuperAdmin 在设置页提交 `liveSupportPoints` 或 `promoWritingPoints`, THE Settings_Service SHALL 验证字段值为正整数（>= 1）
4. IF `liveSupportPoints` 或 `promoWritingPoints` 不是正整数或小于 1, THEN THE Settings_Service SHALL 返回错误码 `INVALID_REQUEST` 和指明字段的错误消息
5. WHEN 配置文档不存在 `liveSupportPoints` 或 `promoWritingPoints` 字段, THE Settings_Service SHALL 在读取时独立回填每个字段的默认值 30（两个字段缺失时分别处理，互不影响）
6. THE Settings_Page SHALL 在"积分规则配置"区域显示 `liveSupportPoints` 与 `promoWritingPoints` 两个数字输入框，并使用 i18n 翻译键展示标签

### Requirement 2: 技能分数据模型与表

**User Story:** 作为系统，我希望将技能认领持久化到独立的 DynamoDB 表，以便实现按活动维度的全局互斥锁与查询。

#### Acceptance Criteria

1. THE CDK_Stack SHALL 在 DatabaseStack 中定义 `PointsMall-ActivitySkillClaims` 表，分区键为 `activityId`（String），排序键为 `skill`（String）
2. THE ActivitySkillClaims_Table SHALL 为每条 Skill_Claim 存储以下字段：`activityId`、`skill`、`userId`、`userNickname`、`claimedAt`（ISO 8601 时间戳）、`claimedBy`（执行操作的管理员 userId）、`distributionId`、`pointsAwarded`（写入时来自 PointsRuleConfig 的快照值）
3. THE ActivitySkillClaims_Table SHALL 使用 `PAY_PER_REQUEST` 计费模式，与现有表风格一致
4. THE CDK_Stack SHALL 为 Admin Lambda 授予 `PointsMall-ActivitySkillClaims` 表的读写权限
5. THE CDK_Stack SHALL 通过环境变量 `ACTIVITY_SKILL_CLAIMS_TABLE` 将表名传递给 Admin Lambda
6. THE Skill SHALL 仅取以下两个值之一：`liveSupport`、`promoWriting`

### Requirement 3: 批量发放页的技能分入口与可见性

**User Story:** 作为管理员，我希望仅在选择活动且目标角色为 UGL 时才看到技能分入口，以避免界面噪声。

#### Acceptance Criteria

1. WHILE Distributor 已选择 `activityId` 且 `targetRole === 'UserGroupLeader'`, THE Skill_UI SHALL 在每行 UGL 列表项最右侧渲染两个 Skill_Icon（video-camera、pencil-square）
2. IF `targetRole !== 'UserGroupLeader'`, THEN THE Skill_UI SHALL 不渲染任何 Skill_Icon
3. IF Distributor 尚未选择 `activityId`, THEN THE Skill_UI SHALL 不渲染任何 Skill_Icon
4. THE Skill_Icon SHALL 使用 Heroicons SVG（`video-camera` 用于 liveSupport，`pencil-square` 用于 promoWriting），SHALL NOT 使用 emoji
5. THE Skill_Icon SHALL 紧邻"目前积分"列右侧渲染，使用与 UGL 行高一致的固定 viewBox（24×24）尺寸
6. THE Skill_UI SHALL 为每个 Skill_Icon 提供 i18n 化的 hover 提示文案（tooltip 或 aria-label），描述图标语义

### Requirement 4: 可被勾选的 UGL 用户范围

**User Story:** 作为管理员，我希望在完整的 UGL 用户列表中勾选技能贡献者，因为系统中 UGL 与某个 UG 没有强绑定关系。

#### Acceptance Criteria

1. WHEN `targetRole === 'UserGroupLeader'`, THE Skill_UI SHALL 在完整的 active UGL 用户列表中允许 Skill_Icon 勾选，不按活动的 UG 范围进行过滤
2. THE Skill_UI SHALL 仅对 status 为 active 的 UGL 行渲染并允许勾选 Skill_Icon；IF 用户为非 active 状态, THEN THE Skill_UI SHALL 不渲染该行的 Skill_Icon
3. THE Skill_UI SHALL 支持对未勾选左侧"参与活动"复选框的 active UGL 行勾选 Skill_Icon
4. THE Skill_UI SHALL 支持对已勾选左侧"参与活动"复选框的 UGL 行同时勾选 Skill_Icon
5. THE Skill_UI SHALL 在同一 UGL 行允许同时勾选两个 Skill_Icon（liveSupport + promoWriting）

### Requirement 5: 技能锁的全局唯一性（同活动内）

**User Story:** 作为管理员，我希望同一场活动里每种技能仅由 1 位 UGL 占用，避免重复发放同一技能分。

#### Acceptance Criteria

1. WHEN 任意一个 UGL 行勾选 `liveSupport`, THE Skill_UI SHALL 在所有其他 UGL 行禁用该技能图标的勾选（双向互斥，与具体勾选者无关）
2. WHEN 任意一个 UGL 行勾选 `promoWriting`, THE Skill_UI SHALL 在所有其他 UGL 行禁用该技能图标的勾选（双向互斥，与具体勾选者无关）
3. THE Skill_UI SHALL 在被禁用的 Skill_Icon 上展示明确的视觉抑制状态（如降低透明度并禁用 cursor-pointer），且 SHALL 使用 i18n 化的 tooltip 说明"该技能已被 {nickname} 占用"
4. WHEN Skill_UI 加载或刷新页面, THE Skill_UI SHALL 调用 `GET /api/admin/skill-claims?activityId={activityId}` 拉取当前活动的现有 Skill_Lock 列表，并将对应技能在所有 UGL 行预先标记为占用状态
5. THE Skill_UI SHALL 在被预占的 Skill_Icon 上显示占用者昵称（i18n tooltip），并禁止勾选

### Requirement 6: 查询活动技能锁接口

**User Story:** 作为前端，我希望能够查询某活动当前的所有 Skill_Lock，以便在批量发放页与调整页正确呈现可勾选状态。

#### Acceptance Criteria

1. THE Skill_API SHALL 提供 `GET /api/admin/skill-claims?activityId={activityId}` 接口
2. WHEN 调用方不具备 Admin 或 SuperAdmin 角色, THE Skill_Service SHALL 返回错误码 `FORBIDDEN`
3. WHEN `activityId` 查询参数缺失或为空字符串, THE Skill_Service SHALL 返回错误码 `INVALID_REQUEST`
4. WHEN 调用成功, THE Skill_Service SHALL 返回当前 `activityId` 下的所有 Skill_Claim 数组，每条包含：`skill`、`userId`、`userNickname`、`claimedAt`、`claimedBy`、`distributionId`、`pointsAwarded`
5. WHEN 当前活动尚无任何技能认领, THE Skill_Service SHALL 返回空数组（`[]`），SHALL NOT 返回 404

### Requirement 7: 批量发放接口扩展（写入技能认领）

**User Story:** 作为管理员，我希望提交批量发放时一并写入勾选的技能认领，以便积分发放与技能锁创建在同一次操作中原子完成。

#### Acceptance Criteria

1. THE `POST /api/admin/batch-points` 接口 SHALL 接受可选请求字段 `skillClaims`，类型为 `Array<{ skill: 'liveSupport' | 'promoWriting'; userId: string }>`
2. WHEN 请求未携带 `skillClaims` 或其为空数组, THE Skill_Service SHALL 跳过技能相关写入并保持原有批量发放行为不变
3. IF `skillClaims` 中存在任意 `skill` 值在同一请求中出现两次（例如两条都为 `liveSupport`）, THEN THE Skill_Service SHALL 返回错误码 `DUPLICATE_SKILL_IN_REQUEST` 和"同一技能在同一请求中只能出现一次"消息
4. IF `skillClaims` 中任一 `skill` 值不在 `['liveSupport', 'promoWriting']`, THEN THE Skill_Service SHALL 返回错误码 `INVALID_SKILL_TYPE`
5. IF `skillClaims` 中任一 `userId` 在 Users 表中不存在或不是 active 状态, THEN THE Skill_Service SHALL 返回错误码 `INVALID_REQUEST`
6. IF `skillClaims` 中任一 `userId` 不具备 `UserGroupLeader` 角色, THEN THE Skill_Service SHALL 返回错误码 `INVALID_REQUEST`
7. IF `targetRole !== 'UserGroupLeader'` 且请求携带非空 `skillClaims`, THEN THE Skill_Service SHALL 返回错误码 `SKILL_NOT_ALLOWED_FOR_ROLE` 和"技能分仅适用于 UGL 角色"消息
8. THE Skill_Service SHALL 允许 `skillClaims` 中的 `userId` 不在 `userIds` 中（仅技能分场景），SHALL NOT 因此返回错误

### Requirement 8: 技能分发放的三种场景

**User Story:** 作为管理员，我希望系统准确处理"只活动分""只技能分""活动分+技能分"三种发放场景，以便覆盖真实运营情况。

#### Acceptance Criteria

1. WHEN 一位 UGL 仅出现在 `userIds`（左侧勾选）中、未出现在 `skillClaims` 中, THE Skill_Service SHALL 仅向该 UGL 发放 Activity_Points，不创建 Skill_Claim
2. WHEN 一位 UGL 仅出现在 `skillClaims` 中、未出现在 `userIds` 中, THE Skill_Service SHALL 仅向该 UGL 发放对应 Skill_Points，不发放 Activity_Points，并创建对应 Skill_Claim
3. WHEN 一位 UGL 同时出现在 `userIds` 和 `skillClaims` 中, THE Skill_Service SHALL 同时发放 Activity_Points 与对应 Skill_Points，并创建对应 Skill_Claim
4. WHEN `skillClaims` 中同一 `userId` 同时认领 `liveSupport` 和 `promoWriting`, THE Skill_Service SHALL 累加两项 Skill_Points，并创建两条 Skill_Claim 记录
5. WHEN `userIds` 为空数组而 `skillClaims` 非空, THE Skill_Service SHALL 接受该请求并仅按 `skillClaims` 发放 Skill_Points

### Requirement 9: 技能锁的原子写入与互斥

**User Story:** 作为系统，我希望在并发条件下保证每场活动每种技能只有一条 Skill_Claim，以避免重复发放。

#### Acceptance Criteria

1. WHEN Skill_Service 写入 Skill_Claim, THE Skill_Service SHALL 在 DynamoDB Put 中使用 `ConditionExpression: attribute_not_exists(activityId)` 以确保 `(activityId, skill)` 主键唯一
2. WHEN ConditionExpression 失败（已被他人占用）, THE Skill_Service SHALL 返回错误码 `SKILL_ALREADY_CLAIMED`，消息中包含技能名与占用者昵称（来自重新读取的现有 Skill_Claim）
3. WHEN 同一次发放请求包含多条 `skillClaims`, THE Skill_Service SHALL 将所有 Skill_Claim Put 与对应的 Users 表更新、PointsRecords 写入合并到 `TransactWriteCommand` 中，作为同一原子操作执行
4. IF Skill_Claim 写入因 ConditionExpression 失败导致整体事务失败, THEN THE Skill_Service SHALL 不修改任何 Users 表余额、不写入任何 PointsRecord、不创建任何 Skill_Claim
5. WHEN 单次发放的事务操作总数超过 DynamoDB TransactWrite 100 条上限, THE Skill_Service SHALL 拒绝请求并返回错误码 `BATCH_TOO_LARGE`

### Requirement 10: 技能分的积分账单记录（合并规则）

**User Story:** 作为审计人员，我希望每位 UGL 在一次发放中只产生一条 PointsRecord，且 `source` 字段能区分活动分与技能分的来源，以便追溯。

#### Acceptance Criteria

1. WHEN 一位 UGL 在同一次发放中仅获得 Activity_Points（不在 `skillClaims` 中）, THE Skill_Service SHALL 写入一条 `type: 'earn'` PointsRecord，`amount` 等于 Activity_Points，`source` 为形如 `"批量发放:UserGroupLeader|{ugName}|{topic}|{date}"` 的字符串
2. WHEN 一位 UGL 在同一次发放中仅获得 Skill_Points（不在 `userIds` 中）, THE Skill_Service SHALL 写入一条 `type: 'earn'` PointsRecord，`amount` 等于该 UGL 在本次请求中累加的 Skill_Points 总和，`source` 字段 SHALL 标注该 UGL 所认领的技能名（形如 `"批量发放:技能:liveSupport+promoWriting|{ugName}|{topic}|{date}"`），`targetRole` 字段 SHALL 等于 `UserGroupLeader`
3. WHEN 一位 UGL 在同一次发放中同时获得 Activity_Points 与 Skill_Points, THE Skill_Service SHALL 仅写入一条合并 PointsRecord，`amount` 等于 Activity_Points 与 Skill_Points 之和，`source` 字段 SHALL 同时拼接活动分来源与技能分说明（形如 `"批量发放:UserGroupLeader+技能:liveSupport|{ugName}|{topic}|{date}"`）
4. THE PointsRecord SHALL 包含 `activityId`、`activityType`、`activityUG`、`activityTopic`、`activityDate` 字段
5. THE Skill_Service SHALL 在 Users 表更新中分别累加 `points`（余额）与 `earnTotal`、`earnTotalLeader`，金额等于该用户本次获得的 Activity_Points 与 Skill_Points 之和
6. THE Skill_Service SHALL 为每条写入的 PointsRecord 在 `balanceAfter` 字段记录该次更新后的余额（与现有合并写入逻辑保持一致）

### Requirement 11: 发放结果与 Distribution 记录

**User Story:** 作为管理员，我希望在发放完成后看到清晰的结果摘要，并希望发放历史记录中能体现技能分的写入情况。

#### Acceptance Criteria

1. WHEN 发放成功, THE Skill_Service SHALL 在响应中返回：`distributionId`、`successCount`（出现在 `userIds` 或 `skillClaims` 中的去重 UGL 总数，即本次发放的实际收件人数）、`totalPoints`（所有用户实际累加余额之和，含活动分+技能分）、`skillClaims`（实际写入的 Skill_Claim 列表，含 skill、userId、userNickname、pointsAwarded）、`totalSkillPoints`（技能分总额）
2. THE Distribution_Record SHALL 在原有字段基础上新增 `skillClaims` 字段，存储本次发放写入的 Skill_Claim 摘要（skill、userId、userNickname、pointsAwarded）
3. THE Distribution_Record 的 `recipientIds` 字段 SHALL 仅包含来自 `userIds`（左侧勾选）的活动分接收人，SHALL NOT 因 only-skill 场景而扩展（only-skill UGL 通过 `skillClaims` 字段记录，不计入 `recipientIds`）
4. WHEN 发放历史详情页加载某次 Distribution, THE Distribution_History_Page SHALL 在详情视图中展示该次发放的技能分明细（每条显示技能名、占用者昵称、积分数额）

### Requirement 12: 批量调整页支持技能锁管理

**User Story:** 作为 SuperAdmin，我希望在批量发放调整页能释放或重新分配某场活动的技能锁，以便修正错误的技能认领；同时在移除参与者时正确处理"合并 PointsRecord"中的活动分回退。

#### Acceptance Criteria

1. WHEN SuperAdmin 打开某次 Distribution 的调整页, THE Skill_UI SHALL 显示该 Distribution 关联 `activityId` 下的所有 Skill_Lock 当前状态（包括非本 Distribution 占用的 Skill_Lock）
2. THE `POST /api/admin/batch-points/{distributionId}/adjust` 接口 SHALL 接受 `releaseSkills: Array<{ skill: 'liveSupport' | 'promoWriting' }>` 字段，用于释放某 Skill_Lock
3. WHEN 调整请求包含 `releaseSkills`, THE Skill_Service SHALL 在事务中删除对应 Skill_Claim 行，并对原占用 UGL 写入一条 `type: 'adjust'` 的 PointsRecord，`amount` 为该 Skill_Claim 的 `pointsAwarded` 取负值，并相应减少其 `Users.points` 与 `earnTotal`、`earnTotalLeader`
4. THE `POST /api/admin/batch-points/{distributionId}/adjust` 接口 SHALL 接受 `addSkillClaims: Array<{ skill: 'liveSupport' | 'promoWriting'; userId: string }>` 字段，用于新增 Skill_Lock 占用
5. WHEN 调整请求包含 `addSkillClaims`, THE Skill_Service SHALL 在事务中以 `attribute_not_exists(activityId)` 写入新的 Skill_Claim、为目标 UGL 增加余额并写入 `type: 'adjust'` 的 PointsRecord（`amount` 为当前 PointsRuleConfig 对应字段值）
6. IF `addSkillClaims` 中的 `skill` 已被占用, THEN THE Skill_Service SHALL 返回错误码 `SKILL_ALREADY_CLAIMED` 并整体回滚
7. WHEN SuperAdmin 在调整页从某 Distribution 移除一位参与者 X 而 X 在该 Distribution 的同一发放中既获得活动分又认领了技能分（即合并 PointsRecord 场景）, THE Skill_Service SHALL 仅回退活动分部分（写入 `type: 'adjust'` PointsRecord，`amount` 为该 Distribution 的 `points` 取负值），SHALL 保留 X 的 Skill_Claim 记录与 Skill_Points 部分（only-skill 场景仍然合法，技能锁不释放）
8. THE Skill_Service SHALL 仅允许 SuperAdmin 执行 `releaseSkills` 与 `addSkillClaims`；IF 调用方非 SuperAdmin 而请求体包含上述字段, THEN THE Skill_Service SHALL 拒绝执行任何技能锁修改操作并返回错误码 `FORBIDDEN`
9. WHEN 同时存在 `releaseSkills` 与 `addSkillClaims`, THE Skill_Service SHALL 先执行 `releaseSkills`（删除）再执行 `addSkillClaims`（写入），整体在同一事务中完成；IF 任一子操作失败, THEN THE Skill_Service SHALL 整体回滚

### Requirement 13: 前端在调整页的可见性与提示

**User Story:** 作为 SuperAdmin，我希望在调整页一目了然地看到当前活动的两类技能锁状态及变更入口，以便操作准确。

#### Acceptance Criteria

1. THE Skill_UI（调整页） SHALL 显示一个"活动技能锁"区块，列出 `liveSupport` 与 `promoWriting` 当前占用者昵称（若无则显示"未占用"）
2. WHEN 某项技能锁当前未占用, THE Skill_UI SHALL 在调整页提供"指派"入口，点击后弹出 UGL 选择器（来自完整 UGL 用户列表）
3. WHEN 某项技能锁当前已占用, THE Skill_UI SHALL 在调整页提供"释放"入口，点击后展示确认弹窗，弹窗 SHALL 提示"释放将扣回 {pointsAwarded} 分"
4. THE Skill_UI（调整页）SHALL 在 Diff_Summary 中体现 `releaseSkills`（释放占用、负向积分变动）和 `addSkillClaims`（新增占用、正向积分变动）的总积分差额
5. WHEN SuperAdmin 在确认弹窗中确认调整, THE Skill_UI SHALL 将 `releaseSkills` 与 `addSkillClaims` 一并提交至调整接口

### Requirement 14: 国际化支持

**User Story:** 作为多语言用户，我希望技能分相关的所有界面文案都支持现有 5 种语言，以便保持一致体验。

#### Acceptance Criteria

1. THE Skill_UI SHALL 使用 i18n 翻译函数获取所有界面文案，SHALL NOT 硬编码任何语言文字
2. THE i18n_System SHALL 为技能分功能新增翻译键，覆盖 5 种语言：zh、zh-TW、en、ja、ko
3. THE i18n_System SHALL 为以下文案类别提供翻译键：技能名（liveSupport、promoWriting）、Skill_Icon hover 提示、占用提示、发放成功/失败提示、调整页"活动技能锁"区块、确认弹窗、设置页 `liveSupportPoints` / `promoWritingPoints` 字段标签
4. THE Settings_Page SHALL 通过 i18n 翻译键展示 `liveSupportPoints` 与 `promoWritingPoints` 输入框的标签与帮助文本

### Requirement 15: API 路由与基础设施配置

**User Story:** 作为开发者，我希望在 CDK 中注册技能分相关路由并完成 IAM 授权，以便前端能正确调用后端接口。

#### Acceptance Criteria

1. THE CDK_Stack SHALL 在 API Gateway 中注册 `GET /api/admin/skill-claims` 路由（接受 `activityId` 查询参数），集成到 Admin Lambda
2. THE CDK_Stack SHALL 确保 `POST /api/admin/batch-points` 与 `POST /api/admin/batch-points/{distributionId}/adjust` 路由保持现有挂载，仅在 Lambda 内部扩展技能分逻辑
3. THE CDK_Stack SHALL 在 ApiStack 为 Admin Lambda 显式授予 `PointsMall-ActivitySkillClaims` 表的 `read/write` 权限
4. THE CDK_Stack SHALL 通过环境变量 `ACTIVITY_SKILL_CLAIMS_TABLE` 注入表名
5. THE CDK_Stack SHALL 确保新增路由支持 CORS 预检请求

### Requirement 16: 正确性属性（Correctness Properties）

**User Story:** 作为系统维护者，我希望以可测试的不变量约束技能分发放逻辑，以便用属性测试验证关键正确性。

#### Acceptance Criteria

1. **Property 1 — Mutex（技能锁全局唯一性）**：FOR ALL 同一 `activityId`，`PointsMall-ActivitySkillClaims` 中以 `(activityId, 'liveSupport')` 为主键的条目数量 SHALL <= 1，以 `(activityId, 'promoWriting')` 为主键的条目数量 SHALL <= 1（即每个 `(activityId, skill)` 组合最多由一位 UGL 占用）
2. **Property 2 — Points conservation（积分守恒）**：FOR ANY 一次成功的发放请求（含 `skillClaims`）, 所有受影响用户的 `Users.points` 增量之和 SHALL 等于（`userIds` 中每位 UGL 应得的 Activity_Points 之和）+ （`skillClaims` 中每位 UGL 应得的 Skill_Points 之和）
3. **Property 3 — Record merge invariant（合并记录不变量）**：FOR ANY 一次成功的发放请求, IF 用户 U 同时出现在 `userIds` 与 `skillClaims` 中, THEN 本次发放为 U 创建的 PointsRecord 数量 SHALL 等于 1，且其 `amount` SHALL 等于 Activity_Points + Skill_Points； IF U 仅出现在其中一个集合中, THEN 本次发放为 U 创建的 PointsRecord 数量 SHALL 等于 1，且其 `amount` SHALL 等于对应那个集合应得的积分子集
4. **Property 4 — Skill claim atomicity（技能认领原子性）**：FOR ANY 一次发放请求, 系统结果 SHALL 仅可能为以下两种之一：(a) 全部 `skillClaims` 均成功写入并所有用户余额按 Property 2 更新；(b) 整体失败，无任何 `Users.points` 修改、无任何 PointsRecord 写入、无任何 Skill_Claim 创建。WHEN 任一 `skillClaim` 因 ConditionExpression 冲突触发 `SKILL_ALREADY_CLAIMED`, THE Skill_Service SHALL 进入路径 (b)
5. **Property 5 — Adjust preserves skill claims（调整保留技能认领）**：WHEN 一次调整请求从某 Distribution 移除参与者 X 且 X 在该 Distribution 的发放中既获得活动分又认领了某项技能, THE Skill_Claim 记录在 `PointsMall-ActivitySkillClaims` 中 SHALL 保持不变（`userId` 仍为 X，`pointsAwarded` 不变）；X 的 `Users.points` 减少量 SHALL 等于该 Distribution 的活动分（`points` 字段值），即 Skill_Points 部分仍保留在 X 的余额中
6. **Property 6 — Role restriction（角色限制）**：FOR ANY 包含非空 `skillClaims` 的批量发放请求, IF `targetRole !== 'UserGroupLeader'`, THEN THE Skill_Service SHALL 返回错误码 `SKILL_NOT_ALLOWED_FOR_ROLE`，且 SHALL NOT 修改任何 `Users.points`、SHALL NOT 写入任何 PointsRecord、SHALL NOT 创建任何 Skill_Claim
7. **Property 7 — Lock release authority（释放权限）**：FOR ANY `releaseSkills` 调整请求, 调用方 SHALL 具备 `SuperAdmin` 角色； WHEN SuperAdmin 释放某 Skill_Claim, 原占用 UGL 的 `Users.points` 减少量 SHALL 严格等于该 Skill_Claim 的 `pointsAwarded` 字段值（写入时刻的快照值），且对应 PointsRecord SHALL 写入 `type: 'adjust'` 的负值条目；IF 调用方非 SuperAdmin 但请求体包含 `releaseSkills` 或 `addSkillClaims`, THEN THE Skill_Service SHALL 返回错误码 `FORBIDDEN` 并不进行任何状态变更
8. **配置快照不变量（衍生约束）**：FOR ANY Skill_Claim 行，其 `pointsAwarded` 字段值 SHALL 等于写入时刻 PointsRuleConfig 中对应字段（`liveSupportPoints` 或 `promoWritingPoints`）的值，并在后续 PointsRuleConfig 变更时保持不变（仅作为历史快照）
