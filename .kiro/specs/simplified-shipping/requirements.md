# Requirements Document

## Introduction

简化发货流程：移除物流单号输入环节，管理员点击发货后直接更新订单状态为"已发货"。买家端不再显示物流单号，改为显示联系邮箱提示信息，引导用户通过邮件查询发货状态。

## Glossary

- **Shipping_Endpoint**: 后端 `PATCH /api/admin/orders/{orderId}/shipping` 接口，用于更新订单物流状态
- **Admin_Orders_Page**: 管理员订单管理页面 (`packages/frontend/src/pages/admin/orders.tsx`)，包含发货表单
- **Order_Detail_Page**: 买家订单详情页面 (`packages/frontend/src/pages/order-detail/index.tsx`)，展示订单状态和物流信息
- **Ship_Form**: Admin_Orders_Page 中的发货表单组件，管理员通过该表单更新订单物流状态
- **Status_Banner**: Order_Detail_Page 顶部的状态横幅区域，展示当前订单状态和附加信息
- **I18n_Module**: 前端国际化模块 (`packages/frontend/src/i18n/`)，包含 zh、en、ja、ko、zh-TW 五个语言文件
- **Contact_Email**: 发货状态查询联系邮箱，固定值为 `yuanliang@busite.cn`
- **Shared_Package**: 共享类型和工具包 (`packages/shared/`)，包含错误码、类型定义等

## Requirements

### Requirement 1: Remove Tracking Number Validation from Backend

**User Story:** As an admin, I want to ship an order without entering a tracking number, so that the shipping process is faster and simpler.

#### Acceptance Criteria

1. WHEN the Shipping_Endpoint receives a request with status "shipped" and no trackingNumber field, THE Shipping_Endpoint SHALL update the order status to "shipped" without returning an error
2. WHEN the Shipping_Endpoint receives a request with status "shipped" and an empty trackingNumber field, THE Shipping_Endpoint SHALL update the order status to "shipped" without returning an error
3. WHEN the Shipping_Endpoint receives a request with status "shipped" and a non-empty trackingNumber field, THE Shipping_Endpoint SHALL store the trackingNumber on the order record (backward compatibility)
4. THE Shipping_Endpoint SHALL no longer return the TRACKING_NUMBER_REQUIRED error code when status is "shipped"

### Requirement 2: Remove Tracking Number Input from Admin Ship Form

**User Story:** As an admin, I want the ship form to not require a tracking number, so that I can mark orders as shipped with a single click.

#### Acceptance Criteria

1. WHEN the Ship_Form is displayed with target status "shipped", THE Admin_Orders_Page SHALL hide the tracking number input field
2. WHEN the admin submits the Ship_Form with target status "shipped", THE Admin_Orders_Page SHALL send the request without client-side tracking number validation
3. WHEN the Admin_Orders_Page displays order detail for a shipped order, THE Admin_Orders_Page SHALL hide the tracking number section from the order detail view

### Requirement 3: Display Contact Email Message on Buyer Order Detail

**User Story:** As a buyer, I want to see how to check my shipping status when my order is shipped, so that I know who to contact.

#### Acceptance Criteria

1. WHEN the Order_Detail_Page displays an order with shippingStatus "shipped", THE Status_Banner SHALL display a contact message containing the Contact_Email address
2. WHEN the Order_Detail_Page displays an order with shippingStatus "shipped", THE Status_Banner SHALL hide the tracking number display
3. WHEN the Order_Detail_Page displays an order with shippingStatus "pending" or "cancelled", THE Status_Banner SHALL not display the contact email message

### Requirement 4: Add i18n Translation Keys for Contact Message

**User Story:** As a user in any supported locale, I want to see the shipping contact message in my language, so that I can understand how to inquire about shipping.

#### Acceptance Criteria

1. THE I18n_Module SHALL include a translation key for the shipping contact message in all five locales (zh, en, ja, ko, zh-TW)
2. WHEN the zh locale is active, THE I18n_Module SHALL provide the message "如需查询发货状态，请邮件联系 yuanliang@busite.cn"
3. WHEN the en locale is active, THE I18n_Module SHALL provide the message "To check shipping status, please email yuanliang@busite.cn"
4. WHEN the ja locale is active, THE I18n_Module SHALL provide the message "配送状況を確認するには、yuanliang@busite.cn までメールでお問い合わせください"
5. WHEN the ko locale is active, THE I18n_Module SHALL provide the message "배송 상태를 확인하려면 yuanliang@busite.cn으로 이메일 문의해 주세요"
6. WHEN the zh-TW locale is active, THE I18n_Module SHALL provide the message "如需查詢發貨狀態，請郵件聯繫 yuanliang@busite.cn"
7. THE I18n_Module SHALL add the new translation key to the i18n type definition file

### Requirement 5: Clean Up Shared Error Code

**User Story:** As a developer, I want the shared error codes to reflect the simplified shipping flow, so that the codebase stays consistent.

#### Acceptance Criteria

1. THE Shared_Package SHALL deprecate or remove the TRACKING_NUMBER_REQUIRED error code from ErrorCodes
2. THE Shared_Package SHALL deprecate or remove the corresponding entry from ErrorHttpStatus and ErrorMessages
3. THE Shared_Package SHALL retain the trackingNumber field as optional in UpdateShippingRequest and OrderResponse types (backward compatibility for existing orders)

### Requirement 6: Update Shipped Email Notification

**User Story:** As a system operator, I want the shipped email notification to work without a tracking number, so that buyers still receive a notification when their order ships.

#### Acceptance Criteria

1. WHEN the Shipping_Endpoint updates an order to "shipped" status without a trackingNumber, THE Shipping_Endpoint SHALL still send the order shipped email notification
2. WHEN the sendOrderShippedEmail function is called without a trackingNumber, THE sendOrderShippedEmail function SHALL send the email with the contact email message instead of a tracking number
