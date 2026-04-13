# Requirements Document

## Introduction

Add an email notification system to the Points Mall application. The system uses AWS SES (production access, verified domain `awscommunity.cn`, sender `store@awscommunity.cn`) to send transactional and marketing emails. Six notification types are supported: points earned, new order (to OrderAdmin), order shipped, new products, new content, and template management. Templates are stored in DynamoDB with multi-locale support (zh/en/ja/ko/zh-TW), use `{{variableName}}` syntax for dynamic variables, and feature a playful/fun Chinese tone by default. SuperAdmin controls enable/disable toggles per notification type and can edit template content. Users can opt in to new product and new content notifications via subscription preferences.

## Glossary

- **System**: The Points Mall application (frontend + backend Lambda functions)
- **SES_Client**: A shared utility module wrapping the AWS SES SDK v3 `SendEmailCommand` for sending emails
- **Email_Template**: A DynamoDB record containing a subject line and HTML body for a specific notification type and locale, supporting `{{variableName}}` dynamic replacement
- **Template_Variable**: A placeholder in the format `{{variableName}}` within an Email_Template that is replaced with actual values at send time
- **Notification_Type**: One of six email categories: `pointsEarned`, `newOrder`, `orderShipped`, `newProduct`, `newContent`, `templateManagement`
- **Email_Toggle**: A boolean setting per Notification_Type stored in the feature toggles record, controlling whether that notification type is active
- **User_Subscription**: A per-user preference object (`emailSubscriptions`) stored in the Users table with boolean fields `newProduct` and `newContent`, defaulting to `false`
- **Bulk_Send**: An email operation targeting multiple recipients using BCC, batched at a maximum of 50 recipients per SES call
- **Locale**: One of the five supported language codes: `zh`, `en`, `ja`, `ko`, `zh-TW`
- **Locale_Group**: A set of recipients sharing the same Locale preference, used to send locale-specific bulk emails
- **SuperAdmin**: The highest-privilege administrator role that can manage all settings including email templates and toggles
- **OrderAdmin**: A dedicated order management role that receives new order notifications
- **Email_Templates_Table**: A DynamoDB table (or partition within the Users table) storing Email_Template records keyed by notification type and locale
- **Sender_Address**: The fixed sender email `store@awscommunity.cn`

## Requirements

### Requirement 1: Email Template Storage

**User Story:** As a SuperAdmin, I want email templates stored in DynamoDB with locale variants, so that the system can send localized emails for each notification type.

#### Acceptance Criteria

1. THE System SHALL store Email_Template records in DynamoDB with a composite key of Notification_Type and Locale
2. THE System SHALL support five Locale variants (`zh`, `en`, `ja`, `ko`, `zh-TW`) for each of the six Notification_Type values
3. THE System SHALL define each Email_Template with a `subject` field (string, 1–200 characters) and a `body` field (HTML string, 1–10000 characters)
4. THE System SHALL support Template_Variable placeholders in the format `{{variableName}}` within both subject and body fields
5. THE System SHALL define the following Template_Variable sets per Notification_Type:
   - `pointsEarned`: `{{nickname}}`, `{{points}}`, `{{source}}`, `{{balance}}`
   - `newOrder`: `{{orderId}}`, `{{productNames}}`, `{{totalPoints}}`, `{{buyerNickname}}`
   - `orderShipped`: `{{nickname}}`, `{{orderId}}`, `{{trackingNumber}}`
   - `newProduct`: `{{nickname}}`, `{{productList}}`
   - `newContent`: `{{nickname}}`, `{{contentList}}`
6. WHEN the System is deployed for the first time, THE System SHALL seed default Email_Template records for all six Notification_Type values across all five Locale variants

### Requirement 2: Default Template Content

**User Story:** As a system operator, I want default templates seeded with a playful/fun tone in Chinese, so that the system is ready to send emails immediately after deployment.

#### Acceptance Criteria

1. THE System SHALL seed the `pointsEarned` default Chinese template with a playful subject line such as "积分到账啦，快来商城逛逛吧！"
2. THE System SHALL seed the `newOrder` default Chinese template with a playful subject line such as "有新订单啦，注意发货哦！"
3. THE System SHALL seed the `orderShipped` default Chinese template with a playful subject line such as "你的包裹已发出，注意查收！"
4. THE System SHALL seed the `newProduct` default Chinese template with a subject line referencing new product availability
5. THE System SHALL seed the `newContent` default Chinese template with a subject line referencing new content availability
6. THE System SHALL seed corresponding English, Japanese, Korean, and Traditional Chinese template variants for all Notification_Type values
7. THE System SHALL include appropriate Template_Variable placeholders in all default template bodies

### Requirement 3: Template Editing by SuperAdmin

**User Story:** As a SuperAdmin, I want to edit email template subject and body content for each locale, so that I can customize notification messaging without code changes.

#### Acceptance Criteria

1. WHEN a SuperAdmin submits an edit request for an Email_Template, THE System SHALL update the `subject` and `body` fields for the specified Notification_Type and Locale
2. WHEN a SuperAdmin edits an Email_Template, THE System SHALL preserve all Template_Variable placeholders documented for that Notification_Type
3. WHEN a non-SuperAdmin user attempts to edit an Email_Template, THE System SHALL return HTTP 403 FORBIDDEN
4. THE System SHALL validate that the edited `subject` is 1–200 characters and the edited `body` is 1–10000 characters
5. WHEN a SuperAdmin requests the template editor page, THE System SHALL display the current template content with Template_Variable documentation for reference

### Requirement 4: Template Variable Replacement

**User Story:** As a developer, I want a reliable variable replacement mechanism, so that email content is personalized with actual data at send time.

#### Acceptance Criteria

1. WHEN the System prepares an email for sending, THE SES_Client SHALL replace all Template_Variable placeholders in the subject and body with corresponding actual values
2. IF a Template_Variable placeholder has no corresponding value provided, THEN THE System SHALL replace the placeholder with an empty string
3. THE System SHALL perform variable replacement before passing the email content to the SES SDK

### Requirement 5: Shared Email Sending Utility

**User Story:** As a developer, I want a shared `sendEmail` utility function, so that all notification types use a consistent email sending mechanism.

#### Acceptance Criteria

1. THE SES_Client SHALL expose a `sendEmail` function that accepts recipient email(s), subject, HTML body, and sender address
2. THE SES_Client SHALL use the AWS SES SDK v3 `SendEmailCommand` to send emails
3. THE SES_Client SHALL use `store@awscommunity.cn` as the Sender_Address for all outgoing emails
4. WHEN sending to a single recipient, THE SES_Client SHALL place the recipient address in the TO field
5. WHEN sending to multiple recipients (Bulk_Send), THE SES_Client SHALL place recipient addresses in the BCC field with a maximum of 50 addresses per SES call
6. WHEN the recipient count exceeds 50, THE SES_Client SHALL split recipients into batches of 50 and send each batch as a separate SES call
7. WHEN sending multiple batches, THE SES_Client SHALL introduce a delay of 100 milliseconds between consecutive SES calls to avoid SES throttling
8. THE SES_Client SHALL log the result of each SES call (success or failure) for debugging purposes

### Requirement 6: Email Notification Toggles

**User Story:** As a SuperAdmin, I want to enable or disable each email notification type independently, so that I can control which notifications the system sends.

#### Acceptance Criteria

1. THE System SHALL store an Email_Toggle boolean for each of the six Notification_Type values in the feature toggles settings
2. WHEN a SuperAdmin updates an Email_Toggle, THE System SHALL persist the new value in DynamoDB
3. WHEN a Notification_Type Email_Toggle is set to `false`, THE System SHALL skip sending emails for that Notification_Type
4. WHEN a non-SuperAdmin user attempts to update an Email_Toggle, THE System SHALL return HTTP 403 FORBIDDEN
5. THE System SHALL default all Email_Toggle values to `false` (disabled) on first deployment

### Requirement 7: User Email Subscription Preferences

**User Story:** As a user, I want to opt in or out of new product and new content email notifications, so that I only receive marketing emails I am interested in.

#### Acceptance Criteria

1. THE System SHALL store User_Subscription preferences in the Users table as `emailSubscriptions.newProduct` (boolean) and `emailSubscriptions.newContent` (boolean)
2. THE System SHALL default both User_Subscription fields to `false` (opt-in model)
3. WHEN a user updates a User_Subscription preference, THE System SHALL persist the new value in the Users table
4. WHILE the corresponding Email_Toggle for `newProduct` is disabled, THE System SHALL hide the `newProduct` subscription toggle in the user settings frontend
5. WHILE the corresponding Email_Toggle for `newContent` is disabled, THE System SHALL hide the `newContent` subscription toggle in the user settings frontend
6. WHEN a user has `emailSubscriptions.newProduct` set to `false`, THE System SHALL exclude that user from new product Bulk_Send recipients
7. WHEN a user has `emailSubscriptions.newContent` set to `false`, THE System SHALL exclude that user from new content Bulk_Send recipients

### Requirement 8: Points Earned Notification

**User Story:** As a user, I want to receive an email when I earn points, so that I am informed about my points balance changes.

#### Acceptance Criteria

1. WHEN a user earns points through code redemption, THE System SHALL send a `pointsEarned` email to the user's registered email address
2. WHEN a user earns points through claim approval, THE System SHALL send a `pointsEarned` email to the user's registered email address
3. WHEN a user earns points through batch points distribution, THE System SHALL send a `pointsEarned` email to each affected user's registered email address
4. THE System SHALL use the recipient's Locale preference to select the appropriate `pointsEarned` Email_Template
5. THE System SHALL populate the `{{nickname}}`, `{{points}}`, `{{source}}`, and `{{balance}}` Template_Variables with actual values
6. WHILE the `pointsEarned` Email_Toggle is disabled, THE System SHALL skip sending `pointsEarned` emails

### Requirement 9: New Order Notification

**User Story:** As an OrderAdmin, I want to receive an email when a user places a new order, so that I can process shipments promptly.

#### Acceptance Criteria

1. WHEN a user successfully creates an order, THE System SHALL send a `newOrder` email to all users with the `OrderAdmin` role
2. WHEN a user successfully creates an order, THE System SHALL also send a `newOrder` email to all users with the `Admin` or `SuperAdmin` role
3. THE System SHALL use each recipient's Locale preference to select the appropriate `newOrder` Email_Template
4. THE System SHALL populate the `{{orderId}}`, `{{productNames}}`, `{{totalPoints}}`, and `{{buyerNickname}}` Template_Variables with actual order data
5. WHILE the `newOrder` Email_Toggle is disabled, THE System SHALL skip sending `newOrder` emails

### Requirement 10: Order Shipped Notification

**User Story:** As a user, I want to receive an email when my order is shipped, so that I know to expect a delivery.

#### Acceptance Criteria

1. WHEN an admin updates an order's shipping status to "shipped", THE System SHALL send an `orderShipped` email to the order's user
2. THE System SHALL use the recipient's Locale preference to select the appropriate `orderShipped` Email_Template
3. THE System SHALL populate the `{{nickname}}`, `{{orderId}}`, and `{{trackingNumber}}` Template_Variables with actual values
4. IF the tracking number is not provided, THEN THE System SHALL replace `{{trackingNumber}}` with an empty string
5. WHILE the `orderShipped` Email_Toggle is disabled, THE System SHALL skip sending `orderShipped` emails

### Requirement 11: New Product Notification (Manual Bulk Send)

**User Story:** As a SuperAdmin or Admin, I want to manually send a new product notification email to subscribed users, so that users are informed about recently listed products.

#### Acceptance Criteria

1. WHEN an admin triggers a new product notification, THE System SHALL display products listed within the last 7 days for selection
2. WHEN an admin selects products and confirms sending, THE System SHALL compose a single email containing all selected products
3. THE System SHALL send the `newProduct` email only to users with `emailSubscriptions.newProduct` set to `true`
4. THE System SHALL group recipients by Locale_Group and send separate locale-specific emails per group
5. WHEN sending to a Locale_Group, THE System SHALL use the BCC field with a maximum of 50 recipients per SES call
6. THE System SHALL populate the `{{nickname}}` and `{{productList}}` Template_Variables with actual values (nickname left empty for BCC bulk sends, productList containing selected product names and details)
7. WHILE the `newProduct` Email_Toggle is disabled, THE System SHALL prevent the admin from triggering the new product notification
8. THE System SHALL provide a preview of the email content before the admin confirms sending

### Requirement 12: New Content Notification (Manual Bulk Send)

**User Story:** As a SuperAdmin or Admin, I want to manually send a new content notification email to subscribed users, so that users are informed about recently published content.

#### Acceptance Criteria

1. WHEN an admin triggers a new content notification, THE System SHALL display approved content items listed within the last 7 days for selection
2. WHEN an admin selects content items and confirms sending, THE System SHALL compose a single email containing all selected content items
3. THE System SHALL send the `newContent` email only to users with `emailSubscriptions.newContent` set to `true`
4. THE System SHALL group recipients by Locale_Group and send separate locale-specific emails per group
5. WHEN sending to a Locale_Group, THE System SHALL use the BCC field with a maximum of 50 recipients per SES call
6. THE System SHALL populate the `{{nickname}}` and `{{contentList}}` Template_Variables with actual values (nickname left empty for BCC bulk sends, contentList containing selected content titles and details)
7. WHILE the `newContent` Email_Toggle is disabled, THE System SHALL prevent the admin from triggering the new content notification
8. THE System SHALL provide a preview of the email content before the admin confirms sending

### Requirement 13: Bulk Send Safety and Rate Limiting

**User Story:** As a system operator, I want bulk email sends to respect SES rate limits and provide logging, so that the system operates reliably without exceeding service quotas.

#### Acceptance Criteria

1. THE System SHALL limit each SES `SendEmailCommand` call to a maximum of 50 BCC recipients
2. WHEN the total recipient count exceeds 50, THE System SHALL split recipients into batches of 50 and process each batch sequentially
3. THE System SHALL introduce a 100-millisecond delay between consecutive batch SES calls
4. THE System SHALL log the success or failure status of each batch SES call, including the batch index and recipient count
5. IF a batch SES call fails, THEN THE System SHALL log the error details and continue processing remaining batches
6. THE System SHALL return a summary result indicating the total number of successful and failed batch sends

### Requirement 14: Multi-Locale Email Sending

**User Story:** As a user with a non-Chinese locale preference, I want to receive emails in my preferred language, so that the notifications are understandable.

#### Acceptance Criteria

1. WHEN sending a transactional email (pointsEarned, newOrder, orderShipped), THE System SHALL look up the recipient's Locale preference and select the matching Email_Template
2. WHEN sending a Bulk_Send email (newProduct, newContent), THE System SHALL group all recipients by their Locale preference into Locale_Groups
3. WHEN sending to each Locale_Group, THE System SHALL use the Email_Template matching that Locale
4. IF a recipient has no Locale preference set, THEN THE System SHALL default to the `zh` Locale Email_Template

### Requirement 15: Admin Email Settings Frontend

**User Story:** As a SuperAdmin, I want an admin settings section for email notifications, so that I can manage toggles and edit templates from the admin panel.

#### Acceptance Criteria

1. WHEN a SuperAdmin navigates to the admin settings page, THE System SHALL display an email notification section with enable/disable toggles for each Notification_Type
2. WHEN a SuperAdmin clicks on a template edit action, THE System SHALL display a template editor showing the current subject and body for the selected Notification_Type and Locale
3. THE System SHALL allow the SuperAdmin to switch between Locale tabs in the template editor
4. THE System SHALL display the available Template_Variable placeholders as reference documentation alongside the template editor
5. WHEN a non-SuperAdmin admin navigates to the admin settings page, THE System SHALL NOT display the email notification settings section

### Requirement 16: User Email Subscription Frontend

**User Story:** As a user, I want to manage my email subscription preferences from my settings page, so that I can control which marketing emails I receive.

#### Acceptance Criteria

1. WHEN a user navigates to the settings page, THE System SHALL display email subscription toggles for `newProduct` and `newContent`
2. WHILE the `newProduct` Email_Toggle is disabled by the admin, THE System SHALL hide the `newProduct` subscription toggle from the user settings page
3. WHILE the `newContent` Email_Toggle is disabled by the admin, THE System SHALL hide the `newContent` subscription toggle from the user settings page
4. WHEN a user toggles a subscription preference, THE System SHALL persist the change to the Users table immediately
5. THE System SHALL display the current subscription state accurately when the settings page loads

### Requirement 17: Admin Bulk Notification Trigger Frontend

**User Story:** As an admin, I want dedicated pages to trigger new product and new content notification emails, so that I can select items, preview, and send notifications efficiently.

#### Acceptance Criteria

1. WHEN an admin navigates to the "Send New Product Notification" page, THE System SHALL display a list of products created within the last 7 days with checkboxes for selection
2. WHEN an admin navigates to the "Send New Content Notification" page, THE System SHALL display a list of approved content items created within the last 7 days with checkboxes for selection
3. WHEN an admin selects items and clicks preview, THE System SHALL render a preview of the email using the current template and selected items
4. WHEN an admin confirms sending after preview, THE System SHALL trigger the Bulk_Send process and display a result summary (successful/failed batch counts)
5. WHILE the corresponding Email_Toggle is disabled, THE System SHALL display a disabled state on the trigger page with a message indicating the notification type is turned off

### Requirement 18: CDK Infrastructure for SES

**User Story:** As a developer, I want the necessary IAM permissions added to existing Lambda roles, so that the backend can send emails via SES without new infrastructure.

#### Acceptance Criteria

1. THE System SHALL add `ses:SendEmail` and `ses:SendRawEmail` IAM permissions to the backend Lambda function's execution role
2. THE System SHALL scope the SES IAM permissions to the verified sender identity `store@awscommunity.cn`
3. THE System SHALL NOT create new Lambda functions for email sending; email logic is added to existing Lambda handlers

### Requirement 19: Internationalization for Email Notification UI

**User Story:** As a user of any supported language, I want the email notification settings UI labels in my language, so that the interface is fully localized.

#### Acceptance Criteria

1. THE System SHALL include translations for all email notification UI labels in the Chinese (zh) locale file
2. THE System SHALL include translations for all email notification UI labels in the English (en) locale file
3. THE System SHALL include translations for all email notification UI labels in the Japanese (ja) locale file
4. THE System SHALL include translations for all email notification UI labels in the Korean (ko) locale file
5. THE System SHALL include translations for all email notification UI labels in the Traditional Chinese (zh-TW) locale file
6. THE System SHALL include translations for admin email settings labels, user subscription toggle labels, and bulk notification trigger page labels
