import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getCurrentQuarter, quarterToDateRange } from '../reports/quarter-utils';
import { getPreviousQuarter, resolveAutoDetectionQuarter, resolveDetectionQuarter } from './quarter';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary year in a reasonable range around "now" for auto-detection tests. */
const yearArb = fc.integer({ min: 2020, max: 2035 });

/** Arbitrary quarter number 1-4. */
const quarterNumArb = fc.constantFrom<1 | 2 | 3 | 4>(1, 2, 3, 4);

/** Arbitrary point in time falling somewhere within the given year/quarter's date range. */
function dateWithinQuarter(year: number, quarter: 1 | 2 | 3 | 4): fc.Arbitrary<Date> {
  const { start, end } = quarterToDateRange(year, quarter);
  return fc.integer({ min: new Date(start).getTime(), max: new Date(end).getTime() }).map(
    (ts) => new Date(ts),
  );
}

// Current real-world quarter, used to constrain generated "explicit quarter" values to
// non-future quarters (parseQuarter's future check is against the real current time).
const currentQuarterStr = getCurrentQuarter();
const currentYear = parseInt(currentQuarterStr.substring(0, 4), 10);
const currentQ = parseInt(currentQuarterStr.charAt(6), 10) as 1 | 2 | 3 | 4;

/** Arbitrary well-formed, non-future "YYYY-QN" quarter string. */
const nonFutureQuarterArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 2020, max: currentYear }), quarterNumArb)
  .filter(([year, q]) => year < currentYear || q <= currentQ)
  .map(([year, q]) => `${year}-Q${q}`);

/** Arbitrary Date used as the "now" parameter, spanning a wide range unrelated to explicitQuarter. */
const arbitraryNowArb: fc.Arbitrary<Date> = fc
  .integer({ min: new Date('2015-01-01').getTime(), max: new Date('2040-12-31').getTime() })
  .map((ts) => new Date(ts));

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 1: Detection quarter resolution correctness
//
// For any current quarter string, resolveAutoDetectionQuarter returns exactly the quarter
// immediately preceding it, correctly rolling the year backward when the current quarter is
// Q1 (e.g. 2026-Q1 -> 2025-Q4). For any well-formed, non-future explicit quarter string,
// resolveDetectionQuarter(explicitQuarter, now) returns exactly that quarter for every
// possible value of now — it never rejects an explicit quarter for failing to match the
// fixed-date-to-quarter mapping that governs automatic runs.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6**
// ============================================================
describe('Property 1: Detection quarter resolution correctness', () => {
  it('resolveAutoDetectionQuarter returns exactly the quarter preceding now\'s current quarter', () => {
    fc.assert(
      fc.property(
        yearArb,
        quarterNumArb,
        (year, quarter) => {
          const now = fc.sample(dateWithinQuarter(year, quarter), 1)[0];
          const currentQuarterOfNow = `${year}-Q${quarter}`;
          const expected = getPreviousQuarter(currentQuarterOfNow);

          const result = resolveAutoDetectionQuarter(now);

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('correctly rolls the year backward when the current quarter is Q1', () => {
    fc.assert(
      fc.property(yearArb, (year) => {
        const now = fc.sample(dateWithinQuarter(year, 1), 1)[0];
        const result = resolveAutoDetectionQuarter(now);
        expect(result).toBe(`${year - 1}-Q4`);
      }),
      { numRuns: 100 },
    );
  });

  it('resolveDetectionQuarter returns exactly the explicit quarter for every possible now, never validating against the fixed-date mapping', () => {
    fc.assert(
      fc.property(nonFutureQuarterArb, arbitraryNowArb, (explicitQuarter, now) => {
        const result = resolveDetectionQuarter(explicitQuarter, now);
        expect(result).toEqual({ valid: true, quarter: explicitQuarter });
      }),
      { numRuns: 100 },
    );
  });

  it('resolveDetectionQuarter falls back to resolveAutoDetectionQuarter when explicitQuarter is omitted', () => {
    fc.assert(
      fc.property(yearArb, quarterNumArb, (year, quarter) => {
        const now = fc.sample(dateWithinQuarter(year, quarter), 1)[0];
        const result = resolveDetectionQuarter(undefined, now);
        expect(result).toEqual({ valid: true, quarter: resolveAutoDetectionQuarter(now) });
      }),
      { numRuns: 100 },
    );
  });
});
