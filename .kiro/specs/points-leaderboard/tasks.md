# 实现计划：积分榜单（Points Leaderboard）

## 概述

为社区积分商城系统新增积分榜单模块，包含积分排行榜（Points Ranking）和积分发放公告栏（Points Announcement）两个子功能。涉及：Users 表新增 earnTotal 字段和 earnTotal-index GSI、PointsRecords 表新增 type-createdAt-index GSI、新建 Leaderboard Lambda + 2 条 API Gateway 路由、feature-toggles 扩展 3 个字段、batch-points 和 reservation-approval 中 earnTotal 原子递增、前端 Leaderboard 页面（Tab 切换 + 排行榜 + 公告栏）、Hub 页面入口激活、Settings 页面开关和频率配置、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型扩展
  - [x] 1.1 在 `packages/shared/src/types.ts` 中新增 LeaderboardRankingItem 和 LeaderboardAnnouncementItem 类型
    - `LeaderboardRankingItem` 接口：rank(number), nickname(string), roles(string[]), earnTotal(number)
    - `LeaderboardAnnouncementItem` 接口：recordId(string), recipientNickname(string), amount(number), source(string), createdAt(string), targetRole(string), activityUG?(string), activityDate?(string), activityTopic?(string), activityType?(string), distributorNickname?(string)
    - 导出新增类型
    - _需求: 10.4, 11.4_

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 在 `packages/cdk/lib/database-stack.ts` 中为 Users 表新增 earnTotal-index GSI
    - 分区键: `pk`（String，固定值 "ALL"），排序键: `earnTotal`（Number）
    - 用于按累计获得积分降序查询排行榜
    - _需求: 4.4, 13.7_

  - [x] 2.2 在 `packages/cdk/lib/database-stack.ts` 中为 PointsRecords 表新增 type-createdAt-index GSI
    - 分区键: `type`（String），排序键: `createdAt`（String）
    - 用于按类型和时间查询积分记录（type="earn", ScanIndexForward=false）
    - _需求: 12.1, 12.3, 13.8_

  - [x] 2.3 在 `packages/cdk/lib/api-stack.ts` 中创建 Leaderboard Lambda 和 API Gateway 路由
    - 创建 Leaderboard Lambda 函数，入口为 `packages/backend/src/leaderboard/handler.ts`
    - 注册路由：GET `/api/leaderboard/ranking`、GET `/api/leaderboard/announcements`
    - 为 Leaderboard Lambda 授予 Users 表、PointsRecords 表、BatchDistributions 表的只读权限
    - 将 USERS_TABLE、POINTS_RECORDS_TABLE、BATCH_DISTRIBUTIONS_TABLE、JWT_SECRET 作为环境变量传递
    - 确保路由支持 CORS 预检请求
    - _需求: 13.1~13.10_

  - [x] 2.4 在 `packages/cdk/bin/app.ts` 中传递相关表引用给 ApiStack（如需要）
    - 确保 Leaderboard Lambda 能访问所需的 DynamoDB 表
    - _需求: 13.6_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型编译通过、CDK 代码编译通过，新增 GSI、Lambda 和路由定义正确。如有问题请向用户确认。

- [x] 4. 后端 feature-toggles 扩展
  - [x] 4.1 修改 `packages/backend/src/settings/feature-toggles.ts` 扩展 FeatureToggles 接口和相关函数
    - 在 `FeatureToggles` 接口中新增 3 个字段：leaderboardRankingEnabled(boolean, 默认 false)、leaderboardAnnouncementEnabled(boolean, 默认 false)、leaderboardUpdateFrequency('daily'|'weekly'|'monthly', 默认 'weekly')
    - 更新 `DEFAULT_TOGGLES` 常量添加默认值
    - 更新 `getFeatureToggles` 函数读取新字段（leaderboardRankingEnabled/leaderboardAnnouncementEnabled 默认 false，leaderboardUpdateFrequency 默认 'weekly'）
    - 更新 `UpdateFeatureTogglesInput` 接口和 `updateFeatureToggles` 函数支持新字段的写入
    - 新增 leaderboardUpdateFrequency 值校验：仅接受 'daily'、'weekly'、'monthly'，无效值返回 INVALID_REQUEST
    - _需求: 14.1~14.5_

  - [x] 4.2 编写 feature-toggles 扩展单元测试
    - 更新 feature-toggles 相关测试，验证新增字段的读取默认值、写入和校验逻辑
    - 测试 leaderboardUpdateFrequency 无效值被拒绝
    - _需求: 14.4, 14.5_

- [x] 5. 后端 earnTotal 字段维护
  - [x] 5.1 修改 `packages/backend/src/admin/batch-points.ts` 中 `executeBatchDistribution` 函数
    - 在 TransactWriteCommand 的每个用户 Update 操作中，将 UpdateExpression 从 `SET points = points + :pv, updatedAt = :now` 修改为 `SET points = points + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, pk = :pk, updatedAt = :now`
    - 在 ExpressionAttributeValues 中新增 `:zero`(0) 和 `:pk`("ALL")
    - _需求: 4.1_

  - [x] 5.2 修改 `packages/backend/src/content/reservation-approval.ts` 中 `reviewReservation` 函数
    - 在 approve 事务的 Update Users 操作中，将 UpdateExpression 从 `SET points = points + :pv, updatedAt = :now` 修改为 `SET points = points + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, pk = :pk, updatedAt = :now`
    - 在 ExpressionAttributeValues 中新增 `:zero`(0) 和 `:pk`("ALL")
    - _需求: 4.2_

  - [x] 5.3 编写 earnTotal 原子递增属性测试
    - **Property 4: earnTotal is atomically incremented by the exact points amount during distribution**
    - 创建 `packages/backend/src/admin/batch-points-earnTotal.property.test.ts`
    - 使用 fast-check 生成随机初始 earnTotal 值和积分数量，验证批量发放后 earnTotal 增量等于发放积分数，且与 points 更新在同一事务中
    - **验证: 需求 4.1, 4.2, 4.3**

- [x] 6. 后端 Leaderboard Lambda — 排行榜模块
  - [x] 6.1 创建 `packages/backend/src/leaderboard/ranking.ts` 实现排行榜查询逻辑
    - 实现 `validateRankingParams(query)` 函数：校验 role（all/Speaker/UserGroupLeader/Volunteer，默认 all）、limit（1~50，默认 20）、lastKey（可选 base64 分页游标）
    - 实现 `isEligibleForRanking(roles)` 函数：判断用户是否拥有至少一个普通角色（Speaker/UserGroupLeader/Volunteer）
    - 实现 `filterByRole(users, role)` 函数：按角色过滤用户列表
    - 实现 `getRanking(options, dynamoClient, usersTable)` 函数：
      - 查询 Users 表 earnTotal-index GSI（pk="ALL", ScanIndexForward=false）
      - 过量查询（limit * 3）以应对角色过滤后数据不足
      - 应用层角色过滤 + 排名序号计算
      - 返回分页结果（items + lastKey）
    - _需求: 3.1~3.6, 10.1~10.5_

  - [x] 6.2 编写排行榜排序和字段完整性属性测试
    - **Property 1: Ranking results are sorted by earnTotal descending and contain all required fields**
    - 创建 `packages/backend/src/leaderboard/ranking.property.test.ts`
    - 使用 fast-check 生成随机用户集合（含不同 earnTotal 值），验证排行榜结果按 earnTotal 降序排列，每条记录包含有效 rank（正整数）、非空 nickname、非空 roles 数组（仅普通角色）、非负 earnTotal
    - **验证: 需求 3.1, 3.6, 10.4**

  - [x] 6.3 编写角色过滤正确性属性测试
    - **Property 2: Role filtering returns only eligible users with matching roles**
    - 在 `packages/backend/src/leaderboard/ranking.property.test.ts` 中添加
    - 使用 fast-check 生成随机用户集合（混合角色分配）和角色过滤值，验证：特定角色过滤时所有返回用户拥有该角色；All 过滤时所有返回用户拥有至少一个普通角色；仅有管理角色的用户被排除
    - **验证: 需求 3.2, 3.3, 3.4**

  - [x] 6.4 编写排行榜单元测试
    - 创建 `packages/backend/src/leaderboard/ranking.test.ts`
    - 测试 validateRankingParams：有效参数、无效 role 值、limit 超范围、lastKey 解码失败
    - 测试 isEligibleForRanking：纯管理角色返回 false、含普通角色返回 true
    - 测试 filterByRole：各角色过滤正确性
    - _需求: 3.1~3.6_

- [x] 7. 后端 Leaderboard Lambda — 公告栏模块
  - [x] 7.1 创建 `packages/backend/src/leaderboard/announcements.ts` 实现公告栏查询逻辑
    - 实现 `isBatchRecord(source)` 函数：判断 source 是否以"批量发放:"开头
    - 实现 `isReservationRecord(source)` 函数：判断 source 是否以"预约审批:"开头
    - 实现 `getAnnouncements(options, dynamoClient, tables)` 函数：
      - 查询 PointsRecords 表 type-createdAt-index GSI（type="earn", ScanIndexForward=false）
      - BatchGet Users 表获取接收人昵称
      - 对批量发放记录，BatchGet BatchDistributions 表获取发放人昵称
      - 组装 AnnouncementItem 返回分页结果
    - _需求: 6.1~6.5, 11.1~11.5_

  - [x] 7.2 编写公告栏查询属性测试
    - **Property 5: Announcement query returns only earn records, sorted by time, with correct fields**
    - 创建 `packages/backend/src/leaderboard/announcements.property.test.ts`
    - 使用 fast-check 生成混合 type（earn/spend）的 PointsRecords，验证公告栏仅返回 type="earn" 记录、按 createdAt 降序、字段完整（批量发放记录含 distributorNickname）
    - **验证: 需求 6.1, 6.2, 6.4, 6.5, 11.4**

  - [x] 7.3 编写公告栏单元测试
    - 创建 `packages/backend/src/leaderboard/announcements.test.ts`
    - 测试 isBatchRecord 和 isReservationRecord 函数
    - 测试 getAnnouncements 的分页、昵称关联、字段组装
    - _需求: 6.1~6.5_

- [x] 8. 后端 Leaderboard Lambda — Handler 路由
  - [x] 8.1 创建 `packages/backend/src/leaderboard/handler.ts` 实现 Leaderboard Lambda 入口
    - 读取环境变量：USERS_TABLE、POINTS_RECORDS_TABLE、BATCH_DISTRIBUTIONS_TABLE、JWT_SECRET
    - 实现 JWT 验证和角色权限校验（排除 OrderAdmin）
    - 路由分发：GET `/api/leaderboard/ranking` → handleGetRanking、GET `/api/leaderboard/announcements` → handleGetAnnouncements
    - 统一错误处理和 CORS 响应头
    - _需求: 10.1~10.5, 11.1~11.5, 15.1~15.4_

  - [x] 8.2 编写 Leaderboard Handler 路由单元测试
    - 创建 `packages/backend/src/leaderboard/handler.test.ts`
    - 测试路由分发正确性、JWT 验证、OrderAdmin 拦截（403）、未登录拦截（401）
    - _需求: 15.1~15.4_

- [x] 9. 检查点 - 后端模块验证
  - 运行所有后端相关测试（feature-toggles、batch-points、reservation-approval、leaderboard 模块），确保逻辑正确。如有问题请向用户确认。

- [x] 10. 分页完整性属性测试
  - [x] 10.1 编写分页完整性属性测试
    - **Property 3: Paginating through all pages yields the complete sorted dataset**
    - 创建 `packages/backend/src/leaderboard/pagination.property.test.ts`
    - 使用 fast-check 生成随机数据集和页大小，验证遍历所有分页（跟随 lastKey 直到 null）后拼接结果等于完整排序数据集，无重复无遗漏
    - **验证: 需求 3.5, 6.3, 10.5, 11.5**

- [x] 11. 前端 Leaderboard 页面
  - [x] 11.1 在 `packages/frontend/src/app.config.ts` 中注册 Leaderboard 页面路由
    - 在 pages 数组中添加 `'pages/leaderboard/index'`
    - _需求: 1.1_

  - [x] 11.2 创建 `packages/frontend/src/pages/leaderboard/index.tsx` 实现积分榜单页面
    - 页面加载时调用 GET `/api/settings/feature-toggles` 获取开关状态
    - 根据 leaderboardRankingEnabled 和 leaderboardAnnouncementEnabled 决定 Tab 可见性：
      - 两个都开启：显示 Tab 切换（排行榜 + 公告栏），默认排行榜
      - 仅排行榜开启：直接显示排行榜，不显示 Tab 切换
      - 仅公告栏开启：直接显示公告栏，不显示 Tab 切换
      - 两个都关闭：显示功能未开放提示
    - Tab 切换时保持另一个 Tab 的滚动位置
    - _需求: 2.1~2.7_

  - [x] 11.3 实现排行榜 Tab 组件
    - 顶部 Role_Tab 切换栏：All / Speaker / Leader / Volunteer，默认 All
    - 切换 Role_Tab 时调用 GET `/api/leaderboard/ranking?role=xxx&limit=20`
    - 列表项：排名序号（前三名金银铜色）、用户昵称、角色徽章（.role-badge）、累计获得积分
    - 底部更新频率文案（根据 leaderboardUpdateFrequency 配置显示）
    - 下拉加载更多（分页）
    - 骨架屏加载状态、空状态提示
    - _需求: 5.1~5.9_

  - [x] 11.4 实现公告栏 Tab 组件
    - 按时间倒序展示积分发放记录
    - 批量发放格式：「管理员 {发放人昵称} 为 {activityUG}（{activityDate}）的活动 给 {targetRole} 身份的 {接收人昵称} 发放了 {amount} 积分」
    - 预约审批格式：「{接收人昵称} 预约了 {activityUG}（{activityDate}）的活动「{activityTopic}」，获得 {amount} 积分」
    - 每条记录显示相对时间（如"3 天前"）和角色徽章
    - 下拉加载更多（每次 20 条）
    - 骨架屏加载状态、空状态提示
    - _需求: 7.1~7.8_

  - [x] 11.5 创建 `packages/frontend/src/pages/leaderboard/index.scss` 页面样式
    - 遵循前端设计规范：使用 CSS 变量（颜色、间距、圆角、过渡）
    - 排行榜前三名特殊样式（金 #FFD700、银 #C0C0C0、铜 #CD7F32 使用 CSS 变量）
    - Tab 切换、Role_Tab 切换、列表项、公告栏记录卡片样式
    - 骨架屏和空状态样式
    - _需求: 5.4, 5.5, 7.2, 7.3_

- [x] 12. 前端 Hub 页面入口激活
  - [x] 12.1 修改 Hub 页面移除"积分榜单"卡片的 Coming Soon 标记
    - 修改 `packages/frontend/src/pages/hub/index.tsx`
    - 使卡片可点击，点击后导航到 `/pages/leaderboard/index`
    - OrderAdmin 角色不显示此卡片
    - _需求: 1.1, 1.2, 1.4_

- [x] 13. 前端 Settings 页面扩展
  - [x] 13.1 修改 `packages/frontend/src/pages/admin/settings.tsx` 新增积分榜单配置区域
    - 新增两个独立开关：leaderboardRankingEnabled（积分排行榜开关）、leaderboardAnnouncementEnabled（积分发放公告栏开关）
    - 新增更新频率配置项：leaderboardUpdateFrequency 下拉选择（daily / weekly / monthly）
    - 保存时调用 PUT `/api/admin/settings/feature-toggles` 更新配置
    - 仅 SuperAdmin 可见
    - _需求: 8.1~8.6, 9.1~9.5_

- [x] 14. Tab 可见性属性测试
  - [x] 14.1 编写 Tab 可见性属性测试
    - **Property 6: Tab visibility is determined by toggle state**
    - 创建 `packages/frontend/src/pages/leaderboard/tab-visibility.property.test.ts`（或在后端测试中实现纯函数版本）
    - 使用 fast-check 生成所有 (rankingEnabled, announcementEnabled) 布尔组合，验证：两个都 true 时两个 Tab 可见；仅一个 true 时对应 Tab 可见且无切换器；两个都 false 时显示功能未开放
    - **验证: 需求 2.4, 2.5, 2.6, 2.7, 8.3, 8.4**

- [x] 15. 更新频率校验属性测试
  - [x] 15.1 编写更新频率校验属性测试
    - **Property 7: Update frequency validation accepts only valid values**
    - 创建 `packages/backend/src/settings/feature-toggles-frequency.property.test.ts`
    - 使用 fast-check 生成随机字符串，验证仅 "daily"、"weekly"、"monthly" 被接受，其他值（含空字符串、null、undefined、任意字符串）被拒绝并返回 INVALID_REQUEST
    - **验证: 需求 14.4, 14.5**

- [x] 16. i18n 多语言翻译
  - [x] 16.1 在 `packages/frontend/src/i18n/types.ts` 中扩展 TranslationDict 类型
    - 新增 `leaderboard` 模块，包含以下翻译键类别：
      - 页面标题和 Tab 标签（title, tabRanking, tabAnnouncement）
      - 角色筛选标签（roleAll, roleSpeaker, roleLeader, roleVolunteer）
      - 排行榜列表文案（rank, nickname, earnTotal, updateFrequencyDaily, updateFrequencyWeekly, updateFrequencyMonthly）
      - 公告栏记录格式文案（batchTemplate, reservationTemplate）
      - 空状态和加载状态提示（rankingEmpty, announcementEmpty, loading）
      - 功能未开放提示（featureDisabled）
    - 在 `admin.settings` 中新增积分榜单配置相关翻译键（leaderboardRankingLabel, leaderboardRankingDesc, leaderboardAnnouncementLabel, leaderboardAnnouncementDesc, leaderboardUpdateFrequencyLabel, leaderboardUpdateFrequencyDesc, frequencyDaily, frequencyWeekly, frequencyMonthly）
    - _需求: 16.1, 16.4_

  - [x] 16.2 在 5 种语言文件中添加翻译
    - `packages/frontend/src/i18n/zh.ts`：简体中文翻译
    - `packages/frontend/src/i18n/zh-TW.ts`：繁体中文翻译
    - `packages/frontend/src/i18n/en.ts`：英文翻译
    - `packages/frontend/src/i18n/ja.ts`：日文翻译
    - `packages/frontend/src/i18n/ko.ts`：韩文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 16.2_

  - [x] 16.3 确保前端页面中所有用户可见文本使用 `useTranslation` hook 和 `t()` 函数，不硬编码任何字符串
    - _需求: 16.3_

- [x] 17. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- Users 表新增 earnTotal 字段和 pk 字段（固定值 "ALL"），通过 earnTotal-index GSI 实现高效排行榜查询
- earnTotal 通过 DynamoDB 事务与 points 同步更新，使用 `if_not_exists(earnTotal, :zero)` 处理历史用户
- PointsRecords 表新增 type-createdAt-index GSI，用于公告栏高效查询 type="earn" 记录
- 新建独立 Leaderboard Lambda，仅需读权限，与现有 Admin/Points Lambda 解耦
- feature-toggles 复用现有配置机制，新增 3 个字段控制榜单功能
- 前端遵循现有设计系统，使用 CSS 变量和全局组件类
- 属性测试覆盖设计文档中定义的 7 个正确性属性
- 检查点任务用于阶段性验证，确保增量开发的正确性
