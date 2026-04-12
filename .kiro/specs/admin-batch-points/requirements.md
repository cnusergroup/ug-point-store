# 需求文档：管理员批量积分发放

## 简介

管理员（Admin、SuperAdmin）可以主动向社区成员批量发放积分。与现有的"积分申请审批"（用户主动申请 → 管理员审批）不同，本功能是管理员主动发起的积分分配操作。管理员选择一个目标角色（UserGroupLeader、Speaker、Volunteer），从该角色的用户列表中多选用户，输入积分数值和发放原因，一次性完成批量积分发放。仅 SuperAdmin 可查看发放历史记录，用于管理审计。

## 术语表

- **Batch_Distribution（批量发放）**：管理员一次性向多个用户发放积分的操作
- **Distributor（发放人）**：执行批量积分发放操作的管理员（Admin 或 SuperAdmin）
- **Recipient（接收人）**：被选中接收积分的用户
- **Target_Role（目标角色）**：本次发放操作所针对的用户角色，取值为 UserGroupLeader、Speaker、Volunteer
- **Distribution_Reason（发放原因）**：管理员为本次发放操作填写的说明文字（如"2026 Q1 季度活动奖励"）
- **Distribution_Record（发放记录）**：一次批量发放操作的完整记录，包含发放人、接收人列表、积分数值、原因、时间
- **Batch_Distribution_Service（批量发放服务）**：处理批量积分发放逻辑的后端服务
- **Batch_Distribution_Page（批量发放页面）**：管理员执行批量积分发放操作的前端页面
- **Distribution_History_Page（发放历史页面）**：SuperAdmin 查看批量发放历史记录的前端页面

## 需求

### 需求 1：按角色筛选用户列表

**用户故事：** 作为管理员，我希望按角色筛选用户列表，以便快速找到需要发放积分的目标用户群体。

#### 验收标准

1. WHEN Distributor 进入批量发放页面, THE Batch_Distribution_Page SHALL 显示角色筛选选项，包含 UserGroupLeader、Speaker、Volunteer 三个角色
2. WHEN Distributor 选择一个 Target_Role, THE Batch_Distribution_Page SHALL 调用用户列表接口获取拥有该角色的活跃用户列表
3. THE Batch_Distribution_Page SHALL 仅显示状态为 active 的用户
4. THE Batch_Distribution_Page SHALL 在用户列表中显示每个用户的昵称、邮箱和当前积分余额
5. THE Batch_Distribution_Page SHALL 提供搜索框，支持按昵称或邮箱进行模糊搜索以快速定位用户
6. THE Batch_Distribution_Page SHALL 支持分页加载，当用户数量超过单页显示数量时提供加载更多功能

### 需求 2：多选用户

**用户故事：** 作为管理员，我希望通过复选框多选用户，以便一次性向多个用户发放积分。

#### 验收标准

1. THE Batch_Distribution_Page SHALL 在每个用户行前显示复选框，支持单独勾选或取消勾选
2. THE Batch_Distribution_Page SHALL 在用户列表顶部提供"全选"复选框，勾选后选中当前已加载的所有用户
3. WHEN Distributor 取消"全选"复选框, THE Batch_Distribution_Page SHALL 取消选中所有用户
4. THE Batch_Distribution_Page SHALL 在页面显著位置实时显示当前已选中的用户数量
5. WHEN Distributor 未选中任何用户, THE Batch_Distribution_Page SHALL 禁用提交按钮

### 需求 3：填写发放信息

**用户故事：** 作为管理员，我希望输入积分数值和发放原因，以便记录每次发放的目的和金额。

#### 验收标准

1. THE Batch_Distribution_Page SHALL 提供积分数值输入框，接受正整数输入
2. THE Batch_Distribution_Page SHALL 对积分数值不设上限，但要求最小值为 1
3. THE Batch_Distribution_Page SHALL 提供发放原因输入框，要求输入 1~200 字符的说明文字
4. WHEN Distributor 未填写积分数值或发放原因, THE Batch_Distribution_Page SHALL 禁用提交按钮
5. IF 积分数值不是正整数或小于 1, THEN THE Batch_Distribution_Page SHALL 显示输入校验错误提示

### 需求 4：执行批量积分发放

**用户故事：** 作为管理员，我希望确认后一次性向所有选中用户发放积分，以便高效完成积分分配工作。

#### 验收标准

1. WHEN Distributor 点击提交按钮, THE Batch_Distribution_Page SHALL 弹出确认弹窗，显示目标角色、选中用户数量、每人积分数值、积分总计和发放原因
2. WHEN Distributor 确认发放, THE Batch_Distribution_Page SHALL 调用 POST /api/admin/batch-points 接口提交发放请求
3. WHEN Batch_Distribution_Service 收到发放请求, THE Batch_Distribution_Service SHALL 验证 Distributor 拥有 Admin 或 SuperAdmin 角色
4. IF Distributor 不拥有 Admin 或 SuperAdmin 角色, THEN THE Batch_Distribution_Service SHALL 返回错误码 FORBIDDEN 和消息"需要管理员权限"
5. WHEN Batch_Distribution_Service 收到发放请求, THE Batch_Distribution_Service SHALL 验证请求体包含以下字段：userIds（用户 ID 数组，至少 1 个）、points（正整数，最小值 1）、reason（发放原因，1~200 字符）、targetRole（目标角色，取值为 UserGroupLeader、Speaker、Volunteer）
6. IF 请求体缺少必填字段或字段格式无效, THEN THE Batch_Distribution_Service SHALL 返回错误码 INVALID_REQUEST 和具体错误消息
7. WHEN Batch_Distribution_Service 验证通过, THE Batch_Distribution_Service SHALL 为每个 Recipient 执行以下操作：增加用户积分余额、写入积分变动记录（来源标记为"管理员批量发放"并包含发放原因）
8. THE Batch_Distribution_Service SHALL 在积分变动记录的 source 字段中记录"管理员批量发放:{distributionId}"以便追溯
9. WHEN 批量发放完成, THE Batch_Distribution_Service SHALL 创建一条 Distribution_Record，记录 distributionId、发放人 userId、发放人昵称、目标角色、接收人 userId 列表、每人积分数值、发放原因和发放时间
10. WHEN 批量发放成功, THE Batch_Distribution_Service SHALL 返回发放结果，包含 distributionId、成功发放的用户数量和总积分数
11. WHEN 发放成功, THE Batch_Distribution_Page SHALL 显示成功提示并重置表单状态
12. IF 发放失败, THEN THE Batch_Distribution_Page SHALL 显示具体错误信息

### 需求 5：重复发放防护

**用户故事：** 作为管理员，我希望系统防止同一用户在同一次活动中以多个角色身份重复领取积分，以便确保积分发放的公平性。

#### 验收标准

1. WHEN Batch_Distribution_Service 处理发放请求, THE Batch_Distribution_Service SHALL 检查 userIds 数组中是否存在重复的 userId
2. IF userIds 数组中存在重复的 userId, THEN THE Batch_Distribution_Service SHALL 自动去重，每个 userId 仅发放一次积分
3. THE Batch_Distribution_Page SHALL 在用户选择阶段确保同一用户不会被重复选中

### 需求 6：发放历史查询

**用户故事：** 作为超级管理员，我希望查看所有批量积分发放的历史记录，以便进行管理审计和追溯。

#### 验收标准

1. WHEN Distributor 请求查看发放历史, THE Batch_Distribution_Service SHALL 验证 Distributor 拥有 SuperAdmin 角色
2. IF Distributor 不拥有 SuperAdmin 角色, THEN THE Batch_Distribution_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"
3. THE Batch_Distribution_Service SHALL 返回发放历史列表，每条记录包含：distributionId、发放人昵称、目标角色、接收人数量、每人积分数值、发放原因、发放时间
4. THE Batch_Distribution_Service SHALL 按发放时间倒序排列返回的历史记录
5. THE Batch_Distribution_Service SHALL 支持分页查询，默认每页 20 条，最大 100 条，并在存在更多记录时返回分页游标 lastKey
6. WHEN SuperAdmin 点击某条发放记录, THE Distribution_History_Page SHALL 展示详情，包含完整的接收人昵称列表和各接收人的积分变动信息

### 需求 7：发放历史页面

**用户故事：** 作为超级管理员，我希望有一个专门的页面查看批量发放历史，以便方便地进行审计管理。

#### 验收标准

1. THE Distribution_History_Page SHALL 仅对 SuperAdmin 角色可见，Admin 角色无法访问
2. THE Distribution_History_Page SHALL 展示发放历史列表，每条记录显示发放人昵称、目标角色徽章、接收人数量、每人积分数值、发放原因摘要、发放时间
3. THE Distribution_History_Page SHALL 支持下拉加载更多历史记录
4. WHEN SuperAdmin 点击某条记录, THE Distribution_History_Page SHALL 展开或弹出详情视图，显示完整的接收人列表（昵称和邮箱）
5. THE Distribution_History_Page SHALL 提供入口链接，从管理后台首页可导航到该页面

### 需求 8：管理后台导航集成

**用户故事：** 作为管理员，我希望从管理后台首页快速进入批量发放页面，以便方便地执行积分发放操作。

#### 验收标准

1. THE Admin_Dashboard SHALL 在导航卡片列表中新增"批量发放"入口，Admin 和 SuperAdmin 均可见
2. THE Admin_Dashboard SHALL 在导航卡片列表中新增"发放历史"入口，仅 SuperAdmin 可见
3. WHEN Distributor 点击"批量发放"卡片, THE Admin_Dashboard SHALL 导航到批量发放页面
4. WHEN SuperAdmin 点击"发放历史"卡片, THE Admin_Dashboard SHALL 导航到发放历史页面

### 需求 9：CDK 路由与数据表配置

**用户故事：** 作为开发者，我希望在 API Gateway 中注册批量发放相关的路由并配置数据表，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE CDK_Stack SHALL 在 API Gateway 中注册以下管理端路由，集成到 Admin Lambda：POST /api/admin/batch-points（执行批量发放）、GET /api/admin/batch-points/history（查看发放历史）
2. THE CDK_Stack SHALL 在 DatabaseStack 中定义 BatchDistributions 表（PK: distributionId），用于存储发放记录
3. THE CDK_Stack SHALL 为 Admin Lambda 授予 BatchDistributions 表的读写权限
4. THE CDK_Stack SHALL 为 Admin Lambda 授予 Users 表和 PointsRecords 表的读写权限（如尚未授予）
5. THE CDK_Stack SHALL 将 BatchDistributions 表名作为环境变量 BATCH_DISTRIBUTIONS_TABLE 传递给 Admin Lambda
6. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 10：国际化支持

**用户故事：** 作为用户，我希望批量发放相关的界面文案支持多语言，以便不同语言的管理员都能正常使用。

#### 验收标准

1. THE Batch_Distribution_Page SHALL 使用 i18n 翻译函数获取所有界面文案，不硬编码任何语言文字
2. THE Distribution_History_Page SHALL 使用 i18n 翻译函数获取所有界面文案，不硬编码任何语言文字
3. THE i18n_System SHALL 为批量发放功能新增翻译键，覆盖以下 5 种语言：zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）
4. THE i18n_System SHALL 包含以下翻译键类别：页面标题、角色筛选标签、表单标签与占位符、按钮文案、确认弹窗文案、成功与错误提示、发放历史列表文案