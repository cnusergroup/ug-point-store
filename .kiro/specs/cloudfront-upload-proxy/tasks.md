# 实现计划：CloudFront 上传代理

## 概述

将文件上传流量从直接访问 `*.amazonaws.com` 改为通过 CloudFront 自定义域名 `store.awscommunity.cn` 代理到 S3。核心变更包括：上传鉴权令牌模块、Lambda@Edge 边缘签名函数、CDK 基础设施改造、后端上传 URL 生成改造、前端上传重试与错误处理。使用 Vitest + fast-check 进行测试。

## 任务

- [x] 1. 上传鉴权令牌模块
  - [x] 1.1 实现上传令牌生成与验证工具
    - 创建 `packages/backend/src/utils/upload-token.ts`
    - 实现 `generateUploadToken(input: { key: string; expiresIn?: number }, secret: string): { token: string }` 函数：
      - 构造 payload：`{ k: key, e: Math.floor(Date.now()/1000) + expiresIn }`，默认 expiresIn=300
      - 令牌格式：`base64url(JSON.stringify(payload)) + '.' + base64url(hmac_sha256(payloadStr, secret))`
      - 使用 Node.js 内置 `crypto` 模块的 `createHmac('sha256', secret)` 计算签名
    - 实现 `verifyUploadToken(token: string, secret: string): { valid: boolean; key?: string; error?: string }` 函数：
      - 拆分 token 为 payload 和 signature 两部分
      - 验证 HMAC 签名一致性
      - 验证 `exp` 未过期（当前时间 ≤ exp）
      - 返回解码后的 key
    - 实现 base64url 编码/解码辅助函数（替换 `+/=` 为 `-_`，去除 padding）
    - _需求: 3.4, 4.4, 4.5, 4.6_

  - [x] 1.2 编写上传令牌单元测试
    - 创建 `packages/backend/src/utils/upload-token.test.ts`
    - 测试用例：
      - 生成令牌后验证成功，返回正确的 key
      - 篡改签名后验证失败
      - 过期令牌验证失败
      - 空 token / 格式错误 token 验证失败
      - 不同 secret 验证失败
    - _需求: 3.1, 3.2, 3.4, 4.5_

  - [x] 1.3 编写令牌往返一致性属性测试
    - **Property 5: 令牌往返一致性**
    - 创建 `packages/backend/src/utils/upload-token.property.test.ts`
    - 使用 fast-check 生成随机 S3 Key（`fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_/.'))`），验证 `generateUploadToken` 生成的令牌经 `verifyUploadToken` 解析后 key 完全一致，且 exp 在 [now+299, now+301] 范围内
    - **验证: 需求 4.5, 4.6, 3.4**

  - [x] 1.4 编写无效令牌拒绝属性测试
    - **Property 2: 无效令牌拒绝访问**
    - 在 `packages/backend/src/utils/upload-token.property.test.ts` 中添加
    - 使用 fast-check 生成随机字符串作为令牌，验证 `verifyUploadToken` 返回 `valid: false`
    - 使用 fast-check 生成有效令牌后修改 payload 中的 key，验证签名验证失败
    - **验证: 需求 3.1, 3.2, 3.3**

  - [x] 1.5 编写路径篡改防护属性测试
    - **Property 3: 路径篡改防护**
    - 在 `packages/backend/src/utils/upload-token.property.test.ts` 中添加
    - 使用 fast-check 生成两个不同的 S3 Key（keyA, keyB，且 keyA ≠ keyB），用 keyA 生成令牌，验证令牌中解码出的 key 为 keyA 而非 keyB
    - **验证: 需求 3.5**

- [x] 2. Lambda@Edge 边缘签名函数
  - [x] 2.1 实现 Edge Signer Lambda@Edge 函数
    - 创建 `packages/cdk/lambda/edge-signer/index.ts`
    - 实现 CloudFront origin-request handler：
      - 非 PUT 请求直接返回 `request`（放行）
      - PUT 请求处理流程：
        1. 从 querystring 解析 `token` 参数
        2. 调用 `verifyUploadToken` 验证令牌有效性
        3. 验证请求 URI（去掉前导 `/`）与令牌中的 key 一致
        4. 使用 AWS SigV4 手动签名：构造 CanonicalRequest → StringToSign → 计算签名 → 设置 Authorization 头
        5. 设置 `Host` 头为 `{bucketName}.s3.{region}.amazonaws.com`
        6. 移除 querystring 中的 token 参数（避免传递给 S3）
      - 错误响应：返回 JSON 格式的 `{ error, message }` 和对应 HTTP 状态码
    - 配置常量（构建时注入）：`BUCKET_NAME`、`BUCKET_REGION`（ap-northeast-1）、`TOKEN_SECRET`
    - Lambda@Edge 不支持环境变量，使用构建时替换或硬编码方式注入配置
    - 使用 Node.js 内置 `crypto` 模块实现 SigV4 签名（不依赖 AWS SDK，减小包体积）
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.5_

  - [x] 2.2 编写 Edge Signer 单元测试
    - 创建 `packages/cdk/lambda/edge-signer/index.test.ts`
    - 构造 mock CloudFrontRequestEvent 对象测试：
      - GET 请求直接放行，不修改任何头
      - PUT 请求携带有效 token，返回带 Authorization 头的请求
      - PUT 请求无 token，返回 403 + MISSING_TOKEN
      - PUT 请求 token 过期，返回 403 + TOKEN_EXPIRED
      - PUT 请求 token 签名无效，返回 403 + INVALID_TOKEN
      - PUT 请求路径与 token key 不匹配，返回 403 + PATH_MISMATCH
      - 验证 SigV4 Authorization 头格式：`AWS4-HMAC-SHA256 Credential=.../s3/aws4_request, SignedHeaders=..., Signature=...`
    - 需要 mock AWS credentials（通过环境变量 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`）
    - _需求: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.5_

  - [x] 2.3 编写 PUT-only 签名属性测试
    - **Property 1: 仅对 PUT 请求执行签名**
    - 创建 `packages/cdk/lambda/edge-signer/index.property.test.ts`
    - 使用 fast-check 从 `['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PATCH', 'POST']` 中随机选择非 PUT 方法，构造 CloudFrontRequestEvent，验证 handler 返回原始 request 且不包含 Authorization 头
    - **验证: 需求 2.1**

- [x] 3. 检查点 - 令牌与签名模块验证
  - 运行 `npx vitest run packages/backend/src/utils/upload-token` 和 `npx vitest run packages/cdk/lambda/edge-signer` 确保所有测试通过。如有问题请向用户确认。

- [x] 4. 后端上传 URL 生成改造
  - [x] 4.1 改造商品图片上传 URL 生成
    - 修改 `packages/backend/src/admin/images.ts`：
      - 导入 `generateUploadToken` 从 `../utils/upload-token`
      - 读取环境变量 `UPLOAD_VIA_CLOUDFRONT`、`UPLOAD_TOKEN_SECRET`、`CLOUDFRONT_DOMAIN`（默认 `https://store.awscommunity.cn`）
      - 在 `getUploadUrl` 和 `getTempUploadUrl` 函数中：
        - 当 `UPLOAD_VIA_CLOUDFRONT === 'true'` 时，生成 `${CLOUDFRONT_DOMAIN}/${key}?token=${token}` 格式的 uploadUrl
        - 否则保留原有 S3 presigned URL 逻辑
      - 确保 `UPLOAD_TOKEN_SECRET` 未配置时抛出配置错误（仅在 CloudFront 模式下）
    - _需求: 4.1, 4.4, 8.1, 8.2, 8.3_

  - [x] 4.2 改造 Content Hub 文档上传 URL 生成
    - 修改 `packages/backend/src/content/upload.ts`：
      - 导入 `generateUploadToken` 从 `../utils/upload-token`
      - 读取环境变量 `UPLOAD_VIA_CLOUDFRONT`、`UPLOAD_TOKEN_SECRET`、`CLOUDFRONT_DOMAIN`
      - 在 `getContentUploadUrl` 函数中：
        - 当 `UPLOAD_VIA_CLOUDFRONT === 'true'` 时，生成 `${CLOUDFRONT_DOMAIN}/${fileKey}?token=${token}` 格式的 uploadUrl
        - 否则保留原有 S3 presigned URL 逻辑
    - _需求: 4.2, 4.4, 8.1, 8.2, 8.3_

  - [x] 4.3 改造积分申请图片上传 URL 生成
    - 修改 `packages/backend/src/claims/images.ts`：
      - 导入 `generateUploadToken` 从 `../utils/upload-token`
      - 读取环境变量 `UPLOAD_VIA_CLOUDFRONT`、`UPLOAD_TOKEN_SECRET`、`CLOUDFRONT_DOMAIN`
      - 在 `getClaimUploadUrl` 函数中：
        - 当 `UPLOAD_VIA_CLOUDFRONT === 'true'` 时，生成 `${CLOUDFRONT_DOMAIN}/${key}?token=${token}` 格式的 uploadUrl
        - 否则保留原有 S3 presigned URL 逻辑
    - _需求: 4.3, 4.4, 8.1, 8.2, 8.3_

  - [x] 4.4 更新后端上传 URL 生成单元测试
    - 更新 `packages/backend/src/admin/images.test.ts`：
      - 新增测试：`UPLOAD_VIA_CLOUDFRONT=true` 时 `getUploadUrl` 返回 CloudFront 域名 URL + token 参数
      - 新增测试：`UPLOAD_VIA_CLOUDFRONT=true` 时 `getTempUploadUrl` 返回 CloudFront 域名 URL + token 参数
      - 新增测试：`UPLOAD_VIA_CLOUDFRONT` 未设置时返回 S3 presigned URL
      - 新增测试：`UPLOAD_VIA_CLOUDFRONT=true` 但 `UPLOAD_TOKEN_SECRET` 未设置时抛出错误
    - 更新 `packages/backend/src/content/upload.test.ts`：
      - 新增测试：CloudFront 模式下 `getContentUploadUrl` 返回正确格式 URL
    - 新增或更新 claims images 测试（如不存在则创建 `packages/backend/src/claims/images.test.ts`）
    - _需求: 4.1, 4.2, 4.3, 4.4, 8.1, 8.2, 8.3_

  - [x] 4.5 编写上传 URL 格式正确性属性测试
    - **Property 4: 上传 URL 格式正确性**
    - 创建 `packages/backend/src/admin/images.property.test.ts`
    - 使用 fast-check 生成随机 productId、fileName（带合法扩展名），设置 `UPLOAD_VIA_CLOUDFRONT=true`，验证：
      - 商品图片 URL 匹配 `https://store.awscommunity.cn/products/{productId}/{fileId}.{ext}?token=...`
      - URL 中包含 `token=` 查询参数
    - **验证: 需求 4.1, 4.4**

  - [x] 4.6 编写功能开关控制属性测试
    - **Property 6: 功能开关控制 URL 格式**
    - 在 `packages/backend/src/admin/images.property.test.ts` 中添加
    - 使用 fast-check 生成随机上传参数，分别在 `UPLOAD_VIA_CLOUDFRONT=true` 和 `false` 下调用，验证：
      - `true` 时 URL 域名为 `store.awscommunity.cn`
      - `false` 时 URL 域名包含 `s3.ap-northeast-1.amazonaws.com`
    - **验证: 需求 8.1, 8.2, 8.3**

- [x] 5. 检查点 - 后端改造验证
  - 运行 `npx vitest run packages/backend/src/admin/images` 和 `npx vitest run packages/backend/src/content/upload` 和 `npx vitest run packages/backend/src/claims/images` 确保所有测试通过。如有问题请向用户确认。

- [x] 6. CDK 基础设施变更
  - [x] 6.1 创建 Lambda@Edge 函数 CDK 资源
    - 修改 `packages/cdk/lib/frontend-stack.ts`：
      - 导入 `aws-lambda`、`aws-lambda-nodejs`、`aws-iam` 模块
      - 在 FrontendStackProps 中新增 `uploadTokenSecret: string` 属性
      - 创建 Lambda@Edge 函数（`NodejsFunction`）：
        - 入口：`../../cdk/lambda/edge-signer/index.ts`（相对路径）
        - 运行时：Node.js 20.x
        - 内存：128MB
        - 超时：5 秒
        - 使用 `edgeLambda` 属性关联到 CloudFront behavior
      - 构建时通过 esbuild `define` 选项注入配置常量：
        - `process.env.BUCKET_NAME` → imagesBucket.bucketName
        - `process.env.BUCKET_REGION` → `'ap-northeast-1'`
        - `process.env.TOKEN_SECRET` → uploadTokenSecret
      - 为 Lambda@Edge 的执行角色授予 `s3:PutObject` 权限（对 imagesBucket 的 `products/*`、`content/*`、`claims/*` 路径）
      - 为 Lambda@Edge 的执行角色添加 `edgelambda.amazonaws.com` 和 `lambda.amazonaws.com` 信任策略
    - _需求: 6.2, 6.3, 6.4_

  - [x] 6.2 改造 CloudFront Distribution 行为配置
    - 修改 `packages/cdk/lib/frontend-stack.ts`：
      - 为 `/products/*`、`/content/*`、`/claims/*` 行为：
        - 将 `allowedMethods` 改为 `AllowedMethods.ALLOW_ALL`（包含 PUT）
        - 将 `cachePolicy` 改为 `CachePolicy.CACHING_DISABLED`（PUT 请求不缓存；GET 缓存由 origin Cache-Control 头控制）
        - 关联 Lambda@Edge 函数到 `edgeLambdas` 的 `ORIGIN_REQUEST` 事件
        - 配置 `originRequestPolicy` 转发 `Content-Type`、`Content-Length` 头
      - 配置 CORS 响应头策略（ResponseHeadersPolicy）：
        - `Access-Control-Allow-Origin`: `https://store.awscommunity.cn`
        - `Access-Control-Allow-Methods`: `GET, PUT, OPTIONS`
        - `Access-Control-Allow-Headers`: `Content-Type, Content-Length`
    - _需求: 1.1, 1.2, 1.3, 1.4, 6.1, 6.5, 6.6_

  - [x] 6.3 更新 CDK App 入口传递参数
    - 修改 `packages/cdk/bin/app.ts`：
      - 从 CDK context 读取 `uploadTokenSecret` 参数
      - 将 `uploadTokenSecret` 传递给 FrontendStack
      - 为 ApiStack 的 adminFn、contentFn、pointsFn 添加 `UPLOAD_VIA_CLOUDFRONT` 和 `UPLOAD_TOKEN_SECRET` 环境变量
    - 修改 `packages/cdk/lib/api-stack.ts`：
      - 在 `configureImagesBucket` 方法中新增 `uploadViaCloudfront` 和 `uploadTokenSecret` 参数
      - 为 adminFn、contentFn、pointsFn 添加 `UPLOAD_VIA_CLOUDFRONT` 和 `UPLOAD_TOKEN_SECRET` 环境变量
    - _需求: 6.4, 8.1_

  - [x] 6.4 编写 CDK 基础设施单元测试
    - 创建或更新 `packages/cdk/test/frontend-stack.test.ts`
    - 使用 CDK assertions 库验证合成的 CloudFormation 模板：
      - CloudFront Distribution 的 `/products/*`、`/content/*`、`/claims/*` 行为包含 PUT 方法
      - Lambda@Edge 函数配置正确（运行时 Node.js 20.x）
      - Lambda@Edge IAM Role 包含 `s3:PutObject` 权限
      - CORS 响应头策略配置正确
      - 现有 OAC 配置保留
    - _需求: 6.1, 6.2, 6.3, 6.5, 6.6_

- [x] 7. 检查点 - CDK 基础设施验证
  - 运行 `npx cdk synth` 确保 CloudFormation 模板合成成功，运行 CDK 测试确保通过。如有问题请向用户确认。

- [x] 8. 前端上传逻辑适配
  - [x] 8.1 为前端上传添加重试机制和错误处理
    - 修改 `packages/frontend/src/pages/admin/products.tsx`：
      - 在 `handleUploadImage` 函数中的 `fetch(uploadInfo.uploadUrl, ...)` 调用处：
        - 包装为重试逻辑：失败后自动重试最多 2 次，每次间隔 2 秒
        - HTTP 403 响应特殊处理：不重试，直接提示"上传授权已过期，请重新获取上传链接"
        - 网络错误（fetch 抛出异常）：重试后仍失败则提示"网络不稳定，请稍后重试"
        - HTTP 500 响应：提示"服务器错误，请稍后重试"
    - _需求: 5.1, 5.2, 5.4, 7.2, 7.3_

  - [x] 8.2 为 Content Hub 上传添加重试机制和错误处理
    - 修改 `packages/frontend/src/pages/content/upload.tsx`：
      - 在 `uploadFileToS3` 函数中的 `fetch(uploadUrl, ...)` 调用处：
        - 包装为重试逻辑：失败后自动重试最多 2 次，每次间隔 2 秒
        - HTTP 403 响应特殊处理：不重试，直接提示"上传授权已过期"
        - 网络错误：重试后仍失败则提示"网络不稳定，请稍后重试"
    - _需求: 5.1, 5.2, 5.4, 7.2, 7.3_

  - [x] 8.3 提取上传重试工具函数（可选重构）
    - 考虑创建 `packages/frontend/src/utils/upload.ts` 提取公共的重试逻辑：
      - `uploadWithRetry(url: string, options: RequestInit, maxRetries?: number, retryDelay?: number): Promise<Response>`
      - 统一处理 403、500、网络错误
    - 在 `products.tsx` 和 `content/upload.tsx` 中复用
    - _需求: 5.1, 5.2, 5.4, 7.2, 7.3, 8.4_

  - [x] 8.4 更新前端 i18n 翻译
    - 在 `packages/frontend/src/i18n/types.ts` 的 `TranslationDict` 中新增上传错误相关键：
      - `upload.tokenExpired`：上传授权已过期，请重新获取上传链接
      - `upload.networkUnstable`：网络不稳定，请稍后重试
      - `upload.serverError`：服务器错误，请稍后重试
    - 在 5 种语言文件（zh.ts、en.ts、ja.ts、ko.ts、zh-TW.ts）中添加对应翻译
    - _需求: 5.4, 7.3_

- [x] 9. 最终检查点 - 全面验证
  - 运行 `npx vitest run` 确保所有测试通过，运行 `npx cdk synth` 确保 CDK 合成成功。如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- Lambda@Edge 必须部署在 us-east-1，CDK 会自动处理跨区域复制
- Lambda@Edge 不支持环境变量，bucket 名称和 token secret 通过 esbuild `define` 在构建时注入
- `UPLOAD_VIA_CLOUDFRONT` 环境变量作为功能开关，允许渐进迁移和快速回退
- 前端无需区分 S3 presigned URL 和 CloudFront URL，直接使用后端返回的 uploadUrl 执行 PUT
- 属性测试验证设计文档中定义的 6 个正确性属性
- 每个检查点确保增量开发的正确性
