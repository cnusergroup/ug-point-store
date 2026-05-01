# Implementation Plan: Order Export & Phone Unmasking (订单导出与手机号显示)

## Overview

实现管理员订单页面两项改进：（1）移除手机号遮蔽，直接显示完整手机号；（2）新增待发货订单 Excel 导出功能。按层级从底向上实现：backend `exportPendingOrders` 函数 → handler 路由 → CDK 路由注册与 binaryMediaTypes → frontend 移除 maskPhone → frontend 导出按钮 → i18n 翻译。复用现有 Order Lambda，使用已有的 `xlsx` 依赖生成 Excel，API Gateway 通过 `isBase64Encoded` 返回二进制文件。

## Tasks

- [x] 1. Implement backend `exportPendingOrders` function
  - [x] 1.1 Add `exportPendingOrders` function in `packages/backend/src/orders/admin-order.ts`
    - Add `ExportPendingOrdersResult` interface with `success`, `buffer?`, `error?` fields
    - Import `xlsx` library (`import * as XLSX from 'xlsx'`)
    - Implement `exportPendingOrders(dynamoClient, ordersTable)`:
      - Query GSI `shippingStatus-createdAt-index` with `shippingStatus = 'pending'`
      - For each order, flatten items into rows: 订单号, 商品名称, 数量, 尺码, 收件人, 电话, 地址
      - Each order item becomes one row; 订单号/收件人/电话/地址 repeated per item
      - 尺码 column: use `item.selectedSize ?? ''`
      - 电话 column: use full `shippingAddress.phone` (no masking)
      - Generate Excel workbook with `XLSX.utils.json_to_sheet` and `XLSX.write` to Buffer
      - Return `{ success: true, buffer }` on success
      - If no pending orders, return Excel with header row only
      - Wrap DynamoDB/xlsx errors with try-catch, return `{ success: false, error }` on failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

  - [ ]* 1.2 Write property test for Excel export row correctness
    - **Property 1: Excel export row correctness**
    - Test file: `packages/backend/src/orders/export.property.test.ts`
    - Use `fast-check` to generate 0–20 orders with 1–5 items each, with random selectedSize (present or undefined), random phone numbers
    - Verify: header row is exactly `['订单号', '商品名称', '数量', '尺码', '收件人', '电话', '地址']`
    - Verify: total data rows = sum of all item counts across all orders
    - Verify: each order with N items produces N consecutive rows with same 订单号/收件人/电话/地址
    - Verify: each row's 商品名称 and 数量 match the corresponding OrderItem
    - Verify: 电话 equals unmasked `shippingAddress.phone`
    - Verify: 尺码 equals `selectedSize` when present, empty string when undefined
    - Minimum 100 iterations
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

  - [ ]* 1.3 Write unit tests for `exportPendingOrders`
    - Test file: `packages/backend/src/orders/admin-order.test.ts`
    - Test: single order with one item produces correct Excel content
    - Test: order with multiple items produces one row per item
    - Test: no pending orders returns Excel with header row only
    - Test: DynamoDB error returns error result
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

- [x] 2. Add export route to order handler
  - [x] 2.1 Add `GET /api/admin/orders/export` route in `packages/backend/src/orders/handler.ts`
    - Add route matching BEFORE the `ADMIN_ORDER_DETAIL_REGEX` check (same pattern as `stats` route)
    - Match: `method === 'GET' && path === '/api/admin/orders/export'`
    - Implement `handleExportPendingOrders()` handler:
      - Call `exportPendingOrders(dynamoClient, ORDERS_TABLE)`
      - On success: return `{ statusCode: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="pending-orders-YYYY-MM-DD.xlsx"', 'Access-Control-Allow-Origin': '*' }, body: buffer.toString('base64'), isBase64Encoded: true }`
      - On failure: return error response
    - Import `exportPendingOrders` from `./admin-order`
    - _Requirements: 2.6, 2.8_

- [x] 3. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Register CDK route and configure binaryMediaTypes
  - [x] 4.1 Add export resource and binaryMediaTypes in `packages/cdk/lib/api-stack.ts`
    - Add `adminOrders.addResource('export').addMethod('GET', orderInt)` BEFORE `admin.addProxy()`, alongside the existing `stats` resource
    - Add `binaryMediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']` to the `RestApi` constructor options
    - _Requirements: 2.6_

- [x] 5. Remove phone number masking in frontend
  - [x] 5.1 Remove `maskPhone` usage in `packages/frontend/src/pages/admin/orders.tsx`
    - Remove `maskPhone` from the `@points-mall/shared` import statement
    - Replace `{maskPhone(orderDetail.shippingAddress.phone)}` with `{orderDetail.shippingAddress.phone}`
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 6. Add export button to admin orders page
  - [x] 6.1 Add export button and download handler in `packages/frontend/src/pages/admin/orders.tsx`
    - Add `exporting` state: `const [exporting, setExporting] = useState(false)`
    - Implement `handleExport` async function:
      - Set `exporting(true)`, get token from `Taro.getStorageSync('token')`
      - Use `fetch` + `Blob` to download from `/api/admin/orders/export` with Authorization header
      - Create temporary `<a>` element with `URL.createObjectURL(blob)`, set `download` filename with current date
      - On error: show toast with `t('admin.orders.exportFailed')`
      - Set `exporting(false)` in finally block
    - Add export button in the stats area (after the stats cards), using `btn-primary` class
    - Show loading text when `exporting` is true, normal label when false
    - Button label: `t('admin.orders.exportPending')`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 6.2 Add SCSS styles for export button in `packages/frontend/src/pages/admin/orders.scss`
    - Add `.order-stats__export` button styles in the stats area
    - Use `var(--accent-primary)` for button color, `var(--space-*)` for spacing
    - Add loading state opacity/cursor styles
    - _Requirements: 3.3_

- [x] 7. Add i18n translations for export feature
  - [x] 7.1 Add translation keys to `packages/frontend/src/i18n/zh.ts`
    - Add `admin.orders.exportPending`: `'导出待发货'`
    - Add `admin.orders.exportFailed`: `'导出失败，请重试'`
    - _Requirements: 3.5_

  - [x] 7.2 Add translation keys to `packages/frontend/src/i18n/en.ts`
    - Add `admin.orders.exportPending`: `'Export Pending'`
    - Add `admin.orders.exportFailed`: `'Export failed, please retry'`
    - _Requirements: 3.5_

  - [x] 7.3 Add translation keys to `packages/frontend/src/i18n/zh-TW.ts`
    - Add `admin.orders.exportPending`: `'匯出待發貨'`
    - Add `admin.orders.exportFailed`: `'匯出失敗，請重試'`
    - _Requirements: 3.5_

  - [x] 7.4 Add translation keys to `packages/frontend/src/i18n/ja.ts`
    - Add `admin.orders.exportPending`: `'未発送をエクスポート'`
    - Add `admin.orders.exportFailed`: `'エクスポートに失敗しました。再試行してください'`
    - _Requirements: 3.5_

  - [x] 7.5 Add translation keys to `packages/frontend/src/i18n/ko.ts`
    - Add `admin.orders.exportPending`: `'미발송 내보내기'`
    - Add `admin.orders.exportFailed`: `'내보내기 실패, 다시 시도해 주세요'`
    - _Requirements: 3.5_

- [x] 8. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the Excel export row correctness property from the design document
- The `xlsx` library is already in `packages/backend/package.json` dependencies — no new dependency needed
- CDK route for `export` must be added BEFORE `admin.addProxy()` to avoid conflict with `{proxy+}` catch-all
- API Gateway `binaryMediaTypes` is required for Lambda to return base64-encoded binary responses
- Frontend uses `fetch` + `Blob` + `URL.createObjectURL` for file download (H5 environment)
- The `maskPhone` removal is a simple import/usage deletion — no backend changes needed for phone display
