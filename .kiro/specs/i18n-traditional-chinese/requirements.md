# 需求文档：新增繁體中文（zh-TW）語言支持

## 簡介

為積分商城前端現有的多語言（i18n）系統新增繁體中文（zh-TW）語言支持。現有系統已支持簡體中文（zh）、英文（en）、日文（ja）、韓文（ko）四種語言，本次擴展在不改變現有架構的前提下，將繁體中文作為第五種語言加入。需要修改類型定義、新增翻譯字典文件、更新 Hook 註冊、Store 驗證、設置頁面選項以及屬性測試。

## 術語表

- **Locale**：語言標識符，擴展後取值為 `zh`、`en`、`ja`、`ko`、`zh-TW` 之一
- **Translation_Dictionary**：以 Locale 為鍵、翻譯文本為值的 JSON 對象集合，位於 `packages/frontend/src/i18n/` 目錄下的各語言文件
- **Translation_Module**：提供 `useTranslation` Hook 和翻譯字典的前端模組，位於 `packages/frontend/src/i18n/`
- **Store**：基於 Zustand 的全局狀態管理，位於 `packages/frontend/src/store/index.ts`
- **Settings_Page**：設置頁面，位於 `packages/frontend/src/pages/settings/index.tsx`
- **Locale_Type**：TypeScript 類型定義，位於 `packages/frontend/src/i18n/types.ts`，定義所有合法的語言標識符聯合類型
- **Property_Test**：屬性測試文件，位於 `packages/frontend/src/i18n/i18n.property.test.ts`，驗證翻譯字典鍵集完整性和 JSON 往返一致性

## 需求

### 需求 1：擴展 Locale 類型定義

**用戶故事：** 作為開發者，我希望 Locale 類型包含 `zh-TW`，以便 TypeScript 編譯器能對繁體中文語言標識進行類型檢查。

#### 驗收標準

1. THE Locale_Type SHALL 包含 `'zh-TW'` 作為聯合類型的一個成員，擴展後完整定義為 `'zh' | 'en' | 'ja' | 'ko' | 'zh-TW'`
2. WHEN 開發者將 `'zh-TW'` 賦值給 Locale 類型的變量時，THE TypeScript 編譯器 SHALL 不產生類型錯誤

### 需求 2：建立繁體中文翻譯字典

**用戶故事：** 作為繁體中文用戶，我希望界面上的所有靜態文本都以繁體中文顯示。

#### 驗收標準

1. THE Translation_Module SHALL 在 `packages/frontend/src/i18n/` 目錄下包含一個 `zh-TW.ts` 文件，導出名為 `zhTW` 的翻譯字典
2. THE `zhTW` 翻譯字典 SHALL 實現 `TranslationDict` 介面，包含與簡體中文（zh）字典完全相同的鍵集合
3. THE `zhTW` 翻譯字典中的每個值 SHALL 為對應簡體中文文本的繁體中文轉換（例如「购物车」轉為「購物車」，「积分」轉為「積分」）
4. FOR ALL `zhTW` 翻譯字典中的鍵路徑，遞歸展開後的鍵集合 SHALL 與 `zh` 字典的鍵集合完全相同

### 需求 3：註冊繁體中文字典到翻譯模組

**用戶故事：** 作為開發者，我希望 `useTranslation` Hook 能識別並使用繁體中文字典。

#### 驗收標準

1. THE Translation_Module 的 `dictionaries` 映射 SHALL 包含 `'zh-TW'` 鍵，對應 `zhTW` 翻譯字典
2. WHEN Store 中的 locale 值為 `'zh-TW'` 時，THE `useTranslation` Hook 返回的 `t()` 函數 SHALL 從 `zhTW` 字典中查找翻譯文本
3. WHEN `zhTW` 字典中某個鍵不存在時，THE `t()` 函數 SHALL 回退到簡體中文（zh）字典中對應的值

### 需求 4：Store 支持 zh-TW Locale

**用戶故事：** 作為用戶，我希望選擇繁體中文後，刷新頁面或重新打開應用時語言設置仍然保留。

#### 驗收標準

1. THE Store 的 locale 初始化邏輯 SHALL 將 `'zh-TW'` 視為有效的 Locale 值，當 localStorage 中存儲的值為 `'zh-TW'` 時使用該值作為初始 Locale
2. WHEN `setLocale('zh-TW')` 被調用時，THE Store SHALL 將 `'zh-TW'` 寫入 localStorage（鍵名 `app_locale`）
3. THE Store 的 locale 驗證數組 SHALL 包含 `'zh-TW'`，擴展後為 `['zh', 'en', 'ja', 'ko', 'zh-TW']`

### 需求 5：設置頁面新增繁體中文選項

**用戶故事：** 作為用戶，我希望在設置頁面的語言切換區域看到繁體中文選項並能選擇。

#### 驗收標準

1. THE Settings_Page 的 `LOCALE_OPTIONS` 數組 SHALL 包含一個 `{ key: 'zh-TW', label: '繁體中文' }` 選項
2. THE 繁體中文選項 SHALL 顯示在語言切換組件中，與其他四個語言選項樣式一致
3. WHEN 用戶點擊繁體中文選項時，THE Settings_Page SHALL 調用 Store 的 `setLocale('zh-TW')` 方法
4. WHEN 當前 locale 為 `'zh-TW'` 時，THE Settings_Page SHALL 高亮顯示繁體中文選項

### 需求 6：更新屬性測試覆蓋 zh-TW

**用戶故事：** 作為開發者，我希望屬性測試能驗證繁體中文字典的鍵集完整性和 JSON 往返一致性。

#### 驗收標準

1. THE Property_Test 的鍵集完整性測試（Property 1）SHALL 將 `'zh-TW'` 納入非中文 Locale 的測試範圍，驗證 `zhTW` 字典的鍵集合與 `zh` 字典完全相同
2. THE Property_Test 的 JSON 往返一致性測試（Property 5）SHALL 將 `zhTW` 字典納入測試範圍，驗證 `JSON.parse(JSON.stringify(zhTW))` 與原始字典深度相等
3. THE Property_Test 中的 `dictMap` 對象 SHALL 包含 `'zh-TW'` 鍵，對應 `zhTW` 字典
