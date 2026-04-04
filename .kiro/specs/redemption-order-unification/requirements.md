# 需求文档 - 兑换记录统一与物流追踪

## 简介

本功能解决积分商城系统（Points Mall）中兑换系统与订单系统分离导致的三个核心问题：

1. **兑换记录无法显示**：前端个人中心"兑换记录"Tab 调用 `/api/redemptions/history` 接口，但前端期望的响应格式为 `{ items, total, page, pageSize }`，而后端实际返回 `{ records, lastKey }`，字段名不匹配导致记录无法渲染。
2. **Code 兑换缺少收货地址**：当前 Code 兑换商品（`POST /api/redemptions/code`）不要求用户填写收货地址，导致实物商品无法配送。
3. **兑换记录缺少物流追踪**：积分兑换和 Code 兑换生成的记录仅存储在 Redemptions 表中，没有物流状态字段，用户无法查看发货和配送进度。

本次需求将兑换流程统一纳入订单系统：积分兑换和 Code 兑换在完成后均自动创建订单记录（Orders 表），复用现有的收货地址选择、物流状态追踪和管理端订单管理功能。同时修复兑换记录 API 的响应格式问题。

---

## 词汇表

- **积分商城（Points_Mall）**：本系统整体，包含用户端和管理端
- **用户（User）**：已登录系统的任意身份用户
- **管理员（Admin）**：负责管理后台操作的人员
- **兑换服务（Redemption_Service）**：负责处理积分兑换和 Code 兑换逻辑的后端模块
- **订单服务（Order_Service）**：负责订单创建、查询和物流状态管理的后端模块
- **收货地址服务（Address_Service）**：负责收货地址管理的后端模块
- **兑换记录（Redemption_Record）**：Redemptions 表中的兑换历史记录
- **订单（Order）**：Orders 表中的订单记录，包含商品信息、收货地址和物流状态
- **物流状态（Shipping_Status）**：订单的配送进度，包括待发货（pending）、已发货（shipped）、运输中（in_transit）、已签收（delivered）
- **积分兑换（Points_Redemption）**：用户使用积分兑换商品的操作
- **Code 兑换（Code_Redemption）**：用户使用兑换码兑换商品的操作
- **兑换历史 API（Redemption_History_API）**：`GET /api/redemptions/history` 接口，返回用户的兑换记录列表

---

## 需求

### 需求 1：修复兑换记录显示问题（Bug 修复）

**用户故事：** 作为用户，我希望在个人中心的"兑换记录"Tab 中正常查看我的积分兑换和 Code 兑换历史，以便了解过往兑换情况。

#### 验收标准

1. THE Redemption_History_API SHALL 返回包含 `items`、`total`、`page`、`pageSize` 四个字段的分页响应，其中 `items` 为兑换记录数组
2. WHEN 用户请求兑换历史并传入 `page` 和 `pageSize` 查询参数，THE Redemption_History_API SHALL 按页码和每页数量返回对应的兑换记录子集
3. THE Redemption_History_API SHALL 按创建时间倒序排列兑换记录
4. WHEN 用户的兑换记录为空，THE Redemption_History_API SHALL 返回 `items` 为空数组、`total` 为 0 的响应
5. THE Redemption_History_API SHALL 在每条兑换记录中包含 `redemptionId`、`productName`、`method`（points 或 code）、`pointsSpent`（积分兑换时）、`status` 和 `createdAt` 字段

---

### 需求 2：Code 兑换商品增加收货地址

**用户故事：** 作为用户，我希望在使用 Code 兑换商品时选择收货地址，以便实物商品能够配送到我指定的地址。

#### 验收标准

1. WHEN 用户提交 Code 兑换请求，THE Redemption_Service SHALL 要求请求中包含 `addressId` 字段
2. IF 用户提交的 Code 兑换请求缺少 `addressId`，THEN THE Redemption_Service SHALL 返回"请选择收货地址"的错误提示
3. WHEN 用户提交 Code 兑换请求，THE Redemption_Service SHALL 校验 `addressId` 对应的收货地址存在且属于该用户
4. IF 用户提交的 `addressId` 对应的收货地址不存在或不属于该用户，THEN THE Redemption_Service SHALL 返回"收货地址不存在"的错误提示
5. THE Points_Mall SHALL 在 Code 兑换页面展示收货地址选择器，用户必须选择一个收货地址后才能提交兑换
6. WHEN 用户在 Code 兑换页面尚未保存任何收货地址，THE Points_Mall SHALL 提供"新增地址"入口引导用户添加收货地址

---

### 需求 3：积分兑换商品增加收货地址

**用户故事：** 作为用户，我希望在使用积分兑换商品时选择收货地址，以便实物商品能够配送到我指定的地址。

#### 验收标准

1. WHEN 用户提交积分兑换请求，THE Redemption_Service SHALL 要求请求中包含 `addressId` 字段
2. IF 用户提交的积分兑换请求缺少 `addressId`，THEN THE Redemption_Service SHALL 返回"请选择收货地址"的错误提示
3. WHEN 用户提交积分兑换请求，THE Redemption_Service SHALL 校验 `addressId` 对应的收货地址存在且属于该用户
4. IF 用户提交的 `addressId` 对应的收货地址不存在或不属于该用户，THEN THE Redemption_Service SHALL 返回"收货地址不存在"的错误提示
5. THE Points_Mall SHALL 在积分兑换页面展示收货地址选择器，用户必须选择一个收货地址后才能提交兑换

---

### 需求 4：兑换自动创建订单

**用户故事：** 作为用户，我希望积分兑换和 Code 兑换完成后自动生成订单，以便我能在"我的订单"中统一查看所有兑换商品的配送状态。

#### 验收标准

1. WHEN 积分兑换成功，THE Redemption_Service SHALL 在 Orders 表中创建一条订单记录，包含商品信息、收货地址、积分总计和初始物流状态"待发货"
2. WHEN Code 兑换成功，THE Redemption_Service SHALL 在 Orders 表中创建一条订单记录，包含商品信息、收货地址和初始物流状态"待发货"，积分总计为 0
3. THE Redemption_Service SHALL 在创建的订单记录中标注兑换来源（`source` 字段），积分兑换标注为 `points_redemption`，Code 兑换标注为 `code_redemption`
4. THE Redemption_Service SHALL 在兑换记录（Redemptions 表）中保存关联的 `orderId`，建立兑换记录与订单的关联
5. WHEN 兑换创建的订单记录写入 Orders 表，THE Order_Service SHALL 同时写入一条初始物流事件（status: pending, remark: "兑换订单已创建"）
6. THE Redemption_Service SHALL 在兑换成功的响应中返回 `orderId`，前端可据此跳转至订单详情页

---

### 需求 5：兑换订单的物流追踪

**用户故事：** 作为用户，我希望查看兑换商品的物流状态和配送进度，以便了解商品何时送达。

#### 验收标准

1. THE Order_Service SHALL 对兑换创建的订单支持与购物车订单相同的物流状态流转：pending → shipped → in_transit → delivered
2. THE Points_Mall SHALL 在订单详情页以时间线形式展示兑换订单的物流状态变更记录
3. THE Points_Mall SHALL 在订单列表页对兑换订单和购物车订单统一展示，用户可查看所有订单的物流状态
4. THE Admin SHALL 能够在管理端订单列表中查看和管理兑换创建的订单，操作方式与购物车订单一致
5. WHEN 管理员更新兑换订单的物流状态，THE Order_Service SHALL 按照现有物流状态流转规则处理（仅允许前进，不允许回退）

---

### 需求 6：兑换记录与订单的关联展示

**用户故事：** 作为用户，我希望在兑换记录中看到关联的物流状态，以便快速了解兑换商品的配送进度。

#### 验收标准

1. THE Redemption_History_API SHALL 在每条兑换记录中包含关联的 `orderId` 字段（兑换成功时）
2. THE Redemption_History_API SHALL 在每条兑换记录中包含关联订单的 `shippingStatus` 字段（兑换成功时）
3. THE Points_Mall SHALL 在个人中心"兑换记录"列表中展示每条记录的物流状态标签（待发货、已发货、运输中、已签收）
4. WHEN 用户点击某条兑换记录，THE Points_Mall SHALL 跳转至该兑换记录关联的订单详情页，展示完整的物流时间线和收货信息

---

### 需求 7：前端兑换页面适配

**用户故事：** 作为用户，我希望在兑换页面（积分兑换和 Code 兑换）看到收货地址选择器，以便在兑换前指定配送地址。

#### 验收标准

1. THE Points_Mall SHALL 在积分兑换确认区域上方展示收货地址选择器，显示当前选中地址的收件人、手机号和详细地址
2. THE Points_Mall SHALL 在 Code 兑换确认区域上方展示收货地址选择器，显示当前选中地址的收件人、手机号和详细地址
3. WHEN 用户存在默认收货地址，THE Points_Mall SHALL 自动选中默认地址
4. WHEN 用户点击收货地址区域，THE Points_Mall SHALL 展示地址选择列表，允许用户切换收货地址
5. IF 用户未保存任何收货地址，THEN THE Points_Mall SHALL 在地址区域显示"请添加收货地址"提示，并提供跳转至地址管理页的入口
6. WHILE 用户未选择收货地址，THE Points_Mall SHALL 禁用"确认兑换"按钮

---

### 需求 8：Redemption Lambda 增加数据库访问权限

**用户故事：** 作为系统架构师，我希望 Redemption Lambda 函数拥有访问 Addresses 表和 Orders 表的权限，以便兑换流程能够校验收货地址并创建订单。

#### 验收标准

1. THE Points_Mall SHALL 授予 Redemption Lambda 对 Addresses 表的读取权限，用于校验用户提交的收货地址
2. THE Points_Mall SHALL 授予 Redemption Lambda 对 Orders 表的读写权限，用于创建兑换订单记录
3. THE Points_Mall SHALL 将 `ADDRESSES_TABLE` 和 `ORDERS_TABLE` 环境变量传递给 Redemption Lambda 函数
