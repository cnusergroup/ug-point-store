# 需求文档：用户管理增强（User Management）

## 简介

本功能将现有管理后台的用户角色管理页面从"手动输入用户 ID 分配角色"的简单表单，升级为完整的用户管理系统。新系统提供系统内所有用户的列表视图，支持按角色筛选、直接编辑用户角色、停用/启用用户账号以及删除用户。

现有状态：
- 前端管理页面（`admin/users.tsx`）仅有一个文本输入框用于输入用户 ID 和选择角色进行分配
- 后端仅有 `PUT /api/admin/users/{id}/roles` 接口用于角色分配
- 用户数据存储在 DynamoDB Users 表中，主键为 `userId`，包含 `email`、`nickname`、`roles`、`points`、`createdAt` 等字段
- 用户表目前无 `status` 字段，需新增以支持停用功能

## 词汇表

- **User_Management_System**：用户管理系统，负责用户列表展示、角色编辑、账号状态管理和用户删除的完整模块
- **Admin**：拥有 `Admin` 或 `SuperAdmin` 角色的用户，有权访问用户管理功能
- **User_Record**：存储在 DynamoDB Users 表中的用户记录，包含 userId、email、nickname、roles、points、status、createdAt 等字段
- **User_Status**：用户账号状态，取值为 `active`（正常）或 `disabled`（停用）
- **User_List_API**：提供用户列表查询的后端 API 接口
- **User_List_Page**：管理后台的用户列表页面，展示所有用户并提供管理操作
- **Role_Filter**：按用户角色筛选用户列表的功能
- **UserRole**：系统中定义的用户角色，包括 `UserGroupLeader`、`CommunityBuilder`、`Speaker`、`Volunteer`、`Admin`、`SuperAdmin`

---

## 需求

### 需求 1：用户列表查询 API

**用户故事：** 作为管理员，我希望通过 API 获取系统中所有用户的列表，以便在管理界面中展示和管理用户。

#### 验收标准

1. THE User_Management_System SHALL 提供 `GET /api/admin/users` 接口，返回用户列表，每条记录包含 userId、email、nickname、roles、points、status 和 createdAt 字段。
2. WHEN 请求中包含 `role` 查询参数，THE User_List_API SHALL 仅返回角色列表中包含该指定角色的用户。
3. WHEN 请求中包含 `pageSize` 查询参数，THE User_List_API SHALL 返回不超过指定数量的用户记录。
4. WHEN 请求中包含 `lastKey` 查询参数，THE User_List_API SHALL 从该分页游标之后开始返回用户记录。
5. WHEN 响应中存在更多未返回的用户记录，THE User_List_API SHALL 在响应中包含 `lastKey` 字段供下一页查询使用。
6. THE User_List_API SHALL 对未携带 `status` 字段的历史用户记录默认视为 `active` 状态返回。
7. IF 请求方不具备 Admin 或 SuperAdmin 角色，THEN THE User_Management_System SHALL 返回 403 状态码和"需要管理员权限"的错误提示。

---

### 需求 2：用户账号停用与启用

**用户故事：** 作为管理员，我希望能够停用或启用用户账号，以便在不删除用户数据的情况下控制用户的系统访问权限。

#### 验收标准

1. THE User_Management_System SHALL 提供 `PATCH /api/admin/users/{id}/status` 接口，接受 `{ status: 'active' | 'disabled' }` 请求体。
2. WHEN 管理员将用户状态设置为 `disabled`，THE User_Management_System SHALL 将该用户的 User_Status 更新为 `disabled`。
3. WHEN 管理员将用户状态设置为 `active`，THE User_Management_System SHALL 将该用户的 User_Status 更新为 `active`。
4. IF 目标用户不存在，THEN THE User_Management_System SHALL 返回 404 状态码和"用户不存在"的错误提示。
5. IF 目标用户拥有 SuperAdmin 角色，THEN THE User_Management_System SHALL 拒绝停用操作并返回"禁止停用 SuperAdmin 用户"的错误提示。
6. IF 非 SuperAdmin 管理员尝试停用拥有 Admin 角色的用户，THEN THE User_Management_System SHALL 拒绝操作并返回"仅 SuperAdmin 可停用管理员"的错误提示。
7. WHILE 用户处于 `disabled` 状态，THE User_Management_System SHALL 在登录验证时拒绝该用户的登录请求并返回"账号已停用"的错误提示。

---

### 需求 3：用户删除

**用户故事：** 作为管理员，我希望能够删除用户账号，以便彻底移除不再需要的用户数据。

#### 验收标准

1. THE User_Management_System SHALL 提供 `DELETE /api/admin/users/{id}` 接口，用于删除指定用户。
2. WHEN 管理员执行删除操作，THE User_Management_System SHALL 从 Users 表中移除该用户的 User_Record。
3. IF 目标用户不存在，THEN THE User_Management_System SHALL 返回 404 状态码和"用户不存在"的错误提示。
4. IF 目标用户拥有 SuperAdmin 角色，THEN THE User_Management_System SHALL 拒绝删除操作并返回"禁止删除 SuperAdmin 用户"的错误提示。
5. IF 非 SuperAdmin 管理员尝试删除拥有 Admin 角色的用户，THEN THE User_Management_System SHALL 拒绝操作并返回"仅 SuperAdmin 可删除管理员"的错误提示。
6. IF 管理员尝试删除自身账号，THEN THE User_Management_System SHALL 拒绝操作并返回"禁止删除自身账号"的错误提示。

---

### 需求 4：用户角色编辑增强

**用户故事：** 作为管理员，我希望在用户列表中直接编辑用户角色，而无需手动输入用户 ID，以便提高角色管理效率。

#### 验收标准

1. WHEN 管理员在 User_List_Page 中点击某用户的角色编辑操作，THE User_Management_System SHALL 展示该用户当前的角色列表和可选角色。
2. WHEN 管理员选择新角色并提交，THE User_Management_System SHALL 调用 `PUT /api/admin/users/{id}/roles` 接口更新该用户的角色。
3. WHEN 角色更新成功，THE User_List_Page SHALL 立即刷新该用户在列表中的角色显示。
4. IF 角色更新失败，THEN THE User_List_Page SHALL 展示具体的错误提示信息。
5. THE User_List_Page SHALL 根据当前管理员的角色（Admin 或 SuperAdmin）决定可分配的角色范围：Admin 仅可分配普通角色，SuperAdmin 可分配普通角色和 Admin 角色。

---

### 需求 5：用户列表页面

**用户故事：** 作为管理员，我希望在管理后台看到所有用户的列表，并能按角色筛选和执行管理操作，以便高效管理系统用户。

#### 验收标准

1. THE User_List_Page SHALL 展示用户列表，每行包含用户昵称、邮箱、角色徽章、积分余额、账号状态和注册时间。
2. THE User_List_Page SHALL 在页面顶部提供角色筛选器，支持按单个 UserRole 筛选用户列表。
3. WHEN 管理员选择某个角色进行筛选，THE User_List_Page SHALL 仅展示拥有该角色的用户。
4. WHEN 管理员清除筛选条件，THE User_List_Page SHALL 展示所有用户。
5. THE User_List_Page SHALL 为每个用户提供以下操作按钮：编辑角色、停用/启用、删除。
6. WHEN 管理员点击停用按钮，THE User_List_Page SHALL 展示确认对话框，确认后调用停用 API。
7. WHEN 管理员点击删除按钮，THE User_List_Page SHALL 展示确认对话框，确认后调用删除 API。
8. THE User_List_Page SHALL 支持分页加载，当存在更多用户时展示"加载更多"按钮。
9. WHILE 用户处于 `disabled` 状态，THE User_List_Page SHALL 以视觉区分方式（如灰色文字或停用标签）展示该用户行。
10. THE User_List_Page SHALL 遵循现有管理后台的设计规范，使用 CSS 变量和全局组件样式。

---

### 需求 6：CDK 路由配置

**用户故事：** 作为开发者，我希望在 API Gateway 中配置新增的用户管理路由，以便前端能够访问新的后端接口。

#### 验收标准

1. THE User_Management_System SHALL 在 API Gateway 中注册 `GET /api/admin/users` 路由，指向 Admin Lambda 函数。
2. THE User_Management_System SHALL 在 API Gateway 中注册 `PATCH /api/admin/users/{id}/status` 路由，指向 Admin Lambda 函数。
3. THE User_Management_System SHALL 在 API Gateway 中注册 `DELETE /api/admin/users/{id}` 路由，指向 Admin Lambda 函数。
4. THE User_Management_System SHALL 确保所有新增路由支持 CORS 预检请求。
