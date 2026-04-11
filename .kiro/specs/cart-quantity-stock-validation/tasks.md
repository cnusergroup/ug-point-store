# 实现计划：购物车数量选择与库存校验

## 概述

在现有购物车系统基础上扩展数量选择功能，并在加购、更新购物车、下单三个环节实施库存校验。涉及共享错误码新增、后端 `addToCart`/`updateCartItem` 函数签名变更与库存校验逻辑、Handler 层参数解析、前端商品详情页数量选择器和购物车页面库存上限控制。

## 任务

- [x] 1. 共享错误码扩展
  - [x] 1.1 新增 QUANTITY_EXCEEDS_STOCK 和 INVALID_QUANTITY 错误码
    - 在 `packages/shared/src/errors.ts` 的 `ErrorCodes` 中新增：
      - `QUANTITY_EXCEEDS_STOCK: 'QUANTITY_EXCEEDS_STOCK'`
      - `INVALID_QUANTITY: 'INVALID_QUANTITY'`
    - 在 `ErrorHttpStatus` 中添加对应映射（均为 400）
    - 在 `ErrorMessages` 中添加对应消息：
      - `QUANTITY_EXCEEDS_STOCK`: `'数量超过库存'`
      - `INVALID_QUANTITY`: `'数量必须为正整数'`
    - _需求: 2.3, 3.2, 6.2_

- [x] 2. 后端 addToCart 函数扩展
  - [x] 2.1 修改 addToCart 签名并实现数量参数与库存校验
    - 在 `packages/backend/src/cart/cart.ts` 中：
      - 在 `addToCart` 函数签名中 `productId` 之后新增 `quantity: number` 参数（其余参数后移）
      - 在现有尺码校验之后、获取购物车之前新增校验：`quantity` 必须为正整数（`Number.isInteger(quantity) && quantity >= 1`），否则返回 `INVALID_QUANTITY`
      - 计算 `effectiveStock`：有尺码时取 `sizeOption.stock`，否则取 `product.stock`
      - 获取购物车后，计算 `cartExistingQty`（同 productId + selectedSize 的已有数量）
      - 校验 `cartExistingQty + quantity <= effectiveStock`，不满足返回 `QUANTITY_EXCEEDS_STOCK`（消息含剩余库存和已有数量）
      - 已有商品时 `items[i].quantity += quantity`（替换原来的 `+= 1`）
      - 新增商品时 `quantity` 字段使用传入值（替换原来的固定 `1`）
      - 限购校验中 `historicalCount + cartQuantity + quantity > purchaseLimitCount`（替换原来的 `+ 1`）
    - _需求: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 编写加购库存校验属性测试
    - **Property 1: 加购库存校验不变量**
    - 使用 fast-check 生成随机有效库存 S (1~100)、随机购物车已有数量 E (0~S)、随机请求数量 N (1~200)
    - 验证：E + N ≤ S 时 addToCart 成功；E + N > S 时返回 `QUANTITY_EXCEEDS_STOCK`
    - 在 `packages/backend/src/cart/cart-stock-validation.property.test.ts` 中创建测试
    - **验证: 需求 3.1, 3.2**

  - [x] 2.3 编写加购后数量正确累加属性测试
    - **Property 2: 加购后数量正确累加**
    - 使用 fast-check 生成随机正整数 N，验证：已有商品时加购后数量为 E + N；无该商品时加购后数量为 N
    - 在 `packages/backend/src/cart/cart-stock-validation.property.test.ts` 中添加测试
    - **验证: 需求 3.3, 3.4**

  - [x] 2.4 编写非正整数数量被拒绝属性测试
    - **Property 3: 非正整数数量被拒绝**
    - 使用 fast-check 生成随机非正整数值（0、负数、小数），验证 addToCart 返回 `INVALID_QUANTITY`
    - 在 `packages/backend/src/cart/cart-stock-validation.property.test.ts` 中添加测试
    - **验证: 需求 2.3**

- [x] 3. 后端 updateCartItem 函数扩展
  - [x] 3.1 修改 updateCartItem 签名并实现库存校验
    - 在 `packages/backend/src/cart/cart.ts` 中：
      - 在 `updateCartItem` 函数签名末尾新增可选参数 `productsTable?: string`
      - 当 `productsTable` 提供且 `quantity > 0` 时：
        - 查询商品信息，计算 `effectiveStock`（根据购物车项的 `selectedSize`）
        - 校验 `quantity <= effectiveStock`，不满足返回 `QUANTITY_EXCEEDS_STOCK`（消息含当前库存）
    - _需求: 6.1, 6.2_

  - [x] 3.2 编写更新购物车数量时的库存校验属性测试
    - **Property 4: 更新购物车数量时的库存校验**
    - 使用 fast-check 生成随机有效库存 S 和随机新数量 Q
    - 验证：Q > S 时返回 `QUANTITY_EXCEEDS_STOCK`；1 ≤ Q ≤ S 时成功
    - 在 `packages/backend/src/cart/cart-stock-validation.property.test.ts` 中添加测试
    - **验证: 需求 6.1, 6.2**

- [x] 4. 后端 Handler 层变更
  - [x] 4.1 更新 cart handler 解析 quantity 参数
    - 在 `packages/backend/src/cart/handler.ts` 中：
      - `handleAddToCart`：从请求体解析 `quantity`（缺省默认 1），传递给 `addToCart`（注意参数顺序变更）
      - `handleUpdateCartItem`：调用 `updateCartItem` 时传递 `PRODUCTS_TABLE` 参数
    - _需求: 2.1, 2.2, 6.1_

  - [x] 4.2 扩展 handler 单元测试
    - 在 `packages/backend/src/cart/handler.test.ts` 中新增测试用例：
      - POST /api/cart/items 传递 quantity 参数时正确传递给 addToCart
      - POST /api/cart/items 不传 quantity 时默认为 1
      - PUT /api/cart/items/{productId} 传递 PRODUCTS_TABLE 给 updateCartItem
    - _需求: 2.1, 2.2_

- [x] 5. 后端 cart.test.ts 单元测试扩展
  - [x] 5.1 扩展 addToCart 单元测试覆盖 quantity 参数
    - 在 `packages/backend/src/cart/cart.test.ts` 中新增测试用例：
      - quantity 缺省默认 1（向后兼容）— 更新现有测试调用签名
      - quantity=3 时新增商品数量为 3
      - quantity=2 时已有商品数量正确累加
      - quantity 恰好等于剩余库存时成功
      - quantity 恰好超过剩余库存 1 时返回 QUANTITY_EXCEEDS_STOCK
      - quantity 为 0/负数/小数时返回 INVALID_QUANTITY
      - 尺码商品按尺码独立校验库存
    - _需求: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 5.2 扩展 updateCartItem 单元测试覆盖库存校验
    - 在 `packages/backend/src/cart/cart.test.ts` 中新增测试用例：
      - 传递 productsTable 时校验数量不超过库存
      - 数量超过库存时返回 QUANTITY_EXCEEDS_STOCK
      - 不传 productsTable 时跳过库存校验（向后兼容）
    - _需求: 6.1, 6.2_

- [x] 6. 检查点 - 后端逻辑验证
  - 运行所有购物车相关测试，确保 addToCart 和 updateCartItem 的库存校验逻辑正确。如有问题请向用户确认。

- [x] 7. 前端商品详情页数量选择器
  - [x] 7.1 在商品详情页实现数量选择器 UI
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - 新增 `quantity` 状态（默认 1）
      - 计算 `maxQuantity = min(effectiveStock, purchaseLimitRemaining)`（未启用限购时为 effectiveStock）
      - 在加入购物车按钮上方渲染数量选择器：减少按钮、数量显示、增加按钮
      - 减少按钮：quantity=1 时禁用
      - 增加按钮：quantity=maxQuantity 时禁用并显示"已达库存上限"提示
      - 库存为 0 时隐藏数量选择器，加入购物车按钮显示"已售罄"
      - 切换尺码时重置 quantity 为 1
    - 在 `packages/frontend/src/pages/product/index.scss` 中添加数量选择器样式（使用 CSS 变量）
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 7.2 更新 addToCart 调用传递 quantity
    - 在 `packages/frontend/src/pages/product/index.tsx` 的 `handleAddToCart` 中：
      - 请求体新增 `quantity` 字段
    - 在 `packages/frontend/src/store/index.ts` 中：
      - `addToCart` 方法签名扩展为 `addToCart(productId, quantity?, selectedSize?)`
      - 请求体中包含 `quantity: quantity ?? 1`
    - _需求: 2.1_

  - [x] 7.3 加购失败时显示库存不足 Toast 提示
    - 在 `packages/frontend/src/pages/product/index.tsx` 的 `handleAddToCart` catch 中：
      - 解析后端返回的错误消息，显示包含具体库存剩余数量的 Toast
      - 并发冲突时显示"库存已变动，请刷新页面重试"
    - _需求: 7.1, 7.3_

- [x] 8. 前端购物车页面库存上限控制
  - [x] 8.1 购物车页面数量控制增加库存上限
    - 在 `packages/frontend/src/pages/cart/index.tsx` 的 `handleQuantityChange` 中：
      - 增加上限校验：`newQty > item.stock` 时阻止操作
      - 增加按钮在 `quantity >= stock` 时禁用
    - _需求: 6.3_

  - [x] 8.2 下单失败时显示库存不足错误提示
    - 在 `packages/frontend/src/pages/order-confirm/index.tsx` 中：
      - 捕获 `OUT_OF_STOCK` 错误，显示提示并引导用户返回购物车调整数量
    - _需求: 7.2_

- [x] 9. 检查点 - 前端验证
  - 确保所有前端页面编译通过，数量选择器交互正确，库存校验错误提示完整。如有问题请向用户确认。

- [x] 10. 购物车详情包含当前库存验证
  - [x] 10.1 编写购物车详情包含当前库存属性测试
    - **Property 6: 购物车详情包含当前库存**
    - 使用 fast-check 生成随机商品库存值，验证 `getCart` 返回的 `CartItemDetail.stock` 等于 Products 表中的当前库存
    - 在 `packages/backend/src/cart/cart-stock-validation.property.test.ts` 中添加测试
    - **验证: 需求 6.3**

- [x] 11. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端库存校验逻辑完整。如有问题请向用户确认。

## 备注

- 下单时的库存校验（需求 4、5）已在现有 `createOrder` 函数中实现（ConditionExpression + TransactWriteItems），无需修改
- `addToCart` 函数签名变更后需同步更新所有调用方（handler.ts、cart.test.ts、handler.test.ts）
- `quantity` 缺省默认为 1，确保向后兼容
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 前端样式使用 CSS 变量，遵循现有设计系统规范
- 属性测试使用 fast-check 库，每个属性至少运行 100 次迭代
