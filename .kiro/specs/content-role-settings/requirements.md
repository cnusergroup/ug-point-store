# 需求文档：内容角色权限设置（Content Role Settings）

## 简介

在 SuperAdmin 管理设置页（`/pages/admin/settings`）新增两类 SuperAdmin 专属配置：

1. **Admin 内容审批开关**（`adminContentReviewEnabled`）：控制 Admin 角色是否可以审批内容（通过/拒绝）。默认关闭（false），关闭时只有 SuperAdmin 可以审批内容。

2. **内容角色权限矩阵**（`contentRolePermissions`）：针对三个普通角色（Speaker、UserGroupLeader、Volunteer）分别配置四个独立权限开关：是否可以访问内容中心（canAccess）、是否可以上传内容（canUpload）、是否可以下载内容（canDownload）、是否可以预约内容（canReserve）。默认值为所有角色的所有权限均为 true（全开）。

这两类配置存储在 DynamoDB Users 表的 `feature-toggles` 记录中（与现有 feature-toggles 同一条记录），由 SuperAdmin 在设置页管理。后端相关内容 API 在处理请求时读取这些配置并做权限校验。

## 术语表

- **SuperAdmin**：系统中唯一拥有 `SuperAdmin` 角色的用户，拥有最高权限，可管理所有设置，始终拥有内容中心全部权限，不受权限矩阵限制。
- **Admin**：拥有 `Admin` 角色的用户。纯 Admin（仅有 Admin 角色，不同时拥有 Speaker、UserGroupLeader 或 Volunteer 角色）无内容中心权限；若 Admin 同时拥有 Speaker、UserGroupLeader 或 Volunteer 角色之一，则按其所拥有的内容角色权限矩阵判断。
- **Content_Role**：内容中心权限矩阵所覆盖的三个角色：Speaker、UserGroupLeader、Volunteer。只有这三个角色受权限矩阵控制。
- **Pure_Admin**：仅拥有 Admin 角色（不同时拥有任何 Content_Role）的用户，无内容中心访问权限。
- **Content_Reviewer**：有权审批内容（通过/拒绝）的用户角色，默认仅 SuperAdmin，开启 `adminContentReviewEnabled` 后 Admin 也可审批。
- **Feature_Toggles_Record**：存储在 DynamoDB Users 表中、分区键为 `feature-toggles` 的单条配置记录，包含所有功能开关和权限矩阵。
- **Content_Role_Permissions**：`contentRolePermissions` 字段，存储三个 Content_Role（Speaker、UserGroupLeader、Volunteer）各自的四项权限开关。
- **Settings_Page**：现有前端页面 `/pages/admin/settings`，本功能在此页面新增两个配置区块。
- **Content_Handler**：处理内容相关 API 请求的后端 Lambda 函数（`packages/backend/src/content/handler.ts`）。
- **Admin_Content_Handler**：处理管理端内容审批 API 请求的后端 Lambda 函数（`packages/backend/src/content/handler.ts` 中的管理端路由）。
- **Settings_Service**：`packages/backend/src/settings/feature-toggles.ts`，提供读取和更新功能开关配置的函数。
- **canAccess**：角色是否可以访问内容中心（查看内容列表和详情）的权限开关。
- **canUpload**：角色是否可以上传内容的权限开关。
- **canDownload**：角色是否可以下载内容（获取下载链接）的权限开关，与 canReserve 完全独立，互不依赖。
- **canReserve**：角色是否可以预约内容的权限开关，与 canDownload 完全独立，互不依赖。

## 需求

### 需求 1：Admin 内容审批开关数据存储

**用户故事：** 作为系统，我希望将 Admin 内容审批开关持久化存储在现有 feature-toggles 记录中，以便复用已有存储结构，避免新建表。

#### 验收标准

1. THE Settings_Service SHALL 在现有 Feature_Toggles_Record 中新增 `adminContentReviewEnabled` 布尔字段
2. WHEN Feature_Toggles_Record 不存在或 `adminContentReviewEnabled` 字段缺失时，THE Settings_Service SHALL 将该字段视为 false（默认关闭）
3. THE Settings_Service SHALL 在 `getFeatureToggles` 函数返回值中包含 `adminContentReviewEnabled` 字段
4. THE Settings_Service SHALL 在 `updateFeatureToggles` 函数中接受并持久化 `adminContentReviewEnabled` 字段

### 需求 2：内容角色权限矩阵数据存储

**用户故事：** 作为系统，我希望将内容角色权限矩阵持久化存储在现有 feature-toggles 记录中，以便统一管理所有内容相关配置。

#### 验收标准

1. THE Settings_Service SHALL 在现有 Feature_Toggles_Record 中新增 `contentRolePermissions` 对象字段，包含三个角色（Speaker、UserGroupLeader、Volunteer）各自的四项权限（canAccess、canUpload、canDownload、canReserve）
2. WHEN Feature_Toggles_Record 不存在或 `contentRolePermissions` 字段缺失时，THE Settings_Service SHALL 将所有角色的所有权限视为 true（默认全开）
3. WHEN `contentRolePermissions` 中某个角色的某项权限字段缺失时，THE Settings_Service SHALL 将该缺失权限视为 true（默认全开）
4. THE Settings_Service SHALL 在 `getFeatureToggles` 函数返回值中包含完整的 `contentRolePermissions` 对象
5. THE Settings_Service SHALL 在 `updateContentRolePermissions` 函数中接受并持久化完整的 `contentRolePermissions` 对象

### 需求 3：查询接口返回新增字段

**用户故事：** 作为前端应用，我希望公开查询接口返回新增的权限配置字段，以便前端根据配置动态调整内容中心的功能显示。

#### 验收标准

1. WHEN 任意客户端请求 GET /api/settings/feature-toggles，THE Settings_Service SHALL 在响应中包含 `adminContentReviewEnabled` 和 `contentRolePermissions` 字段
2. WHEN Feature_Toggles_Record 不存在时，THE Settings_Service SHALL 返回 `adminContentReviewEnabled: false` 和所有权限均为 true 的默认 `contentRolePermissions`
3. THE Settings_Service SHALL 确保响应中 `contentRolePermissions` 包含 Speaker、UserGroupLeader、Volunteer 三个角色的完整权限对象

### 需求 4：更新 Admin 内容审批开关（SuperAdmin 专属）

**用户故事：** 作为 SuperAdmin，我希望能够开启或关闭 Admin 角色的内容审批权限，以便灵活控制内容审批的权限范围。

#### 验收标准

1. WHEN SuperAdmin 请求 PUT /api/admin/settings/feature-toggles，THE Admin_Handler SHALL 接受并持久化 `adminContentReviewEnabled` 布尔字段
2. IF 请求体中 `adminContentReviewEnabled` 字段类型不是布尔值，THEN THE Admin_Handler SHALL 返回 400 错误码 INVALID_REQUEST
3. WHEN 更新成功，THE Admin_Handler SHALL 在响应中返回包含 `adminContentReviewEnabled` 的完整更新后设置

### 需求 5：更新内容角色权限矩阵（SuperAdmin 专属）

**用户故事：** 作为 SuperAdmin，我希望能够为每个角色独立配置内容中心的访问、上传、下载、预约权限，以便精细化控制不同角色的内容操作能力。

#### 验收标准

1. WHEN SuperAdmin 请求 PUT /api/admin/settings/content-role-permissions，THE Admin_Handler SHALL 验证请求者拥有 SuperAdmin 角色
2. IF 请求者不拥有 SuperAdmin 角色，THEN THE Admin_Handler SHALL 返回 403 错误码 FORBIDDEN
3. WHEN SuperAdmin 提交权限矩阵更新，THE Admin_Handler SHALL 要求请求体包含 Speaker、UserGroupLeader、Volunteer 三个角色各自的 canAccess、canUpload、canDownload、canReserve 四项布尔值字段
4. IF 请求体中任意权限字段类型不是布尔值，THEN THE Admin_Handler SHALL 返回 400 错误码 INVALID_REQUEST
5. WHEN 更新成功，THE Admin_Handler SHALL 使用 PutCommand 将完整权限矩阵写入 Feature_Toggles_Record，并返回更新后的权限矩阵
6. THE Admin_Handler SHALL 确保权限矩阵更新操作的幂等性，多次提交相同值不产生副作用

### 需求 6：后端内容访问权限校验

**用户故事：** 作为系统，我希望在用户访问内容列表和详情时校验其角色的 canAccess 权限，以便确保权限配置有效执行。

#### 验收标准

1. WHEN 用户请求 GET /api/content 或 GET /api/content/{contentId}，THE Content_Handler SHALL 读取该用户所拥有的 Content_Role 对应的 `canAccess` 权限
2. WHEN 用户拥有 SuperAdmin 角色，THE Content_Handler SHALL 始终允许访问，不受权限矩阵限制
3. WHEN 用户为 Pure_Admin（仅有 Admin 角色，不拥有任何 Content_Role），THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有访问内容中心的权限"
4. WHEN 用户同时拥有 Admin 角色和至少一个 Content_Role 时，THE Content_Handler SHALL 按该用户所拥有的 Content_Role 权限矩阵判断，忽略 Admin 角色本身
5. WHEN 用户所拥有的全部 Content_Role 的 `canAccess` 均为 false，THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有访问内容中心的权限"
6. WHEN 用户同时拥有多个 Content_Role 时，THE Content_Handler SHALL 取各 Content_Role 权限的并集（任一 Content_Role 有权限即可访问）

### 需求 7：后端内容上传权限校验

**用户故事：** 作为系统，我希望在用户上传内容时校验其角色的 canUpload 权限，以便确保只有被授权的角色才能上传内容。

#### 验收标准

1. WHEN 用户请求 POST /api/content/upload-url 或 POST /api/content，THE Content_Handler SHALL 读取该用户所拥有的 Content_Role 对应的 `canUpload` 权限
2. WHEN 用户拥有 SuperAdmin 角色，THE Content_Handler SHALL 始终允许上传，不受权限矩阵限制
3. WHEN 用户为 Pure_Admin（仅有 Admin 角色，不拥有任何 Content_Role），THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有上传内容的权限"
4. WHEN 用户同时拥有 Admin 角色和至少一个 Content_Role 时，THE Content_Handler SHALL 按该用户所拥有的 Content_Role 权限矩阵判断，忽略 Admin 角色本身
5. WHEN 用户所拥有的全部 Content_Role 的 `canUpload` 均为 false，THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有上传内容的权限"
6. WHEN 用户同时拥有多个 Content_Role 时，THE Content_Handler SHALL 取各 Content_Role 权限的并集（任一 Content_Role 有权限即可上传）

### 需求 8：后端内容下载权限校验

**用户故事：** 作为系统，我希望在用户获取下载链接时校验其角色的 canDownload 权限，以便确保只有被授权的角色才能下载内容。

#### 验收标准

1. WHEN 用户请求 GET /api/content/{contentId}/download，THE Content_Handler SHALL 读取该用户所拥有的 Content_Role 对应的 `canDownload` 权限
2. WHEN 用户拥有 SuperAdmin 角色，THE Content_Handler SHALL 始终允许下载，不受权限矩阵限制
3. WHEN 用户为 Pure_Admin（仅有 Admin 角色，不拥有任何 Content_Role），THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有下载内容的权限"
4. WHEN 用户同时拥有 Admin 角色和至少一个 Content_Role 时，THE Content_Handler SHALL 按该用户所拥有的 Content_Role 权限矩阵判断，忽略 Admin 角色本身
5. WHEN 用户所拥有的全部 Content_Role 的 `canDownload` 均为 false，THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有下载内容的权限"
6. WHEN 用户同时拥有多个 Content_Role 时，THE Content_Handler SHALL 取各 Content_Role 权限的并集（任一 Content_Role 有权限即可下载）
7. THE Content_Handler SHALL 独立校验 `canDownload` 权限，不依赖 `canReserve` 的状态

### 需求 9：后端内容预约权限校验

**用户故事：** 作为系统，我希望在用户预约内容时校验其角色的 canReserve 权限，以便确保只有被授权的角色才能预约内容。

#### 验收标准

1. WHEN 用户请求 POST /api/content/{contentId}/reserve，THE Content_Handler SHALL 读取该用户所拥有的 Content_Role 对应的 `canReserve` 权限
2. WHEN 用户拥有 SuperAdmin 角色，THE Content_Handler SHALL 始终允许预约，不受权限矩阵限制
3. WHEN 用户为 Pure_Admin（仅有 Admin 角色，不拥有任何 Content_Role），THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有预约内容的权限"
4. WHEN 用户同时拥有 Admin 角色和至少一个 Content_Role 时，THE Content_Handler SHALL 按该用户所拥有的 Content_Role 权限矩阵判断，忽略 Admin 角色本身
5. WHEN 用户所拥有的全部 Content_Role 的 `canReserve` 均为 false，THE Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"您没有预约内容的权限"
6. WHEN 用户同时拥有多个 Content_Role 时，THE Content_Handler SHALL 取各 Content_Role 权限的并集（任一 Content_Role 有权限即可预约）
7. THE Content_Handler SHALL 独立校验 `canReserve` 权限，不依赖 `canDownload` 的状态

### 需求 10：后端内容审批权限校验

**用户故事：** 作为系统，我希望在管理端审批内容时根据 adminContentReviewEnabled 开关校验请求者权限，以便确保审批操作只由授权角色执行。

#### 验收标准

1. WHEN 用户请求 POST /api/admin/content/{contentId}/review，THE Admin_Content_Handler SHALL 读取 `adminContentReviewEnabled` 配置
2. WHEN `adminContentReviewEnabled` 为 false 且请求者仅拥有 Admin 角色（非 SuperAdmin），THE Admin_Content_Handler SHALL 返回 403 错误码 PERMISSION_DENIED 和消息"需要超级管理员权限才能审批内容"
3. WHEN `adminContentReviewEnabled` 为 true，THE Admin_Content_Handler SHALL 允许 Admin 和 SuperAdmin 均可执行内容审批操作
4. WHEN 请求者拥有 SuperAdmin 角色，THE Admin_Content_Handler SHALL 始终允许执行内容审批，不受 `adminContentReviewEnabled` 开关影响

### 需求 11：前端设置页面 — Admin 内容审批开关

**用户故事：** 作为 SuperAdmin，我希望在设置页面看到 Admin 内容审批开关，以便直观地控制 Admin 角色的审批权限。

#### 验收标准

1. WHEN SuperAdmin 打开设置页面，THE Settings_Page SHALL 在现有设置区块下方新增"内容审批权限"区块，仅对 SuperAdmin 可见
2. THE Settings_Page SHALL 在"内容审批权限"区块中展示 `adminContentReviewEnabled` 开关，包含功能名称和描述文字
3. WHEN Settings_Page 加载时，THE Settings_Page SHALL 调用 GET /api/settings/feature-toggles 获取 `adminContentReviewEnabled` 当前值并回显到开关控件
4. WHEN SuperAdmin 切换 `adminContentReviewEnabled` 开关，THE Settings_Page SHALL 调用 PUT /api/admin/settings/feature-toggles 提交更新
5. WHEN 更新成功，THE Settings_Page SHALL 显示操作成功提示
6. IF 更新失败，THEN THE Settings_Page SHALL 显示错误提示并将开关恢复到更新前的状态

### 需求 12：前端设置页面 — 内容角色权限矩阵

**用户故事：** 作为 SuperAdmin，我希望在设置页面看到内容角色权限矩阵，以便为每个角色独立配置内容中心的操作权限。

#### 验收标准

1. WHEN SuperAdmin 打开设置页面，THE Settings_Page SHALL 在"内容审批权限"区块下方新增"内容角色权限"区块，仅对 SuperAdmin 可见
2. THE Settings_Page SHALL 在"内容角色权限"区块中以矩阵形式展示三个角色（Speaker、UserGroupLeader/Leader、Volunteer）各自的四项权限开关（canAccess、canUpload、canDownload、canReserve）
3. WHEN Settings_Page 加载时，THE Settings_Page SHALL 调用 GET /api/settings/feature-toggles 获取 `contentRolePermissions` 当前值并回显到各开关控件
4. WHEN SuperAdmin 切换任意角色的任意权限开关，THE Settings_Page SHALL 调用 PUT /api/admin/settings/content-role-permissions 提交完整的权限矩阵更新
5. WHEN 更新成功，THE Settings_Page SHALL 显示操作成功提示
6. IF 更新失败，THEN THE Settings_Page SHALL 显示错误提示并将对应开关恢复到更新前的状态

### 需求 13：前端内容中心权限拦截

**用户故事：** 作为用户，我希望在没有相应权限时访问内容中心功能能看到明确提示，以便了解当前操作不可用。

#### 验收标准

1. WHEN 内容中心页面加载时，THE Content_Hub_Page SHALL 调用 GET /api/settings/feature-toggles 获取当前用户角色对应的权限配置
2. WHEN 用户拥有 SuperAdmin 角色，THE Content_Hub_Page SHALL 不受权限矩阵限制，正常显示所有功能
3. WHEN 用户为 Pure_Admin（仅有 Admin 角色，不拥有任何 Content_Role），THE Content_Hub_Page SHALL 显示无权限提示页面，并提供返回按钮
4. WHEN 用户同时拥有 Admin 角色和至少一个 Content_Role 时，THE Content_Hub_Page SHALL 按该用户所拥有的 Content_Role 权限矩阵判断，忽略 Admin 角色本身
5. WHEN 用户所拥有的全部 Content_Role 的 `canAccess` 均为 false，THE Content_Hub_Page SHALL 显示无权限提示页面，并提供返回按钮
6. WHEN 用户有权访问内容中心且其所拥有的全部 Content_Role 的 `canUpload` 均为 false，THE Content_Hub_Page SHALL 隐藏上传内容按钮
7. WHEN 用户有权访问内容中心且其所拥有的全部 Content_Role 的 `canDownload` 均为 false，THE Content_Hub_Page SHALL 在内容详情页隐藏下载按钮
8. WHEN 用户有权访问内容中心且其所拥有的全部 Content_Role 的 `canReserve` 均为 false，THE Content_Hub_Page SHALL 在内容详情页隐藏预约按钮
9. THE Content_Hub_Page SHALL 独立判断 `canDownload` 和 `canReserve` 的显示状态，两者互不影响

### 需求 14：国际化支持

**用户故事：** 作为用户，我希望新增的权限配置相关提示信息支持多语言，以便不同语言的用户都能理解。

### 需求 15：Admin 分类管理开关

**用户故事：** 作为 SuperAdmin，我希望能够控制 Admin 角色是否可以管理内容分类（创建、编辑、删除），以便在需要时将分类管理权限限制为仅 SuperAdmin 可操作。

#### 验收标准

1. THE Settings_Service SHALL 在现有 Feature_Toggles_Record 中新增 `adminCategoriesEnabled` 布尔字段
2. WHEN Feature_Toggles_Record 不存在或 `adminCategoriesEnabled` 字段缺失时，THE Settings_Service SHALL 将该字段视为 false（默认关闭）
3. THE Settings_Service SHALL 在 `getFeatureToggles` 函数返回值中包含 `adminCategoriesEnabled` 字段
4. THE Settings_Service SHALL 在 `updateFeatureToggles` 函数中接受并持久化 `adminCategoriesEnabled` 字段
5. WHEN 用户请求 POST /api/admin/content/categories、PUT /api/admin/content/categories/{id} 或 DELETE /api/admin/content/categories/{id}，THE Admin_Handler SHALL 读取 `adminCategoriesEnabled` 配置
6. WHEN `adminCategoriesEnabled` 为 false 且请求者仅拥有 Admin 角色（非 SuperAdmin），THE Admin_Handler SHALL 返回 403 错误码 FORBIDDEN 和消息"需要超级管理员权限才能管理分类"
7. WHEN `adminCategoriesEnabled` 为 true，THE Admin_Handler SHALL 允许 Admin 和 SuperAdmin 均可执行分类管理操作
8. WHEN 请求者拥有 SuperAdmin 角色，THE Admin_Handler SHALL 始终允许执行分类管理，不受 `adminCategoriesEnabled` 开关影响
9. WHEN SuperAdmin 打开设置页面，THE Settings_Page SHALL 在"内容审批权限"区块中展示 `adminCategoriesEnabled` 开关（与 `adminContentReviewEnabled` 同区块）
10. WHEN SuperAdmin 切换 `adminCategoriesEnabled` 开关，THE Settings_Page SHALL 调用 PUT /api/admin/settings/feature-toggles 提交更新，成功后显示提示，失败后回滚

#### 验收标准

1. THE Frontend SHALL 为所有新增的用户可见文本添加 i18n 翻译键，包括：设置区块标题、权限开关标签、权限描述、错误提示
2. THE Frontend SHALL 在 zh、en、ja、ko、zh-TW 五种语言文件中添加对应翻译
3. THE Frontend SHALL 使用 `useTranslation` hook 获取翻译文本，不硬编码任何用户可见字符串
