# 需求文档：内容预约活动审批（Content Reservation Approval）

## 简介

本功能对现有内容中心的预约机制进行改造，将原有的"预约即发积分"模式改为"预约 → 审批 → 发积分"模式，并引入真实活动关联。Speaker 在内容中心预约内容时，需要从所有 active UG 的同步活动中选择一个真实活动进行关联。预约提交后，对应 UG 的 Leader Admin 或 SuperAdmin 在新增的"活动预约审批"管理页面中审批预约。审批通过后，系统自动给内容上传者（Speaker）发放配置的积分值，积分记录包含完整活动信息，与批量发放记录格式一致。SuperAdmin 可配置审批通过后的积分值，默认 10 分。

## 术语表

- **Content_Reservation（内容预约）**：Speaker 在内容中心对某条内容发起的预约操作，改造后需关联一个真实活动
- **Reservation_Record（预约记录）**：存储在 ContentReservations 表中的预约数据，改造后新增活动关联字段和审批状态字段
- **Activity（活动）**：从飞书多维表格同步的活动记录，存储在 Activities 表中
- **Activity_Selector（活动选择器）**：预约流程中供 Speaker 选择活动的 UI 组件
- **Reservation_Approval_Page（活动预约审批页面）**：管理后台新增的审批页面，Leader Admin 和 SuperAdmin 在此审批预约
- **Leader_Admin（UG 负责人管理员）**：被分配为某个 UG 负责人的 Admin 角色用户
- **Content_Uploader（内容上传者）**：上传内容的用户，业务规定一定是 Speaker 角色
- **Reservation_Approval_Service（预约审批服务）**：处理预约审批逻辑的后端服务模块
- **Reservation_Points_Config（预约积分配置）**：SuperAdmin 可配置的预约审批通过后积分值，默认 10 分
- **UG（User Group，用户组）**：社区用户组，数据存储在 UGs DynamoDB 表中，每个 UG 可有一名 Leader Admin
- **Points_Record（积分记录）**：记录积分变动的数据，存储在 PointsRecords 表中

## 需求

### 需求 1：预约记录数据模型改造

**用户故事：** 作为系统，我希望预约记录包含活动关联信息和审批状态，以便支持预约审批流程。

#### 验收标准

1. THE Reservation_Record SHALL 在现有字段（pk、userId、contentId、createdAt）基础上新增以下字段：activityId（关联活动 ID，字符串，必填）、activityType（活动类型，字符串）、activityUG（所属 UG 名称，字符串）、activityTopic（活动主题，字符串）、activityDate（活动日期，字符串）、status（审批状态，取值为 pending / approved / rejected，默认 pending）、reviewerId（审批人用户 ID，字符串，审批后填入）、reviewedAt（审批时间，ISO 8601，审批后填入）
2. THE Reservation_Record SHALL 保持 pk 字段格式为 `{userId}#{contentId}` 不变，确保同一用户对同一内容仅能创建一条预约记录
3. WHEN 预约记录创建时, THE Reservation_Approval_Service SHALL 将 status 默认设置为 pending
4. THE ContentReservations 表 SHALL 新增 GSI（status-createdAt-index），以 status 为分区键、createdAt 为排序键，用于按审批状态查询预约列表

### 需求 2：预约流程改造 — 活动选择

**用户故事：** 作为 Speaker，我希望在预约内容时选择一个真实活动进行关联，以便我的预约能与具体活动挂钩。

#### 验收标准

1. WHEN Speaker 点击内容详情页的预约按钮, THE Content_Detail_Page SHALL 弹出 Activity_Selector 供 Speaker 选择活动
2. THE Activity_Selector SHALL 调用 GET /api/content/reservation-activities 接口获取所有 active UG 关联的活动列表
3. THE Activity_Selector SHALL 在列表中显示每个活动的活动类型徽章（线上/线下）、所属 UG 名称、活动主题和活动日期
4. THE Activity_Selector SHALL 提供搜索框，支持按 UG 名称、活动主题或活动日期进行模糊搜索
5. WHEN Speaker 选择一个活动并确认, THE Content_Detail_Page SHALL 调用预约接口提交预约请求，包含 contentId 和活动信息
6. IF Speaker 未选择任何活动, THEN THE Activity_Selector SHALL 禁用确认按钮

### 需求 3：预约流程改造 — 去除即时积分发放

**用户故事：** 作为系统，我希望预约创建时不再即时发放积分，以便积分发放由审批流程控制。

#### 验收标准

1. WHEN Speaker 提交预约请求, THE Reservation_Approval_Service SHALL 创建一条 status 为 pending 的预约记录，包含活动关联信息
2. WHEN 预约记录创建成功, THE Reservation_Approval_Service SHALL 仅增加内容的 reservationCount 计数，不增加上传者的积分余额，不创建积分变动记录
3. THE Reservation_Approval_Service SHALL 保持现有的重复预约防护逻辑（同一用户对同一内容仅能预约一次）

### 需求 4：预约重复校验 — 同一 Speaker 不能重复预约同一活动

**用户故事：** 作为系统，我希望防止同一 Speaker 对同一活动重复预约，以便确保预约的唯一性。

#### 验收标准

1. WHEN Speaker 提交预约请求, THE Reservation_Approval_Service SHALL 检查该 Speaker 是否已对同一 activityId 存在预约记录（任意 contentId）
2. IF 该 Speaker 已对同一 activityId 存在预约记录, THEN THE Reservation_Approval_Service SHALL 返回错误码 DUPLICATE_ACTIVITY_RESERVATION 和消息"您已预约过该活动"
3. THE Reservation_Approval_Service SHALL 允许不同 Speaker 对同一活动分别预约（通过不同内容）
4. THE Reservation_Approval_Service SHALL 允许同一 Speaker 对不同活动分别预约（通过同一或不同内容）

### 需求 5：预约审批页面 — 列表展示

**用户故事：** 作为 Leader Admin 或 SuperAdmin，我希望在管理后台看到待审批的预约列表，以便及时处理预约申请。

#### 验收标准

1. THE Admin_Dashboard SHALL 在导航卡片列表中新增"活动预约审批"入口，Admin 和 SuperAdmin 均可见
2. THE Reservation_Approval_Page SHALL 显示预约列表，每条记录包含：内容标题、预约人昵称、活动类型徽章、活动 UG 名称、活动主题、活动日期、预约时间、审批状态
3. THE Reservation_Approval_Page SHALL 支持按审批状态筛选（全部 / 待审批 / 已通过 / 已拒绝），默认显示待审批
4. THE Reservation_Approval_Page SHALL 按预约时间倒序排列列表
5. THE Reservation_Approval_Page SHALL 支持分页加载

### 需求 6：预约审批页面 — 可见性规则

**用户故事：** 作为系统，我希望根据管理员角色和 UG 负责人关系控制预约的可见性，以便每个管理员只看到自己负责范围内的预约。

#### 验收标准

1. WHILE SuperAdmin 用户访问 Reservation_Approval_Page, THE Reservation_Approval_Page SHALL 显示所有预约申请，不受 UG 限制
2. WHILE Leader_Admin 用户访问 Reservation_Approval_Page, THE Reservation_Approval_Page SHALL 仅显示该 Leader_Admin 所负责 UG 关联的预约申请（基于预约记录的 activityUG 字段匹配）
3. WHILE Admin 用户（非 Leader_Admin，即未被分配为任何 UG 的负责人）访问 Reservation_Approval_Page, THE Reservation_Approval_Page SHALL 显示所有没有 Leader 的 UG 关联的预约申请
4. THE Reservation_Approval_Service SHALL 提供查询接口 GET /api/admin/reservation-approvals，根据请求者角色和 UG 负责人关系返回对应的预约列表

### 需求 7：预约审批操作

**用户故事：** 作为 Leader Admin 或 SuperAdmin，我希望对预约进行通过或拒绝操作，以便控制积分的发放。

#### 验收标准

1. THE Reservation_Approval_Page SHALL 在每条待审批预约记录上提供"通过"和"拒绝"两个操作按钮
2. WHEN 审批人点击"通过"按钮, THE Reservation_Approval_Service SHALL 将预约记录的 status 更新为 approved，记录 reviewerId 和 reviewedAt
3. WHEN 预约审批通过, THE Reservation_Approval_Service SHALL 执行以下原子操作：增加内容上传者（Content_Uploader）的积分余额、创建积分变动记录（包含完整活动信息）
4. WHEN 审批人点击"拒绝"按钮, THE Reservation_Approval_Service SHALL 将预约记录的 status 更新为 rejected，记录 reviewerId 和 reviewedAt
5. WHEN 预约被拒绝, THE Reservation_Approval_Service SHALL 不发放积分，不创建积分变动记录
6. IF 预约记录的 status 不是 pending, THEN THE Reservation_Approval_Service SHALL 返回错误码 RESERVATION_ALREADY_REVIEWED 和消息"该预约已被审批"
7. IF 请求者不拥有 Admin 或 SuperAdmin 角色, THEN THE Reservation_Approval_Service SHALL 返回错误码 FORBIDDEN 和消息"需要管理员权限"

### 需求 8：审批通过后积分记录格式

**用户故事：** 作为系统，我希望审批通过后创建的积分记录包含完整活动信息，以便与批量发放积分记录格式一致。

#### 验收标准

1. WHEN 预约审批通过, THE Reservation_Approval_Service SHALL 在 PointsRecords 表中创建一条积分变动记录，包含以下字段：recordId（ULID）、userId（内容上传者的 userId）、type（固定为 earn）、amount（配置的积分值）、source（固定为"预约审批通过:{reservationPk}"）、balanceAfter（发放后余额）、createdAt（ISO 8601）
2. THE Points_Record SHALL 包含以下活动信息字段：activityId、activityType、activityUG、activityTopic、activityDate，与批量发放记录（DistributionRecord）中的活动字段格式一致
3. THE Points_Record SHALL 包含 targetRole 字段，固定值为 Speaker，表示积分来源于 Speaker 预约

### 需求 9：预约积分值配置

**用户故事：** 作为 SuperAdmin，我希望配置预约审批通过后的积分值，以便灵活调整积分奖励策略。

#### 验收标准

1. THE Settings_Page SHALL 提供预约审批积分值配置项，允许 SuperAdmin 输入正整数值
2. THE Reservation_Points_Config SHALL 存储在现有 feature-toggles 配置记录中，字段名为 reservationApprovalPoints，默认值为 10
3. WHEN SuperAdmin 修改积分值并保存, THE Settings_Page SHALL 调用配置更新接口持久化新值
4. THE Reservation_Approval_Service SHALL 在审批通过时读取最新的 reservationApprovalPoints 配置值作为发放积分数
5. IF reservationApprovalPoints 配置不存在, THEN THE Reservation_Approval_Service SHALL 使用默认值 10

### 需求 10：Speaker 端活动列表接口

**用户故事：** 作为 Speaker，我希望在预约时能获取可选的活动列表，以便选择要关联的活动。

#### 验收标准

1. THE Content_Handler SHALL 新增路由 GET /api/content/reservation-activities，返回所有 active UG 关联的活动列表
2. THE Content_Handler SHALL 从 UGs 表查询所有 status 为 active 的 UG，获取 UG 名称列表
3. THE Content_Handler SHALL 从 Activities 表查询活动列表，仅返回 ugName 在 active UG 名称列表中的活动
4. THE Content_Handler SHALL 按 activityDate 倒序排列返回结果
5. THE Content_Handler SHALL 支持分页查询，默认每页 50 条

### 需求 11：预约审批 API 路由

**用户故事：** 作为开发者，我希望在 API Gateway 中注册预约审批相关的路由，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE Admin_Handler SHALL 新增路由 GET /api/admin/reservation-approvals，用于查询预约审批列表
2. THE Admin_Handler SHALL 新增路由 PATCH /api/admin/reservation-approvals/{pk}/review，用于审批预约（通过或拒绝）
3. THE Content_Handler SHALL 新增路由 GET /api/content/reservation-activities，用于 Speaker 获取可选活动列表
4. THE CDK_Stack SHALL 在 API Gateway 中注册上述路由，分别集成到 Admin Lambda 和 Content Lambda
5. THE CDK_Stack SHALL 确保 Admin Lambda 拥有 ContentReservations 表、Activities 表、UGs 表、Users 表、PointsRecords 表的读写权限
6. THE CDK_Stack SHALL 确保 Content Lambda 拥有 Activities 表和 UGs 表的读权限
7. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 12：预约请求参数扩展

**用户故事：** 作为开发者，我希望预约接口支持活动关联参数，以便前端能够传递活动信息。

#### 验收标准

1. THE Content_Handler SHALL 扩展 POST /api/content/{contentId}/reserve 接口的请求体，新增必填字段 activityId（字符串）
2. THE Content_Handler SHALL 扩展请求体，新增以下活动快照字段：activityType（字符串）、activityUG（字符串）、activityTopic（字符串）、activityDate（字符串）
3. IF 请求体缺少 activityId 字段, THEN THE Reservation_Approval_Service SHALL 返回错误码 INVALID_REQUEST 和消息"activityId 为必填字段"
4. THE Reservation_Approval_Service SHALL 验证提交的 activityId 在 Activities 表中存在
5. IF activityId 在 Activities 表中不存在, THEN THE Reservation_Approval_Service SHALL 返回错误码 ACTIVITY_NOT_FOUND 和消息"关联活动不存在"

### 需求 13：CDK 基础设施变更

**用户故事：** 作为开发者，我希望在 CDK 中配置预约审批所需的 GSI 和路由变更，以便基础设施支持新功能。

#### 验收标准

1. THE CDK_Stack SHALL 为 ContentReservations 表新增 GSI（status-createdAt-index），以 status 为分区键、createdAt 为排序键
2. THE CDK_Stack SHALL 为 ContentReservations 表新增 GSI（userId-activityId-index），以 userId 为分区键、activityId 为排序键，用于检查同一 Speaker 是否已预约同一活动
3. THE CDK_Stack SHALL 在 API Gateway 中注册 GET /api/admin/reservation-approvals 路由，集成到 Admin Lambda
4. THE CDK_Stack SHALL 在 API Gateway 中注册 PATCH /api/admin/reservation-approvals/{pk}/review 路由，集成到 Admin Lambda
5. THE CDK_Stack SHALL 在 API Gateway 中注册 GET /api/content/reservation-activities 路由，集成到 Content Lambda
6. THE CDK_Stack SHALL 为 Admin Lambda 新增 ContentReservations 表的环境变量（如尚未配置）
7. THE CDK_Stack SHALL 为 Content Lambda 新增 Activities 表和 UGs 表的环境变量和读权限

### 需求 14：国际化支持

**用户故事：** 作为用户，我希望内容预约审批相关的界面文案支持多语言，以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为内容预约审批功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：活动选择器相关文案（标题、搜索框、空状态提示、确认按钮）、预约审批页面相关文案（页面标题、状态筛选标签、操作按钮、审批成功/失败提示）、预约积分配置相关文案（配置标签、默认值提示）、Speaker 端预约流程相关文案（选择活动提示、预约成功提示、重复预约错误提示）
