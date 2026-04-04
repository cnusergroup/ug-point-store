# ◆ 积分商城（Points Mall）

一个基于 AWS Serverless 架构的社区积分商城系统，用于激励 UserGroupLeader、CommunityBuilder、Speaker 和 Volunteer 参与社区活动。用户通过兑换码获取积分，在商城中使用积分或专属 Code 兑换商品。

## 功能概览

- **多端支持**：PC 浏览器、手机浏览器、微信小程序（Taro 框架）
- **双重登录**：微信扫码登录 + 邮箱注册登录
- **角色权限**：4 种用户身份（Leader / Builder / Speaker / Volunteer），商品可按身份限定兑换
- **积分体系**：通过兑换码获取积分，积分兑换商品
- **Code 专属商品**：特定活动商品仅通过专属 Code 兑换，不消耗积分
- **管理后台**：商品管理、Code 批量生成、用户角色管理

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + Taro（H5 + 微信小程序）、Zustand、SCSS |
| 后端 | Node.js 20.x + TypeScript、AWS Lambda |
| API | Amazon API Gateway（REST） |
| 数据库 | Amazon DynamoDB（On-Demand） |
| 存储 | Amazon S3（静态资源 + 商品图片） |
| CDN | Amazon CloudFront |
| 邮件 | Amazon SES |
| IaC | AWS CDK（TypeScript） |
| 测试 | Vitest + fast-check（属性测试） |

## 项目结构

```
points-mall/
├── packages/
│   ├── shared/          # 共享类型定义和错误码
│   ├── backend/         # Lambda 函数（5 个服务）
│   │   └── src/
│   │       ├── auth/        # 认证服务（登录、注册、微信、JWT）
│   │       ├── products/    # 商品服务（列表、详情）
│   │       ├── points/      # 积分服务（兑换码、余额、记录）
│   │       ├── redemptions/ # 兑换服务（积分兑换、Code 兑换）
│   │       ├── admin/       # 管理服务（角色、商品、Code）
│   │       ├── middleware/   # 认证中间件
│   │       └── user/        # 用户资料
│   ├── cdk/             # AWS CDK 基础设施定义
│   │   ├── bin/app.ts
│   │   └── lib/
│   │       ├── database-stack.ts   # DynamoDB 表
│   │       ├── api-stack.ts        # API Gateway + Lambda
│   │       └── frontend-stack.ts   # S3 + CloudFront
│   └── frontend/        # Taro 前端应用
│       └── src/
│           ├── pages/       # 页面组件
│           ├── store/       # Zustand 状态管理
│           └── utils/       # 请求封装
├── package.json         # Monorepo 根配置
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
git clone https://github.com/your-org/points-mall.git
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

### 1. 配置环境变量

部署前需要准备以下配置：

| 配置项 | 说明 | 获取方式 |
|--------|------|----------|
| `jwtSecret` | JWT 签名密钥 | 自行生成一个强随机字符串 |
| `wechatAppId` | 微信开放平台 AppID | [微信开放平台](https://open.weixin.qq.com/) |
| `wechatAppSecret` | 微信开放平台 AppSecret | 同上 |
| `senderEmail` | SES 发件邮箱 | 需在 AWS SES 中验证 |

### 2. 验证 SES 发件邮箱

```bash
aws ses verify-email-identity --email-address your-email@example.com
```

收到验证邮件后点击链接完成验证。

### 3. 部署 AWS 基础设施

```bash
# 预览将要创建的资源
npm run synth

# 部署所有 Stack（DatabaseStack → ApiStack → FrontendStack）
npm run deploy -- --context jwtSecret="your-jwt-secret" \
                  --context wechatAppId="wx1234567890" \
                  --context wechatAppSecret="your-wechat-secret" \
                  --context senderEmail="noreply@example.com"
```

部署完成后，终端会输出：
- `PointsMall-ApiUrl`：API Gateway 地址
- `PointsMall-DistributionDomain`：CloudFront 域名
- `PointsMall-StaticBucketName`：静态资源 S3 桶名
- `PointsMall-ImagesBucketName`：商品图片 S3 桶名

### 4. 构建并部署前端（H5）

```bash
# 构建 H5 版本
npm run build:frontend

# 部署到 S3 + 刷新 CloudFront 缓存
export STATIC_BUCKET=<上一步输出的 StaticBucketName>
export CF_DIST_ID=<CloudFront Distribution ID>
npm run deploy:frontend
```

部署完成后，通过 CloudFront 域名即可访问商城。

### 5. 配置自定义域名（可选）

如需绑定自定义域名，在 CloudFront 控制台添加 CNAME 并配置 ACM 证书。

## 微信小程序发布

### 1. 注册小程序

前往 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序账号，获取 AppID。

### 2. 配置项目

编辑 `packages/frontend/project.config.json`，将 `appid` 替换为你的小程序 AppID：

```json
{
  "appid": "你的小程序AppID",
  ...
}
```

### 3. 配置服务器域名

在微信公众平台 → 开发管理 → 开发设置 → 服务器域名中，添加：

- request 合法域名：`https://你的API Gateway域名`
- uploadFile 合法域名：`https://你的S3桶域名`（如需上传图片）

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

1. 创建网站应用，填写网站域名（CloudFront 域名）
2. 获取 AppID 和 AppSecret
3. 设置授权回调域名
4. 将 AppID 和 AppSecret 通过 CDK context 传入部署

## API 接口

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 邮箱注册 |
| POST | `/api/auth/login` | 邮箱登录 |
| GET | `/api/auth/verify-email?token=xxx` | 邮箱验证 |
| POST | `/api/auth/wechat/qrcode` | 获取微信二维码 |
| POST | `/api/auth/wechat/callback` | 微信登录回调 |
| POST | `/api/auth/refresh` | 刷新 Token |

### 商品

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/products` | 商品列表（支持 type、roleFilter 筛选） |
| GET | `/api/products/:id` | 商品详情 |

### 积分

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/points/redeem-code` | 兑换积分码 |
| GET | `/api/points/balance` | 查询积分余额 |
| GET | `/api/points/records` | 积分变动记录 |

### 兑换

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/redemptions/points` | 积分兑换商品 |
| POST | `/api/redemptions/code` | Code 兑换商品 |
| GET | `/api/redemptions/history` | 兑换历史 |

### 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/admin/users/:id/roles` | 分配用户角色 |
| POST | `/api/admin/products` | 创建商品 |
| PUT | `/api/admin/products/:id` | 编辑商品 |
| PATCH | `/api/admin/products/:id/status` | 上架/下架 |
| POST | `/api/admin/codes/batch-generate` | 批量生成积分码 |
| POST | `/api/admin/codes/product-code` | 生成商品专属码 |
| GET | `/api/admin/codes` | Code 列表 |
| PATCH | `/api/admin/codes/:id/disable` | 禁用 Code |

所有接口（除注册、登录、邮箱验证外）需要在 Header 中携带 `Authorization: Bearer <token>`。

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
npx cdk destroy --all
```

## License

MIT
