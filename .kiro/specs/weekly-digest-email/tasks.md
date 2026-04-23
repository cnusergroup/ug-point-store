# Tasks

## Task 1: Extend email type system and feature toggles

- [x] 1.1 Add `'weeklyDigest'` to `NotificationType` union in `packages/backend/src/email/send.ts`
- [x] 1.2 Add `weeklyDigest` entry to `TEMPLATE_VARIABLE_MAP` in `packages/backend/src/email/templates.ts` with variables `['nickname', 'productList', 'contentList', 'weekStart', 'weekEnd']`
- [x] 1.3 Add `weeklyDigest: 'emailWeeklyDigestEnabled'` to `TOGGLE_MAP` in `packages/backend/src/email/notifications.ts`
- [x] 1.4 Add `emailWeeklyDigestEnabled: boolean` to `FeatureToggles` interface in `packages/backend/src/settings/feature-toggles.ts` (default `false`)
- [x] 1.5 Add `emailWeeklyDigestEnabled` to `UpdateFeatureTogglesInput`, `DEFAULT_TOGGLES`, `getFeatureToggles()`, and `updateFeatureToggles()` in `packages/backend/src/settings/feature-toggles.ts`
- [x] 1.6 Add `'weeklyDigest'` to `VALID_NOTIFICATION_TYPES` array in `packages/backend/src/admin/handler.ts`

## Task 2: Seed default weeklyDigest templates for all 5 locales

- [x] 2.1 Add `weeklyDigestTemplates` record with zh/en/ja/ko/zh-TW variants in `packages/backend/src/email/seed.ts`
- [x] 2.2 Add `'weeklyDigest'` to `ALL_TYPES` array in `packages/backend/src/email/seed.ts`
- [x] 2.3 Verify `getDefaultTemplates()` returns 35 templates (7 types × 5 locales)

## Task 3: Implement digest query module

- [x] 3.1 Create `packages/backend/src/digest/query.ts` with `filterByDateRange`, `sortByCreatedAtDesc`, `identifySubscribers`, `groupByLocale` pure functions
- [x] 3.2 Implement `queryNewProducts` — scan Products table, filter by createdAt >= since, sort descending
- [x] 3.3 Implement `queryNewContent` — scan ContentItems table, filter by createdAt >= since AND status = approved, sort descending
- [x] 3.4 Implement `querySubscribers` — scan Users table, filter for valid email + at least one subscription enabled
- [x] 3.5 Write property tests in `packages/backend/src/digest/query.property.test.ts` for Properties 1–5

## Task 4: Implement digest compose module

- [x] 4.1 Create `packages/backend/src/digest/compose.ts` with `getDigestVariant`, `formatProductList`, `formatContentList`, `composeDigestEmail`, `shouldSkipDigest` functions
- [x] 4.2 Implement locale-aware fallback messages for empty product/content lists (all 5 locales)
- [x] 4.3 Write property tests in `packages/backend/src/digest/compose.property.test.ts` for Properties 6–8

## Task 5: Implement digest handler (Lambda entry point)

- [x] 5.1 Create `packages/backend/src/digest/handler.ts` — orchestrate toggle check, query, compose, and send flow
- [x] 5.2 Implement toggle check: read `emailWeeklyDigestEnabled`, skip if false
- [x] 5.3 Implement empty digest skip: if both product and content lists are empty, log and return
- [x] 5.4 Implement per-locale, per-variant email sending using `sendBulkEmail` with BCC batching
- [x] 5.5 Implement execution summary logging (subscribers, sent, failed, product count, content count)
- [x] 5.6 Write unit tests in `packages/backend/src/digest/handler.test.ts` with mocked DynamoDB and SES
- [x] 5.7 Write property tests in `packages/backend/src/digest/handler.property.test.ts` for Properties 9–11

## Task 6: CDK infrastructure — Digest Lambda + EventBridge Rule

- [x] 6.1 Add Digest Lambda (`PointsMall-Digest`) as NodejsFunction in `packages/cdk/lib/api-stack.ts` with entry `packages/backend/src/digest/handler.ts`, timeout 120s, memory 512MB
- [x] 6.2 Add EventBridge Rule (`PointsMall-DigestSchedule`) with `cron(0 0 ? * SUN *)` targeting Digest Lambda
- [x] 6.3 Grant Digest Lambda read access to Products, ContentItems, Users, and EmailTemplates tables
- [x] 6.4 Grant Digest Lambda SES permissions (`ses:SendEmail`, `ses:SendRawEmail`) scoped to sender identity
- [x] 6.5 Pass environment variables to Digest Lambda: PRODUCTS_TABLE, CONTENT_ITEMS_TABLE, USERS_TABLE, EMAIL_TEMPLATES_TABLE, SENDER_EMAIL

## Task 7: Frontend — toggle and template editor support

- [x] 7.1 Add `emailWeeklyDigestEnabled` to `FeatureToggles` interface and default state in `packages/frontend/src/pages/admin/settings.tsx`
- [x] 7.2 Add `'weeklyDigest'` to `NotificationType` type and `NOTIFICATION_TYPE_LABELS` map in settings page
- [x] 7.3 Add toggle row for weekly digest in the email notifications section of settings page
- [x] 7.4 Include `emailWeeklyDigestEnabled` in the settings save/load payload

## Task 8: Frontend i18n — add translations for all 5 locales

- [x] 8.1 Add `weeklyDigestLabel` and `weeklyDigestDesc` keys to `admin.settings.email` section in `packages/frontend/src/i18n/types.ts`
- [x] 8.2 Add Chinese translations in `packages/frontend/src/i18n/zh.ts`
- [x] 8.3 Add English translations in `packages/frontend/src/i18n/en.ts`
- [x] 8.4 Add Japanese translations in `packages/frontend/src/i18n/ja.ts`
- [x] 8.5 Add Korean translations in `packages/frontend/src/i18n/ko.ts`
- [x] 8.6 Add Traditional Chinese translations in `packages/frontend/src/i18n/zh-TW.ts`
