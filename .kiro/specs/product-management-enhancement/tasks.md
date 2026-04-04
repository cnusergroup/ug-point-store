# 实现计划：商品管理增强（多图上传、尺码管理、限购设置）

## 概述

在现有积分商城系统基础上为商品管理模块新增三项增强能力：多图上传（S3 预签名 URL 直传）、尺码/规格管理（独立库存）、限购设置（下单+加购双重校验）。涉及共享类型扩展、新增图片上传服务、扩展商品/订单/购物车后端逻辑、CDK 权限更新、前端管理页和详情页改造。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 共享类型与错误码扩展
  - [x] 1.1 扩展 Product、CartItem、OrderItem 类型
    - 在 `packages/shared/src/types.ts` 中：
      - `Product` 接口新增可选字段：`images?: ProductImage[]`、`sizeOptions?: SizeOption[]`、`purchaseLimitEnabled?: boolean`、`purchaseLimitCount?: number`
      - 新增 `ProductImage` 接口：`key: string`、`url: string`
      - 新增 `SizeOption` 接口：`name: string`、`stock: number`
      - `CartItem` 接口新增可选字段：`selectedSize?: string`
      - `OrderItem` 接口新增可选字段：`selectedSize?: string`
    - _需求: 1.3, 3.3, 4.5, 4.6, 5.3_

  - [x] 1.2 新增错误码定义
    - 在 `packages/shared/src/errors.ts` 中新增错误码：
      - `IMAGE_LIMIT_EXCEEDED`、`INVALID_FILE_TYPE`、`IMAGE_NOT_FOUND`
      - `SIZE_OPTIONS_REQUIRED`、`DUPLICATE_SIZE_NAME`、`SIZE_REQUIRED`、`SIZE_NOT_FOUND`、`SIZE_OUT_OF_STOCK`
      - `PURCHASE_LIMIT_INVALID`、`PURCHASE_LIMIT_EXCEEDED`
    - 在 `ErrorHttpStatus` 和 `ErrorMessages` 中添加对应映射
    - _需求: 1.4, 3.5, 3.6, 4.4, 5.4, 5.5, 6.3, 6.6_

- [x] 2. 图片上传服务实现
  - [x] 2.1 实现图片上传核心逻辑
    - 创建 `packages/backend/src/admin/images.ts`
    - 实现 `getUploadUrl(input, currentImageCount, s3Client, bucketName)` 函数：
      - 校验 currentImageCount < 5，否则返回 IMAGE_LIMIT_EXCEEDED 错误
      - 校验文件类型（仅允许 jpg/jpeg/png/webp）
      - 生成 S3 key：`products/{productId}/{ulid}.{ext}`
      - 使用 `@aws-sdk/s3-request-presigner` 生成 PUT 预签名 URL，有效期 5 分钟
      - 返回 uploadUrl、key、CDN 访问路径 `/images/{key}`
    - 实现 `deleteImage(key, s3Client, bucketName)` 函数：
      - 调用 S3 DeleteObject 删除指定 key 的图片
    - _需求: 1.1, 1.2, 1.4, 1.6_

  - [x] 2.2 在 Admin Handler 中添加图片路由
    - 在 `packages/backend/src/admin/handler.ts` 中：
      - 新增 `POST /api/admin/products/{id}/upload-url` 路由，调用 getUploadUrl
      - 新增 `DELETE /api/admin/products/{id}/images/{key}` 路由，调用 deleteImage 并更新商品 images 数组
      - 导入 S3Client，从环境变量读取 IMAGES_BUCKET
    - _需求: 1.1, 1.6_

  - [ ]* 2.3 编写图片 S3 Key 格式属性测试
    - **Property 1: 图片 S3 Key 格式正确**
    - 使用 fast-check 生成随机 productId 和文件名，验证生成的 key 匹配 `^products\/[A-Za-z0-9]+\/[A-Za-z0-9]+\.\w+$` 且包含 productId
    - 在 `packages/backend/src/admin/images.property.test.ts` 中创建测试
    - **验证: 需求 1.2**

  - [ ]* 2.4 编写图片数量上限属性测试
    - **Property 2: 图片数量上限不变量**
    - 使用 fast-check 生成随机 currentImageCount (0-10)，验证 ≥5 时拒绝、<5 时成功
    - 在 `packages/backend/src/admin/images.property.test.ts` 中添加测试
    - **验证: 需求 1.3, 1.4**

- [x] 3. 商品管理服务扩展（尺码、限购、图片字段）
  - [x] 3.1 扩展商品创建/更新逻辑
    - 在 `packages/backend/src/admin/products.ts` 中：
      - 扩展 `CreatePointsProductInput` 和 `CreateCodeExclusiveProductInput` 接口，新增 `images`、`sizeOptions`、`purchaseLimitEnabled`、`purchaseLimitCount` 可选字段
      - 新增 `validateSizeOptions(sizeOptions)` 函数：校验非空、名称不重复
      - 新增 `validatePurchaseLimit(enabled, count)` 函数：启用时 count 必须为正整数
      - 新增 `syncImageUrl(images)` 函数：images 非空时返回 images[0].url，否则返回空字符串
      - 修改 `createPointsProduct` 和 `createCodeExclusiveProduct`：保存新字段，启用尺码时 stock = sum(sizeOptions[].stock)，同步 imageUrl
      - 修改 `updateProduct`：更新时执行相同校验和同步逻辑
    - _需求: 1.3, 1.7, 1.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 3.2 编写 imageUrl 同步属性测试
    - **Property 3: imageUrl 同步不变量**
    - 使用 fast-check 生成随机 images 数组（0-5 张），验证 syncImageUrl 返回值：非空时等于 images[0].url，空时为空字符串
    - 在 `packages/backend/src/admin/products.property.test.ts` 中创建测试
    - **验证: 需求 1.7, 1.8, 2.3**

  - [ ]* 3.3 编写尺码总库存计算属性测试
    - **Property 4: 尺码总库存等于各尺码库存之和**
    - 使用 fast-check 生成随机 sizeOptions 数组（每个 stock ≥ 0），验证计算的 stock 等于 sum
    - 在 `packages/backend/src/admin/products.property.test.ts` 中添加测试
    - **验证: 需求 3.4**

  - [ ]* 3.4 编写尺码名称唯一性属性测试
    - **Property 5: 尺码名称唯一性**
    - 使用 fast-check 生成含重复名称的 sizeOptions，验证校验函数拒绝；生成不重复名称的，验证通过
    - 在 `packages/backend/src/admin/products.property.test.ts` 中添加测试
    - **验证: 需求 3.6**

  - [ ]* 3.5 编写限购数量校验属性测试
    - **Property 6: 限购数量必须为正整数**
    - 使用 fast-check 生成随机 purchaseLimitCount 值（正整数、0、负数、小数），验证校验逻辑
    - 在 `packages/backend/src/admin/products.property.test.ts` 中添加测试
    - **验证: 需求 5.4, 5.5**

- [x] 4. 检查点 - 图片服务与商品管理扩展验证
  - 运行图片和商品管理相关测试，确保上传、尺码校验、限购校验逻辑正确。如有问题请向用户确认。

- [x] 5. 订单服务扩展（尺码库存扣减、限购校验）
  - [x] 5.1 实现限购校验和尺码库存扣减逻辑
    - 在 `packages/backend/src/orders/order.ts` 中：
      - 新增 `getUserProductPurchaseCount(userId, productId, dynamoClient, ordersTable)` 函数：查询用户对某商品的历史购买总数量
      - 修改 `createOrder` 和 `createDirectOrder`：
        - 对启用限购的商品，校验历史购买数量 + 本次数量 ≤ purchaseLimitCount
        - 对启用尺码的商品，校验 selectedSize 存在且对应尺码库存充足
        - 尺码商品扣减对应尺码的 stock 和商品总 stock
      - 订单项保存 selectedSize 字段
    - _需求: 4.5, 4.7, 6.2, 6.3, 6.4_

  - [ ]* 5.2 编写下单限购校验属性测试
    - **Property 7: 下单限购校验**
    - 使用 fast-check 生成随机历史购买数量和本次数量，验证超出限购时拒绝、未超出时通过
    - 在 `packages/backend/src/orders/order.property.test.ts` 中创建测试
    - **验证: 需求 6.2, 6.3**

  - [ ]* 5.3 编写尺码库存扣减正确性属性测试
    - **Property 9: 尺码库存扣减正确性**
    - 使用 fast-check 生成随机尺码商品和订单，验证下单后对应尺码 stock 减少、其他尺码不变、总 stock 同步减少
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 4.7**

  - [ ]* 5.4 编写尺码信息持久化属性测试
    - **Property 10: 尺码信息持久化完整性**
    - 使用 fast-check 生成随机尺码订单，验证持久化后 selectedSize 字段与用户选择一致
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 4.5, 4.6**

  - [ ]* 5.5 编写向后兼容性属性测试
    - **Property 11: 向后兼容性**
    - 使用 fast-check 生成无尺码无限购商品，验证下单和加购流程行为与增强前一致
    - 在 `packages/backend/src/orders/order.property.test.ts` 中添加测试
    - **验证: 需求 4.8, 6.4**

- [x] 6. 购物车服务扩展（尺码支持、限购校验）
  - [x] 6.1 扩展购物车加购逻辑
    - 在 `packages/backend/src/cart/cart.ts` 中：
      - 修改 `addToCart` 函数签名，新增 `selectedSize?: string` 参数
      - 有尺码商品加购时校验 selectedSize 存在且库存充足
      - 同一商品不同尺码视为不同购物车项
      - 加购时校验限购：历史购买数量 + 购物车中该商品数量 + 1 ≤ purchaseLimitCount
    - 修改 `packages/backend/src/cart/handler.ts`：POST `/api/cart/items` 接收 selectedSize 参数
    - _需求: 4.4, 4.6, 6.5, 6.6_

  - [ ]* 6.2 编写加购物车限购校验属性测试
    - **Property 8: 加购物车限购校验**
    - 使用 fast-check 生成随机购物车状态和历史购买数量，验证超出限购时拒绝加购
    - 在 `packages/backend/src/cart/cart.property.test.ts` 中创建测试
    - **验证: 需求 6.5, 6.6**

- [x] 7. 检查点 - 订单与购物车扩展验证
  - 运行订单和购物车相关测试，确保尺码库存扣减、限购校验、向后兼容性正确。如有问题请向用户确认。

- [x] 8. CDK 基础设施更新
  - [x] 8.1 更新 Admin Lambda S3 权限和环境变量
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 为 AdminFunction 添加 ImagesBucket 的 `s3:PutObject`、`s3:DeleteObject`、`s3:GetObject` 权限
      - 在 AdminFunction 环境变量中添加 `IMAGES_BUCKET` 引用 FrontendStack 的 imagesBucket.bucketName
      - 更新 `ApiStackProps` 接口新增 `imagesBucketName: string` 和 `imagesBucketArn: string`
    - 在 `packages/cdk/lib/frontend-stack.ts` 中：
      - 更新 ImagesBucket CORS 配置，允许 PUT 方法（支持预签名上传）
    - _需求: 1.1, 1.2_

  - [x] 8.2 新增图片相关 API 路由
    - 在 `packages/cdk/lib/api-stack.ts` 中：
      - 在 adminProductById 下新增 `upload-url` 资源和 POST 方法
      - 在 adminProductById 下新增 `images/{key}` 资源和 DELETE 方法
    - 更新 CDK 入口文件传递 imagesBucket 信息
    - _需求: 1.1, 1.6_

- [x] 9. 前端管理端商品页面改造
  - [x] 9.1 添加图片上传 UI
    - 在 `packages/frontend/src/pages/admin/products.tsx` 中：
      - 商品表单新增图片上传区域：展示已上传图片缩略图列表，支持点击调整顺序和删除
      - 添加"上传图片"按钮，调用 POST `/api/admin/products/{id}/upload-url` 获取预签名 URL，然后直传 S3
      - 上传成功后更新商品 images 数组
      - 图片数量达到 5 张时隐藏上传按钮
    - 更新 `packages/frontend/src/pages/admin/products.scss` 添加图片上传相关样式
    - _需求: 1.1, 1.4, 1.5, 1.6_

  - [x] 9.2 添加尺码配置 UI
    - 在 `packages/frontend/src/pages/admin/products.tsx` 中：
      - 商品表单新增"启用尺码选项"开关
      - 启用后展示尺码配置区域：可添加尺码名称和库存，支持删除尺码
      - 启用尺码时隐藏原有库存输入框，总库存自动计算显示
    - _需求: 3.1, 3.2, 3.7_

  - [x] 9.3 添加限购设置 UI
    - 在 `packages/frontend/src/pages/admin/products.tsx` 中：
      - 商品表单新增"启用限购"开关
      - 启用后展示限购数量输入框
    - _需求: 5.1, 5.2_

- [x] 10. 前端商品详情页改造
  - [x] 10.1 添加图片轮播展示
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - 当商品有 images 数组且非空时，使用 Swiper 组件展示轮播图，支持左右滑动
      - 轮播图下方显示序号指示器（如 "2/5"）
      - 无 images 时回退到现有 imageUrl 单图展示
    - 更新 `packages/frontend/src/pages/product/index.scss` 添加轮播相关样式
    - _需求: 2.1, 2.2, 2.4_

  - [x] 10.2 添加尺码选择器
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - 当商品有 sizeOptions 时，在兑换按钮上方展示尺码选择器（标签按钮形式）
      - 选择尺码后显示对应库存
      - 库存为零的尺码显示为不可选并标注"已售罄"
      - 未选择尺码时禁用"立即兑换"和"加入购物车"按钮，提示"请选择尺码"
      - 无 sizeOptions 时不展示选择器，保持现有行为
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.8_

  - [x] 10.3 添加限购提示和数量限制
    - 在 `packages/frontend/src/pages/product/index.tsx` 中：
      - 当商品启用限购时，在商品信息区域显示"每人限购 N 件"提示
      - 数量选择器最大值限制为限购剩余可购买数量
    - _需求: 6.1, 6.7_

- [x] 11. 检查点 - 前端页面验证
  - 确保所有前端页面编译通过，图片上传、尺码选择、限购提示功能正确。如有问题请向用户确认。

- [x] 12. 集成联调与商品详情 API 扩展
  - [x] 12.1 扩展商品详情 API 返回新字段
    - 在 `packages/backend/src/products/detail.ts` 中：
      - 返回数据新增 images、sizeOptions、purchaseLimitEnabled、purchaseLimitCount 字段
    - 在 `packages/backend/src/products/handler.ts` 中确保新字段透传
    - _需求: 2.1, 4.1, 6.1_

  - [x] 12.2 更新购物车页面展示尺码信息
    - 在购物车相关前端页面中展示所选尺码信息
    - 订单确认页面传递 selectedSize 参数
    - _需求: 4.6_

- [x] 13. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端集成正确。如有问题请向用户确认。

## 备注

- 本次不新增 DynamoDB 表或 Lambda 函数，仅扩展现有模块和新增图片服务文件
- 属性测试验证设计文档中定义的 11 个正确性属性
- 所有新字段均为可选，现有商品数据无需迁移，保持向后兼容
- 图片通过 S3 预签名 URL 直传，不经过 Lambda，避免 6MB payload 限制
- 尺码数量有限（通常 ≤10），嵌入商品记录无需独立表
- 限购校验在下单和加购物车时双重执行，下单时为最终保障
- 前端页面遵循现有设计系统，使用 CSS 变量和全局组件类
- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 检查点任务用于阶段性验证，确保增量开发的正确性
