# 需求文档：员工商城访问控制（Employee Store Access Control）

## 简介

新增一个 SuperAdmin 专属的功能开关 `employeeStoreEnabled`，用于一键控制 AWS 员工（`isEmployee: true`）是否可以使用商城功能。当开关关闭时，员工用户将无法浏览商品、加入购物车、下单和兑换码，但仍可正常登录、查看个人资料、访问排行榜、内容中心以及管理后台（如有管理角色）。非员工用户不受此开关影响。

## 术语表

- **Feature_Toggles_System**：功能开关系统，存储在 DynamoDB Users 表中（`userId='feature-toggles'`），通过 `packages/backend/src/settings/feature-toggles.ts` 管理
- **Employee_User**：员工用户，用户记录中 `isEmployee` 字段为 `true` 的用户，通过员工邀请链接注册
- **Non_Employee_User**：非员工用户，用户记录中 `isEmployee` 字段为 `false` 或不存在的用户
- **Store_Functions**：商城功能，包括浏览商品列表、查看商品详情、加入购物车、下单购买、兑换码兑换
- **Settings_Page**：管理员设置页面（`packages/frontend/src/pages/admin/settings.tsx`），用于管理功能开关
- **Product_List_API**：商品列表接口（`GET /api/products`），返回商品列表数据
- **Product_Detail_API**：商品详情接口（`GET /api/products/:id`），返回单个商品详情
- **Cart_API**：购物车接口（`POST /api/cart/items`、`GET /api/cart` 等），管理用户购物车
- **Order_API**：订单接口（`POST /api/orders`），创建订单
- **Redeem_API**：兑换接口（`POST /api/redeem`），使用兑换码兑换商品

## 需求

### 需求 1：新增 employeeStoreEnabled 功能开关

**用户故事：** 作为 SuperAdmin，我希望系统中有一个 `employeeStoreEnabled` 功能开关，以便控制员工是否可以使用商城。

#### 验收标准

1. THE Feature_Toggles_System SHALL 包含一个布尔字段 `employeeStoreEnabled`，默认值为 `true`（员工默认可以使用商城）
2. WHEN DynamoDB 中不存在 `employeeStoreEnabled` 字段时（旧数据兼容），THE Feature_Toggles_System SHALL 将其默认视为 `true`
3. THE `employeeStoreEnabled` 字段 SHALL 与现有的功能开关字段（`codeRedemptionEnabled`、`adminProductsEnabled` 等）共存，不影响现有功能
4. WHEN `employeeStoreEnabled` 的值不是布尔类型时，THE Feature_Toggles_System SHALL 将其视为 `true`（安全降级）

### 需求 2：SuperAdmin 设置页面展示开关

**用户故事：** 作为 SuperAdmin，我希望在设置页面中看到并操作员工商城访问开关，以便一键控制员工的商城使用权限。

#### 验收标准

1. WHILE 当前用户角色为 SuperAdmin 时，THE Settings_Page SHALL 在功能开关分类中显示"员工商城访问"开关
2. WHILE 当前用户角色不是 SuperAdmin 时（如 Admin），THE Settings_Page SHALL 不显示"员工商城访问"开关
3. THE "员工商城访问"开关 SHALL 显示当前的 `employeeStoreEnabled` 状态（开启/关闭）
4. WHEN SuperAdmin 切换该开关时，THE Settings_Page SHALL 调用更新接口将新状态保存到 DynamoDB
5. THE "员工商城访问"开关 SHALL 附带说明文字，解释该开关的作用（关闭后员工无法使用商城功能）

### 需求 3：后端 API 拦截员工商城操作

**用户故事：** 作为系统，我希望在 `employeeStoreEnabled` 关闭时，后端 API 能拦截员工用户的商城操作请求，以确保访问控制的可靠性。

#### 验收标准

1. WHEN `employeeStoreEnabled` 为 `false` 且请求用户为 Employee_User 时，THE Product_List_API SHALL 返回空商品列表和一个标记字段 `employeeStoreBlocked: true`
2. WHEN `employeeStoreEnabled` 为 `false` 且请求用户为 Employee_User 时，THE Product_Detail_API SHALL 返回错误响应（HTTP 403，错误码 `EMPLOYEE_STORE_DISABLED`）
3. WHEN `employeeStoreEnabled` 为 `false` 且请求用户为 Employee_User 时，THE Cart_API 的添加操作 SHALL 返回错误响应（HTTP 403，错误码 `EMPLOYEE_STORE_DISABLED`）
4. WHEN `employeeStoreEnabled` 为 `false` 且请求用户为 Employee_User 时，THE Order_API SHALL 返回错误响应（HTTP 403，错误码 `EMPLOYEE_STORE_DISABLED`）
5. WHEN `employeeStoreEnabled` 为 `false` 且请求用户为 Employee_User 时，THE Redeem_API SHALL 返回错误响应（HTTP 403，错误码 `EMPLOYEE_STORE_DISABLED`）
6. WHEN `employeeStoreEnabled` 为 `true` 时，THE 所有商城 API SHALL 对 Employee_User 正常响应，不做额外拦截
7. THE 所有商城 API SHALL 对 Non_Employee_User 正常响应，无论 `employeeStoreEnabled` 的值如何

### 需求 4：前端商品页面展示拦截提示

**用户故事：** 作为员工用户，当商城功能被关闭时，我希望看到清晰的提示信息，而不是空白页面或错误页面。

#### 验收标准

1. WHEN `employeeStoreEnabled` 为 `false` 且当前用户为 Employee_User 时，THE 商品列表页面 SHALL 显示一条友好的提示信息（如"商城功能暂时关闭"），替代商品列表
2. WHEN `employeeStoreEnabled` 为 `false` 且当前用户为 Employee_User 时，THE 商品详情页面 SHALL 显示一条友好的提示信息，替代商品详情内容
3. WHEN `employeeStoreEnabled` 为 `false` 且当前用户为 Employee_User 时，THE 购物车页面 SHALL 显示一条友好的提示信息，替代购物车内容
4. THE 提示信息 SHALL 支持国际化（i18n），使用现有的翻译系统
5. THE 提示信息 SHALL 包含一个图标或插图，使页面不显得空洞

### 需求 5：员工非商城功能不受影响

**用户故事：** 作为员工用户，当商城功能被关闭时，我希望仍然可以正常使用系统的其他功能。

#### 验收标准

1. WHILE `employeeStoreEnabled` 为 `false` 时，THE Employee_User SHALL 能正常登录系统
2. WHILE `employeeStoreEnabled` 为 `false` 时，THE Employee_User SHALL 能正常查看和编辑个人资料
3. WHILE `employeeStoreEnabled` 为 `false` 时，THE Employee_User SHALL 能正常访问积分排行榜
4. WHILE `employeeStoreEnabled` 为 `false` 时，THE Employee_User SHALL 能正常访问内容中心（浏览、上传、下载等）
5. WHILE `employeeStoreEnabled` 为 `false` 时，THE 拥有管理角色的 Employee_User SHALL 能正常使用管理后台功能
6. WHILE `employeeStoreEnabled` 为 `false` 时，THE Employee_User SHALL 能正常查看积分记录

### 需求 6：非员工用户完全不受影响

**用户故事：** 作为非员工用户（社区用户），我希望无论员工商城开关的状态如何，我的商城使用体验都不受任何影响。

#### 验收标准

1. WHILE `employeeStoreEnabled` 为 `false` 时，THE Non_Employee_User SHALL 能正常浏览商品列表和商品详情
2. WHILE `employeeStoreEnabled` 为 `false` 时，THE Non_Employee_User SHALL 能正常使用购物车功能
3. WHILE `employeeStoreEnabled` 为 `false` 时，THE Non_Employee_User SHALL 能正常下单和兑换码兑换
4. FOR ALL Non_Employee_User 的请求，THE 商城 API SHALL 不检查 `employeeStoreEnabled` 开关状态

### 需求 7：功能开关 API 更新支持

**用户故事：** 作为系统，我希望功能开关的读取和更新接口能正确处理 `employeeStoreEnabled` 字段。

#### 验收标准

1. THE `GET /api/settings/feature-toggles` 接口 SHALL 在响应中包含 `employeeStoreEnabled` 字段
2. THE `PUT /api/admin/settings/feature-toggles` 接口 SHALL 接受 `employeeStoreEnabled` 布尔参数
3. WHEN 更新请求中 `employeeStoreEnabled` 不是布尔类型时，THE 更新接口 SHALL 返回验证错误（`INVALID_REQUEST`）
4. THE 更新接口 SHALL 仅允许 SuperAdmin 角色调用（与现有权限控制一致）

### 需求 8：数据向后兼容

**用户故事：** 作为系统，我希望新增的 `employeeStoreEnabled` 字段与现有数据完全兼容，不影响已有功能开关记录。

#### 验收标准

1. THE 现有的 feature-toggles 记录（不含 `employeeStoreEnabled` 字段）SHALL 继续正常工作
2. WHEN 系统读取不含 `employeeStoreEnabled` 字段的记录时，THE Feature_Toggles_System SHALL 将其默认视为 `true`（员工可使用商城）
3. THE 新增字段 SHALL 不影响现有的 `contentRolePermissions` 独立更新逻辑
4. FOR ALL 现有的 feature-toggles 记录，读取后再写入 SHALL 产生等价的对象（round-trip 属性）
