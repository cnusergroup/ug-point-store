# 需求文档：社区凭证系统（Community Credentials）

## 简介

为 AWS User Group China 社区（awscommunity.cn）构建一套在线可验证凭证/证书系统。管理员可以为社区活动（AWS Community Day 等）的志愿者、讲师、工作坊参与者等角色批量签发数字凭证。每个凭证拥有唯一 ID（如 `ACD-BASE-2026-VOL-0002`），可通过公开 URL（`/c/{credentialId}`）在线查看。凭证页面采用 HTML/CSS 渲染（非图片），包含专业的渐变效果、验证状态面板和 QR 码。收件人可将凭证 URL 添加到 LinkedIn 的"执照和认证"板块。系统支持凭证撤销，并通过 OG meta 标签在社交平台上展示预览卡片。

该系统作为现有积分商城项目的一个新模块，复用现有的 AWS Lambda + DynamoDB + API Gateway + CloudFront 技术栈。

## 术语表

- **Credential**：凭证记录，存储在 DynamoDB credentials 表中的一条记录，包含凭证 ID、收件人信息、活动信息、角色、签发日期、状态等
- **Credential_Page**：凭证展示页面，通过公开 URL `/c/{credentialId}` 访问的 HTML 页面，展示凭证的完整信息
- **Credential_ID**：凭证唯一标识符，格式为 `{EVENT_PREFIX}-{YEAR}-{SEASON}-{ROLE_CODE}-{SEQUENCE}`，例如 `ACD-BASE-2026-Summer-VOL-0002`
- **Credential_Status**：凭证状态，包括 `active`（有效）和 `revoked`（已撤销）两种状态
- **Credential_Role**：凭证角色类型，表示收件人在活动中的贡献类型，如 Volunteer（志愿者）、Speaker（讲师）、Workshop（工作坊参与者）、Organizer（组织者）等
- **Batch_Import**：批量导入，管理员通过上传 CSV 文件批量生成凭证的操作
- **Verification_Panel**：验证面板，凭证页面中展示凭证真实性和有效性的区域，包含 QR 码
- **OG_Meta_Tags**：Open Graph 元数据标签，用于社交平台（LinkedIn、Twitter 等）在分享链接时展示预览卡片
- **Credential_Lambda**：凭证服务 Lambda 函数，处理凭证相关的所有 API 请求和页面渲染
- **Admin_Credential_Page**：管理员凭证管理页面，用于批量签发、查看、搜索和撤销凭证
- **Issuing_Organization**：签发组织，签发凭证的社区组织名称，如 "AWS User Group China"

## 需求

### 需求 1：凭证数据模型

**用户故事：** 作为系统，我需要一个结构化的凭证数据模型来存储所有凭证信息，以便支持凭证的创建、查询、展示和撤销。

#### 验收标准

1. THE Credential SHALL 包含以下必填字段：`credentialId`（字符串，主键）、`recipientName`（收件人姓名）、`eventName`（活动名称）、`role`（Credential_Role）、`issueDate`（签发日期）、`issuingOrganization`（签发组织）、`status`（Credential_Status）、`locale`（语言，`zh` 或 `en`）、`createdAt`（创建时间戳）
2. THE Credential SHALL 包含以下可选字段：`eventLocation`（活动地点）、`eventDate`（活动日期）、`contribution`（贡献描述）、`revokedAt`（撤销时间戳）、`revokedBy`（撤销操作者 userId）、`revokeReason`（撤销原因）、`batchId`（批次 ID，用于追踪批量导入）
3. THE Credential_ID SHALL 遵循格式 `{EVENT_PREFIX}-{YEAR}-{SEASON}-{ROLE_CODE}-{SEQUENCE}`，其中 EVENT_PREFIX 为大写字母和连字符组成的活动前缀，YEAR 为四位年份，SEASON 为季节标识（如 Spring、Summer、Fall、Winter），ROLE_CODE 为角色缩写（如 VOL、SPK、WKS、ORG），SEQUENCE 为四位零填充序号。示例：`ACD-BASE-2026-Summer-VOL-0002`
4. THE Credential 的 `status` 字段 SHALL 默认值为 `active`

### 需求 2：凭证 ID 生成与解析

**用户故事：** 作为系统，我需要生成和解析结构化的凭证 ID，以便每个凭证拥有唯一且有意义的标识符。

#### 验收标准

1. WHEN 批量生成凭证时，THE Credential_Lambda SHALL 根据活动前缀、年份、季节和角色代码自动生成递增的序号
2. THE Credential_ID 生成器 SHALL 确保同一活动前缀、年份、季节和角色代码下的序号唯一且递增
3. THE Credential_ID 解析器 SHALL 能从凭证 ID 字符串中提取活动前缀、年份、季节、角色代码和序号
4. FOR ALL 有效的 Credential_ID，解析后再格式化 SHALL 产生与原始 ID 相同的字符串（round-trip 属性）
5. IF 提供的凭证 ID 格式不符合规范，THEN THE Credential_ID 解析器 SHALL 返回描述性错误

### 需求 3：凭证公开展示页面

**用户故事：** 作为凭证收件人，我希望通过一个公开 URL 查看我的凭证，以便向他人展示我的社区贡献。

#### 验收标准

1. WHEN 用户访问 `/c/{credentialId}` 时，THE Credential_Page SHALL 返回一个完整的 HTML 页面，展示凭证的所有信息
2. THE Credential_Page SHALL 使用 HTML/CSS 渲染（非图片），包含专业的渐变背景效果和现代化设计
3. THE Credential_Page SHALL 展示以下信息：收件人姓名、活动名称、角色/贡献类型、签发日期、凭证 ID、签发组织
4. WHEN 凭证包含可选字段（活动地点、活动日期、贡献描述）时，THE Credential_Page SHALL 同时展示这些信息
5. THE Credential_Page SHALL 包含一个 Verification_Panel，显示凭证的验证状态和 QR 码
6. THE Credential_Page SHALL 在移动端和桌面端均有良好的响应式布局
7. WHEN 凭证状态为 `revoked` 时，THE Credential_Page SHALL 显示明确的"已撤销"标记，并隐藏验证通过的状态
8. IF 请求的 credentialId 不存在，THEN THE Credential_Page SHALL 返回 404 页面

### 需求 4：OG Meta 标签与社交分享

**用户故事：** 作为凭证收件人，我希望在 LinkedIn 等社交平台分享凭证链接时能显示专业的预览卡片，以便更好地展示我的成就。

#### 验收标准

1. THE Credential_Page SHALL 包含以下 OG meta 标签：`og:title`（收件人姓名 + 角色）、`og:description`（活动名称和贡献描述）、`og:url`（凭证页面完整 URL）、`og:type`（设为 `website`）、`og:image`（预览图片 URL）
2. THE Credential_Page SHALL 包含 Twitter Card meta 标签：`twitter:card`（设为 `summary_large_image`）、`twitter:title`、`twitter:description`、`twitter:image`
3. THE OG 预览图片 SHALL 为一个动态生成的或预设的社区品牌图片，包含凭证关键信息
4. WHEN 凭证状态为 `revoked` 时，THE OG meta 标签的 description SHALL 包含"已撤销"提示

### 需求 5：LinkedIn 集成

**用户故事：** 作为凭证收件人，我希望能一键将凭证添加到 LinkedIn 的"执照和认证"板块，以便丰富我的职业档案。

#### 验收标准

1. THE Credential_Page SHALL 包含一个"Add to LinkedIn"按钮
2. WHEN 用户点击"Add to LinkedIn"按钮时，THE Credential_Page SHALL 打开 LinkedIn 的认证添加页面，并预填以下信息：认证名称（角色 + 活动名称）、签发组织、签发日期、凭证 URL
3. THE "Add to LinkedIn" 按钮 SHALL 使用 LinkedIn 的官方添加认证 URL 格式
4. WHEN 凭证状态为 `revoked` 时，THE Credential_Page SHALL 隐藏"Add to LinkedIn"按钮

### 需求 6：凭证验证面板

**用户故事：** 作为凭证查看者，我希望能验证凭证的真实性，以便确认凭证是由官方签发且未被篡改。

#### 验收标准

1. THE Verification_Panel SHALL 显示凭证的验证状态文本（如"This credential is verified"）
2. THE Verification_Panel SHALL 包含一个 QR 码，扫描后跳转到当前凭证页面的完整 URL
3. THE Verification_Panel SHALL 显示凭证页面的域名和路径，方便手动验证
4. WHEN 凭证状态为 `active` 时，THE Verification_Panel SHALL 显示绿色的验证通过图标和文本
5. WHEN 凭证状态为 `revoked` 时，THE Verification_Panel SHALL 显示红色的已撤销图标和文本，并说明该凭证已被撤销

### 需求 7：批量凭证生成（CSV 导入）

**用户故事：** 作为管理员，我希望通过上传 CSV 文件批量生成凭证，以便高效地为活动参与者签发凭证。

#### 验收标准

1. THE Admin_Credential_Page SHALL 提供一个 CSV 文件上传区域
2. THE CSV 文件 SHALL 支持以下列：`recipientName`（必填）、`role`（必填）、`eventName`（必填）、`locale`（可选，默认 `zh`，取值 `zh` 或 `en`）、`eventDate`（可选）、`eventLocation`（可选）、`contribution`（可选）、`issuingOrganization`（可选，默认为 "AWS User Group China"）
3. WHEN 管理员上传有效的 CSV 文件时，THE Credential_Lambda SHALL 为每一行生成一个唯一的 Credential，并返回生成结果摘要（成功数、失败数、生成的凭证 ID 列表）
4. IF CSV 文件中包含无效数据行（缺少必填字段或格式错误），THEN THE Credential_Lambda SHALL 跳过该行并在结果中报告错误详情，不影响其他有效行的处理
5. THE 批量生成接口 SHALL 接受 `eventPrefix`、`year` 和 `season` 参数，用于生成凭证 ID 的前缀部分
6. WHEN 批量生成完成后，THE Credential_Lambda SHALL 为本次批量操作生成一个唯一的 `batchId`，并记录在每个凭证的 `batchId` 字段中

### 需求 8：CSV 解析与格式化

**用户故事：** 作为系统，我需要正确解析和验证 CSV 文件内容，以便确保批量导入的数据质量。

#### 验收标准

1. THE CSV 解析器 SHALL 支持 UTF-8 编码（含 BOM）的 CSV 文件
2. THE CSV 解析器 SHALL 正确处理包含逗号、引号和换行符的字段值（遵循 RFC 4180）
3. THE CSV 解析器 SHALL 将解析结果转换为结构化的凭证数据对象数组
4. THE CSV 格式化器 SHALL 能将凭证数据对象数组转换回有效的 CSV 字符串
5. FOR ALL 有效的 CSV 输入，解析后再格式化 SHALL 产生语义等价的 CSV 内容（round-trip 属性）
6. IF CSV 文件为空或仅包含表头行，THEN THE CSV 解析器 SHALL 返回空数组而非错误

### 需求 9：管理员凭证管理

**用户故事：** 作为管理员，我希望能查看、搜索和管理所有已签发的凭证，以便进行日常运维。

#### 验收标准

1. THE Admin_Credential_Page SHALL 展示所有凭证的列表，包含凭证 ID、收件人姓名、活动名称、角色、签发日期、状态
2. THE Admin_Credential_Page SHALL 支持按凭证 ID、收件人姓名和活动名称进行搜索
3. THE Admin_Credential_Page SHALL 支持按状态（active/revoked）筛选凭证
4. THE Admin_Credential_Page SHALL 支持分页浏览，每页默认显示 20 条记录
5. WHEN 管理员点击某条凭证记录时，THE Admin_Credential_Page SHALL 展示该凭证的完整详情，并提供"查看公开页面"的链接

### 需求 10：凭证撤销

**用户故事：** 作为管理员，我希望能撤销已签发的凭证，以便在发现错误或其他原因时使凭证失效。

#### 验收标准

1. THE Admin_Credential_Page SHALL 为每条 `active` 状态的凭证提供"撤销"操作按钮
2. WHEN 管理员点击"撤销"按钮时，THE Admin_Credential_Page SHALL 弹出确认对话框，要求输入撤销原因
3. WHEN 管理员确认撤销操作后，THE Credential_Lambda SHALL 将凭证状态更新为 `revoked`，并记录 `revokedAt`、`revokedBy` 和 `revokeReason`
4. IF 凭证已经处于 `revoked` 状态，THEN THE Credential_Lambda SHALL 返回错误提示"凭证已被撤销"
5. THE 撤销操作 SHALL 仅限 SuperAdmin 角色执行

### 需求 11：凭证 API 接口

**用户故事：** 作为系统，我需要提供 RESTful API 接口来支持凭证的创建、查询、展示和撤销操作。

#### 验收标准

1. THE Credential_Lambda SHALL 提供 `GET /c/{credentialId}` 公开接口，返回凭证展示页面（HTML）
2. THE Credential_Lambda SHALL 提供 `GET /api/admin/credentials` 接口（需认证），返回凭证列表（JSON）
3. THE Credential_Lambda SHALL 提供 `POST /api/admin/credentials/batch` 接口（需认证），接受 CSV 数据并批量生成凭证
4. THE Credential_Lambda SHALL 提供 `PATCH /api/admin/credentials/{credentialId}/revoke` 接口（需认证），撤销指定凭证
5. THE Credential_Lambda SHALL 提供 `GET /api/admin/credentials/{credentialId}` 接口（需认证），返回凭证详情（JSON）
6. THE 公开接口（`GET /c/{credentialId}`）SHALL 不需要任何认证即可访问
7. THE 管理接口 SHALL 仅允许具有 Admin 或 SuperAdmin 角色的用户访问

### 需求 12：凭证页面性能与缓存

**用户故事：** 作为系统，我希望凭证页面能快速加载，以便提供良好的用户体验。

#### 验收标准

1. THE Credential_Page 的 HTML 响应 SHALL 为自包含的单页面（内联 CSS，无外部依赖），以减少加载时间
2. WHEN CloudFront 缓存凭证页面时，THE 系统 SHALL 设置合理的缓存头（如 `Cache-Control: public, max-age=3600`）
3. WHEN 凭证被撤销后，THE 系统 SHALL 能通过 CloudFront 缓存失效机制更新缓存的页面
4. THE Credential_Page 的 HTML 大小 SHALL 控制在合理范围内（不超过 50KB），以确保快速加载

### 需求 13：数据向后兼容与隔离

**用户故事：** 作为系统，我希望凭证模块与现有积分商城系统完全隔离，不影响现有功能的正常运行。

#### 验收标准

1. THE Credential 数据 SHALL 存储在独立的 DynamoDB 表中，不与现有的积分商城表共享
2. THE Credential_Lambda SHALL 作为独立的 Lambda 函数部署，不与现有的 Admin Lambda 共享代码入口
3. THE 凭证相关的 API 路由 SHALL 与现有的积分商城 API 路由不冲突
4. IF 凭证模块出现故障，THEN THE 现有积分商城功能 SHALL 不受影响

### 需求 14：多语言支持（中文/英文）

**用户故事：** 作为管理员，我希望能签发中文或英文版本的凭证，以便适应不同语言背景的社区成员。

#### 验收标准

1. THE Credential 数据模型 SHALL 包含 `locale` 字段，取值为 `zh`（中文）或 `en`（英文）
2. WHEN 凭证的 `locale` 为 `zh` 时，THE Credential_Page SHALL 使用中文渲染所有固定文案（如"已验证"、"签发日期"、"签发组织"、"凭证 ID"、"添加到 LinkedIn"等）
3. WHEN 凭证的 `locale` 为 `en` 时，THE Credential_Page SHALL 使用英文渲染所有固定文案（如 "Verified"、"Issue Date"、"Issuing Organization"、"Credential ID"、"Add to LinkedIn" 等）
4. THE CSV 批量导入 SHALL 支持 `locale` 列（可选，默认为 `zh`），允许管理员为每条凭证指定语言
5. THE OG meta 标签的 title 和 description SHALL 根据凭证的 `locale` 使用对应语言生成
6. THE 凭证页面的角色名称 SHALL 根据 `locale` 显示对应翻译（如 `zh`: 志愿者/讲师/工作坊参与者，`en`: Volunteer/Speaker/Workshop Participant）
