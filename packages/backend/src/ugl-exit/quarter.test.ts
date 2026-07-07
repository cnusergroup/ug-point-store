import { describe, it, expect } from 'vitest';
import { getPreviousQuarter, resolveAutoDetectionQuarter, resolveDetectionQuarter } from './quarter';

describe('resolveAutoDetectionQuarter - fixed-date-to-quarter mappings', () => {
  it('Apr 1 -> evaluates Q1 of the current year', () => {
    const now = new Date('2026-04-01T00:00:00.000Z');
    expect(resolveAutoDetectionQuarter(now)).toBe('2026-Q1');
  });

  it('Jul 1 -> evaluates Q2 of the current year', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    expect(resolveAutoDetectionQuarter(now)).toBe('2026-Q2');
  });

  it('Oct 1 -> evaluates Q3 of the current year', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    expect(resolveAutoDetectionQuarter(now)).toBe('2026-Q3');
  });

  it('Jan 1 -> evaluates Q4 of the previous year', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(resolveAutoDetectionQuarter(now)).toBe('2025-Q4');
  });
});

describe('getPreviousQuarter', () => {
  it('rolls Q1 back to Q4 of the previous year', () => {
    expect(getPreviousQuarter('2026-Q1')).toBe('2025-Q4');
  });

  it('rolls Q2/Q3/Q4 back within the same year', () => {
    expect(getPreviousQuarter('2026-Q2')).toBe('2026-Q1');
    expect(getPreviousQuarter('2026-Q3')).toBe('2026-Q2');
    expect(getPreviousQuarter('2026-Q4')).toBe('2026-Q3');
  });
});

describe('resolveDetectionQuarter - explicit quarter validation', () => {
  it('rejects a malformed explicit quarter with INVALID_QUARTER_FORMAT', () => {
    const result = resolveDetectionQuarter('2026-Q5');
    expect(result).toEqual({
      valid: false,
      error: { code: 'INVALID_QUARTER_FORMAT', message: expect.any(String) },
    });
  });

  it('rejects a non "YYYY-QN" string with INVALID_QUARTER_FORMAT', () => {
    const result = resolveDetectionQuarter('not-a-quarter');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_QUARTER_FORMAT');
    }
  });

  it('rejects a future explicit quarter with FUTURE_QUARTER', () => {
    const futureYear = new Date().getUTCFullYear() + 5;
    const result = resolveDetectionQuarter(`${futureYear}-Q1`);
    expect(result).toEqual({
      valid: false,
      error: { code: 'FUTURE_QUARTER', message: expect.any(String) },
    });
  });

  it('accepts a well-formed, non-future explicit quarter regardless of the fixed-date mapping', () => {
    // 2020-Q2 does not match the fixed-date mapping for any "now" — explicit quarters
    // bypass that mapping entirely (Req 1.6).
    const result = resolveDetectionQuarter('2020-Q2', new Date('2026-04-01T00:00:00.000Z'));
    expect(result).toEqual({ valid: true, quarter: '2020-Q2' });
  });

  it('falls back to resolveAutoDetectionQuarter when explicitQuarter is omitted', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const result = resolveDetectionQuarter(undefined, now);
    expect(result).toEqual({ valid: true, quarter: '2026-Q2' });
  });
});
