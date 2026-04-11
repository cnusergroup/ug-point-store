import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  },
  getStorageSync: vi.fn(() => ''),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
}));

import { zh } from './zh';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import { zhTW } from './zh-TW';
import { interpolate } from './index';

/**
 * Recursively extract all leaf-node key paths from a nested object.
 * e.g. { a: { b: 'x', c: 'y' }, d: 'z' } => ['a.b', 'a.c', 'd']
 */
function extractKeyPaths(obj: Record<string, any>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      paths.push(...extractKeyPaths(obj[key], fullKey));
    } else {
      paths.push(fullKey);
    }
  }
  return paths;
}

const dictMap: Record<string, Record<string, any>> = { en, ja, ko, 'zh-TW': zhTW };

// Feature: i18n-multi-language, Property 1: 翻译字典键集完整性
// Validates: Requirements 1.1, 5.1
describe('Feature: i18n-multi-language, Property 1: 翻译字典键集完整性', () => {
  it('non-zh locale dictionaries have identical key paths to zh dictionary', () => {
    const zhKeys = new Set(extractKeyPaths(zh as any));

    fc.assert(
      fc.property(
        fc.constantFrom('en', 'ja', 'ko', 'zh-TW'),
        (locale) => {
          const dict = dictMap[locale];
          const localeKeys = new Set(extractKeyPaths(dict as any));
          expect(localeKeys).toEqual(zhKeys);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: i18n-multi-language, Property 4: 参数插值正确性
// Validates: Requirements 7.1, 7.3
describe('Feature: i18n-multi-language, Property 4: 参数插值正确性', () => {
  it('interpolate replaces all matching placeholders and preserves non-placeholder parts', () => {
    // Arbitrary for a param key (word characters only, matching \w+)
    const paramKeyArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,9}$/);
    // Arbitrary for a param value (string or number)
    const paramValueArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.includes('{') && !s.includes('}')),
      fc.integer({ min: -10000, max: 10000 }),
    );

    fc.assert(
      fc.property(
        // Generate 1-5 param key-value pairs
        fc.array(fc.tuple(paramKeyArb, paramValueArb), { minLength: 1, maxLength: 5 }),
        // Generate static text segments (no braces)
        fc.array(
          fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.includes('{') && !s.includes('}')),
          { minLength: 1, maxLength: 6 },
        ),
        (paramPairs, textSegments) => {
          // Deduplicate keys
          const paramsMap = new Map<string, string | number>();
          for (const [k, v] of paramPairs) {
            paramsMap.set(k, v);
          }
          const keys = [...paramsMap.keys()];
          const params: Record<string, string | number> = {};
          for (const [k, v] of paramsMap) {
            params[k] = v;
          }

          // Build a template by interleaving text segments with placeholders
          let template = '';
          let expected = '';
          for (let i = 0; i < textSegments.length; i++) {
            template += textSegments[i];
            expected += textSegments[i];
            if (i < keys.length) {
              template += `{${keys[i]}}`;
              expected += String(params[keys[i]]);
            }
          }

          const result = interpolate(template, params);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('interpolate preserves placeholders when params are missing', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,9}$/),
        fc.string({ minLength: 0, maxLength: 20 }).filter((s) => !s.includes('{') && !s.includes('}')),
        (key, prefix) => {
          const template = `${prefix}{${key}}`;
          // Call with empty params — placeholder should remain
          const result = interpolate(template, {});
          expect(result).toBe(template);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: i18n-multi-language, Property 5: 翻译字典 JSON 往返一致性
// Validates: Requirements 1.6
describe('Feature: i18n-multi-language, Property 5: 翻译字典 JSON 往返一致性', () => {
  it('all dictionaries survive JSON round-trip without data loss', () => {
    const allDicts = [
      { name: 'zh', dict: zh },
      { name: 'en', dict: en },
      { name: 'ja', dict: ja },
      { name: 'ko', dict: ko },
      { name: 'zh-TW', dict: zhTW },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...allDicts),
        ({ dict }) => {
          const roundTripped = JSON.parse(JSON.stringify(dict));
          expect(roundTripped).toEqual(dict);
        },
      ),
      { numRuns: 100 },
    );
  });
});
