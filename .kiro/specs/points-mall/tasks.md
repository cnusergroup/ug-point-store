# 实现计划：积分商城系统（Points Mall）

## 概述

基于 AWS Serverless 架构（API Gateway + Lambda + DynamoDB），使用 TypeScript 实现积分商城系统的后端服务和前端应用。采用 AWS CDK 进行基础设施定义，Vitest + fast-check 进行测试。任务按服务模块递增构建，每个模块完成后进行检查点验证。

## 任务

- [x] 1. 项目初始化与基础设施搭建
  - [x] 1.1 初始化项目结构和依赖
    - 创建 monorepo 项目结构（`packages/cdk`、`packages/backend`、`packages/shared`）
    - 初始化 `package.json`，安装核心依赖：`aws-cdk-lib`、`aws-sdk`、`vitest`、`fast-check`、`jsonwebtoken`、`bcryptjs`、`ulid`
    - 配置 TypeScript（`tsconfig.json`）和 Vitest（`vitest.config.ts`）
    - _需求: 10.1, 10.3_

  - [x] 1.2 定义共享类型和接口
    - 在 `packages/shared/src/types.ts` 中定义所有共享接口：`UserProfile`、`UserRole`、`Product`、`PointsProduct`、`CodeExclusiveProduct`、`PointsRecord`、`RedemptionRecord`、`CodeInfo`、`ErrorResponse`
    - 定义所有错误码常量（`INVALID_PASSWORD_FORMAT`、`INVALID_CODE`、`CODE_ALREADY_USED` 等）
    - _需求: 1.7, 4.3, 4.4, 4.5, 6.4, 6.5, 6.6, 7.3, 7.4_

  - [x] 1.3 使用 CDK 定义 DynamoDB 表
    - 创建 `packages/cdk/lib/database-stack.ts`
    - 定义 Users 表（PK: userId，GSI: email-index, wechatOpenId-index）
    - 定义 Products 表（PK: productId，GSI: type-status-index）
    - 定义 Codes 表（PK: codeId，GSI: codeValue-index）
    - 定义 Redemptions 表（PK: redemptionId，GSI: userId-createdAt-index）
    - 定义 PointsRecords 表（PK: recordId，GSI: userId-createdAt-index）
    - 所有表使用 On-Demand 计费模式
    - _需求: 10.5_

  - [x] 1.4 使用 CDK 定义 API Gateway 和 Lambda 函数
    - 创建 `packages/cdk/lib/api-stack.ts`
    - 定义 REST API Gateway
    - 定义 5 个 Lambda 函数（Auth、Product、Redemption、Points、Admin），运行时 Node.js 20.x
    - 配置 Lambda 与 DynamoDB 表的 IAM 权限
    - 配置 API Gateway 路由映射到对应 Lambda
    - _需求: 10.3_

  - [x] 1.5 使用 CDK 定义 S3 和 CloudFront
    - 创建 `packages/cdk/lib/frontend-stack.ts`
    - 定义 S3 桶（静态资源 + 商品图片）
    - 定义 CloudFront 分发，配置 S3 源和 API Gateway 源
    - _需求: 10.2_

- [x] 2. 认证服务实现
  - [x] 2.1 实现密码验证和用户注册逻辑
    - 在 `packages/backend/src/auth/validators.ts` 中实现 `validatePassword` 函数（≥8 位，包含字母和数字）
    - 在 `packages/backend/src/auth/register.ts` 中实现邮箱注册处理：校验邮箱唯一性、密码格式、创建用户记录、发送验证邮件（SES）
    - _需求: 1.2, 1.4, 1.6, 1.7_

  - [x] 2.2 编写密码验证属性测试
    - **Property 1: 密码验证规则**
    - 使用 fast-check 生成随机密码字符串，验证不符合规则的密码被拒绝，符合规则的密码通过
    - **验证: 需求 1.7**

  - [x] 2.3 编写邮箱唯一性属性测试
    - **Property 2: 邮箱唯一性约束**
    - 模拟已注册邮箱，验证重复注册被拒绝且不创建新账号
    - **验证: 需求 1.6**

  - [x] 2.4 实现邮箱验证和登录逻辑
    - 在 `packages/backend/src/auth/verify-email.ts` 中实现邮箱验证激活
    - 在 `packages/backend/src/auth/login.ts` 中实现邮箱密码登录：校验凭证、登录失败计数、账号锁定（连续 5 次失败锁定 15 分钟）
    - _需求: 1.5, 1.8_

  - [x] 2.5 实现 JWT Token 生成与验证
    - 在 `packages/backend/src/auth/token.ts` 中实现 `generateToken`（有效期 7 天）和 `verifyToken`
    - 在 `packages/backend/src/middleware/auth-middleware.ts` 中实现 Token 验证中间件，过期时返回 `TOKEN_EXPIRED`
    - _需求: 1.9, 1.10_

  - [x] 2.6 编写 Token 有效期属性测试
    - **Property 3: Token 有效期**
    - 验证生成的 JWT Token 过期时间恰好为签发时间后 604800 秒
    - **验证: 需求 1.9**

  - [x] 2.7 实现微信扫码登录
    - 在 `packages/backend/src/auth/wechat.ts` 中实现获取微信二维码和 OAuth 回调处理
    - 微信授权后自动创建或关联用户账号
    - _需求: 1.1, 1.3_

  - [x] 2.8 实现 Auth Lambda 入口和路由
    - 在 `packages/backend/src/auth/handler.ts` 中实现 Lambda handler，路由到各认证接口
    - 路由：`POST /auth/register`、`POST /auth/login`、`GET /auth/verify-email`、`POST /auth/wechat/qrcode`、`POST /auth/wechat/callback`、`POST /auth/refresh`、`POST /auth/logout`
    - logout 接口：服务端返回 200，客户端清除本地 Token 并跳转登录页
    - _需求: 1.1, 1.2, 1.11_

- [x] 3. 检查点 - 认证服务验证
  - 确保所有认证相关测试通过，如有问题请向用户确认。

- [x] 4. 用户角色与积分服务实现
  - [x] 4.1 实现用户角色管理
    - 在 `packages/backend/src/admin/roles.ts` 中实现角色分配和撤销逻辑
    - 在 `packages/backend/src/user/profile.ts` 中实现用户个人中心查询（包含身份列表和积分余额）
    - _需求: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.2 编写角色分配与撤销属性测试
    - **Property 4: 角色分配与撤销的往返一致性**
    - 使用 fast-check 生成随机用户和角色子集，验证分配后查询包含所有角色，撤销后不再包含
    - **验证: 需求 3.2, 3.3**

  - [x] 4.3 编写角色变更权限属性测试
    - **Property 5: 角色变更后权限即时生效**
    - 验证角色变更后，用户对身份限定商品的兑换权限判定与当前角色一致
    - **验证: 需求 3.4, 5.3**

  - [x] 4.4 实现积分码兑换逻辑
    - 在 `packages/backend/src/points/redeem-code.ts` 中实现积分码兑换：校验 Code 有效性、使用次数、用户是否已用，使用 DynamoDB 事务写入更新 Code 使用记录、增加用户积分、写积分记录
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.5 编写积分码兑换属性测试
    - **Property 6: 积分码兑换正确性**
    - 验证兑换后用户积分余额增加正确数量，且生成正确的积分记录
    - **验证: 需求 4.1, 4.2**

  - [x] 4.6 编写 Code 使用限制属性测试
    - **Property 7: Code 使用限制**
    - 验证已使用或已达上限的 Code 兑换被拒绝，用户积分不变
    - **验证: 需求 4.4, 4.5**

  - [x] 4.7 实现积分查询和记录接口
    - 在 `packages/backend/src/points/balance.ts` 中实现积分余额查询
    - 在 `packages/backend/src/points/records.ts` 中实现积分变动历史查询（按时间倒序，支持分页）
    - _需求: 4.6_

  - [x] 4.8 实现 Points Lambda 入口和路由
    - 在 `packages/backend/src/points/handler.ts` 中实现 Lambda handler
    - 路由：`POST /points/redeem-code`、`GET /points/balance`、`GET /points/records`
    - _需求: 4.1, 4.6_

- [x] 5. 检查点 - 角色与积分服务验证
  - 确保所有角色管理和积分相关测试通过，如有问题请向用户确认。

- [x] 6. 商品服务实现
  - [x] 6.1 实现商品 CRUD（管理端）
    - 在 `packages/backend/src/admin/products.ts` 中实现创建积分商品、创建 Code 专属商品、编辑商品、上架/下架商品
    - 创建积分商品时设置：名称、描述、图片 URL、所需积分、库存、可兑换身份范围
    - 创建 Code 专属商品时设置：名称、描述、图片 URL、关联活动信息、库存
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 6.2 实现商品列表和详情查询（用户端）
    - 在 `packages/backend/src/products/list.ts` 中实现商品列表查询：仅返回 active 商品，支持按类型和角色筛选，对无权兑换商品标记锁定状态
    - 在 `packages/backend/src/products/detail.ts` 中实现商品详情查询：积分商品显示身份限定说明，Code 专属商品显示活动信息
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 6.3 编写商品列表属性测试
    - **Property 8: 商品列表仅展示上架商品**
    - 验证返回的商品全部为 active 状态，且包含所有 active 商品
    - **验证: 需求 5.1, 8.5**

  - [x] 6.4 编写商品筛选属性测试
    - **Property 9: 商品筛选正确性**
    - 验证按类型或角色筛选后，返回的商品均满足筛选条件
    - **验证: 需求 5.6, 5.7**

  - [x] 6.5 实现 Product Lambda 入口和路由
    - 在 `packages/backend/src/products/handler.ts` 中实现 Lambda handler
    - 路由：`GET /products`、`GET /products/:id`
    - _需求: 5.1_

  - [x] 6.6 实现管理端商品统计查询
    - 在管理端商品接口中增加兑换次数和当前库存的查询返回
    - _需求: 8.6_

- [ ] 7. 兑换服务实现
  - [x] 7.1 实现积分兑换商品逻辑
    - 在 `packages/backend/src/redemptions/points-redemption.ts` 中实现：校验用户身份权限、积分余额、商品库存，使用 DynamoDB TransactWriteItems 原子写入（扣积分、减库存、写兑换记录、写积分记录）
    - 对 Code 专属商品的积分兑换请求返回 `CODE_ONLY_PRODUCT` 错误
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.4_

  - [x] 7.2 编写积分兑换成功属性测试
    - **Property 10: 积分兑换商品成功流程**
    - 验证兑换后积分减少、库存减少 1、生成兑换记录和积分扣减记录
    - **验证: 需求 6.1, 6.2, 6.3**

  - [x] 7.3 编写积分兑换失败属性测试
    - **Property 11: 积分兑换失败时状态不变**
    - 验证积分不足或角色不匹配时兑换被拒绝，积分和库存不变
    - **验证: 需求 6.4, 6.5**

  - [x] 7.4 编写 Code 专属商品拒绝积分购买属性测试
    - **Property 14: Code 专属商品拒绝积分购买**
    - 验证对 Code 专属商品的积分兑换请求被拒绝
    - **验证: 需求 7.4**

  - [x] 7.5 实现 Code 专属商品兑换逻辑
    - 在 `packages/backend/src/redemptions/code-redemption.ts` 中实现：校验 Code 与商品绑定关系、Code 有效性和使用状态，完成兑换不扣积分
    - _需求: 7.1, 7.2, 7.3, 7.5_

  - [x] 7.6 编写 Code 专属商品绑定校验属性测试
    - **Property 12: Code 专属商品兑换绑定校验**
    - 验证只有 Code 绑定商品 ID 与目标商品一致时兑换成功
    - **验证: 需求 7.1, 7.3**

  - [x] 7.7 编写 Code 专属兑换不扣积分属性测试
    - **Property 13: Code 专属商品兑换不扣积分**
    - 验证通过 Code 兑换专属商品后用户积分不变
    - **验证: 需求 7.2**

  - [x] 7.8 实现兑换历史查询和 Redemption Lambda 入口
    - 在 `packages/backend/src/redemptions/history.ts` 中实现兑换历史查询（按时间倒序，支持分页）
    - 在 `packages/backend/src/redemptions/handler.ts` 中实现 Lambda handler
    - 路由：`POST /redemptions/points`、`POST /redemptions/code`、`GET /redemptions/history`
    - _需求: 6.7_

- [x] 8. 检查点 - 商品与兑换服务验证
  - 确保所有商品和兑换相关测试通过，如有问题请向用户确认。

- [ ] 9. 管理服务实现
  - [x] 9.1 实现 Code 批量生成和管理
    - 在 `packages/backend/src/admin/codes.ts` 中实现：批量生成积分码（指定数量、积分值、最大使用次数）、生成商品专属码（绑定商品 ID）、查询 Code 列表及状态、禁用 Code
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.2 编写批量生成 Code 属性测试
    - **Property 15: 批量生成 Code 正确性**
    - 验证生成数量、积分值、最大使用次数和状态均正确，商品专属码正确绑定商品
    - **验证: 需求 9.1, 9.2**

  - [x] 9.3 编写禁用 Code 属性测试
    - **Property 16: 禁用 Code 后拒绝兑换**
    - 验证被禁用的 Code 的所有兑换请求均被拒绝
    - **验证: 需求 9.4, 9.5**

  - [x] 9.4 实现 Admin Lambda 入口和路由
    - 在 `packages/backend/src/admin/handler.ts` 中实现 Lambda handler
    - 路由：`PUT /admin/users/:id/roles`、`POST /admin/codes/batch-generate`、`POST /admin/codes/product-code`、`GET /admin/codes`、`PATCH /admin/codes/:id/disable`、`POST /admin/products`、`PUT /admin/products/:id`、`PATCH /admin/products/:id/status`
    - 添加管理员身份验证中间件
    - _需求: 3.2, 3.3, 8.1, 8.2, 9.1, 9.2_

- [x] 10. 检查点 - 管理服务验证
  - 确保所有管理服务相关测试通过，如有问题请向用户确认。

- [x] 11. 前端应用实现
  - [x] 11.1 初始化前端项目（Taro + React）
    - 在 `packages/frontend` 中使用 Taro CLI 初始化项目，配置编译到 H5 和微信小程序
    - 安装依赖：`@tarojs/taro`、`react`、`zustand`（状态管理）、`taro-ui`（UI 组件库）
    - 配置 API 请求封装（统一 Token 注入、错误处理、过期跳转登录）
    - _需求: 2.1, 2.2, 2.3_

  - [x] 11.2 实现登录注册页面
    - 实现邮箱注册页面（表单校验：邮箱格式、密码规则提示）
    - 实现邮箱登录页面（账号锁定提示）
    - 实现微信扫码登录（PC 端显示二维码，小程序端调用微信授权）
    - Token 存储和自动刷新逻辑
    - _需求: 1.1, 1.2, 1.3, 1.7, 1.8_

  - [x] 11.3 实现商品列表和详情页面
    - 实现商品列表页：展示商品卡片（名称、图片、积分/Code 标识、身份范围），无权兑换商品灰显
    - 实现筛选功能：按商品类型、按用户身份筛选
    - 实现商品详情页：积分商品显示身份限定说明，Code 专属商品显示活动信息
    - 响应式布局适配 PC（≥1024px）和手机（<768px）
    - _需求: 2.1, 2.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 11.4 实现兑换功能页面
    - 实现积分兑换确认弹窗（显示所需积分、当前余额）
    - 实现 Code 兑换输入框（积分码兑换 + 商品专属码兑换）
    - 实现兑换结果反馈（成功/失败提示，错误信息展示）
    - _需求: 4.1, 6.1, 7.1_

  - [x] 11.5 实现个人中心页面
    - 实现用户信息展示（昵称、身份列表、积分余额）
    - 实现积分变动历史列表（时间、来源、变动数量）
    - 实现兑换历史列表（时间、商品名称、兑换方式、状态）
    - _需求: 3.5, 4.6, 6.7_

  - [x] 11.6 实现管理端页面
    - 实现商品管理页面：商品列表（含兑换次数和库存）、创建/编辑商品表单、上架/下架操作
    - 实现 Code 管理页面：Code 列表（含使用状态）、批量生成积分码表单、生成商品专属码表单、禁用操作
    - 实现用户角色管理页面：用户列表、角色分配/撤销操作
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.6, 9.1, 9.2, 9.3, 9.4, 3.2, 3.3_

- [x] 12. 检查点 - 前端应用验证
  - 确保前端页面正常渲染，API 调用正确，如有问题请向用户确认。

- [x] 13. 集成与部署配置
  - [x] 13.1 配置 CDK 部署脚本
    - 在 `packages/cdk/bin/app.ts` 中组装所有 Stack（DatabaseStack、ApiStack、FrontendStack）
    - 配置环境变量（微信 AppID/Secret、JWT Secret、SES 发件邮箱）
    - 编写 `cdk deploy` 部署脚本
    - _需求: 10.1, 10.3, 10.4_

  - [x] 13.2 配置前端构建和部署
    - 配置 Taro H5 构建输出到 S3 静态资源桶
    - 配置微信小程序构建输出
    - 配置 CloudFront 缓存失效策略
    - _需求: 2.1, 2.2, 2.3, 10.2_

  - [x] 13.3 编写端到端集成测试
    - 测试完整的积分码兑换 → 积分商品兑换流程
    - 测试完整的 Code 专属商品兑换流程
    - 测试角色变更后权限变化
    - _需求: 4.1, 6.1, 7.1, 3.4_

- [x] 14. 最终检查点 - 全面验证
  - 确保所有测试通过，CDK 合成（synth）无错误，如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保需求可追溯
- 属性测试验证设计文档中定义的 16 个正确性属性
- 检查点任务用于阶段性验证，确保增量开发的正确性
- 所有 DynamoDB 操作涉及多表写入时使用 TransactWriteItems 保证一致性
