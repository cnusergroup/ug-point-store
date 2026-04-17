# i18n Hardcoded String Cleanup — Tasks

## Task 1: Replace hardcoded strings in settings/index.tsx (5 strings)

- [x] 1.1 Replace `邮件订阅` with `t('settings.emailSubscriptions.sectionTitle')`
- [x] 1.2 Replace `新商品通知` with `t('settings.emailSubscriptions.newProductLabel')`
- [x] 1.3 Replace `商城上新时收到邮件提醒` with `t('settings.emailSubscriptions.newProductDesc')`
- [x] 1.4 Replace `新内容通知` with `t('settings.emailSubscriptions.newContentLabel')`
- [x] 1.5 Replace `有新内容发布时收到邮件提醒` with `t('settings.emailSubscriptions.newContentDesc')`

## Task 2: Replace hardcoded strings in admin/index.tsx (6 strings)

- [x] 2.1 Refactor `DASHBOARD_CATEGORIES` from static const to a function that accepts `t` (or use `t()` inline in the component), so labels can be translated
- [x] 2.2 Replace 6 hardcoded category labels (商品管理, 订单管理, 用户管理, 内容管理, 运营工具, 系统设置) with `t('admin.dashboard.category*')` calls

## Task 3: Replace hardcoded strings in admin/settings.tsx (~70 strings)

- [x] 3.1 Refactor `SETTINGS_CATEGORIES` from static const to use `t()` calls for all 8 sidebar labels (功能开关, 管理员权限, 内容角色权限, 邮件通知, 差旅赞助, 邀请设置, 超级管理员, 寻求帮助)
- [x] 3.2 Refactor `NOTIFICATION_TYPE_LABELS` from static const to use `t()` calls for all 5 notification type labels (积分到账通知, 新订单通知, 订单发货通知, 新商品通知, 新内容通知)
- [x] 3.3 Replace all category title strings (功能开关, 管理员权限, 内容角色权限, 邮件通知, 差旅赞助, 邀请设置, 超级管理员) in `settings-content__category-title` elements with `t()` calls
- [x] 3.4 Replace all CollapsibleSection title and description strings with `t()` calls (功能开关/控制系统功能的启用与关闭, 管理员权限/控制 Admin 角色可访问的管理功能, 角色权限矩阵/配置不同角色的内容操作权限, 通知开关/控制各类邮件通知的启用与关闭, 模板管理/初始化和管理邮件模板, 差旅赞助设置/配置差旅赞助功能和阈值, 邀请有效期/设置邀请链接的有效天数, 权限转移/将超级管理员权限转移给其他管理员)
- [x] 3.5 Replace hardcoded email notification toggle labels and descriptions in the inline array (积分到账通知, 新订单通知, 订单发货通知, 新商品通知, 新内容通知 and their descriptions) with `t()` calls using existing `admin.settings.email.*` keys
- [x] 3.6 Replace `编辑模板` button text with `t('admin.settings.email.editTemplateButton')`
- [x] 3.7 Replace seed template section strings (初始化默认模板, hint text, 默认模板已初始化, 初始化失败) with `t()` calls
- [x] 3.8 Replace all hardcoded strings in `EmailTemplateEditorModal` component: modal title pattern (`— 模板编辑`), loading text (加载中...), field labels (主题, 正文 (HTML)), placeholders (输入邮件主题..., 输入邮件正文 HTML...), 可用变量 title, footer buttons (取消, 保存, 保存中...), validation errors (主题长度需在 1–200 字符之间, 正文长度需在 1–10000 字符之间), toast messages (加载模板失败, 保存成功, 保存失败)
- [x] 3.9 Verify easter egg section (`activeCategory === 'help'`) is NOT modified — all Chinese strings in that block remain hardcoded
- [x] 3.10 Verify `LOCALE_TABS` labels (中文, English, 日本語, 한국어, 繁體中文) are NOT modified — they remain in native script

## Task 4: Replace hardcoded strings in admin/email-products.tsx (~22 strings)

- [x] 4.1 Add `import { useTranslation } from '../../i18n'` and `const { t } = useTranslation()` to the component
- [x] 4.2 Replace toolbar strings: `← 返回` → `t('emailNotification.backButton')`, `新商品邮件通知` → `t('emailNotification.productPageTitle')`
- [x] 4.3 Replace loading text `加载中...` → `t('emailNotification.loading')`
- [x] 4.4 Replace disabled state text with `t('emailNotification.disabledProductMessage')`
- [x] 4.5 Replace send result labels: 发送结果, 订阅用户数, 总批次, 成功批次, 失败批次, 关闭 → corresponding `t('emailNotification.result*')` calls
- [x] 4.6 Replace action bar strings: 全选/取消全选, 预览, 发送通知/发送中 → `t('emailNotification.selectAll')` / `t('emailNotification.deselectAll')` / `t('emailNotification.preview')` / `t('emailNotification.send')` / `t('emailNotification.sending')`
- [x] 4.7 Replace product count text pattern `最近 7 天新增商品（N 件）` → `t('emailNotification.recentProducts')` with interpolation
- [x] 4.8 Replace product status labels (上架/下架, 积分) and empty state text → appropriate `t()` calls
- [x] 4.9 Replace preview modal strings: 邮件预览, 主题 → `t('emailNotification.previewTitle')`, `t('emailNotification.previewSubject')`
- [x] 4.10 Replace toast messages: 未找到模板, 加载模板失败, 发送失败 → `t('emailNotification.noTemplate')`, `t('emailNotification.templateLoadFailed')`, `t('emailNotification.sendFailed')`

## Task 5: Replace hardcoded strings in admin/email-content.tsx (~18 strings)

- [x] 5.1 Add `import { useTranslation } from '../../i18n'` and `const { t } = useTranslation()` to the component
- [x] 5.2 Replace toolbar strings: `← 返回` → `t('emailNotification.backButton')`, `新内容邮件通知` → `t('emailNotification.contentPageTitle')`
- [x] 5.3 Replace loading text `加载中...` → `t('emailNotification.loading')`
- [x] 5.4 Replace disabled state text with `t('emailNotification.disabledContentMessage')`
- [x] 5.5 Replace send result labels: 发送结果, 订阅用户数, 总批次, 成功批次, 失败批次, 关闭 → corresponding `t('emailNotification.result*')` calls
- [x] 5.6 Replace action bar strings: 全选/取消全选, 预览, 发送通知/发送中 → corresponding `t('emailNotification.*')` calls
- [x] 5.7 Replace content count text pattern `最近 7 天已审核内容（N 篇）` → `t('emailNotification.recentContent')` with interpolation
- [x] 5.8 Replace content status label (已审核) and empty state text → appropriate `t()` calls
- [x] 5.9 Replace preview modal strings and toast messages → corresponding `t('emailNotification.*')` calls

## Task 6: Replace hardcoded string in content/upload.tsx (1 string)

- [x] 6.1 Replace `标签` with `t('contentHub.upload.tagsLabel')`

## Task 7: Add new translation keys to types.ts

- [x] 7.1 Add `admin.dashboard.category*` keys (6 keys: categoryProducts, categoryOrders, categoryUsers, categoryContent, categoryOperations, categorySystem)
- [x] 7.2 Add `admin.settings.category*` keys (8 keys for settings sidebar labels)
- [x] 7.3 Add `admin.settings.templateEditor*` keys (~15 keys for EmailTemplateEditorModal strings)
- [x] 7.4 Add `admin.settings.seedTemplate*` keys (4 keys for seed template section)
- [x] 7.5 Add `admin.settings.sectionTitle*` and `admin.settings.sectionDesc*` keys for CollapsibleSection titles and descriptions
- [x] 7.6 Add `contentHub.upload.tagsLabel` key
- [x] 7.7 Add any additional `emailNotification.*` keys needed for product status labels, count text interpolation, and content status labels (if not already present)

## Task 8: Add translations to all 5 locale files

- [x] 8.1 Add all new keys to `zh.ts` — values match current hardcoded Chinese strings exactly
- [x] 8.2 Add all new keys to `en.ts` — English translations
- [x] 8.3 Add all new keys to `ja.ts` — Japanese translations
- [x] 8.4 Add all new keys to `ko.ts` — Korean translations
- [x] 8.5 Add all new keys to `zh-TW.ts` — Traditional Chinese translations

## Task 9: Build verification

- [x] 9.1 Run `tsc --noEmit` (or project build command) to verify TypeScript compiles without errors — confirms all new keys exist in TranslationDict and all 5 locale files satisfy the type contract
