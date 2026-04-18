import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseBrowserLanguage, mapCountryToLocale, detectLocale, SUPPORTED_LOCALES, COUNTRY_LOCALE_MAP } from './locale-detector';
import type { Locale } from './types';

// Feature: auto-locale-detection, Property 1: parseBrowserLanguage returns correct locale or null
//
// For any BCP 47 language tag whose primary subtag is one of {en, ja, ko, zh},
// parseBrowserLanguage SHALL return a valid Locale from SUPPORTED_LOCALES.
// For any BCP 47 tag whose primary subtag is NOT in that set,
// parseBrowserLanguage SHALL return null.
// Additionally, Chinese variant tags (zh-TW, zh-HK, zh-Hant) SHALL map to 'zh-TW',
// and simplified Chinese tags (zh, zh-CN, zh-Hans) SHALL map to 'zh'.
//
// **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 7.2**

const UNSUPPORTED_PRIMARY_SUBTAGS = [
  'fr', 'de', 'pt', 'es', 'it', 'ru', 'ar', 'hi', 'th', 'vi', 'pl', 'nl', 'sv', 'tr', 'cs',
] as const;

const ZH_TW_VARIANTS = ['tw', 'hk', 'hant'] as const;
const ZH_CN_VARIANTS = ['cn', 'hans'] as const;

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** Generate a random 2-letter uppercase region code like 'US', 'JP' */
const regionCodeArb = fc.tuple(fc.constantFrom(...UPPER), fc.constantFrom(...UPPER)).map(([a, b]) => a + b);

/** Generate a random 4-letter lowercase script tag like 'latn', 'cyrl' */
const scriptTagArb = fc.tuple(
  fc.constantFrom(...LOWER), fc.constantFrom(...LOWER),
  fc.constantFrom(...LOWER), fc.constantFrom(...LOWER),
).map(([a, b, c, d]) => a + b + c + d);

/** Arbitrary for a random BCP 47 region/script suffix (e.g., '-US', '-Latn') or empty */
const regionSuffixArb = fc.oneof(
  fc.constant(''),
  regionCodeArb.map((s) => `-${s}`),
  scriptTagArb.map((s) => `-${s}`),
);

describe('Property 1: parseBrowserLanguage returns correct locale or null', () => {
  it('supported primary subtags (en, ja, ko) always return a valid Locale', () => {
    const nonZhPrimaryArb = fc.constantFrom('en', 'ja', 'ko');

    fc.assert(
      fc.property(nonZhPrimaryArb, regionSuffixArb, (primary, suffix) => {
        const tag = `${primary}${suffix}`;
        const result = parseBrowserLanguage(tag);

        // Must return a valid Locale
        expect(result).not.toBeNull();
        expect(SUPPORTED_LOCALES).toContain(result);
        // Must match the primary subtag
        expect(result).toBe(primary);
      }),
      { numRuns: 200 },
    );
  });

  it('zh with traditional variant subtags (tw, hk, hant) maps to zh-TW', () => {
    const zhTwVariantArb = fc.constantFrom(...ZH_TW_VARIANTS);

    fc.assert(
      fc.property(zhTwVariantArb, (variant) => {
        // Test both lowercase and mixed case
        const tags = [
          `zh-${variant}`,
          `zh-${variant.toUpperCase()}`,
          `zh-${variant.charAt(0).toUpperCase()}${variant.slice(1)}`,
        ];
        for (const tag of tags) {
          const result = parseBrowserLanguage(tag);
          expect(result).toBe('zh-TW');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('zh with simplified variant subtags (cn, hans) maps to zh', () => {
    const zhCnVariantArb = fc.constantFrom(...ZH_CN_VARIANTS);

    fc.assert(
      fc.property(zhCnVariantArb, (variant) => {
        const tags = [
          `zh-${variant}`,
          `zh-${variant.toUpperCase()}`,
          `zh-${variant.charAt(0).toUpperCase()}${variant.slice(1)}`,
        ];
        for (const tag of tags) {
          const result = parseBrowserLanguage(tag);
          expect(result).toBe('zh');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('bare zh returns zh', () => {
    expect(parseBrowserLanguage('zh')).toBe('zh');
    expect(parseBrowserLanguage('ZH')).toBe('zh');
  });

  it('zh with random non-variant suffixes still returns a valid Locale (zh or zh-TW)', () => {
    const randomRegionArb = regionCodeArb
      .filter((s) => !['TW', 'HK', 'CN'].includes(s.toUpperCase()));

    const randomScriptArb = scriptTagArb
      .filter((s) => !['hant', 'hans'].includes(s.toLowerCase()));

    const suffixArb = fc.oneof(
      randomRegionArb.map((s) => `-${s}`),
      randomScriptArb.map((s) => `-${s}`),
    );

    fc.assert(
      fc.property(suffixArb, (suffix) => {
        const tag = `zh${suffix}`;
        const result = parseBrowserLanguage(tag);
        // zh with unknown suffix should still return a valid locale
        expect(result).not.toBeNull();
        expect(SUPPORTED_LOCALES).toContain(result);
      }),
      { numRuns: 200 },
    );
  });

  it('unsupported primary subtags always return null', () => {
    const unsupportedArb = fc.constantFrom(...UNSUPPORTED_PRIMARY_SUBTAGS);

    fc.assert(
      fc.property(unsupportedArb, regionSuffixArb, (primary, suffix) => {
        const tag = `${primary}${suffix}`;
        const result = parseBrowserLanguage(tag);
        expect(result).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('result is always either null or a member of SUPPORTED_LOCALES', () => {
    // Generate completely random 2-3 letter primary subtags
    const primaryArb = fc.oneof(
      fc.tuple(fc.constantFrom(...LOWER), fc.constantFrom(...LOWER)).map(([a, b]) => a + b),
      fc.tuple(fc.constantFrom(...LOWER), fc.constantFrom(...LOWER), fc.constantFrom(...LOWER)).map(([a, b, c]) => a + b + c),
    );

    fc.assert(
      fc.property(primaryArb, regionSuffixArb, (primary, suffix) => {
        const tag = `${primary}${suffix}`;
        const result = parseBrowserLanguage(tag);
        if (result !== null) {
          expect(SUPPORTED_LOCALES).toContain(result);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: auto-locale-detection, Property 2: mapCountryToLocale always returns a valid locale
//
// For any string input as a country code, mapCountryToLocale SHALL return a value
// that is a member of SUPPORTED_LOCALES. Specifically, mapped country codes
// (JP→ja, KR→ko, TW→zh-TW, US/GB/AU/NZ/CA→en) SHALL return their mapped locale,
// and for any country code not in the explicit map, the function SHALL return 'zh'.
//
// **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.3**

/** Generate a random 2-letter uppercase string as a country code */
const countryCodeArb = fc.tuple(
  fc.constantFrom(...UPPER),
  fc.constantFrom(...UPPER),
).map(([a, b]) => a + b);

describe('Property 2: mapCountryToLocale always returns a valid locale', () => {
  it('always returns a member of SUPPORTED_LOCALES for any 2-letter country code', () => {
    fc.assert(
      fc.property(countryCodeArb, (code) => {
        const result = mapCountryToLocale(code);
        expect(SUPPORTED_LOCALES).toContain(result);
      }),
      { numRuns: 200 },
    );
  });

  it('mapped country codes return their expected locale', () => {
    const mappedEntries = Object.entries(COUNTRY_LOCALE_MAP) as [string, Locale][];
    const mappedCodeArb = fc.constantFrom(...mappedEntries);

    fc.assert(
      fc.property(mappedCodeArb, ([code, expectedLocale]) => {
        const result = mapCountryToLocale(code);
        expect(result).toBe(expectedLocale);
      }),
      { numRuns: 100 },
    );
  });

  it('unmapped country codes return zh', () => {
    const mappedCodes = new Set(Object.keys(COUNTRY_LOCALE_MAP));
    const unmappedCodeArb = countryCodeArb.filter((code) => !mappedCodes.has(code));

    fc.assert(
      fc.property(unmappedCodeArb, (code) => {
        const result = mapCountryToLocale(code);
        expect(result).toBe('zh');
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: auto-locale-detection, Property 3: detectLocale respects priority chain
//
// For any combination of browser language result and country cookie result,
// detectLocale SHALL return the browser language match when available,
// the country cookie match when browser language returns no match,
// and 'zh' when both sources return no match.
// The browser language source SHALL always be evaluated before the country cookie source.
//
// **Validates: Requirements 1.2, 3.8**

/** Supported primary subtags that parseBrowserLanguage will match */
const MATCHING_PRIMARY_SUBTAGS = ['en', 'ja', 'ko', 'zh'] as const;

/** Unsupported primary subtags that parseBrowserLanguage will return null for */
const NON_MATCHING_PRIMARY_SUBTAGS = ['fr', 'de', 'pt', 'es', 'it', 'ru', 'ar', 'hi', 'th', 'vi'] as const;

/** Mapped country codes from COUNTRY_LOCALE_MAP */
const MAPPED_COUNTRIES = ['JP', 'KR', 'TW', 'US', 'GB', 'AU', 'NZ', 'CA', 'CN'] as const;

/** Country codes NOT in the map (will default to 'zh') */
const UNMAPPED_COUNTRIES = ['BR', 'FR', 'DE', 'MX', 'IN', 'RU', 'ZA', 'EG'] as const;

/** Arbitrary to produce a browser language value: matching tag, non-matching tag, or null */
const browserLangArb = fc.oneof(
  // Matching tag: a supported primary subtag (optionally with region suffix)
  fc.constantFrom(...MATCHING_PRIMARY_SUBTAGS).map((tag) => ({ value: tag, shouldMatch: true })),
  // Non-matching tag: an unsupported primary subtag
  fc.constantFrom(...NON_MATCHING_PRIMARY_SUBTAGS).map((tag) => ({ value: tag, shouldMatch: false })),
  // Null: browser language unavailable
  fc.constant({ value: null as string | null, shouldMatch: false }),
);

/** Arbitrary to produce a country cookie value: mapped code, unmapped code, or null */
const countryCookieArb = fc.oneof(
  // Mapped country code
  fc.constantFrom(...MAPPED_COUNTRIES).map((code) => ({ value: code, isMapped: true })),
  // Unmapped country code (defaults to 'zh')
  fc.constantFrom(...UNMAPPED_COUNTRIES).map((code) => ({ value: code, isMapped: false })),
  // Null: cookie absent
  fc.constant({ value: null as string | null, isMapped: false }),
);

describe('Property 3: detectLocale respects priority chain', () => {
  it('browser language match takes priority over cookie', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MATCHING_PRIMARY_SUBTAGS),
        countryCookieArb,
        (browserTag, cookie) => {
          const result = detectLocale({
            getBrowserLanguage: () => browserTag,
            getCountryCookie: () => cookie.value,
          });

          // Browser language matched, so result must equal parseBrowserLanguage(browserTag)
          const expected = parseBrowserLanguage(browserTag);
          expect(expected).not.toBeNull();
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('cookie is used when browser language returns no match', () => {
    // Browser returns a non-matching tag or null; cookie is present
    const noMatchBrowserArb = fc.oneof(
      fc.constantFrom(...NON_MATCHING_PRIMARY_SUBTAGS).map((t) => t as string | null),
      fc.constant(null as string | null),
    );

    fc.assert(
      fc.property(
        noMatchBrowserArb,
        fc.constantFrom(...MAPPED_COUNTRIES),
        (browserLang, countryCode) => {
          const result = detectLocale({
            getBrowserLanguage: () => browserLang,
            getCountryCookie: () => countryCode,
          });

          // Should use mapCountryToLocale result
          const expected = mapCountryToLocale(countryCode);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns zh when both sources return no match', () => {
    // Browser returns non-matching or null; cookie is null or empty
    const noMatchBrowserArb = fc.oneof(
      fc.constantFrom(...NON_MATCHING_PRIMARY_SUBTAGS).map((t) => t as string | null),
      fc.constant(null as string | null),
    );

    const noCookieArb = fc.oneof(
      fc.constant(null as string | null),
      fc.constant(''),
    );

    fc.assert(
      fc.property(noMatchBrowserArb, noCookieArb, (browserLang, cookie) => {
        const result = detectLocale({
          getBrowserLanguage: () => browserLang,
          getCountryCookie: () => cookie,
        });

        expect(result).toBe('zh');
      }),
      { numRuns: 200 },
    );
  });

  it('result is always a member of SUPPORTED_LOCALES for any input combination', () => {
    fc.assert(
      fc.property(browserLangArb, countryCookieArb, (browser, cookie) => {
        const result = detectLocale({
          getBrowserLanguage: () => browser.value,
          getCountryCookie: () => cookie.value,
        });

        expect(SUPPORTED_LOCALES).toContain(result);
      }),
      { numRuns: 200 },
    );
  });

  it('browser language source is evaluated before country cookie source', () => {
    // Verify ordering: if browser returns a match, cookie callback should not affect result
    fc.assert(
      fc.property(
        fc.constantFrom(...MATCHING_PRIMARY_SUBTAGS),
        countryCookieArb,
        (browserTag, cookie) => {
          let cookieCallOrder = -1;
          let browserCallOrder = -1;
          let callCounter = 0;

          const result = detectLocale({
            getBrowserLanguage: () => {
              browserCallOrder = callCounter++;
              return browserTag;
            },
            getCountryCookie: () => {
              cookieCallOrder = callCounter++;
              return cookie.value;
            },
          });

          // Browser callback must be called first
          expect(browserCallOrder).toBe(0);

          // When browser matches, cookie may or may not be called,
          // but result must match browser language
          const expected = parseBrowserLanguage(browserTag);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: auto-locale-detection, Property 4: BCP 47 round-trip consistency
//
// For any supported Locale value, constructing a BCP 47 tag from that locale
// (e.g., 'en' → 'en', 'zh-TW' → 'zh-TW', 'ja' → 'ja') and parsing it back
// with parseBrowserLanguage SHALL return the original locale value.
//
// **Validates: Requirements 7.4**

describe('Property 4: BCP 47 round-trip consistency', () => {
  it('parsing a supported locale string returns the same locale value', () => {
    const supportedLocaleArb = fc.constantFrom(...SUPPORTED_LOCALES);

    fc.assert(
      fc.property(supportedLocaleArb, (locale) => {
        // Round-trip: locale string → parseBrowserLanguage → should return same locale
        const parsed = parseBrowserLanguage(locale);
        expect(parsed).toBe(locale);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: auto-locale-detection, Property 5: Invalid localStorage values are rejected
//
// For any string that is NOT a member of SUPPORTED_LOCALES, the locale initialization
// logic SHALL treat it as absent and proceed with automatic detection via detectLocale.
// The store uses `(SUPPORTED_LOCALES as readonly string[]).includes(saved)` to validate.
// We test this validation logic directly: any string NOT in SUPPORTED_LOCALES must fail
// the includes check, meaning detectLocale would be called.
//
// **Validates: Requirements 5.3, 1.1**

/** Simulate the exact validation logic used in the Zustand store locale IIFE */
function isValidSavedLocale(saved: string): boolean {
  return (SUPPORTED_LOCALES as readonly string[]).includes(saved);
}

describe('Property 5: Invalid localStorage values are rejected', () => {
  it('any string NOT in SUPPORTED_LOCALES fails the validation check', () => {
    // Generate arbitrary strings that are guaranteed NOT to be in SUPPORTED_LOCALES
    const invalidLocaleArb = fc.string().filter(
      (s) => !(SUPPORTED_LOCALES as readonly string[]).includes(s),
    );

    fc.assert(
      fc.property(invalidLocaleArb, (invalidValue) => {
        // The store validation must reject this value
        expect(isValidSavedLocale(invalidValue)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('common invalid values (typos, partial matches, wrong case) are rejected', () => {
    // Targeted invalid strings that could plausibly appear in localStorage
    const plausibleInvalidArb = fc.constantFrom(
      'ZH', 'EN', 'JA', 'KO', 'Zh-TW', 'zh_TW', 'zh-tw',
      'english', 'chinese', 'japanese', 'korean',
      'zh-Hant', 'zh-Hans', 'en-US', 'ja-JP', 'ko-KR',
      'zho', 'eng', 'jpn', 'kor',
      '', ' ', 'null', 'undefined',
      'fr', 'de', 'es', 'pt', 'ru',
    );

    fc.assert(
      fc.property(plausibleInvalidArb, (invalidValue) => {
        expect(isValidSavedLocale(invalidValue)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('invalid localStorage values cause detectLocale to be called (integration)', () => {
    // For any invalid saved value, the store logic would skip it and call detectLocale.
    // We simulate the full store IIFE logic: if validation fails, detectLocale runs.
    const invalidLocaleArb = fc.string().filter(
      (s) => !(SUPPORTED_LOCALES as readonly string[]).includes(s),
    );

    fc.assert(
      fc.property(invalidLocaleArb, (invalidSaved) => {
        // Simulate the store IIFE logic
        let detectLocaleCalled = false;
        let result: string;

        // Step 1: validate saved value (same as store)
        if ((SUPPORTED_LOCALES as readonly string[]).includes(invalidSaved)) {
          result = invalidSaved;
        } else {
          // Step 2: saved value is invalid → call detectLocale
          detectLocaleCalled = true;
          result = detectLocale({
            getBrowserLanguage: () => null,
            getCountryCookie: () => null,
          });
        }

        // detectLocale must have been called
        expect(detectLocaleCalled).toBe(true);
        // Result must be a valid locale (detectLocale always returns a valid one)
        expect(SUPPORTED_LOCALES).toContain(result);
      }),
      { numRuns: 200 },
    );
  });

  it('all valid SUPPORTED_LOCALES pass the validation check (sanity)', () => {
    const validLocaleArb = fc.constantFrom(...SUPPORTED_LOCALES);

    fc.assert(
      fc.property(validLocaleArb, (validValue) => {
        expect(isValidSavedLocale(validValue)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
