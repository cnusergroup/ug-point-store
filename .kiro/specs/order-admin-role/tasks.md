# Implementation Plan: OrderAdmin 角色（Order Admin Role）

## Overview

新增 OrderAdmin 独占角色，专用于订单管理。按照自底向上的顺序实现：先变更共享类型和常量，再改后端访问控制和邀请/角色逻辑，然后改前端路由和 UI，最后补充 i18n 翻译。每一步都保持向后兼容。

## Tasks

- [x] 1. 共享类型与常量变更
  - [x] 1.1 扩展 `UserRole` 类型，新增 `OrderAdmin` 值；新增 `EXCLUSIVE_ROLES` 常量；更新 `ALL_ROLES` 数组
    - 修改 `packages/shared/src/types.ts`
    - `UserRole` 联合类型新增 `'OrderAdmin'`
    - 新增 `export const EXCLUSIVE_ROLES: UserRole[] = ['OrderAdmin']`
    - `ALL_ROLES` 改为 `[...REGULAR_ROLES, ...ADMIN_ROLES, ...EXCLUSIVE_ROLES]`
    - `ADMIN_ROLES` 和 `REGULAR_ROLES` 不变
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 新增辅助函数 `isOrderAdmin`、`isExclusiveRole`、`validateRoleExclusivity`
    - 修改 `packages/shared/src/types.ts`
    - `isOrderAdmin(roles)`: 判断是否含 OrderAdmin
    - `isExclusiveRole(role)`: 判断是否为独占角色
    - `validateRoleExclusivity(roles)`: 校验独占角色不与其他角色共存
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.3 新增错误码 `EXCLUSIVE_ROLE_CONFLICT`、`ORDER_ADMIN_REQUIRES_SUPERADMIN`、`ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN`
    - 修改 `packages/shared/src/errors.ts`
    - 新增三个错误码及对应 HTTP 状态和消息
    - _Requirements: 10.3, 9.2_

  - [x] 1.4 编写单元测试验证类型常量和辅助函数
    - 扩展 `packages/shared/src/types.test.ts`
    - 测试 OrderAdmin ∈ ALL_ROLES、∉ ADMIN_ROLES、∉ REGULAR_ROLES、∈ EXCLUSIVE_ROLES
    - 测试 isOrderAdmin、isExclusiveRole、validateRoleExclusivity
    - _Requirements: 1.1–1.5_

  - [x] 1.5 Write property test for `validateRoleExclusivity`
    - **Property 1: 角色互斥不变量（Role exclusivity invariant）**
    - 测试文件：`packages/shared/src/types.test.ts`（扩展）
    - 生成器：`fc.subarray(ALL_ROLES)` 组合
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [x] 2. 后端订单 Handler 访问控制
  - [x] 2.1 扩展 `orders/handler.ts` 的 `isAdmin` 函数，允许 OrderAdmin 访问订单 admin API
    - 修改 `packages/backend/src/orders/handler.ts`
    - `isAdmin` 函数新增 `isOrderAdmin` 检查
    - OrderAdmin 绕过 `adminOrdersEnabled` toggle（与 SuperAdmin 同等待遇）
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

  - [x] 2.2 扩展 `admin/handler.ts` 的 `isAdmin` 函数，并添加 OrderAdmin 白名单拦截
    - 修改 `packages/backend/src/admin/handler.ts`
    - `isAdmin` 函数新增 OrderAdmin 检查
    - 在 isAdmin 通过后、路由分发前，检测 OrderAdmin 并返回 403
    - _Requirements: 3.4_

  - [x] 2.3 编写单元测试验证 OrderAdmin 订单 API 访问
    - 扩展 `packages/backend/src/orders/handler.test.ts`
    - 测试 OrderAdmin 可访问 4 个订单 admin 端点
    - 测试 OrderAdmin 绕过 adminOrdersEnabled toggle
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

  - [x] 2.4 编写单元测试验证 OrderAdmin 被 admin handler 拒绝
    - 扩展 `packages/backend/src/admin/handler.test.ts`
    - 测试 OrderAdmin 访问任何 admin handler 路由返回 403
    - _Requirements: 3.4_

  - [x] 2.5 Write property test for OrderAdmin API whitelist enforcement
    - **Property 2: OrderAdmin API 白名单强制执行**
    - 新建 `packages/backend/src/admin/order-admin-access.property.test.ts`
    - 生成器：从非订单 admin 路径集合中随机选取
    - **Validates: Requirements 3.4**

- [x] 3. 后端邀请系统与角色分配
  - [x] 3.1 扩展 `batchCreateInvites` 支持独占角色校验
    - 修改 `packages/backend/src/auth/invite.ts`
    - 独占角色校验：含 EXCLUSIVE_ROLES 时 roles 长度必须为 1
    - 独占角色跳过 REGULAR_ROLES 校验
    - _Requirements: 2.5, 10.3_

  - [x] 3.2 扩展 `handleBatchGenerateInvites` 添加 SuperAdmin 权限检查
    - 修改 `packages/backend/src/admin/handler.ts`
    - 当 roles 含 OrderAdmin 时，调用者必须是 SuperAdmin
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 扩展 `roles.ts` 的 `VALID_ROLES`、`validateRoleAssignment`、`assignRoles` 支持 OrderAdmin
    - 修改 `packages/backend/src/admin/roles.ts`
    - `VALID_ROLES` 新增 `OrderAdmin`
    - `validateRoleAssignment` 新增 OrderAdmin 需要 SuperAdmin 权限检查
    - `assignRoles` 写入前调用 `validateRoleExclusivity` 校验
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 3.4 扩展 `users.ts` 的 `setUserStatus` 和 `deleteUser` 保护 OrderAdmin 用户
    - 修改 `packages/backend/src/admin/users.ts`
    - 非 SuperAdmin 不能 disable/delete OrderAdmin 用户
    - _Requirements: 9.2, 9.3_

  - [x] 3.5 编写单元测试验证邀请和角色分配
    - 扩展 `packages/backend/src/admin/invites.test.ts`：OrderAdmin 邀请成功/失败
    - 扩展 `packages/backend/src/admin/roles.test.ts`：互斥校验、权限检查
    - 扩展 `packages/backend/src/admin/users.test.ts`：OrderAdmin 用户保护
    - _Requirements: 2.5, 9.2, 9.3, 10.1, 10.2, 10.3_

  - [x] 3.6 Write property test for exclusive role invite creation
    - **Property 4: 独占角色邀请创建一致性**
    - 新建 `packages/backend/src/admin/order-admin-invite.property.test.ts`
    - 生成器：`fc.subarray(ALL_ROLES, { minLength: 1 })` 含/不含 OrderAdmin
    - **Validates: Requirements 2.5, 10.3**

  - [x] 3.7 Write property test for non-SuperAdmin cannot modify OrderAdmin users
    - **Property 3: 非 SuperAdmin 不可操作 OrderAdmin 用户**
    - 扩展 `packages/backend/src/admin/order-admin-access.property.test.ts`
    - 生成器：非 SuperAdmin 角色组合 × 操作类型
    - **Validates: Requirements 9.2, 9.3**

- [x] 4. Checkpoint - 确保所有后端测试通过
  - 运行 `npx vitest --run` 确保所有测试通过

- [x] 5. 前端 Store 与登录重定向
  - [x] 5.1 扩展前端 `UserRole` 类型，新增 `OrderAdmin`
    - 修改 `packages/frontend/src/store/index.ts`
    - `UserRole` 联合类型新增 `'OrderAdmin'`
    - _Requirements: 1.1_

  - [x] 5.2 在 `loginByEmail` 和 `register` 方法中添加 OrderAdmin 重定向逻辑
    - 修改 `packages/frontend/src/store/index.ts`
    - 登录/注册成功后，检测 OrderAdmin 角色并 `Taro.redirectTo({ url: '/pages/admin/orders' })`
    - _Requirements: 4.1, 4.2_

- [x] 6. 前端 Admin Dashboard 重定向
  - [x] 6.1 在 admin/index.tsx 的 useEffect 中添加 OrderAdmin 重定向
    - 修改 `packages/frontend/src/pages/admin/index.tsx`
    - 检测 OrderAdmin 角色，`Taro.redirectTo({ url: '/pages/admin/orders' })` 并 return
    - 在 hasAdminAccess 检查之前执行
    - _Requirements: 6.1, 6.2_

- [x] 7. 前端订单页 OrderAdmin 支持
  - [x] 7.1 修改 orders.tsx 让 OrderAdmin 绕过 feature toggle 检查
    - 修改 `packages/frontend/src/pages/admin/orders.tsx`
    - 新增 `isOrderAdmin` 变量
    - OrderAdmin 与 SuperAdmin 同等待遇，直接加载数据
    - _Requirements: 5.1, 5.2_

  - [x] 7.2 修改 orders.tsx 返回按钮行为，OrderAdmin 返回设置页
    - 修改 `packages/frontend/src/pages/admin/orders.tsx`
    - OrderAdmin 的 handleBack 导航到 `/pages/settings/index`
    - _Requirements: 8.1_

- [x] 8. 前端设置页与 Hub 页
  - [x] 8.1 验证 settings/index.tsx 对 OrderAdmin 的行为（无需修改）
    - 确认现有 `isAdmin` 逻辑（仅检查 Admin/SuperAdmin）自然排除 OrderAdmin
    - OrderAdmin 看到：修改密码、主题切换、语言切换、登出
    - OrderAdmin 不看到：管理面板入口
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 8.2 修改 hub/index.tsx 为 OrderAdmin 提供最小化导航
    - 修改 `packages/frontend/src/pages/hub/index.tsx`
    - 新增 `isOrderAdmin` 检测
    - OrderAdmin 专用布局：仅显示"订单管理"和"设置"两个入口
    - 扩展 `ROLE_CONFIG` 新增 OrderAdmin 角色配置
    - _Requirements: 8.1, 8.2_

- [x] 9. 前端邀请页互斥逻辑
  - [x] 9.1 修改 invites.tsx 角色选择器支持 OrderAdmin 互斥
    - 修改 `packages/frontend/src/pages/admin/invites.tsx`
    - SuperAdmin 可见 OrderAdmin 选项，非 SuperAdmin 不可见
    - 选择 OrderAdmin 时清除其他角色，选择其他角色时清除 OrderAdmin
    - 修改 `toggleRole` 函数实现互斥逻辑
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.2 扩展 ROLE_LABELS 和 ROLE_OPTIONS 支持 OrderAdmin
    - 修改 `packages/frontend/src/pages/admin/invites.tsx`
    - 新增 OrderAdmin 的 label 和 className
    - _Requirements: 11.6_

- [x] 10. 前端用户管理页排除 OrderAdmin
  - [x] 10.1 确认 batch-points 页面角色选择器不含 OrderAdmin
    - 检查 `packages/frontend/src/pages/admin/batch-points.tsx`
    - 确认角色选择器使用 REGULAR_ROLES 或硬编码的普通角色列表
    - 如需修改则排除 OrderAdmin
    - _Requirements: 9.4_

  - [x] 10.2 确认 claims 页面角色筛选器不含 OrderAdmin
    - 检查 `packages/frontend/src/pages/admin/claims.tsx`
    - 确认角色筛选器不包含 OrderAdmin
    - 如需修改则排除 OrderAdmin
    - _Requirements: 9.5_

- [x] 11. i18n 翻译
  - [x] 11.1 更新 i18n 类型定义
    - 修改 `packages/frontend/src/i18n/types.ts`
    - 新增 `roles.orderAdmin: string` 键
    - 新增 `hub.orderManagement: string` 键
    - _Requirements: 11.1–11.6_

  - [x] 11.2 更新所有语言文件
    - 修改 `packages/frontend/src/i18n/zh.ts`：`roles.orderAdmin: '订单管理员'`，`hub.orderManagement: '订单管理'`
    - 修改 `packages/frontend/src/i18n/en.ts`：`roles.orderAdmin: 'Order Admin'`，`hub.orderManagement: 'Order Management'`
    - 修改 `packages/frontend/src/i18n/ja.ts`：`roles.orderAdmin: '注文管理者'`，`hub.orderManagement: '注文管理'`
    - 修改 `packages/frontend/src/i18n/ko.ts`：`roles.orderAdmin: '주문 관리자'`，`hub.orderManagement: '주문 관리'`
    - 修改 `packages/frontend/src/i18n/zh-TW.ts`：`roles.orderAdmin: '訂單管理員'`，`hub.orderManagement: '訂單管理'`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 11.3 更新前端角色显示配置使用 i18n 键
    - 确保 hub/index.tsx 的 ROLE_CONFIG、invites.tsx 的 ROLE_LABELS 使用翻译后的 OrderAdmin 标签
    - _Requirements: 11.6_

- [x] 12. Final checkpoint - 确保所有测试通过
  - 运行 `npx vitest --run` 确保所有测试通过
  - 手动验证 OrderAdmin 登录流程、订单页访问、设置页显示

## Notes

- 订单 admin API 由 `orders/handler.ts` 处理，非订单 admin API 由 `admin/handler.ts` 处理，两个 handler 独立部署
- OrderAdmin 在 `admin/handler.ts` 中一律被拒绝（403），因为该 handler 不处理订单路由
- 现有 settings/index.tsx 的 `isAdmin` 检查（`Admin || SuperAdmin`）自然排除 OrderAdmin，无需修改
- EXCLUSIVE_ROLES 常量设计为数组，便于未来扩展其他独占角色
- 属性测试使用 fast-check 库，每个属性至少 100 次迭代
