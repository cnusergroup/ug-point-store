# 需求文档：功能开关设置（Feature Toggle Settings）

## 简介

在 SuperAdmin 管理面板中新增功能开关设置，允许 SuperAdmin 控制"兑换积分码"（Code Redemption）和"积分申请"（Points Claim）两个功能的启用/禁用状态。两个功能默认均为关闭状态。前端页面（个人中心快捷入口、兑换积分码页面、积分申请页面）根据功能开关设置动态调整显示内容，后端 API 在功能关闭时拒绝相关请求。

## 术语表

- **Feature_Toggle（功能开关）**：控制特定功能启用或禁用的系统级配置项
- **Settings_Record（设置记录）**：存储在 DynamoDB 中的功能开关配置数据，使用固定 key 标识
- **Settings_Service（设置服务）**：处理功能开关读取和更新的后端服务模块
- **Settings_API（设置接口）**：提供功能开关查询和更新的 HTTP API 端点
- **Settings_Page（设置页面）**：SuperAdmin 管理面板中用于配置功能开关的前端页面
- **Profile_Page（个人中心页面）**：用户个人中心页面，包含快捷操作入口
- **Redeem_Page（兑换积分码页面）**：用户输入积分码兑换积分的前端页面
- **Claims_Page（积分申请页面）**：用户提交积分申请的前端页面
- **Points_Handler（积分处理器）**：处理积分相关 API 请求的后端 Lambda 函数
- **Admin_Handler（管理处理器）**：处理管理端 API 请求的后端 Lambda 函数

## 需求

### 需求 1：功能开关数据存储

**用户故事：** 作为系统，我希望持久化存储功能开关配置，以便系统重启后设置不会丢失。

#### 验收标准

1. THE Settings_Service SHALL 使用 DynamoDB 存储功能开关配置，使用固定分区键 `settingKey` 值为 `"feature-toggles"` 的单条记录
2. THE Settings_Record SHALL 包含以下字段：settingKey（分区键）、codeRedemptionEnabled（布尔值）、pointsClaimEnabled（布尔值）、updatedAt（ISO 8601 时间戳）、updatedBy（操作人 userId）
3. WHEN Settings_Record 不存在时, THE Settings_Service SHALL 将 codeRedemptionEnabled 和 pointsClaimEnabled 视为 false（默认关闭）
4. THE Settings_Service SHALL 将 Settings_Record 存储在现有的 Users 表中，复用已有表资源，避免新建 DynamoDB 表

### 需求 2：查询功能开关设置（公开接口）

**用户故事：** 作为前端应用，我希望获取当前功能开关状态，以便根据设置动态调整页面显示。

#### 验收标准

1. WHEN 任意客户端请求 GET /api/settings/feature-toggles, THE Settings_API SHALL 返回当前功能开关状态，包含 codeRedemptionEnabled 和 pointsClaimEnabled 字段
2. WHEN Settings_Record 不存在时, THE Settings_API SHALL 返回 `{ codeRedemptionEnabled: false, pointsClaimEnabled: false }`
3. THE Settings_API SHALL 不要求身份认证即可访问，以便前端在用户登录前也能获取功能开关状态
4. THE Settings_API SHALL 在 200ms 内返回响应

### 需求 3：更新功能开关设置（SuperAdmin 专属）

**用户故事：** 作为 SuperAdmin，我希望能够开启或关闭特定功能，以便灵活控制系统功能的可用性。

#### 验收标准

1. WHEN SuperAdmin 请求 PUT /api/admin/settings/feature-toggles, THE Admin_Handler SHALL 验证请求者拥有 SuperAdmin 角色
2. IF 请求者不拥有 SuperAdmin 角色, THEN THE Admin_Handler SHALL 返回 403 错误码 FORBIDDEN 和消息"需要超级管理员权限"
3. WHEN SuperAdmin 提交更新请求, THE Admin_Handler SHALL 要求请求体包含 codeRedemptionEnabled（布尔值）和 pointsClaimEnabled（布尔值）字段
4. IF 请求体缺少必填字段或字段类型不是布尔值, THEN THE Admin_Handler SHALL 返回 400 错误码 INVALID_REQUEST 和消息"请求参数无效"
5. WHEN 更新成功, THE Admin_Handler SHALL 使用 PutCommand 写入 Settings_Record，记录 updatedAt 和 updatedBy，并返回更新后的设置
6. THE Admin_Handler SHALL 确保更新操作的幂等性，多次提交相同设置值不产生副作用

### 需求 4：后端功能开关拦截

**用户故事：** 作为系统，我希望在功能关闭时拒绝相关 API 请求，以便确保功能开关的有效性。

#### 验收标准

1. WHEN codeRedemptionEnabled 为 false 且用户请求 POST /api/points/redeem-code, THE Points_Handler SHALL 返回 403 错误码 FEATURE_DISABLED 和消息"该功能当前未开放"
2. WHEN pointsClaimEnabled 为 false 且用户请求 POST /api/claims, THE Points_Handler SHALL 返回 403 错误码 FEATURE_DISABLED 和消息"该功能当前未开放"
3. WHEN 功能开关为 true 时, THE Points_Handler SHALL 正常处理对应的 API 请求，不受功能开关影响
4. THE Settings_Service SHALL 提供 `getFeatureToggles(dynamoClient, tableName)` 函数供 Handler 调用，每次请求实时读取最新设置

### 需求 5：前端个人中心动态显示

**用户故事：** 作为用户，我希望个人中心只显示当前可用的功能入口，以便避免点击进入不可用的功能页面。

#### 验收标准

1. WHEN Profile_Page 加载时, THE Profile_Page SHALL 调用 GET /api/settings/feature-toggles 获取功能开关状态
2. WHEN codeRedemptionEnabled 为 false, THE Profile_Page SHALL 隐藏快捷操作中的"兑换积分码"入口（key 为 'redeem'）
3. WHEN pointsClaimEnabled 为 false, THE Profile_Page SHALL 隐藏快捷操作中的"积分申请"入口（key 为 'claims'）
4. WHEN 功能开关为 true 时, THE Profile_Page SHALL 正常显示对应的快捷操作入口
5. WHILE 功能开关状态加载中, THE Profile_Page SHALL 显示所有快捷操作入口（避免闪烁），加载完成后再根据结果隐藏

### 需求 6：前端兑换积分码页面拦截

**用户故事：** 作为用户，我希望在功能关闭时访问兑换积分码页面能看到明确提示，以便了解功能当前不可用。

#### 验收标准

1. WHEN Redeem_Page 以 points-code 模式加载时, THE Redeem_Page SHALL 调用 GET /api/settings/feature-toggles 检查 codeRedemptionEnabled 状态
2. WHEN codeRedemptionEnabled 为 false, THE Redeem_Page SHALL 显示功能未开放提示信息，并提供返回按钮
3. WHEN codeRedemptionEnabled 为 false, THE Redeem_Page SHALL 隐藏积分码输入表单和提交按钮
4. WHEN codeRedemptionEnabled 为 true, THE Redeem_Page SHALL 正常显示积分码兑换界面

### 需求 7：前端积分申请页面拦截

**用户故事：** 作为用户，我希望在功能关闭时访问积分申请页面能看到明确提示，以便了解功能当前不可用。

#### 验收标准

1. WHEN Claims_Page 加载时, THE Claims_Page SHALL 调用 GET /api/settings/feature-toggles 检查 pointsClaimEnabled 状态
2. WHEN pointsClaimEnabled 为 false, THE Claims_Page SHALL 显示功能未开放提示信息，并提供返回按钮
3. WHEN pointsClaimEnabled 为 false, THE Claims_Page SHALL 隐藏新建申请按钮和申请表单
4. WHEN pointsClaimEnabled 为 true, THE Claims_Page SHALL 正常显示积分申请界面（包含历史记录列表和新建申请功能）

### 需求 8：SuperAdmin 设置管理页面

**用户故事：** 作为 SuperAdmin，我希望有一个直观的设置页面来管理功能开关，以便方便地控制功能的启用和禁用。

#### 验收标准

1. THE Settings_Page SHALL 在管理后台首页（Admin Dashboard）中添加"功能设置"入口卡片，仅对 SuperAdmin 角色可见
2. THE Settings_Page SHALL 展示两个功能开关项，每项包含功能名称、功能描述和开关切换控件
3. WHEN Settings_Page 加载时, THE Settings_Page SHALL 调用 GET /api/settings/feature-toggles 获取当前设置并回显到开关控件
4. WHEN SuperAdmin 切换开关状态, THE Settings_Page SHALL 调用 PUT /api/admin/settings/feature-toggles 提交更新
5. WHEN 更新成功, THE Settings_Page SHALL 显示操作成功提示
6. IF 更新失败, THEN THE Settings_Page SHALL 显示错误信息并将开关恢复到更新前的状态

### 需求 9：CDK 路由与权限配置

**用户故事：** 作为开发者，我希望在 API Gateway 中注册功能开关相关的路由，以便前端能够调用对应的后端接口。

#### 验收标准

1. THE CDK_Stack SHALL 在 API Gateway 中注册公开路由 GET /api/settings/feature-toggles，集成到 Points Lambda，不要求身份认证
2. THE CDK_Stack SHALL 在 API Gateway 中注册管理端路由 PUT /api/admin/settings/feature-toggles，集成到 Admin Lambda
3. THE CDK_Stack SHALL 确保 Points Lambda 和 Admin Lambda 均拥有 Users 表的读写权限（已有权限则无需额外配置）
4. THE CDK_Stack SHALL 确保所有新增路由支持 CORS 预检请求

### 需求 10：国际化支持

**用户故事：** 作为用户，我希望功能开关相关的提示信息支持多语言，以便不同语言的用户都能理解。

#### 验收标准

1. THE Frontend SHALL 为功能开关相关的所有用户可见文本添加 i18n 翻译键
2. THE Frontend SHALL 在 zh、en、ja、ko、zh-TW 五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 `useTranslation` hook 获取翻译文本，不硬编码任何用户可见字符串
