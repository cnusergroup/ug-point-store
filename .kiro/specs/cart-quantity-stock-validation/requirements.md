# 需求文档：购物车数量选择与库存校验

## 简介

当用户在商品详情页将商品加入购物车时，支持自定义选择数量（而非固定为 1），并在加购和下单两个环节对库存进行严格校验。同时，通过 DynamoDB 条件表达式实现乐观锁，防止多用户并发操作导致超卖。

## 术语表

- **数量选择器（Quantity_Selector）**：商品详情页中用于选择加购数量的 UI 组件，包含加减按钮和数量输入框
- **库存校验服务（Stock_Validator）**：后端负责校验请求数量是否超过可用库存的逻辑模块
- **购物车服务（Cart_Service）**：后端处理购物车增删改查的业务逻辑（`packages/backend/src/cart/cart.ts`）
- **订单服务（Order_Service）**：后端处理订单创建的业务逻辑（`packages/backend/src/orders/order.ts`）
- **商品详情页（Product_Detail_Page）**：前端商品详情页面（`packages/frontend/src/pages/product/index.tsx`）
- **有效库存（Effective_Stock）**：当商品有尺码选项时为所选尺码的库存，否则为商品总库存
- **乐观锁（Optimistic_Lock）**：使用 DynamoDB ConditionExpression 在写入时校验库存条件，若条件不满足则写入失败并返回错误

## 需求

### 需求 1：前端数量选择器

**用户故事：** 作为用户，我希望在商品详情页加购时能选择数量，以便一次性加入多件相同商品。

#### 验收标准

1. WHEN 商品详情页加载完成且商品有库存, THE 数量选择器 SHALL 显示在加入购物车按钮上方，默认数量为 1
2. WHEN 用户点击增加按钮, THE 数量选择器 SHALL 将数量加 1，且数量上限为有效库存值
3. WHEN 用户点击减少按钮, THE 数量选择器 SHALL 将数量减 1，且数量下限为 1
4. WHILE 当前数量等于 1, THE 数量选择器 SHALL 禁用减少按钮
5. WHILE 当前数量等于有效库存, THE 数量选择器 SHALL 禁用增加按钮并显示"已达库存上限"提示
6. WHEN 商品启用了限购且限购剩余数量小于有效库存, THE 数量选择器 SHALL 将数量上限设为限购剩余数量
7. WHEN 用户切换尺码选项, THE 数量选择器 SHALL 重置数量为 1 并根据新尺码的库存更新上限
8. WHILE 商品库存为 0 或商品已售罄, THE 数量选择器 SHALL 隐藏，加入购物车按钮显示"已售罄"

### 需求 2：加购时传递数量参数

**用户故事：** 作为用户，我希望加入购物车时系统按我选择的数量添加，而非固定添加 1 件。

#### 验收标准

1. WHEN 用户点击加入购物车按钮, THE 商品详情页 SHALL 将 productId、quantity 和 selectedSize（如有）发送至 `POST /api/cart/items` 接口
2. WHEN 请求体中未包含 quantity 字段, THE 购物车服务 SHALL 默认 quantity 为 1（向后兼容）
3. WHEN 请求体中 quantity 不是正整数, THE 购物车服务 SHALL 返回 INVALID_REQUEST 错误码和"数量必须为正整数"消息

### 需求 3：加购时后端库存校验

**用户故事：** 作为系统运营者，我希望加购时校验库存，防止用户加入超过库存的数量。

#### 验收标准

1. WHEN 用户请求加购数量 N, THE 库存校验服务 SHALL 校验：该商品在购物车中的已有数量 + N 不超过有效库存
2. IF 请求加购数量 + 购物车已有数量超过有效库存, THEN THE 购物车服务 SHALL 返回 QUANTITY_EXCEEDS_STOCK 错误码和"加购数量超过库存，当前库存剩余 X 件，购物车已有 Y 件"消息
3. WHEN 商品已在购物车中（相同 productId + selectedSize）, THE 购物车服务 SHALL 将已有数量增加 N（而非固定增加 1）
4. WHEN 商品不在购物车中, THE 购物车服务 SHALL 以数量 N 新增购物车项

### 需求 4：下单时后端库存校验（二次校验）

**用户故事：** 作为系统运营者，我希望在创建订单时再次校验库存，防止加购后到下单前库存已被其他用户消耗。

#### 验收标准

1. WHEN 用户提交订单, THE 订单服务 SHALL 对每个订单项重新校验：请求数量不超过当前有效库存
2. IF 下单时某商品库存不足, THEN THE 订单服务 SHALL 返回 OUT_OF_STOCK 错误码和"商品 {商品名} 库存不足，当前库存 X 件"消息
3. THE 订单服务 SHALL 在 DynamoDB 事务中使用 ConditionExpression 确保扣减库存时库存值大于等于扣减数量

### 需求 5：并发库存扣减（乐观锁）

**用户故事：** 作为系统运营者，我希望多用户同时购买同一商品时不会出现超卖。

#### 验收标准

1. WHEN 订单服务扣减商品库存, THE 订单服务 SHALL 使用 DynamoDB ConditionExpression `stock >= :deductQty` 确保原子性
2. WHEN 商品有尺码选项, THE 订单服务 SHALL 同时使用 ConditionExpression 校验对应尺码的库存 `sizeOptions[i].stock >= :deductQty`
3. IF DynamoDB 条件表达式校验失败（ConditionalCheckFailedException）, THEN THE 订单服务 SHALL 返回 OUT_OF_STOCK 错误码和"库存不足，请刷新页面重试"消息
4. THE 订单服务 SHALL 在同一个 DynamoDB TransactWriteItems 事务中完成库存扣减、积分扣减和订单创建

### 需求 6：购物车数量更新时的库存校验

**用户故事：** 作为用户，我希望在购物车页面修改数量时也能得到库存校验反馈。

#### 验收标准

1. WHEN 用户在购物车页面更新商品数量, THE 购物车服务 SHALL 校验新数量不超过该商品的有效库存
2. IF 更新的数量超过有效库存, THEN THE 购物车服务 SHALL 返回 QUANTITY_EXCEEDS_STOCK 错误码和"数量超过库存，当前库存 X 件"消息
3. WHEN 购物车页面加载时, THE 购物车服务 SHALL 在返回的 CartItemDetail 中包含每个商品的当前库存（stock 字段），前端据此限制数量选择上限

### 需求 7：错误提示与用户体验

**用户故事：** 作为用户，我希望在库存不足时收到清晰的错误提示，知道该如何操作。

#### 验收标准

1. WHEN 加购失败因库存不足, THE 商品详情页 SHALL 显示 Toast 提示，内容包含具体的库存剩余数量
2. WHEN 下单失败因库存不足, THE 订单确认页 SHALL 显示错误提示并引导用户返回购物车调整数量
3. IF 并发冲突导致操作失败, THEN THE 商品详情页 SHALL 显示"库存已变动，请刷新页面重试"提示
