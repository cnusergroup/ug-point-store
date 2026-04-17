# 需求文档：活动积分追踪（Activity Points Tracking）

## 简介

本功能为社区积分商城系统新增活动维度的积分追踪能力，包含三个子功能：

1. **UG（User Group）管理**：SuperAdmin 可对社区用户组（UG）进行增删和状态管理（激活/停用），UG 作为独立实体不与用户绑定。
2. **飞书活动数据同步**：系统从飞书多维表格（Bitable）自动或手动同步活动数据，存储到 DynamoDB Activities 表，SuperAdmin 可配置同步间隔和飞书 API 凭证。
3. **积分发放关联活动**：在现有批量积分发放流程中新增活动选择步骤，管理员先选择活动再选择用户发放积分，发放记录和积分记录均关联活动元数据，便于按活动维度统计和审计。

本功能为 Phase 1，聚焦核心流程的打通。UG 不与用户关联（一个用户可属于多个 UG，尤其是 Speaker），活动数据来源于外部飞书表格，系统仅作为消费方。

## 术语表

- **UG（User Group，用户组）**：社区用户组，如"东京"、"杭州"、"Security UG"、"Kiro UG"等。UG 是独立实体，不与用户 profile 绑定
- **UG_Service（用户组服务）**：处理 UG 增删改查逻辑的后端服务模块
- **UG_Management_Section（用户组管理区域）**：Settings_Page 中 SuperAdmin 专属的 UG 管理界面区域
- **Activity（活动）**：从飞书多维表格同步的活动记录，包含活动类型、所属 UG、活动主题、活动日期
- **Activity_Type（活动类型）**：活动的分类，取值为"线上活动"或"线下活动"
- **Activities_Table（活动表）**：DynamoDB 中存储同步活动数据的表
- **Feishu_Bitable（飞书多维表格）**：飞书平台的多维表格产品，作为活动数据的外部来源
- **Sync_Service（同步服务）**：负责从飞书多维表格抓取活动数据并写入 Activities_Table 的后端服务
- **Sync_Config（同步配置）**：SuperAdmin 配置的同步参数，包含同步间隔（天数）、飞书 API 凭证（app_id、app_secret）、表格 URL
- **Sync_Schedule（同步调度）**：EventBridge 定时触发 Lambda 执行活动数据同步的调度规则
- **Settings_Page（设置页面）**：SuperAdmin 管理面板中的系统设置页面（/pages/admin/settings）
- **Batch_Distribution_Page（批量发放页面）**：管理员执行批量积分发放操作的前端页面
- **Batch_Distribution_Service（批量发放服务）**：处理批量积分发放逻辑的后端服务
- **Distribution_Record（发放记录）**：一次批量发放操作的完整记录，存储在 BatchDistributions 表中
- **Activity_Selector（活动选择器）**：批量发放页面中用于搜索和选择活动的 UI 组件

## 需求

### 需求 1：UG 数据存储

**用户故事：** 作为系统，我希望持久化存储 UG 数据，以便 UG 信息在系统重启后不会丢失。

#### 验收标准

1. THE UG_Service SHALL 使用 DynamoDB 存储 UG 数据，每条 UG 记录包含以下字段：ugId（分区键，ULID）、name（UG 名称，字符串）、status（状态，取值为 active 或 inactive）、createdAt（创建时间，ISO 8601）、updatedAt（更新时间，ISO 8601）
2. THE UG_Service SHALL 为 UG 表创建 GSI（name-index），以 name 为分区键，用于按名称查询和唯一性校验
3. THE UG_Service SHALL 为 UG 表创建 GSI（status-index），以 status 为分区键、createdAt 为排序键，用于按状态筛选和排序

### 需求 2：UG 创建

**用户故事：** 作为 SuperAdmin，我希望创建新的 UG，以便管理社区中的不同用户组。

#### 验收标准

1. WHEN SuperAdmin 在 UG_Management_Section 输入 UG 名称并提交创建请求, THE UG_Service SHALL 创建一条新的 UG 记录，status 默认为 active
2. THE UG_Service SHALL 验证 UG 名称为 1~50 字符的非空字符串
3. IF UG 名称已存在（不区分大小写）, THEN THE UG_Service SHALL 返回错误码 DUPLICATE_UG_NAME 和消息"UG 名称已存在"
4. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"

### 需求 3：UG 删除

**用户故事：** 作为 SuperAdmin，我希望删除不再需要的 UG，以便保持 UG 列表的整洁。

#### 验收标准

1. WHEN SuperAdmin 请求删除一个 UG, THE UG_Service SHALL 从 DynamoDB 中物理删除该 UG 记录
2. IF 目标 UG 不存在, THEN THE UG_Service SHALL 返回错误码 UG_NOT_FOUND 和消息"UG 不存在"
3. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"
4. WHEN UG 被删除后, THE UG_Service SHALL 不影响已关联该 UG 的历史活动记录和发放记录（活动记录中的 UG 名称为快照值）

### 需求 4：UG 状态管理

**用户故事：** 作为 SuperAdmin，我希望激活或停用 UG，以便控制哪些 UG 在活动选择中可见。

#### 验收标准

1. WHEN SuperAdmin 请求激活一个 UG, THE UG_Service SHALL 将该 UG 的 status 更新为 active 并更新 updatedAt
2. WHEN SuperAdmin 请求停用一个 UG, THE UG_Service SHALL 将该 UG 的 status 更新为 inactive 并更新 updatedAt
3. IF 目标 UG 不存在, THEN THE UG_Service SHALL 返回错误码 UG_NOT_FOUND 和消息"UG 不存在"
4. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"

### 需求 5：UG 列表查询

**用户故事：** 作为 SuperAdmin，我希望查看所有 UG 的列表，以便了解当前系统中的 UG 状况。

#### 验收标准

1. WHEN SuperAdmin 请求 UG 列表, THE UG_Service SHALL 返回所有 UG 记录，每条包含 ugId、name、status、createdAt、updatedAt
2. THE UG_Service SHALL 支持按 status 筛选（all / active / inactive），默认返回所有状态
3. THE UG_Service SHALL 按 createdAt 倒序排列返回结果
4. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"

### 需求 6：UG 管理界面

**用户故事：** 作为 SuperAdmin，我希望在设置页面中有一个专门的 UG 管理区域，以便方便地管理 UG。

#### 验收标准

1. THE Settings_Page SHALL 在 Settings_Category 中新增"用户组管理"（UG Management）分类，仅对 SuperAdmin 角色可见
2. THE UG_Management_Section SHALL 显示 UG 列表，每条 UG 显示名称、状态徽章（active 为绿色、inactive 为灰色）、创建时间
3. THE UG_Management_Section SHALL 提供"新建 UG"按钮，点击后弹出输入框供 SuperAdmin 输入 UG 名称
4. THE UG_Management_Section SHALL 在每条 UG 行提供状态切换开关（active ↔ inactive）
5. THE UG_Management_Section SHALL 在每条 UG 行提供删除按钮，点击后弹出确认弹窗
6. WHEN 删除确认后, THE UG_Management_Section SHALL 调用删除接口并从列表中移除该 UG
7. WHEN 创建或状态变更成功, THE UG_Management_Section SHALL 显示操作成功提示
8. IF 操作失败, THEN THE UG_Management_Section SHALL 显示具体错误信息

### 需求 7：活动数据存储

**用户故事：** 作为系统，我希望持久化存储从飞书同步的活动数据，以便活动信息可供积分发放关联使用。

#### 验收标准

1. THE Sync_Service SHALL 使用 DynamoDB Activities_Table 存储活动数据，每条记录包含以下字段：activityId（分区键，ULID）、activityType（活动类型，"线上活动"或"线下活动"）、ugName（所属 UG 名称）、topic（活动主题）、activityDate（活动日期，ISO 8601 日期格式）、syncedAt（同步时间，ISO 8601）、sourceUrl（来源飞书表格 URL）
2. THE Sync_Service SHALL 为 Activities_Table 创建 GSI（activityDate-index），以 pk 为分区键（固定值"ALL"）、activityDate 为排序键，用于按日期排序查询
3. THE Sync_Service SHALL 基于活动主题 + 活动日期 + 所属 UG 名称的组合进行去重，避免重复同步同一活动

### 需求 8：飞书活动数据同步 — Web Scraping 方式

**用户故事：** 作为系统，我希望通过抓取飞书多维表格的公开分享链接获取活动数据，以便无需 API 凭证即可同步数据。

#### 验收标准

1. WHEN Sync_Service 执行同步任务, THE Sync_Service SHALL 访问配置的飞书多维表格公开分享链接，抓取表格数据
2. THE Sync_Service SHALL 从抓取的数据中提取以下 4 个字段：活动类型（activityType）、申请所属 UG（ugName）、活动主题（topic）、活动日期（activityDate）
3. THE Sync_Service SHALL 将提取的数据解析为结构化的活动记录
4. IF 抓取失败（网络错误、页面结构变更等）, THEN THE Sync_Service SHALL 记录错误日志并返回同步失败状态
5. THE Sync_Service SHALL 支持解析飞书多维表格的 HTML/JSON 响应格式

### 需求 9：飞书活动数据同步 — Feishu Open API 方式（备用）

**用户故事：** 作为 SuperAdmin，我希望配置飞书 API 凭证作为备用同步方式，以便在 Web Scraping 不可用时仍能同步数据。

#### 验收标准

1. WHERE SuperAdmin 配置了飞书 API 凭证（app_id 和 app_secret）, THE Sync_Service SHALL 支持通过 Feishu Open API 获取多维表格数据
2. THE Sync_Service SHALL 使用 app_id 和 app_secret 获取 tenant_access_token，再调用 Bitable API 读取表格记录
3. THE Sync_Service SHALL 从 API 响应中提取与 Web Scraping 相同的 4 个字段
4. IF API 调用失败（凭证无效、权限不足等）, THEN THE Sync_Service SHALL 记录错误日志并返回同步失败状态及具体错误原因

### 需求 10：同步调度 — 定时触发

**用户故事：** 作为 SuperAdmin，我希望系统按配置的间隔自动同步活动数据，以便活动列表保持最新。

#### 验收标准

1. THE Sync_Schedule SHALL 使用 EventBridge 规则定时触发 Sync Lambda 执行活动数据同步
2. THE Sync_Schedule SHALL 支持 SuperAdmin 配置同步间隔，单位为天（如每 1 天、每 3 天），最小值为 1 天，最大值为 30 天
3. WHEN 同步间隔配置变更, THE Sync_Schedule SHALL 更新 EventBridge 规则的触发频率
4. THE Sync_Schedule SHALL 默认同步间隔为 1 天

### 需求 11：同步调度 — 手动触发

**用户故事：** 作为 SuperAdmin，我希望手动触发一次活动数据同步，以便在需要时立即获取最新数据。

#### 验收标准

1. WHEN SuperAdmin 点击"立即获取"按钮, THE Settings_Page SHALL 调用手动同步接口触发一次即时同步
2. WHILE 同步任务执行中, THE Settings_Page SHALL 显示同步进行中的加载状态，禁用"立即获取"按钮
3. WHEN 同步完成, THE Settings_Page SHALL 显示同步结果（成功同步的活动数量或错误信息）
4. IF 同步失败, THEN THE Settings_Page SHALL 显示具体错误信息

### 需求 12：同步配置管理

**用户故事：** 作为 SuperAdmin，我希望配置同步参数（间隔、飞书凭证、表格 URL），以便控制活动数据的同步行为。

#### 验收标准

1. THE Settings_Page SHALL 在 Settings_Category 中新增"活动同步配置"（Activity Sync Config）分类，仅对 SuperAdmin 角色可见
2. THE Settings_Page SHALL 提供以下配置项：同步间隔（天数输入框，1~30 整数）、飞书表格 URL（文本输入框）、飞书 App ID（文本输入框）、飞书 App Secret（密码输入框）
3. WHEN SuperAdmin 修改配置并保存, THE Settings_Page SHALL 调用配置更新接口持久化配置
4. THE Sync_Config SHALL 存储在 DynamoDB 中，使用固定分区键 settingKey 值为 "activity-sync-config" 的单条记录，存储在现有 Users 表中
5. THE Sync_Config 记录 SHALL 包含以下字段：settingKey（分区键）、syncIntervalDays（同步间隔天数）、feishuTableUrl（飞书表格 URL）、feishuAppId（飞书 App ID）、feishuAppSecret（飞书 App Secret，加密存储）、updatedAt（更新时间）、updatedBy（操作人 userId）
6. IF Sync_Config 记录不存在, THEN THE Sync_Service SHALL 使用默认值：syncIntervalDays 为 1，其他字段为空

### 需求 13：已同步活动列表查看

**用户故事：** 作为 SuperAdmin，我希望查看已同步的活动列表，以便确认同步数据的正确性。

#### 验收标准

1. THE Settings_Page SHALL 在"活动同步配置"分类中显示已同步的活动列表
2. THE Settings_Page SHALL 在活动列表中显示每条活动的：活动类型徽章（线上/线下）、所属 UG 名称、活动主题、活动日期
3. THE Settings_Page SHALL 支持按活动日期倒序排列活动列表
4. THE Settings_Page SHALL 支持分页加载活动列表
5. THE Settings_Page SHALL 显示最近一次同步的时间和结果状态

### 需求 14：批量发放页面新增活动选择步骤

**用户故事：** 作为管理员，我希望在批量发放积分时先选择关联的活动，以便每次积分发放都能追溯到具体活动。

#### 验收标准

1. WHEN 管理员进入 Batch_Distribution_Page, THE Batch_Distribution_Page SHALL 在角色筛选之前显示 Activity_Selector 组件
2. THE Activity_Selector SHALL 显示已同步的活动列表，支持按 UG 名称、活动日期、活动主题进行搜索和筛选
3. THE Activity_Selector SHALL 仅显示状态为 active 的 UG 所关联的活动（基于 ugName 匹配）
4. WHEN 管理员选择一个活动, THE Batch_Distribution_Page SHALL 在页面顶部显示已选活动的摘要信息（活动类型、UG、主题、日期）
5. WHEN 管理员切换 Target_Role（如从 Speaker 切换到 Volunteer）, THE Batch_Distribution_Page SHALL 保持已选活动不变
6. WHEN 管理员主动点击更换活动, THE Batch_Distribution_Page SHALL 重新显示 Activity_Selector 供管理员选择新活动
7. WHEN 管理员未选择任何活动, THE Batch_Distribution_Page SHALL 禁用后续的用户选择和积分发放操作

### 需求 15：发放记录关联活动元数据

**用户故事：** 作为 SuperAdmin，我希望每条发放记录都包含关联活动的信息，以便按活动维度进行审计和统计。

#### 验收标准

1. WHEN Batch_Distribution_Service 创建 Distribution_Record, THE Batch_Distribution_Service SHALL 在记录中包含以下活动元数据字段：activityId（关联活动 ID）、activityType（活动类型）、activityUG（所属 UG 名称）、activityTopic（活动主题）、activityDate（活动日期）
2. WHEN Batch_Distribution_Service 为每个 Recipient 写入积分变动记录, THE Batch_Distribution_Service SHALL 在 PointsRecords 表的记录中包含 activityId 字段
3. THE Batch_Distribution_Service SHALL 验证提交的 activityId 在 Activities_Table 中存在
4. IF activityId 在 Activities_Table 中不存在, THEN THE Batch_Distribution_Service SHALL 返回错误码 ACTIVITY_NOT_FOUND 和消息"关联活动不存在"

### 需求 16：发放请求参数扩展

**用户故事：** 作为开发者，我希望批量发放接口支持活动关联参数，以便前端能够传递活动信息。

#### 验收标准

1. THE Batch_Distribution_Service SHALL 扩展批量发放请求体，新增必填字段 activityId（字符串，关联活动 ID）
2. THE Batch_Distribution_Service SHALL 扩展批量发放请求体，新增以下活动快照字段：activityType（字符串）、activityUG（字符串）、activityTopic（字符串）、activityDate（字符串）
3. IF 请求体缺少 activityId 字段, THEN THE Batch_Distribution_Service SHALL 返回错误码 INVALID_REQUEST 和消息"activityId 为必填字段"
4. THE Batch_Distribution_Service SHALL 保持与现有请求参数（userIds、points、reason、targetRole）的向后兼容

### 需求 17：发放历史展示活动信息

**用户故事：** 作为 SuperAdmin，我希望在发放历史中看到每次发放关联的活动信息，以便快速了解积分发放的活动背景。

#### 验收标准

1. THE Distribution_History_Page SHALL 在每条发放记录中显示关联活动的摘要信息：活动类型徽章、所属 UG、活动主题
2. WHEN SuperAdmin 查看发放详情, THE Distribution_History_Page SHALL 显示完整的活动信息，包含活动类型、所属 UG、活动主题、活动日期
3. THE Distribution_History_Page SHALL 支持按活动主题或 UG 名称搜索发放历史记录

### 需求 18：CDK 基础设施配置

**用户故事：** 作为开发者，我希望在 CDK 中配置所有新增的 DynamoDB 表、Lambda 函数、API Gateway 路由和 EventBridge 规则，以便基础设施自动化部署。

#### 验收标准

1. THE CDK_Stack SHALL 在 DatabaseStack 中定义 UGs 表（PK: ugId），包含 name-index GSI 和 status-index GSI
2. THE CDK_Stack SHALL 在 DatabaseStack 中定义 Activities 表（PK: activityId），包含 activityDate-index GSI（PK: pk, SK: activityDate）
3. THE CDK_Stack SHALL 在 API Gateway 中注册以下管理端路由，集成到 Admin Lambda：
   - POST /api/admin/ugs（创建 UG）
   - GET /api/admin/ugs（查询 UG 列表）
   - PUT /api/admin/ugs/{ugId}/status（更新 UG 状态）
   - DELETE /api/admin/ugs/{ugId}（删除 UG）
   - POST /api/admin/sync/activities（手动触发同步）
   - GET /api/admin/activities（查询已同步活动列表）
   - PUT /api/admin/settings/activity-sync-config（更新同步配置）
   - GET /api/admin/settings/activity-sync-config（查询同步配置）
4. THE CDK_Stack SHALL 创建 Sync Lambda 函数，用于执行飞书活动数据同步任务
5. THE CDK_Stack SHALL 创建 EventBridge 规则，按配置的间隔触发 Sync Lambda
6. THE CDK_Stack SHALL 为 Admin Lambda 授予 UGs 表和 Activities 表的读写权限
7. THE CDK_Stack SHALL 为 Sync Lambda 授予 Activities 表的读写权限和 Users 表的读权限（读取同步配置）
8. THE CDK_Stack SHALL 将 UGs 表名和 Activities 表名作为环境变量传递给 Admin Lambda 和 Sync Lambda
9. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 19：活动列表查询接口（供批量发放页面使用）

**用户故事：** 作为管理员，我希望在批量发放页面能够查询和搜索活动列表，以便快速找到要关联的活动。

#### 验收标准

1. WHEN Admin 或 SuperAdmin 请求 GET /api/admin/activities, THE Admin_Handler SHALL 返回活动列表
2. THE Admin_Handler SHALL 支持以下查询参数：ugName（按 UG 名称筛选）、startDate 和 endDate（按活动日期范围筛选）、keyword（按活动主题模糊搜索）
3. THE Admin_Handler SHALL 按 activityDate 倒序排列返回结果
4. THE Admin_Handler SHALL 支持分页查询，默认每页 20 条，最大 100 条
5. IF 请求者不拥有 Admin 或 SuperAdmin 角色, THEN THE Admin_Handler SHALL 返回错误码 FORBIDDEN 和消息"需要管理员权限"

### 需求 20：国际化支持

**用户故事：** 作为用户，我希望活动积分追踪相关的界面文案支持多语言，以便不同语言的管理员都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为活动积分追踪功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：UG 管理相关文案（标题、按钮、状态标签、确认弹窗、错误提示）、活动同步配置相关文案（标题、表单标签、按钮、同步状态）、活动选择器相关文案（搜索框、筛选标签、空状态提示）、发放历史中活动信息相关文案
