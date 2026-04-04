# 实现计划：管理角色与密码管理（Admin Roles & Password）

## 概述

在现有积分商城系统基础上增强管理角色权限系统和密码管理功能。涉及共享类型扩展、后端角色权限逻辑变更、三个新 Auth 路由、前端页面新增和变更。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 扩展 UserRole 类型和角色分类常量
    - 在 `packages/shared/src/types.ts` 中将 `UserRole` 类型扩展为包含 `'Admin' | 'SuperAdmin'`
    - 新增导出常量 `ADMIN_ROLES`、`REGULAR_ROLES`、`ALL_ROLES`
    - 新增导出函数 `hasAdminAccess(roles)`、`isSuperAdmin(roles)`、`isAdminRole(role)`
    - _需求: 1.1, 1.2, 1.3_

  - [x] 1.2 新增错误码定义
    - 在 `packages/shared/src/errors.ts` 中新增错误码：`INVALID_CURRENT_PASSWORD`、`RESET_TOKEN_EXPIRED`、`RESET_TOKEN_INVALID`、`SUPERADMIN_ASSIGN_FORBIDDEN`、`ADMIN_ROLE_REQUIRES_SUPERADMIN`、`FORBIDDEN`
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 2.1, 3.3, 4.2, 6.3, 8.4, 8.5_

  - [x] 1.3 编写管理员判断逻辑属性测试
    - **Property 1: 管理员判断逻辑正确性**
    - 使用 fast-check 生成随机 UserRole 子集，验证 `hasAdminAccess` 返回 true 当且仅当包含 Admin 或 SuperAdmin
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 4.1, 4.2, 5.1, 5.2, 5.3, 5.4**

- [x] 2. 后端角色权限逻辑变更
  - [x] 2.1 变更 isAdmin 检查逻辑
    - 在 `packages/backend/src/admin/handler.ts` 中将 `isAdmin` 函数从 `roles.length > 0` 改为 `roles.some(r => r === 'Admin' || r === 'SuperAdmin')`
    - _需求: 5.1_

  - [x] 2.2 更新角色分配逻辑增加权限分级
    - 在 `packages/backend/src/admin/roles.ts` 中：
      - 更新 `VALID_ROLES` 包含 `'Admin'`（不含 `'SuperAdmin'`）
      - 新增 `validateRoleAssignment(callerRoles, targetRoles)` 函数：禁止分配 SuperAdmin，分配 Admin 需要 SuperAdmin 权限
      - 修改 `assignRoles` 和 `revokeRole` 函数签名，接受 `callerRoles` 参数并调用权限校验
    - 更新 `packages/backend/src/admin/handler.ts` 中 `handleAssignRoles` 传递调用者角色
    - _需求: 2.1, 3.1, 3.2, 3.3, 3.4_

  - [x] 2.3 编写 SuperAdmin 分配禁止属性测试
    - **Property 2: SuperAdmin 角色禁止通过 API 分配**
    - 使用 fast-check 生成随机调用者角色集合，验证分配 SuperAdmin 始终被拒绝
    - 在 `packages/backend/src/admin/roles.property.test.ts` 中添加测试
    - **验证: 需求 2.1, 2.3**

  - [x] 2.4 编写 Admin 角色分配/撤销往返属性测试
    - **Property 3: SuperAdmin 分配/撤销 Admin 角色的往返一致性**
    - 模拟 SuperAdmin 分配 Admin 后验证角色存在，撤销后验证角色不存在
    - 在 `packages/backend/src/admin/roles.property.test.ts` 中添加测试
    - **验证: 需求 3.1, 3.2**

  - [x] 2.5 编写非 SuperAdmin 权限限制属性测试
    - **Property 4: 非 SuperAdmin 用户无法分配或撤销管理角色**
    - 使用 fast-check 生成不含 SuperAdmin 的角色集合，验证分配/撤销 Admin 被拒绝
    - 在 `packages/backend/src/admin/roles.property.test.ts` 中添加测试
    - **验证: 需求 3.3, 3.4, 4.6**

- [x] 3. 检查点 - 角色权限验证
  - 运行角色相关测试，确保 isAdmin 逻辑变更和角色分配权限分级正确。如有问题请向用户确认。

- [x] 4. 修改密码功能实现
  - [x] 4.1 实现修改密码逻辑
    - 创建 `packages/backend/src/auth/change-password.ts`
    - 实现 `changePassword(userId, currentPassword, newPassword, dynamoClient, tableName)` 函数
    - 流程：获取用户记录 → bcrypt.compare 验证当前密码 → validatePassword 验证新密码 → bcrypt.hash 生成新哈希 → 更新 Users 表
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.2 在 Auth Lambda 中添加修改密码路由
    - 在 `packages/backend/src/auth/handler.ts` 中添加 `POST /api/auth/change-password` 路由
    - 该路由需要 JWT 认证（从 Authorization header 获取 userId）
    - _需求: 6.1, 6.6_

  - [x] 4.3 编写修改密码往返属性测试
    - **Property 5: 修改密码往返正确性**
    - 使用 fast-check 生成随机合法密码对，验证修改后新密码可通过 bcrypt 验证
    - 在 `packages/backend/src/auth/change-password.property.test.ts` 中创建测试
    - **验证: 需求 6.2**

  - [x] 4.4 编写错误当前密码拒绝属性测试
    - **Property 6: 错误的当前密码被拒绝**
    - 使用 fast-check 生成随机错误密码，验证修改请求被拒绝且密码哈希不变
    - 在 `packages/backend/src/auth/change-password.property.test.ts` 中添加测试
    - **验证: 需求 6.3**

- [x] 5. 忘记密码功能实现
  - [x] 5.1 实现忘记密码（请求重置）逻辑
    - 创建 `packages/backend/src/auth/forgot-password.ts`
    - 实现 `forgotPassword(email, dynamoClient, sesClient, tableName, senderEmail, resetBaseUrl)` 函数
    - 流程：通过 email-index GSI 查询用户 → 生成 ULID resetToken → 设置 resetTokenExpiry（当前时间 + 1 小时）→ 更新 Users 表 → 通过 SES 发送重置邮件
    - 邮箱不存在时仍返回成功响应（防枚举）
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.2 实现重置密码（执行重置）逻辑
    - 创建 `packages/backend/src/auth/reset-password.ts`
    - 实现 `resetPassword(token, newPassword, dynamoClient, tableName)` 函数
    - 流程：Scan 查找 resetToken 匹配的用户 → 校验 resetTokenExpiry 未过期 → validatePassword 验证新密码 → bcrypt.hash 生成新哈希 → 更新 Users 表（新 passwordHash、清除 resetToken/resetTokenExpiry、loginFailCount=0、移除 lockUntil）
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 5.3 在 Auth Lambda 中添加忘记密码和重置密码路由
    - 在 `packages/backend/src/auth/handler.ts` 中添加：
      - `POST /api/auth/forgot-password` 路由（无需认证）
      - `POST /api/auth/reset-password` 路由（无需认证）
    - _需求: 7.1, 8.1_

  - [x] 5.4 在 CDK 中添加新 API 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中为 auth 资源添加三个新路由：
      - `auth.addResource('change-password').addMethod('POST', authInt)`
      - `auth.addResource('forgot-password').addMethod('POST', authInt)`
      - `auth.addResource('reset-password').addMethod('POST', authInt)`
    - _需求: 6.1, 7.1, 8.1_

  - [x] 5.5 编写忘记密码防枚举属性测试
    - **Property 7: 忘记密码防枚举响应**
    - 使用 fast-check 生成随机邮箱，验证已注册和未注册邮箱返回相同状态码和响应结构
    - 在 `packages/backend/src/auth/forgot-password.property.test.ts` 中创建测试
    - **验证: 需求 7.5**

  - [x] 5.6 编写重复请求重置令牌失效属性测试
    - **Property 8: 重复请求重置使旧令牌失效**
    - 模拟连续两次请求重置，验证仅最新令牌有效
    - 在 `packages/backend/src/auth/forgot-password.property.test.ts` 中添加测试
    - **验证: 需求 7.6**

  - [x] 5.7 编写重置密码往返属性测试
    - **Property 9: 重置密码往返正确性**
    - 使用 fast-check 生成随机合法密码，验证重置后新密码可通过 bcrypt 验证
    - 在 `packages/backend/src/auth/reset-password.property.test.ts` 中创建测试
    - **验证: 需求 8.2**

  - [x] 5.8 编写重置令牌一次性使用属性测试
    - **Property 10: 重置令牌一次性使用**
    - 验证成功重置后再次使用同一令牌被拒绝
    - 在 `packages/backend/src/auth/reset-password.property.test.ts` 中添加测试
    - **验证: 需求 8.3**

  - [x] 5.9 编写密码重置清除锁定状态属性测试
    - **Property 11: 密码重置清除锁定状态**
    - 模拟锁定用户，验证重置密码后 loginFailCount 为 0 且 lockUntil 被清除
    - 在 `packages/backend/src/auth/reset-password.property.test.ts` 中添加测试
    - **验证: 需求 8.7**

- [x] 6. 检查点 - 密码管理验证
  - 运行所有密码相关测试（修改密码、忘记密码、重置密码），确保功能正确。如有问题请向用户确认。

- [x] 7. 种子脚本与前端更新
  - [x] 7.1 更新种子脚本支持 SuperAdmin 设置
    - 在 `scripts/seed.ts` 中新增 `setupSuperAdmin(userId)` 函数
    - 为目标用户添加 SuperAdmin 角色
    - _需求: 2.2_

  - [x] 7.2 更新前端 Store 类型和方法
    - 在 `packages/frontend/src/store/index.ts` 中：
      - 更新 `UserRole` 类型包含 `'Admin' | 'SuperAdmin'`
      - 新增 `changePassword`、`forgotPassword`、`resetPassword` 方法
    - _需求: 1.3, 6.1, 7.1, 8.1_

  - [x] 7.3 更新管理面板权限校验
    - 在 `packages/frontend/src/pages/admin/index.tsx` 中添加 Admin/SuperAdmin 角色校验
    - 无权限用户重定向到商城首页
    - _需求: 4.4_

  - [x] 7.4 在登录页面添加忘记密码链接
    - 在 `packages/frontend/src/pages/login/index.tsx` 的登录表单底部添加"忘记密码？"链接
    - 跳转到忘记密码页面
    - _需求: 7.1_

  - [x] 7.5 创建忘记密码页面
    - 创建 `packages/frontend/src/pages/forgot-password/index.tsx` 和对应样式文件
    - 页面包含邮箱输入框和提交按钮，提交后显示"重置邮件已发送"提示
    - 在 `packages/frontend/src/app.config.ts` 中注册新页面路由
    - _需求: 7.1, 7.2_

  - [x] 7.6 创建重置密码页面
    - 创建 `packages/frontend/src/pages/reset-password/index.tsx` 和对应样式文件
    - 页面从 URL 参数获取 token，包含新密码输入框和确认按钮
    - 在 `packages/frontend/src/app.config.ts` 中注册新页面路由
    - _需求: 8.1, 8.2_

  - [x] 7.7 在个人中心添加修改密码功能
    - 在 `packages/frontend/src/pages/profile/index.tsx` 中添加"修改密码"按钮和弹窗/表单
    - 表单包含当前密码、新密码、确认新密码三个输入框
    - _需求: 6.1, 6.2_

- [x] 8. 检查点 - 全面验证
  - 运行所有测试确保通过，验证前端页面变更正确。如有问题请向用户确认。

## 备注

- 本次增强不引入新的 Lambda 函数或 DynamoDB 表，仅扩展现有模块
- 属性测试验证设计文档中定义的 11 个正确性属性
- 密码重置令牌使用 Scan 查询（与现有 verificationToken 模式一致），DAU < 1000 场景下性能可接受
- SuperAdmin 角色仅可通过种子脚本或 DynamoDB 控制台直接设置，不暴露 API
- 检查点任务用于阶段性验证，确保增量开发的正确性
