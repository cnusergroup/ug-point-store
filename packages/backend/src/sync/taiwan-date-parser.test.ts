import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseTaiwanDate } from './taiwan-date-parser';

// Use a fixed reference date for deterministic tests
const REF_DATE = new Date(2025, 5, 15); // June 15, 2025

describe('parseTaiwanDate', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('Chinese format', () => {
    it('parses "3月12日(四)19:00-21:00"', () => {
      // March is >2 months before June reference, so infers next year
      expect(parseTaiwanDate('3月12日(四)19:00-21:00', REF_DATE)).toBe('2026-03-12');
    });

    it('parses "12月25日(三)18:00-20:00"', () => {
      expect(parseTaiwanDate('12月25日(三)18:00-20:00', REF_DATE)).toBe('2025-12-25');
    });

    it('parses single-digit month and day "1月5日"', () => {
      expect(parseTaiwanDate('1月5日', REF_DATE)).toBe('2026-01-05');
    });

    it('parses with explicit year "2024年3月12日"', () => {
      expect(parseTaiwanDate('2024年3月12日', REF_DATE)).toBe('2024-03-12');
    });
  });

  describe('English format', () => {
    it('parses "February 7, 2026 13:30~18:00"', () => {
      expect(parseTaiwanDate('February 7, 2026 13:30~18:00', REF_DATE)).toBe('2026-02-07');
    });

    it('parses "March 15, 2025"', () => {
      expect(parseTaiwanDate('March 15, 2025', REF_DATE)).toBe('2025-03-15');
    });

    it('parses "December 1, 2024"', () => {
      expect(parseTaiwanDate('December 1, 2024', REF_DATE)).toBe('2024-12-01');
    });
  });

  describe('pipe-separated format', () => {
    it('parses "1月29日(三) | 19:30~21:00"', () => {
      expect(parseTaiwanDate('1月29日(三) | 19:30~21:00', REF_DATE)).toBe('2026-01-29');
    });

    it('parses "6月10日(二) | 19:00~21:00"', () => {
      expect(parseTaiwanDate('6月10日(二) | 19:00~21:00', REF_DATE)).toBe('2025-06-10');
    });
  });

  describe('ISO-like format', () => {
    it('parses "2024-03-12"', () => {
      expect(parseTaiwanDate('2024-03-12', REF_DATE)).toBe('2024-03-12');
    });

    it('parses "2025-01-01"', () => {
      expect(parseTaiwanDate('2025-01-01', REF_DATE)).toBe('2025-01-01');
    });
  });

  describe('year inference', () => {
    it('uses current year when date is within 2 months in the past', () => {
      // Reference: June 15, 2025 → April 15 is 2 months ago, should be current year
      expect(parseTaiwanDate('5月1日', REF_DATE)).toBe('2025-05-01');
    });

    it('uses next year when date is more than 2 months in the past', () => {
      // Reference: June 15, 2025 → March is 3 months ago, should be next year
      expect(parseTaiwanDate('3月1日', REF_DATE)).toBe('2026-03-01');
    });

    it('uses next year for January when reference is June', () => {
      // Reference: June 15, 2025 → January is 5 months ago, should be next year
      expect(parseTaiwanDate('1月5日', REF_DATE)).toBe('2026-01-05');
    });

    it('uses current year for future months', () => {
      // Reference: June 15, 2025 → September is in the future
      expect(parseTaiwanDate('9月20日', REF_DATE)).toBe('2025-09-20');
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parseTaiwanDate('', REF_DATE)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns null for random text', () => {
      expect(parseTaiwanDate('hello world', REF_DATE)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns null for numbers only', () => {
      expect(parseTaiwanDate('12345', REF_DATE)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns null for null-like input', () => {
      expect(parseTaiwanDate(null as any, REF_DATE)).toBeNull();
      expect(parseTaiwanDate(undefined as any, REF_DATE)).toBeNull();
    });

    it('returns null for invalid date values', () => {
      // February 30 doesn't exist
      expect(parseTaiwanDate('2月30日', REF_DATE)).toBeNull();
    });

    it('returns null for invalid ISO date', () => {
      expect(parseTaiwanDate('2024-13-01', REF_DATE)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles whitespace around the string', () => {
      // March is >2 months before June reference, so infers next year
      expect(parseTaiwanDate('  3月12日  ', REF_DATE)).toBe('2026-03-12');
    });

    it('handles December 31 near year boundary', () => {
      // Reference: June 15, 2025 → December is in the future, current year
      expect(parseTaiwanDate('12月31日', REF_DATE)).toBe('2025-12-31');
    });

    it('handles leap year February 29', () => {
      expect(parseTaiwanDate('2024-02-29', REF_DATE)).toBe('2024-02-29');
    });

    it('rejects non-leap year February 29', () => {
      expect(parseTaiwanDate('2025-02-29', REF_DATE)).toBeNull();
    });
  });
});
