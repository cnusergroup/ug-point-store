import type { Locale } from './types';

/** Supported locales constant */
export const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'zh-TW'] as const;

/** Country code to locale mapping */
export const COUNTRY_LOCALE_MAP: Record<string, Locale> = {
  JP: 'ja',
  KR: 'ko',
  TW: 'zh-TW',
  US: 'en',
  GB: 'en',
  AU: 'en',
  NZ: 'en',
  CA: 'en',
  CN: 'zh',
};

/** Configuration for detectLocale — all external dependencies injected via callbacks */
export interface DetectLocaleConfig {
  getBrowserLanguage: () => string | null;
  getCountryCookie: () => string | null;
}

/** Chinese traditional variant subtags / scripts */
const ZH_TW_VARIANTS = new Set(['tw', 'hk', 'hant']);
/** Chinese simplified variant subtags / scripts */
const ZH_CN_VARIANTS = new Set(['cn', 'hans']);

/**
 * Parse a BCP 47 language tag into a supported Locale.
 *
 * Matching rules (evaluated in order):
 *   1. Exact match against SUPPORTED_LOCALES (e.g., 'ja' → 'ja', 'zh-TW' → 'zh-TW')
 *   2. Chinese variant handling:
 *      - zh-TW / zh-HK / zh-Hant → 'zh-TW'
 *      - zh / zh-CN / zh-Hans → 'zh'
 *   3. Primary subtag match (e.g., 'en-US' → 'en', 'ko-KR' → 'ko', 'ja-JP' → 'ja')
 *
 * Returns null if no match found (e.g., 'fr', 'de').
 */
export function parseBrowserLanguage(tag: string): Locale | null {
  if (!tag) return null;

  const normalized = tag.trim();

  // 1. Exact match (case-insensitive)
  const exactMatch = (SUPPORTED_LOCALES as readonly string[]).find(
    (l) => l.toLowerCase() === normalized.toLowerCase()
  );
  if (exactMatch) return exactMatch as Locale;

  // Split into parts: primary[-subtag]
  const parts = normalized.split('-');
  const primary = parts[0].toLowerCase();

  // 2. Chinese variant handling
  if (primary === 'zh') {
    if (parts.length > 1) {
      const subtag = parts[1].toLowerCase();
      if (ZH_TW_VARIANTS.has(subtag)) return 'zh-TW';
      if (ZH_CN_VARIANTS.has(subtag)) return 'zh';
    }
    // bare 'zh' → simplified Chinese
    return 'zh';
  }

  // 3. Primary subtag match against supported locales
  const primaryMatch = (SUPPORTED_LOCALES as readonly string[]).find(
    (l) => l.toLowerCase() === primary
  );
  if (primaryMatch) return primaryMatch as Locale;

  // No match
  return null;
}

/**
 * Map an ISO 3166-1 alpha-2 country code to a Locale.
 * Uses COUNTRY_LOCALE_MAP; defaults to 'zh' for unmapped codes.
 */
export function mapCountryToLocale(countryCode: string): Locale {
  if (!countryCode) return 'zh';
  const code = countryCode.trim().toUpperCase();
  return COUNTRY_LOCALE_MAP[code] ?? 'zh';
}

/**
 * Detect the best locale by evaluating sources in priority order:
 *   1. Browser language (via config.getBrowserLanguage)
 *   2. Country cookie (via config.getCountryCookie)
 *   3. Default 'zh'
 *
 * Note: localStorage check happens in the Zustand store BEFORE calling this function.
 */
export function detectLocale(config: DetectLocaleConfig): Locale {
  // 1. Try browser language
  const browserLang = config.getBrowserLanguage();
  if (browserLang) {
    const parsed = parseBrowserLanguage(browserLang);
    if (parsed) return parsed;
  }

  // 2. Try country cookie
  const country = config.getCountryCookie();
  if (country) {
    return mapCountryToLocale(country);
  }

  // 3. Default
  return 'zh';
}
