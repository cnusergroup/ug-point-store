# 实现计划：兑换记录统一与物流追踪

## 概述

将兑换系统与订单系统打通：修复兑换历史 API 分页格式、在积分兑换和 Code 兑换中增加收货地址校验并自动创建订单、前端增加地址选择器和物流状态展示。涉及共享类型扩展、后端 3 个核心文件重构、CDK 权限变更、前端 2 个页面适配。

## 任务

- [x] 1. 共享类型扩展
  - [x] 1.1 在 `packages/shared/src/types.ts` 中为 `RedemptionRecord` 接口新增 `orderId?: string` 可选字段
    - 在现有 `status` 字段之后、`createdAt` 之前添加
    - _需求: 4.4, 6.1_

- [x] 2. CDK 权限变更
  - [x] 2.1 在 `packages/cdk/lib/api-stack.ts` 中为 Redemption Lambda 新增表权限
    - 添加 `addressesTable.grantReadData(redemptionFn)` 授予 Addresses 表读取权限
    - 添加 `ordersTable.grantReadWriteData(redemptionFn)` 授予 Orders 表读写权限
    - 放在现有 `pointsRecordsTable.grantReadWriteData(redemptionFn)` 之后
    - _需求: 8.1, 8.2, 8.3_

- [x] 3. 检查点 - 类型和基础设施验证
  - 确保共享类型编译通过、CDK 代码无错误。如有问题请向用户确认。

- [x] 4. 后端积分兑换增加地址和订单
  - [x] 4.1 重构 `packages/backend/src/redemptions/points-redemption.ts`
    - 在 `RedeemWithPointsInput` 接口新增 `addressId: string` 字段
    - 在 `RedeemWithPointsResult` 接口新增 `orderId?: string` 字段
    - 在 `RedemptionTableNames` 接口新增 `addressesTable: string` 和 `ordersTable: string` 字段
    - 在现有校验逻辑之后、事务之前新增：
      - 校验 `addressId` 非空，否则返回 `{ code: 'NO_ADDRESS_SELECTED', message: '请选择收货地址' }`
      - 从 Addresses 表读取地址，校验存在且 `userId` 匹配，否则返回 `{ code: 'ADDRESS_NOT_FOUND', message: '收货地址不存在' }`
    - 在事务的 `TransactItems` 数组中新增一个 `Put` 操作写入 Orders 表：
      - `orderId`（ULID）、`userId`、`items`（单件商品）、`totalPoints`（= pointsCost）、`shippingAddress`（从地址记录取）、`shippingStatus: 'pending'`、`shippingEvents`（含初始事件 `{ status: 'pending', remark: '兑换订单已创建' }`）、`source: 'points_redemption'`、`createdAt`、`updatedAt`
    - 在兑换记录的 `Put` 操作中增加 `orderId` 字段
    - 返回结果中增加 `orderId`
    - _需求: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 4.4, 4.5, 4.6_

  - [x]* 4.2 编写积分兑换缺少 addressId 拒绝属性测试
    - **Property 2: 兑换请求缺少 addressId 时被拒绝**
    - 使用 fast-check 生成随机合法积分兑换输入但 `addressId` 为空字符串或 undefined，验证返回 `success: false` 且错误码为 `NO_ADDRESS_SELECTED`
    - 在 `packages/backend/src/redemptions/points-redemption-address.property.test.ts` 中创建测试
    - **验证: 需求 3.1, 3.2**

  - [x]* 4.3 编写积分兑换地址归属校验属性测试
    - **Property 3: 兑换请求的地址归属校验**
    - 使用 fast-check 生成随机用户和不匹配的地址（地址不存在或属于其他用户），验证返回 `success: false` 且错误码为 `ADDRESS_NOT_FOUND`
    - 在 `packages/backend/src/redemptions/points-redemption-address.property.test.ts` 中添加测试
    - **验证: 需求 3.3, 3.4**

  - [x]* 4.4 编写积分兑换成功创建订单属性测试
    - **Property 4: 成功兑换创建正确的订单记录**
    - 使用 fast-check 生成随机合法积分兑换输入（含有效地址），执行兑换后验证 Orders 表中存在对应订单：`shippingStatus` 为 `pending`、`source` 为 `points_redemption`、`totalPoints` 等于商品积分价格、`shippingAddress` 与选择的地址一致
    - 在 `packages/backend/src/redemptions/points-redemption-address.property.test.ts` 中添加测试
    - **验证: 需求 4.1, 4.3, 4.5**

  - [x]* 4.5 编写积分兑换响应包含 orderId 属性测试
    - **Property 5: 兑换记录和响应包含 orderId**
    - 使用 fast-check 生成随机合法积分兑换输入，执行兑换后验证返回结果包含非空 `orderId`，且 Redemptions 表中对应记录也包含相同 `orderId`
    - 在 `packages/backend/src/redemptions/points-redemption-address.property.test.ts` 中添加测试
    - **验证: 需求 4.4, 4.6**

- [x] 5. 后端 Code 兑换增加地址和订单
  - [x] 5.1 重构 `packages/backend/src/redemptions/code-redemption.ts`
    - 在 `RedeemWithCodeInput` 接口新增 `addressId: string` 字段
    - 在 `RedeemWithCodeResult` 接口新增 `orderId?: string` 字段
    - 在 `CodeRedemptionTableNames` 接口新增 `addressesTable: string` 和 `ordersTable: string` 字段
    - 在现有商品校验之后、事务之前新增地址校验逻辑（同 4.1）
    - 在事务的 `TransactItems` 数组中新增 `Put` 操作写入 Orders 表：
      - `totalPoints` 为 0、`source: 'code_redemption'`，其余同 4.1
    - 在兑换记录的 `Put` 操作中增加 `orderId` 字段
    - 返回结果中增加 `orderId`
    - _需求: 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 5.2 编写 Code 兑换缺少 addressId 拒绝属性测试
    - **Property 2: 兑换请求缺少 addressId 时被拒绝（Code 路径）**
    - 使用 fast-check 生成随机合法 Code 兑换输入但 `addressId` 为空/undefined，验证返回 `success: false` 且错误码为 `NO_ADDRESS_SELECTED`
    - 在 `packages/backend/src/redemptions/code-redemption-address.property.test.ts` 中创建测试
    - **验证: 需求 2.1, 2.2**

  - [x]* 5.3 编写 Code 兑换成功创建订单属性测试
    - **Property 4: 成功兑换创建正确的订单记录（Code 路径）**
    - 使用 fast-check 生成随机合法 Code 兑换输入（含有效地址），执行兑换后验证 Orders 表中存在对应订单：`totalPoints` 为 0、`source` 为 `code_redemption`
    - 在 `packages/backend/src/redemptions/code-redemption-address.property.test.ts` 中添加测试
    - **验证: 需求 4.2, 4.5**

- [x] 6. 检查点 - 兑换服务验证
  - 运行积分兑换和 Code 兑换相关所有测试，确保地址校验和订单创建逻辑正确。如有问题请向用户确认。

- [x] 7. 后端 Handler 适配与兑换历史重构
  - [x] 7.1 重构 `packages/backend/src/redemptions/handler.ts`
    - 新增读取环境变量 `ADDRESSES_TABLE` 和 `ORDERS_TABLE`
    - `handleRedeemWithPoints`：从请求体解析 `addressId`，传入 `redeemWithPoints`，成功响应增加 `orderId` 字段
    - `handleRedeemWithCode`：从请求体解析 `addressId`，传入 `redeemWithCode`，成功响应增加 `orderId` 字段
    - `handleGetHistory`：改为解析 `page`/`pageSize` 查询参数（替代 `lastKey`），传入 `ordersTable`，返回 `{ items, total, page, pageSize }` 格式
    - _需求: 1.1, 1.2, 2.1, 3.1, 4.6_

  - [x] 7.2 重构 `packages/backend/src/redemptions/history.ts`
    - 将 `GetRedemptionHistoryOptions` 改为 `{ page?: number; pageSize?: number }`
    - 将 `GetRedemptionHistoryResult` 改为 `{ success, items?, total?, page?, pageSize?, error? }`
    - 函数签名新增 `ordersTable: string` 参数
    - 实现逻辑：
      - 查询 `userId-createdAt-index` GSI 获取全部兑换记录（`ScanIndexForward: false`）
      - 对含 `orderId` 的记录，使用 `BatchGetCommand` 批量查询 Orders 表获取 `shippingStatus`
      - 内存分页：`items = allRecords.slice((page-1)*pageSize, page*pageSize)`
      - 返回 `{ success: true, items, total, page, pageSize }`
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2_

  - [x]* 7.3 编写兑换历史分页响应格式属性测试
    - **Property 1: 兑换历史分页响应格式正确**
    - 使用 fast-check 生成随机兑换记录数组和随机 page/pageSize，验证响应包含 `items`、`total`、`page`、`pageSize` 四个字段，`items` 长度不超过 `pageSize`，`items` 按 `createdAt` 降序排列
    - 在 `packages/backend/src/redemptions/history-pagination.property.test.ts` 中创建测试
    - **验证: 需求 1.1, 1.2, 1.3, 1.5**

  - [x]* 7.4 编写兑换历史包含订单关联信息属性测试
    - **Property 6: 兑换历史包含订单关联信息**
    - 使用 fast-check 生成随机兑换记录（部分含 orderId），模拟 Orders 表数据，验证历史 API 返回的 `shippingStatus` 与 Orders 表中对应订单一致
    - 在 `packages/backend/src/redemptions/history-pagination.property.test.ts` 中添加测试
    - **验证: 需求 6.1, 6.2**

- [x] 8. 检查点 - Handler 和历史 API 验证
  - 运行 handler 和 history 相关所有测试，确保路由分发、分页格式和订单关联信息正确。如有问题请向用户确认。

- [x] 9. 前端兑换页面适配 - 地址选择器
  - [x] 9.1 在 `packages/frontend/src/pages/redeem/index.tsx` 中增加收货地址选择功能
    - 页面加载时调用 `GET /api/addresses` 获取用户地址列表
    - 自动选中 `isDefault: true` 的地址
    - 在积分兑换（mode='points'）和 Code 兑换（mode='code'）确认区域上方展示地址卡片（收件人、手机号、详细地址）
    - 点击地址卡片展开地址选择列表，允许切换地址
    - 无地址时显示"请添加收货地址"提示，提供跳转至 `/pages/address/index` 的入口
    - 未选择地址时禁用"确认兑换"按钮
    - 兑换请求（`handlePointsRedeem` 和 `handleCodeRedeem`）中携带 `addressId`
    - 兑换成功后展示"查看订单"按钮，使用返回的 `orderId` 跳转至 `/pages/order-detail/index?id={orderId}`
    - 更新 `packages/frontend/src/pages/redeem/index.scss` 添加地址选择器相关样式（使用 CSS 变量）
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 2.5, 2.6, 3.5_

- [x] 10. 前端个人中心 - 兑换记录展示适配
  - [x] 10.1 在 `packages/frontend/src/pages/profile/index.tsx` 中更新兑换记录展示
    - `RedemptionRecord` 接口新增 `orderId?: string` 和 `shippingStatus?: string` 字段
    - 兑换记录列表项增加物流状态标签（待发货/已发货/运输中/已签收），使用不同颜色区分
    - 点击含 `orderId` 的兑换记录跳转至 `/pages/order-detail/index?id={orderId}`
    - _需求: 6.1, 6.2, 6.3, 6.4_

- [x] 11. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 兑换事务增加订单写入后，积分兑换事务从 4 项增至 5 项，Code 兑换从 3 项增至 4 项，均远低于 DynamoDB 事务 100 项上限
- 地址校验在事务外执行，与现有 `order.ts` 中 `createOrder` 的模式一致
- 兑换历史改为页码分页后，与现有 `getOrders` 实现保持一致
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 检查点任务用于阶段性验证，确保增量开发的正确性
