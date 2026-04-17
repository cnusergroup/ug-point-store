# i18n Hardcoded String Cleanup — Bugfix Design

## Overview

Multiple frontend pages contain hardcoded Chinese strings that bypass the existing i18n translation system. When users switch to English, Japanese, Korean, or Traditional Chinese, these strings remain in Simplified Chinese. The fix involves replacing each hardcoded string with a `t()` call, adding missing translation keys to `TranslationDict`, and providing translations in all 5 locale files (zh, en, ja, ko, zh-TW).

**Exclusions (intentionally hardcoded):**
- Easter egg / help section in `admin/settings.tsx` — always Chinese
- Language name labels in locale selectors (e.g., '中文', 'English') — always native script
- `LOCALE_TABS` in `admin/settings.tsx` — always native script

## Glossary

- **Bug_Condition (C)**: A hardcoded Chinese string is rendered on a page while the user's locale is not `zh`
- **Property (P)**: All user-visible strings are rendered via `t()` calls, displaying the correct translation for the active locale
- **Preservation**: zh locale renders identically; easter egg content stays hardcoded; locale selector labels stay in native script; existing `t()` calls continue working; TypeScript compiles without errors
- **`t()` function**: The translation lookup function from `useTranslation()` hook, resolves a dot-path key against the active locale's dictionary
- **`TranslationDict`**: TypeScript interface in `types.ts` that defines the shape of all locale files — adding a key here forces all 5 locale files to provide a value
- **Affected files**: `settings/index.tsx`, `admin/index.tsx`, `admin/settings.tsx`, `admin/email-products.tsx`, `admin/email-content.tsx`, `content/upload.tsx`

## Bug Details

### Bug Condition

The bug manifests when a user's locale is set to any non-zh language and they navigate to one of the 6 affected pages. Hardcoded Chinese strings are rendered directly in JSX instead of going through the `t()` translation function.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { locale: Locale, page: Page, stringId: StringId }
  OUTPUT: boolean

  RETURN input.locale ≠ 'zh'
    AND input.stringId ∈ HARDCODED_STRINGS
    AND input.page ∈ AFFECTED_PAGES
END FUNCTION
```

Where:
- `HARDCODED_STRINGS` = ~120 Chinese strings across 6 files that use literal text instead of `t()` calls
- `AFFECTED_PAGES` = { settings/index, admin/index, admin/settings, admin/email-products, admin/email-content, content/upload }

### Examples

- **settings/index.tsx**: User sets locale to English, sees "邮件订阅" instead of "Email Subscriptions" for the section header
- **admin/index.tsx**: User sets locale to Japanese, sees "商品管理" instead of "商品管理" (Japanese equivalent) in the sidebar category nav
- **admin/settings.tsx**: User sets locale to Korean, sees "功能开关" in the sidebar and "积分到账通知" in email notification toggles instead of Korean translations
- **admin/email-products.tsx**: User sets locale to Traditional Chinese, sees "新商品邮件通知" page title and "发送通知" button in Simplified Chinese
- **admin/email-content.tsx**: Same pattern as email-products — all UI strings hardcoded in Simplified Chinese
- **content/upload.tsx**: User sets locale to English, sees "标签" instead of "Tags" for the tag field label

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- zh locale users see all strings in Simplified Chinese exactly as today
- Easter egg section in `admin/settings.tsx` (`activeCategory === 'help'`) remains hardcoded Chinese in all locales
- Language name labels in `LOCALE_OPTIONS` (settings/index.tsx) and `LOCALE_TABS` (admin/settings.tsx) remain in native script
- All existing `t()` calls across the entire app continue to work correctly
- TypeScript build compiles without errors after adding new keys to `TranslationDict` and all 5 locale files

**Scope:**
All inputs that do NOT involve the ~120 hardcoded Chinese strings on the 6 affected pages should be completely unaffected by this fix. This includes:
- All other pages that already use `t()` correctly
- Backend API responses
- Database content
- User-generated content

## Hypothesized Root Cause

Based on the bug description, the root cause is straightforward:

1. **Incremental i18n adoption**: The i18n system was added to the project incrementally. These 6 files were either created before i18n was fully adopted, or were added later without following the i18n pattern.

2. **Missing translation keys**: Some strings (especially in `admin/settings.tsx` and the email notification pages) were never added to `TranslationDict` or the locale files. The `emailNotification` section in types.ts already has keys for email-products and email-content pages, but the pages don't use them.

3. **Existing keys not wired up**: For `admin/email-products.tsx` and `admin/email-content.tsx`, the `emailNotification.*` keys already exist in all locale files but the pages don't import `useTranslation` or call `t()`.

4. **admin/settings.tsx uses mixed approach**: Some strings use `t()` (e.g., toggle labels for feature settings) while others are hardcoded (e.g., `SETTINGS_CATEGORIES` labels, `NOTIFICATION_TYPE_LABELS`, category titles, CollapsibleSection titles, and the entire `EmailTemplateEditorModal`).

## Correctness Properties

Property 1: Bug Condition - Hardcoded strings replaced with t() calls

_For any_ page in the set of affected pages and _for any_ locale, all user-visible strings (except excluded easter egg and locale selector labels) SHALL be rendered via `t()` calls, displaying the correct translation for the active locale.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Existing behavior unchanged

_For any_ input where the bug condition does NOT hold (zh locale, easter egg content, locale selector labels, or pages not in the affected set), the fixed code SHALL produce the same rendered output as the original code, preserving all existing functionality and visual appearance.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**Strategy**: For each hardcoded Chinese string, replace it with a `t('key.path')` call. Add the corresponding key to `TranslationDict` (if not already present), and provide translations in all 5 locale files. Where `emailNotification.*` keys already exist in types.ts and locale files, reuse them.

**File 1**: `packages/frontend/src/pages/settings/index.tsx` (5 strings)

Replace hardcoded email subscription strings with existing `t('settings.emailSubscriptions.*')` keys:
- `邮件订阅` → `t('settings.emailSubscriptions.sectionTitle')`
- `新商品通知` → `t('settings.emailSubscriptions.newProductLabel')`
- `商城上新时收到邮件提醒` → `t('settings.emailSubscriptions.newProductDesc')`
- `新内容通知` → `t('settings.emailSubscriptions.newContentLabel')`
- `有新内容发布时收到邮件提醒` → `t('settings.emailSubscriptions.newContentDesc')`

**File 2**: `packages/frontend/src/pages/admin/index.tsx` (6 strings)

Replace `DASHBOARD_CATEGORIES` hardcoded labels with `t()` calls using new keys under `admin.dashboard.category*`:
- `商品管理` → `t('admin.dashboard.categoryProducts')`
- `订单管理` → `t('admin.dashboard.categoryOrders')`
- `用户管理` → `t('admin.dashboard.categoryUsers')`
- `内容管理` → `t('admin.dashboard.categoryContent')`
- `运营工具` → `t('admin.dashboard.categoryOperations')`
- `系统设置` → `t('admin.dashboard.categorySystem')`

This requires refactoring `DASHBOARD_CATEGORIES` from a static const to a function/hook that has access to `t()`.

**File 3**: `packages/frontend/src/pages/admin/settings.tsx` (~70 strings)

Three categories of changes:
1. **SETTINGS_CATEGORIES sidebar labels** (8 strings): Refactor from static const to use `t()` via new keys `admin.settings.category*`. Note: "寻求帮助" label is part of the sidebar nav (not the easter egg content itself), so it should be translated.
2. **NOTIFICATION_TYPE_LABELS** (5 strings): Replace with `t()` calls using `admin.settings.email.*Label` keys
3. **Category titles and CollapsibleSection titles/descriptions** (~20 strings): Replace inline Chinese with `t()` calls
4. **EmailTemplateEditorModal** (~15 strings): Add `useTranslation` and replace all hardcoded strings (加载模板失败, 模板编辑, 加载中, 主题, 正文, 可用变量, 取消, 保存, placeholders, validation errors, toast messages)
5. **Email notification section inline labels/descriptions** (~10 strings): Replace hardcoded labels in the email toggle config array
6. **Seed template section** (~4 strings): Replace 默认模板已初始化, 初始化失败, button text, hint text

**File 4**: `packages/frontend/src/pages/admin/email-products.tsx` (~22 strings)

Add `useTranslation` import and replace all hardcoded strings with `t('emailNotification.*')` calls. Most keys already exist in the `emailNotification` section of locale files. Strings include:
- Page title, back button, loading text
- Send result labels (发送结果, 订阅用户数, 总批次, 成功批次, 失败批次)
- Action buttons (全选, 取消全选, 预览, 发送通知, 发送中)
- Product status labels (上架, 下架, 积分)
- Count text, preview modal UI, disabled/empty state text, toast messages

**File 5**: `packages/frontend/src/pages/admin/email-content.tsx` (~18 strings)

Same pattern as email-products. Add `useTranslation` and replace hardcoded strings with `t('emailNotification.*')` calls:
- Page title, back button, loading text
- Send result labels, action buttons, status labels
- Count text, preview modal UI, disabled/empty state text, toast messages

**File 6**: `packages/frontend/src/pages/content/upload.tsx` (1 string)

Replace `标签` with `t('contentHub.upload.tagsLabel')` — requires adding `tagsLabel` key to `contentHub.upload` in types.ts and all locale files.

**File 7**: `packages/frontend/src/i18n/types.ts`

Add new keys:
- `admin.dashboard.category*` (6 keys for dashboard categories)
- `admin.settings.category*` (8 keys for settings sidebar)
- `admin.settings.templateEditor*` (~15 keys for template editor modal)
- `admin.settings.emailNotification*` (~10 keys for inline email toggle labels)
- `admin.settings.seedTemplate*` (~4 keys for seed template section)
- `admin.settings.contentRoles*` (~4 keys for content roles section titles)
- `contentHub.upload.tagsLabel` (1 key)

**Files 8-12**: All 5 locale files (`zh.ts`, `en.ts`, `ja.ts`, `ko.ts`, `zh-TW.ts`)

Add translations for all new keys. zh.ts values match the current hardcoded Chinese strings exactly (preservation). Other locales get appropriate translations.

## Testing Strategy

### Validation Approach

This is a pure i18n text replacement task — no logic changes, no state changes, no API changes. The validation approach focuses on:
1. TypeScript compilation (type safety ensures all keys exist in all locales)
2. Manual visual verification across locales

### Exploratory Bug Condition Checking

**Goal**: Confirm the bug exists by navigating to each affected page with a non-zh locale.

**Test Cases**:
1. Set locale to English, navigate to settings page — email subscription section shows Chinese
2. Set locale to English, navigate to admin dashboard — sidebar categories show Chinese
3. Set locale to English, navigate to admin settings — sidebar, category titles, email toggles show Chinese
4. Set locale to English, navigate to email-products page — all UI strings show Chinese
5. Set locale to English, navigate to email-content page — all UI strings show Chinese
6. Set locale to English, navigate to content upload — "标签" label shows Chinese

### Fix Checking

**Goal**: Verify that after the fix, all affected strings display in the correct locale.

```
FOR ALL input WHERE isBugCondition(input) DO
  result := renderPage'(input.page, input.locale)
  translatedString := t(input.stringId, input.locale)
  ASSERT result CONTAINS translatedString
  ASSERT result DOES NOT CONTAIN hardcodedChinese(input.stringId)
END FOR
```

### Preservation Checking

**Goal**: Verify that zh locale and excluded strings remain unchanged.

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT renderPage(input.page, input.locale) = renderPage'(input.page, input.locale)
END FOR
```

### Unit Tests

- TypeScript compilation check (`tsc --noEmit`) — ensures all new keys exist in all locale files
- Verify `TranslationDict` type is satisfied by all 5 locale exports

### Property-Based Tests

Not applicable for this pure i18n text replacement work. The TypeScript type system provides the structural guarantee that all keys exist in all locales.

### Integration Tests

- Manual: Switch locale to each of the 5 languages and navigate through all 6 affected pages
- Verify easter egg section remains in Chinese regardless of locale
- Verify locale selector labels remain in native script
