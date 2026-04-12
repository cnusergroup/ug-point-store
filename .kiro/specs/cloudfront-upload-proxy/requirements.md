# 需求文档：CloudFront 上传代理

## 简介

中国大陆用户访问 `*.amazonaws.com` 域名不稳定（DNS 解析慢、丢包、部分运营商间歇性不通），导致通过 S3 presigned URL 直接上传文件频繁失败。本功能通过 CloudFront 自定义域名 `store.awscommunity.cn` 代理上传请求到 S3，使所有文件上传流量走 CloudFront 边缘节点，从根本上解决中国用户的上传可靠性问题。

当前架构中，后端 Lambda 生成指向 `*.s3.ap-northeast-1.amazonaws.com` 的 presigned URL，前端浏览器直接 PUT 到该 URL。改造后，后端返回以 `https://store.awscommunity.cn` 为域名的上传路径，前端 PUT 到 CloudFront，由 CloudFront 转发到 S3 origin。由于 CloudFront OAC 签名与 S3 presigned URL 签名会冲突，需要通过 CloudFront Function 或 Lambda@Edge 在边缘节点对请求重新签名。

## 术语表

- **Upload_Proxy**：CloudFront Distribution 上处理写入请求（PUT）的行为配置，将上传流量从 CloudFront 边缘节点转发到 S3 origin
- **Edge_Signer**：部署在 CloudFront 边缘的函数（CloudFront Function 或 Lambda@Edge），负责对转发到 S3 的 PUT 请求进行 SigV4 签名
- **Upload_URL_Generator**：后端 Lambda 中生成上传 URL 的模块，包括商品图片、Content Hub 文档、积分申请图片三个场景
- **CloudFront_Distribution**：已有的 CloudFront 分发，自定义域名为 `store.awscommunity.cn`
- **Images_Bucket**：存储所有上传文件的 S3 存储桶，包含 `products/*`、`content/*`、`claims/*` 三个前缀路径
- **OAC**：Origin Access Control，CloudFront 访问 S3 的授权机制
- **SigV4**：AWS Signature Version 4，AWS API 请求签名协议

## 需求

### 需求 1：CloudFront 上传行为配置

**用户故事：** 作为系统管理员，我希望 CloudFront Distribution 支持 PUT 方法写入 S3，以便中国用户可以通过自定义域名上传文件。

#### 验收标准

1. THE Upload_Proxy SHALL 在 CloudFront_Distribution 上为 `/products/*`、`/content/*`、`/claims/*` 路径启用 PUT 方法（AllowedMethods 包含 PUT）
2. THE Upload_Proxy SHALL 对上传路径禁用缓存（CachePolicy 设为 CACHING_DISABLED），确保每次 PUT 请求都转发到 S3 origin
3. THE Upload_Proxy SHALL 保留现有的 GET 请求缓存行为，确保文件读取性能不受影响
4. THE Upload_Proxy SHALL 在上传路径的 OriginRequestPolicy 中转发 `Content-Type` 和 `Content-Length` 请求头到 S3 origin

### 需求 2：边缘签名函数

**用户故事：** 作为系统管理员，我希望 CloudFront 边缘节点能自动对 PUT 请求进行 S3 签名，以便上传请求无需携带 presigned URL 签名参数即可写入 S3。

#### 验收标准

1. THE Edge_Signer SHALL 仅对 HTTP PUT 方法的请求执行签名逻辑，对 GET 等其他方法的请求直接放行
2. THE Edge_Signer SHALL 使用 AWS SigV4 协议对 PUT 请求进行签名，生成有效的 Authorization 头
3. THE Edge_Signer SHALL 将签名后的请求转发到 Images_Bucket 对应的 S3 endpoint
4. IF Edge_Signer 签名过程发生错误，THEN THE Edge_Signer SHALL 返回 HTTP 500 状态码和 JSON 格式的错误信息
5. THE Edge_Signer SHALL 部署在 us-east-1 区域（Lambda@Edge 部署要求）

### 需求 3：上传鉴权与安全控制

**用户故事：** 作为系统管理员，我希望通过 CloudFront 代理的上传请求具备鉴权机制，以防止未授权用户上传文件。

#### 验收标准

1. THE Upload_Proxy SHALL 要求上传请求携带有效的鉴权令牌（通过自定义请求头或查询参数传递）
2. THE Edge_Signer SHALL 在执行 S3 签名之前验证鉴权令牌的有效性
3. IF 上传请求未携带鉴权令牌或令牌无效，THEN THE Edge_Signer SHALL 返回 HTTP 403 状态码并拒绝请求
4. THE Upload_URL_Generator SHALL 在生成上传 URL 时包含一次性或有时效的鉴权令牌
5. THE Edge_Signer SHALL 验证上传路径与鉴权令牌中授权的 S3 Key 一致，防止路径篡改

### 需求 4：后端上传 URL 生成改造

**用户故事：** 作为开发者，我希望后端 Lambda 返回基于 CloudFront 域名的上传 URL，以便前端无需修改即可通过 CloudFront 上传。

#### 验收标准

1. THE Upload_URL_Generator SHALL 为商品图片上传生成格式为 `https://store.awscommunity.cn/products/{productId}/{fileId}.{ext}` 的上传 URL
2. THE Upload_URL_Generator SHALL 为 Content Hub 文档上传生成格式为 `https://store.awscommunity.cn/content/{userId}/{fileId}/{fileName}` 的上传 URL
3. THE Upload_URL_Generator SHALL 为积分申请图片上传生成格式为 `https://store.awscommunity.cn/claims/{userId}/{fileId}.{ext}` 的上传 URL
4. THE Upload_URL_Generator SHALL 在上传 URL 中附加鉴权令牌参数（如查询字符串 `?token=xxx`）
5. THE Upload_URL_Generator SHALL 生成的鉴权令牌有效期为 300 秒（与原 presigned URL 过期时间一致）
6. THE Upload_URL_Generator SHALL 在鉴权令牌中编码授权的 S3 Key，防止令牌被用于上传到其他路径

### 需求 5：前端上传逻辑适配

**用户故事：** 作为前端开发者，我希望前端上传逻辑能无缝切换到 CloudFront 上传 URL，以便用户体验不受影响。

#### 验收标准

1. WHEN 后端返回上传 URL 时，THE 前端上传模块 SHALL 使用返回的 URL 直接执行 HTTP PUT 请求，无需区分 S3 presigned URL 和 CloudFront URL
2. THE 前端上传模块 SHALL 在 PUT 请求中携带正确的 `Content-Type` 请求头
3. THE 前端上传模块 SHALL 支持上传任意大小的文件，不受 CloudFront 默认请求体大小限制
4. IF 上传请求返回 HTTP 403 状态码，THEN THE 前端上传模块 SHALL 向用户显示"上传授权已过期，请重新获取上传链接"的错误提示

### 需求 6：CDK 基础设施配置

**用户故事：** 作为 DevOps 工程师，我希望通过 CDK 代码管理所有基础设施变更，以便部署可重复且可审计。

#### 验收标准

1. THE CDK 配置 SHALL 修改 CloudFront_Distribution 的 `/products/*`、`/content/*`、`/claims/*` 行为，启用 PUT 方法并关联 Edge_Signer
2. THE CDK 配置 SHALL 创建 Lambda@Edge 函数资源，运行时为 Node.js 20.x，部署区域为 us-east-1
3. THE CDK 配置 SHALL 为 Edge_Signer Lambda 授予对 Images_Bucket 的 `s3:PutObject` 权限
4. THE CDK 配置 SHALL 将 Images_Bucket 名称和区域作为环境变量或参数传递给 Edge_Signer Lambda
5. THE CDK 配置 SHALL 保留现有的 OAC 配置用于 GET 请求，确保文件读取行为不变
6. THE CDK 配置 SHALL 配置 CloudFront 上传路径的 CORS 响应头，允许 `store.awscommunity.cn` 域名的跨域 PUT 请求

### 需求 7：上传可靠性与错误处理

**用户故事：** 作为中国大陆用户，我希望文件上传稳定可靠，即使网络环境不佳也能成功上传。

#### 验收标准

1. WHEN 上传请求通过 CloudFront 边缘节点转发时，THE Upload_Proxy SHALL 确保请求到达 S3 origin 的延迟低于直接访问 `*.amazonaws.com` 域名
2. IF 上传请求因网络原因失败，THEN THE 前端上传模块 SHALL 自动重试最多 2 次，每次间隔 2 秒
3. IF 所有重试均失败，THEN THE 前端上传模块 SHALL 向用户显示明确的错误提示，包含"网络不稳定，请稍后重试"的信息
4. THE Upload_Proxy SHALL 不限制上传请求体大小（CloudFront 默认支持最大 20GB 的请求体，满足所有上传场景）

### 需求 8：向后兼容与渐进迁移

**用户故事：** 作为系统管理员，我希望新旧上传方式可以共存，以便在出现问题时可以快速回退。

#### 验收标准

1. THE Upload_URL_Generator SHALL 支持通过环境变量 `UPLOAD_VIA_CLOUDFRONT` 控制是否启用 CloudFront 上传代理
2. WHILE `UPLOAD_VIA_CLOUDFRONT` 环境变量未设置或值为 `false` 时，THE Upload_URL_Generator SHALL 继续生成原有的 S3 presigned URL
3. WHILE `UPLOAD_VIA_CLOUDFRONT` 环境变量值为 `true` 时，THE Upload_URL_Generator SHALL 生成基于 CloudFront 域名的上传 URL
4. THE 前端上传模块 SHALL 兼容两种上传 URL 格式（S3 presigned URL 和 CloudFront URL），无需代码变更即可切换
