# Implementation Plan: 邀请链接多角色选择（Invite Multi-Role）

## Overview

将邀请链接系统从单角色升级为多角色。按照自底向上的顺序实现：先变更共享类型和错误码，再改后端核心逻辑（invite → admin invites → handler → register），最后改前端交互和 i18n。每一步都保持向后兼容。

## Tasks

- [x] 1. 共享类型与错误码变更
  - [x] 1.1 更新 `InviteRecord` 接口，新增 `roles: UserRole[]` 字段，保留 `role` 字段用于向后兼容；新增 `getInviteRoles()` 辅助函数
    - 修改 `packages/shared/src/types.ts`
    - `InviteRecord` 新增 `roles?: UserRole[]` 可选字段
    - 新增 `getInviteRoles(record)` 函数：优先取 `roles`，回退到 `[role]`
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 新增 `INVALID_ROLES` 错误码
    - 修改 `packages/shared/src/errors.ts`
    - 新增 `INVALID_ROLES` 错误码、HTTP 状态 400、错误消息 `'请至少选择一个角色'`
    - 更新 `packages/shared/src/types.test.ts` 中错误码数量断言
    - _Requirements: 2.2_

  - [x] 1.3 Write property test for `getInviteRoles` backward compatibility
    - **Property 4: 向后兼容读取（Backward-compatible role extraction）**
    - **Validates: Requirements 3.2**

- [x] 2. 后端邀请创建核心逻辑变更
  - [x] 2.1 修改 `createInviteRecord` 和 `batchCreateInvites` 函数参数从 `role` 改为 `roles`
    - 修改 `packages/backend/src/auth/invite.ts`
    - `createInviteRecord(roles: UserRole[], ...)` — 写入 DynamoDB 时同时写入 `role: roles[0]` 和 `roles`
    - `batchCreateInvites(count, roles, ...)` — 校验 roles 去重后长度 ∈ [1,4]，每个角色 ∈ REGULAR_ROLES
    - 返回类型中 `role` 改为 `roles`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3_

  - [x] 2.2 修改 `validateInviteToken` 返回 `roles[]` 而非 `role`
    - 修改 `packages/backend/src/auth/invite.ts`
    - `ValidateInviteResult` 从 `{ success: true; role }` 改为 `{ success: true; roles }`
    - 内部使用 `getInviteRoles()` 从记录中提取角色数组
    - _Requirements: 4.2, 3.2_

  - [x] 2.3 Write property test for invite creation round-trip
    - **Property 1: 邀请创建往返一致性（Invite creation round-trip）**
    - **Validates: Requirements 2.1, 2.5, 3.1**

  - [x] 2.4 Write property test for roles deduplication
    - **Property 2: 角色去重幂等性（Roles deduplication idempotence）**
    - **Validates: Requirements 2.4**

  - [x] 2.5 Write property test for invalid role rejection
    - **Property 3: 非法角色拒绝（Invalid role rejection）**
    - **Validates: Requirements 2.3**

  - [x] 2.6 Write property test for roles array length invariant
    - **Property 5: 角色数组长度不变量（Roles array length invariant）**
    - **Validates: Requirements 3.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 后端管理接口与 Handler 变更
  - [x] 4.1 修改 `batchGenerateInvites` 管理函数参数从 `role` 改为 `roles`
    - 修改 `packages/backend/src/admin/invites.ts`
    - 函数签名 `batchGenerateInvites(count, roles, ...)` 传递 `roles` 给 `batchCreateInvites`
    - 返回类型 `invites` 数组中 `role` 改为 `roles`
    - _Requirements: 2.1, 2.5_

  - [x] 4.2 修改 `handleBatchGenerateInvites` Handler 解析 `body.roles` 替代 `body.role`
    - 修改 `packages/backend/src/admin/handler.ts`
    - 请求体校验从 `body.role` 改为 `body.roles`（数组）
    - 传递 `roles` 数组给 `batchGenerateInvites`
    - _Requirements: 2.1_

  - [x] 4.3 Write unit tests for admin invites multi-role
    - 扩展 `packages/backend/src/admin/invites.ts` 相关测试
    - 测试空 roles 数组返回 INVALID_ROLES 错误
    - 测试单角色 roles 数组正常工作
    - 测试 handler 层 `body.roles` 参数解析
    - _Requirements: 2.1, 2.2_

- [x] 5. 注册逻辑多角色分配
  - [x] 5.1 修改 `registerUser` 使用 `roles[]` 替代 `role`
    - 修改 `packages/backend/src/auth/register.ts`
    - `validateInviteToken` 返回 `roles[]`，创建用户时 `roles` 字段直接使用邀请记录中的 `roles` 数组
    - _Requirements: 4.1, 4.3_

  - [x] 5.2 Write property test for registration role assignment
    - **Property 6: 注册角色完整分配（Registration assigns all invite roles）**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 5.3 Write unit tests for multi-role registration
    - 扩展 `packages/backend/src/auth/register.test.ts`
    - 测试多角色邀请注册后用户拥有所有角色
    - 测试旧格式邀请（仅 role 字段）注册仍正常工作
    - _Requirements: 4.1, 4.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 前端邀请管理页多角色交互
  - [x] 7.1 修改邀请表单角色选择器从单选改为多选
    - 修改 `packages/frontend/src/pages/admin/invites.tsx`
    - `formRole: string` → `formRoles: string[]`（多选状态）
    - 角色选择器点击行为：切换选中/取消
    - 默认状态：无角色选中
    - 提交校验：`formRoles.length === 0` 时阻止提交并显示错误
    - 请求参数：`{ count, roles: formRoles }` 替代 `{ count, role: formRole }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 7.2 修改邀请列表展示多角色徽章
    - 修改 `packages/frontend/src/pages/admin/invites.tsx`
    - `InviteRecord` 接口新增 `roles?: string[]` 字段
    - 使用 `getInviteRoles()` 逻辑获取角色数组，遍历渲染多个 `.role-badge`
    - 新生成邀请结果中展示 `roles` 数组
    - _Requirements: 5.1, 5.2_

  - [x] 7.3 修改注册页面展示多角色徽章
    - 修改 `packages/frontend/src/pages/register/index.tsx`
    - `InviteState` 中 `role: string` → `roles: string[]`
    - 角色展示区域遍历渲染多个 `.role-badge`
    - _Requirements: 4.2, 5.3_

- [x] 8. i18n 翻译更新
  - [x] 8.1 更新 i18n 类型定义和所有语言文件
    - 修改 `packages/frontend/src/i18n/types.ts`：`admin.invites` 新增 `targetRolesLabel: string` 和 `errorRolesRequired: string`
    - 更新 `packages/frontend/src/i18n/zh.ts`、`en.ts`、`ja.ts`、`ko.ts`、`zh-TW.ts` 中对应翻译
    - `targetRoleLabel` 保留或改为 `targetRolesLabel`（目标角色）
    - 新增 `errorRolesRequired`（请至少选择一个角色）
    - _Requirements: 1.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- 向后兼容：旧数据（仅含 `role` 字段）通过 `getInviteRoles()` 统一处理，无需数据迁移
