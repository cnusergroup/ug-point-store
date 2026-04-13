# Requirements Document

## Introduction

本功能为积分商城管理后台的邮件通知触发页面（新商品邮件通知、新内容邮件通知）添加 SuperAdmin 可控的 Admin 权限开关。当前这两个邮件触发页面对所有 Admin 和 SuperAdmin 均可见且可操作，缺乏细粒度的权限控制。本功能复用已有的 `adminPermissionKey` 模式（与 `adminProductsEnabled`、`adminOrdersEnabled`、`adminContentReviewEnabled`、`adminCategoriesEnabled` 一致），新增两个开关：

- `adminEmailProductsEnabled` — 控制 Admin 是否可以触发新商品邮件通知（默认：false）
- `adminEmailContentEnabled` — 控制 Admin 是否可以触发新内容邮件通知（默认：false）

SuperAdmin 始终拥有访问权限，不受开关状态影响。开关存储在 DynamoDB 的 `feature-toggles` 记录中，通过管理后台设置页面管理。

## Glossary

- **SuperAdmin**: 持有 `SuperAdmin` 角色的唯一用户，拥有系统最高权限，不受任何 Admin 权限开关限制。
- **Admin**: 持有 `Admin` 角色的用户，可执行大部分管理操作，但受 SuperAdmin 配置的权限开关约束。
- **Feature_Toggles_Record**: DynamoDB Users 表中 `userId = 'feature-toggles'` 的记录，存储所有功能开关和 Admin 权限开关。
- **Settings_Page**: 前端管理后台设置页面（`/pages/admin/settings`），SuperAdmin 在此管理系统配置。
- **Admin_Dashboard**: 前端管理后台首页（`/pages/admin/index`），展示所有管理功能入口卡片。
- **Email_Products_Page**: 新商品邮件通知触发页面（`/pages/admin/email-products`）。
- **Email_Content_Page**: 新内容邮件通知触发页面（`/pages/admin/email-content`）。
- **Send_Product_Notification_API**: 后端 API 端点（`POST /api/admin/email/send-product-notification`），触发新商品邮件批量发送。
- **Send_Content_Notification_API**: 后端 API 端点（`POST /api/admin/email/send-content-notification`），触发新内容邮件批量发送。

## Requirements

### Requirement 1: Feature Toggles 数据层扩展

**User Story:** As a SuperAdmin, I want two new permission toggles stored in the feature-toggles record, so that I can control whether Admin users can access email notification trigger pages.

#### Acceptance Criteria

1. THE Feature_Toggles_Record SHALL include an `adminEmailProductsEnabled` field of type boolean.
2. THE Feature_Toggles_Record SHALL include an `adminEmailContentEnabled` field of type boolean.
3. WHEN the Feature_Toggles_Record does not contain `adminEmailProductsEnabled`, THE system SHALL default the value to false.
4. WHEN the Feature_Toggles_Record does not contain `adminEmailContentEnabled`, THE system SHALL default the value to false.
5. WHEN the `updateFeatureToggles` function is called, THE function SHALL validate that `adminEmailProductsEnabled` and `adminEmailContentEnabled` are boolean values.
6. WHEN the `updateFeatureToggles` function is called with valid input, THE function SHALL persist `adminEmailProductsEnabled` and `adminEmailContentEnabled` to the Feature_Toggles_Record.

### Requirement 2: 后端 API 权限检查

**User Story:** As a SuperAdmin, I want the email notification APIs to enforce the new permission toggles, so that Admin users cannot trigger email notifications when the toggle is off.

#### Acceptance Criteria

1. WHEN an Admin user calls the Send_Product_Notification_API and `adminEmailProductsEnabled` is false, THE Send_Product_Notification_API SHALL return a 403 Forbidden response.
2. WHEN an Admin user calls the Send_Content_Notification_API and `adminEmailContentEnabled` is false, THE Send_Content_Notification_API SHALL return a 403 Forbidden response.
3. WHEN a SuperAdmin user calls the Send_Product_Notification_API, THE Send_Product_Notification_API SHALL proceed regardless of the `adminEmailProductsEnabled` toggle value.
4. WHEN a SuperAdmin user calls the Send_Content_Notification_API, THE Send_Content_Notification_API SHALL proceed regardless of the `adminEmailContentEnabled` toggle value.
5. WHEN an Admin user calls the Send_Product_Notification_API and `adminEmailProductsEnabled` is true, THE Send_Product_Notification_API SHALL proceed with the notification send.
6. WHEN an Admin user calls the Send_Content_Notification_API and `adminEmailContentEnabled` is true, THE Send_Content_Notification_API SHALL proceed with the notification send.

### Requirement 3: 管理后台首页导航卡片可见性

**User Story:** As an Admin user, I want the email notification cards on the admin dashboard to be hidden when I don't have permission, so that I only see features I can access.

#### Acceptance Criteria

1. WHILE an Admin user views the Admin_Dashboard and `adminEmailProductsEnabled` is false, THE Admin_Dashboard SHALL hide the Email_Products_Page navigation card from that user.
2. WHILE an Admin user views the Admin_Dashboard and `adminEmailContentEnabled` is false, THE Admin_Dashboard SHALL hide the Email_Content_Page navigation card from that user.
3. WHILE a SuperAdmin user views the Admin_Dashboard, THE Admin_Dashboard SHALL display both email notification navigation cards regardless of toggle values.
4. WHEN the feature toggles API returns the toggle values, THE Admin_Dashboard SHALL include `adminEmailProductsEnabled` and `adminEmailContentEnabled` in the fetched toggle state.

### Requirement 4: SuperAdmin 设置页面开关管理

**User Story:** As a SuperAdmin, I want toggle switches on the settings page for the two new email permission toggles, so that I can enable or disable Admin access to email notification pages.

#### Acceptance Criteria

1. WHEN a SuperAdmin opens the Settings_Page, THE Settings_Page SHALL display an `adminEmailProductsEnabled` toggle switch in the Admin permission section.
2. WHEN a SuperAdmin opens the Settings_Page, THE Settings_Page SHALL display an `adminEmailContentEnabled` toggle switch in the Admin permission section.
3. WHEN the SuperAdmin toggles `adminEmailProductsEnabled`, THE Settings_Page SHALL immediately save the new value to the backend and display a success confirmation.
4. WHEN the SuperAdmin toggles `adminEmailContentEnabled`, THE Settings_Page SHALL immediately save the new value to the backend and display a success confirmation.
5. IF the save request fails, THEN THE Settings_Page SHALL revert the toggle to its previous value and display an error message.
6. WHILE a user does not hold the SuperAdmin role, THE Settings_Page SHALL hide the Admin permission toggle section (including the new email toggles) from that user.

### Requirement 5: Feature Toggles 公开 API 响应扩展

**User Story:** As a frontend client, I want the public feature-toggles API to return the new email permission toggle values, so that the dashboard can determine card visibility.

#### Acceptance Criteria

1. WHEN the public feature-toggles API (`GET /api/settings/feature-toggles`) is called, THE API SHALL include `adminEmailProductsEnabled` in the response.
2. WHEN the public feature-toggles API is called, THE API SHALL include `adminEmailContentEnabled` in the response.

### Requirement 6: 国际化

**User Story:** As a user of any supported language, I want all new UI text for the email permission toggles to be translated, so that the interface is consistent in my language.

#### Acceptance Criteria

1. THE Settings_Page SHALL provide i18n keys for the `adminEmailProductsEnabled` toggle label and description in all supported languages (zh, zh-TW, en, ja, ko).
2. THE Settings_Page SHALL provide i18n keys for the `adminEmailContentEnabled` toggle label and description in all supported languages (zh, zh-TW, en, ja, ko).
