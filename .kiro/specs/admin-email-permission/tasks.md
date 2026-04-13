# Tasks

## Task 1: Feature Toggles 数据层扩展

- [x] 1.1 在 `packages/backend/src/settings/feature-toggles.ts` 的 `FeatureToggles` 接口中添加 `adminEmailProductsEnabled: boolean` 和 `adminEmailContentEnabled: boolean` 字段
- [x] 1.2 在 `UpdateFeatureTogglesInput` 接口中添加对应的两个字段
- [x] 1.3 在 `DEFAULT_TOGGLES` 常量中添加两个字段，默认值为 `false`
- [x] 1.4 在 `getFeatureToggles` 函数中添加对新字段的读取逻辑（使用 `=== true` 判断，缺失时默认 false）
- [x] 1.5 在 `updateFeatureToggles` 函数的 boolean 类型验证中添加对新字段的检查
- [x] 1.6 在 `updateFeatureToggles` 函数的 `UpdateCommand` 的 `UpdateExpression` 和 `ExpressionAttributeValues` 中添加新字段
- [x] 1.7 在 `updateFeatureToggles` 函数的返回值中包含新字段

## Task 2: 后端 Admin Handler 权限检查

- [x] 2.1 在 `handleSendProductNotification` 中添加 Admin 权限检查：SuperAdmin 直接放行，Admin 检查 `adminEmailProductsEnabled` toggle，为 false 时返回 403
- [x] 2.2 在 `handleSendContentNotification` 中添加 Admin 权限检查：SuperAdmin 直接放行，Admin 检查 `adminEmailContentEnabled` toggle，为 false 时返回 403

## Task 3: 前端 Admin Dashboard 卡片可见性

- [x] 3.1 在 `packages/frontend/src/pages/admin/index.tsx` 的 `ADMIN_LINKS` 中为 `email-products` 卡片添加 `adminPermissionKey: 'adminEmailProductsEnabled'`
- [x] 3.2 在 `ADMIN_LINKS` 中为 `email-content` 卡片添加 `adminPermissionKey: 'adminEmailContentEnabled'`
- [x] 3.3 更新 `featureToggles` 状态类型和 fetch 请求，包含 `adminEmailProductsEnabled` 和 `adminEmailContentEnabled` 字段

## Task 4: 前端 Settings 页面开关

- [x] 4.1 在 `packages/frontend/src/pages/admin/settings.tsx` 的 `FeatureToggles` 接口中添加 `adminEmailProductsEnabled` 和 `adminEmailContentEnabled` 字段
- [x] 4.2 在 settings 默认状态中添加新字段（默认 false）
- [x] 4.3 在 Admin 权限开关区域添加两个新的 toggle 开关 UI（使用 i18n key）
- [x] 4.4 在 `handleToggle` 的 PUT 请求 data 中包含新字段

## Task 5: 国际化

- [x] 5.1 在 `packages/frontend/src/i18n/types.ts` 的 `admin.settings` 中添加 `adminEmailProductsLabel`、`adminEmailProductsDesc`、`adminEmailContentLabel`、`adminEmailContentDesc` 四个 key
- [x] 5.2 在 `packages/frontend/src/i18n/zh.ts` 中添加中文翻译
- [x] 5.3 在 `packages/frontend/src/i18n/en.ts` 中添加英文翻译
- [x] 5.4 在 `packages/frontend/src/i18n/ja.ts` 中添加日文翻译
- [x] 5.5 在 `packages/frontend/src/i18n/ko.ts` 中添加韩文翻译
- [x] 5.6 在 `packages/frontend/src/i18n/zh-TW.ts` 中添加繁体中文翻译

## Task 6: Property-Based Tests

- [x] 6.1 创建 `packages/backend/src/settings/feature-toggles-email-permission.property.test.ts`，实现 Property 1（round-trip）和 Property 2（validation rejection）
- [x] 6.2 创建 `packages/backend/src/admin/email-permission.property.test.ts`，实现 Property 3（API permission matrix）
- [x] 6.3 创建 `packages/frontend/src/pages/admin/email-permission-visibility.property.test.ts`，实现 Property 4（dashboard card visibility matrix）
