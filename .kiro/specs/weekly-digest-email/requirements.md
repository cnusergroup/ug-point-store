# Requirements Document

## Introduction

为积分商城系统添加每周摘要邮件功能。系统在每周日自动汇总本周新增的商品和新增的已审核内容，向订阅了相应通知的用户发送一封摘要邮件。该功能复用现有的 AWS SES 邮件发送基础设施、DynamoDB 邮件模板系统和多语言支持（zh/en/ja/ko/zh-TW）。通过 EventBridge 定时规则触发专用 Lambda 函数，在每周日 UTC 时间 00:00 执行。SuperAdmin 可通过 feature toggle 控制该功能的开关，并可编辑摘要邮件模板。用户可通过现有的邮件订阅偏好（newProduct / newContent）决定是否接收摘要邮件。当本周既无新商品也无新内容时，系统跳过发送。

## Glossary

- **System**: 积分商城应用（前端 Taro H5 + 后端 AWS Lambda + DynamoDB）
- **Digest_Lambda**: 专用于每周摘要邮件发送的 AWS Lambda 函数，由 EventBridge 定时规则触发
- **EventBridge_Rule**: AWS EventBridge 定时规则，配置为每周日 UTC 00:00 触发 Digest_Lambda
- **Weekly_Digest**: 一封汇总邮件，包含过去 7 天内新增的商品列表和新增的已审核内容列表
- **Products_Table**: DynamoDB 表 `PointsMall-Products`，包含 `createdAt` 字段
- **ContentItems_Table**: DynamoDB 表 `PointsMall-ContentItems`，包含 `createdAt` 和 `status` 字段
- **Users_Table**: DynamoDB 表 `PointsMall-Users`，包含 `email`、`nickname`、`locale`、`emailSubscriptions` 字段
- **Email_Templates_Table**: DynamoDB 表 `PointsMall-EmailTemplates`，存储邮件模板
- **Digest_Toggle**: feature toggles 中的布尔值 `emailWeeklyDigestEnabled`，控制每周摘要邮件功能的全局开关
- **Subscriber**: 满足以下条件之一的用户：`emailSubscriptions.newProduct` 为 `true` 或 `emailSubscriptions.newContent` 为 `true`，且拥有有效的 email 地址
- **Digest_Template**: 通知类型为 `weeklyDigest` 的 Email_Template，包含 `{{nickname}}`、`{{productList}}`、`{{contentList}}`、`{{weekStart}}`、`{{weekEnd}}` 模板变量
- **Locale**: 五种支持的语言代码之一：`zh`、`en`、`ja`、`ko`、`zh-TW`
- **Locale_Group**: 共享相同 Locale 偏好的收件人集合，用于发送特定语言版本的摘要邮件
- **SES_Client**: 封装 AWS SES SDK v3 的共享邮件发送工具模块

## Requirements

### Requirement 1: EventBridge 定时触发

**User Story:** 作为系统运维人员，我希望系统每周日自动触发摘要邮件发送流程，以便用户定期收到本周新增内容的汇总。

#### Acceptance Criteria

1. THE System SHALL create an EventBridge_Rule with a cron expression that triggers Digest_Lambda every Sunday at UTC 00:00
2. THE EventBridge_Rule SHALL pass an empty event payload to Digest_Lambda
3. THE Digest_Lambda SHALL have a timeout of 120 seconds to accommodate scanning tables and sending bulk emails
4. THE Digest_Lambda SHALL have read access to Products_Table, ContentItems_Table, Users_Table, and Email_Templates_Table
5. THE Digest_Lambda SHALL have `ses:SendEmail` and `ses:SendRawEmail` IAM permissions scoped to the verified sender identity

### Requirement 2: 查询本周新增商品

**User Story:** 作为用户，我希望摘要邮件中包含本周新上架的商品列表，以便我了解有哪些新商品可以兑换。

#### Acceptance Criteria

1. WHEN Digest_Lambda is triggered, THE Digest_Lambda SHALL query Products_Table for all products with `createdAt` within the past 7 days from the current execution time
2. THE Digest_Lambda SHALL collect the product name (`name`) and points cost (`pointsCost`) from each matching product record
3. THE Digest_Lambda SHALL sort the new products by `createdAt` in descending order (newest first)
4. WHEN no products are found within the past 7 days, THE Digest_Lambda SHALL set the product list to an empty collection

### Requirement 3: 查询本周新增内容

**User Story:** 作为用户，我希望摘要邮件中包含本周新发布的内容列表，以便我了解有哪些新内容可以查看。

#### Acceptance Criteria

1. WHEN Digest_Lambda is triggered, THE Digest_Lambda SHALL query ContentItems_Table for all content items with `createdAt` within the past 7 days and `status` equal to `approved`
2. THE Digest_Lambda SHALL collect the content title (`title`) and author name from each matching content item record
3. THE Digest_Lambda SHALL sort the new content items by `createdAt` in descending order (newest first)
4. WHEN no approved content items are found within the past 7 days, THE Digest_Lambda SHALL set the content list to an empty collection

### Requirement 4: 跳过空摘要

**User Story:** 作为用户，我不希望收到没有任何新内容的空摘要邮件，以免造成邮件骚扰。

#### Acceptance Criteria

1. WHEN both the new product list and the new content list are empty, THE Digest_Lambda SHALL skip the entire email sending process and log a message indicating no digest is needed
2. WHEN at least one of the new product list or the new content list contains items, THE Digest_Lambda SHALL proceed with composing and sending the Weekly_Digest email

### Requirement 5: 确定收件人

**User Story:** 作为系统运维人员，我希望摘要邮件只发送给订阅了相关通知的用户，以便尊重用户的通知偏好。

#### Acceptance Criteria

1. THE Digest_Lambda SHALL scan Users_Table to find all Subscriber users who have a valid email address and at least one of `emailSubscriptions.newProduct` or `emailSubscriptions.newContent` set to `true`
2. WHEN a Subscriber has `emailSubscriptions.newProduct` set to `true` but `emailSubscriptions.newContent` set to `false`, THE Digest_Lambda SHALL include only the new product section in that user's digest email
3. WHEN a Subscriber has `emailSubscriptions.newContent` set to `true` but `emailSubscriptions.newProduct` set to `false`, THE Digest_Lambda SHALL include only the new content section in that user's digest email
4. WHEN a Subscriber has both `emailSubscriptions.newProduct` and `emailSubscriptions.newContent` set to `true`, THE Digest_Lambda SHALL include both sections in that user's digest email
5. THE Digest_Lambda SHALL group Subscriber users by Locale_Group for locale-specific email rendering

### Requirement 6: 摘要邮件模板

**User Story:** 作为 SuperAdmin，我希望摘要邮件使用可编辑的模板，以便我可以自定义邮件的外观和措辞。

#### Acceptance Criteria

1. THE System SHALL register `weeklyDigest` as a new Notification_Type with template variables: `{{nickname}}`、`{{productList}}`、`{{contentList}}`、`{{weekStart}}`、`{{weekEnd}}`
2. THE System SHALL store Digest_Template records in Email_Templates_Table with a composite key of `weeklyDigest` and Locale
3. THE System SHALL seed default Digest_Template records for all five Locale variants upon deployment
4. THE System SHALL seed the default Chinese Digest_Template with a playful subject line such as "📬 本周福利广场新鲜事，快来看看！"
5. THE System SHALL seed corresponding English, Japanese, Korean, and Traditional Chinese Digest_Template variants
6. WHEN the product list is empty for a specific user, THE Digest_Lambda SHALL replace `{{productList}}` with a locale-appropriate "no new products this week" message
7. WHEN the content list is empty for a specific user, THE Digest_Lambda SHALL replace `{{contentList}}` with a locale-appropriate "no new content this week" message

### Requirement 7: 邮件发送与多语言支持

**User Story:** 作为非中文用户，我希望收到我偏好语言版本的摘要邮件，以便我能理解邮件内容。

#### Acceptance Criteria

1. WHEN sending the Weekly_Digest, THE Digest_Lambda SHALL load the Digest_Template matching each Locale_Group's locale
2. IF a Digest_Template for a specific Locale is not found, THEN THE Digest_Lambda SHALL fall back to the `zh` locale Digest_Template
3. THE Digest_Lambda SHALL replace all template variables (`{{nickname}}`、`{{productList}}`、`{{contentList}}`、`{{weekStart}}`、`{{weekEnd}}`) with actual values before sending
4. THE Digest_Lambda SHALL use the existing SES_Client `sendBulkEmail` function with BCC batching (maximum 50 recipients per SES call) for each Locale_Group
5. THE Digest_Lambda SHALL introduce a 100-millisecond delay between consecutive batch SES calls to avoid SES throttling
6. THE Digest_Lambda SHALL log the success or failure status of each batch, including batch index and recipient count

### Requirement 8: Feature Toggle 控制

**User Story:** 作为 SuperAdmin，我希望通过 feature toggle 控制每周摘要邮件功能的开关，以便在需要时快速启用或禁用该功能。

#### Acceptance Criteria

1. THE System SHALL add a Digest_Toggle (`emailWeeklyDigestEnabled`) to the FeatureToggles interface, defaulting to `false`
2. WHEN Digest_Lambda is triggered and Digest_Toggle is set to `false`, THE Digest_Lambda SHALL skip the entire process and log a message indicating the feature is disabled
3. WHEN a SuperAdmin updates the Digest_Toggle value, THE System SHALL persist the change in DynamoDB
4. WHEN a non-SuperAdmin user attempts to update the Digest_Toggle, THE System SHALL return HTTP 403 FORBIDDEN
5. THE System SHALL display the Digest_Toggle in the admin settings page alongside other email notification toggles

### Requirement 9: 摘要邮件模板编辑

**User Story:** 作为 SuperAdmin，我希望能在管理后台编辑摘要邮件模板，以便自定义邮件内容而无需修改代码。

#### Acceptance Criteria

1. WHEN a SuperAdmin navigates to the email template editor, THE System SHALL include `weeklyDigest` in the list of available Notification_Type options
2. WHEN a SuperAdmin edits the Digest_Template, THE System SHALL validate that the subject is 1–200 characters and the body is 1–10000 characters
3. THE System SHALL display the available template variables (`nickname`、`productList`、`contentList`、`weekStart`、`weekEnd`) as reference alongside the template editor
4. WHEN a non-SuperAdmin user attempts to edit the Digest_Template, THE System SHALL return HTTP 403 FORBIDDEN

### Requirement 10: CDK 基础设施

**User Story:** 作为开发者，我希望通过 CDK 定义摘要邮件所需的 Lambda 函数和 EventBridge 规则，以便基础设施可以通过代码管理和部署。

#### Acceptance Criteria

1. THE System SHALL define Digest_Lambda as a new NodejsFunction in the CDK ApiStack with entry point at `packages/backend/src/digest/handler.ts`
2. THE System SHALL create an EventBridge_Rule in CDK with a cron schedule of `cron(0 0 ? * SUN *)` targeting Digest_Lambda
3. THE System SHALL grant Digest_Lambda read access to Products_Table, ContentItems_Table, Users_Table, and Email_Templates_Table
4. THE System SHALL grant Digest_Lambda `ses:SendEmail` and `ses:SendRawEmail` IAM permissions scoped to the verified sender identity
5. THE System SHALL pass the required environment variables (table names, sender email) to Digest_Lambda
6. THE System SHALL set Digest_Lambda timeout to 120 seconds and memory to 512 MB

### Requirement 11: 前端国际化

**User Story:** 作为任何语言的用户，我希望管理后台中与每周摘要相关的 UI 标签都有对应的翻译，以便界面完全本地化。

#### Acceptance Criteria

1. THE System SHALL include translations for the Digest_Toggle label in all five locale files (zh, en, ja, ko, zh-TW)
2. THE System SHALL include translations for the `weeklyDigest` template type name in all five locale files
3. THE System SHALL include translations for the template variable descriptions in all five locale files

### Requirement 12: 错误处理与日志

**User Story:** 作为系统运维人员，我希望摘要邮件发送过程中的错误被妥善处理和记录，以便排查问题。

#### Acceptance Criteria

1. IF Digest_Lambda encounters a DynamoDB read error during product or content querying, THEN THE Digest_Lambda SHALL log the error details and terminate gracefully without sending any emails
2. IF a batch SES call fails during digest sending, THEN THE Digest_Lambda SHALL log the error details and continue processing remaining batches
3. THE Digest_Lambda SHALL log a summary at the end of execution, including: total subscribers, emails sent successfully, emails failed, new product count, and new content count
4. IF Digest_Lambda execution exceeds the timeout, THEN THE System SHALL rely on Lambda's built-in timeout handling and CloudWatch logging for diagnosis
