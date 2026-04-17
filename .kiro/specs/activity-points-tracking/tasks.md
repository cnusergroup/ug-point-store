# 实现计划：活动积分追踪（Activity Points Tracking）

## 概述

为社区积分商城系统新增活动维度的积分追踪能力。涉及 3 个子功能：UG 管理（CRUD + 状态管理）、飞书活动数据同步（Web Scraping + Feishu Open API + EventBridge 定时调度）、积分发放关联活动（扩展现有 batch-points 流程）。新增 2 张 DynamoDB 表（UGs、Activities）、1 个 Sync Lambda、8+ 条 API Gateway 路由、Settings 页面扩展、Batch Points 页面扩展、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型扩展
  - [x] 1.1 新增 UGRecord 和 ActivityRecord 类型定义
    - 在 `packages/shared/src/types.ts` 中新增：
      - `UGRecord` 接口：ugId, name, status('active'|'inactive'), createdAt, updatedAt
      - `ActivityRecord` 接口：activityId, activityType('线上活动'|'线下活动'), ugName, topic, activityDate, syncedAt, sourceUrl
    - 导出新增类型
    - _需求: 1.1, 7.1_

  - [x] 1.2 扩展 DistributionRecord 类型
    - 在 `packages/shared/src/types.ts` 的 `DistributionRecord` 接口中新增可选字段：
      - activityId?: string
      - activityType?: string
      - activityUG?: string
      - activityTopic?: string
      - activityDate?: string
    - _需求: 15.1_

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 UGs DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `UGs` 表：PK=`ugId`（String），PAY_PER_REQUEST 计费
      - GSI `name-index`：PK=`name`（String）— 用于按名称查询和唯一性校验
      - GSI `status-index`：PK=`status`（String），SK=`createdAt`（String）— 用于按状态筛选和排序
    - 导出表的公共属性，添加 CfnOutput
    - _需求: 1.1, 1.2, 1.3, 18.1_

  - [x] 2.2 新增 Activities DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增：
      - `Activities` 表：PK=`activityId`（String），PAY_PER_REQUEST 计费
      - GSI `activityDate-index`：PK=`pk`（String，固定值 "ALL"），SK=`activityDate`（String）— 用于按日期排序查询
      - GSI `dedupeKey-index`：PK=`dedupeKey`（String）— 用于同步去重
    - 导出表的公共属性，添加 CfnOutput
    - _需求: 7.1, 7.2, 18.2_

  - [x] 2.3 更新 ApiStack 添加新表集成和路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `ugsTable` 和 `activitiesTable` 属性
      - 为 Admin Lambda 添加 `UGS_TABLE` 和 `ACTIVITIES_TABLE` 环境变量
      - 为 Admin Lambda 授予 UGs 表和 Activities 表的读写权限
      - 注册管理端路由（集成到 Admin Lambda）：
        - POST `/api/admin/ugs`
        - GET `/api/admin/ugs`
        - PUT `/api/admin/ugs/{ugId}/status`
        - DELETE `/api/admin/ugs/{ugId}`
        - POST `/api/admin/sync/activities`
        - GET `/api/admin/activities`
        - PUT `/api/admin/settings/activity-sync-config`
        - GET `/api/admin/settings/activity-sync-config`
    - 更新 `packages/cdk/bin/app.ts` 传递新表引用给 ApiStack
    - _需求: 18.3, 18.6, 18.8, 18.9_

  - [x] 2.4 创建 Sync Lambda 和 EventBridge 规则
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 创建 Sync Lambda 函数，入口为 `packages/backend/src/sync/handler.ts`
      - 为 Sync Lambda 授予 Activities 表读写权限和 Users 表读权限
      - 将 ACTIVITIES_TABLE 和 USERS_TABLE 环境变量传递给 Sync Lambda
      - 创建 EventBridge 规则，默认每 1 天触发 Sync Lambda
    - _需求: 18.4, 18.5, 18.7, 18.8, 10.1, 10.2_

- [x] 3. 检查点 - 基础设施验证
  - 确保共享类型编译通过、CDK 代码编译通过，新增表、路由和 Lambda 定义正确。如有问题请向用户确认。

- [x] 4. 后端 UG 管理模块
  - [x] 4.1 实现 UG CRUD 核心逻辑
    - 创建 `packages/backend/src/admin/ug.ts`
    - 实现 `validateUGName(name)` 函数：校验 name 为 1~50 字符的非空字符串
    - 实现 `createUG(input, dynamoClient, ugsTable)` 函数：
      - 校验名称有效性
      - 查询 name-index GSI 检查名称唯一性（不区分大小写）
      - 生成 ULID 作为 ugId，status 默认 active
      - PutCommand 写入 UGs 表
    - 实现 `deleteUG(ugId, dynamoClient, ugsTable)` 函数：
      - GetCommand 检查 UG 存在性
      - DeleteCommand 物理删除
    - 实现 `updateUGStatus(ugId, status, dynamoClient, ugsTable)` 函数：
      - GetCommand 检查 UG 存在性
      - UpdateCommand 更新 status 和 updatedAt
    - 实现 `listUGs(options, dynamoClient, ugsTable)` 函数：
      - 支持 status 筛选（all/active/inactive）
      - 使用 status-index GSI 查询（active/inactive），或 Scan（all）
      - 按 createdAt 倒序排列
    - _需求: 2.1~2.4, 3.1~3.4, 4.1~4.4, 5.1~5.4_

  - [x] 4.2 编写 UG 模块单元测试
    - 创建 `packages/backend/src/admin/ug.test.ts`
    - 测试场景：
      - 名称验证：有效名称通过、空字符串拒绝、超长名称拒绝
      - 创建：正常创建、重复名称拒绝（大小写不敏感）
      - 删除：正常删除、不存在的 UG 返回 UG_NOT_FOUND
      - 状态更新：active→inactive、inactive→active、不存在的 UG 返回 UG_NOT_FOUND
      - 列表查询：按状态筛选、倒序排列
    - _需求: 2.1~5.4_

  - [x] 4.3 编写 UG 名称验证属性测试
    - **Property 1: UG name validation accepts valid names and rejects invalid names**
    - 创建 `packages/backend/src/admin/ug.property.test.ts`
    - 使用 fast-check 生成随机字符串，验证 validateUGName 对 1~50 字符非空字符串返回 valid=true，对其他输入返回 valid=false
    - **验证: 需求 2.2**

  - [x] 4.4 编写 UG 名称唯一性属性测试
    - **Property 2: UG name uniqueness is case-insensitive**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中添加
    - 使用 fast-check 生成随机 UG 名称，创建后尝试用大小写变体创建，验证返回 DUPLICATE_UG_NAME
    - **验证: 需求 2.3**

  - [x] 4.5 编写 UG 状态切换往返属性测试
    - **Property 3: UG status toggle is a round-trip**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中添加
    - 使用 fast-check 生成随机 UG，切换状态后验证状态字段正确且 updatedAt 已更新
    - **验证: 需求 4.1, 4.2**

  - [x] 4.6 编写 UG 列表筛选和排序属性测试
    - **Property 4: UG list filtering returns correct results in descending order**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中添加
    - 使用 fast-check 生成随机 UG 集合（混合状态），验证按状态筛选结果正确且按 createdAt 倒序
    - **验证: 需求 5.1, 5.2, 5.3**

- [x] 5. 后端活动同步模块
  - [x] 5.1 实现活动查询逻辑
    - 创建 `packages/backend/src/admin/activities.ts`
    - 实现 `listActivities(options, dynamoClient, activitiesTable)` 函数：
      - 使用 activityDate-index GSI 查询（PK='ALL', ScanIndexForward=false）
      - 支持 ugName 筛选（FilterExpression）
      - 支持 startDate/endDate 日期范围筛选（KeyConditionExpression 或 FilterExpression）
      - 支持 keyword 模糊搜索（FilterExpression contains）
      - pageSize 钳制到 [1, 100]，默认 20
      - 支持 base64 编码的 lastKey 分页游标
    - 实现 `getActivity(activityId, dynamoClient, activitiesTable)` 函数：
      - GetCommand 获取单条记录
      - 不存在时返回 ACTIVITY_NOT_FOUND
    - _需求: 19.1~19.5, 15.3_

  - [x] 5.2 实现飞书同步 Lambda
    - 创建 `packages/backend/src/sync/handler.ts`（Sync Lambda 入口）
    - 创建 `packages/backend/src/sync/feishu-scraper.ts`（Web Scraping 方式）：
      - 访问飞书多维表格公开分享链接
      - 解析 HTML/JSON 响应，提取 activityType、ugName、topic、activityDate 四个字段
      - 返回结构化活动记录数组
    - 创建 `packages/backend/src/sync/feishu-api.ts`（Feishu Open API 方式）：
      - 使用 app_id + app_secret 获取 tenant_access_token
      - 调用 Bitable API 读取表格记录
      - 提取相同的 4 个字段
    - 实现 `syncActivities(config, dynamoClient, activitiesTable)` 函数：
      - 读取 Users 表中的 Sync Config
      - 优先使用 Web Scraping，如配置了 API 凭证则使用 Feishu API
      - 对每条活动生成 dedupeKey = `{topic}#{activityDate}#{ugName}`
      - 查询 dedupeKey-index GSI 检查是否已存在
      - 不存在则 PutCommand 写入 Activities 表
      - 返回 syncedCount 和 skippedCount
    - _需求: 8.1~8.5, 9.1~9.4, 7.3_

  - [x] 5.3 编写活动查询单元测试
    - 创建 `packages/backend/src/admin/activities.test.ts`
    - 测试场景：
      - 列表查询：无筛选、按 ugName 筛选、按日期范围筛选、按关键词搜索
      - 排序：按 activityDate 倒序
      - 分页：pageSize 钳制、lastKey 分页
      - 单条查询：存在返回成功、不存在返回 ACTIVITY_NOT_FOUND
    - _需求: 19.1~19.5_

  - [x] 5.4 编写活动同步去重属性测试
    - **Property 5: Activity sync deduplication prevents duplicate records**
    - 创建 `packages/backend/src/sync/sync.property.test.ts`
    - 使用 fast-check 生成随机活动集合，同步两次，验证无重复记录
    - **验证: 需求 7.3**

  - [x] 5.5 编写活动查询筛选和排序属性测试
    - **Property 9: Activity list query returns filtered results in descending date order**
    - 创建 `packages/backend/src/admin/activities.property.test.ts`
    - 使用 fast-check 生成随机活动集合和查询参数，验证筛选结果正确且按 activityDate 倒序
    - **验证: 需求 19.2, 19.3, 19.4**

- [x] 6. 后端批量发放扩展
  - [x] 6.1 扩展批量发放验证和执行逻辑
    - 修改 `packages/backend/src/admin/batch-points.ts`：
      - 扩展 `BatchDistributionInput` 接口新增 activityId、activityType、activityUG、activityTopic、activityDate 字段
      - 扩展 `validateBatchDistributionInput` 函数：新增 activityId 必填校验（非空字符串）
      - 扩展 `executeBatchDistribution` 函数：
        - 新增参数 activitiesTable
        - 调用 GetCommand 验证 activityId 在 Activities 表中存在，不存在返回 ACTIVITY_NOT_FOUND
        - 在 Distribution_Record 中写入活动元数据字段
        - 在每条 PointsRecord 中写入 activityId 字段
    - _需求: 15.1~15.4, 16.1~16.4_

  - [x] 6.2 更新批量发放单元测试
    - 更新 `packages/backend/src/admin/batch-points.test.ts`：
      - 新增测试：activityId 缺失时返回 INVALID_REQUEST
      - 新增测试：activityId 不存在时返回 ACTIVITY_NOT_FOUND
      - 新增测试：成功发放后 Distribution_Record 包含活动元数据
      - 新增测试：成功发放后 PointsRecord 包含 activityId
      - 更新现有测试用例以包含 activityId 等新字段
    - _需求: 15.1~16.4_

  - [x] 6.3 编写发放记录活动元数据完整性属性测试
    - **Property 7: Distribution record and points records contain complete activity metadata**
    - 更新 `packages/backend/src/admin/batch-points.property.test.ts`
    - 使用 fast-check 生成随机发放请求（含活动元数据），验证 Distribution_Record 和 PointsRecord 中活动字段完整
    - **验证: 需求 15.1, 15.2**

  - [x] 6.4 编写 activityId 验证属性测试
    - **Property 8: Batch distribution validates activityId existence**
    - 更新 `packages/backend/src/admin/batch-points.property.test.ts`
    - 使用 fast-check 生成随机 activityId，验证存在的 ID 通过、不存在的 ID 返回 ACTIVITY_NOT_FOUND、缺失的 ID 返回 INVALID_REQUEST
    - **验证: 需求 15.3, 16.1, 16.3**

- [x] 7. 后端 Admin Handler 路由扩展
  - [x] 7.1 在 Admin Handler 中添加 UG 和活动相关路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量读取：`UGS_TABLE`、`ACTIVITIES_TABLE`
      - 导入 UG 和活动模块函数
      - 新增路由正则：
        - `UGS_STATUS_REGEX = /^\/api\/admin\/ugs\/([^/]+)\/status$/`
        - `UGS_DELETE_REGEX = /^\/api\/admin\/ugs\/([^/]+)$/`
      - POST `/api/admin/ugs` → handleCreateUG（SuperAdmin 权限）
      - GET `/api/admin/ugs` → handleListUGs（SuperAdmin 权限）
      - PUT `/api/admin/ugs/{ugId}/status` → handleUpdateUGStatus（SuperAdmin 权限）
      - DELETE `/api/admin/ugs/{ugId}` → handleDeleteUG（SuperAdmin 权限）
      - POST `/api/admin/sync/activities` → handleManualSync（SuperAdmin 权限，invoke Sync Lambda）
      - GET `/api/admin/activities` → handleListActivities（Admin/SuperAdmin 权限）
      - PUT `/api/admin/settings/activity-sync-config` → handleUpdateSyncConfig（SuperAdmin 权限）
      - GET `/api/admin/settings/activity-sync-config` → handleGetSyncConfig（SuperAdmin 权限）
    - 更新 handleBatchDistribution 传递 activitiesTable 参数
    - _需求: 18.3_

  - [x] 7.2 编写 Admin Handler 路由单元测试
    - 更新 `packages/backend/src/admin/handler.test.ts`
    - 测试新增路由分发正确性：UG CRUD 路由、活动查询路由、同步配置路由、手动同步路由
    - 测试权限校验：SuperAdmin 可管理 UG、Admin 可查询活动、非管理员被拒绝
    - _需求: 18.3_

- [x] 8. 检查点 - 后端模块验证
  - 运行所有后端相关测试（ug.test.ts、activities.test.ts、batch-points.test.ts、handler.test.ts、属性测试），确保逻辑正确。如有问题请向用户确认。

- [x] 9. 前端 Settings 页面扩展 — UG 管理
  - [x] 9.1 新增 UG 管理分类和界面
    - 修改 `packages/frontend/src/pages/admin/settings.tsx`：
      - 在 SETTINGS_CATEGORIES 数组中新增 `ug-management` 分类（仅 SuperAdmin 可见）
      - 实现 UG 管理区域组件：
        - UG 列表：每条显示名称、状态徽章（active 绿色 / inactive 灰色）、创建时间
        - "新建 UG"按钮 → 弹出输入框
        - 每行状态切换开关（active ↔ inactive）
        - 每行删除按钮 → 确认弹窗
      - 调用 API：GET/POST/PUT/DELETE `/api/admin/ugs/*`
      - 操作成功/失败显示 Toast 提示
    - 遵循前端设计规范：CSS 变量、全局组件类、CollapsibleSection 组件
    - _需求: 6.1~6.8_

- [x] 10. 前端 Settings 页面扩展 — 活动同步配置
  - [x] 10.1 新增活动同步配置分类和界面
    - 修改 `packages/frontend/src/pages/admin/settings.tsx`：
      - 在 SETTINGS_CATEGORIES 数组中新增 `activity-sync` 分类（仅 SuperAdmin 可见）
      - 实现同步配置区域组件：
        - 同步间隔输入框（1~30 天整数）
        - 飞书表格 URL 输入框
        - 飞书 App ID 输入框
        - 飞书 App Secret 密码输入框
        - 保存配置按钮
        - "立即获取"按钮（手动触发同步）+ 加载状态
        - 最近同步时间和结果状态显示
      - 已同步活动列表：
        - 每条显示活动类型徽章、UG 名称、活动主题、活动日期
        - 按活动日期倒序
        - 分页加载
      - 调用 API：GET/PUT sync-config、POST sync/activities、GET activities
    - _需求: 11.1~11.4, 12.1~12.6, 13.1~13.5_

- [x] 11. 前端 Batch Points 页面扩展 — 活动选择
  - [x] 11.1 新增活动选择步骤
    - 修改 `packages/frontend/src/pages/admin/batch-points.tsx`：
      - 在角色筛选之前新增 Activity_Selector 组件：
        - 显示活动列表（GET `/api/admin/activities`）
        - 支持按 UG 名称、活动日期、活动主题搜索筛选
        - 仅显示 active UG 关联的活动（前端过滤或后端参数）
        - 点击选择活动后显示已选活动摘要（类型、UG、主题、日期）
        - 提供"更换活动"按钮重新选择
      - 未选择活动时禁用后续用户选择和发放操作
      - 切换 Target_Role 时保持已选活动不变
      - 提交发放时在请求体中包含 activityId 和活动快照字段
    - 修改 `packages/frontend/src/pages/admin/batch-points.scss` 添加活动选择器样式
    - _需求: 14.1~14.7, 16.1~16.4_

  - [x] 11.2 编写活动选择器过滤属性测试
    - **Property 6: Activity selector filters by active UG and search query**
    - 创建 `packages/backend/src/admin/activity-filter.property.test.ts`
    - 实现并测试前端使用的活动过滤函数（提取为纯函数）
    - 使用 fast-check 生成随机活动集合和搜索条件，验证过滤结果仅包含 active UG 的活动且匹配搜索关键词
    - **验证: 需求 14.2, 14.3**

- [x] 12. 前端 Batch History 页面扩展 — 活动信息展示
  - [x] 12.1 在发放历史中展示活动信息
    - 修改 `packages/frontend/src/pages/admin/batch-history.tsx`：
      - 在每条发放记录中显示活动摘要：活动类型徽章、所属 UG、活动主题
      - 在详情视图中显示完整活动信息：活动类型、UG、主题、日期
      - 支持按活动主题或 UG 名称搜索发放历史（客户端过滤）
    - 修改 `packages/frontend/src/pages/admin/batch-history.scss` 添加活动信息样式
    - _需求: 17.1~17.3_

- [x] 13. 检查点 - 前端页面验证
  - 确保 Settings 页面扩展、Batch Points 页面扩展、Batch History 页面扩展编译通过，功能正确。如有问题请向用户确认。

- [x] 14. i18n 多语言翻译
  - [x] 14.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增：
      - `ugManagement` 模块：UG 管理相关文案（标题、新建按钮、名称输入占位符、状态标签、删除确认、成功/错误提示）
      - `activitySync` 模块：活动同步配置相关文案（标题、同步间隔标签、飞书 URL 标签、App ID/Secret 标签、保存按钮、立即获取按钮、同步状态、活动列表标题、活动类型标签）
      - `activitySelector` 模块：活动选择器相关文案（搜索占位符、筛选标签、空状态提示、已选活动标签、更换活动按钮）
    - 在 `admin.settings` 中新增 `categoryUGManagement`、`categoryActivitySync` 键
    - 在 `batchPoints` 中新增活动相关文案键
    - 在 `batchPoints.history` 中新增活动信息相关文案键
    - _需求: 20.1, 20.4_

  - [x] 14.2 添加 5 种语言翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加 ugManagement、activitySync、activitySelector 模块简体中文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加繁体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加韩文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 20.2_

  - [x] 14.3 在前端页面中使用 i18n
    - 在 Settings 页面 UG 管理和活动同步配置区域中使用 `t()` 翻译函数
    - 在 Batch Points 页面活动选择器中使用 `t()` 翻译函数
    - 在 Batch History 页面活动信息展示中使用 `t()` 翻译函数
    - 确保不硬编码任何用户可见字符串
    - _需求: 20.3_

- [x] 15. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 本次新增 2 张 DynamoDB 表（UGs、Activities）和 8+ 条 API Gateway 路由
- 新增 1 个 Sync Lambda 函数 + EventBridge 定时规则
- 活动数据同步支持 Web Scraping（主要）和 Feishu Open API（备用）两种方式
- 同步配置复用 Users 表（settingKey="activity-sync-config"），避免新建配置表
- 活动去重基于 topic + activityDate + ugName 组合，使用 dedupeKey-index GSI
- 发放记录中存储活动元数据快照，UG 删除不影响历史数据
- 属性测试验证设计文档中定义的 9 个正确性属性
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 检查点任务用于阶段性验证，确保增量开发的正确性
