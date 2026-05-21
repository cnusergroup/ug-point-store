# 需求文档：许愿池（Wish Pool）

## 简介

许愿池是一个社区驱动的周边商品需求收集功能。社区用户可以免费提交"想要什么周边"的许愿，其他用户可以免费投票支持（+1）。管理员审核许愿内容后发布到社区，根据投票热度决定是否采纳上架。愿望被采纳上架后，原始许愿者获得积分奖励和优先购买权。每位用户每月最多提交 3 个许愿。

## 术语表

- **Wish_Pool_System**：许愿池系统，管理许愿的提交、审核、投票、采纳全流程
- **Wish**：一条许愿记录，包含标题、描述、参考图片（可选）、状态、投票数等信息
- **Wish_Author**：提交许愿的用户
- **Voter**：对许愿进行投票支持的用户
- **Wish_Status**：许愿状态枚举，取值为 `pending`（待审核）、`approved`（已通过）、`adopted`（已采纳）、`fulfilled`（已上架）、`closed`（已关闭）
- **Vote_Count**：某条许愿获得的总投票数
- **Monthly_Wish_Limit**：每位用户每自然月可提交的许愿上限，固定为 3
- **Feature_Toggles_System**：功能开关系统，存储在 DynamoDB Users 表中（`userId='feature-toggles'`）
- **Notification_System**：现有的通知系统，用于发送邮件通知
- **Admin_User**：拥有 `Admin` 或 `SuperAdmin` 角色的管理员用户
- **WishesTable**：DynamoDB 中独立的许愿记录表（表名通过环境变量 `WISHES_TABLE` 配置）
- **WishVotesTable**：DynamoDB 中独立的投票记录表（表名通过环境变量 `WISH_VOTES_TABLE` 配置），使用 wishId + voterId 复合键防止重复投票
- **wishFulfilledRewardPoints**：许愿上架后发放给 Wish_Author 的积分奖励数量，可通过 Feature_Toggles_System 配置，默认值为 50

## 需求

### 需求 1：许愿提交

**用户故事：** 作为社区用户，我希望提交一个周边商品许愿（包含标题、描述和可选参考图片），以便表达我想要的周边商品。

#### 验收标准

1. WHEN 用户提交许愿时，THE Wish_Pool_System SHALL 创建一条 Wish 记录，状态为 `pending`，投票数为 0
2. THE Wish_Pool_System SHALL 要求许愿包含标题（1-50 个字符）和描述（1-500 个字符）
3. THE Wish_Pool_System SHALL 允许许愿包含一张可选的参考图片，通过现有的 CloudFront 图片上传接口获取 URL（复用 `/admin/upload-url` 签名 URL 机制）
4. WHEN 用户本月已提交 3 个许愿时，THE Wish_Pool_System SHALL 拒绝新的许愿提交，并返回错误码 `MONTHLY_LIMIT_EXCEEDED`
5. THE Wish_Pool_System SHALL 以自然月（每月 1 日 00:00 UTC 重置）为周期计算 Monthly_Wish_Limit，统一使用 UTC 时间，不考虑用户本地时区
6. THE Wish_Pool_System SHALL 记录许愿的创建时间（createdAt）和许愿者的 userId

### 需求 2：许愿审核

**用户故事：** 作为管理员，我希望审核用户提交的许愿内容，以便过滤不合适的内容后再展示给社区。

#### 验收标准

1. WHEN Admin_User 审核许愿时，THE Wish_Pool_System SHALL 支持两种操作：批准（approve）和拒绝（reject）
2. WHEN 许愿被批准时，THE Wish_Pool_System SHALL 将 Wish_Status 从 `pending` 更新为 `approved`
3. WHEN 许愿被拒绝时，THE Wish_Pool_System SHALL 将 Wish_Status 更新为 `closed`，并记录关闭原因（closeReason），closeReason 为必填字段（1-200 个字符）
4. THE Wish_Pool_System SHALL 仅允许 Admin_User 执行审核操作
5. WHEN 许愿状态不是 `pending` 时，THE Wish_Pool_System SHALL 拒绝审核操作，并返回错误码 `INVALID_STATUS_TRANSITION`

### 需求 3：社区投票

**用户故事：** 作为社区用户，我希望给感兴趣的许愿投票（+1），以便表达我对该周边商品的支持。

#### 验收标准

1. WHEN 用户对一条 `approved` 状态的许愿投票时，THE Wish_Pool_System SHALL 将该 Wish 的 Vote_Count 加 1
2. THE Wish_Pool_System SHALL 使用 wishId + voterId 复合键确保每位用户对同一条许愿只能投票一次
3. WHEN 用户对同一条许愿重复投票时，THE Wish_Pool_System SHALL 拒绝操作，并返回错误码 `ALREADY_VOTED`
4. WHEN 许愿状态不是 `approved` 时，THE Wish_Pool_System SHALL 拒绝投票操作，并返回错误码 `WISH_NOT_VOTABLE`
5. THE Wish_Pool_System SHALL 不允许 Wish_Author 对自己的许愿投票，并返回错误码 `CANNOT_VOTE_OWN_WISH`
6. THE Wish_Pool_System SHALL 不支持取消投票，投票为单向不可逆操作

### 需求 4：许愿池浏览

**用户故事：** 作为社区用户，我希望浏览许愿池中已通过审核的许愿列表，以便发现感兴趣的周边商品需求并投票支持。

#### 验收标准

1. THE Wish_Pool_System SHALL 提供许愿列表查询接口，仅返回状态为 `approved`、`adopted` 或 `fulfilled` 的许愿
2. THE Wish_Pool_System SHALL 支持两种排序方式：按投票数降序（热度）和按创建时间降序（最新）
3. THE Wish_Pool_System SHALL 支持分页查询，每页默认返回 20 条记录
4. THE Wish_Pool_System SHALL 在列表中返回每条许愿的标题、描述、参考图片 URL、投票数、状态和创建时间
5. WHEN 已登录用户浏览列表时，THE Wish_Pool_System SHALL 标记当前用户是否已对每条许愿投过票
6. WHILE `wishPoolEnabled` 为 `false` 时，THE Wish_Pool_System SHALL 仍允许浏览已有的许愿列表（只读），但隐藏投票和提交入口

### 需求 5：我的许愿

**用户故事：** 作为社区用户，我希望查看自己提交的所有许愿及其当前状态，以便跟踪许愿进展。

#### 验收标准

1. THE Wish_Pool_System SHALL 提供用户个人许愿列表查询接口，返回该用户提交的所有许愿（包含所有状态）
2. THE Wish_Pool_System SHALL 在个人列表中返回每条许愿的标题、描述、状态、投票数、关闭原因（如有）和创建时间
3. THE Wish_Pool_System SHALL 按创建时间降序排列个人许愿列表
4. THE Wish_Pool_System SHALL 显示用户本月剩余可许愿次数（Monthly_Wish_Limit 减去本月已提交数）
5. WHILE `wishPoolEnabled` 为 `false` 时，THE Wish_Pool_System SHALL 仍允许用户查看自己的历史许愿（只读）

### 需求 6：管理员采纳与状态管理

**用户故事：** 作为管理员，我希望根据投票热度将许愿标记为"已采纳"或"已上架"，并能关闭不再需要的许愿，以便管理许愿的生命周期。

#### 验收标准

1. WHEN Admin_User 将许愿标记为"已采纳"时，THE Wish_Pool_System SHALL 将 Wish_Status 从 `approved` 更新为 `adopted`
2. WHEN Admin_User 将许愿标记为"已上架"时，THE Wish_Pool_System SHALL 将 Wish_Status 从 `adopted` 更新为 `fulfilled`，并关联商品 ID（productId），productId 为必填字段
3. WHEN Admin_User 关闭许愿时，THE Wish_Pool_System SHALL 将 Wish_Status 更新为 `closed`，并记录关闭原因（closeReason），closeReason 为必填字段（1-200 个字符）
4. THE Wish_Pool_System SHALL 仅允许以下状态转换：`pending→approved`、`pending→closed`、`approved→adopted`、`approved→closed`、`adopted→fulfilled`、`adopted→closed`
5. WHEN 状态转换不在允许列表中时，THE Wish_Pool_System SHALL 拒绝操作，并返回错误码 `INVALID_STATUS_TRANSITION`
6. THE Wish_Pool_System SHALL 提供管理员许愿列表接口，支持按状态筛选和按投票数降序排列，支持分页查询（每页默认 20 条）
7. WHILE `wishPoolEnabled` 为 `false` 时，THE Wish_Pool_System SHALL 仍允许 Admin_User 执行状态管理操作（审核、采纳、关闭等）

### 需求 7：通知与奖励

**用户故事：** 作为许愿者，我希望在我的许愿被采纳或上架时收到通知并获得积分奖励，以便感受到社区对我贡献的认可。

#### 验收标准

1. WHEN 许愿状态变为 `adopted` 时，THE Notification_System SHALL 向 Wish_Author 发送"许愿被采纳"通知邮件
2. WHEN 许愿状态变为 `fulfilled` 时，THE Notification_System SHALL 向 Wish_Author 发送"许愿已上架"通知邮件，包含商品链接
3. WHEN 许愿状态变为 `fulfilled` 时，THE Wish_Pool_System SHALL 向 Wish_Author 的账户发放 `wishFulfilledRewardPoints` 积分奖励（默认 50 积分，可通过 Feature_Toggles_System 配置）
4. THE Wish_Pool_System SHALL 在 Wish 记录中标记 Wish_Author 拥有该商品的优先购买权（priorityPurchase = true），此标记仅作为信息展示，不影响实际购买流程
5. WHEN 许愿被拒绝（审核不通过）时，THE Notification_System SHALL 向 Wish_Author 发送"许愿未通过审核"通知邮件，包含关闭原因
6. THE Notification_System SHALL 根据 Wish_Author 的用户语言偏好（locale 字段）发送对应语言的通知邮件

### 需求 8：功能开关

**用户故事：** 作为管理员，我希望通过功能开关控制许愿池功能的启用和禁用，以便在需要时灵活管理该功能。

#### 验收标准

1. THE Feature_Toggles_System SHALL 包含一个字段 `wishPoolEnabled`，类型为 `boolean`，默认值为 `false`
2. WHILE `wishPoolEnabled` 为 `false` 时，THE Wish_Pool_System SHALL 拒绝所有许愿提交和投票操作，并返回错误码 `FEATURE_DISABLED`
3. WHILE `wishPoolEnabled` 为 `false` 时，THE Wish_Pool_System SHALL 在前端隐藏许愿池导航入口和提交/投票按钮，但保留已有数据的只读浏览
4. THE Feature_Toggles_System SHALL 允许 SuperAdmin 通过 Settings 页面切换 `wishPoolEnabled` 开关
5. THE Feature_Toggles_System SHALL 包含一个字段 `wishFulfilledRewardPoints`，类型为正整数，默认值为 50，用于配置许愿上架奖励积分数

### 需求 9：数据模型

**用户故事：** 作为系统，我希望许愿池数据模型支持高效的查询和防重复投票，以便保证系统性能和数据一致性。

#### 验收标准

1. THE WishesTable SHALL 作为独立的 DynamoDB 表创建，包含以下字段：wishId（分区键，UUID）、userId、title、description、imageUrl（可选）、status、voteCount、productId（可选）、closeReason（可选）、priorityPurchase（可选布尔）、createdAt、updatedAt
2. THE WishesTable SHALL 提供 GSI（StatusVoteIndex）：分区键为 status，排序键为 voteCount（用于热度排序的许愿列表）
3. THE WishesTable SHALL 提供 GSI（UserWishIndex）：分区键为 userId，排序键为 createdAt（用于"我的许愿"列表）
4. THE WishVotesTable SHALL 作为独立的 DynamoDB 表创建，使用 wishId 作为分区键、voterId 作为排序键，确保复合唯一性
5. THE Wish_Pool_System SHALL 使用 DynamoDB TransactWriteItems 事务操作同时写入投票记录（WishVotesTable）和递增 voteCount（WishesTable），确保原子性
6. FOR ALL 有效的 Wish 记录，Vote_Count SHALL 等于 WishVotesTable 中对应 wishId 的记录数（数据一致性属性）

### 需求 10：国际化支持

**用户故事：** 作为用户，我希望许愿池相关的所有 UI 文案支持多语言，以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Wish_Pool_System 中所有用户可见的文案 SHALL 使用 i18n 翻译键，通过现有的 `useTranslation` 机制加载
2. THE 翻译内容 SHALL 覆盖以下文案：许愿池页面标题、提交表单标签、状态标签、投票按钮、错误提示、通知邮件模板
3. THE 翻译内容 SHALL 支持 5 种语言：简体中文（zh）、英文（en）、日文（ja）、韩文（ko）、繁体中文（zh-TW）
4. THE 翻译键 SHALL 遵循现有的命名规范（`wishPool.*` 前缀）

### 需求 11：许愿编辑与删除

**用户故事：** 作为社区用户，我希望在许愿尚未审核通过前编辑或删除自己的许愿，以便修正错误或撤回不需要的许愿。

#### 验收标准

1. WHEN Wish_Author 编辑自己的许愿时，THE Wish_Pool_System SHALL 仅允许在 `pending` 状态下编辑标题、描述和参考图片
2. WHEN 许愿状态不是 `pending` 时，THE Wish_Pool_System SHALL 拒绝编辑操作，并返回错误码 `WISH_NOT_EDITABLE`
3. WHEN Wish_Author 删除自己的许愿时，THE Wish_Pool_System SHALL 仅允许在 `pending` 状态下删除
4. WHEN 许愿状态不是 `pending` 时，THE Wish_Pool_System SHALL 拒绝删除操作，并返回错误码 `WISH_NOT_DELETABLE`
5. THE Wish_Pool_System SHALL 仅允许 Wish_Author 本人编辑或删除自己的许愿（Admin_User 通过关闭操作管理许愿）
6. WHEN 许愿被删除时，THE Wish_Pool_System SHALL 从 WishesTable 中物理删除该记录，且不计入 Monthly_Wish_Limit（已删除的许愿释放配额）
