# Implementation Plan: Email Notification System

## Overview

Add a multi-locale email notification system to the Points Mall application using AWS SES. Implementation follows a bottom-up approach: CDK infrastructure first, then shared email utility module, backend integration into existing handlers, and finally frontend UI components with i18n translations.

## Tasks

- [x] 1. CDK Infrastructure — EmailTemplates table and SES permissions
  - [x] 1.1 Add EmailTemplates DynamoDB table to `packages/cdk/lib/database-stack.ts`
    - Add `emailTemplatesTable` public property to `DatabaseStack`
    - Create table with `tableName: 'PointsMall-EmailTemplates'`, PK=`templateId` (String), SK=`locale` (String), PAY_PER_REQUEST billing, DESTROY removal policy
    - Add CfnOutput for table name and ARN exports
    - _Requirements: 1.1_

  - [x] 1.2 Add SES permissions and EmailTemplates table access to `packages/cdk/lib/api-stack.ts`
    - Accept `emailTemplatesTable` in `ApiStackProps`
    - Add `ses:SendEmail` and `ses:SendRawEmail` IAM policy scoped to `arn:aws:ses:${this.region}:${this.account}:identity/awscommunity.cn` for Admin, Points, Order, and Content Lambdas
    - Add `EMAIL_TEMPLATES_TABLE` environment variable to Admin, Points, Order, and Content Lambdas
    - Grant `grantReadWriteData` on emailTemplatesTable to Admin Lambda, `grantReadData` to Points, Order, and Content Lambdas
    - _Requirements: 18.1, 18.2, 18.3_

  - [x] 1.3 Wire EmailTemplates table in `packages/cdk/bin/app.ts`
    - Pass `databaseStack.emailTemplatesTable` to `ApiStack` props
    - _Requirements: 18.1_

- [x] 2. Shared email utility module — `packages/backend/src/email/`
  - [x] 2.1 Create `packages/backend/src/email/send.ts` — core email sending functions
    - Define `NotificationType`, `EmailLocale`, `SendEmailInput`, `SendBulkEmailInput`, `BulkSendResult` types
    - Implement `sendEmail` using SES SDK v3 `SendEmailCommand` with TO field, sender `store@awscommunity.cn`
    - Implement `sendBulkEmail` using BCC field, batching at 50 recipients max, 100ms inter-batch delay, logging per batch, returning `BulkSendResult` with `successCount + failureCount === totalBatches`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 2.2 Create `packages/backend/src/email/templates.ts` — template management functions
    - Implement `replaceVariables(template, values)` — replace all `{{variableName}}` placeholders, missing values become empty string
    - Implement `getTemplate(dynamoClient, tableName, templateId, locale)` — fetch template by type + locale
    - Implement `updateTemplate(dynamoClient, tableName, template)` — update subject/body with validation
    - Implement `listTemplates(dynamoClient, tableName, templateId?)` — list templates, optionally filtered by type
    - Implement `validateTemplateInput(subject, body)` — subject 1–200 chars, body 1–10000 chars
    - Implement `getRequiredVariables(templateId)` — return variable names per notification type
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.2, 3.4, 4.1, 4.2, 4.3_

  - [x] 2.3 Create `packages/backend/src/email/seed.ts` — default template seeding
    - Implement `getDefaultTemplates()` returning all 25 default templates (5 types × 5 locales) with playful Chinese tone and localized variants
    - Implement `seedDefaultTemplates(dynamoClient, tableName)` — batch write all defaults
    - Include all template variable placeholders per notification type as defined in design
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.4 Create `packages/backend/src/email/notifications.ts` — high-level notification orchestration
    - Define `NotificationContext` interface with sesClient, dynamoClient, emailTemplatesTable, usersTable, senderEmail
    - Implement `sendPointsEarnedEmail(ctx, userId, points, source, balance)` — check toggle, load user locale, load template, replace variables, send
    - Implement `sendNewOrderEmail(ctx, orderId, productNames, totalPoints, buyerNickname)` — check toggle, find all Admin/SuperAdmin/OrderAdmin users, send per-locale emails
    - Implement `sendOrderShippedEmail(ctx, userId, orderId, trackingNumber?)` — check toggle, load user locale, send
    - Implement `sendNewProductNotification(ctx, productList, subscribedUsers)` — check toggle, group by locale, bulk send per locale group
    - Implement `sendNewContentNotification(ctx, contentList, subscribedUsers)` — check toggle, group by locale, bulk send per locale group
    - All functions: read email toggle from feature toggles, skip if disabled, log errors without failing parent operation
    - _Requirements: 6.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 11.3, 11.4, 12.3, 12.4, 14.1, 14.2, 14.3, 14.4_

- [x] 3. Email utility tests
  - [x] 3.1 Write property test: Template variable replacement completeness
    - **Property 1: Template variable replacement completeness**
    - **Validates: Requirements 4.1, 4.2**
    - File: `packages/backend/src/email/send.property.test.ts`

  - [x] 3.2 Write property test: Template validation accepts valid and rejects invalid lengths
    - **Property 2: Template validation accepts valid and rejects invalid lengths**
    - **Validates: Requirements 1.3, 3.4**
    - File: `packages/backend/src/email/send.property.test.ts`

  - [x] 3.3 Write property test: Bulk send batch splitting correctness
    - **Property 3: Bulk send batch splitting correctness**
    - **Validates: Requirements 5.5, 5.6, 13.1, 13.2**
    - File: `packages/backend/src/email/send.property.test.ts`

  - [x] 3.4 Write property test: Bulk send resilience and summary accuracy
    - **Property 7: Bulk send resilience and summary accuracy**
    - **Validates: Requirements 13.5, 13.6**
    - File: `packages/backend/src/email/send.property.test.ts`

  - [x] 3.5 Write property test: Subscription filtering excludes unsubscribed users
    - **Property 4: Subscription filtering excludes unsubscribed users**
    - **Validates: Requirements 7.6, 7.7**
    - File: `packages/backend/src/email/notifications.property.test.ts`

  - [x] 3.6 Write property test: Locale-based template selection with zh default
    - **Property 5: Locale-based template selection with zh default**
    - **Validates: Requirements 8.4, 14.1, 14.4**
    - File: `packages/backend/src/email/notifications.property.test.ts`

  - [x] 3.7 Write property test: Locale grouping for bulk sends
    - **Property 6: Locale grouping for bulk sends**
    - **Validates: Requirements 11.4, 12.4, 14.2, 14.3**
    - File: `packages/backend/src/email/notifications.property.test.ts`

  - [x] 3.8 Write property test: Email toggle disables sending
    - **Property 8: Email toggle disables sending**
    - **Validates: Requirements 6.3, 8.6, 9.5, 10.5**
    - File: `packages/backend/src/email/notifications.property.test.ts`

  - [x] 3.9 Write unit tests for send.ts, templates.ts, and seed.ts
    - File: `packages/backend/src/email/send.test.ts` — sendEmail/sendBulkEmail with mocked SES client
    - File: `packages/backend/src/email/templates.test.ts` — template CRUD, validation edge cases, replaceVariables examples
    - File: `packages/backend/src/email/notifications.test.ts` — notification orchestration with mocked dependencies
    - _Requirements: 1.6, 2.1, 4.1, 5.1, 13.6_

- [x] 4. Checkpoint — Ensure all email utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Backend integration — email toggles in feature toggles
  - [x] 5.1 Extend `FeatureToggles` interface in `packages/backend/src/settings/feature-toggles.ts`
    - Add `emailPointsEarnedEnabled`, `emailNewOrderEnabled`, `emailOrderShippedEnabled`, `emailNewProductEnabled`, `emailNewContentEnabled` boolean fields (default: false)
    - Update `DEFAULT_TOGGLES`, `getFeatureToggles` read logic, `UpdateFeatureTogglesInput`, and `updateFeatureToggles` write logic to include the 5 new email toggle fields
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 5.2 Add user email subscription endpoints to `packages/backend/src/points/handler.ts`
    - Add `GET /api/user/email-subscriptions` route — read `emailSubscriptions` from user record, return `{ newProduct: boolean, newContent: boolean }`
    - Add `PUT /api/user/email-subscriptions` route — validate and update `emailSubscriptions` on user record
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 6. Backend integration — admin handler routes for templates and bulk send
  - [x] 6.1 Add email template CRUD routes to `packages/backend/src/admin/handler.ts`
    - Add `GET /api/admin/email-templates?type={notificationType}` — list templates for a type (all locales), SuperAdmin only
    - Add `PUT /api/admin/email-templates/{type}/{locale}` — update template subject/body, SuperAdmin only, validate input
    - Add regex patterns for template routes
    - Import and wire template functions from `packages/backend/src/email/templates.ts`
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [x] 6.2 Add bulk notification trigger routes to `packages/backend/src/admin/handler.ts`
    - Add `POST /api/admin/email/send-product-notification` — accept product list, query subscribed users with `emailSubscriptions.newProduct === true`, group by locale, call `sendNewProductNotification`
    - Add `POST /api/admin/email/send-content-notification` — accept content list, query subscribed users with `emailSubscriptions.newContent === true`, group by locale, call `sendNewContentNotification`
    - Check email toggle before allowing trigger; return 403 if disabled
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 12.1, 12.2, 12.3, 12.7_

  - [x] 6.3 Add email template seed route to `packages/backend/src/admin/handler.ts`
    - Add `POST /api/admin/email-templates/seed` — SuperAdmin only, call `seedDefaultTemplates`
    - _Requirements: 1.6_

- [x] 7. Backend integration — trigger points in existing handlers
  - [x] 7.1 Add `sendPointsEarnedEmail` trigger to points-related flows
    - In code redemption flow (`packages/backend/src/points/redeem-code.ts` or handler): after successful redemption, call `sendPointsEarnedEmail` with earned points, source, and new balance
    - In claim approval flow (`packages/backend/src/claims/review.ts` or admin handler): after successful approval, call `sendPointsEarnedEmail`
    - In batch distribution flow (`packages/backend/src/admin/batch-points.ts` or admin handler): after successful distribution, call `sendPointsEarnedEmail` for each recipient
    - Wrap all email calls in try/catch — email failure must not fail the parent operation
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 7.2 Add `sendNewOrderEmail` trigger to order creation flow
    - In `packages/backend/src/orders/order.ts` or handler: after successful order creation, call `sendNewOrderEmail` with order details
    - Query all Admin/SuperAdmin/OrderAdmin users as recipients
    - Wrap in try/catch — email failure must not fail order creation
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 7.3 Add `sendOrderShippedEmail` trigger to shipping update flow
    - In `packages/backend/src/orders/admin-order.ts` or handler: after successful shipping status update to "shipped", call `sendOrderShippedEmail`
    - Wrap in try/catch — email failure must not fail shipping update
    - _Requirements: 10.1, 10.3, 10.4_

- [x] 8. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Backend integration tests
  - [x] 9.1 Write integration tests for email trigger points
    - File: `packages/backend/src/email/integration.test.ts`
    - Verify `sendPointsEarnedEmail` called after code redemption, claim approval, batch distribution
    - Verify `sendNewOrderEmail` called after order creation
    - Verify `sendOrderShippedEmail` called after shipping update
    - Verify email toggle check prevents sending when disabled
    - Verify admin template CRUD endpoints return correct responses
    - Verify bulk send trigger endpoints query subscribed users correctly
    - _Requirements: 6.3, 8.1, 8.2, 8.3, 9.1, 10.1_

- [x] 10. Frontend — admin settings email section
  - [x] 10.1 Add email notification toggle section to `packages/frontend/src/pages/admin/settings.tsx`
    - Add "Email Notification" section visible only to SuperAdmin
    - Render 5 toggle switches for `emailPointsEarnedEnabled`, `emailNewOrderEnabled`, `emailOrderShippedEnabled`, `emailNewProductEnabled`, `emailNewContentEnabled`
    - Wire toggles to existing feature toggles update API
    - Add "Edit Template" button per notification type that opens template editor modal
    - _Requirements: 6.2, 6.4, 15.1, 15.5_

  - [x] 10.2 Create template editor modal component
    - Display locale tabs (zh/en/ja/ko/zh-TW) for switching between locale variants
    - Show subject input and body textarea with current template content
    - Display available template variable placeholders as reference panel
    - Save via `PUT /api/admin/email-templates/{type}/{locale}`
    - Validate subject (1–200 chars) and body (1–10000 chars) before submit
    - _Requirements: 3.1, 3.4, 3.5, 15.2, 15.3, 15.4_

- [x] 11. Frontend — user subscription toggles
  - [x] 11.1 Add email subscription section to `packages/frontend/src/pages/settings/index.tsx`
    - Add "Email Subscriptions" section with toggles for `newProduct` and `newContent`
    - Fetch current subscription state from `GET /api/user/email-subscriptions` on page load
    - Persist changes immediately via `PUT /api/user/email-subscriptions`
    - Conditionally hide `newProduct` toggle when `emailNewProductEnabled` admin toggle is disabled
    - Conditionally hide `newContent` toggle when `emailNewContentEnabled` admin toggle is disabled
    - Read admin toggle state from existing feature toggles API
    - _Requirements: 7.3, 7.4, 7.5, 16.1, 16.2, 16.3, 16.4, 16.5_

- [x] 12. Frontend — bulk notification trigger pages
  - [x] 12.1 Create `packages/frontend/src/pages/admin/email-products.tsx` — new product notification trigger
    - Display products created within last 7 days with checkboxes for selection
    - Preview button renders email using current template and selected products
    - Send button triggers `POST /api/admin/email/send-product-notification`
    - Display result summary (successful/failed batch counts) after send
    - Show disabled state with message when `emailNewProductEnabled` toggle is off
    - _Requirements: 11.1, 11.2, 11.7, 11.8, 17.1, 17.3, 17.4, 17.5_

  - [x] 12.2 Create `packages/frontend/src/pages/admin/email-content.tsx` — new content notification trigger
    - Display approved content items created within last 7 days with checkboxes for selection
    - Preview button renders email using current template and selected content
    - Send button triggers `POST /api/admin/email/send-content-notification`
    - Display result summary (successful/failed batch counts) after send
    - Show disabled state with message when `emailNewContentEnabled` toggle is off
    - _Requirements: 12.1, 12.2, 12.7, 12.8, 17.2, 17.3, 17.4, 17.5_

  - [x] 12.3 Add navigation entries for email notification pages in admin dashboard
    - Add "Send Product Notification" and "Send Content Notification" cards/links to admin dashboard
    - Only visible to SuperAdmin and Admin roles
    - _Requirements: 17.1, 17.2_

- [x] 13. i18n translations for email notification UI
  - [x] 13.1 Add email notification translation keys to `TranslationDict` in `packages/frontend/src/i18n/types.ts`
    - Add `email` section under `admin.settings` for toggle labels and template editor labels
    - Add `emailSubscriptions` section under `settings` for user subscription toggle labels
    - Add `emailNotification` section for bulk trigger page labels
    - _Requirements: 19.6_

  - [x] 13.2 Add translations to all 5 locale files
    - Update `packages/frontend/src/i18n/zh.ts` with Chinese translations
    - Update `packages/frontend/src/i18n/en.ts` with English translations
    - Update `packages/frontend/src/i18n/ja.ts` with Japanese translations
    - Update `packages/frontend/src/i18n/ko.ts` with Korean translations
    - Update `packages/frontend/src/i18n/zh-TW.ts` with Traditional Chinese translations
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Email sending is best-effort — failures are logged but never fail parent operations
- All 5 notification types × 5 locales = 25 default templates seeded on first deployment
