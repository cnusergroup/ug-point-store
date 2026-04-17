# 需求文档：积分榜单（Points Leaderboard）

## 简介

本功能为社区积分商城系统新增积分榜单模块，包含两个核心子功能：

1. **积分排行榜**：按用户累计获得积分（所有 type="earn" 的 PointsRecords 的 amount 总和）进行排名，支持按身份（Speaker、Leader、Volunteer）分类查看和总排名（All），显示所有用户，支持分页。页面文案标注更新频率（默认"每周更新"），管理员可配置频率文案。
2. **积分发放公告栏**：展示系统中所有积分发放的完整历史记录，目的是让社区成员互相监督。记录来源于 PointsRecords 表中 type="earn" 的记录，按两种格式展示（批量发放和预约审批），支持分页加载。

入口位于 Hub 页面现有的"积分榜单"卡片（当前标记为 Coming Soon），登录用户可访问，OrderAdmin 角色除外。管理员可通过 feature-toggles 独立控制积分排行榜和积分发放公告栏的显示/隐藏。

## 术语表

- **Leaderboard_Page（积分榜单页面）**：包含积分排行榜和积分发放公告栏两个 Tab 的前端页面
- **Points_Ranking（积分排行榜）**：按用户累计获得积分排名的列表视图
- **Points_Announcement（积分发放公告栏）**：展示所有积分发放历史记录的列表视图
- **Earn_Total（累计获得积分）**：用户所有 type="earn" 的 PointsRecords 记录的 amount 总和
- **Leaderboard_Service（榜单服务）**：处理积分排行榜和公告栏数据查询的后端服务模块
- **Leaderboard_Config（榜单配置）**：存储在 feature-toggles 中的榜单相关配置项，包含显示开关和更新频率文案
- **Role_Tab（身份分类标签）**：积分排行榜中按用户角色筛选的标签页，包含 All、Speaker、Leader、Volunteer
- **Batch_Record（批量发放记录）**：由管理员批量发放产生的 PointsRecords 记录，source 字段以"批量发放:"开头
- **Reservation_Record（预约审批记录）**：由预约审批通过产生的 PointsRecords 记录，source 字段以"预约审批通过:"开头
- **Settings_Page（设置页面）**：SuperAdmin 管理面板中的系统设置页面
- **Hub_Page（Hub 页面）**：应用首页，包含积分榜单入口卡片

## 需求

### 需求 1：积分榜单页面入口

**用户故事：** 作为登录用户，我希望从 Hub 页面进入积分榜单，以便查看积分排名和发放记录。

#### 验收标准

1. WHEN 登录用户点击 Hub_Page 中的"积分榜单"卡片, THE Hub_Page SHALL 导航到 Leaderboard_Page（路由 /pages/leaderboard/index）
2. THE Hub_Page SHALL 移除"积分榜单"卡片上的 Coming Soon 标记，使其成为可点击的活跃入口
3. IF 用户未登录, THEN THE Leaderboard_Page SHALL 重定向到登录页面
4. IF 用户拥有 OrderAdmin 角色, THEN THE Hub_Page SHALL 不显示"积分榜单"卡片（OrderAdmin 布局中不包含此入口）

### 需求 2：积分榜单页面结构

**用户故事：** 作为登录用户，我希望在积分榜单页面通过 Tab 切换查看排行榜和公告栏，以便方便地浏览不同类型的积分信息。

#### 验收标准

1. THE Leaderboard_Page SHALL 包含两个顶级 Tab：积分排行榜（Points Ranking）和积分发放公告栏（Points Announcement）
2. THE Leaderboard_Page SHALL 默认显示积分排行榜 Tab
3. WHEN 用户切换 Tab, THE Leaderboard_Page SHALL 显示对应 Tab 的内容，保持另一个 Tab 的滚动位置
4. THE Leaderboard_Page SHALL 根据 Leaderboard_Config 中的开关配置决定每个 Tab 的可见性
5. IF 积分排行榜开关关闭且积分发放公告栏开关开启, THEN THE Leaderboard_Page SHALL 仅显示积分发放公告栏，不显示 Tab 切换
6. IF 积分排行榜开关开启且积分发放公告栏开关关闭, THEN THE Leaderboard_Page SHALL 仅显示积分排行榜，不显示 Tab 切换
7. IF 两个开关均关闭, THEN THE Leaderboard_Page SHALL 显示功能未开放提示信息

### 需求 3：积分排行榜 — 数据查询

**用户故事：** 作为系统，我希望按用户累计获得积分计算排名，以便准确反映每位用户的积分贡献。

#### 验收标准

1. WHEN Leaderboard_Service 收到排行榜查询请求, THE Leaderboard_Service SHALL 从 Users 表查询用户列表，按用户的 earnTotal 字段降序排列
2. THE Leaderboard_Service SHALL 支持按角色筛选：All（所有用户）、Speaker（拥有 Speaker 角色的用户）、UserGroupLeader（拥有 UserGroupLeader 角色的用户）、Volunteer（拥有 Volunteer 角色的用户）
3. WHEN 筛选条件为 All, THE Leaderboard_Service SHALL 返回所有拥有至少一个普通角色（Speaker、UserGroupLeader、Volunteer）的用户
4. THE Leaderboard_Service SHALL 排除 Admin、SuperAdmin、OrderAdmin 角色的用户（仅当用户不同时拥有任何普通角色时排除）
5. THE Leaderboard_Service SHALL 支持分页查询，默认每页 20 条，返回分页游标 lastKey
6. THE Leaderboard_Service SHALL 在每条排名记录中返回：排名序号、用户昵称、用户角色列表（仅普通角色）、累计获得积分（earnTotal）

### 需求 4：积分排行榜 — 累计获得积分字段维护

**用户故事：** 作为系统，我希望在用户获得积分时同步更新累计获得积分字段，以便排行榜查询无需实时聚合 PointsRecords。

#### 验收标准

1. WHEN 用户通过批量发放获得积分, THE Batch_Distribution_Service SHALL 在更新用户 points 余额的同时，原子性地增加用户的 earnTotal 字段（增量等于发放的积分数）
2. WHEN 用户通过预约审批获得积分, THE Reservation_Approval_Service SHALL 在更新用户 points 余额的同时，原子性地增加用户的 earnTotal 字段（增量等于发放的积分数）
3. IF 用户记录中 earnTotal 字段不存在, THEN THE Leaderboard_Service SHALL 将其视为 0
4. THE Users 表 SHALL 新增 GSI（earnTotal-index），以固定分区键 pk（值为"ALL"）和排序键 earnTotal，用于按累计获得积分降序查询排行榜

### 需求 5：积分排行榜 — 前端展示

**用户故事：** 作为登录用户，我希望查看按身份分类的积分排名，以便了解不同角色群体的积分贡献情况。

#### 验收标准

1. THE Points_Ranking SHALL 在顶部显示 Role_Tab 切换栏，包含 All、Speaker、Leader、Volunteer 四个标签
2. THE Points_Ranking SHALL 默认选中 All 标签
3. WHEN 用户切换 Role_Tab, THE Points_Ranking SHALL 调用排行榜查询接口获取对应角色的排名数据
4. THE Points_Ranking SHALL 在列表中显示每条排名记录的：排名序号、用户昵称、用户角色徽章（使用全局 .role-badge 类）、累计获得积分
5. THE Points_Ranking SHALL 对前三名使用特殊视觉样式（金、银、铜色排名序号）
6. THE Points_Ranking SHALL 在列表底部显示更新频率文案（如"排行榜每周更新"），文案内容从 Leaderboard_Config 读取
7. THE Points_Ranking SHALL 支持下拉加载更多数据（分页）
8. WHILE 数据加载中, THE Points_Ranking SHALL 显示骨架屏加载状态
9. IF 排行榜数据为空, THEN THE Points_Ranking SHALL 显示空状态提示

### 需求 6：积分发放公告栏 — 数据查询

**用户故事：** 作为系统，我希望查询所有积分发放记录，以便在公告栏中展示完整的发放历史。

#### 验收标准

1. WHEN Leaderboard_Service 收到公告栏查询请求, THE Leaderboard_Service SHALL 从 PointsRecords 表查询所有 type="earn" 的记录
2. THE Leaderboard_Service SHALL 按 createdAt 降序排列返回结果
3. THE Leaderboard_Service SHALL 支持分页查询，默认每页 20 条，返回分页游标 lastKey
4. THE Leaderboard_Service SHALL 在每条记录中返回：recordId、接收人昵称（通过 userId 关联 Users 表查询）、积分数量（amount）、来源（source）、创建时间（createdAt）、目标角色（targetRole）、活动信息（activityId、activityType、activityUG、activityTopic、activityDate）
5. THE Leaderboard_Service SHALL 为批量发放记录（source 以"批量发放:"开头）额外返回发放人昵称（通过 BatchDistributions 表或 source 字段解析）

### 需求 7：积分发放公告栏 — 前端展示

**用户故事：** 作为登录用户，我希望查看所有积分发放记录，以便了解积分发放情况并互相监督。

#### 验收标准

1. THE Points_Announcement SHALL 按时间倒序展示积分发放记录列表
2. WHEN 记录为批量发放类型（source 以"批量发放:"开头）, THE Points_Announcement SHALL 以以下格式展示：「管理员 {发放人昵称} 为 {activityUG}（{activityDate}）的活动 给 {targetRole} 身份的 {接收人昵称} 发放了 {amount} 积分」
3. WHEN 记录为预约审批类型（source 以"预约审批通过:"开头）, THE Points_Announcement SHALL 以以下格式展示：「{接收人昵称} 预约了 {activityUG}（{activityDate}）的活动「{activityTopic}」，获得 {amount} 积分」
4. THE Points_Announcement SHALL 为每条记录显示发放时间（相对时间格式，如"3 天前"）
5. THE Points_Announcement SHALL 为 targetRole 显示对应的角色徽章（使用全局 .role-badge 类）
6. THE Points_Announcement SHALL 支持下拉加载更多数据（每次 20 条）
7. WHILE 数据加载中, THE Points_Announcement SHALL 显示骨架屏加载状态
8. IF 公告栏数据为空, THEN THE Points_Announcement SHALL 显示空状态提示

### 需求 8：管理员配置 — 显示开关

**用户故事：** 作为 SuperAdmin，我希望独立控制积分排行榜和积分发放公告栏的显示/隐藏，以便灵活管理榜单功能的可见性。

#### 验收标准

1. THE Settings_Page SHALL 在功能开关设置区域新增两个独立开关：leaderboardRankingEnabled（积分排行榜开关）和 leaderboardAnnouncementEnabled（积分发放公告栏开关）
2. THE Leaderboard_Config SHALL 将 leaderboardRankingEnabled 和 leaderboardAnnouncementEnabled 存储在现有 feature-toggles 配置记录中
3. WHEN feature-toggles 记录中 leaderboardRankingEnabled 字段不存在, THE Leaderboard_Service SHALL 将其视为 false（默认关闭）
4. WHEN feature-toggles 记录中 leaderboardAnnouncementEnabled 字段不存在, THE Leaderboard_Service SHALL 将其视为 false（默认关闭）
5. WHEN SuperAdmin 切换开关状态并保存, THE Settings_Page SHALL 调用 PUT /api/admin/settings/feature-toggles 接口更新配置
6. THE Leaderboard_Page SHALL 在加载时调用 GET /api/settings/feature-toggles 获取开关状态，根据配置决定显示哪些 Tab

### 需求 9：管理员配置 — 更新频率文案

**用户故事：** 作为 SuperAdmin，我希望配置积分排行榜的更新频率文案，以便向用户传达排行榜的更新周期。

#### 验收标准

1. THE Settings_Page SHALL 在功能开关设置区域提供更新频率文案配置项，选项为：daily（每天更新）、weekly（每周更新）、monthly（每月更新）
2. THE Leaderboard_Config SHALL 将 leaderboardUpdateFrequency 存储在现有 feature-toggles 配置记录中，默认值为 weekly
3. WHEN SuperAdmin 修改更新频率并保存, THE Settings_Page SHALL 调用配置更新接口持久化新值
4. THE Points_Ranking SHALL 根据 leaderboardUpdateFrequency 配置值显示对应的更新频率文案（如"排行榜每周更新"）
5. IF leaderboardUpdateFrequency 配置不存在, THEN THE Points_Ranking SHALL 显示默认文案"排行榜每周更新"

### 需求 10：积分排行榜 API

**用户故事：** 作为开发者，我希望提供积分排行榜查询接口，以便前端获取排名数据。

#### 验收标准

1. THE Leaderboard_Service SHALL 提供 GET /api/leaderboard/ranking 接口，支持以下查询参数：role（筛选角色，取值为 all、Speaker、UserGroupLeader、Volunteer，默认 all）、limit（每页条数，默认 20，最大 50）、lastKey（分页游标）
2. WHEN 请求者未登录, THE Leaderboard_Service SHALL 返回 401 错误码 UNAUTHORIZED
3. WHEN 请求者拥有 OrderAdmin 角色, THE Leaderboard_Service SHALL 返回 403 错误码 FORBIDDEN 和消息"无权访问"
4. THE Leaderboard_Service SHALL 返回排名列表，每条记录包含：rank（排名序号）、nickname（用户昵称）、roles（用户普通角色列表）、earnTotal（累计获得积分）
5. THE Leaderboard_Service SHALL 返回分页信息：items（排名列表）、lastKey（下一页游标，无更多数据时为 null）

### 需求 11：积分发放公告栏 API

**用户故事：** 作为开发者，我希望提供积分发放公告栏查询接口，以便前端获取发放记录数据。

#### 验收标准

1. THE Leaderboard_Service SHALL 提供 GET /api/leaderboard/announcements 接口，支持以下查询参数：limit（每页条数，默认 20，最大 50）、lastKey（分页游标）
2. WHEN 请求者未登录, THE Leaderboard_Service SHALL 返回 401 错误码 UNAUTHORIZED
3. WHEN 请求者拥有 OrderAdmin 角色, THE Leaderboard_Service SHALL 返回 403 错误码 FORBIDDEN 和消息"无权访问"
4. THE Leaderboard_Service SHALL 返回公告列表，每条记录包含：recordId、recipientNickname（接收人昵称）、amount（积分数量）、source（来源标识）、createdAt（创建时间）、targetRole（目标角色）、activityUG（所属 UG）、activityDate（活动日期）、activityTopic（活动主题）、activityType（活动类型）、distributorNickname（发放人昵称，仅批量发放记录）
5. THE Leaderboard_Service SHALL 返回分页信息：items（公告列表）、lastKey（下一页游标，无更多数据时为 null）

### 需求 12：PointsRecords 表查询优化

**用户故事：** 作为系统，我希望高效查询所有 type="earn" 的积分记录，以便公告栏接口能快速返回数据。

#### 验收标准

1. THE PointsRecords 表 SHALL 新增 GSI（type-createdAt-index），以 type 为分区键、createdAt 为排序键，用于按类型和时间查询积分记录
2. THE Leaderboard_Service SHALL 使用 type-createdAt-index GSI 查询 type="earn" 的记录，按 createdAt 降序排列
3. THE CDK_Stack SHALL 在 DatabaseStack 中为 PointsRecords 表添加 type-createdAt-index GSI

### 需求 13：CDK 基础设施配置

**用户故事：** 作为开发者，我希望在 CDK 中配置积分榜单所需的 Lambda、API Gateway 路由和 GSI，以便基础设施支持新功能。

#### 验收标准

1. THE CDK_Stack SHALL 创建 Leaderboard Lambda 函数，用于处理积分榜单相关的 API 请求
2. THE CDK_Stack SHALL 在 API Gateway 中注册以下路由，集成到 Leaderboard Lambda：GET /api/leaderboard/ranking（积分排行榜查询）、GET /api/leaderboard/announcements（积分发放公告栏查询）
3. THE CDK_Stack SHALL 为 Leaderboard Lambda 授予 Users 表的读权限
4. THE CDK_Stack SHALL 为 Leaderboard Lambda 授予 PointsRecords 表的读权限
5. THE CDK_Stack SHALL 为 Leaderboard Lambda 授予 BatchDistributions 表的读权限（用于查询发放人昵称）
6. THE CDK_Stack SHALL 将 Users 表名、PointsRecords 表名、BatchDistributions 表名作为环境变量传递给 Leaderboard Lambda
7. THE CDK_Stack SHALL 为 Users 表新增 GSI（earnTotal-index），以 pk 为分区键（固定值"ALL"）、earnTotal 为排序键
8. THE CDK_Stack SHALL 为 PointsRecords 表新增 GSI（type-createdAt-index），以 type 为分区键、createdAt 为排序键
9. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求
10. THE CDK_Stack SHALL 确保 Leaderboard Lambda 拥有读取 JWT Secret 的 SSM 参数权限（用于身份认证）

### 需求 14：feature-toggles 配置扩展

**用户故事：** 作为开发者，我希望在现有 feature-toggles 配置中新增积分榜单相关字段，以便复用已有的配置机制。

#### 验收标准

1. THE Settings_Record SHALL 在现有 feature-toggles 记录中新增以下字段：leaderboardRankingEnabled（布尔值，默认 false）、leaderboardAnnouncementEnabled（布尔值，默认 false）、leaderboardUpdateFrequency（字符串，取值为 daily / weekly / monthly，默认 weekly）
2. THE Settings_API（GET /api/settings/feature-toggles）SHALL 在响应中包含 leaderboardRankingEnabled、leaderboardAnnouncementEnabled、leaderboardUpdateFrequency 字段
3. THE Admin_Handler（PUT /api/admin/settings/feature-toggles）SHALL 支持更新 leaderboardRankingEnabled、leaderboardAnnouncementEnabled、leaderboardUpdateFrequency 字段
4. THE Admin_Handler SHALL 验证 leaderboardUpdateFrequency 的值为 daily、weekly 或 monthly 之一
5. IF leaderboardUpdateFrequency 值无效, THEN THE Admin_Handler SHALL 返回错误码 INVALID_REQUEST 和消息"更新频率值无效，取值为 daily、weekly 或 monthly"

### 需求 15：访问权限控制

**用户故事：** 作为系统，我希望限制积分榜单的访问权限，以便确保只有合适的用户能查看榜单数据。

#### 验收标准

1. WHEN 未登录用户访问 GET /api/leaderboard/ranking 或 GET /api/leaderboard/announcements, THE Leaderboard_Service SHALL 返回 401 错误码 UNAUTHORIZED
2. WHEN OrderAdmin 用户访问 GET /api/leaderboard/ranking 或 GET /api/leaderboard/announcements, THE Leaderboard_Service SHALL 返回 403 错误码 FORBIDDEN 和消息"无权访问"
3. WHEN 拥有任意普通角色（Speaker、UserGroupLeader、Volunteer）或管理角色（Admin、SuperAdmin）的登录用户访问积分榜单接口, THE Leaderboard_Service SHALL 正常返回数据
4. THE Leaderboard_Page SHALL 在页面加载时验证用户登录状态和角色权限

### 需求 16：国际化支持

**用户故事：** 作为用户，我希望积分榜单相关的界面文案支持多语言，以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为积分榜单功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：页面标题和 Tab 标签、角色筛选标签（All、Speaker、Leader、Volunteer）、排行榜列表文案（排名、昵称、积分）、更新频率文案（每天更新、每周更新、每月更新）、公告栏记录格式文案（批量发放模板、预约审批模板）、空状态和加载状态提示、管理员设置页面文案（开关标签、频率配置标签）、功能未开放提示
