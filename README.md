# ◆ 积分商城（Points Mall）

一个基于 AWS Serverless 架构的社区积分商城系统，用于激励 UserGroupLeader、CommunityBuilder、Speaker 和 Volunteer 参与社区活动。用户通过兑换码或积分申请获取积分，在商城中使用积分或专属 Code 兑换商品，支持购物车下单、物流追踪、内容分享等功能。

## 功能概览

- **多端支持**：PC 浏览器、手机浏览器、微信小程序（Taro 框架）
- **双重登录**：微信扫码登录 + 邮箱注册登录（邀请码注册）
- **角色权限**：多种用户身份（SuperAdmin / Admin / Leader / Builder / Speaker / Volunteer），商品可按身份限定兑换
- **积分体系**：通过兑换码获取积分 + 积分申请审批
- **购物车 + 订单**：购物车管理、收货地址、下单结算、物流追踪
- **Code 专属商品**：特定活动商品仅通过专属 Code 兑换，不消耗积分
- **Content Hub**：文档上传/下载/评论/点赞/预约，支持审核流程
- **积分申请（Claims）**：用户提交积分申请，管理员审批发放
- **邀请系统**：管理员批量生成邀请码，支持多角色分配
- **国际化（i18n）**：支持 5 种语言（简体中文、English、日本語、한국어、繁體中文）
- **管理后台**：商品管理、Code 批量生成、用户管理、订单管理、内容审核、积分申请审批
- **CloudFront 上传代理**：文件上传通过 CloudFront + Lambda@Edge 签名，无需直接暴露 S3

## 架构概览

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐
│   Browser   │────▶│  CloudFront (<your-domain>)                      │
└─────────────┘     │                                                  │
                    │  /           → S3 (Static Assets)                │
                    │  /api/*      → API Gateway → Lambda → DynamoDB   │
                    │  /products/* ─┐                                  │
                    │  /claims/*  ──┤→ Lambda@Edge (SigV4 sign) → S3   │
                    │  /content/* ──┘   (us-east-1)                    │
                    └──────────────────────────────────────────────────┘
```

### 上传流程（CloudFront Upload Proxy）

```
1. Frontend → POST /api/.../upload-url → Backend 生成 CloudFront URL（含 HMAC token）
2. Frontend → PUT https://<your-domain>/products/xxx?token=xxx&expires=xxx
3. CloudFront → Lambda@Edge (Origin Request)
   → 验证 HMAC token + 过期时间
   → 使用 SigV4 签名请求
   → 转发到 S3 PutObject
4. S3 存储文件，返回 200
```

### CDK Stacks（4 个）

| Stack | Region | 说明 |
|-------|--------|------|
| `PointsMall-DatabaseStack` | ap-northeast-1 | DynamoDB 表（15 张） |
| `PointsMall-ApiStack` | ap-northeast-1 | API Gateway + Lambda 函数 |
| `PointsMall-FrontendStack` | ap-northeast-1 | S3 + CloudFront + Lambda@Edge 关联 |
| `PointsMall-EdgeSignerStack` | us-east-1 | Lambda@Edge 上传签名函数 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + Taro（H5 + 微信小程序）、Zustand、SCSS |
| 后端 | Node.js 20.x + TypeScript、AWS Lambda |
| API | Amazon API Gateway（REST）→ CloudFront 代理 |
| 数据库 | Amazon DynamoDB（On-Demand） |
| 存储 | Amazon S3（静态资源 + 商品/内容/申请图片） |
| CDN | Amazon CloudFront + Lambda@Edge |
| 邮件 | Amazon SES |
| IaC | AWS CDK（TypeScript） |
| 测试 | Vitest + fast-check（属性测试） |
| 国际化 | 自定义 i18n（zh / en / ja / ko / zh-TW） |

## 项目结构

```
points-mall/
├── packages/
│   ├── shared/              # 共享类型定义和错误码
│   ├── backend/             # Lambda 函数（9 个服务模块）
│   │   └── src/
│   │       ├── auth/            # 认证服务（登录、注册、邀请码、微信、JWT、密码重置）
│   │       ├── products/        # 商品服务（列表、详情、筛选）
│   │       ├── points/          # 积分服务（兑换码、余额、记录、用户资料）
│   │       ├── redemptions/     # 兑换服务（积分兑换、Code 兑换）
│   │       ├── cart/            # 购物车 + 收货地址
│   │       ├── orders/          # 订单管理 + 物流追踪
│   │       ├── claims/          # 积分申请（提交、审批、图片上传）
│   │       ├── content/         # Content Hub（上传、评论、点赞、预约、下载）
│   │       ├── admin/           # 管理服务（角色、商品、Code、用户、邀请、内容审核）
│   │       ├── middleware/      # 认证中间件
│   │       └── user/            # 用户资料
│   ├── cdk/                 # AWS CDK 基础设施定义
│   │   ├── bin/app.ts           # CDK App 入口（4 个 Stack）
│   │   ├── lib/
│   │   │   ├── database-stack.ts    # DynamoDB 表（15 张）
│   │   │   ├── api-stack.ts         # API Gateway + Lambda
│   │   │   ├── frontend-stack.ts    # S3 + CloudFront + Lambda@Edge 关联
│   │   │   └── edge-signer-stack.ts # Lambda@Edge 上传签名（us-east-1）
│   │   └── lambda/
│   │       └── edge-signer/         # Lambda@Edge 函数源码
│   │           └── index.ts
│   └── frontend/            # Taro 前端应用
│       └── src/
│           ├── pages/           # 页面组件
│           ├── store/           # Zustand 状态管理
│           ├── i18n/            # 国际化（zh/en/ja/ko/zh-TW）
│           └── utils/           # 请求封装
├── package.json             # Monorepo 根配置
├── tsconfig.json
└── vitest.config.ts
```

## 快速开始

### 前置条件

- Node.js >= 20.x
- npm >= 9.x
- AWS CLI 已配置（`aws configure`）
- AWS CDK CLI（`npm install -g aws-cdk`）

### 安装依赖

```bash
git clone <your-repo-url>
cd points-mall
npm install
```

### 运行测试

```bash
# 运行所有测试（单次执行）
npm test

# 监听模式
npm run test:watch

# 类型检查
npm run lint
```

### 本地开发（前端）

```bash
# H5 开发服务器
cd packages/frontend
npm run dev:h5
# 访问 http://localhost:10086

# 微信小程序开发
npm run dev:weapp
# 用微信开发者工具打开 packages/frontend/dist/weapp
```

## 部署指南

> **安全提示**：`cdk.json` 中包含环境相关配置值。请勿将真实密钥、证书 ARN、账户 ID 等敏感信息提交到版本控制。部署时通过 `--context` 参数传入敏感值。

### 1. 配置参数说明

| 配置项 | 说明 | 传入方式 |
|--------|------|----------|
| `jwtSecret` | JWT 签名密钥 | `--context`（必须） |
| `uploadTokenSecret` | 上传 Token HMAC 密钥 | `--context`（必须） |
| `wechatAppId` | 微信开放平台 AppID | `--context` 或 `cdk.json` |
| `wechatAppSecret` | 微信开放平台 AppSecret | `--context`（必须） |
| `senderEmail` | SES 发件邮箱 | `cdk.json` |
| `domainName` | CloudFront 自定义域名 | `cdk.json` |
| `certificateArn` | ACM 证书 ARN（us-east-1） | `cdk.json` |
| `uploadViaCloudfront` | 是否启用 CloudFront 上传代理 | `cdk.json`（`"true"` / `"false"`） |
| `edgeSignerLambdaArn` | Lambda@Edge 函数版本 ARN | `cdk.json`（部署 EdgeSignerStack 后填入） |
| `imagesBucketArn` | S3 图片桶 ARN（供 EdgeSigner 授权） | `--context`（首次部署时） |

### 2. 验证 SES 发件邮箱

```bash
aws ses verify-email-identity --email-address <your-sender-email>
```

收到验证邮件后点击链接完成验证。

### 3. Bootstrap CDK（首次部署）

需要在两个 Region 分别 bootstrap：

```bash
# ap-northeast-1（主 Region）
npx cdk bootstrap aws://<your-account-id>/ap-northeast-1

# us-east-1（Lambda@Edge 必须部署在此 Region）
npx cdk bootstrap aws://<your-account-id>/us-east-1
```

### 4. 部署 EdgeSignerStack（us-east-1）

Lambda@Edge 必须部署在 us-east-1，且需要先于 FrontendStack 部署：

```bash
cd packages/cdk

npx cdk deploy PointsMall-EdgeSignerStack \
  --context uploadTokenSecret="<your-upload-token-secret>" \
  --context imagesBucketArn="<your-images-bucket-arn>"
```

> 首次部署时 `imagesBucketArn` 可使用 `arn:aws:s3:::*`，后续更新为实际桶 ARN。

部署完成后，终端会输出 `EdgeSignerFunctionArn`，将其复制到 `cdk.json` 的 `edgeSignerLambdaArn` 字段：

```json
{
  "context": {
    "edgeSignerLambdaArn": "<your-edge-signer-function-version-arn>"
  }
}
```

### 5. 部署主 Stacks（ap-northeast-1）

```bash
npx cdk deploy --all \
  --context jwtSecret="<your-jwt-secret>" \
  --context uploadTokenSecret="<your-upload-token-secret>" \
  --context uploadViaCloudfront="true"
```

部署顺序自动解析依赖：`DatabaseStack → ApiStack → FrontendStack`。

部署完成后，终端会输出：
- `PointsMall-DistributionDomain`：CloudFront 域名
- `PointsMall-DistributionId`：CloudFront Distribution ID
- `PointsMall-StaticBucketName`：静态资源 S3 桶名
- `PointsMall-ImagesBucketName`：商品图片 S3 桶名
- `PointsMall-ImagesBucketArn`：图片桶 ARN（用于更新 EdgeSignerStack）

### 6. 构建并部署前端（H5）

```bash
# 构建 H5 版本
npm run build:frontend

# 部署到 S3 + 刷新 CloudFront 缓存
export STATIC_BUCKET=<上一步输出的 StaticBucketName>
export CF_DIST_ID=<上一步输出的 DistributionId>
npm run deploy:frontend
```

部署完成后，通过自定义域名即可访问商城。

### 7. 更新 EdgeSignerStack（可选）

首次部署完成后，建议用实际的 `imagesBucketArn` 重新部署 EdgeSignerStack 以收紧权限：

```bash
npx cdk deploy PointsMall-EdgeSignerStack \
  --context uploadTokenSecret="<your-upload-token-secret>" \
  --context imagesBucketArn="<your-actual-images-bucket-arn>"
```

如果 Lambda@Edge 代码有变更，重新部署后需要更新 `cdk.json` 中的 `edgeSignerLambdaArn`，然后重新部署 FrontendStack。

### 8. 配置自定义域名

在 DNS 提供商处添加 CNAME 记录，将自定义域名指向 CloudFront Distribution 域名。ACM 证书必须在 us-east-1 Region 创建。

## 微信小程序发布

### 1. 注册小程序

前往 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序账号，获取 AppID。

### 2. 配置项目

编辑 `packages/frontend/project.config.json`，将 `appid` 替换为你的小程序 AppID：

```json
{
  "appid": "<your-wechat-mini-program-appid>",
  ...
}
```

### 3. 配置服务器域名

在微信公众平台 → 开发管理 → 开发设置 → 服务器域名中，添加：

- request 合法域名：`https://<your-domain>`
- uploadFile 合法域名：`https://<your-domain>`

### 4. 构建小程序

```bash
npm run build:weapp
```

### 5. 上传并提审

1. 打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入项目，目录选择 `packages/frontend/dist/weapp`
3. 点击「上传」，填写版本号和描述
4. 登录微信公众平台 → 版本管理 → 提交审核
5. 审核通过后发布

## 微信开放平台配置（扫码登录）

PC 端微信扫码登录需要在 [微信开放平台](https://open.weixin.qq.com/) 创建网站应用：

1. 创建网站应用，填写网站域名（自定义域名）
2. 获取 AppID 和 AppSecret
3. 设置授权回调域名
4. 将 AppID 和 AppSecret 通过 CDK context 传入部署

## API 接口

### 认证（Auth）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 邮箱注册（需邀请码） |
| POST | `/api/auth/login` | 邮箱登录 |
| GET | `/api/auth/verify-email?token=xxx` | 邮箱验证 |
| POST | `/api/auth/wechat/qrcode` | 获取微信二维码 |
| POST | `/api/auth/wechat/callback` | 微信登录回调 |
| POST | `/api/auth/refresh` | 刷新 Token |
| POST | `/api/auth/change-password` | 修改密码 |
| POST | `/api/auth/forgot-password` | 忘记密码（发送重置邮件） |
| POST | `/api/auth/reset-password` | 重置密码 |
| POST | `/api/auth/validate-invite` | 验证邀请码 |
| POST | `/api/auth/logout` | 退出登录 |

### 商品（Products）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/products` | 商品列表（支持 type、roleFilter 筛选） |
| GET | `/api/products/:id` | 商品详情 |

### 积分 + 用户（Points & User）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/points/redeem-code` | 兑换积分码 |
| GET | `/api/points/balance` | 查询积分余额 |
| GET | `/api/points/records` | 积分变动记录 |
| GET | `/api/user/profile` | 获取用户资料 |

### 兑换（Redemptions）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/redemptions/points` | 积分兑换商品 |
| POST | `/api/redemptions/code` | Code 兑换商品 |
| GET | `/api/redemptions/history` | 兑换历史 |

### 购物车 + 地址（Cart & Addresses）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cart` | 获取购物车 |
| POST | `/api/cart/items` | 添加商品到购物车 |
| PUT | `/api/cart/items/:productId` | 更新购物车商品数量 |
| DELETE | `/api/cart/items/:productId` | 删除购物车商品 |
| GET | `/api/addresses` | 获取收货地址列表 |
| POST | `/api/addresses` | 新增收货地址 |
| PUT | `/api/addresses/:id` | 更新收货地址 |
| DELETE | `/api/addresses/:id` | 删除收货地址 |
| PATCH | `/api/addresses/:id/default` | 设为默认地址 |

### 订单（Orders）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/orders` | 购物车下单（多商品） |
| POST | `/api/orders/direct` | 直接下单（单商品） |
| GET | `/api/orders` | 订单列表 |
| GET | `/api/orders/:id` | 订单详情 |

### 积分申请（Claims）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/claims` | 提交积分申请 |
| GET | `/api/claims` | 我的申请列表 |
| POST | `/api/claims/upload-url` | 获取申请图片上传 URL |

### Content Hub（内容中心）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/content/upload-url` | 获取内容文件上传 URL |
| POST | `/api/content` | 创建内容 |
| GET | `/api/content` | 内容列表 |
| GET | `/api/content/categories` | 分类列表 |
| GET | `/api/content/:id` | 内容详情 |
| PUT | `/api/content/:id` | 编辑内容 |
| POST | `/api/content/:id/comments` | 添加评论 |
| GET | `/api/content/:id/comments` | 评论列表 |
| POST | `/api/content/:id/like` | 点赞/取消点赞 |
| POST | `/api/content/:id/reserve` | 预约内容 |
| GET | `/api/content/:id/download` | 获取下载链接 |

### 管理后台（Admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/admin/users/:id/roles` | 分配用户角色 |
| PATCH | `/api/admin/users/:id/status` | 启用/禁用用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/products` | 创建商品 |
| PUT | `/api/admin/products/:id` | 编辑商品 |
| PATCH | `/api/admin/products/:id/status` | 上架/下架 |
| POST | `/api/admin/products/:id/upload-url` | 获取商品图片上传 URL |
| DELETE | `/api/admin/products/:id/images/:key` | 删除商品图片 |
| POST | `/api/admin/images/upload-url` | 获取临时上传 URL（创建商品前） |
| POST | `/api/admin/codes/batch-generate` | 批量生成积分码 |
| POST | `/api/admin/codes/product-code` | 生成商品专属码 |
| GET | `/api/admin/codes` | Code 列表 |
| PATCH | `/api/admin/codes/:id/disable` | 禁用 Code |
| DELETE | `/api/admin/codes/:id` | 删除 Code |
| POST | `/api/admin/invites/batch` | 批量生成邀请码 |
| GET | `/api/admin/invites` | 邀请码列表 |
| PATCH | `/api/admin/invites/:token/revoke` | 撤销邀请码 |
| GET | `/api/admin/claims` | 所有积分申请列表 |
| PATCH | `/api/admin/claims/:id/review` | 审批积分申请 |
| GET | `/api/admin/content` | 所有内容列表 |
| PATCH | `/api/admin/content/:id/review` | 审核内容 |
| DELETE | `/api/admin/content/:id` | 删除内容 |
| POST | `/api/admin/content/categories` | 创建内容分类 |
| PUT | `/api/admin/content/categories/:id` | 更新内容分类 |
| DELETE | `/api/admin/content/categories/:id` | 删除内容分类 |
| GET | `/api/admin/orders` | 订单列表（管理） |
| GET | `/api/admin/orders/stats` | 订单统计 |
| GET | `/api/admin/orders/:id` | 订单详情（管理） |
| PATCH | `/api/admin/orders/:id/shipping` | 更新物流状态 |

所有接口（除注册、登录、邮箱验证、邀请码验证外）需要在 Header 中携带 `Authorization: Bearer <token>`。

## 成本估算

在 DAU < 1000 的场景下，月度 AWS 费用约 $7：

| 服务 | 预估月费 |
|------|----------|
| Lambda | ~$1（免费套餐 100 万次/月） |
| API Gateway | ~$3 |
| DynamoDB On-Demand | ~$2 |
| S3 | ~$1 |
| CloudFront | ~$0（1TB 免费/月） |
| SES | ~$0（免费套餐内） |

## 清理资源

如需删除所有 AWS 资源：

```bash
cd packages/cdk

# 先删除主 Region 的 Stacks
npx cdk destroy PointsMall-FrontendStack PointsMall-ApiStack PointsMall-DatabaseStack

# 再删除 us-east-1 的 EdgeSignerStack
npx cdk destroy PointsMall-EdgeSignerStack
```

> 注意：Lambda@Edge 函数的 replica 可能需要几小时才能完全清理，期间 EdgeSignerStack 的删除可能会失败，稍后重试即可。

## License

MIT
