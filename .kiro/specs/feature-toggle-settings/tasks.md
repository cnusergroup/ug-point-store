# 实现计划：功能开关设置（Feature Toggle Settings）

## 概述

为 SuperAdmin 提供功能开关管理能力，控制"兑换积分码"和"积分申请"两个功能的启用/禁用。涉及后端功能开关读写模块、Points Handler 和 Admin Handler 路由扩展与拦截、前端设置页面、Profile/Redeem/Claims 页面动态显示、CDK 路由配置、i18n 翻译。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增功能开关相关错误码
    - 在 `packages/shared/src/types.ts` 中（或对应的错误码定义文件）新增：
      - `FEATURE_DISABLED`（403）：该功能当前未开放
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 4.1, 4.2_

- [x] 2. 后端功能开关模块
  - [x] 2.1 实现 getFeatureToggles 和 updateFeatureToggles
    - 创建 `packages/backend/src/settings/feature-toggles.ts`
    - 实现 `getFeatureToggles(dynamoClient, usersTable)` 函数：
      - 使用 GetCommand 读取 `{ userId: 'feature-toggles' }` 记录
      - 记录不存在时返回 `{ codeRedemptionEnabled: false, pointsClaimEnabled: false }`
      - 记录存在时返回对应布尔值
    - 实现 `updateFeatureToggles(input, dynamoClient, usersTable)` 函数：
      - 校验 codeRedemptionEnabled 和 pointsClaimEnabled 为布尔值
      - 使用 PutCommand 写入完整记录（userId: 'feature-toggles', codeRedemptionEnabled, pointsClaimEnabled, updatedAt, updatedBy）
      - 返回更新后的设置
    - _需求: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.3, 3.5, 3.6, 4.4_

  - [x] 2.2 编写 getFeatureToggles 和 updateFeatureToggles 单元测试
    - 创建 `packages/backend/src/settings/feature-toggles.test.ts`
    - 测试：记录存在时返回正确值、记录不存在时返回默认值 false、有效输入写入成功、无效输入被拒绝、更新后返回正确设置
    - _需求: 1.1~1.4, 2.1, 2.2, 3.3~3.6_

  - [x] 2.3 编写默认值正确性属性测试
    - **Property 1: 默认值正确性**
    - 创建 `packages/backend/src/settings/feature-toggles.property.test.ts`
    - 使用 fast-check 验证记录不存在时始终返回 false
    - **验证: 需求 1.3, 2.2**

  - [x] 2.4 编写更新输入校验正确性属性测试
    - **Property 3: 更新输入校验正确性**
    - 在 `packages/backend/src/settings/feature-toggles.property.test.ts` 中添加
    - 使用 fast-check 生成随机非布尔值输入，验证更新被拒绝
    - **验证: 需求 3.3, 3.4**

  - [x] 2.5 编写更新幂等性属性测试
    - **Property 4: 更新幂等性**
    - 在 `packages/backend/src/settings/feature-toggles.property.test.ts` 中添加
    - 使用 fast-check 生成随机布尔值组合，验证连续两次相同更新结果一致
    - **验证: 需求 3.6**

  - [x] 2.6 编写读写一致性属性测试
    - **Property 6: 读写一致性（Round-trip）**
    - 在 `packages/backend/src/settings/feature-toggles.property.test.ts` 中添加
    - 使用 fast-check 生成随机布尔值组合，验证写入后读取结果一致
    - **验证: 需求 1.1, 1.2, 2.1**

- [x] 3. 检查点 - 功能开关模块验证
  - 运行 `packages/backend/src/settings/feature-toggles.test.ts` 和属性测试，确保 getFeatureToggles 和 updateFeatureToggles 逻辑正确。如有问题请向用户确认。

- [x] 4. Handler 路由扩展与功能开关拦截
  - [x] 4.1 在 Points Handler 中添加公开查询路由和功能开关拦截
    - 在 `packages/backend/src/points/handler.ts` 中：
      - 在 `handler` 函数中（认证之前），添加 `GET /api/settings/feature-toggles` 公开路由，调用 `getFeatureToggles` 返回结果
      - 在 `authenticatedHandler` 中，对 `POST /api/points/redeem-code` 路由添加拦截：先调用 `getFeatureToggles`，如果 `codeRedemptionEnabled === false`，返回 403 FEATURE_DISABLED
      - 在 `authenticatedHandler` 中，对 `POST /api/claims` 路由添加拦截：先调用 `getFeatureToggles`，如果 `pointsClaimEnabled === false`，返回 403 FEATURE_DISABLED
    - 导入 `getFeatureToggles` 从 `../settings/feature-toggles`
    - _需求: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 在 Admin Handler 中添加功能开关更新路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 添加 `PUT /api/admin/settings/feature-toggles` 路由
      - 在路由处理函数中，使用 `isSuperAdmin(event.user.roles)` 校验 SuperAdmin 权限，非 SuperAdmin 返回 403
      - 解析请求体，调用 `updateFeatureToggles`
    - 导入 `updateFeatureToggles` 从 `../settings/feature-toggles`
    - 导入 `isSuperAdmin` 从 `@points-mall/shared`（已有导入）
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.3 编写 Handler 路由单元测试
    - 更新 `packages/backend/src/points/handler.test.ts`：
      - 添加 GET /api/settings/feature-toggles 路由测试（无需认证）
      - 添加 POST /api/points/redeem-code 功能开关拦截测试（开关关闭时返回 403）
      - 添加 POST /api/claims 功能开关拦截测试（开关关闭时返回 403）
    - 更新 `packages/backend/src/admin/handler.test.ts`：
      - 添加 PUT /api/admin/settings/feature-toggles 路由测试（SuperAdmin 权限校验、有效/无效请求体）
    - _需求: 2.1~2.3, 3.1~3.5, 4.1~4.3_

  - [x] 4.4 编写功能开关拦截正确性属性测试
    - **Property 5: 功能开关拦截正确性**
    - 在 `packages/backend/src/settings/feature-toggles.property.test.ts` 中添加
    - 使用 fast-check 生成随机开关状态组合，验证拦截行为正确
    - **验证: 需求 4.1, 4.2, 4.3**

  - [x] 4.5 编写更新权限校验正确性属性测试
    - **Property 2: 更新权限校验正确性**
    - 在 `packages/backend/src/settings/feature-toggles.property.test.ts` 中添加
    - 使用 fast-check 生成随机角色集合，验证非 SuperAdmin 被拒绝
    - **验证: 需求 3.1, 3.2**

- [x] 5. 检查点 - Handler 路由验证
  - 运行 Points Handler 和 Admin Handler 相关测试，确保新增路由和拦截逻辑正确。如有问题请向用户确认。

- [x] 6. CDK 路由配置
  - [x] 6.1 在 ApiStack 中注册新路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 注册公开路由 `GET /api/settings/feature-toggles`，集成到 Points Lambda，不要求身份认证
      - 注册管理端路由 `PUT /api/admin/settings/feature-toggles`，集成到 Admin Lambda
      - 确保所有新增路由支持 CORS 预检请求
    - Points Lambda 和 Admin Lambda 已有 Users 表读写权限，无需额外配置
    - _需求: 9.1, 9.2, 9.3, 9.4_

- [x] 7. 检查点 - CDK 编译验证
  - 确保 CDK 代码编译通过，新增路由定义正确。如有问题请向用户确认。

- [x] 8. 前端 i18n 翻译
  - [x] 8.1 更新翻译类型定义和语言文件
    - 在 `packages/frontend/src/i18n/types.ts` 中新增：
      - `featureToggle` 命名空间：featureDisabled、featureDisabledDesc、backButton
      - `admin.dashboard` 中新增：settingsTitle、settingsDesc
      - `admin.settings` 命名空间：title、backButton、codeRedemptionLabel、codeRedemptionDesc、pointsClaimLabel、pointsClaimDesc、loading、updateSuccess、updateFailed
    - 在 zh、en、ja、ko、zh-TW 五种语言文件中添加对应翻译
    - _需求: 10.1, 10.2, 10.3_

- [x] 9. 前端 SuperAdmin 设置页面
  - [x] 9.1 创建设置管理页面
    - 创建 `packages/frontend/src/pages/admin/settings.tsx` 和 `packages/frontend/src/pages/admin/settings.scss`
    - 页面结构：
      - 顶部工具栏：返回按钮 + 标题"功能设置"
      - 功能开关列表：每项包含功能名称、功能描述、开关切换控件（toggle switch）
      - 加载状态：loading 提示
      - 操作反馈：成功/失败 toast 提示
    - 页面加载时调用 GET /api/settings/feature-toggles 获取当前设置
    - 切换开关时调用 PUT /api/admin/settings/feature-toggles 提交更新
    - 更新失败时恢复开关到更新前状态
    - 遵循前端设计规范：CSS 变量、全局组件类
    - _需求: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 9.2 在管理后台入口和 Taro 路由中注册设置页面
    - 在 `packages/frontend/src/app.config.ts` 中添加 `pages/admin/settings` 路由
    - 在管理后台首页 `packages/frontend/src/pages/admin/index.tsx` 的 ADMIN_LINKS 中添加"功能设置"入口卡片
    - 该入口仅对 SuperAdmin 角色可见（在渲染时检查 `user.roles.includes('SuperAdmin')`）
    - _需求: 8.1_

- [x] 10. 前端 Profile 页面动态显示
  - [x] 10.1 修改 Profile 页面根据功能开关隐藏快捷入口
    - 在 `packages/frontend/src/pages/profile/index.tsx` 中：
      - 页面加载时调用 GET /api/settings/feature-toggles 获取功能开关状态
      - 根据 codeRedemptionEnabled 控制 key='redeem' 快捷入口的显示/隐藏
      - 根据 pointsClaimEnabled 控制 key='claims' 快捷入口的显示/隐藏
      - 加载中时显示所有入口（避免闪烁），加载完成后再根据结果过滤
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 11. 前端 Redeem 页面功能开关拦截
  - [x] 11.1 修改 Redeem 页面在功能关闭时显示提示
    - 在 `packages/frontend/src/pages/redeem/index.tsx` 中：
      - 仅在 `mode === 'points-code'` 时检查功能开关
      - 页面加载时调用 GET /api/settings/feature-toggles
      - codeRedemptionEnabled 为 false 时显示功能未开放提示信息和返回按钮，隐藏积分码输入表单
      - codeRedemptionEnabled 为 true 时正常显示
    - _需求: 6.1, 6.2, 6.3, 6.4_

- [x] 12. 前端 Claims 页面功能开关拦截
  - [x] 12.1 修改 Claims 页面在功能关闭时显示提示
    - 在 `packages/frontend/src/pages/claims/index.tsx` 中：
      - 页面加载时调用 GET /api/settings/feature-toggles
      - pointsClaimEnabled 为 false 时显示功能未开放提示信息和返回按钮，隐藏新建申请按钮
      - pointsClaimEnabled 为 true 时正常显示
    - _需求: 7.1, 7.2, 7.3, 7.4_

- [x] 13. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 功能开关记录存储在现有 Users 表中，使用固定 PK `feature-toggles`，不影响现有用户数据
- 公开查询接口无需认证，前端可在登录前获取设置
- 后端双重拦截（API 层拒绝 + 前端隐藏），确保功能关闭时无法绕过
- 默认关闭策略：记录不存在或读取失败时，功能默认关闭（安全优先）
- 前端降级策略：功能开关 API 调用失败时，默认显示所有入口（避免误隐藏可用功能）
- 标记 `*` 的子任务为可选属性测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
