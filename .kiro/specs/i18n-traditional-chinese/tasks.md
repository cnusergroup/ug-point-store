# 實現計劃：新增繁體中文（zh-TW）語言支持

## 概述

為積分商城前端現有 i18n 系統新增繁體中文（zh-TW）語言支持。涉及類型定義擴展、新建翻譯字典文件、翻譯模組註冊、Store 驗證更新、設置頁面選項新增、屬性測試擴展。

## 任務

- [x] 1. 擴展類型定義與核心註冊
  - [x] 1.1 擴展 Locale 類型新增 'zh-TW'
    - 在 `packages/frontend/src/i18n/types.ts` 中：
      - 將 `Locale` 類型從 `'zh' | 'en' | 'ja' | 'ko'` 擴展為 `'zh' | 'en' | 'ja' | 'ko' | 'zh-TW'`
    - _需求: 1.1, 1.2_

  - [x] 1.2 建立繁體中文翻譯字典文件
    - 新建 `packages/frontend/src/i18n/zh-TW.ts`
    - 導出 `zhTW: TranslationDict` 常量
    - 將 `zh.ts` 中所有約 350 個鍵值從簡體中文轉換為繁體中文
    - 簡繁轉換要點：
      - 基礎字詞：加载→載入、数据→資料、信息→資訊
      - 界面用語：购物车→購物車、积分→積分、商城→商城
      - 操作提示：确认→確認、取消→取消、删除→刪除
      - 錯誤訊息：所有錯誤提示文本轉為繁體
    - TypeScript 類型檢查確保鍵集與 zh.ts 完全一致
    - _需求: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.3 在翻譯模組中註冊 zh-TW 字典
    - 在 `packages/frontend/src/i18n/index.ts` 中：
      - 新增 `import { zhTW } from './zh-TW';`
      - 在 `dictionaries` 映射中新增 `'zh-TW': zhTW` 條目
    - _需求: 3.1, 3.2, 3.3_

- [x] 2. Store 與設置頁面更新
  - [x] 2.1 更新 Store locale 驗證數組
    - 在 `packages/frontend/src/store/index.ts` 中：
      - 將 locale 初始化的驗證數組從 `['zh', 'en', 'ja', 'ko']` 擴展為 `['zh', 'en', 'ja', 'ko', 'zh-TW']`
    - _需求: 4.1, 4.2, 4.3_

  - [x] 2.2 設置頁面新增繁體中文選項
    - 在 `packages/frontend/src/pages/settings/index.tsx` 中：
      - 在 `LOCALE_OPTIONS` 數組中新增 `{ key: 'zh-TW', label: '繁體中文' }` 條目
      - 放置在 `'zh'`（中文）之後、`'en'`（English）之前
    - _需求: 5.1, 5.2, 5.3, 5.4_

- [x] 3. 屬性測試擴展
  - [x] 3.1 擴展屬性測試覆蓋 zh-TW
    - 在 `packages/frontend/src/i18n/i18n.property.test.ts` 中：
      - 新增 `import { zhTW } from './zh-TW';`
      - 在 `dictMap` 對象中新增 `'zh-TW': zhTW` 條目
      - Property 1（鍵集完整性）：`constantFrom` 參數新增 `'zh-TW'`
      - Property 5（JSON 往返一致性）：`allDicts` 數組新增 `{ name: 'zh-TW', dict: zhTW }`
    - 運行測試確認所有屬性測試通過
    - _需求: 6.1, 6.2, 6.3_
