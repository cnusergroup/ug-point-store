# Requirements Document

## Introduction

This feature adds an "Unable to Ship" (无法完成发货) order cancellation and refund capability to the admin order management page. When an admin determines that a pending order cannot be fulfilled, they can cancel the order, which atomically refunds the user's points, restores product stock (including size-specific stock), creates an audit trail in the points history, and updates the order status. The feature must be backward compatible with the live production system and maintain data consistency across all affected DynamoDB tables.

## Glossary

- **Admin**: A user with the `Admin`, `SuperAdmin`, or `OrderAdmin` role who has access to the order management page.
- **Cancel_Refund_Service**: The backend service responsible for atomically cancelling an order and processing the associated refund.
- **Order**: A record in the `PointsMall-Orders` DynamoDB table containing orderId, userId, items, totalPoints, shippingStatus, and shippingEvents.
- **Points_Record**: A record in the `PointsMall-PointsRecords` DynamoDB table that tracks points transactions for audit purposes.
- **Product**: A record in the `PointsMall-Products` DynamoDB table containing stock, sizeOptions, and redemptionCount fields.
- **User**: A record in the `PointsMall-Users` DynamoDB table containing points and earnTotal fields.
- **Pending_Order**: An order with `shippingStatus` equal to `"pending"` (待发货).
- **Confirmation_Dialog**: A modal UI component requiring the admin to explicitly confirm the cancellation action before it is executed.
- **Refund_Points_Record**: A Points_Record with `type: "refund"` and a positive `amount` representing points returned to the user.
- **DynamoDB_Transaction**: A DynamoDB `TransactWriteItems` operation that ensures all writes succeed or all fail atomically.

## Requirements

### Requirement 1: Admin Cancel Order Button

**User Story:** As an Admin, I want to see an "Unable to Ship" button on pending orders, so that I can initiate the cancellation and refund process.

#### Acceptance Criteria

1. WHILE an Order has `shippingStatus` equal to `"pending"`, THE Admin Order Detail view SHALL display an "Unable to Ship" (无法完成发货) button.
2. WHILE an Order has `shippingStatus` not equal to `"pending"`, THE Admin Order Detail view SHALL hide the "Unable to Ship" button.
3. THE Admin Order Detail view SHALL render the "Unable to Ship" button using the existing `btn-danger` style class.
4. WHEN the Admin clicks the "Unable to Ship" button, THE Admin Order Detail view SHALL display a Confirmation_Dialog asking the admin to confirm the cancellation.

### Requirement 2: Confirmation Dialog

**User Story:** As an Admin, I want a confirmation dialog before cancelling an order, so that I do not accidentally cancel orders.

#### Acceptance Criteria

1. WHEN the Confirmation_Dialog is displayed, THE Confirmation_Dialog SHALL show the orderId and the totalPoints to be refunded.
2. WHEN the Admin clicks the "Confirm Cancel" button in the Confirmation_Dialog, THE Admin Order Detail view SHALL send a cancellation request to the Cancel_Refund_Service.
3. WHEN the Admin clicks the "Cancel" (取消) button in the Confirmation_Dialog, THE Confirmation_Dialog SHALL close without sending any request.
4. WHILE the cancellation request is in progress, THE Confirmation_Dialog SHALL disable the "Confirm Cancel" button and display a loading indicator.

### Requirement 3: Backend Order Cancellation with Atomic Transaction

**User Story:** As a system operator, I want the cancellation to be atomic, so that points refund, stock restoration, and order status update either all succeed or all fail.

#### Acceptance Criteria

1. WHEN the Cancel_Refund_Service receives a cancellation request, THE Cancel_Refund_Service SHALL verify that the Order exists and has `shippingStatus` equal to `"pending"`.
2. IF the Order does not exist, THEN THE Cancel_Refund_Service SHALL return an `ORDER_NOT_FOUND` error.
3. IF the Order `shippingStatus` is not `"pending"`, THEN THE Cancel_Refund_Service SHALL return an `INVALID_STATUS_TRANSITION` error.
4. WHEN the Order is valid for cancellation, THE Cancel_Refund_Service SHALL execute a single DynamoDB_Transaction containing all of the following write operations: update Order status to `"cancelled"`, restore User points, restore Product stock for each item, decrement Product redemptionCount for each item, and create a Refund_Points_Record.
5. IF the DynamoDB_Transaction fails, THEN THE Cancel_Refund_Service SHALL return an error without partially applying any changes.

### Requirement 4: Points Refund

**User Story:** As a user whose order was cancelled, I want my points refunded, so that I can use them for future purchases.

#### Acceptance Criteria

1. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL increase the User `points` field by the Order `totalPoints` value.
2. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL create a Refund_Points_Record with `type` set to `"refund"`, `amount` set to the positive value of Order `totalPoints`, `source` set to `"订单取消退还 {orderId}"`, and `balanceAfter` set to the User's new points balance after refund.
3. THE Cancel_Refund_Service SHALL NOT modify the User `earnTotal` field during a refund, because refunded points were originally spent, not earned.

### Requirement 5: Stock Restoration

**User Story:** As a store manager, I want cancelled order stock restored, so that other users can purchase those products.

#### Acceptance Criteria

1. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL increase the Product `stock` field by the `quantity` of each cancelled OrderItem.
2. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL decrease the Product `redemptionCount` field by the `quantity` of each cancelled OrderItem.
3. WHEN a cancelled OrderItem has a `selectedSize` value, THE Cancel_Refund_Service SHALL increase the matching `sizeOptions[index].stock` by the `quantity` of that OrderItem.
4. IF a Product referenced by a cancelled OrderItem no longer exists in the database, THEN THE Cancel_Refund_Service SHALL skip stock restoration for that Product and continue processing the remaining items.

### Requirement 6: Order Status Update

**User Story:** As an Admin, I want cancelled orders to show a clear "已取消" status, so that I can distinguish them from other orders.

#### Acceptance Criteria

1. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL set the Order `shippingStatus` to `"cancelled"`.
2. WHEN the Cancel_Refund_Service processes a cancellation, THE Cancel_Refund_Service SHALL append a new ShippingEvent with `status` set to `"cancelled"`, `timestamp` set to the current ISO timestamp, `remark` set to `"无法完成发货，订单已取消并退还积分"`, and `operatorId` set to the Admin's userId.
3. THE cancelled Order SHALL remain visible in the admin order list and user order history with the `"cancelled"` status.
4. THE Admin Order List view SHALL display a `"已取消"` label for orders with `shippingStatus` equal to `"cancelled"`.

### Requirement 7: Authorization

**User Story:** As a system administrator, I want only authorized admins to cancel orders, so that the cancellation feature is protected from unauthorized use.

#### Acceptance Criteria

1. THE Cancel_Refund_Service SHALL accept cancellation requests only from users with `Admin`, `SuperAdmin`, or `OrderAdmin` roles.
2. IF a non-admin user sends a cancellation request, THEN THE Cancel_Refund_Service SHALL return a `FORBIDDEN` error with HTTP status 403.

### Requirement 8: Edge Case — Deleted User

**User Story:** As a system operator, I want the cancellation to handle deleted users gracefully, so that the system does not crash on edge cases.

#### Acceptance Criteria

1. IF the User referenced by the Order `userId` no longer exists in the database, THEN THE Cancel_Refund_Service SHALL still update the Order status to `"cancelled"` and restore Product stock, but skip the points refund and Refund_Points_Record creation.
2. WHEN a cancellation skips the points refund due to a missing User, THE Cancel_Refund_Service SHALL set the ShippingEvent `remark` to `"无法完成发货，订单已取消（用户已删除，积分未退还）"`.

### Requirement 9: Shared Type Updates (Backward Compatibility)

**User Story:** As a developer, I want the type system updated to include the new "cancelled" status, so that the codebase remains type-safe and backward compatible.

#### Acceptance Criteria

1. THE shared `ShippingStatus` type SHALL include `"cancelled"` as a valid value in addition to the existing `"pending"` and `"shipped"` values.
2. THE shared `PointsRecordType` type SHALL include `"refund"` as a valid value in addition to the existing `"earn"` and `"spend"` values.
3. THE `validateStatusTransition` function SHALL allow the transition from `"pending"` to `"cancelled"` and reject transitions from `"shipped"` to `"cancelled"`.
4. THE `OrderStats` interface SHALL include a `cancelled` count field.
5. THE `SHIPPING_STATUS_ORDER` array SHALL NOT include `"cancelled"` because cancelled is a terminal branch state, not part of the linear shipping flow.

### Requirement 10: Internationalization (i18n)

**User Story:** As a user in any supported locale, I want all new UI text to be displayed in my language, so that the experience is consistent.

#### Acceptance Criteria

1. THE frontend SHALL provide translations for all new UI text in five languages: zh (简体中文), en (English), zh-TW (繁體中文), ja (日本語), ko (한국어).
2. THE translations SHALL include keys for: the "Unable to Ship" button label, the confirmation dialog title, the confirmation dialog message, the "Confirm Cancel" button label, the success toast message, the "已取消" status label, and any error messages displayed to the admin.

### Requirement 11: Admin Order List Filter Update

**User Story:** As an Admin, I want to filter orders by "cancelled" status, so that I can review all cancelled orders.

#### Acceptance Criteria

1. THE Admin Order List view SHALL include a `"已取消"` tab in the status filter tabs.
2. WHEN the Admin selects the `"已取消"` tab, THE Admin Order List view SHALL query and display only orders with `shippingStatus` equal to `"cancelled"`.
3. THE Admin Order Stats SHALL include the count of cancelled orders.

### Requirement 12: User Order History Display

**User Story:** As a user, I want to see cancelled orders in my order history with a clear status, so that I understand what happened to my order.

#### Acceptance Criteria

1. THE User Order List view SHALL display cancelled orders with a `"已取消"` status label.
2. WHEN a user views the detail of a cancelled order, THE User Order Detail view SHALL show the cancellation event in the shipping timeline with the remark text.
3. THE User Order Detail view SHALL display the refund information showing the points amount that was returned.
