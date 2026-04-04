# 实现计划：邀请制注册（Invite Registration）

## 概述

将系统注册方式从开放注册改为邀请制注册。涉及共享类型与错误码扩展、新增 Invites DynamoDB 表、Auth Lambda 改造（validate-invite 路由 + register 路由改造）、Admin Lambda 扩展（邀请管理路由）、前端注册页面改造和新增邀请管理页面。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增邀请相关类型定义
    - 在 `packages/shared/src/types.ts` 中新增：
      - `InviteStatus` 类型：`'pending' | 'used' | 'expired'`
      - `InviteRecord` 接口：token、role、status、createdAt、expiresAt、usedAt?、usedBy?
    - _需求: 1.1, 2.1, 4.1_

  - [x] 1.2 新增邀请相关错误码
    - 在 `packages/shared/src/errors.ts` 中新增错误码：
      - `INVITE_TOKEN_INVALID`（400）：邀请链接无效或不存在
      - `INVITE_TOKEN_USED`（400）：邀请链接已被使用
      - `INVITE_TOKEN_EXPIRED`（400）：邀请链接已过期
      - `INVITE_NOT_FOUND`（404）：邀请记录不存在
      - `INVITE_NOT_REVOCABLE`（400）：该邀请无法撤销（非 pending 状态）
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 2.2, 2.3, 2.4, 4.3_

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 Invites DynamoDB 表
    - 在 `packages/cdk/lib/database-stack.ts` 中新增 `InvitesTable`：
      - 表名 `PointsMall-Invites`，PK = `token`（String）
      - GSI `status-createdAt-index`：PK = `status`，SK = `createdAt`
      - `billingMode: PAY_PER_REQUEST`，`removalPolicy: DESTROY`
    - 导出 `invitesTable` 公共属性
    - _需求: 1.1, 4.1_

  - [x] 2.2 更新 ApiStack 接入 Invites 表并新增 API 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 新增 `invitesTable: dynamodb.Table`
      - 授予 Auth Lambda 对 Invites 表的读写权限
      - 授予 Admin Lambda 对 Invites 表的读写权限
      - 新增 Auth 路由：`POST /api/auth/validate-invite`
      - 新增 Admin 路由：`POST /api/admin/invites/batch`、`GET /api/admin/invites`、`PATCH /api/admin/invites/{token}/revoke`
    - 在 `packages/cdk/bin/app.ts` 中将 `invitesTable` 传递给 ApiStack
    - _需求: 1.1, 2.1, 4.1_

- [x] 3. 检查点 - 基础设施验证
  - 确保 CDK 代码编译通过，新增表和路由定义正确。如有问题请向用户确认。

- [x] 4. 后端邀请核心逻辑实现
  - [x] 4.1 创建邀请核心逻辑模块
    - 创建 `packages/backend/src/auth/invite.ts`
    - 实现以下函数：
      - `generateInviteToken()`：使用 `crypto.randomBytes(32).toString('hex')` 生成 64 字符十六进制 token
      - `buildInviteLink(token, registerBaseUrl)`：返回 `${registerBaseUrl}?token=${token}`
      - `createInviteRecord(role, dynamoClient, invitesTable, registerBaseUrl)`：生成 token、计算 expiresAt（createdAt + 86400 秒）、写入 DynamoDB，返回 InviteRecord 和 link
      - `batchCreateInvites(count, role, dynamoClient, invitesTable, registerBaseUrl)`：批量调用 createInviteRecord，校验 count ∈ [1, 100] 和 role ∈ REGULAR_ROLES
      - `validateInviteToken(token, dynamoClient, invitesTable)`：查询 token → 不存在返回 INVITE_TOKEN_INVALID → status=used 返回 INVITE_TOKEN_USED → 过期时惰性更新 status 为 expired 并返回 INVITE_TOKEN_EXPIRED → 有效时返回 role
      - `consumeInviteToken(token, userId, dynamoClient, invitesTable)`：使用条件更新（`ConditionExpression: '#status = :pending'`）将 token 状态改为 used，捕获 ConditionalCheckFailedException 返回 INVITE_TOKEN_USED
    - _需求: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 5.1, 5.2, 6.1_

  - [ ]* 4.2 编写批量生成记录完整性属性测试
    - **Property 1: 批量生成记录完整性**
    - 使用 `fc.integer({ min: 1, max: 100 })` + `fc.constantFrom(...REGULAR_ROLES)` 生成参数，验证生成记录数量等于 count、每条 role 正确、status 为 pending、expiresAt - createdAt = 86400 秒
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中创建测试
    - **验证: 需求 1.1, 5.1, 5.3**

  - [ ]* 4.3 编写 Invite_Link 格式正确性属性测试
    - **Property 2: Invite_Link 格式正确性**
    - 使用 `fc.hexaString({ minLength: 64, maxLength: 64 })` 生成 token，验证 buildInviteLink 返回值格式为 `{baseUrl}?token={token}` 且 token 完整保留
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 1.2**

  - [ ]* 4.4 编写数量参数边界验证属性测试
    - **Property 3: 数量参数边界验证**
    - 使用 `fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 101 }))` 生成非法数量，验证 batchCreateInvites 被拒绝且不创建任何记录
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 1.3**

  - [ ]* 4.5 编写非法角色被拒绝属性测试
    - **Property 4: 非法角色被拒绝**
    - 使用 `fc.string().filter(s => !REGULAR_ROLES.includes(s as any))` 生成非法角色，验证 batchCreateInvites 返回角色无效错误
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 1.4**

  - [ ]* 4.6 编写 token 生成安全性属性测试
    - **Property 16: token 生成安全性**
    - 使用 `fc.integer({ min: 1, max: 100 })` 生成数量，验证每个 token 长度 ≥ 32 字符且 N 个 token 互不重复
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 6.1, 6.2**

- [x] 5. 检查点 - 邀请核心逻辑验证
  - 运行邀请核心逻辑相关测试，确保 token 生成、链接构建、验证和消耗逻辑正确。如有问题请向用户确认。

- [x] 6. Auth Lambda 扩展
  - [x] 6.1 新增 validate-invite 路由
    - 在 `packages/backend/src/auth/handler.ts` 中：
      - 新增环境变量 `INVITES_TABLE` 和 `REGISTER_BASE_URL`
      - 添加 `POST /api/auth/validate-invite` 路由（无需认证），调用 `validateInviteToken`
      - 成功时返回 `{ valid: true, role }`，失败时返回对应错误码
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 6.2 改造 register 路由支持邀请制
    - 在 `packages/backend/src/auth/register.ts` 中：
      - 更新 `RegisterRequest` 接口新增 `inviteToken: string` 必填字段
      - 更新 `registerUser` 函数签名接受 `inviteToken`、`invitesTable` 和 `dynamoClient`（已有）
      - 注册流程变更：① 验证 inviteToken 有效性 → ② 验证密码格式 → ③ 检查邮箱唯一性 → ④ 创建用户（roles 初始值为 `[invite.role]`）→ ⑤ 消耗 token（条件更新）→ ⑥ 发送验证邮件
      - 邮箱重复时直接返回错误，不消耗 token
    - 在 `packages/backend/src/auth/handler.ts` 中更新 `handleRegister` 传递 inviteToken 和 invitesTable
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 6.3 编写无效 token 被拒绝属性测试
    - **Property 6: 无效 token 被拒绝**
    - 使用 `fc.hexaString({ minLength: 64, maxLength: 64 })` 生成不存在的 token，验证 validateInviteToken 返回 INVITE_TOKEN_INVALID
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 2.1, 2.2**

  - [ ]* 6.4 编写已使用 token 幂等性属性测试
    - **Property 7: 已使用 token 的幂等性**
    - 使用随机 used 状态的 InviteRecord，验证 validateInviteToken 和 register 均返回 INVITE_TOKEN_USED 且系统状态不变
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 2.3, 6.3**

  - [ ]* 6.5 编写过期 token 被拒绝并更新状态属性测试
    - **Property 8: 过期 token 被拒绝并更新状态**
    - 使用 expiresAt 早于当前时间的 InviteRecord，验证 validateInviteToken 返回 INVITE_TOKEN_EXPIRED 且 status 被更新为 expired
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 2.4, 5.2**

  - [ ]* 6.6 编写验证成功返回目标角色属性测试
    - **Property 9: 验证成功返回目标角色**
    - 使用随机 pending 且未过期的 InviteRecord，验证 validateInviteToken 返回 `valid: true` 及正确的 role
    - 在 `packages/backend/src/auth/invite.property.test.ts` 中添加测试
    - **验证: 需求 2.5**

  - [ ]* 6.7 编写注册成功后 token 状态变为 used 属性测试
    - **Property 10: 注册成功后 token 状态变为 used**
    - 使用随机有效 token 和合法注册信息，验证注册成功后新用户 roles 仅包含 invite.role，且 token status 变为 used、usedBy 等于新用户 userId
    - 在 `packages/backend/src/auth/register.property.test.ts` 中创建测试
    - **验证: 需求 3.1, 3.2**

  - [ ]* 6.8 编写失效 token 拒绝注册属性测试
    - **Property 11: 失效 token 拒绝注册**
    - 使用随机 used/expired 状态的 InviteRecord，验证注册请求被拒绝且不创建任何用户记录
    - 在 `packages/backend/src/auth/register.property.test.ts` 中添加测试
    - **验证: 需求 3.3**

  - [ ]* 6.9 编写邮箱重复不消耗 token 属性测试
    - **Property 12: 邮箱重复不消耗 token**
    - 使用有效 token 和已注册邮箱，验证返回 EMAIL_ALREADY_EXISTS 且 token status 保持 pending
    - 在 `packages/backend/src/auth/register.property.test.ts` 中添加测试
    - **验证: 需求 3.4**

- [x] 7. 检查点 - Auth Lambda 验证
  - 运行 Auth 相关所有测试，确保 validate-invite 路由和改造后的 register 路由正确。如有问题请向用户确认。

- [x] 8. Admin Lambda 扩展
  - [x] 8.1 创建邀请管理逻辑模块
    - 创建 `packages/backend/src/admin/invites.ts`
    - 实现以下函数：
      - `batchGenerateInvites(count, role, dynamoClient, invitesTable, registerBaseUrl)`：调用 `batchCreateInvites`，返回 invites 数组（含 token、link、role、expiresAt）
      - `listInvites(status, lastKey, pageSize, dynamoClient, invitesTable)`：status 有值时通过 GSI `status-createdAt-index` 查询，否则 Scan；支持分页
      - `revokeInvite(token, dynamoClient, invitesTable)`：查询 token → 不存在返回 INVITE_NOT_FOUND → status 非 pending 返回 INVITE_NOT_REVOCABLE → 条件更新 status 为 expired
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3_

  - [x] 8.2 在 Admin Lambda Handler 中添加邀请管理路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增环境变量 `INVITES_TABLE` 和 `REGISTER_BASE_URL`
      - 添加路由正则 `INVITES_REVOKE_REGEX = /^\/api\/admin\/invites\/([^/]+)\/revoke$/`
      - 添加 `POST /api/admin/invites/batch` 路由，调用 `batchGenerateInvites`，返回 201
      - 添加 `GET /api/admin/invites` 路由，支持 `status`、`lastKey`、`pageSize` 查询参数，调用 `listInvites`
      - 添加 `PATCH /api/admin/invites/{token}/revoke` 路由，调用 `revokeInvite`
    - _需求: 1.1, 1.5, 4.1, 4.2, 4.3_

  - [ ]* 8.3 编写非管理员无法生成邀请属性测试
    - **Property 5: 非管理员无法生成邀请**
    - 使用 `fc.subarray(REGULAR_ROLES)` 生成不含 Admin/SuperAdmin 的角色集合，验证调用邀请生成接口返回 403
    - 在 `packages/backend/src/admin/invites.property.test.ts` 中创建测试
    - **验证: 需求 1.5**

  - [ ]* 8.4 编写按状态筛选正确性属性测试
    - **Property 13: 按状态筛选正确性**
    - 使用 `fc.constantFrom('pending', 'used', 'expired')` + 随机 InviteRecord 数组，验证筛选结果中每条记录 status 等于筛选条件且所有符合条件的记录均出现
    - 在 `packages/backend/src/admin/invites.property.test.ts` 中添加测试
    - **验证: 需求 4.2**

  - [ ]* 8.5 编写撤销操作更新状态属性测试
    - **Property 14: 撤销操作更新状态**
    - 使用随机 pending 状态的 InviteRecord，验证撤销后 status 变为 expired，且后续 validateInviteToken 返回 INVITE_TOKEN_EXPIRED
    - 在 `packages/backend/src/admin/invites.property.test.ts` 中添加测试
    - **验证: 需求 4.3**

  - [ ]* 8.6 编写使用时间早于过期时间属性测试
    - **Property 15: 使用时间早于过期时间**
    - 使用随机 used 状态的 InviteRecord，验证 usedAt 时间戳严格早于 expiresAt 时间戳
    - 在 `packages/backend/src/admin/invites.property.test.ts` 中添加测试
    - **验证: 需求 5.4**

- [x] 9. 检查点 - Admin Lambda 验证
  - 运行 Admin 邀请管理相关所有测试，确保批量生成、列表查询和撤销逻辑正确。如有问题请向用户确认。

- [x] 10. 前端注册页面改造
  - [x] 10.1 改造注册页面支持邀请制入口
    - 修改 `packages/frontend/src/pages/register/index.tsx`：
      - 页面加载时从 URL query 参数读取 `token`（使用 `Taro.getCurrentInstance().router?.params`）
      - 调用 `POST /api/auth/validate-invite` 验证 token 有效性
      - token 无效/缺失时：隐藏注册表单，展示"邀请链接无效"提示卡片
      - token 有效时：展示注册表单，并在表单顶部展示目标角色徽章（使用全局 `.role-badge` 类）
      - 提交注册时将 `inviteToken` 附加到请求体
      - 处理新增错误码：`INVITE_TOKEN_INVALID`、`INVITE_TOKEN_USED`、`INVITE_TOKEN_EXPIRED`
    - 更新对应 SCSS 文件，新增无效邀请提示样式（使用 CSS 变量，不硬编码色值）
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.6_

- [x] 11. 前端邀请管理页面
  - [x] 11.1 创建邀请管理页面
    - 创建 `packages/frontend/src/pages/admin/invites.tsx` 和 `packages/frontend/src/pages/admin/invites.scss`
    - 页面功能：
      - 顶部状态筛选 Tab（全部 / pending / used / expired）
      - 邀请记录列表：展示 token（截断前 8 位 + ...）、目标角色徽章（`.role-badge`）、状态标签、创建时间、过期时间、使用时间（已使用时）
      - pending 状态记录显示"复制链接"按钮（调用 `Taro.setClipboardData`）和"撤销"按钮
      - 顶部"生成邀请链接"按钮，点击展开批量生成表单（选择角色 + 输入数量 1~100）
      - 生成成功后刷新列表并展示新生成的链接列表（可逐条复制）
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/invites` 路由
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 11.2 在管理后台导航中添加邀请管理入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 的 `ADMIN_LINKS` 数组中新增：
      ```typescript
      { key: 'invites', icon: '✉️', title: '邀请管理', desc: '生成邀请链接，管理邀请记录', url: '/pages/admin/invites' }
      ```
    - _需求: 4.1, 4.4_

- [x] 12. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确，注册页面邀请制流程完整。如有问题请向用户确认。

## 备注

- 本次新增 1 张 DynamoDB 表（Invites）和若干路由，不引入新 Lambda 函数
- 属性测试验证设计文档中定义的 16 个正确性属性
- Token 使用 `crypto.randomBytes(32).toString('hex')` 生成，64 字符十六进制，满足唯一性和不可预测性
- 注册流程保持原子性：邮箱重复时不消耗 token，并发冲突通过 DynamoDB 条件更新防护
- 过期检查采用惰性更新策略，无需定时任务
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类（`.role-badge`、`.btn-primary` 等）
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
