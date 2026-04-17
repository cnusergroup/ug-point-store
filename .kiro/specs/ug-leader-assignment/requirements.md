# 需求文档：UG 负责人分配（UG Leader Assignment）

## 简介

本功能为社区积分商城系统的 UG（User Group）管理新增负责人分配能力。每个 UG 可以指定一名拥有 Admin 角色的用户作为负责人（Leader）。SuperAdmin 在 Settings 页面的 UG 管理区域中为每个 UG 分配负责人。分配后，Admin 用户在批量积分发放页面的活动选择器中仅能看到自己所负责 UG 关联的活动，SuperAdmin 则可以看到所有活动。负责人信息以 leaderId 和 leaderNickname 字段存储在现有 UGs DynamoDB 表中。

## 术语表

- **UG（User Group，用户组）**：社区用户组，如"东京"、"杭州"、"Security UG"等。UG 数据存储在 PointsMall-UGs DynamoDB 表中
- **Leader（负责人）**：被分配为某个 UG 负责人的 Admin 角色用户。每个 UG 最多有一名负责人
- **UG_Service（用户组服务）**：处理 UG 增删改查及负责人分配逻辑的后端服务模块
- **UG_Management_Section（用户组管理区域）**：Settings_Page 中 SuperAdmin 专属的 UG 管理界面区域
- **Leader_Selector_Modal（负责人选择弹窗）**：SuperAdmin 点击"分配负责人"按钮后弹出的模态窗口，展示 Admin 用户列表供选择
- **Activity_Selector（活动选择器）**：批量发放页面中用于搜索和选择活动的 UI 组件
- **Batch_Distribution_Page（批量发放页面）**：管理员执行批量积分发放操作的前端页面
- **Settings_Page（设置页面）**：SuperAdmin 管理面板中的系统设置页面（/pages/admin/settings）
- **Admin_User（管理员用户）**：拥有 Admin 角色的系统用户，可通过 GET /api/admin/users?role=Admin 接口获取

## 需求

### 需求 1：UG 负责人数据存储

**用户故事：** 作为系统，我希望在 UG 记录中持久化存储负责人信息，以便负责人分配关系在系统重启后不会丢失。

#### 验收标准

1. THE UG_Service SHALL 在现有 UGs 表（PointsMall-UGs）的 UG 记录中新增以下可选字段：leaderId（负责人用户 ID，字符串）、leaderNickname（负责人昵称，字符串）
2. WHEN UG 记录未分配负责人, THE UG_Service SHALL 将 leaderId 和 leaderNickname 字段保持为空（不存在或为空字符串）
3. THE UG_Service SHALL 确保新增字段与现有 UG 记录字段（ugId、name、status、createdAt、updatedAt）向后兼容，未分配负责人的 UG 记录不受影响

### 需求 2：分配负责人

**用户故事：** 作为 SuperAdmin，我希望为每个 UG 分配一名 Admin 用户作为负责人，以便明确每个 UG 的管理责任人。

#### 验收标准

1. WHEN SuperAdmin 提交分配负责人请求（包含 ugId 和 leaderId）, THE UG_Service SHALL 验证 leaderId 对应的用户存在且拥有 Admin 角色
2. WHEN 验证通过, THE UG_Service SHALL 更新该 UG 记录的 leaderId、leaderNickname 和 updatedAt 字段
3. IF leaderId 对应的用户不存在, THEN THE UG_Service SHALL 返回错误码 USER_NOT_FOUND 和消息"用户不存在"
4. IF leaderId 对应的用户不拥有 Admin 角色, THEN THE UG_Service SHALL 返回错误码 INVALID_LEADER_ROLE 和消息"负责人必须拥有 Admin 角色"
5. IF 目标 UG 不存在, THEN THE UG_Service SHALL 返回错误码 UG_NOT_FOUND 和消息"UG 不存在"
6. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"
7. THE UG_Service SHALL 允许同一个 Admin 用户同时担任多个 UG 的负责人

### 需求 3：移除负责人

**用户故事：** 作为 SuperAdmin，我希望移除某个 UG 的负责人，以便在人员变动时取消分配关系。

#### 验收标准

1. WHEN SuperAdmin 提交移除负责人请求（包含 ugId）, THE UG_Service SHALL 将该 UG 记录的 leaderId 和 leaderNickname 字段清空，并更新 updatedAt
2. IF 目标 UG 不存在, THEN THE UG_Service SHALL 返回错误码 UG_NOT_FOUND 和消息"UG 不存在"
3. IF 目标 UG 当前未分配负责人, THEN THE UG_Service SHALL 返回成功（幂等操作）
4. IF 请求者不拥有 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要超级管理员权限"

### 需求 4：UG 列表展示负责人信息

**用户故事：** 作为 SuperAdmin，我希望在 UG 管理列表中看到每个 UG 的当前负责人，以便快速了解各 UG 的管理分配情况。

#### 验收标准

1. THE UG_Management_Section SHALL 在每条 UG 行中显示当前负责人的昵称（leaderNickname）
2. WHEN UG 未分配负责人, THE UG_Management_Section SHALL 在负责人列显示"未分配"占位文本
3. THE UG_Management_Section SHALL 在每条 UG 行中提供"分配负责人"按钮
4. WHEN UG 已分配负责人, THE UG_Management_Section SHALL 将按钮文案变更为"更换负责人"

### 需求 5：负责人选择弹窗

**用户故事：** 作为 SuperAdmin，我希望通过弹窗从 Admin 用户列表中选择负责人，以便方便地完成分配操作。

#### 验收标准

1. WHEN SuperAdmin 点击"分配负责人"或"更换负责人"按钮, THE UG_Management_Section SHALL 弹出 Leader_Selector_Modal
2. THE Leader_Selector_Modal SHALL 调用 GET /api/admin/users?role=Admin 接口获取所有拥有 Admin 角色的活跃用户列表
3. THE Leader_Selector_Modal SHALL 在列表中显示每个 Admin 用户的昵称和邮箱
4. THE Leader_Selector_Modal SHALL 提供搜索框，支持按昵称或邮箱进行模糊搜索以快速定位用户
5. WHEN SuperAdmin 点击某个 Admin 用户, THE Leader_Selector_Modal SHALL 调用分配负责人接口并关闭弹窗
6. WHEN 分配成功, THE UG_Management_Section SHALL 更新该 UG 行的负责人显示并显示操作成功提示
7. IF 分配失败, THEN THE Leader_Selector_Modal SHALL 显示具体错误信息
8. THE Leader_Selector_Modal SHALL 提供"移除负责人"按钮（仅当该 UG 已有负责人时显示），点击后调用移除负责人接口

### 需求 6：批量发放页面活动筛选 — Admin 角色限制

**用户故事：** 作为 Admin 用户，我希望在批量发放页面的活动选择器中仅看到自己所负责 UG 的活动，以便专注于自己管辖范围内的积分发放。

#### 验收标准

1. WHEN Admin 用户（非 SuperAdmin）进入 Batch_Distribution_Page, THE Activity_Selector SHALL 仅显示该 Admin 用户所负责 UG 关联的活动
2. THE Activity_Selector SHALL 通过以下方式确定 Admin 用户所负责的 UG：查询 UGs 表中 leaderId 等于当前用户 userId 的 UG 记录，获取对应的 UG 名称列表
3. THE Activity_Selector SHALL 使用获取到的 UG 名称列表筛选活动（基于活动记录的 ugName 字段匹配）
4. WHEN Admin 用户未被分配为任何 UG 的负责人, THE Activity_Selector SHALL 显示空状态提示"您尚未被分配为任何 UG 的负责人，无法选择活动"
5. WHILE SuperAdmin 用户进入 Batch_Distribution_Page, THE Activity_Selector SHALL 显示所有活动，不受 UG 负责人限制

### 需求 7：负责人分配 API 路由

**用户故事：** 作为开发者，我希望在 API Gateway 中注册负责人分配相关的路由，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE Admin_Handler SHALL 新增路由 PUT /api/admin/ugs/{ugId}/leader，用于分配或更换 UG 负责人
2. THE Admin_Handler SHALL 新增路由 DELETE /api/admin/ugs/{ugId}/leader，用于移除 UG 负责人
3. THE Admin_Handler SHALL 新增路由 GET /api/admin/ugs/my-ugs，用于查询当前 Admin 用户所负责的 UG 列表
4. THE CDK_Stack SHALL 在 API Gateway 中注册上述三条路由，集成到 Admin Lambda
5. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 8：查询当前用户负责的 UG 列表

**用户故事：** 作为 Admin 用户，我希望能够查询自己所负责的 UG 列表，以便系统在批量发放页面中正确筛选活动。

#### 验收标准

1. WHEN Admin 或 SuperAdmin 请求 GET /api/admin/ugs/my-ugs, THE UG_Service SHALL 返回当前用户作为负责人的所有 UG 记录
2. THE UG_Service SHALL 通过扫描 UGs 表中 leaderId 等于当前用户 userId 的记录来获取结果
3. THE UG_Service SHALL 仅返回状态为 active 的 UG 记录
4. IF 请求者不拥有 Admin 或 SuperAdmin 角色, THEN THE UG_Service SHALL 返回错误码 FORBIDDEN 和消息"需要管理员权限"

### 需求 9：国际化支持

**用户故事：** 作为用户，我希望 UG 负责人分配相关的界面文案支持多语言，以便不同语言的管理员都能正常使用。

#### 验收标准

1. THE Frontend SHALL 为 UG 负责人分配功能的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh（简体中文）、zh-TW（繁体中文）、en（英文）、ja（日文）、ko（韩文）五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 useTranslation hook 获取翻译文本，不硬编码任何用户可见字符串
4. THE i18n_System SHALL 包含以下翻译键类别：负责人列显示文案（"负责人"、"未分配"）、分配/更换/移除按钮文案、Leader_Selector_Modal 标题和搜索框占位符、操作成功与失败提示、Admin 用户无 UG 负责权限时的空状态提示
