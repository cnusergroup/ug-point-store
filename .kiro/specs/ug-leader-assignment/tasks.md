# 实现计划：UG 负责人分配（UG Leader Assignment）

## 概述

为社区积分商城系统的 UG 管理新增负责人分配能力。涉及：扩展 UGRecord 共享类型（新增 leaderId、leaderNickname 可选字段）、在 ug.ts 中新增 assignLeader/removeLeader/getMyUGs 三个函数、在 handler.ts 中新增 3 条路由（PUT/DELETE /api/admin/ugs/{ugId}/leader、GET /api/admin/ugs/my-ugs）、CDK 路由注册（复用现有 admin proxy）、Settings 页面 UG 管理区域扩展（负责人显示 + Leader Selector Modal）、Batch Points 页面活动筛选（Admin 仅看负责 UG 活动）、5 种语言 i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与后端核心逻辑
  - [x] 1.1 扩展 UGRecord 类型定义
    - 在 `packages/shared/src/types.ts` 的 `UGRecord` 接口中新增可选字段：
      - `leaderId?: string`（负责人用户 ID）
      - `leaderNickname?: string`（负责人昵称快照）
    - 确保与现有字段（ugId、name、status、createdAt、updatedAt）向后兼容
    - _需求: 1.1, 1.2, 1.3_

  - [x] 1.2 实现 assignLeader 函数
    - 在 `packages/backend/src/admin/ug.ts` 中新增：
      - `AssignLeaderInput` 接口：`{ ugId: string; leaderId: string }`
      - `AssignLeaderResult` 接口：`{ success: boolean; error?: { code: string; message: string } }`
      - `assignLeader(input, dynamoClient, ugsTable, usersTable)` 函数：
        1. GetCommand 检查 UG 存在，不存在返回 `UG_NOT_FOUND`
        2. GetCommand 检查 leaderId 对应用户存在，不存在返回 `USER_NOT_FOUND`
        3. 验证用户 roles 包含 `'Admin'`，否则返回 `INVALID_LEADER_ROLE`
        4. UpdateCommand 更新 UG 记录的 leaderId、leaderNickname（从用户记录读取 nickname）、updatedAt
        5. 已有负责人时直接覆盖（更换），无需先移除
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

  - [x] 1.3 实现 removeLeader 函数
    - 在 `packages/backend/src/admin/ug.ts` 中新增：
      - `removeLeader(ugId, dynamoClient, ugsTable)` 函数：
        1. GetCommand 检查 UG 存在，不存在返回 `UG_NOT_FOUND`
        2. UpdateCommand 使用 REMOVE 表达式清空 leaderId、leaderNickname，更新 updatedAt
        3. 幂等：UG 未分配负责人时仍返回成功
    - _需求: 3.1, 3.2, 3.3_

  - [x] 1.4 实现 getMyUGs 函数
    - 在 `packages/backend/src/admin/ug.ts` 中新增：
      - `getMyUGs(userId, dynamoClient, ugsTable)` 函数：
        1. ScanCommand 扫描 UGs 表，FilterExpression: `leaderId = :userId AND #status = :active`
        2. 返回匹配的 UG 记录列表（仅 active 状态）
        3. 无匹配时返回空数组
    - _需求: 8.1, 8.2, 8.3_

- [x] 2. 后端单元测试与属性测试
  - [x] 2.1 编写 assignLeader / removeLeader / getMyUGs 单元测试
    - 在 `packages/backend/src/admin/ug.test.ts` 中新增测试场景：
      - assignLeader：成功分配、用户不存在（USER_NOT_FOUND）、用户无 Admin 角色（INVALID_LEADER_ROLE）、UG 不存在（UG_NOT_FOUND）、同一 Admin 分配多个 UG、覆盖已有负责人（更换）
      - removeLeader：成功移除、UG 不存在（UG_NOT_FOUND）、UG 无负责人时幂等成功
      - getMyUGs：返回正确 UG 列表、仅返回 active 状态、无匹配返回空列表
    - _需求: 2.1~2.7, 3.1~3.4, 8.1~8.3_

  - [x] 2.2 编写 assignLeader 属性测试
    - **Property 1: Leader assignment validates role and updates fields correctly**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中新增
    - 使用 fast-check 生成随机 UG 和用户数据，验证：
      - UG 存在 + 用户存在 + 用户有 Admin 角色 → 成功，leaderId/leaderNickname/updatedAt 正确
      - UG 不存在 → UG_NOT_FOUND
      - 用户不存在 → USER_NOT_FOUND
      - 用户无 Admin 角色 → INVALID_LEADER_ROLE
      - 同一 Admin 可分配多个 UG
    - **验证: 需求 2.1, 2.2, 2.3, 2.4, 2.5, 2.7**

  - [x] 2.3 编写 removeLeader 属性测试
    - **Property 2: Leader removal is idempotent and clears fields**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中新增
    - 使用 fast-check 生成随机 UG 数据，验证：
      - 移除后 UG 记录不含 leaderId/leaderNickname
      - updatedAt 已更新
      - 连续两次移除结果一致（幂等）
    - **验证: 需求 3.1, 3.2, 3.3**

  - [x] 2.4 编写 getMyUGs 属性测试
    - **Property 3: getMyUGs returns exactly the active UGs where leaderId matches**
    - 在 `packages/backend/src/admin/ug.property.test.ts` 中新增
    - 使用 fast-check 生成随机 UG 集合（混合 leaderId 和 status），验证：
      - 返回结果恰好是 leaderId 匹配且 status=active 的 UG
      - 不遗漏、不多余
    - **验证: 需求 6.1, 6.2, 8.1, 8.2, 8.3**

- [x] 3. 后端路由注册
  - [x] 3.1 在 Admin Handler 中添加负责人相关路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 导入 `assignLeader`、`removeLeader`、`getMyUGs` 函数
      - 新增路由正则：`UGS_LEADER_REGEX = /^\/api\/admin\/ugs\/([^/]+)\/leader$/`
      - PUT `/api/admin/ugs/{ugId}/leader` → `handleAssignLeader`（SuperAdmin 权限）
        - 解析 body 中的 leaderId，缺失返回 INVALID_REQUEST
        - 调用 assignLeader，返回结果
      - DELETE `/api/admin/ugs/{ugId}/leader` → `handleRemoveLeader`（SuperAdmin 权限）
        - 调用 removeLeader，返回结果
      - GET `/api/admin/ugs/my-ugs` → `handleGetMyUGs`（Admin/SuperAdmin 权限）
        - 精确路径匹配，需在 UGS_DELETE_REGEX 之前判断以避免误匹配
        - 调用 getMyUGs(event.user.userId)，返回 UG 列表
    - _需求: 7.1, 7.2, 7.3, 2.6, 3.4, 8.4_

  - [x] 3.2 编写 Admin Handler 路由单元测试
    - 更新 `packages/backend/src/admin/handler.test.ts`：
      - 测试 PUT /api/admin/ugs/{ugId}/leader 路由分发和 SuperAdmin 权限校验
      - 测试 DELETE /api/admin/ugs/{ugId}/leader 路由分发和 SuperAdmin 权限校验
      - 测试 GET /api/admin/ugs/my-ugs 路由分发和 Admin/SuperAdmin 权限校验
      - 测试非管理员被拒绝（FORBIDDEN）
    - _需求: 7.1, 7.2, 7.3_

- [x] 4. 检查点 - 后端验证
  - 运行所有后端相关测试（ug.test.ts、ug.property.test.ts、handler.test.ts），确保逻辑正确。如有问题请向用户确认。

- [x] 5. 前端 Settings 页面扩展 — 负责人管理
  - [x] 5.1 扩展 UG 管理列表显示负责人信息
    - 修改 `packages/frontend/src/pages/admin/settings.tsx`：
      - 扩展 UG 列表的类型定义，新增 `leaderId?: string` 和 `leaderNickname?: string` 字段
      - 在每条 UG 行中显示负责人昵称（leaderNickname），未分配时显示 i18n 占位文本"未分配"
      - 在每条 UG 行中添加"分配负责人"按钮（未分配时）或"更换负责人"按钮（已分配时）
    - _需求: 4.1, 4.2, 4.3, 4.4_

  - [x] 5.2 实现 Leader Selector Modal 组件
    - 在 `packages/frontend/src/pages/admin/settings.tsx` 中新增内嵌模态弹窗组件：
      - 状态管理：`leaderModalUgId`（当前操作的 UG ID）、`adminUsersList`（Admin 用户列表）、`leaderSearch`（搜索关键词）、`leaderAssigning`（分配中状态）
      - 打开弹窗时调用 `GET /api/admin/users?role=Admin` 获取 Admin 用户列表
      - 显示每个 Admin 用户的昵称和邮箱
      - 提供搜索框，支持按昵称或邮箱模糊搜索（客户端过滤，不区分大小写）
      - 点击用户后调用 `PUT /api/admin/ugs/{ugId}/leader` `{ leaderId }` 分配
      - 分配成功后关闭弹窗、刷新 UG 列表、显示成功 Toast
      - 分配失败时显示具体错误信息 Toast
      - 已有负责人时显示"移除负责人"按钮，点击后调用 `DELETE /api/admin/ugs/{ugId}/leader`
      - 移除成功后关闭弹窗、刷新 UG 列表、显示成功 Toast
    - 遵循前端设计规范：CSS 变量、全局组件类、现有 Modal 样式模式
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 5.3 添加 Leader Selector Modal 样式
    - 在 `packages/frontend/src/pages/admin/settings.scss` 中新增负责人选择弹窗相关样式：
      - 负责人显示区域样式（昵称 + "未分配"占位）
      - 分配/更换按钮样式
      - Modal 搜索框、用户列表、用户行样式
      - 移除负责人按钮样式
    - 使用 CSS 变量（--bg-surface、--text-primary、--accent-primary 等）
    - _需求: 5.1~5.8_

- [x] 6. 前端 Batch Points 页面扩展 — 活动筛选
  - [x] 6.1 修改活动筛选逻辑区分 Admin 和 SuperAdmin
    - 修改 `packages/frontend/src/pages/admin/batch-points.tsx`：
      - 从 store 获取当前用户角色，判断是否为 SuperAdmin
      - **SuperAdmin 用户**：保持现有逻辑，调用 `GET /api/admin/ugs?status=active` 获取所有 active UG 名称
      - **Admin 用户（非 SuperAdmin）**：调用 `GET /api/admin/ugs/my-ugs` 获取负责 UG 列表，提取 UG 名称作为 `activeUGNames`
      - 替换现有 `fetchActiveUGs` 函数逻辑，根据角色调用不同接口
      - Admin 用户无负责 UG 时：显示空状态提示（i18n 文案"您尚未被分配为任何 UG 的负责人，无法选择活动"）
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.2 编写 Admin 用户搜索过滤属性测试
    - **Property 4: Admin user search filter matches on nickname or email**
    - 创建 `packages/backend/src/admin/leader-filter.property.test.ts`
    - 提取 Leader Selector Modal 中的搜索过滤逻辑为纯函数
    - 使用 fast-check 生成随机 Admin 用户列表和搜索关键词，验证：
      - 返回结果恰好是 nickname 或 email 包含搜索词（不区分大小写）的用户
      - 搜索词为空或纯空白时返回全部用户
    - **验证: 需求 5.4**

- [x] 7. 检查点 - 前端页面验证
  - 确保 Settings 页面扩展和 Batch Points 页面修改编译通过，功能正确。如有问题请向用户确认。

- [x] 8. i18n 多语言翻译
  - [x] 8.1 扩展 TranslationDict 类型定义
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 接口中新增翻译键：
      - `ugManagement` 模块新增：负责人列显示文案（"负责人"、"未分配"）、分配/更换/移除按钮文案、操作成功/失败提示
      - `leaderSelector` 模块（新增）：Modal 标题、搜索框占位符、移除负责人按钮、确认提示、空列表提示
      - `batchPoints` 模块新增：Admin 无负责 UG 时的空状态提示
    - _需求: 9.1, 9.4_

  - [x] 8.2 添加 5 种语言翻译
    - 在 `packages/frontend/src/i18n/zh.ts` 中添加简体中文翻译
    - 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加繁体中文翻译
    - 在 `packages/frontend/src/i18n/en.ts` 中添加英文翻译
    - 在 `packages/frontend/src/i18n/ja.ts` 中添加日文翻译
    - 在 `packages/frontend/src/i18n/ko.ts` 中添加韩文翻译
    - TypeScript 类型检查确保所有语言键集完整
    - _需求: 9.2_

  - [x] 8.3 在前端页面中使用 i18n
    - 在 Settings 页面 UG 管理区域和 Leader Selector Modal 中使用 `t()` 翻译函数
    - 在 Batch Points 页面 Admin 空状态提示中使用 `t()` 翻译函数
    - 确保不硬编码任何用户可见字符串
    - _需求: 9.3_

- [x] 9. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确，i18n 翻译完整。如有问题请向用户确认。

## 备注

- 复用现有 UGs DynamoDB 表，仅新增 leaderId 和 leaderNickname 可选字段，无需新建表或 GSI
- getMyUGs 使用 ScanCommand + FilterExpression，因 UG 数量有限（< 100）性能可接受
- leaderNickname 为分配时的快照值，用户后续修改昵称不会自动更新（可接受的 trade-off）
- assignLeader 支持直接覆盖已有负责人（更换），无需先调用 removeLeader
- removeLeader 为幂等操作，UG 无负责人时仍返回成功
- CDK 路由无需额外注册，新增的 3 条路由由现有 admin proxy（`{proxy+}`）自动捕获
- 属性测试验证设计文档中定义的 4 个正确性属性
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP
