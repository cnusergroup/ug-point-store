# Bugfix Requirements Document

## Introduction

Multiple frontend pages contain hardcoded Chinese strings that bypass the i18n translation system. When users switch the application locale to English, Japanese, Korean, or Traditional Chinese, these strings remain displayed in Simplified Chinese instead of being translated. The i18n infrastructure (`useTranslation` hook, `t()` function, locale files for zh/en/ja/ko/zh-TW, and `TranslationDict` type) is already in place and used extensively throughout the app — these strings were simply missed during internationalization.

The fix requires replacing each hardcoded Chinese string with the corresponding `t()` call, adding the necessary translation keys to the `TranslationDict` type, and providing translations in all 5 locale files.

**Exclusions:**
- The easter egg section in `admin/settings.tsx` (the "寻求帮助" help page content) is intentionally hardcoded in Chinese and should NOT be changed.
- Language name labels in locale selectors (e.g., '中文', 'English', '日本語') are intentionally displayed in their native language and should NOT be changed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user sets the locale to any non-zh language (en, ja, ko, zh-TW) AND navigates to the user settings page (`settings/index.tsx`), THEN the email subscription section header "邮件订阅", toggle labels "新商品通知" / "新内容通知", and toggle descriptions "商城上新时收到邮件提醒" / "有新内容发布时收到邮件提醒" remain displayed in Simplified Chinese.

1.2 WHEN the user sets the locale to any non-zh language AND navigates to the admin settings page (`admin/settings.tsx`), THEN the SETTINGS_CATEGORIES sidebar labels (功能开关, 管理员权限, 内容角色权限, 邮件通知, 差旅赞助, 邀请设置, 超级管理员), NOTIFICATION_TYPE_LABELS (积分到账通知, 新订单通知, 订单发货通知, 新商品通知, 新内容通知), category titles, CollapsibleSection titles/descriptions, and all template editor UI strings (模板编辑, 加载中, 主题, 正文, 可用变量, 取消, 保存, placeholders, validation errors, toast messages) remain displayed in Simplified Chinese.

1.3 WHEN the user sets the locale to any non-zh language AND navigates to the product email notification page (`admin/email-products.tsx`), THEN the page title "新商品邮件通知", back button "← 返回", loading text "加载中...", send result labels (发送结果, 订阅用户数, 总批次, 成功批次, 失败批次), action buttons (全选, 取消全选, 预览, 发送通知, 发送中), status labels, count text, preview modal UI strings, disabled state text, empty state text, and toast messages remain displayed in Simplified Chinese.

1.4 WHEN the user sets the locale to any non-zh language AND navigates to the content email notification page (`admin/email-content.tsx`), THEN the page title "新内容邮件通知", back button "← 返回", loading text "加载中...", send result labels, action buttons, status labels, count text, preview modal UI strings, disabled state text, empty state text, and toast messages remain displayed in Simplified Chinese (same pattern as email-products).

1.5 WHEN the user sets the locale to any non-zh language AND navigates to the admin dashboard (`admin/index.tsx`), THEN the DASHBOARD_CATEGORIES sidebar labels (商品管理, 订单管理, 用户管理, 内容管理, 运营工具, 系统设置) remain displayed in Simplified Chinese.

1.6 WHEN the user sets the locale to any non-zh language AND navigates to the content upload page (`content/upload.tsx`), THEN the tags field label "标签" remains displayed in Simplified Chinese.

### Expected Behavior (Correct)

2.1 WHEN the user sets the locale to any supported language AND navigates to the user settings page, THEN the email subscription section header, toggle labels, and toggle descriptions SHALL be displayed in the selected locale's language via `t()` translation calls using keys from `settings.emailSubscriptions.*`.

2.2 WHEN the user sets the locale to any supported language AND navigates to the admin settings page, THEN all SETTINGS_CATEGORIES labels, NOTIFICATION_TYPE_LABELS, category titles, CollapsibleSection titles/descriptions, and template editor UI strings SHALL be displayed in the selected locale's language via `t()` translation calls using appropriate keys under `admin.settings.*`.

2.3 WHEN the user sets the locale to any supported language AND navigates to the product email notification page, THEN all page title, navigation, loading, result labels, action buttons, status labels, count text, preview modal UI, disabled/empty state text, and toast messages SHALL be displayed in the selected locale's language via `t()` translation calls using keys under `admin.emailProducts.*`.

2.4 WHEN the user sets the locale to any supported language AND navigates to the content email notification page, THEN all page title, navigation, loading, result labels, action buttons, status labels, count text, preview modal UI, disabled/empty state text, and toast messages SHALL be displayed in the selected locale's language via `t()` translation calls using keys under `admin.emailContent.*`.

2.5 WHEN the user sets the locale to any supported language AND navigates to the admin dashboard, THEN all DASHBOARD_CATEGORIES sidebar labels SHALL be displayed in the selected locale's language via `t()` translation calls using keys under `admin.dashboard.*`.

2.6 WHEN the user sets the locale to any supported language AND navigates to the content upload page, THEN the tags field label SHALL be displayed in the selected locale's language via a `t()` translation call using a key under `contentHub.upload.*`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user sets the locale to zh (Simplified Chinese) AND navigates to any of the affected pages, THEN the system SHALL CONTINUE TO display all strings in Simplified Chinese exactly as they appear today.

3.2 WHEN the user navigates to the admin settings page and views the easter egg / help section ("寻求帮助" content), THEN the system SHALL CONTINUE TO display the easter egg content in hardcoded Chinese regardless of the selected locale.

3.3 WHEN the user views locale selector options (e.g., '中文', 'English', '日本語', '한국어', '繁體中文') in settings or admin pages, THEN the system SHALL CONTINUE TO display each language name in its native script regardless of the selected locale.

3.4 WHEN the user navigates to any page that already uses `t()` calls correctly (e.g., login, register, product detail, cart, orders, profile), THEN the system SHALL CONTINUE TO display all strings correctly in the selected locale without any regressions.

3.5 WHEN the `TranslationDict` type is updated with new keys, THEN all 5 locale files (zh, en, ja, ko, zh-TW) SHALL CONTINUE TO satisfy the type contract, and the TypeScript build SHALL CONTINUE TO compile without errors.

3.6 WHEN the LOCALE_TABS array in `admin/settings.tsx` displays locale labels for the template editor, THEN the system SHALL CONTINUE TO display each locale name in its native script (中文, English, 日本語, 한국어, 繁體中文).

---

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { locale: Locale, page: Page, stringId: StringId }
  OUTPUT: boolean

  // Returns true when a hardcoded Chinese string is rendered on a page
  // while the user's locale is not Simplified Chinese
  RETURN X.locale ≠ 'zh'
    AND X.stringId ∈ HARDCODED_STRINGS
    AND X.page ∈ AFFECTED_PAGES
END FUNCTION
```

Where:
- `HARDCODED_STRINGS` = the set of ~120 Chinese strings identified across the 6 affected files
- `AFFECTED_PAGES` = { settings/index, admin/settings, admin/email-products, admin/email-content, admin/index, content/upload }

## Property Specification

```pascal
// Property: Fix Checking — All hardcoded strings use t() after fix
FOR ALL X WHERE isBugCondition(X) DO
  renderedText ← renderPage'(X.page, X.locale)
  translatedString ← t(X.stringId, X.locale)
  ASSERT renderedText CONTAINS translatedString
  ASSERT renderedText DOES NOT CONTAIN hardcodedChinese(X.stringId)
END FOR
```

## Preservation Goal

```pascal
// Property: Preservation Checking — zh locale and excluded strings unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT renderPage(X.page, X.locale) = renderPage'(X.page, X.locale)
END FOR
```

This ensures:
- For zh locale users, all pages render identically before and after the fix
- Easter egg content remains hardcoded Chinese in all locales
- Native language labels in locale selectors remain unchanged
- All existing `t()` translations continue to work correctly
