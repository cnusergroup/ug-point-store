# Requirements Document

## Introduction

本功能为积分商城系统添加自动语言检测能力。当用户首次访问时（包括登录页面和注册页面），系统根据浏览器语言偏好和 CloudFront 地理位置信息自动选择最匹配的语言，而非始终默认中文。用户手动选择的语言优先级最高，保存在 localStorage 中。该功能需同时支持 H5/Web 和微信小程序两种运行环境。

## Glossary

- **Locale_Detector**: 负责检测和解析用户语言偏好的前端模块，输出一个受支持的 Locale 值
- **Locale**: 系统支持的语言标识，取值为 `zh`、`en`、`ja`、`ko`、`zh-TW` 之一
- **Supported_Locales**: 系统支持的全部语言集合：`['zh', 'en', 'ja', 'ko', 'zh-TW']`
- **Browser_Language**: 在 H5/Web 环境中通过 `navigator.language` 获取的浏览器语言标签（BCP 47 格式，如 `en-US`、`ja`、`zh-TW`）
- **MiniProgram_Language**: 在微信小程序环境中通过 `Taro.getSystemInfoSync().language` 获取的系统语言标签
- **Country_Header**: CloudFront 通过 `CloudFront-Viewer-Country` 请求头传递的 ISO 3166-1 alpha-2 国家代码（如 `JP`、`KR`、`CN`）
- **Country_Cookie**: 由 CloudFront Function 写入的 cookie，名为 `cf_country`，值为 ISO 3166-1 alpha-2 国家代码
- **Country_Locale_Map**: 国家代码到 Locale 的映射表：JP→ja、KR→ko、TW→zh-TW、US/GB/AU/NZ/CA→en、CN 及其他→zh
- **Locale_Store**: Zustand store 中的 `locale` 状态字段及其持久化到 localStorage（key: `app_locale`）的机制
- **CloudFront_Function**: 部署在 CloudFront viewer-request 阶段的轻量函数，用于将 `CloudFront-Viewer-Country` 头的值写入 `cf_country` cookie

## Requirements

### Requirement 1: Locale Detection Priority Chain

**User Story:** As a first-time visitor, I want the system to automatically display content in my preferred language, so that I can use the application without manually switching language.

#### Acceptance Criteria

1. WHEN a user visits any page and `app_locale` exists in localStorage with a value in Supported_Locales, THE Locale_Store SHALL use that saved value as the active Locale
2. WHEN a user visits any page and `app_locale` does not exist in localStorage, THE Locale_Detector SHALL determine the Locale by evaluating the following sources in order: Browser_Language, then Country_Cookie, then default `zh`
3. WHEN the Locale_Detector determines a Locale from any detection source, THE Locale_Store SHALL set the determined Locale as the active Locale and persist it to localStorage under the key `app_locale`

### Requirement 2: Browser Language Detection

**User Story:** As a user with a non-Chinese browser, I want the system to detect my browser language setting, so that the interface matches my browser preference.

#### Acceptance Criteria

1. WHEN the Locale_Detector evaluates Browser_Language in an H5/Web environment, THE Locale_Detector SHALL read the value from `navigator.language`
2. WHEN the Locale_Detector evaluates Browser_Language in a WeChat MiniProgram environment, THE Locale_Detector SHALL read the value from `Taro.getSystemInfoSync().language`
3. WHEN Browser_Language is a full BCP 47 tag (e.g., `en-US`, `zh-CN`, `zh-TW`), THE Locale_Detector SHALL first attempt an exact match against Supported_Locales, then attempt a primary language subtag match (e.g., `en-US` matches `en`, `zh-CN` matches `zh`)
4. WHEN Browser_Language matches `zh-TW` or `zh-HK` or `zh-Hant`, THE Locale_Detector SHALL resolve the Locale to `zh-TW`
5. WHEN Browser_Language matches `zh`, `zh-CN`, or `zh-Hans`, THE Locale_Detector SHALL resolve the Locale to `zh`
6. WHEN Browser_Language does not match any Supported_Locales after exact and subtag matching, THE Locale_Detector SHALL proceed to evaluate the Country_Cookie source

### Requirement 3: Country-Based Locale Detection via CloudFront

**User Story:** As a user whose browser language is not in the supported list, I want the system to detect my geographic location, so that I still get a reasonable language default.

#### Acceptance Criteria

1. THE CloudFront_Function SHALL read the `CloudFront-Viewer-Country` header from the viewer request and write its value into a `cf_country` cookie with `Path=/`, `Secure`, `SameSite=Lax`, and a `Max-Age` of 86400 seconds
2. WHEN the Locale_Detector evaluates the Country_Cookie source, THE Locale_Detector SHALL read the `cf_country` cookie value and map it to a Locale using the Country_Locale_Map
3. WHEN the Country_Cookie value is `JP`, THE Locale_Detector SHALL resolve the Locale to `ja`
4. WHEN the Country_Cookie value is `KR`, THE Locale_Detector SHALL resolve the Locale to `ko`
5. WHEN the Country_Cookie value is `TW`, THE Locale_Detector SHALL resolve the Locale to `zh-TW`
6. WHEN the Country_Cookie value is `US`, `GB`, `AU`, `NZ`, or `CA`, THE Locale_Detector SHALL resolve the Locale to `en`
7. WHEN the Country_Cookie value is `CN` or any value not listed in the Country_Locale_Map, THE Locale_Detector SHALL resolve the Locale to `zh`
8. IF the Country_Cookie is absent or empty, THEN THE Locale_Detector SHALL resolve the Locale to the default value `zh`

### Requirement 4: Login and Register Page Locale Support

**User Story:** As an unauthenticated user on the login or register page, I want the page to display in my detected language immediately, so that I can understand the interface before logging in.

#### Acceptance Criteria

1. WHEN the login page loads, THE Locale_Detector SHALL execute the detection logic before the login page renders its translated content
2. WHEN the register page loads, THE Locale_Detector SHALL execute the detection logic before the register page renders its translated content
3. THE Locale_Detector SHALL execute the detection logic synchronously so that no flash of untranslated or wrong-language content is visible to the user

### Requirement 5: Manual Locale Override Persistence

**User Story:** As a user who has manually selected a language, I want my choice to be remembered and take priority over automatic detection, so that the system respects my explicit preference.

#### Acceptance Criteria

1. WHEN a user manually selects a Locale via the settings page, THE Locale_Store SHALL persist the selected Locale to localStorage under the key `app_locale`
2. WHEN a user returns to the application after manually selecting a Locale, THE Locale_Store SHALL use the persisted value from localStorage and skip all automatic detection logic
3. THE Locale_Store SHALL treat any value in localStorage that is not a member of Supported_Locales as absent, and proceed with automatic detection

### Requirement 6: CloudFront Function CDK Deployment

**User Story:** As a developer, I want the CloudFront Function to be defined in the CDK stack, so that it is deployed and managed as infrastructure-as-code.

#### Acceptance Criteria

1. THE FrontendStack SHALL define the CloudFront_Function as a `cloudfront.Function` resource with the `VIEWER_REQUEST` event type
2. THE FrontendStack SHALL associate the CloudFront_Function with the default behavior of the CloudFront Distribution
3. WHEN the CloudFront_Function processes a viewer request, THE CloudFront_Function SHALL pass through the original request unmodified except for the addition of the `Set-Cookie` header containing the `cf_country` cookie
4. IF the `CloudFront-Viewer-Country` header is absent from the viewer request, THEN THE CloudFront_Function SHALL pass through the request without adding a `Set-Cookie` header

### Requirement 7: Locale Detector Module Structure

**User Story:** As a developer, I want the locale detection logic encapsulated in a dedicated module, so that it is testable and reusable.

#### Acceptance Criteria

1. THE Locale_Detector SHALL be implemented as a pure function `detectLocale()` that accepts a configuration object containing `getBrowserLanguage` and `getCountryCookie` callbacks, and returns a Locale value
2. THE Locale_Detector SHALL export a `parseBrowserLanguage(tag: string): Locale | null` function that maps a BCP 47 language tag to a Locale or returns null if no match is found
3. THE Locale_Detector SHALL export a `mapCountryToLocale(countryCode: string): Locale` function that maps an ISO 3166-1 alpha-2 country code to a Locale using the Country_Locale_Map
4. FOR ALL valid BCP 47 language tags that map to a Supported_Locale, parsing then mapping back to a language tag prefix SHALL produce a consistent Locale value (round-trip property)
