# 实现计划：购物车、收货信息与物流追踪

## 概述

在现有积分商城系统基础上新增购物车、收货地址管理和订单物流追踪三大模块。涉及共享类型与错误码扩展、3 张新 DynamoDB 表、2 个新 Lambda 函数、5 个前端新页面。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 新增购物车、地址、订单相关类型定义
    - 在 `packages/shared/src/types.ts` 中新增以下类型：
      - `ShippingStatus` 类型：`'pending' | 'shipped' | 'in_transit' | 'delivered'`
      - `ShippingEvent` 接口：status、timestamp、remark、operatorId
      - `CartItem` 接口：productId、quantity、addedAt
      - `CartItemDetail` 接口：含商品信息、subtotal、available 等
      - `CartResponse` 接口：userId、items、totalPoints、updatedAt
      - `AddressRequest` / `AddressResponse` 接口
      - `CreateOrderRequest` / `DirectOrderRequest` / `UpdateShippingRequest` 接口
      - `OrderItem` / `OrderResponse` / `OrderListItem` / `OrderStats` 接口
    - 新增辅助函数 `SHIPPING_STATUS_ORDER` 常量数组和 `validateStatusTransition(current, target)` 函数
    - 新增辅助函数 `calculateCartTotal(items)` 和 `maskPhone(phone)` 函数
    - _需求: 1.1, 2.2, 3.2, 5.5, 6.1, 7.4_

  - [x] 1.2 新增错误码定义
    - 在 `packages/shared/src/errors.ts` 中新增错误码：
      - `CODE_PRODUCT_NOT_CARTABLE`、`PRODUCT_UNAVAILABLE`、`CART_FULL`
      - `INVALID_PHONE`、`INVALID_RECIPIENT_NAME`、`INVALID_DETAIL_ADDRESS`、`ADDRESS_LIMIT_REACHED`
      - `ADDRESS_NOT_FOUND`、`NO_ADDRESS_SELECTED`
      - `INVALID_STATUS_TRANSITION`、`TRACKING_NUMBER_REQUIRED`
      - `ORDER_NOT_FOUND`、`CART_ITEM_NOT_FOUND`
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 1.3, 1.4, 1.5, 3.3, 3.4, 3.5, 3.9, 4.10, 5.4, 7.5, 7.6_

  - [ ]* 1.3 编写购物车积分总计属性测试
    - **Property 3: 购物车积分总计正确性**
    - 使用 fast-check 生成随机购物车项列表（随机 pointsCost 和 quantity），验证 `calculateCartTotal` 返回值等于所有项 `pointsCost × quantity` 之和
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 2.2, 2.3**

  - [ ]* 1.4 编写手机号遮蔽属性测试
    - **Property 14: 手机号遮蔽规则**
    - 使用 fast-check 生成随机 11 位手机号（以 1 开头），验证 `maskPhone` 返回前 3 位 + `****` + 后 4 位，且前后一致
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 5.5**

  - [ ]* 1.5 编写物流状态单向流转属性测试
    - **Property 15: 物流状态单向流转**
    - 使用 fast-check 生成随机当前状态索引和目标状态索引，验证 `validateStatusTransition` 仅当目标是当前的直接后继时返回 valid
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 7.4, 7.5**

- [x] 2. CDK 基础设施扩展
  - [x] 2.1 新增 DynamoDB 表定义
    - 在 `packages/cdk/lib/database-stack.ts` 中新增三张表：
      - `Cart` 表：PK = `userId`（String）
      - `Addresses` 表：PK = `addressId`（String），GSI `userId-index`（PK = userId）
      - `Orders` 表：PK = `orderId`（String），GSI `userId-createdAt-index`（PK = userId, SK = createdAt）、GSI `shippingStatus-createdAt-index`（PK = shippingStatus, SK = createdAt）
    - 导出三张表的公共属性供 ApiStack 引用
    - _需求: 1.1, 3.2, 4.5_

  - [x] 2.2 新增 Lambda 函数和 API 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 更新 `ApiStackProps` 接口新增 `cartTable`、`addressesTable`、`ordersTable` 属性
      - 新增 `CartFunction` Lambda（入口 `cart/handler.ts`），授予 Cart、Addresses、Products 表读写权限
      - 新增 `OrderFunction` Lambda（入口 `orders/handler.ts`），授予 Orders、Cart、Users、Products、PointsRecords 表读写权限
      - 新增购物车 API 路由：GET `/api/cart`、POST `/api/cart/items`、PUT `/api/cart/items/{productId}`、DELETE `/api/cart/items/{productId}`
      - 新增地址 API 路由：GET `/api/addresses`、POST `/api/addresses`、PUT `/api/addresses/{addressId}`、DELETE `/api/addresses/{addressId}`、PATCH `/api/addresses/{addressId}/default`
      - 新增订单 API 路由：POST `/api/orders`、POST `/api/orders/direct`、GET `/api/orders`、GET `/api/orders/{orderId}`
      - 新增管理端订单路由：GET `/api/admin/orders`、GET `/api/admin/orders/stats`、GET `/api/admin/orders/{orderId}`、PATCH `/api/admin/orders/{orderId}/shipping`
    - 更新 CDK 入口文件传递新表引用
    - _需求: 1.1, 3.2, 4.1, 5.1, 7.1_

- [x] 3. 检查点 - 基础设施验证
  - 确保 CDK 代码编译通过，新增表和 Lambda 定义正确。如有问题请向用户确认。

- [x] 4. 后端购物车服务实现
  - [x] 4.1 实现购物车核心逻辑
    - 创建 `packages/backend/src/cart/cart.ts`
    - 实现以下函数：
      - `addToCart(userId, productId, dynamoClient, cartTable, productsTable)`：校验商品类型（拒绝 code_exclusive）、状态（拒绝 inactive/零库存）、购物车上限（20 种），通过后添加或递增数量
      - `getCart(userId, dynamoClient, cartTable, productsTable)`：获取购物车并关联商品信息，计算 subtotal、available 标记和 totalPoints
      - `updateCartItem(userId, productId, quantity, dynamoClient, cartTable)`：更新数量，quantity=0 时删除该项
      - `deleteCartItem(userId, productId, dynamoClient, cartTable)`：删除购物车项
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4.2 创建购物车 Lambda Handler
    - 创建 `packages/backend/src/cart/handler.ts`
    - 实现路由分发：GET `/api/cart`、POST `/api/cart/items`、PUT `/api/cart/items/{productId}`、DELETE `/api/cart/items/{productId}`
    - 所有路由需 JWT 认证（复用现有 auth-middleware）
    - 同时处理地址相关路由（见任务 5.2）
    - _需求: 1.1, 2.1_

  - [ ]* 4.3 编写添加商品递增数量属性测试
    - **Property 1: 添加商品到购物车递增数量**
    - 使用 fast-check 生成随机用户和随机购物车状态，验证添加商品后数量等于添加前 + 1
    - 在 `packages/backend/src/cart/cart.property.test.ts` 中创建测试
    - **验证: 需求 1.1, 1.2**

  - [ ]* 4.4 编写拒绝无效商品属性测试
    - **Property 2: 拒绝无效商品加入购物车**
    - 使用 fast-check 生成随机 code_exclusive/inactive/零库存商品，验证添加被拒绝且购物车不变
    - 在 `packages/backend/src/cart/cart.property.test.ts` 中添加测试
    - **验证: 需求 1.3, 1.4**

  - [ ]* 4.5 编写数量为零移除属性测试
    - **Property 4: 数量为零时移除购物车项**
    - 使用 fast-check 生成随机购物车，将某项数量设为 0，验证该项被移除且总数减 1
    - 在 `packages/backend/src/cart/cart.property.test.ts` 中添加测试
    - **验证: 需求 2.4**

  - [ ]* 4.6 编写商品可用性检查属性测试
    - **Property 5: 购物车商品可用性检查**
    - 使用 fast-check 生成随机购物车项和随机商品状态/库存组合，验证 available 标记正确
    - 在 `packages/backend/src/cart/cart.property.test.ts` 中添加测试
    - **验证: 需求 2.5**

- [x] 5. 后端收货地址服务实现
  - [x] 5.1 实现收货地址核心逻辑
    - 创建 `packages/backend/src/cart/address.ts`
    - 实现以下函数：
      - `createAddress(userId, data, dynamoClient, addressesTable)`：校验输入（手机号 `^1\d{10}$`、姓名 1-20 字符、地址 1-200 字符）、检查上限（10 个）、创建地址记录
      - `getAddresses(userId, dynamoClient, addressesTable)`：查询用户所有地址，默认地址排在最前
      - `updateAddress(addressId, userId, data, dynamoClient, addressesTable)`：校验输入并更新地址
      - `deleteAddress(addressId, userId, dynamoClient, addressesTable)`：删除地址
      - `setDefaultAddress(addressId, userId, dynamoClient, addressesTable)`：设为默认，取消之前的默认地址
    - _需求: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11_

  - [x] 5.2 在购物车 Handler 中添加地址路由
    - 在 `packages/backend/src/cart/handler.ts` 中添加地址路由分发：
      - GET `/api/addresses`、POST `/api/addresses`、PUT `/api/addresses/{addressId}`、DELETE `/api/addresses/{addressId}`、PATCH `/api/addresses/{addressId}/default`
    - 所有路由需 JWT 认证
    - _需求: 3.1, 3.2_

  - [ ]* 5.3 编写地址 CRUD 往返一致性属性测试
    - **Property 6: 收货地址 CRUD 往返一致性**
    - 使用 fast-check 生成随机有效地址数据，验证创建后查询返回相同数据、编辑后返回更新数据、删除后不再返回
    - 在 `packages/backend/src/cart/address.property.test.ts` 中创建测试
    - **验证: 需求 3.2, 3.6, 3.7**

  - [ ]* 5.4 编写地址输入验证属性测试
    - **Property 7: 收货地址输入验证**
    - 使用 fast-check 生成随机无效手机号/姓名/地址，验证创建或编辑被拒绝并返回对应错误
    - 在 `packages/backend/src/cart/address.property.test.ts` 中添加测试
    - **验证: 需求 3.3, 3.4, 3.5**

  - [ ]* 5.5 编写默认地址唯一性属性测试
    - **Property 8: 默认地址唯一性不变量**
    - 使用 fast-check 生成随机多个地址并随机设置默认，验证任意时刻最多一个 isDefault 为 true
    - 在 `packages/backend/src/cart/address.property.test.ts` 中添加测试
    - **验证: 需求 3.8**

  - [ ]* 5.6 编写默认地址排序优先属性测试
    - **Property 9: 默认地址排序优先**
    - 使用 fast-check 生成随机地址列表（含一个默认），验证查询结果中默认地址排在第一位
    - 在 `packages/backend/src/cart/address.property.test.ts` 中添加测试
    - **验证: 需求 3.11**

- [x] 6. 检查点 - 购物车与地址服务验证
  - 运行购物车和地址相关所有测试，确保 CRUD 逻辑和验证规则正确。如有问题请向用户确认。

- [x] 7. 后端订单服务实现
  - [x] 7.1 实现订单创建逻辑
    - 创建 `packages/backend/src/orders/order.ts`
    - 实现 `createOrder(userId, items, addressId, dynamoClient, tables)` 函数：
      - 校验地址存在、商品状态和库存、用户积分余额和兑换权限
      - 使用 DynamoDB TransactWriteItems 原子性执行：扣积分、减库存、创建订单、写积分记录
      - 成功后删除购物车中已兑换商品
      - 订单初始 shippingStatus 为 `pending`，shippingEvents 包含初始事件
    - 实现 `createDirectOrder(userId, productId, quantity, addressId, dynamoClient, tables)` 函数：
      - 单件商品直接下单，逻辑与批量下单一致
    - _需求: 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10, 4.11, 6.2, 8.2, 8.4_

  - [x] 7.2 实现订单查询逻辑
    - 在 `packages/backend/src/orders/order.ts` 中新增：
      - `getOrders(userId, page, pageSize, dynamoClient, ordersTable)`：按 createdAt 倒序分页查询用户订单
      - `getOrderDetail(orderId, userId, dynamoClient, ordersTable)`：查询订单详情，校验订单归属
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.3 实现管理端订单管理逻辑
    - 创建 `packages/backend/src/orders/admin-order.ts`
    - 实现以下函数：
      - `getAdminOrders(status, page, pageSize, dynamoClient, ordersTable)`：按状态筛选订单列表
      - `getAdminOrderDetail(orderId, dynamoClient, ordersTable)`：管理端查看订单详情
      - `updateShipping(orderId, status, trackingNumber, remark, operatorId, dynamoClient, ordersTable)`：校验状态流转合法性，shipped 时要求 trackingNumber，追加 shippingEvent
      - `getOrderStats(dynamoClient, ordersTable)`：统计各状态订单数量
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 7.4 创建订单 Lambda Handler
    - 创建 `packages/backend/src/orders/handler.ts`
    - 实现路由分发：
      - 用户端：POST `/api/orders`、POST `/api/orders/direct`、GET `/api/orders`、GET `/api/orders/{orderId}`
      - 管理端：GET `/api/admin/orders`、GET `/api/admin/orders/stats`、GET `/api/admin/orders/{orderId}`、PATCH `/api/admin/orders/{orderId}/shipping`
    - 用户端路由需 JWT 认证，管理端路由需 JWT + Admin 权限校验
    - _需求: 4.1, 5.1, 7.1_

  - [ ]* 7.5 编写订单创建成功流程属性测试
    - **Property 10: 订单创建成功流程**
    - 使用 fast-check 生成随机用户（积分充足）和随机商品集合（库存充足），验证下单后积分减少、库存减少、订单记录正确、初始状态为 pending、生成积分记录
    - 在 `packages/backend/src/orders/order.property.test.ts` 中创建测试
    - **验证: 需求 4.2, 4.3, 4.4, 4.5, 6.2**

  - [ ]* 7.6 编写订单创建失败状态不变属性测试
    - **Property 11: 订单创建失败时状态不变**
    - 使用 fast-check 生成随机失败场景（积分不足/库存不足/角色不匹配），验证积分和库存不变、无订单或积分记录生成
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 4.8, 4.9, 4.11**

  - [ ]* 7.7 编写订单创建后购物车清理属性测试
    - **Property 12: 订单创建后购物车清理**
    - 使用 fast-check 生成随机购物车（部分选中），验证成功下单后已兑换商品被移除、未选中商品保留
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 4.6**

  - [ ]* 7.8 编写订单列表排序属性测试
    - **Property 13: 订单列表排序与完整性**
    - 使用 fast-check 生成随机订单集合（随机创建时间），验证列表按 createdAt 倒序排列且包含必要字段
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 5.1, 5.2**

  - [ ]* 7.9 编写物流事件记录完整性属性测试
    - **Property 16: 物流事件记录完整性**
    - 使用 fast-check 生成随机订单和合法状态变更，验证 shippingEvents 追加一条记录且长度增加 1
    - 在 `packages/backend/src/orders/admin-order.property.test.ts` 中创建测试
    - **验证: 需求 6.4, 7.3**

  - [ ]* 7.10 编写管理端订单状态筛选属性测试
    - **Property 17: 管理端订单状态筛选正确性**
    - 使用 fast-check 生成随机订单集合（混合状态）和随机筛选条件，验证返回的每个订单 shippingStatus 与筛选条件一致
    - 在 `packages/backend/src/orders/admin-order.property.test.ts` 中添加测试
    - **验证: 需求 7.1**

  - [ ]* 7.11 编写订单统计准确性属性测试
    - **Property 18: 订单统计准确性**
    - 使用 fast-check 生成随机订单集合（混合状态），验证各状态数量之和等于总数且每个状态数量正确
    - 在 `packages/backend/src/orders/admin-order.property.test.ts` 中添加测试
    - **验证: 需求 7.7**

  - [ ]* 7.12 编写直接下单格式一致性属性测试
    - **Property 19: 直接下单与购物车下单格式一致**
    - 使用 fast-check 生成随机单件商品，验证直接下单生成的订单数据结构与购物车下单格式完全一致
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 8.2, 8.4**

- [x] 8. 检查点 - 订单服务验证
  - 运行订单相关所有测试，确保创建、查询、物流状态管理和管理端功能正确。如有问题请向用户确认。

- [x] 9. 前端购物车页面
  - [x] 9.1 创建购物车页面
    - 创建 `packages/frontend/src/pages/cart/index.tsx` 和 `packages/frontend/src/pages/cart/index.scss`
    - 页面功能：
      - 展示购物车商品列表（名称、图片、积分、数量、小计）
      - 每项支持勾选框选择、数量增减、删除操作
      - 底部展示选中商品积分总计和"立即兑换"按钮
      - 不可兑换商品（下架/库存不足）标记为灰色并提示
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/cart/index` 路由
    - _需求: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 9.2 在商品详情页添加"加入购物车"按钮
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - 对积分商品（type = 'points'）同时展示"立即兑换"和"加入购物车"两个按钮
      - Code 专属商品仅展示原有兑换流程，不显示"加入购物车"
      - "加入购物车"调用 POST `/api/cart/items`，成功后提示"已加入购物车"
    - _需求: 1.1, 1.3, 8.1_

- [x] 10. 前端收货地址管理
  - [x] 10.1 创建收货地址管理页面
    - 创建 `packages/frontend/src/pages/address/index.tsx` 和 `packages/frontend/src/pages/address/index.scss`
    - 页面功能：
      - 展示用户所有收货地址列表，默认地址排在最前并以醒目标识显示
      - 支持添加、编辑、删除地址操作
      - 添加/编辑表单包含收件人姓名、手机号、详细地址三个必填字段
      - 支持设置默认地址
      - 前端输入校验（手机号格式、姓名长度、地址长度）
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/address/index` 路由
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 10.2 在个人中心添加收货地址入口
    - 在 `packages/frontend/src/pages/profile/index.tsx` 的快捷操作区域添加"收货地址"按钮
    - 点击跳转到收货地址管理页面
    - _需求: 3.1_

- [x] 11. 前端订单确认与下单页面
  - [x] 11.1 创建订单确认页面
    - 创建 `packages/frontend/src/pages/order-confirm/index.tsx` 和 `packages/frontend/src/pages/order-confirm/index.scss`
    - 页面功能：
      - 展示选中商品列表和积分总计
      - 收货地址选择区域：展示已保存地址列表（默认地址排最前），支持选择和新增地址
      - "确认兑换"按钮，提交后调用 POST `/api/orders` 或 POST `/api/orders/direct`
      - 成功后跳转订单详情页
      - 错误处理：积分不足、库存不足、未选地址等提示
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/order-confirm/index` 路由
    - _需求: 4.1, 4.2, 4.7, 4.8, 4.9, 4.10, 3.10, 3.11, 3.12, 8.2_

  - [x] 11.2 更新商品详情页"立即兑换"流程
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - "立即兑换"按钮跳转到订单确认页面（携带 productId 和 quantity=1 参数）
      - 订单确认页根据参数判断是直接下单还是购物车下单
    - _需求: 8.1, 8.2_

- [x] 12. 前端订单列表与详情页面
  - [x] 12.1 创建订单列表页面
    - 创建 `packages/frontend/src/pages/orders/index.tsx` 和 `packages/frontend/src/pages/orders/index.scss`
    - 页面功能：
      - 展示用户订单列表（订单编号、创建时间、商品数量、积分总计、物流状态）
      - 按创建时间倒序排列
      - 分页加载（每页 10 条）
      - 不同物流状态以不同颜色/图标区分
      - 点击订单跳转详情页
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/orders/index` 路由
    - _需求: 5.1, 5.2, 5.3, 6.5_

  - [x] 12.2 创建订单详情页面
    - 创建 `packages/frontend/src/pages/order-detail/index.tsx` 和 `packages/frontend/src/pages/order-detail/index.scss`
    - 页面功能：
      - 展示商品列表（名称、图片、数量、积分）
      - 展示收货信息（收件人、手机号中间四位遮蔽、地址）
      - 展示积分总计
      - 展示物流状态时间线（每条记录含状态、时间、备注）
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/order-detail/index` 路由
    - _需求: 5.4, 5.5, 6.3_

  - [x] 12.3 在个人中心添加订单入口
    - 在 `packages/frontend/src/pages/profile/index.tsx` 的快捷操作区域添加"我的订单"按钮
    - 点击跳转到订单列表页面
    - _需求: 5.1_

- [x] 13. 前端管理端订单管理页面
  - [x] 13.1 创建管理端订单管理页面
    - 创建 `packages/frontend/src/pages/admin/orders.tsx` 和 `packages/frontend/src/pages/admin/orders.scss`
    - 页面功能：
      - 订单列表展示，支持按物流状态筛选（全部/待发货/已发货/运输中/已签收）
      - 订单统计卡片（各状态数量）
      - 点击订单展开详情（商品列表、收货信息、物流时间线）
      - 更新物流状态操作：选择目标状态、填写物流单号（发货时必填）和备注
      - 状态流转校验（仅允许前进到下一状态）
    - 在 `packages/frontend/src/app.config.ts` 中注册 `pages/admin/orders` 路由
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 13.2 在管理面板首页添加订单管理入口
    - 在 `packages/frontend/src/pages/admin/index.tsx` 中添加"订单管理"导航卡片
    - 点击跳转到管理端订单管理页面
    - _需求: 7.1_

- [x] 14. 检查点 - 前端页面验证
  - 确保所有新增前端页面编译通过，路由注册正确，页面间跳转逻辑完整。如有问题请向用户确认。

- [x] 15. 集成联调与最终验证
  - [x] 15.1 更新前端 Store 添加购物车和订单方法
    - 在 `packages/frontend/src/store/index.ts` 中新增：
      - 购物车相关方法：`addToCart`、`getCart`、`updateCartItem`、`deleteCartItem`
      - 地址相关方法：`getAddresses`、`createAddress`、`updateAddress`、`deleteAddress`、`setDefaultAddress`
      - 订单相关方法：`createOrder`、`createDirectOrder`、`getOrders`、`getOrderDetail`
    - _需求: 1.1, 3.2, 4.1, 5.1_

  - [x] 15.2 更新 CDK 入口文件串联所有栈
    - 在 `packages/cdk/src/index.ts` 中将 DatabaseStack 新增的三张表传递给 ApiStack
    - _需求: 1.1, 3.2, 4.1_

- [x] 16. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 本次新增 3 张 DynamoDB 表（Cart、Addresses、Orders）和 2 个 Lambda 函数（Cart+Address、Order）
- 属性测试验证设计文档中定义的 19 个正确性属性
- 购物车批量兑换使用 DynamoDB TransactWriteItems 保证原子性（最多 23 个操作，在 100 上限内）
- 物流状态流转在应用层校验，仅支持单向前进（pending → shipped → in_transit → delivered）
- 手机号遮蔽在前端展示层处理，后端存储完整手机号
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
