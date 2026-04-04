# 实现计划：用户管理增强（User Management）

## 概述

将管理后台的用户管理页面从"手动输入用户 ID 分配角色"的简单表单，升级为完整的用户管理系统。涉及共享类型与错误码扩展、新增后端用户管理模块 `admin/users.ts`、Admin Handler 路由扩展、登录流程增强（disabled 状态拦截）、前端用户列表页面重构、CDK 路由配置。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增用户状态类型和错误码
    - 在 `packages/shared/src/types.ts` 中新增：
      - `UserStatus` 类型：`'active' | 'disabled'`
    - 在 `packages/shared/src/errors.ts` 中新增错误码：
      - `USER_NOT_FOUND`（404）：用户不存在
      - `CANNOT_DISABLE_SUPERADMIN`（403）：禁止停用 SuperAdmin 用户
      - `ONLY_SUPERADMIN_CAN_MANAGE_ADMIN`（403）：仅 SuperAdmin 可操作管理员
      - `CANNOT_DELETE_SUPERADMIN`（403）：禁止删除 SuperAdmin 用户
      - `CANNOT_DELETE_SELF`（403）：禁止删除自身账号
      - `ACCOUNT_DISABLED`（403）：账号已停用
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 1.1, 1.6, 2.4, 2.5, 2.6, 2.7, 3.3, 3.4, 3.5, 3.6_

- [x] 2. 后端用户管理核心模块实现
  - [x] 2.1 实现用户列表查询 listUsers
    - 创建 `packages/backend/src/admin/users.ts`
    - 实现 `listUsers(options, dynamoClient, tableName)` 函数
    - 使用 `ScanCommand`，`ProjectionExpression` 仅返回需要的字段（userId、email、nickname、roles、points、status、createdAt）
    - 当 `role` 参数存在时，使用 `FilterExpression: 'contains(#roles, :role)'`
    - `status` 字段不存在时默认返回 `'active'`（兼容历史数据）
    - `pageSize` 默认 20，最大 100；支持 `lastKey` 分页游标
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.2 编写用户列表返回完整记录且默认状态正确属性测试
    - **Property 1: 用户列表返回完整记录且默认状态正确**
    - 使用 fast-check 生成随机用户记录（有/无 status 字段），验证 listUsers 返回的每条记录都包含完整字段，且无 status 字段的记录返回 `'active'`
    - 在 `packages/backend/src/admin/users.property.test.ts` 中创建测试
    - **验证: 需求 1.1, 1.6**

  - [ ]* 2.3 编写角色筛选仅返回匹配用户属性测试
    - **Property 2: 角色筛选仅返回匹配用户**
    - 使用 fast-check 生成随机用户记录 + 随机角色筛选值，验证筛选后的每个用户的 roles 都包含指定角色
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 1.2**

  - [ ]* 2.4 编写分页大小约束属性测试
    - **Property 3: 分页大小约束**
    - 使用 fast-check 生成随机用户记录 + 随机 pageSize，验证返回的用户记录数量不超过 pageSize
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 1.3**

  - [x] 2.5 实现用户停用/启用 setUserStatus
    - 在 `packages/backend/src/admin/users.ts` 中实现 `setUserStatus(userId, status, callerUserId, callerRoles, dynamoClient, tableName)` 函数
    - 先 `GetCommand` 获取目标用户，不存在返回 `USER_NOT_FOUND`
    - 目标用户含 `SuperAdmin` 角色 → 返回 `CANNOT_DISABLE_SUPERADMIN`
    - 目标用户含 `Admin` 角色且调用者非 `SuperAdmin` → 返回 `ONLY_SUPERADMIN_CAN_MANAGE_ADMIN`
    - 使用 `UpdateCommand` 更新 `status` 和 `updatedAt`
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.6 实现用户删除 deleteUser
    - 在 `packages/backend/src/admin/users.ts` 中实现 `deleteUser(userId, callerUserId, callerRoles, dynamoClient, tableName)` 函数
    - 先 `GetCommand` 获取目标用户，不存在返回 `USER_NOT_FOUND`
    - `callerUserId === userId` → 返回 `CANNOT_DELETE_SELF`
    - 目标用户含 `SuperAdmin` 角色 → 返回 `CANNOT_DELETE_SUPERADMIN`
    - 目标用户含 `Admin` 角色且调用者非 `SuperAdmin` → 返回 `ONLY_SUPERADMIN_CAN_MANAGE_ADMIN`
    - 使用 `DeleteCommand` 硬删除用户记录
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 2.7 编写用户状态切换往返一致性属性测试
    - **Property 4: 用户状态切换往返一致性**
    - 使用 fast-check 生成随机普通用户（不含 Admin/SuperAdmin），验证先 disabled 再 active 后状态恢复且其他字段不变
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 2.2, 2.3**

  - [ ]* 2.8 编写 SuperAdmin 不可被停用或删除属性测试
    - **Property 5: SuperAdmin 用户不可被停用或删除**
    - 使用 fast-check 生成随机 SuperAdmin 用户 + 随机调用者角色，验证 setUserStatus(disabled) 和 deleteUser 均被拒绝
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 2.5, 3.4**

  - [ ]* 2.9 编写非 SuperAdmin 无法操作 Admin 用户属性测试
    - **Property 6: 非 SuperAdmin 管理员无法操作 Admin 用户**
    - 使用 fast-check 生成不含 SuperAdmin 的调用者角色集合，验证停用或删除 Admin 用户被拒绝
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 2.6, 3.5**

  - [ ]* 2.10 编写删除用户后记录不存在属性测试
    - **Property 8: 删除用户后记录不存在**
    - 使用 fast-check 生成随机普通用户，验证 deleteUser 后 GetCommand 返回空
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 3.2**

  - [ ]* 2.11 编写禁止删除自身账号属性测试
    - **Property 9: 禁止删除自身账号**
    - 使用 fast-check 生成随机管理员 userId，验证 deleteUser 自身被拒绝且记录不变
    - 在 `packages/backend/src/admin/users.property.test.ts` 中添加测试
    - **验证: 需求 3.6**

- [x] 3. 检查点 - 用户管理核心逻辑验证
  - 运行 `packages/backend/src/admin/users.test.ts` 和 `packages/backend/src/admin/users.property.test.ts` 相关测试，确保 listUsers、setUserStatus、deleteUser 逻辑正确。如有问题请向用户确认。


- [x] 4. Admin Handler 路由扩展与登录流程增强
  - [x] 4.1 在 Admin Handler 中添加用户管理路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增路由正则 `USERS_STATUS_REGEX = /^\/api\/admin\/users\/([^/]+)\/status$/` 和 `USERS_DELETE_REGEX = /^\/api\/admin\/users\/([^/]+)$/`
      - 添加 `GET /api/admin/users` 路由，解析 `role`、`pageSize`、`lastKey` 查询参数，调用 `listUsers`
      - 添加 `PATCH /api/admin/users/{id}/status` 路由，解析 body 中的 `status`，调用 `setUserStatus`，传递 `event.user.userId` 和 `event.user.roles`
      - 添加 `DELETE /api/admin/users/{id}` 路由，调用 `deleteUser`，传递 `event.user.userId` 和 `event.user.roles`
      - 注意：DELETE 路由需排除已有的 `PUT /api/admin/users/{id}/roles` 路由冲突
    - 导入 `listUsers`、`setUserStatus`、`deleteUser` 从 `./users`
    - _需求: 1.1, 1.7, 2.1, 3.1_

  - [x] 4.2 增强登录流程拦截已停用用户
    - 在 `packages/backend/src/auth/login.ts` 的 `loginUser` 函数中，在 lockUntil 检查之后、密码比较之前新增 `disabled` 状态检查：
      - 如果 `user.status === 'disabled'`，返回 `{ success: false, error: { code: ACCOUNT_DISABLED, message: '账号已停用' } }`
    - _需求: 2.7_

  - [ ]* 4.3 编写已停用用户无法登录属性测试
    - **Property 7: 已停用用户无法登录**
    - 使用 fast-check 生成随机 disabled 用户 + 正确密码，验证登录被拒绝并返回 ACCOUNT_DISABLED
    - 在 `packages/backend/src/auth/login-disabled.property.test.ts` 中创建测试
    - **验证: 需求 2.7**

- [x] 5. 检查点 - 路由与登录增强验证
  - 运行 Admin Handler 和 Auth Login 相关测试，确保新增路由分发正确、已停用用户登录被拦截。如有问题请向用户确认。

- [x] 6. CDK 路由配置
  - [x] 6.1 在 API Gateway 中注册新增用户管理路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 在现有 `adminUsers` 资源上添加 `GET` 方法：`adminUsers.addMethod('GET', adminInt)`
      - 将现有 `adminUsers.addResource('{id}')` 提取为变量 `adminUserById` 复用
      - 在 `adminUserById` 上添加 `status` 子资源和 `PATCH` 方法：`adminUserById.addResource('status').addMethod('PATCH', adminInt)`
      - 在 `adminUserById` 上添加 `DELETE` 方法：`adminUserById.addMethod('DELETE', adminInt)`
      - 确保所有新增路由支持 CORS 预检请求（已由 `defaultCorsPreflightOptions` 覆盖）
    - _需求: 6.1, 6.2, 6.3, 6.4_

- [x] 7. 检查点 - CDK 编译验证
  - 确保 CDK 代码编译通过，新增路由定义正确。如有问题请向用户确认。

- [x] 8. 前端用户管理页面重构
  - [x] 8.1 重构用户管理页面为完整列表页
    - 重构 `packages/frontend/src/pages/admin/users.tsx`，参照 `invites.tsx` 的模式：
      - 顶部工具栏：返回按钮 + 标题"用户管理"
      - 角色筛选标签栏：全部 | UserGroupLeader | CommunityBuilder | Speaker | Volunteer | Admin
      - 用户列表：每行显示昵称、邮箱、角色徽章（使用全局 `.role-badge` 类）、积分余额、状态标签、注册时间
      - 每个用户行提供操作按钮：编辑角色、停用/启用、删除
      - disabled 状态用户行以视觉区分方式展示（灰色文字或停用标签）
      - 分页：底部"加载更多"按钮（当 lastKey 存在时显示）
    - API 调用：
      - `GET /api/admin/users?role=xxx&pageSize=20&lastKey=xxx` → 获取用户列表
      - `PUT /api/admin/users/{id}/roles` → 更新角色（复用现有接口）
      - `PATCH /api/admin/users/{id}/status` → 停用/启用
      - `DELETE /api/admin/users/{id}` → 删除
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10_

  - [x] 8.2 实现角色编辑弹窗
    - 在用户管理页面中实现角色编辑弹窗（复用 `form-overlay` / `form-modal` 模式）：
      - 展示目标用户当前角色列表和可选角色
      - 根据当前管理员角色决定可分配范围：Admin 仅可分配普通角色，SuperAdmin 可分配普通角色和 Admin 角色
      - 提交后调用 `PUT /api/admin/users/{id}/roles` 更新角色
      - 成功后刷新列表中该用户的角色显示
      - 失败时展示具体错误提示
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 8.3 实现停用/删除确认对话框
    - 停用按钮点击后展示确认对话框，确认后调用 `PATCH /api/admin/users/{id}/status`
    - 删除按钮点击后展示确认对话框，确认后调用 `DELETE /api/admin/users/{id}`
    - 操作成功后刷新用户列表
    - 操作失败时展示具体错误提示
    - _需求: 5.6, 5.7_

  - [x] 8.4 创建用户管理页面样式
    - 创建 `packages/frontend/src/pages/admin/users.scss`
    - 遵循现有管理后台设计规范，使用 CSS 变量（`--bg-*`、`--text-*`、`--space-*`、`--radius-*`、`--transition-*`）
    - 角色徽章使用全局 `.role-badge` 类，按钮使用全局 `.btn-primary`、`.btn-danger` 等类
    - disabled 用户行样式：降低透明度或使用 `--text-tertiary` 色值
    - _需求: 5.9, 5.10_

- [x] 9. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 本次增强不引入新的 Lambda 函数或 DynamoDB 表，仅在现有架构上扩展
- 属性测试验证设计文档中定义的 9 个正确性属性
- Users 表新增 `status` 字段，历史记录无此字段时默认视为 `active`
- 用户列表使用 DynamoDB Scan（用户量 < 1000），角色筛选使用 FilterExpression
- 权限分级：SuperAdmin 不可被停用/删除，Admin 用户仅 SuperAdmin 可操作
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类（`.role-badge`、`.btn-primary` 等）
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
