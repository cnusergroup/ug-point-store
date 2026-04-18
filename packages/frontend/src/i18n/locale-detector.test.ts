import { describe, it, expect } from 'vitest';
import {
  parseBrowserLanguage,
  mapCountryToLocale,
  detectLocale,
} from './locale-detector';

/**
 * Unit tests for locale-detector module.
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.2, 7.3
 */

describe('parseBrowserLanguage', () => {
  it('maps en-US to en (primary subtag match)', () => {
    expect(parseBrowserLanguage('en-US')).toBe('en');
  });

  it('maps zh-TW to zh-TW (exact match)', () => {
    expect(parseBrowserLanguage('zh-TW')).toBe('zh-TW');
  });

  it('maps zh-HK to zh-TW (traditional Chinese variant)', () => {
    expect(parseBrowserLanguage('zh-HK')).toBe('zh-TW');
  });

  it('maps zh-Hant to zh-TW (traditional Chinese script)', () => {
    expect(parseBrowserLanguage('zh-Hant')).toBe('zh-TW');
  });

  it('maps zh-CN to zh (simplified Chinese variant)', () => {
    expect(parseBrowserLanguage('zh-CN')).toBe('zh');
  });

  it('maps zh-Hans to zh (simplified Chinese script)', () => {
    expect(parseBrowserLanguage('zh-Hans')).toBe('zh');
  });

  it('returns null for fr-FR (unsupported language)', () => {
    expect(parseBrowserLanguage('fr-FR')).toBeNull();
  });

  it('returns null for de (unsupported language)', () => {
    expect(parseBrowserLanguage('de')).toBeNull();
  });
});

describe('mapCountryToLocale', () => {
  it('maps JP to ja', () => {
    expect(mapCountryToLocale('JP')).toBe('ja');
  });

  it('maps KR to ko', () => {
    expect(mapCountryToLocale('KR')).toBe('ko');
  });

  it('maps TW to zh-TW', () => {
    expect(mapCountryToLocale('TW')).toBe('zh-TW');
  });

  it('maps US to en', () => {
    expect(mapCountryToLocale('US')).toBe('en');
  });

  it('maps GB to en', () => {
    expect(mapCountryToLocale('GB')).toBe('en');
  });

  it('maps CN to zh', () => {
    expect(mapCountryToLocale('CN')).toBe('zh');
  });

  it('maps BR to zh (unmapped country defaults to zh)', () => {
    expect(mapCountryToLocale('BR')).toBe('zh');
  });
});

describe('detectLocale', () => {
  it('returns browser language match when all sources available', () => {
    const result = detectLocale({
      getBrowserLanguage: () => 'en-US',
      getCountryCookie: () => 'JP',
    });
    expect(result).toBe('en');
  });

  it('falls back to country mapping when browser language has no match', () => {
    const result = detectLocale({
      getBrowserLanguage: () => 'fr-FR',
      getCountryCookie: () => 'JP',
    });
    expect(result).toBe('ja');
  });

  it('falls back to country mapping when browser language is null', () => {
    const result = detectLocale({
      getBrowserLanguage: () => null,
      getCountryCookie: () => 'KR',
    });
    expect(result).toBe('ko');
  });

  it('returns zh when no sources provide a match', () => {
    const result = detectLocale({
      getBrowserLanguage: () => null,
      getCountryCookie: () => null,
    });
    expect(result).toBe('zh');
  });

  it('returns zh when browser language is unsupported and cookie is empty', () => {
    const result = detectLocale({
      getBrowserLanguage: () => 'de',
      getCountryCookie: () => null,
    });
    expect(result).toBe('zh');
  });
});
