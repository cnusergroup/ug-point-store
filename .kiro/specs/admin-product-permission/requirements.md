# 需求文档：商品管理权限精细化控制（Admin Product Permission）

## 简介

当前 Admin Settings 页面的 "Admin Permissions" 分类下，"Admin Products" 开关（`adminProductsEnabled`）是一个简单的布尔开关，打开后所有 Admin 均可管理商品（创建、编辑、上下架、图片管理）。本功能在该开关打开时，增加一层精细化控制：SuperAdmin 可以选择"所有 Admin"或"指定 Admin"拥有商品管理权限。选择"指定 Admin"时，展示一个可搜索的 Admin 用户勾选列表，仅被勾选的 Admin 才能管理商品。SuperAdmin 始终拥有商品管理权限，不受此设置影响。

本功能参照已有的"内容审核权限"（`contentReviewMode` / `contentReviewerIds`）模式实现。

## 术语表

- **Feature_Toggles_System**：功能开关系统，存储在 DynamoDB Users 表中（`userId='feature-toggles'`），通过 `packages/backend/src/settings/feature-toggles.ts` 管理
- **Settings_Page**：管理员设置页面（`packages/frontend/src/pages/admin/settings.tsx`），用于管理功能开关
- **Product_Permission_Checker**：商品管理权限检查逻辑，位于 Admin Handler 中各商品相关路由的权限判断处
- **Admin_User**：拥有 `Admin` 角色的用户
- **SuperAdmin**：拥有 `SuperAdmin` 角色的用户，始终拥有所有权限
- **Product_Management_Mode**：商品管理模式，取值为 `'all'`（所有 Admin）或 `'specific'`（指定 Admin）
- **Product_Manager_Ids**：指定商品管理人的 userId 列表，仅在 Product_Management_Mode 为 `'specific'` 时生效
- **Admin_Checklist**：可搜索的 Admin 用户勾选列表 UI 组件，展示 Admin 用户的昵称、邮箱和角色徽章
- **Feature_Toggles_API**：功能开关的读取接口（`GET /api/settings/feature-toggles`）和更新接口（`PUT /api/admin/settings/feature-toggles`）

## 需求

### 需求 1：FeatureToggles 数据模型扩展

**用户故事：** 作为系统，我希望 FeatureToggles 数据模型支持商品管理模式和指定管理人列表，以便实现精细化的商品管理权限控制。

#### 验收标准

1. THE Feature_Toggles_System SHALL 包含一个字段 `productManagementMode`，类型为 `'all' | 'specific'`，默认值为 `'all'`
2. THE Feature_Toggles_System SHALL 包含一个字段 `productManagerIds`，类型为 `string[]`（userId 列表），默认值为空数组 `[]`
3. THE `productManagementMode` 和 `productManagerIds` 字段 SHALL 与现有的 `adminProductsEnabled` 布尔开关共存，不影响现有功能
4. WHILE `adminProductsEnabled` 为 `false` 时，THE Feature_Toggles_System SHALL 忽略 `productManagementMode` 和 `productManagerIds` 的值（开关关闭时，所有 Admin 均无商品管理权限）

### 需求 2：数据向后兼容

**用户故事：** 作为系统，我希望新增字段与现有数据完全兼容，不影响已有功能开关记录的正常运行。

#### 验收标准

1. WHEN DynamoDB 中不存在 `productManagementMode` 字段时（旧数据兼容），THE Feature_Toggles_System SHALL 将其默认视为 `'all'`
2. WHEN DynamoDB 中不存在 `productManagerIds` 字段时（旧数据兼容），THE Feature_Toggles_System SHALL 将其默认视为空数组 `[]`
3. WHEN `productManagementMode` 的值不是 `'all'` 或 `'specific'` 时，THE Feature_Toggles_System SHALL 将其安全降级为 `'all'`
4. WHEN `productManagerIds` 的值不是字符串数组时，THE Feature_Toggles_System SHALL 将其安全降级为空数组 `[]`
5. FOR ALL 现有的 feature-toggles 记录（不含新字段），读取后再写入 SHALL 产生等价的对象（round-trip 属性）

### 需求 3：后端商品管理权限检查更新

**用户故事：** 作为系统，我希望 Admin Handler 中的商品管理路由支持三层权限判断，以便在 `specific` 模式下仅允许指定 Admin 管理商品。

#### 验收标准

1. THE Product_Permission_Checker SHALL 保持现有的第一层判断：SuperAdmin 始终拥有商品管理权限（跳过后续检查）
2. THE Product_Permission_Checker SHALL 保持现有的第二层判断：WHEN `adminProductsEnabled` 为 `false` 时，返回 403 错误
3. WHEN `adminProductsEnabled` 为 `true` 且 `productManagementMode` 为 `'all'` 时，THE Product_Permission_Checker SHALL 对所有拥有 `Admin` 角色的用户放行
4. WHEN `adminProductsEnabled` 为 `true` 且 `productManagementMode` 为 `'specific'` 时，THE Product_Permission_Checker SHALL 仅对 userId 存在于 `productManagerIds` 列表中的 Admin_User 放行
5. WHEN `adminProductsEnabled` 为 `true` 且 `productManagementMode` 为 `'specific'` 且当前 Admin_User 的 userId 不在 `productManagerIds` 列表中时，THE Product_Permission_Checker SHALL 返回 403 错误，错误码为 `FORBIDDEN`，错误消息为"管理员暂无商品管理权限"
6. THE Product_Permission_Checker SHALL 应用于所有商品管理相关路由：创建商品、更新商品、设置商品状态、获取上传 URL、删除图片

### 需求 4：Feature Toggles API 更新

**用户故事：** 作为系统，我希望功能开关的读取和更新接口能正确处理新增的 `productManagementMode` 和 `productManagerIds` 字段。

#### 验收标准

1. THE `GET /api/settings/feature-toggles` 接口 SHALL 在响应中包含 `productManagementMode` 和 `productManagerIds` 字段
2. THE `PUT /api/admin/settings/feature-toggles` 接口 SHALL 接受 `productManagementMode`（`'all'` 或 `'specific'`）和 `productManagerIds`（字符串数组）参数
3. WHEN 更新请求中 `productManagementMode` 不是 `'all'` 或 `'specific'` 时，THE 更新接口 SHALL 返回验证错误（`INVALID_REQUEST`）
4. WHEN 更新请求中 `productManagerIds` 不是字符串数组时，THE 更新接口 SHALL 返回验证错误（`INVALID_REQUEST`）
5. WHEN `productManagementMode` 为 `'specific'` 且 `productManagerIds` 为空数组时，THE 更新接口 SHALL 接受该请求（允许清空指定管理人列表，此时无 Admin 可管理商品）
6. THE 更新接口 SHALL 仅允许 SuperAdmin 角色调用（与现有权限控制一致）

### 需求 5：Settings 页面 UI — 管理模式选择

**用户故事：** 作为 SuperAdmin，我希望在 "Admin Products" 开关打开时，能够选择"所有 Admin"或"指定 Admin"拥有商品管理权限，以便精细化控制管理人员。

#### 验收标准

1. WHEN `adminProductsEnabled` 开关为 ON 时，THE Settings_Page SHALL 在该开关下方展示一个展开区域，包含管理模式的 Radio 选择
2. WHEN `adminProductsEnabled` 开关为 OFF 时，THE Settings_Page SHALL 隐藏管理模式选择区域（渐进式披露）
3. THE Radio 选择 SHALL 包含两个选项："所有 Admin"（对应 `'all'`）和"指定 Admin"（对应 `'specific'`），默认选中"所有 Admin"
4. WHEN SuperAdmin 切换 Radio 选项时，THE Settings_Page SHALL 立即更新 `productManagementMode` 的值
5. WHEN 选择"所有 Admin"时，THE Settings_Page SHALL 不显示额外的用户列表（渐进式披露）

### 需求 6：Settings 页面 UI — 可搜索 Admin 勾选列表

**用户故事：** 作为 SuperAdmin，我希望在选择"指定 Admin"时，看到一个可搜索的 Admin 用户勾选列表，以便快速选择具体的商品管理人员。

#### 验收标准

1. WHEN 管理模式为"指定 Admin"时，THE Settings_Page SHALL 在 Radio 选择下方展示 Admin_Checklist 组件
2. THE Admin_Checklist SHALL 通过 `GET /api/admin/users?role=Admin` 接口获取 Admin 用户列表
3. THE Admin_Checklist 的每一行 SHALL 包含：勾选框、用户昵称、用户邮箱、角色徽章
4. THE Admin_Checklist SHALL 在列表顶部提供搜索框，支持按昵称或邮箱进行过滤
5. THE Admin_Checklist SHALL 在底部显示"已选 N 人"的计数信息
6. WHEN SuperAdmin 勾选或取消勾选某个 Admin 时，THE Settings_Page SHALL 更新 `productManagerIds` 列表
7. THE Admin_Checklist SHALL 根据 `productManagerIds` 的当前值预选已有的管理人
8. WHEN 管理模式从"指定 Admin"切换回"所有 Admin"时，THE Settings_Page SHALL 隐藏 Admin_Checklist（但保留 `productManagerIds` 数据，不清空）

### 需求 7：Admin Handler 商品路由权限更新

**用户故事：** 作为系统，我希望 Admin Handler 中的所有商品管理路由使用更新后的权限检查逻辑，以便正确执行精细化权限控制。

#### 验收标准

1. WHEN Admin_User 请求管理商品时，THE Admin Handler SHALL 从 Feature_Toggles_System 获取最新的 `productManagementMode` 和 `productManagerIds` 值（每次请求实时读取，不缓存）
2. THE Admin Handler SHALL 对以下路由执行 Product_Permission_Checker：`PUT /api/admin/products/{id}`（更新商品）、`PATCH /api/admin/products/{id}/status`（设置状态）、`POST /api/admin/products`（创建商品）、`GET /api/admin/products/{id}/upload-url`（获取上传 URL）、`POST /api/admin/temp-upload-url`（获取临时上传 URL）、`DELETE /api/admin/products/{id}/images/{key}`（删除图片）
3. WHEN Product_Permission_Checker 返回 403 错误时，THE Admin Handler SHALL 返回 HTTP 403 响应，body 包含 `{ code: 'FORBIDDEN', message: '管理员暂无商品管理权限' }`

### 需求 8：国际化支持

**用户故事：** 作为用户，我希望新增的 UI 文案支持所有 5 种语言（zh、en、ja、ko、zh-TW），以便不同语言的用户都能正常使用。

#### 验收标准

1. THE Settings_Page 中新增的所有文案 SHALL 使用 i18n 翻译键，通过现有的 `useTranslation` 机制加载
2. THE 翻译内容 SHALL 覆盖以下文案：管理模式标签（"所有 Admin" / "指定 Admin"）、搜索框占位符、"已选 N 人"计数文案
3. THE 翻译内容 SHALL 支持 5 种语言：简体中文（zh）、英文（en）、日文（ja）、韩文（ko）、繁体中文（zh-TW）
4. THE 翻译键 SHALL 遵循现有的命名规范（`admin.settings.*` 前缀）
