# 需求文档：特殊活动积分颁发

## 简介

本功能为超级管理员提供一个独立的"特殊活动积分颁发"页面，用于向参与特定活动的用户发放特殊活动积分。该积分类型独立于现有的 UGL 身份分、Speaker 身份分和 Volunteer 身份分，计入用户总积分（可兑换商品），同时在年底评选和排行榜报表中可作为独立维度进行统计。每次发放需选择一个奖项标签（AwardTag），用以标记奖项类别（如"主讲奖"、"互动奖"、"幸运奖"），替代原先的自由文本发放原因字段。页面交互模仿现有的季度贡献奖（quarterly-award）页面。

## 架构约束

为保证特殊活动积分**不参与**身份分排行榜（Speaker/UGL/Volunteer 排行榜）和差旅资格计算，本功能采用**独立发放路径**，不复用现有的 `executeBatchDistribution` 函数：

1. THE 系统 SHALL 使用独立的发放函数 `executeSpecialActivityDistribution`（位于 `packages/backend/src/admin/`）执行特殊活动积分发放
2. THE 独立发放函数 SHALL 仅写入用户表的 `points`、`earnTotal`、`earnTotalSpecialActivity` 三个字段
3. THE 独立发放函数 SHALL NOT 写入 `earnTotalSpeaker`、`earnTotalLeader`、`earnTotalVolunteer` 任何身份分字段
4. THE 独立发放函数 SHALL 复用 BatchDistributions 表写入 DistributionRecord，且 `targetRole` 字段值为 `"SpecialActivity"`、`activityType` 字段值为 `"特殊活动"`
5. THE 独立发放函数 SHALL 复用 PointsRecords 表写入 PointsRecord，且 `targetRole` 字段值为 `"SpecialActivity"`、`source` 字段格式为 `"特殊活动:{活动主题}|{UG名称}|{活动日期}|{tagName}"`
6. THE AwardTags 表 SHALL 为 special-activity-award 功能专用，与 ContentTags 表完全隔离（不共用表、不共用 API、不共用 GSI）；后端实现可借鉴 `packages/backend/src/content/tags.ts` 模块的代码结构与归一化逻辑

## 术语表

- **系统（System）**：UG 积分商城后台系统
- **前端（Frontend）**：基于 Taro (React) 的 H5 前端应用
- **超级管理员（SuperAdmin）**：拥有 SuperAdmin 角色的用户
- **特殊活动积分（SpecialActivityPoints）**：与特定活动关联的独立积分类型，区别于 UGL/Speaker/Volunteer 身份分
- **活动（Activity）**：PointsMall-Activities 表中的活动记录
- **积分记录（PointsRecord）**：PointsMall-PointsRecords 表中的积分变动记录
- **发放记录（DistributionRecord）**：PointsMall-BatchDistributions 表中的批量发放记录
- **用户表（UsersTable）**：PointsMall-Users 表
- **earnTotalSpecialActivity**：用户表中新增的特殊活动积分累计字段
- **executeSpecialActivityDistribution**：新增的独立发放函数，位于 `packages/backend/src/admin/`，仅写入 `points`、`earnTotal`、`earnTotalSpecialActivity` 三个字段，不写入任何身份分累计字段
- **earnTotalSpecialActivity-index**：用户表新增的 GSI 索引名，partition key 为 `pk`、sort key 为 `earnTotalSpecialActivity`，用于排行榜与报表的特殊活动积分排名查询
- **SpecialActivity**：DistributionRecord.targetRole 与 PointsRecord.targetRole 中用于标识特殊活动积分发放的字符串值（注意：activityType 字段使用中文 `"特殊活动"`）
- **批量发放历史接口**：现有的 `GET /api/admin/batch-points/history` 与 `GET /api/admin/batch-points/history/{distributionId}` 接口
- **AwardTag**：奖项标签，标识本次特殊活动积分发放的奖项类别（如"主讲奖"、"互动奖"、"幸运奖"），由 SuperAdmin 在发放表单中选择已有 tag 或创建新 tag
- **AwardTags 表**：新建的 DynamoDB 表 `PointsMall-AwardTags`，存储 AwardTag 元数据，结构与 ContentTags 表同构（tagId 主键、tagName 归一化字段、displayName 原文展示字段、usageCount、createdAt、updatedAt、createdBy），仅供 special-activity-award 功能使用
- **tagName-index**：AwardTags 表上的 GSI 索引名，partition key 为 `tagName`，用于按归一化 tag 名快速查询
- **normalizeTagName**：tag 名归一化函数，规则为 trim 前后空白 + 折叠中间连续空白为单个空格 + 转为小写，与 ContentTags 系统使用同一规则
- **awardTagId**：DistributionRecord 与 PointsRecord 中新增字段，记录本次发放使用的 AwardTag 主键（ULID）
- **awardTagName**：DistributionRecord 与 PointsRecord 中新增字段，记录本次发放使用的归一化 tag 名
- **去重键**：`(activityId, tagName)` 组合，用于判定特殊活动积分发放是否重复——同一活动同一 tag 下，每个用户只能获得一次

## 需求

### 需求 1：权限控制

**用户故事：** 作为系统管理员，我希望仅超级管理员可以操作特殊活动积分颁发功能，以确保积分发放的安全性和规范性。

#### 验收标准

1. WHEN 非 SuperAdmin 角色的用户访问特殊活动积分颁发页面，THE 前端 SHALL 重定向该用户至管理后台首页
2. WHEN 非 SuperAdmin 角色的用户调用特殊活动积分颁发 API，THE 系统 SHALL 返回 HTTP 403 状态码和错误信息"需要超级管理员权限"
3. WHEN SuperAdmin 角色的用户访问特殊活动积分颁发页面，THE 前端 SHALL 正常展示页面内容

### 需求 2：活动选择

**用户故事：** 作为超级管理员，我希望在颁发特殊活动积分时选择一个具体活动，以便积分记录能关联到对应的活动。

#### 验收标准

1. THE 前端 SHALL 提供一个活动选择器，展示 Activities 表中的活动列表
2. WHEN 超级管理员打开活动选择器，THE 前端 SHALL 按活动日期降序展示活动列表，每条显示活动主题、UG 名称和活动日期
3. WHEN 超级管理员在活动选择器中输入关键词，THE 前端 SHALL 按活动主题进行模糊搜索过滤
4. WHEN 超级管理员未选择任何活动，THE 前端 SHALL 禁用提交按钮

### 需求 3：积分配置

**用户故事：** 作为超级管理员，我希望自由配置每次发放的积分数量，并选择一个奖项标签（AwardTag）来标记本次发放的奖项类别，以适应不同活动的奖励需求。

#### 验收标准

1. THE 前端 SHALL 提供积分数量输入框，仅接受正整数输入
2. THE 前端 SHALL 提供发放日期选择器，默认值为当天日期，格式为 YYYY-MM-DD
3. THE 前端 SHALL 提供奖项标签（AwardTag）选择控件，且该控件为必填项
4. WHEN 超级管理员在 AwardTag 选择控件中输入关键词，THE 前端 SHALL 调用 `GET /api/admin/award-tags?prefix=...` 接口模糊匹配候选 tag，并以下拉列表展示
5. WHEN 超级管理员输入的关键词未命中任何现有 tag，THE 前端 SHALL 在下拉列表末尾展示「+ 新建 "xxx"」选项
6. WHEN 超级管理员点击「+ 新建 "xxx"」选项，THE 前端 SHALL 选中该新 tag 名（实际创建动作在提交发放时由后端原子完成）
7. THE 前端 SHALL 校验 AwardTag 名长度为 1~30 个字符
8. THE 前端 SHALL 禁止 AwardTag 名包含以下特殊符号：`<`、`>`、`"`、`'`、`/`、`\`、`|`、`*`、`?`、`:`、`&`
9. THE 前端 SHALL 允许 AwardTag 名包含中文、英文（大小写）、数字、空格，并允许中英文混合
10. THE 前端 SHALL 在提交前对 AwardTag 名进行 trim（去除前后空白）和折叠中间连续空白为单个空格的预处理（与后端 normalizeTagName 规则保持一致的展示行为）
11. WHEN 积分数量为空或小于 1，THE 前端 SHALL 禁用提交按钮
12. WHEN 未选择奖项标签（AwardTag），THE 前端 SHALL 禁用提交按钮

### 需求 4：用户选择

**用户故事：** 作为超级管理员，我希望从所有活跃用户中选择获奖用户，不受角色限制。

#### 验收标准

1. THE 前端 SHALL 调用现有 `GET /api/admin/users` 接口获取用户列表，并在收到响应后按 `status === 'active'` 在前端过滤展示，不修改后端 listUsers 实现
2. WHEN 超级管理员在搜索框中输入关键词，THE 前端 SHALL 按昵称或邮箱进行模糊搜索过滤
3. THE 前端 SHALL 提供全选和取消全选功能
4. THE 前端 SHALL 复用现有 `GET /api/admin/users?pageSize=50&lastKey=...` 接口分页加载用户列表，每页 50 条，并以"加载更多"按钮模式由后端返回的 `lastKey` 控制是否还有下一页（与 quarterly-award 等管理页面保持一致）
5. WHEN 未选择任何用户，THE 前端 SHALL 禁用提交按钮
6. THE 前端 SHALL 实时显示已选用户数量

### 需求 5：确认与提交

**用户故事：** 作为超级管理员，我希望在提交前看到发放详情的确认弹窗，以避免误操作。

#### 验收标准

1. WHEN 超级管理员点击确认发放按钮，THE 前端 SHALL 展示确认弹窗，显示以下信息：关联活动名称、发放日期、选中人数、每人积分、合计积分、奖项标签（AwardTag 名称）
2. WHEN 超级管理员在确认弹窗中点击"确认发放"，THE 前端 SHALL 调用后端 API 执行发放
3. WHILE 发放请求正在处理中，THE 前端 SHALL 禁用确认按钮并显示"发放中..."文案
4. WHEN 发放成功，THE 前端 SHALL 显示成功提示，包含成功人数和总积分数
5. WHEN 发放失败，THE 前端 SHALL 显示错误提示信息
6. WHEN 超级管理员在确认弹窗中点击"取消"，THE 前端 SHALL 关闭弹窗且不执行发放

### 需求 6：后端积分发放逻辑

**用户故事：** 作为系统，我需要正确执行特殊活动积分的发放，确保积分记录准确可追溯，并将每次发放与对应的奖项标签（AwardTag）关联。

#### 验收标准

1. WHEN 系统收到合法的特殊活动积分发放请求，THE 系统 SHALL 为每个选中用户增加对应积分到 points 字段
2. WHEN 系统收到合法的特殊活动积分发放请求，THE 系统 SHALL 为每个选中用户增加对应积分到 earnTotal 字段
3. WHEN 系统收到合法的特殊活动积分发放请求，THE 系统 SHALL 为每个选中用户增加对应积分到 earnTotalSpecialActivity 字段
4. WHEN 系统收到合法的特殊活动积分发放请求，THE 系统 SHALL 为每个选中用户创建一条 PointsRecord，source 字段格式为 `"特殊活动:{活动主题}|{UG名称}|{活动日期}|{tagName}"`
5. WHEN 系统收到合法的特殊活动积分发放请求，THE 系统 SHALL 创建一条 DistributionRecord，targetRole 字段值为 `"SpecialActivity"`、activityType 字段值为中文 `"特殊活动"`
6. THE 系统 SHALL 通过独立的 `executeSpecialActivityDistribution` 函数执行特殊活动积分发放，且该函数 SHALL NOT 写入 `earnTotalSpeaker`、`earnTotalLeader`、`earnTotalVolunteer` 任何身份分累计字段
7. THE 系统 SHALL 在 DistributionRecord 中新增 `awardTagId` 与 `awardTagName` 两个字段，分别记录本次发放使用的 AwardTag 主键与归一化 tag 名
8. THE 系统 SHALL 在 PointsRecord 中新增 `awardTagId` 与 `awardTagName` 两个字段，分别记录本次发放使用的 AwardTag 主键与归一化 tag 名
9. THE 系统 SHALL 接受发放接口入参 `awardTagName`（必填字符串），并在落库前调用 `normalizeTagName` 进行归一化
10. WHEN 系统执行特殊活动积分发放，THE 系统 SHALL 在 AwardTags 表的 `tagName-index` GSI 上按归一化 tagName 查询：若已存在则复用其 tagId 并将该记录的 usageCount 原子加 1；若不存在则原子创建新记录（tagId = ulid()、displayName 取请求原文、usageCount = 1）
11. IF 请求中的 activityId 在 Activities 表中不存在，THEN THE 系统 SHALL 返回错误码 ACTIVITY_NOT_FOUND 和消息"关联活动不存在"
12. IF 请求中的 userIds 为空数组，THEN THE 系统 SHALL 返回错误码 INVALID_REQUEST 和消息"userIds 必须为非空数组"
13. IF 请求中的 points 不是正整数，THEN THE 系统 SHALL 返回错误码 INVALID_REQUEST 和消息"points 必须为正整数"
14. IF 请求中的 awardTagName 为空字符串或缺失，THEN THE 系统 SHALL 返回错误码 INVALID_REQUEST 和消息"awardTagName 必填"
15. IF 请求中的 awardTagName 归一化后长度不在 1~30 字符之间，THEN THE 系统 SHALL 返回错误码 INVALID_REQUEST 和消息"奖项标签长度必须为 1~30 个字符"
16. IF 请求中的 awardTagName 包含禁止的特殊符号（`<`、`>`、`"`、`'`、`/`、`\`、`|`、`*`、`?`、`:`、`&`），THEN THE 系统 SHALL 返回错误码 INVALID_REQUEST 和消息"奖项标签包含非法字符"

### 需求 7：独立积分类型标识

**用户故事：** 作为系统管理员，我希望特殊活动积分在数据层面与其他积分类型明确区分，并能按奖项标签维度进行聚合统计，以便年底评选时独立分析。

#### 验收标准

1. THE 系统 SHALL 在用户表中维护 earnTotalSpecialActivity 字段，记录用户累计获得的特殊活动积分
2. WHEN 特殊活动积分发放成功，THE 系统 SHALL 将发放积分累加到用户的 earnTotalSpecialActivity 字段
3. THE 系统 SHALL 在 PointsRecord 的 source 字段中使用 `"特殊活动:"` 前缀标识特殊活动积分记录
4. THE 系统 SHALL 在 DistributionRecord 中使用 targetRole 值 `"SpecialActivity"` 标识特殊活动积分发放记录
5. THE 系统 SHALL 在 PointsRecord 中使用 targetRole 值 `"SpecialActivity"` 标识特殊活动积分发放的积分记录
6. THE 系统 SHALL 在 DistributionRecord 与 PointsRecord 中同时记录 `awardTagId` 与 `awardTagName` 字段，便于报表按 AwardTag 维度聚合统计

### 需求 8：重复发放防护

**用户故事：** 作为超级管理员，我希望系统允许同一活动以不同奖项 tag 多次发放，但同一活动 + 同一奖项 tag 组合下，每个用户只能获得一次特殊活动积分。

#### 验收标准

1. WHEN 系统检测到某用户已在同一活动（按 activityId 匹配）且同一奖项 tag（按归一化 tagName 匹配）下获得过特殊活动积分（targetRole 为 `"SpecialActivity"`），THE 系统 SHALL 返回错误码 DUPLICATE_AWARD_TAG_DISTRIBUTION 和消息"以下用户已在此活动的该奖项标签下获得过特殊活动积分"
2. THE 前端 SHALL 在用户列表中按 `(activityId, awardTagName)` 组合查询并标记已在当前选中活动 + 当前奖项 tag 下获得过特殊活动积分的用户
3. THE 系统 SHALL 允许同一活动针对同一用户使用不同奖项 tag 多次发放（例如同一活动下，某用户可同时获得"主讲奖"和"互动奖"）
4. THE 系统 SHALL 允许同一活动 + 同一奖项 tag 组合针对不同用户集合进行多次发放，仅对该组合下已发放过的用户拒绝重复发放

### 需求 9：积分计入总分

**用户故事：** 作为用户，我希望获得的特殊活动积分计入我的总积分，可以用来兑换商品。

#### 验收标准

1. WHEN 特殊活动积分发放成功，THE 系统 SHALL 将发放积分累加到用户的 points 字段（可用余额）
2. WHEN 特殊活动积分发放成功，THE 系统 SHALL 将发放积分累加到用户的 earnTotal 字段（总获得积分）

### 需求 10：CDK 数据库改动与排行榜报表改造

**用户故事：** 作为系统管理员，我希望在排行榜和报表中能独立查看特殊活动积分维度，以便年底评选时与身份分（UGL/Speaker/Volunteer）严格区分开。

#### 验收标准

1. THE CDK 数据库定义 SHALL 在 PointsMall-Users 表上新增名为 `earnTotalSpecialActivity-index` 的 GSI，partition key 为 `pk`、sort key 为 `earnTotalSpecialActivity`
2. THE CDK 部署节奏 SHALL 满足"DynamoDB 单次部署只能在同一张表上新增一个 GSI"的约束，即 `earnTotalSpecialActivity-index` GSI 必须独立先部署完成后，才能部署依赖该索引的业务代码（API、排行榜、报表）
3. THE CDK 数据库定义 SHALL 新增 `PointsMall-AwardTags` 表，主键为 `tagId`，并在该表上创建 `tagName-index` GSI（partition key 为 `tagName`）
4. THE CDK 部署节奏 SHALL 允许 `PointsMall-AwardTags` 表（含其 `tagName-index` GSI）与 `earnTotalSpecialActivity-index` GSI 在同一批次部署（因为两者修改的是不同的 DynamoDB 表，不冲突于"单次部署只能在同一张表上新增一个 GSI"的约束）
5. THE 系统 SHALL 支持按 `earnTotalSpecialActivity` 字段（通过 `earnTotalSpecialActivity-index` GSI）查询用户的特殊活动积分排名
6. THE 后端排行榜模块 `packages/backend/src/leaderboard/ranking.ts` 中的 `ROLE_GSI_MAP` SHALL 新增 `SpecialActivity` 条目，映射到 `earnTotalSpecialActivity-index` 与 `earnTotalSpecialActivity` 字段
7. THE 前端排行榜页面 SHALL 新增 SpecialActivity Tab，展示按特殊活动积分排序的用户排行榜
8. THE 后端报表模块 `packages/backend/src/reports/query.ts` 与 `packages/backend/src/reports/export.ts` 的 `targetRole` 筛选 SHALL 新增"特殊活动"选项（对应 targetRole 值 `"SpecialActivity"`）
9. THE 用户排名报表 SHALL 包含 `earnTotalSpecialActivity` 列

### 需求 11：邮件通知

**用户故事：** 作为获奖用户，我希望在获得特殊活动积分后收到邮件通知，以便了解积分变动情况。

#### 验收标准

1. WHEN 特殊活动积分发放成功，THE 系统 SHALL 为每位获奖用户调用现有 `sendPointsEarnedEmail` 函数（位于 `packages/backend/src/email/notifications.ts`）发送邮件通知
2. THE 邮件内容 SHALL 包含：关联活动主题、本次获得积分数、用户当前积分余额
3. THE 邮件 SHALL 复用现有 `points_earned` 模板，type 标识为"特殊活动"，与 quarterlyAward 邮件行为保持一致
4. IF 单个用户的邮件发送失败，THEN THE 系统 SHALL 记录错误日志但不阻塞其他用户的邮件发送和整体发放流程

### 需求 12：发放历史

**用户故事：** 作为超级管理员，我希望查看特殊活动积分的颁发历史，并能按奖项标签筛选，以便审计和追溯发放记录。

#### 验收标准

1. THE 系统 SHALL 提供"特殊活动颁发历史"页面，且仅 SuperAdmin 可访问
2. WHEN 非 SuperAdmin 角色的用户访问"特殊活动颁发历史"页面，THE 前端 SHALL 重定向该用户至管理后台首页
3. THE 历史页面 SHALL 复用现有 `GET /api/admin/batch-points/history` 接口，按 `activityType="特殊活动"` 或 `targetRole="SpecialActivity"` 进行筛选
4. THE 历史列表 SHALL 展示以下字段：发放时间、关联活动（活动主题 + UG + 活动日期）、发放人数、合计积分、操作人（distributorNickname）、奖项 Tag（awardTagName 的 displayName）
5. THE 历史列表 SHALL 支持按 awardTagName 进行筛选展示
6. WHEN 超级管理员点击某条历史记录，THE 前端 SHALL 复用现有 `GET /api/admin/batch-points/history/{distributionId}` 接口，展示该次发放的详情，包括所有获奖用户列表与本次发放使用的奖项 Tag
7. THE 历史列表 SHALL 按发放时间降序排列
8. THE 历史列表 SHALL 复用现有的分页机制（pageSize + lastKey）

### 需求 13：路由与 API 端点

**用户故事：** 作为开发者与超级管理员，我希望特殊活动积分颁发功能有明确且一致的路由与 API 端点，并能从 Admin Dashboard 入口进入。

#### 验收标准

1. THE 前端页面路由 SHALL 为 `/pages/admin/special-activity-award`
2. THE 后端 API 端点 SHALL 为 `POST /api/admin/special-activity-award`
3. THE Admin Dashboard 页面（`packages/frontend/src/pages/admin/index.tsx`）SHALL 新增"特殊活动颁发"卡片，且该卡片 SHALL 配置为 `superAdminOnly`、`category` 为 `operations`
4. THE "特殊活动颁发"卡片 SHALL 使用与功能语义匹配的图标（例如 GiftIcon 或类似的奖励/礼物类图标）
5. WHEN 超级管理员在 Admin Dashboard 点击"特殊活动颁发"卡片，THE 前端 SHALL 跳转至 `/pages/admin/special-activity-award` 页面

### 需求 14：AwardTag 管理

**用户故事：** 作为超级管理员，我希望系统提供独立的 AwardTag 元数据存储与管理接口，支持自动补全搜索、热门 tag 展示、显式创建与受限删除，以保持奖项标签的清洁与可维护性。

#### 验收标准

1. THE 系统 SHALL 提供 `PointsMall-AwardTags` 表，结构包含以下字段：`tagId`（主键，ULID）、`tagName`（归一化字段，String）、`displayName`（用户原文展示用，String）、`usageCount`（Number）、`createdAt`（ISO 8601 字符串）、`updatedAt`（ISO 8601 字符串）、`createdBy`（创建者用户 ID）
2. THE CDK 数据库定义 SHALL 在 `PointsMall-AwardTags` 表上创建名为 `tagName-index` 的 GSI，partition key 为 `tagName`
3. THE 后端 SHALL 提供以下端点，且全部仅 SuperAdmin 可访问：
   - `GET /api/admin/award-tags?prefix=...&limit=10`：按 tagName 前缀模糊匹配，自动补全搜索
   - `GET /api/admin/award-tags/hot`：按 usageCount 降序返回热门 tag 列表
   - `POST /api/admin/award-tags`：显式创建 tag（请求体含 displayName，后端归一化为 tagName 后落库）
   - `DELETE /api/admin/award-tags/{tagId}`：删除指定 tagId 的 tag
4. WHEN 系统执行特殊活动积分发放且请求中的 awardTagName 在 AwardTags 表的 `tagName-index` GSI 上不存在，THE 系统 SHALL 在 AwardTags 表中原子创建新 tag 记录（tagId = ulid()、tagName 为归一化结果、displayName 取请求原文、usageCount = 1）
5. WHEN 系统执行特殊活动积分发放且请求中的 awardTagName 已存在，THE 系统 SHALL 将对应 tag 记录的 usageCount 原子加 1
6. WHEN SuperAdmin 调用 `DELETE /api/admin/award-tags/{tagId}` 删除 tag，IF 该 tag 的 usageCount 大于 0，THEN THE 系统 SHALL 返回 HTTP 400 错误码 TAG_IN_USE 和消息"该奖项 Tag 已被使用，无法删除"
7. WHEN SuperAdmin 调用 `DELETE /api/admin/award-tags/{tagId}` 删除 tag，IF 该 tag 的 usageCount 等于 0，THEN THE 系统 SHALL 删除该 tag 记录并返回 HTTP 200
8. THE tagName 归一化规则 SHALL 与 ContentTags 一致：trim 前后空白 + 折叠中间连续空白为单个空格 + 转为小写
9. THE tagName 验证规则 SHALL 为：长度 1~30 字符；允许中文、英文（大小写）、数字、空格；禁止以下特殊符号：`<`、`>`、`"`、`'`、`/`、`\`、`|`、`*`、`?`、`:`、`&`
10. THE displayName 字段 SHALL 保留用户首次创建时的原文（不做小写转换），仅用于 UI 展示
11. WHEN 后端通过 `GET /api/admin/award-tags?prefix=...` 接收到 prefix 参数，THE 系统 SHALL 先对 prefix 调用 `normalizeTagName` 归一化，再使用 `tagName-index` GSI 进行 `begins_with(tagName, :prefix)` 匹配查询
12. WHEN 后端通过 `POST /api/admin/award-tags` 创建 tag，IF 归一化后的 tagName 已存在于 AwardTags 表，THEN THE 系统 SHALL 返回 HTTP 409 错误码 TAG_ALREADY_EXISTS 和消息"该奖项 Tag 已存在"
