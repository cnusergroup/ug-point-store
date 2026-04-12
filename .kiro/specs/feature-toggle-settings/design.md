# 技术设计文档 - 功能开关设置（Feature Toggle Settings）

## 概述（Overview）

本设计为 SuperAdmin 提供功能开关管理能力，控制"兑换积分码"和"积分申请"两个功能的启用/禁用。核心变更包括：

1. **DynamoDB 数据存储**：在现有 Users 表中存储功能开关配置记录（固定 key `feature-toggles`），避免新建表
2. **后端新增模块** `settings/feature-toggles.ts`：提供读取和更新功能开关的函数
3. **公开查询接口**：`GET /api/settings/feature-toggles`（无需认证），供前端获取当前开关状态
4. **管理端更新接口**：`PUT /api/admin/settings/feature-toggles`（SuperAdmin 专属），更新开关设置
5. **后端拦截**：Points Handler 在处理 `POST /api/points/redeem-code` 和 `POST /api/claims` 前检查功能开关
6. **前端动态显示**：Profile 页面隐藏/显示快捷入口，Redeem 和 Claims 页面显示功能未开放提示
7. **管理端设置页面**：新增 `admin/settings.tsx` 页面，SuperAdmin 可切换功能开关

设计目标：
- 复用现有 Users 表存储设置，避免新建 DynamoDB 表
- 公开查询接口无需认证，前端可在登录前获取设置
- 后端双重拦截（API 层 + 前端层），确保功能关闭时无法绕过
- 默认关闭，安全优先

---

## 架构（Architecture）

### 变更范围

```
新增文件:
  packages/backend/src/settings/feature-toggles.ts     — 功能开关读写逻辑
  packages/backend/src/settings/feature-toggles.test.ts — 单元测试
  packages/frontend/src/pages/admin/settings.tsx        — SuperAdmin 设置页面
  packages/frontend/src/pages/admin/settings.scss       — 设置页面样式

变更文件:
  packages/backend/src/points/handler.ts    — 新增公开查询路由 + 功能开关拦截
  packages/backend/src/admin/handler.ts     — 新增管理端更新路由
  packages/frontend/src/pages/profile/index.tsx — 动态隐藏快捷入口
  packages/frontend/src/pages/redeem/index.tsx  — 功能关闭时显示提示
  packages/frontend/src/pages/claims/index.tsx  — 功能关闭时显示提示
  packages/frontend/src/pages/admin/index.tsx   — 添加设置入口（SuperAdmin 可见）
  packages/frontend/src/i18n/zh.ts              — 中文翻译
  packages/frontend/src/i18n/en.ts              — 英文翻译
  packages/frontend/src/i18n/ja.ts              — 日文翻译
  packages/frontend/src/i18n/ko.ts              — 韩文翻译
  packages/frontend/src/i18n/zh-TW.ts           — 繁体中文翻译
  packages/frontend/src/i18n/types.ts           — 翻译类型定义
  packages/cdk/lib/api-stack.ts                 — 注册新路由
```

### 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 设置存储位置 | 复用 Users 表 | 仅一条记录，无需新建表；Users 表已有读写权限 |
| 设置记录 key | 固定 `feature-toggles` | 单例模式，简单可靠 |
| 查询接口认证 | 无需认证（公开） | 前端需在登录前获取设置以决定 UI 显示 |
| 更新接口权限 | SuperAdmin 专属 | 功能开关影响全局，仅最高权限可操作 |
| 默认值策略 | 记录不存在时默认 false | 安全优先，新功能默认关闭 |
| 前端获取时机 | 页面加载时实时获取 | 确保获取最新设置，无缓存延迟 |
| 后端拦截方式 | Handler 内调用 getFeatureToggles | 每次请求实时读取，确保设置变更即时生效 |

---

## 组件与接口（Components and Interfaces）

### 1. 功能开关模块（packages/backend/src/settings/feature-toggles.ts）

#### 1.1 getFeatureToggles - 读取功能开关

```typescript
interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
}

export async function getFeatureToggles(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<FeatureToggles>;
```

实现要点：
- 使用 GetCommand 读取 `{ userId: 'feature-toggles' }` 记录（复用 Users 表的 PK 字段 userId）
- 记录不存在时返回 `{ codeRedemptionEnabled: false, pointsClaimEnabled: false }`
- 记录存在时返回对应布尔值

#### 1.2 updateFeatureToggles - 更新功能开关

```typescript
interface UpdateFeatureTogglesInput {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  updatedBy: string;
}

interface UpdateFeatureTogglesResult {
  success: boolean;
  settings?: FeatureToggles & { updatedAt: string; updatedBy: string };
  error?: { code: string; message: string };
}

export async function updateFeatureToggles(
  input: UpdateFeatureTogglesInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<UpdateFeatureTogglesResult>;
```

实现要点：
- 校验 codeRedemptionEnabled 和 pointsClaimEnabled 为布尔值
- 使用 PutCommand 写入完整记录（userId: 'feature-toggles', codeRedemptionEnabled, pointsClaimEnabled, updatedAt, updatedBy）
- 返回更新后的设置

### 2. Points Handler 路由扩展（packages/backend/src/points/handler.ts）

新增路由和拦截逻辑：

```typescript
// 公开路由（无需认证）：
// GET /api/settings/feature-toggles → handleGetFeatureToggles

// 在 authenticatedHandler 内部，现有路由前添加拦截：
// POST /api/points/redeem-code → 先检查 codeRedemptionEnabled
// POST /api/claims → 先检查 pointsClaimEnabled
```

公开路由处理：在 `handler` 函数中，认证之前处理 `GET /api/settings/feature-toggles`，直接调用 `getFeatureToggles` 返回结果。

拦截逻辑：在 `authenticatedHandler` 中，对 `POST /api/points/redeem-code` 和 `POST /api/claims` 路由，先调用 `getFeatureToggles`，如果对应开关为 false，返回 `{ code: 'FEATURE_DISABLED', message: '该功能当前未开放' }` 403 错误。

### 3. Admin Handler 路由扩展（packages/backend/src/admin/handler.ts）

新增路由：

```typescript
// PUT /api/admin/settings/feature-toggles → handleUpdateFeatureToggles
```

实现要点：
- 在现有 admin 权限校验之后，额外校验 SuperAdmin 角色（使用 `isSuperAdmin(event.user.roles)`）
- 解析请求体，调用 `updateFeatureToggles`

### 4. 前端设置页面（packages/frontend/src/pages/admin/settings.tsx）

页面结构：
- 顶部工具栏：返回按钮 + 标题"功能设置"
- 功能开关列表：
  - 兑换积分码：名称 + 描述 + 开关切换控件
  - 积分申请：名称 + 描述 + 开关切换控件
- 加载状态：骨架屏或 loading 提示
- 操作反馈：成功/失败 toast 提示

### 5. 前端 Profile 页面变更（packages/frontend/src/pages/profile/index.tsx）

变更要点：
- 页面加载时调用 `GET /api/settings/feature-toggles`
- 根据返回结果过滤 `QUICK_ACTIONS` 数组：
  - `codeRedemptionEnabled === false` 时移除 key='redeem' 的项
  - `pointsClaimEnabled === false` 时移除 key='claims' 的项
- 加载中时显示全部入口（避免闪烁）

### 6. 前端 Redeem 页面变更（packages/frontend/src/pages/redeem/index.tsx）

变更要点：
- 仅在 `mode === 'points-code'` 时检查功能开关
- 页面加载时调用 `GET /api/settings/feature-toggles`
- `codeRedemptionEnabled === false` 时显示功能未开放提示 + 返回按钮，隐藏输入表单

### 7. 前端 Claims 页面变更（packages/frontend/src/pages/claims/index.tsx）

变更要点：
- 页面加载时调用 `GET /api/settings/feature-toggles`
- `pointsClaimEnabled === false` 时显示功能未开放提示 + 返回按钮，隐藏新建申请按钮和表单
- 已有的申请历史列表仍可查看（只读）

---

## 数据模型（Data Models）

### Settings Record（存储在 Users 表中）

| 属性 | 类型 | 说明 |
|------|------|------|
| PK: `userId` | String | 固定值 `"feature-toggles"`（复用 Users 表 PK） |
| `codeRedemptionEnabled` | Boolean | 兑换积分码功能开关，默认 false |
| `pointsClaimEnabled` | Boolean | 积分申请功能开关，默认 false |
| `updatedAt` | String | 最后更新时间 ISO 8601 |
| `updatedBy` | String | 最后更新操作人 userId |

**说明：** 复用 Users 表的 `userId` 分区键，使用固定值 `"feature-toggles"` 作为设置记录的标识。由于 Users 表的 GSI（email-index、wechatOpenId-index）不会包含此记录（该记录没有 email 和 wechatOpenId 字段），因此不会影响现有查询。

### 新增错误码

| HTTP 状态码 | 错误码 | 消息 | 对应需求 |
|-------------|--------|------|----------|
| 403 | `FEATURE_DISABLED` | 该功能当前未开放 | 4.1, 4.2 |

在 `packages/shared/src/types.ts` 的 ErrorCodes/ErrorMessages 中添加（如果使用独立 errors.ts 则在对应文件中添加）。

### 新增 i18n 翻译键

```typescript
// 在 TranslationDict 中新增 featureToggle 命名空间
featureToggle: {
  featureDisabled: string;           // "该功能当前未开放"
  featureDisabledDesc: string;       // "此功能暂时关闭，请稍后再试"
  backButton: string;                // "返回"
};

// 在 admin.dashboard 中新增
admin.dashboard.settingsTitle: string;   // "功能设置"
admin.dashboard.settingsDesc: string;    // "管理功能开关"

// 在 admin 中新增 settings 命名空间
admin.settings: {
  title: string;                     // "功能设置"
  backButton: string;                // "返回"
  codeRedemptionLabel: string;       // "兑换积分码"
  codeRedemptionDesc: string;        // "允许用户使用积分码兑换积分"
  pointsClaimLabel: string;          // "积分申请"
  pointsClaimDesc: string;           // "允许用户提交积分申请"
  loading: string;                   // "加载中..."
  updateSuccess: string;             // "设置已更新"
  updateFailed: string;              // "更新失败，请重试"
};
```

---

## 正确性属性（Correctness Properties）

### Property 1: 默认值正确性

*对于任何*不存在 Settings_Record 的数据库状态，调用 `getFeatureToggles` 应返回 `{ codeRedemptionEnabled: false, pointsClaimEnabled: false }`。

**Validates: Requirements 1.3, 2.2**

### Property 2: 更新权限校验正确性

*对于任何*用户角色集合，如果该集合不包含 SuperAdmin，则更新功能开关请求应被拒绝并返回 FORBIDDEN；如果包含 SuperAdmin，则权限校验应通过。

**Validates: Requirements 3.1, 3.2**

### Property 3: 更新输入校验正确性

*对于任何*请求体，如果 codeRedemptionEnabled 或 pointsClaimEnabled 不是布尔值（包括 undefined、null、数字、字符串等），则更新请求应被拒绝并返回 INVALID_REQUEST。

**Validates: Requirements 3.3, 3.4**

### Property 4: 更新幂等性

*对于任何*有效的功能开关设置值（codeRedemptionEnabled, pointsClaimEnabled），连续两次使用相同值调用 `updateFeatureToggles`，第二次调用后读取的设置应与第一次调用后读取的设置在 codeRedemptionEnabled 和 pointsClaimEnabled 字段上完全一致。

**Validates: Requirements 3.6**

### Property 5: 功能开关拦截正确性

*对于任何*功能开关状态组合（codeRedemptionEnabled: true/false, pointsClaimEnabled: true/false），当 codeRedemptionEnabled 为 false 时 POST /api/points/redeem-code 应返回 FEATURE_DISABLED，当 pointsClaimEnabled 为 false 时 POST /api/claims 应返回 FEATURE_DISABLED；当对应开关为 true 时，请求应正常通过功能开关检查。

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: 读写一致性（Round-trip）

*对于任何*有效的布尔值组合 (codeRedemptionEnabled, pointsClaimEnabled)，调用 `updateFeatureToggles` 写入后，立即调用 `getFeatureToggles` 读取，返回的 codeRedemptionEnabled 和 pointsClaimEnabled 应与写入值完全一致。

**Validates: Requirements 1.1, 1.2, 2.1**

---

## 错误处理（Error Handling）

### 新增错误码

```typescript
// 在现有错误码体系中新增
FEATURE_DISABLED: 'FEATURE_DISABLED'  // HTTP 403
```

### 错误处理策略

1. **设置读取失败**：`getFeatureToggles` 在 DynamoDB 读取失败时，默认返回 `{ codeRedemptionEnabled: false, pointsClaimEnabled: false }`（安全降级，功能关闭）
2. **设置更新失败**：返回 INTERNAL_ERROR，前端提示重试并恢复开关状态
3. **权限校验顺序**：先检查 Admin 权限 → 再检查 SuperAdmin 权限 → 再校验请求体 → 最后执行更新
4. **前端降级**：功能开关 API 调用失败时，前端默认显示所有入口（避免误隐藏）

---

## 测试策略（Testing Strategy）

### 技术选型

| 类别 | 工具 |
|------|------|
| 测试框架 | Vitest（现有） |
| 属性测试库 | fast-check（现有） |

### 单元测试范围

- **settings/feature-toggles.test.ts**：
  - getFeatureToggles：记录存在时返回正确值、记录不存在时返回默认值
  - updateFeatureToggles：有效输入写入成功、无效输入被拒绝、返回更新后的设置
- **points/handler.test.ts**（更新）：
  - GET /api/settings/feature-toggles 路由测试（无需认证）
  - POST /api/points/redeem-code 功能开关拦截测试
  - POST /api/claims 功能开关拦截测试
- **admin/handler.test.ts**（更新）：
  - PUT /api/admin/settings/feature-toggles 路由测试（SuperAdmin 权限校验）

### 属性测试范围

**配置要求：**
- 每个属性测试最少运行 100 次迭代
- 标签格式：`Feature: feature-toggle-settings, Property {number}: {property_text}`

| 属性编号 | 测试文件 | 测试描述 | 生成器 |
|----------|----------|----------|--------|
| Property 1 | settings/feature-toggles.property.test.ts | 默认值正确性 | 随机空/非空数据库状态 |
| Property 2 | settings/feature-toggles.property.test.ts | 更新权限校验正确性 | 随机角色集合 |
| Property 3 | settings/feature-toggles.property.test.ts | 更新输入校验正确性 | 随机非布尔值输入 |
| Property 4 | settings/feature-toggles.property.test.ts | 更新幂等性 | 随机布尔值组合 |
| Property 5 | settings/feature-toggles.property.test.ts | 功能开关拦截正确性 | 随机开关状态组合 |
| Property 6 | settings/feature-toggles.property.test.ts | 读写一致性 | 随机布尔值组合 |
