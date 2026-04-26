# Implementation Plan: Order Cancel & Refund (订单取消与退款)

## Overview

实现管理员"无法完成发货"订单取消与积分退还功能。按层级从底向上实现：shared types → backend cancelOrder 函数 → backend route → backend getOrderStats 更新 → frontend admin 页面（取消按钮、确认弹窗、已取消 tab）→ frontend 用户订单页面 → frontend 订单详情页 → i18n → SCSS 样式。使用 DynamoDB TransactWriteItems 保证原子性，stock 恢复为 best-effort 独立操作。

## Tasks

- [x] 1. Update shared types for cancelled status and refund
  - [x] 1.1 Update `ShippingStatus`, `PointsRecordType`, `OrderStats`, and `validateStatusTransition` in `packages/shared/src/types.ts`
    - Add `'cancelled'` to `ShippingStatus` type: `'pending' | 'shipped' | 'cancelled'`
    - Add `'refund'` to `PointsRecordType` type: `'earn' | 'spend' | 'refund'`
    - Add `cancelled: number` to `OrderStats` interface
    - Update `ShippingEvent.status` type to accept `'cancelled'` (it uses `ShippingStatus` so this follows automatically)
    - Do NOT add `'cancelled'` to `SHIPPING_STATUS_ORDER` array — it remains `['pending', 'shipped']`
    - Update `validateStatusTransition` to allow `pending → cancelled` as a special case before the linear flow check
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 1.2 Write property test for status transition validation
    - **Property 6: Status transition validation**
    - Generate all pairs of `ShippingStatus` values, verify `validateStatusTransition` returns `{ valid: true }` only for `pending → shipped` and `pending → cancelled`
    - Test file: `packages/shared/src/order-cancel-transition.property.test.ts`
    - **Validates: Requirements 9.3**

- [x] 2. Implement backend `cancelOrder` function
  - [x] 2.1 Implement `cancelOrder` in `packages/backend/src/orders/admin-order.ts`
    - Add `CancelOrderResult` interface with `success`, `error?`, `userDeleted?` fields
    - Implement `cancelOrder(orderId, operatorId, dynamoClient, tables)` function:
      - Fetch order by orderId; return `ORDER_NOT_FOUND` if missing
      - Validate `shippingStatus === 'pending'`; return `INVALID_STATUS_TRANSITION` if not
      - Check if user exists in Users table
      - If user exists: execute `TransactWriteItems` with ConditionExpression `shippingStatus = :pending` containing: (1) update order status to `cancelled` + append ShippingEvent, (2) increment user points by `totalPoints`, (3) put PointsRecord with `type: 'refund'`
      - If user deleted: simple `UpdateCommand` on order with ConditionExpression, set remark to `"无法完成发货，订单已取消（用户已删除，积分未退还）"`
      - Best-effort stock restoration per item: for each OrderItem, check product exists, restore `stock` and `redemptionCount`, restore `sizeOptions[idx].stock` if `selectedSize` present
    - Import `TransactWriteCommand` from `@aws-sdk/lib-dynamodb` and `ulid` for record ID generation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 8.1, 8.2_

  - [ ]* 2.2 Write property test for cancellation status gate
    - **Property 1: Cancellation status gate**
    - Generate random orders with random `shippingStatus` values, verify `cancelOrder` succeeds only for `pending` orders
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3, 6.1**

  - [ ]* 2.3 Write property test for refund correctness
    - **Property 2: Refund correctness**
    - Generate random orders with random `totalPoints` and random user points balances, verify points math, record fields, and `earnTotal` invariance
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 2.4 Write property test for stock restoration per item
    - **Property 3: Stock restoration per item**
    - Generate random orders with 1–5 items with random quantities, verify `stock` and `redemptionCount` changes match
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 2.5 Write property test for size-specific stock restoration
    - **Property 4: Size-specific stock restoration**
    - Generate random orders with size-enabled items, verify `sizeOptions` stock restoration
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 5.3**

- [x] 3. Add cancel order route to handler
  - [x] 3.1 Add `POST /api/admin/orders/{orderId}/cancel` route in `packages/backend/src/orders/handler.ts`
    - Add `ADMIN_ORDER_CANCEL_REGEX` pattern: `/^\/api\/admin\/orders\/([^/]+)\/cancel$/`
    - Add route matching in the admin routes section for `POST` method
    - Implement `handleCancelOrder(orderId, event)` handler that calls `cancelOrder` and returns appropriate JSON response
    - Return `{ message: '订单已取消并退还积分' }` on success, or `{ message: '订单已取消（用户已删除，积分未退还）' }` when `userDeleted` is true
    - Import `cancelOrder` from `./admin-order`
    - Pass `tables` object with `ordersTable`, `usersTable`, `productsTable`, `pointsRecordsTable`
    - _Requirements: 7.1, 7.2_

  - [ ]* 3.2 Write property test for authorization gate
    - **Property 5: Authorization gate**
    - Generate random user roles from `ALL_ROLES`, verify only `Admin`, `SuperAdmin`, `OrderAdmin` roles succeed
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 7.1, 7.2**

- [x] 4. Update `getOrderStats` to include cancelled count
  - Update `getOrderStats` in `packages/backend/src/orders/admin-order.ts` to count `cancelled` orders
    - Add `stats.cancelled = 0` initialization
    - Add `else if (s === 'cancelled') stats.cancelled++` in the counting loop
    - _Requirements: 11.3_

  - [ ]* 4.1 Write property test for order stats cancelled count
    - **Property 7: Order stats cancelled count**
    - Generate random sets of orders with random statuses, verify `getOrderStats` returns correct `cancelled` count
    - Test file: `packages/backend/src/orders/order-cancel.property.test.ts`
    - **Validates: Requirements 11.3**

- [x] 5. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update admin orders page for cancel functionality
  - [x] 6.1 Add cancelled status to tabs and labels in `packages/frontend/src/pages/admin/orders.tsx`
    - Add `cancelled: t('admin.orders.statusCancelled')` to `STATUS_LABELS`
    - Add `{ key: 'cancelled', label: t('admin.orders.statusCancelled') }` to `STATUS_TABS`
    - Update stats display to include cancelled count
    - _Requirements: 6.4, 11.1, 11.2, 11.3_

  - [x] 6.2 Add cancel button and confirmation dialog in `packages/frontend/src/pages/admin/orders.tsx`
    - Add "无法完成发货" button in order detail view, visible only when `shippingStatus === 'pending'`, using `btn-danger` class
    - Add confirmation dialog component showing orderId and totalPoints
    - Add cancel request handler: `POST /api/admin/orders/{orderId}/cancel`
    - Disable confirm button and show loading indicator during request
    - Show success toast on completion, refresh order list and stats
    - Handle `userDeleted` response with appropriate message
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 7. Update user orders page for cancelled status display
  - [x] 7.1 Add cancelled status config in `packages/frontend/src/pages/orders/index.tsx`
    - Add `cancelled` entry to `STATUS_CONFIG` with appropriate icon, label key, and CSS class
    - _Requirements: 12.1_

  - [x] 7.2 Update order detail page for cancelled status in `packages/frontend/src/pages/order-detail/index.tsx`
    - Add `cancelled` to `STATUS_LABEL_KEY`, `STATUS_ICON`, `STATUS_CLASS`
    - Display refund information when order is cancelled (show refunded points amount)
    - _Requirements: 12.2, 12.3_

- [x] 8. Add i18n translations for all 5 languages
  - [x] 8.1 Add translation keys to `packages/frontend/src/i18n/zh.ts`
    - Add keys: `admin.orders.statusCancelled`, `admin.orders.cancelButton`, `admin.orders.cancelDialogTitle`, `admin.orders.cancelDialogMessage`, `admin.orders.cancelConfirmButton`, `admin.orders.cancelSuccess`, `admin.orders.cancelSuccessUserDeleted`, `admin.orders.statsCancelled`, `orders.statusCancelled`, `orders.refundInfo`
    - _Requirements: 10.1, 10.2_

  - [x] 8.2 Add translation keys to `packages/frontend/src/i18n/en.ts`
    - Same keys as 8.1 with English translations
    - _Requirements: 10.1, 10.2_

  - [x] 8.3 Add translation keys to `packages/frontend/src/i18n/zh-TW.ts`
    - Same keys as 8.1 with Traditional Chinese translations
    - _Requirements: 10.1, 10.2_

  - [x] 8.4 Add translation keys to `packages/frontend/src/i18n/ja.ts`
    - Same keys as 8.1 with Japanese translations
    - _Requirements: 10.1, 10.2_

  - [x] 8.5 Add translation keys to `packages/frontend/src/i18n/ko.ts`
    - Same keys as 8.1 with Korean translations
    - _Requirements: 10.1, 10.2_

- [x] 9. Add SCSS styles for cancelled status and cancel dialog
  - [x] 9.1 Add styles to `packages/frontend/src/pages/admin/orders.scss`
    - Add `.order-card__status--cancelled` — error-themed status badge using `var(--error)` color
    - Add `.cancel-confirm-dialog` — confirmation modal overlay and content styles
    - Add `.shipping-timeline__item--cancelled` — timeline dot style for cancelled events
    - _Requirements: 1.3, 6.4_

  - [x] 9.2 Add styles to `packages/frontend/src/pages/orders/index.scss`
    - Add `.orders-status--cancelled` — cancelled status badge for user order list
    - _Requirements: 12.1_

  - [x] 9.3 Add styles to `packages/frontend/src/pages/order-detail/index.scss`
    - Add `.detail-timeline__dot--cancelled` — timeline dot for cancelled events
    - Add `.detail-refund-info` — refund information display block
    - _Requirements: 12.2, 12.3_

- [x] 10. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- `cancelled` is a branch state off `pending`, NOT part of the linear `SHIPPING_STATUS_ORDER` array
- Stock restoration is best-effort and separated from the main transaction to handle deleted products gracefully
- The main transaction uses `ConditionExpression` on order status to prevent double-cancel race conditions
- `earnTotal` is never modified during refund — refunded points were originally spent, not earned
