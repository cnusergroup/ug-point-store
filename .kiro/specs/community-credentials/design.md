# Design Document: Community Credentials (社区凭证系统)

## Overview

社区凭证系统为 AWS User Group China 社区活动参与者签发可验证的数字凭证。系统作为现有积分商城项目的独立模块，使用独立的 Lambda 函数和 DynamoDB 表，通过现有 CloudFront 分发的 API Gateway 行为路由请求。

核心能力：
- **凭证签发**：管理员通过 CSV 批量导入为志愿者、讲师、工作坊参与者等角色签发凭证
- **公开展示**：每个凭证通过 `/c/{credentialId}` 公开访问，HTML/CSS 渲染的专业证书页面
- **验证机制**：QR 码 + 验证面板确认凭证真实性
- **社交集成**：OG meta 标签支持 LinkedIn/Twitter 预览卡片，一键添加到 LinkedIn 认证
- **多语言**：支持中文（zh）和英文（en）
- **撤销管理**：SuperAdmin 可撤销已签发凭证

### Design Decisions

1. **独立 Lambda 函数**：凭证模块使用独立的 `PointsMall-Credential` Lambda，不与现有 Admin Lambda 共享入口。这确保凭证模块故障不影响积分商城核心功能，也避免 Admin Lambda 代码体积进一步膨胀。

2. **CloudFront `/c/*` 行为路由**：公开凭证页面通过 CloudFront 的 `/c/*` 行为路由到 API Gateway，再由 Credential Lambda 处理。这复用现有 CDN 基础设施，无需额外域名或分发。

3. **HTML 服务端渲染（SSR）**：凭证页面由 Lambda 直接返回完整 HTML（内联 CSS，无外部依赖）。这确保社交平台爬虫能正确读取 OG meta 标签，同时实现快速首屏加载。

4. **QR 码内联 SVG**：使用 `qrcode` 库在服务端生成 QR 码 SVG，内联到 HTML 中。避免外部依赖和额外请求。

5. **凭证 ID 序号通过 DynamoDB 原子计数器实现**：使用 DynamoDB 的 `ADD` 操作实现原子递增序号，确保并发安全。

## Architecture

```mermaid
graph TB
    subgraph "Client"
        Browser[浏览器/社交平台爬虫]
        AdminUI[管理员前端 Taro H5]
    end

    subgraph "CDN Layer"
        CF[CloudFront Distribution]
    end

    subgraph "API Layer"
        APIGW[API Gateway RestApi]
    end

    subgraph "Compute Layer"
        CredFn[Credential Lambda<br/>PointsMall-Credential]
    end

    subgraph "Data Layer"
        CredTable[DynamoDB<br/>PointsMall-Credentials]
        CredSeqTable[DynamoDB<br/>PointsMall-CredentialSequences]
        UsersTable[DynamoDB<br/>PointsMall-Users<br/>existing - read only]
    end

    Browser -->|GET /c/{id}| CF
    AdminUI -->|/api/admin/credentials/*| CF
    CF -->|/c/*| APIGW
    CF -->|/api/*| APIGW
    APIGW -->|credential routes| CredFn
    CredFn --> CredTable
    CredFn --> CredSeqTable
    CredFn -->|verify auth| UsersTable
```

### Request Flow

**公开凭证页面**：
1. 用户/爬虫访问 `https://store.awscommunity.cn/c/ACD-BASE-2026-Summer-VOL-0002`
2. CloudFront `/c/*` 行为 → API Gateway → Credential Lambda
3. Lambda 从 DynamoDB 读取凭证数据，渲染 HTML（含 OG meta、QR 码、i18n 文案）
4. 返回 HTML 响应，CloudFront 缓存（`Cache-Control: public, max-age=3600`）

**管理员操作**：
1. 管理员通过 Taro H5 前端访问 `/api/admin/credentials/*`
2. CloudFront `/api/*` 行为 → API Gateway → Credential Lambda
3. Lambda 验证 JWT token（复用现有 auth middleware），检查 Admin/SuperAdmin 角色
4. 执行 CRUD 操作并返回 JSON 响应

## Components and Interfaces

### 1. Credential Lambda Handler (`packages/backend/src/credentials/handler.ts`)

Lambda 入口，路由所有凭证相关请求。

```typescript
// 公开路由（无需认证）
// GET /c/{credentialId} → renderCredentialPage()

// 管理路由（需认证，Admin/SuperAdmin）
// GET    /api/admin/credentials           → listCredentials()
// GET    /api/admin/credentials/{id}      → getCredentialDetail()
// POST   /api/admin/credentials/batch     → batchCreateCredentials()
// PATCH  /api/admin/credentials/{id}/revoke → revokeCredential()
```

### 2. Credential ID Module (`packages/backend/src/credentials/credential-id.ts`)

凭证 ID 的生成、解析和验证。

```typescript
interface CredentialIdComponents {
  eventPrefix: string;   // e.g. "ACD-BASE"
  year: string;          // e.g. "2026"
  season: string;        // e.g. "Summer"
  roleCode: string;      // e.g. "VOL"
  sequence: number;      // e.g. 2
}

// 格式化：components → "ACD-BASE-2026-Summer-VOL-0002"
function formatCredentialId(components: CredentialIdComponents): string;

// 解析："ACD-BASE-2026-Summer-VOL-0002" → components
function parseCredentialId(id: string): CredentialIdComponents;

// 验证：检查 ID 格式是否合法
function validateCredentialId(id: string): { valid: boolean; error?: string };

// 角色代码映射
const ROLE_CODES: Record<string, string> = {
  Volunteer: 'VOL',
  Speaker: 'SPK',
  Workshop: 'WKS',
  Organizer: 'ORG',
};
```

**Credential ID 格式规则**：
- `EVENT_PREFIX`：大写字母和连字符，如 `ACD-BASE`、`ACD-SH`
- `YEAR`：四位数字，如 `2026`
- `SEASON`：`Spring` | `Summer` | `Fall` | `Winter`
- `ROLE_CODE`：`VOL` | `SPK` | `WKS` | `ORG`
- `SEQUENCE`：四位零填充数字，如 `0001`

正则：`/^([A-Z](?:[A-Z-]*[A-Z])?)-(\d{4})-(Spring|Summer|Fall|Winter)-(VOL|SPK|WKS|ORG)-(\d{4})$/`

### 3. CSV Parser/Formatter (`packages/backend/src/credentials/csv.ts`)

CSV 文件的解析和格式化，遵循 RFC 4180。

```typescript
interface CsvCredentialRow {
  recipientName: string;
  role: string;
  eventName: string;
  locale?: 'zh' | 'en';
  eventDate?: string;
  eventLocation?: string;
  contribution?: string;
  issuingOrganization?: string;
}

interface CsvParseResult {
  rows: CsvCredentialRow[];
  errors: Array<{ line: number; message: string }>;
}

// 解析 CSV 字符串 → 结构化数据
function parseCsv(csvContent: string): CsvParseResult;

// 格式化结构化数据 → CSV 字符串
function formatCsv(rows: CsvCredentialRow[]): string;

// 验证单行数据
function validateRow(row: Record<string, string>, lineNumber: number): 
  { valid: true; data: CsvCredentialRow } | { valid: false; error: string };
```

### 4. HTML Renderer (`packages/backend/src/credentials/render.ts`)

凭证页面的 HTML 渲染引擎。

```typescript
interface RenderOptions {
  credential: Credential;
  baseUrl: string;       // e.g. "https://store.awscommunity.cn"
}

// 渲染完整 HTML 页面（含内联 CSS、OG meta、QR 码）
function renderCredentialPage(options: RenderOptions): string;

// 渲染 404 页面
function render404Page(locale: 'zh' | 'en'): string;

// 生成 LinkedIn 添加认证 URL
function buildLinkedInUrl(credential: Credential, baseUrl: string): string;

// 生成 QR 码 SVG
function generateQrSvg(url: string): string;
```

### 5. i18n Module (`packages/backend/src/credentials/i18n.ts`)

多语言文案管理。

```typescript
type Locale = 'zh' | 'en';

interface I18nStrings {
  verified: string;
  revoked: string;
  issueDate: string;
  issuingOrganization: string;
  credentialId: string;
  addToLinkedIn: string;
  verificationTitle: string;
  verificationDescription: string;
  revokedNotice: string;
  eventDate: string;
  eventLocation: string;
  contribution: string;
  pageTitle: string;
  // Role translations
  roles: Record<string, string>;
}

function getStrings(locale: Locale): I18nStrings;

// 角色名称翻译
// zh: { Volunteer: '志愿者', Speaker: '讲师', Workshop: '工作坊参与者', Organizer: '组织者' }
// en: { Volunteer: 'Volunteer', Speaker: 'Speaker', Workshop: 'Workshop Participant', Organizer: 'Organizer' }
```

### 6. Sequence Generator (`packages/backend/src/credentials/sequence.ts`)

基于 DynamoDB 原子计数器的序号生成器。

```typescript
// 获取下一个序号（原子递增）
// partitionKey = "{eventPrefix}-{year}-{season}-{roleCode}"
async function getNextSequence(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  eventPrefix: string,
  year: string,
  season: string,
  roleCode: string,
  count: number  // 批量预留的序号数量
): Promise<number>; // 返回起始序号
```

### 7. CDK Infrastructure (`packages/cdk/lib/credential-stack.ts`)

凭证模块的 CDK 基础设施定义。将凭证相关资源（DynamoDB 表、Lambda 函数、API Gateway 路由）封装在 ApiStack 中新增，或作为独立 construct。

```typescript
// 新增到 DatabaseStack:
// - PointsMall-Credentials 表
// - PointsMall-CredentialSequences 表

// 新增到 ApiStack:
// - Credential Lambda 函数
// - API Gateway 路由: /c/{credentialId}, /api/admin/credentials/*

// 新增到 FrontendStack:
// - CloudFront /c/* 行为路由到 API Gateway
```

### API Interfaces

#### `GET /c/{credentialId}` — 公开凭证页面

**认证**：无需认证

**响应**：
- `200 OK`：HTML 页面（Content-Type: text/html）
- `404 Not Found`：HTML 404 页面

**缓存**：`Cache-Control: public, max-age=3600`

#### `GET /api/admin/credentials` — 凭证列表

**认证**：Bearer JWT（Admin/SuperAdmin）

**查询参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `search` | string | 按凭证 ID、收件人姓名、活动名称搜索 |
| `status` | string | 按状态筛选：`active` / `revoked` |
| `page` | number | 页码（默认 1） |
| `pageSize` | number | 每页条数（默认 20） |

**响应**：
```json
{
  "items": [
    {
      "credentialId": "ACD-BASE-2026-Summer-VOL-0002",
      "recipientName": "张三",
      "eventName": "AWS Community Day Base",
      "role": "Volunteer",
      "issueDate": "2026-06-15",
      "status": "active",
      "locale": "zh"
    }
  ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

#### `GET /api/admin/credentials/{credentialId}` — 凭证详情

**认证**：Bearer JWT（Admin/SuperAdmin）

**响应**：完整凭证对象（JSON）

#### `POST /api/admin/credentials/batch` — 批量生成凭证

**认证**：Bearer JWT（Admin/SuperAdmin）

**请求体**：
```json
{
  "eventPrefix": "ACD-BASE",
  "year": "2026",
  "season": "Summer",
  "csvContent": "recipientName,role,eventName,locale\n张三,Volunteer,AWS Community Day Base,zh\nJohn,Speaker,AWS Community Day Base,en"
}
```

**响应**：
```json
{
  "batchId": "batch-uuid-xxx",
  "summary": {
    "total": 10,
    "success": 9,
    "failed": 1
  },
  "credentials": [
    { "credentialId": "ACD-BASE-2026-Summer-VOL-0001", "recipientName": "张三" }
  ],
  "errors": [
    { "line": 5, "message": "缺少必填字段: recipientName" }
  ]
}
```

#### `PATCH /api/admin/credentials/{credentialId}/revoke` — 撤销凭证

**认证**：Bearer JWT（SuperAdmin only）

**请求体**：
```json
{
  "reason": "信息填写错误"
}
```

**响应**：
```json
{
  "credentialId": "ACD-BASE-2026-Summer-VOL-0002",
  "status": "revoked",
  "revokedAt": "2026-06-20T10:30:00.000Z",
  "revokedBy": "user-id-xxx",
  "revokeReason": "信息填写错误"
}
```

## Data Models

### Credentials Table (`PointsMall-Credentials`)

| 属性 | 类型 | 说明 |
|------|------|------|
| `credentialId` | String (PK) | 凭证唯一 ID，格式 `{PREFIX}-{YEAR}-{SEASON}-{ROLE}-{SEQ}` |
| `recipientName` | String | 收件人姓名 |
| `eventName` | String | 活动名称 |
| `role` | String | 角色：`Volunteer` / `Speaker` / `Workshop` / `Organizer` |
| `issueDate` | String | 签发日期（ISO 格式，如 `2026-06-15`） |
| `issuingOrganization` | String | 签发组织，默认 `AWS User Group China` |
| `status` | String | 状态：`active` / `revoked` |
| `locale` | String | 语言：`zh` / `en` |
| `createdAt` | String | 创建时间戳（ISO 8601） |
| `eventLocation` | String (可选) | 活动地点 |
| `eventDate` | String (可选) | 活动日期 |
| `contribution` | String (可选) | 贡献描述 |
| `revokedAt` | String (可选) | 撤销时间戳 |
| `revokedBy` | String (可选) | 撤销操作者 userId |
| `revokeReason` | String (可选) | 撤销原因 |
| `batchId` | String (可选) | 批次 ID |

**GSI**：
- `status-createdAt-index`：PK=`status`，SK=`createdAt` — 用于按状态筛选和分页
- `batchId-index`：PK=`batchId` — 用于按批次查询

### Credential Sequences Table (`PointsMall-CredentialSequences`)

用于原子递增序号生成。

| 属性 | 类型 | 说明 |
|------|------|------|
| `sequenceKey` | String (PK) | 格式 `{PREFIX}-{YEAR}-{SEASON}-{ROLE_CODE}`，如 `ACD-BASE-2026-Summer-VOL` |
| `currentValue` | Number | 当前最大序号值 |

使用 DynamoDB `UpdateItem` 的 `ADD` 操作实现原子递增：

```typescript
const result = await dynamoClient.send(new UpdateCommand({
  TableName: SEQUENCES_TABLE,
  Key: { sequenceKey: `${eventPrefix}-${year}-${season}-${roleCode}` },
  UpdateExpression: 'ADD currentValue :inc',
  ExpressionAttributeValues: { ':inc': count },
  ReturnValues: 'UPDATED_NEW',
}));
const endSequence = result.Attributes!.currentValue as number;
const startSequence = endSequence - count + 1;
```

### HTML Template Approach

凭证页面使用 TypeScript 模板字符串生成完整 HTML。关键设计：

1. **内联 CSS**：所有样式通过 `<style>` 标签内联，无外部 CSS 文件
2. **渐变背景**：使用 CSS `linear-gradient` 实现专业渐变效果
3. **QR 码**：使用 `qrcode` 库生成 SVG，内联到 HTML
4. **响应式**：使用 CSS media queries 适配移动端和桌面端
5. **OG Meta**：在 `<head>` 中输出完整的 Open Graph 和 Twitter Card 标签
6. **自包含**：整个页面为单个 HTML 文件，无外部依赖，目标 < 50KB

```html
<!DOCTYPE html>
<html lang="{locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{recipientName} - {roleName} | {eventName}</title>
  <!-- OG Meta Tags -->
  <meta property="og:title" content="{recipientName} - {roleName}" />
  <meta property="og:description" content="{eventName} | {issuingOrganization}" />
  <meta property="og:url" content="{baseUrl}/c/{credentialId}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="{ogImageUrl}" />
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{recipientName} - {roleName}" />
  <meta name="twitter:description" content="{eventName}" />
  <meta name="twitter:image" content="{ogImageUrl}" />
  <style>
    /* 内联 CSS：渐变背景、证书卡片、验证面板、响应式布局 */
  </style>
</head>
<body>
  <div class="credential-card">
    <!-- 证书内容：姓名、活动、角色、日期等 -->
    <!-- 验证面板：状态、QR 码、URL -->
    <!-- LinkedIn 按钮（仅 active 状态） -->
  </div>
</body>
</html>
```

### i18n Strategy

使用简单的键值对象实现多语言，不引入额外 i18n 库：

```typescript
const strings = {
  zh: {
    verified: '已验证',
    revoked: '已撤销',
    issueDate: '签发日期',
    issuingOrganization: '签发组织',
    credentialId: '凭证 ID',
    addToLinkedIn: '添加到 LinkedIn',
    verificationTitle: '凭证验证',
    verificationDescription: '此凭证由 {org} 签发，可通过以下方式验证',
    revokedNotice: '此凭证已被撤销',
    roles: {
      Volunteer: '志愿者',
      Speaker: '讲师',
      Workshop: '工作坊参与者',
      Organizer: '组织者',
    },
  },
  en: {
    verified: 'Verified',
    revoked: 'Revoked',
    issueDate: 'Issue Date',
    issuingOrganization: 'Issuing Organization',
    credentialId: 'Credential ID',
    addToLinkedIn: 'Add to LinkedIn',
    verificationTitle: 'Credential Verification',
    verificationDescription: 'This credential was issued by {org} and can be verified at',
    revokedNotice: 'This credential has been revoked',
    roles: {
      Volunteer: 'Volunteer',
      Speaker: 'Speaker',
      Workshop: 'Workshop Participant',
      Organizer: 'Organizer',
    },
  },
};
```

### LinkedIn Integration

使用 LinkedIn 的官方 Add Certification URL：

```
https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME
  &name={encodedCertName}
  &organizationName={encodedOrgName}
  &issueYear={year}
  &issueMonth={month}
  &certUrl={encodedCredentialUrl}
  &certId={credentialId}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Credential ID Round-Trip

*For any* valid credential ID components (eventPrefix, year, season, roleCode, sequence), formatting the components into a credential ID string and then parsing that string back should produce components identical to the original.

**Validates: Requirements 2.3, 2.4**

### Property 2: Invalid Credential ID Rejection

*For any* string that does not match the credential ID format `{EVENT_PREFIX}-{YEAR}-{SEASON}-{ROLE_CODE}-{SEQUENCE}`, the parser should return a descriptive error rather than silently producing incorrect components.

**Validates: Requirements 2.5**

### Property 3: Credential ID Sequence Uniqueness

*For any* batch generation request with N rows sharing the same eventPrefix, year, season, and roleCode, the generated sequence numbers should be unique and form a contiguous ascending range.

**Validates: Requirements 2.1, 2.2**

### Property 4: HTML Rendering Contains All Credential Fields

*For any* valid credential (with any combination of required and optional fields), the rendered HTML page should contain the recipientName, eventName, role name, issueDate, credentialId, and issuingOrganization. When optional fields (eventLocation, eventDate, contribution) are provided, they should also appear in the rendered HTML.

**Validates: Requirements 3.1, 3.3, 3.4, 1.1, 1.2**

### Property 5: Revoked Credential Rendering

*For any* credential with status `revoked`, the rendered HTML should contain a revocation marker, the OG meta description should include revocation text, and the "Add to LinkedIn" button should be absent.

**Validates: Requirements 3.7, 4.4, 5.4**

### Property 6: OG and Social Meta Tags Correctness

*For any* valid credential, the rendered HTML should contain `og:title`, `og:description`, `og:url`, `og:type`, `og:image`, `twitter:card`, `twitter:title`, `twitter:description`, and `twitter:image` meta tags, with values derived from the credential's data.

**Validates: Requirements 4.1, 4.2**

### Property 7: LinkedIn URL Parameter Correctness

*For any* active credential, the LinkedIn certification URL should contain the correct certification name (role + eventName), organization name, issue year/month, credential URL, and credential ID as URL-encoded parameters.

**Validates: Requirements 5.2, 5.3**

### Property 8: Locale-Aware Rendering

*For any* credential with locale `zh`, all fixed UI text (labels, verification text, role names) in the rendered HTML should be in Chinese. *For any* credential with locale `en`, all fixed UI text should be in English. The OG meta tags should also use the corresponding language.

**Validates: Requirements 14.2, 14.3, 14.5, 14.6**

### Property 9: CSV Round-Trip

*For any* valid array of credential data rows (including fields with commas, quotes, and newlines), formatting to CSV and then parsing back should produce a semantically equivalent array of rows.

**Validates: Requirements 8.2, 8.4, 8.5**

### Property 10: Batch Generation Correctness

*For any* CSV input containing a mix of valid and invalid rows, the batch generation process should create exactly one credential per valid row (each with a unique credentialId and the correct batchId), and report an error for each invalid row without affecting valid rows.

**Validates: Requirements 7.3, 7.4, 7.6**

### Property 11: Revocation State Transition

*For any* credential with status `active`, revoking it should change the status to `revoked` and record `revokedAt`, `revokedBy`, and `revokeReason`. *For any* credential already in `revoked` status, attempting to revoke it again should return an error.

**Validates: Requirements 10.3, 10.4**

### Property 12: Revocation Authorization

*For any* user without the `SuperAdmin` role, attempting to revoke a credential should be rejected with a 403 error. Only users with the `SuperAdmin` role should be able to execute revocation.

**Validates: Requirements 10.5**

### Property 13: Self-Contained HTML

*For any* rendered credential page, the HTML should contain no external stylesheet links (`<link rel="stylesheet">`), no external script tags (`<script src="...">`), and all CSS should be inlined within `<style>` tags.

**Validates: Requirements 12.1**

## Error Handling

| 场景 | HTTP 状态码 | 错误码 | 说明 |
|------|------------|--------|------|
| 凭证不存在 | 404 | `CREDENTIAL_NOT_FOUND` | 公开页面返回 404 HTML，API 返回 JSON |
| 凭证已撤销（再次撤销） | 400 | `ALREADY_REVOKED` | 凭证已处于 revoked 状态 |
| 缺少认证 | 401 | `UNAUTHORIZED` | 管理接口缺少 Bearer token |
| Token 过期 | 401 | `TOKEN_EXPIRED` | JWT token 已过期 |
| 权限不足 | 403 | `FORBIDDEN` | 非 Admin/SuperAdmin 访问管理接口 |
| 撤销权限不足 | 403 | `FORBIDDEN` | 非 SuperAdmin 执行撤销操作 |
| CSV 格式错误 | 400 | `INVALID_CSV` | CSV 文件无法解析 |
| CSV 为空 | 400 | `EMPTY_CSV` | CSV 文件无数据行 |
| 缺少必填参数 | 400 | `MISSING_REQUIRED_FIELD` | 批量生成缺少 eventPrefix/year/season |
| 无效的凭证 ID 格式 | 400 | `INVALID_CREDENTIAL_ID` | 凭证 ID 不符合格式规范 |

**错误响应格式**（JSON API）：
```json
{
  "code": "CREDENTIAL_NOT_FOUND",
  "message": "凭证不存在"
}
```

**公开页面错误**：返回友好的 HTML 404 页面，包含返回首页链接。

## Testing Strategy

### Property-Based Tests (fast-check)

使用 `fast-check` 库（项目已有依赖）编写属性测试，每个属性至少 100 次迭代。

**测试文件**：
- `packages/backend/src/credentials/credential-id.property.test.ts` — Properties 1, 2, 3
- `packages/backend/src/credentials/csv.property.test.ts` — Property 9
- `packages/backend/src/credentials/render.property.test.ts` — Properties 4, 5, 6, 7, 8, 13
- `packages/backend/src/credentials/revoke.property.test.ts` — Properties 11, 12

**标签格式**：`Feature: community-credentials, Property {N}: {title}`

**配置**：每个属性测试 `{ numRuns: 100 }`

### Unit Tests (vitest)

- `credential-id.test.ts`：具体示例（已知 ID 的解析/格式化、边界值）
- `csv.test.ts`：UTF-8 BOM 处理、空文件、仅表头文件
- `render.test.ts`：404 页面渲染、QR 码生成
- `handler.test.ts`：路由分发、认证检查、CORS 头

### Integration Tests

- API 端到端测试：通过 HTTP 调用验证完整请求/响应流程
- DynamoDB 序号生成器并发安全性测试
