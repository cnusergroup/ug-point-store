# Implementation Plan: Auto Locale Detection

## Overview

为积分商城前端添加自动语言检测能力。实现包含四个主要组件：locale-detector 纯函数模块、Zustand store 初始化逻辑修改、CloudFront Function（将 Viewer-Country 头写入 cookie）、CDK stack 更新。检测优先级链为：localStorage 手动选择 > 浏览器语言 > 国家 cookie > 默认 zh。

## Tasks

- [x] 1. Create locale-detector module with pure functions
  - [x] 1.1 Create `packages/frontend/src/i18n/locale-detector.ts`
    - Export `SUPPORTED_LOCALES` constant: `['zh', 'en', 'ja', 'ko', 'zh-TW'] as const`
    - Export `COUNTRY_LOCALE_MAP` record: `JP→ja, KR→ko, TW→zh-TW, US/GB/AU/NZ/CA→en, CN→zh`
    - Export `DetectLocaleConfig` interface with `getBrowserLanguage` and `getCountryCookie` callbacks
    - Implement `parseBrowserLanguage(tag: string): Locale | null`:
      - Exact match against SUPPORTED_LOCALES
      - Chinese variant handling: `zh-TW`, `zh-HK`, `zh-Hant` → `zh-TW`; `zh`, `zh-CN`, `zh-Hans` → `zh`
      - Primary subtag match: `en-US` → `en`, `ko-KR` → `ko`, `ja-JP` → `ja`
      - Return `null` for unsupported languages (e.g., `fr`, `de`)
    - Implement `mapCountryToLocale(countryCode: string): Locale`:
      - Look up country code in COUNTRY_LOCALE_MAP
      - Return `zh` for unmapped codes
    - Implement `detectLocale(config: DetectLocaleConfig): Locale`:
      - Call `config.getBrowserLanguage()`, parse with `parseBrowserLanguage`
      - If matched, return that locale
      - Otherwise call `config.getCountryCookie()`, map with `mapCountryToLocale`
      - If cookie is null/empty, return `zh`
    - _Requirements: 7.1, 7.2, 7.3, 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x]* 1.2 Write property test: parseBrowserLanguage correctness (Property 1)
    - **Property 1: parseBrowserLanguage returns correct locale or null**
    - Generate random BCP 47 tags with supported primary subtags (`en`, `ja`, `ko`, `zh`) plus random region/script suffixes; also generate unsupported subtags (`fr`, `de`, `pt`, etc.)
    - Assert: supported primary subtags always return a valid Locale; unsupported subtags always return null; Chinese variants map correctly
    - Test file: `packages/frontend/src/i18n/locale-detector.property.test.ts`
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 7.2**

  - [x]* 1.3 Write property test: mapCountryToLocale always returns valid locale (Property 2)
    - **Property 2: mapCountryToLocale always returns a valid locale**
    - Generate random 2-letter uppercase strings as country codes
    - Assert: return value is always a member of SUPPORTED_LOCALES; mapped codes return their expected locale; unmapped codes return `zh`
    - Test file: `packages/frontend/src/i18n/locale-detector.property.test.ts`
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.3**

  - [x]* 1.4 Write property test: detectLocale respects priority chain (Property 3)
    - **Property 3: detectLocale respects priority chain**
    - Generate random `(browserLang, countryCookie)` pairs where each can be a matching tag, non-matching tag, or null
    - Assert: browser language match takes priority over cookie; cookie used when browser returns no match; `zh` returned when both sources return no match
    - Test file: `packages/frontend/src/i18n/locale-detector.property.test.ts`
    - **Validates: Requirements 1.2, 3.8**

  - [x]* 1.5 Write property test: BCP 47 round-trip consistency (Property 4)
    - **Property 4: BCP 47 round-trip consistency**
    - Generate from the 5 supported locales, parse back with `parseBrowserLanguage`
    - Assert: parsing a supported locale string returns the same locale value
    - Test file: `packages/frontend/src/i18n/locale-detector.property.test.ts`
    - **Validates: Requirements 7.4**

  - [x]* 1.6 Write unit tests for locale-detector
    - Test file: `packages/frontend/src/i18n/locale-detector.test.ts`
    - Test `parseBrowserLanguage` specific examples: `en-US`→`en`, `zh-TW`→`zh-TW`, `zh-HK`→`zh-TW`, `zh-Hant`→`zh-TW`, `zh-CN`→`zh`, `zh-Hans`→`zh`, `fr-FR`→`null`, `de`→`null`
    - Test `mapCountryToLocale` specific examples: `JP`→`ja`, `KR`→`ko`, `TW`→`zh-TW`, `US`→`en`, `GB`→`en`, `CN`→`zh`, `BR`→`zh`
    - Test `detectLocale` with all sources available (browser language takes priority)
    - Test `detectLocale` with only cookie (falls back to country mapping)
    - Test `detectLocale` with no sources (returns `zh`)
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.2, 7.3_

- [x] 2. Checkpoint - Ensure locale-detector tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Modify Zustand store locale initialization
  - [x] 3.1 Update `packages/frontend/src/store/index.ts` locale IIFE
    - Import `SUPPORTED_LOCALES` and `detectLocale` from `../i18n/locale-detector`
    - Replace hardcoded `['zh', 'en', 'ja', 'ko', 'zh-TW'].includes(saved)` with `SUPPORTED_LOCALES.includes(saved as Locale)`
    - When localStorage has no valid locale, call `detectLocale()` with platform-aware callbacks:
      - `getBrowserLanguage`: use `Taro.getSystemInfoSync().language` for WeChat Mini Program, `navigator.language` for H5
      - `getCountryCookie`: parse `cf_country` from `document.cookie` (return null if `document` is undefined)
    - Persist detected locale to localStorage via `Taro.setStorageSync('app_locale', detected)`
    - Wrap all platform calls in try/catch, returning null on error
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

  - [x]* 3.2 Write property test: invalid localStorage values are rejected (Property 5)
    - **Property 5: Invalid localStorage values are rejected**
    - Generate random strings that are NOT in SUPPORTED_LOCALES
    - Assert: store initialization treats invalid values as absent and proceeds with detectLocale
    - Test file: `packages/frontend/src/i18n/locale-detector.property.test.ts`
    - **Validates: Requirements 5.3, 1.1**

- [x] 4. Create CloudFront Function for country cookie
  - [x] 4.1 Create `packages/cdk/lambda/cf-country-cookie/index.js`
    - Implement CloudFront Function handler (cloudfront-js-2.0 runtime)
    - Read `cloudfront-viewer-country` header from `event.request.headers`
    - If header present, append `Set-Cookie: cf_country=<value>; Path=/; Secure; SameSite=Lax; Max-Age=86400` to `event.response.headers`
    - Use `multiValue` array to avoid overwriting existing Set-Cookie headers
    - If header absent, return response unchanged
    - _Requirements: 3.1, 6.3, 6.4_

  - [x]* 4.2 Write unit tests for CloudFront Function
    - Test file: `packages/cdk/lambda/cf-country-cookie/index.test.js`
    - Test handler with country header present → sets cf_country cookie
    - Test handler without country header → passes response through unchanged
    - Test handler preserves existing Set-Cookie headers
    - _Requirements: 3.1, 6.3, 6.4_

- [x] 5. Update CDK stack to deploy CloudFront Function
  - [x] 5.1 Update `packages/cdk/lib/frontend-stack.ts`
    - Add `import * as path from 'path'` if not present
    - Create `cloudfront.Function` resource with `FunctionCode.fromFile` pointing to `../lambda/cf-country-cookie/index.js`
    - Set runtime to `cloudfront.FunctionRuntime.JS_2_0`
    - Add `functionAssociations` to the `defaultBehavior` of the Distribution with `VIEWER_RESPONSE` event type
    - _Requirements: 6.1, 6.2_

  - [x]* 5.2 Write CDK assertion test for CloudFront Function
    - Verify CloudFront Function resource exists in synthesized template
    - Verify function is associated with default behavior as VIEWER_RESPONSE
    - _Requirements: 6.1, 6.2_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The locale-detector module uses pure functions with dependency injection for full testability
- Detection runs synchronously at store init time to prevent flash of wrong-language content
