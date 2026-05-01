# Design Document: Order Export & Phone Unmasking

## Overview

本功能包含三个改动：

1. **移除管理端手机号遮蔽**：在管理员订单详情页中，移除 `maskPhone` 调用，直接显示完整手机号，方便管理员联系收件人进行发货。
2. **新增待发货订单导出 API**：`GET /api/admin/orders/export`，查询所有 pending 状态订单，生成包含商品信息和收货地址的 Excel 文件并返回。
3. **前端导出按钮**：在管理员订单页面的统计区域添加"导出待发货"按钮，点击后调用导出 API 下载 Excel 文件。

## Architecture

```mermaid
graph LR
    subgraph Frontend
        A[Admin Orders Page] -->|移除 maskPhone| B[Order Detail View]
        A -->|GET /api/admin/orders/export| C[Export Button]
    end

    subgraph API Gateway
        D[/api/admin/orders/export GET]
    end

    subgraph Backend - Order Lambda
        E[handler.ts 路由] --> F[exportPendingOrders]
        F --> G[DynamoDB Query - pending orders]
        F --> H[xlsx - 生成 Excel]
    end

    C -->|HTTP GET| D
    D --> E
    H -->|base64 binary| D
    D -->|binary download| C
```

### 设计决策

**决策 1：复用现有 Order Lambda 而非新建 Lambda**

导出端点由现有 Order Lambda（`PointsMall-Order`）处理，原因：
- Order Lambda 已有 DynamoDB Orders 表的读写权限
- 已有管理员身份验证和权限检查逻辑
- 避免新增 Lambda 带来的冷启动和维护成本
- `xlsx` 已在 `packages/backend/package.json` 的 dependencies 中

**决策 2：API Gateway 二进制响应处理**

API Gateway 默认以 JSON 处理响应体。为返回 Excel 二进制文件：
- Lambda 返回 `isBase64Encoded: true` + base64 编码的 body
- 响应头设置 `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- 响应头设置 `Content-Disposition: attachment; filename="pending-orders-YYYY-MM-DD.xlsx"`
- API Gateway 的 `binaryMediaTypes` 需包含该 Content-Type（或使用 `*/*`）

**决策 3：CDK 路由注册**

在 `api-stack.ts` 中，`adminOrders` 资源已有 `stats` 子资源。新增 `export` 子资源：
```typescript
adminOrders.addResource('export').addMethod('GET', orderInt);
```
此路由必须在 `admin.addProxy()` 之前定义，与 `stats` 路由的模式一致。

**决策 4：前端文件下载方式**

由于 Taro 小程序环境中 `Taro.request` 不直接支持二进制下载，使用 `Taro.downloadFile` 或在 H5 环境中使用 `window.open` / `fetch` + Blob 方式下载。考虑到管理端主要在 H5 环境使用，采用 fetch + Blob + URL.createObjectURL 方式实现下载。

## Components and Interfaces

### 1. 后端：导出函数 (`packages/backend/src/orders/admin-order.ts`)

```typescript
export interface ExportPendingOrdersResult {
  success: boolean;
  buffer?: Buffer;       // Excel 文件的二进制数据
  error?: { code: string; message: string };
}

/**
 * 查询所有 pending 订单并生成 Excel 文件。
 * 每个订单项生成一行，包含：订单号、商品名称、数量、尺码、收件人、电话、地址。
 */
export async function exportPendingOrders(
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<ExportPendingOrdersResult>;
```

### 2. 后端：路由处理 (`packages/backend/src/orders/handler.ts`)

在 handler 的 admin 路由区域新增：

```typescript
// GET /api/admin/orders/export (must be checked before the detail regex)
if (method === 'GET' && path === '/api/admin/orders/export') {
  return await handleExportPendingOrders();
}
```

`handleExportPendingOrders` 返回二进制响应：

```typescript
async function handleExportPendingOrders(): Promise<APIGatewayProxyResult> {
  const result = await exportPendingOrders(dynamoClient, ORDERS_TABLE);
  if (!result.success) {
    return errorResponse(result.error!.code, result.error!.message);
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pending-orders-${today}.xlsx"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: result.buffer!.toString('base64'),
    isBase64Encoded: true,
  };
}
```

### 3. CDK：路由注册 (`packages/cdk/lib/api-stack.ts`)

```typescript
// 在 adminOrders.addResource('stats') 附近添加
adminOrders.addResource('export').addMethod('GET', orderInt);
```

同时需要在 API Gateway 的 `binaryMediaTypes` 中添加 Excel MIME 类型：

```typescript
this.api = new apigateway.RestApi(this, 'PointsMallApi', {
  // ... existing config
  binaryMediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
});
```

### 4. 前端：移除 maskPhone (`packages/frontend/src/pages/admin/orders.tsx`)

移除 `maskPhone` 的导入，直接使用 `orderDetail.shippingAddress.phone`：

```diff
- import { ..., maskPhone } from '@points-mall/shared';
+ import { ... } from '@points-mall/shared';

- {orderDetail.shippingAddress.recipientName}　{maskPhone(orderDetail.shippingAddress.phone)}
+ {orderDetail.shippingAddress.recipientName}　{orderDetail.shippingAddress.phone}
```

### 5. 前端：导出按钮 (`packages/frontend/src/pages/admin/orders.tsx`)

在统计卡片区域（`order-stats`）下方或旁边添加导出按钮：

```typescript
const [exporting, setExporting] = useState(false);

const handleExport = async () => {
  setExporting(true);
  try {
    const token = Taro.getStorageSync('token');
    const baseUrl = /* API base URL */;
    const res = await fetch(`${baseUrl}/api/admin/orders/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const today = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pending-orders-${today}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    Taro.showToast({ title: t('admin.orders.exportFailed'), icon: 'none' });
  } finally {
    setExporting(false);
  }
};
```

## Data Models

### 订单数据（DynamoDB Orders 表，已有）

| 字段 | 类型 | 说明 |
|------|------|------|
| orderId | string | 主键 |
| userId | string | 下单用户 |
| items | OrderItem[] | 商品列表 |
| totalPoints | number | 总积分 |
| shippingAddress | object | 收货地址 { recipientName, phone, detailAddress } |
| shippingStatus | string | 物流状态：pending / shipped / cancelled |
| shippingEvents | ShippingEvent[] | 物流事件时间线 |
| createdAt | string | 创建时间 |
| updatedAt | string | 更新时间 |

### OrderItem 结构（已有）

| 字段 | 类型 | 说明 |
|------|------|------|
| productId | string | 商品 ID |
| productName | string | 商品名称 |
| imageUrl | string | 商品图片 |
| pointsCost | number | 单价积分 |
| quantity | number | 数量 |
| subtotal | number | 小计积分 |
| selectedSize | string? | 选中的尺码（可选） |

### Excel 输出列映射

| Excel 列名 | 数据来源 |
|------------|---------|
| 订单号 | order.orderId |
| 商品名称 | item.productName |
| 数量 | item.quantity |
| 尺码 | item.selectedSize ?? '' |
| 收件人 | order.shippingAddress.recipientName |
| 电话 | order.shippingAddress.phone |
| 地址 | order.shippingAddress.detailAddress |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Excel export row correctness

*For any* set of pending orders where each order has 1 or more items, the `exportPendingOrders` function SHALL produce an Excel workbook where:
- The first row contains exactly the headers: 订单号, 商品名称, 数量, 尺码, 收件人, 电话, 地址
- The total number of data rows equals the sum of all item counts across all orders
- For each order with N items, there are exactly N consecutive rows sharing the same 订单号, 收件人, 电话, and 地址 values
- Each row's 商品名称 and 数量 match the corresponding OrderItem
- Each row's 电话 equals the order's shippingAddress.phone (unmasked)
- Each row's 尺码 equals the item's selectedSize when present, or is empty when selectedSize is undefined

**Validates: Requirements 2.2, 2.3, 2.4, 2.5**

## Error Handling

| 场景 | 处理方式 |
|------|---------|
| 未认证/非管理员请求导出 API | 返回 403 Forbidden（复用现有 handler 权限检查） |
| DynamoDB 查询失败 | 返回 500 Internal Server Error，记录错误日志 |
| xlsx 生成失败 | 返回 500 Internal Server Error，记录错误日志 |
| 无待发货订单 | 正常返回仅含表头的 Excel 文件 |
| 前端导出请求失败 | 显示错误 toast 提示 |
| 前端导出请求超时 | fetch 默认超时，显示错误 toast |

## Testing Strategy

### 单元测试

| 测试目标 | 文件 | 说明 |
|---------|------|------|
| exportPendingOrders 函数 | `packages/backend/src/orders/admin-order.test.ts` | Mock DynamoDB，验证 Excel 生成逻辑 |
| handler 路由分发 | `packages/backend/src/orders/handler.test.ts` | 验证 GET /api/admin/orders/export 路由正确分发 |
| 空订单导出 | `packages/backend/src/orders/admin-order.test.ts` | 验证无 pending 订单时返回仅含表头的 Excel |
| 权限检查 | `packages/backend/src/orders/handler.test.ts` | 验证非管理员请求返回 403 |

### 属性测试（Property-Based Testing）

使用 `fast-check` 库进行属性测试。

| 属性 | 文件 | 标签 |
|------|------|------|
| Property 1: Excel export row correctness | `packages/backend/src/orders/export.property.test.ts` | Feature: order-export-phone, Property 1: Excel export row correctness |

**配置要求：**
- 每个属性测试最少运行 100 次迭代
- 生成器需覆盖：不同数量的订单（0-20）、不同数量的商品项（1-5）、有/无尺码选择、各种长度的手机号（含国际格式）

### 示例测试

| 测试目标 | 说明 |
|---------|------|
| 前端 maskPhone 移除 | 验证订单详情中手机号未经 maskPhone 处理 |
| 导出按钮存在 | 验证管理员订单页面渲染导出按钮 |
| 导出按钮 loading 状态 | 验证导出过程中按钮显示 loading |
| 导出失败 toast | 验证导出失败时显示错误提示 |
| 响应头正确性 | 验证 Content-Type 和 Content-Disposition 头 |
