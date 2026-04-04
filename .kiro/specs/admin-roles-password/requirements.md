# 需求文档

## 简介

本需求为积分商城系统（Points Mall）的增强功能，包含三个子特性：

1. **SuperAdmin + Admin 角色权限系统**：引入 SuperAdmin 和 Admin 两个管理角色，实现分级权限控制。SuperAdmin 为最高权限角色，只能通过数据库直接设置；Admin 可管理商品、Code 和普通用户角色，但不能分配管理角色。
2. **修改密码**：已登录用户可在个人中心修改密码。
3. **忘记密码**：未登录用户可通过邮箱重置密码。

现有系统的 `UserRole` 类型为 `'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer'`，需扩展为包含 `'Admin' | 'SuperAdmin'`。现有管理端的 `isAdmin` 检查逻辑（"拥有任意角色即为管理员"）需改为"拥有 Admin 或 SuperAdmin 角色"。

---

## 词汇表

- **积分商城（Points_Mall）**：本系统整体，包含用户端和管理端
- **用户（User）**：已登录系统的任意身份用户
- **SuperAdmin**：超级管理员角色，系统最高权限，只能通过 DynamoDB 直接设置（种子脚本或 AWS 控制台），不可通过 UI 创建
- **Admin**：管理员角色，可访问管理面板，管理商品、Code 和普通用户角色
- **普通角色（Regular_Role）**：UserGroupLeader、CommunityBuilder、Speaker、Volunteer 四种非管理角色的统称
- **管理角色（Admin_Role）**：Admin 和 SuperAdmin 两种管理角色的统称
- **管理面板（Admin_Panel）**：管理端界面，用于管理商品、Code 和用户角色
- **认证服务（Auth_Service）**：负责处理用户登录、注册、密码管理和身份验证的模块
- **角色服务（Role_Service）**：负责处理角色分配和权限校验的模块
- **密码重置令牌（Reset_Token）**：用于忘记密码流程的一次性令牌，有效期 1 小时
- **邮件服务（Email_Service）**：基于 AWS SES 的邮件发送服务

---

## 需求

### 需求 1：角色类型扩展

**用户故事：** 作为系统架构师，我希望扩展用户角色类型以包含管理角色，以便实现分级权限控制。

#### 验收标准

1. THE Points_Mall SHALL 支持以下六种用户角色：UserGroupLeader、CommunityBuilder、Speaker、Volunteer、Admin、SuperAdmin
2. THE Points_Mall SHALL 将角色分为两类：普通角色（UserGroupLeader、CommunityBuilder、Speaker、Volunteer）和管理角色（Admin、SuperAdmin）
3. THE Points_Mall SHALL 在共享类型定义中将 UserRole 类型更新为包含全部六种角色

---

### 需求 2：SuperAdmin 角色管理

**用户故事：** 作为系统运维人员，我希望 SuperAdmin 角色只能通过数据库直接设置，以便确保最高权限的安全性。

#### 验收标准

1. THE Role_Service SHALL 拒绝通过 API 接口创建或分配 SuperAdmin 角色的请求
2. THE Points_Mall SHALL 提供种子脚本（seed script），用于在 DynamoDB 中直接设置指定用户的 SuperAdmin 角色
3. WHEN 任何用户通过 API 尝试将 SuperAdmin 角色分配给其他用户，THE Role_Service SHALL 返回"禁止分配 SuperAdmin 角色"的错误提示
4. THE SuperAdmin SHALL 拥有系统中所有管理操作的权限

---

### 需求 3：Admin 角色分配与撤销

**用户故事：** 作为 SuperAdmin，我希望能够分配和撤销 Admin 角色，以便管理管理员团队。

#### 验收标准

1. WHEN SuperAdmin 对指定用户分配 Admin 角色，THE Role_Service SHALL 将 Admin 角色添加至该用户的角色列表
2. WHEN SuperAdmin 对指定用户撤销 Admin 角色，THE Role_Service SHALL 从该用户的角色列表中移除 Admin 角色
3. IF 非 SuperAdmin 用户尝试分配 Admin 角色，THEN THE Role_Service SHALL 返回"仅 SuperAdmin 可分配管理角色"的错误提示
4. IF 非 SuperAdmin 用户尝试撤销 Admin 角色，THEN THE Role_Service SHALL 返回"仅 SuperAdmin 可撤销管理角色"的错误提示

---

### 需求 4：管理面板访问控制

**用户故事：** 作为系统管理员，我希望只有拥有 Admin 或 SuperAdmin 角色的用户才能访问管理面板，以便保护管理功能的安全。

#### 验收标准

1. WHEN 拥有 Admin 或 SuperAdmin 角色的用户请求管理面板 API，THE Admin_Panel SHALL 允许访问并返回正常响应
2. IF 不拥有 Admin 或 SuperAdmin 角色的用户请求管理面板 API，THEN THE Admin_Panel SHALL 返回 403 状态码和"需要管理员权限"的错误提示
3. THE Admin_Panel SHALL 在后端 API 层对每个管理接口请求校验调用者是否拥有 Admin 或 SuperAdmin 角色
4. THE Admin_Panel SHALL 在前端路由层校验当前用户是否拥有 Admin 或 SuperAdmin 角色，无权限用户不可进入管理页面
5. WHEN Admin 用户访问管理面板，THE Admin_Panel SHALL 允许该用户执行商品管理、Code 管理和普通角色分配操作
6. WHEN Admin 用户尝试分配 Admin 或 SuperAdmin 角色，THE Role_Service SHALL 拒绝该操作并返回权限不足的错误提示

---

### 需求 5：isAdmin 检查逻辑变更

**用户故事：** 作为开发者，我希望将现有的管理员判断逻辑从"拥有任意角色"改为"拥有 Admin 或 SuperAdmin 角色"，以便正确区分管理员和普通角色用户。

#### 验收标准

1. THE Admin_Panel SHALL 将管理员判断逻辑定义为：用户角色列表中包含 'Admin' 或 'SuperAdmin'
2. WHEN 仅拥有普通角色（UserGroupLeader、CommunityBuilder、Speaker、Volunteer）的用户请求管理 API，THE Admin_Panel SHALL 拒绝访问并返回 403 状态码
3. WHEN 拥有 Admin 角色的用户请求管理 API，THE Admin_Panel SHALL 允许访问
4. WHEN 拥有 SuperAdmin 角色的用户请求管理 API，THE Admin_Panel SHALL 允许访问

---

### 需求 6：修改密码

**用户故事：** 作为已登录用户，我希望在个人中心修改密码，以便维护账号安全。

#### 验收标准

1. THE Auth_Service SHALL 提供 `POST /api/auth/change-password` 接口，接受 `{ currentPassword, newPassword }` 请求体
2. WHEN 用户提交正确的当前密码和符合规则的新密码，THE Auth_Service SHALL 将用户密码更新为新密码的 bcrypt 哈希值
3. IF 用户提交的当前密码与数据库中存储的密码哈希不匹配，THEN THE Auth_Service SHALL 返回"当前密码错误"的错误提示
4. IF 用户提交的新密码不符合密码规则（少于 8 位或不同时包含字母和数字），THEN THE Auth_Service SHALL 返回具体的密码格式错误提示
5. WHEN 密码修改成功，THE Auth_Service SHALL 返回成功响应
6. THE Auth_Service SHALL 要求用户在调用修改密码接口时携带有效的访问令牌（JWT）

---

### 需求 7：忘记密码 - 请求重置

**用户故事：** 作为未登录用户，我希望通过邮箱请求密码重置，以便在忘记密码时恢复账号访问。

#### 验收标准

1. THE Auth_Service SHALL 提供 `POST /api/auth/forgot-password` 接口，接受 `{ email }` 请求体
2. WHEN 用户提交已注册的邮箱地址，THE Email_Service SHALL 向该邮箱发送包含密码重置链接的邮件
3. THE Auth_Service SHALL 生成一个唯一的 Reset_Token 并将其与用户关联存储，有效期为 1 小时
4. THE Auth_Service SHALL 在重置链接中包含 Reset_Token 作为查询参数
5. IF 用户提交的邮箱地址未在系统中注册，THEN THE Auth_Service SHALL 返回与已注册邮箱相同的成功响应（防止邮箱枚举攻击）
6. WHEN 同一用户多次请求密码重置，THE Auth_Service SHALL 使之前生成的 Reset_Token 失效，仅保留最新的 Reset_Token 有效

---

### 需求 8：忘记密码 - 执行重置

**用户故事：** 作为收到重置邮件的用户，我希望通过重置链接设置新密码，以便恢复账号访问。

#### 验收标准

1. THE Auth_Service SHALL 提供 `POST /api/auth/reset-password` 接口，接受 `{ token, newPassword }` 请求体
2. WHEN 用户提交有效的 Reset_Token 和符合规则的新密码，THE Auth_Service SHALL 将用户密码更新为新密码的 bcrypt 哈希值
3. WHEN 密码重置成功，THE Auth_Service SHALL 使该 Reset_Token 立即失效（一次性使用）
4. IF 用户提交的 Reset_Token 已过期（超过 1 小时），THEN THE Auth_Service SHALL 返回"重置链接已过期"的错误提示
5. IF 用户提交的 Reset_Token 不存在或已被使用，THEN THE Auth_Service SHALL 返回"重置链接无效"的错误提示
6. IF 用户提交的新密码不符合密码规则（少于 8 位或不同时包含字母和数字），THEN THE Auth_Service SHALL 返回具体的密码格式错误提示
7. WHEN 密码重置成功，THE Auth_Service SHALL 清除该用户的登录失败计数和账号锁定状态
