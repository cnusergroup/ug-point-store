import { parseQuarter, quarterToDateRange, getCurrentQuarter } from '../reports/quarter-utils';

// Re-exported for convenience so consumers of this module don't need to reach into
// ../reports/quarter-utils directly. These are unmodified, verbatim re-exports.
export { parseQuarter, quarterToDateRange, getCurrentQuarter };

const QUARTER_REGEX = /^(\d{4})-Q([1-4])$/;

/**
 * Returns the quarter immediately before the given quarter, rolling the year
 * backward when the given quarter is Q1 (e.g. "2026-Q1" -> "2025-Q4").
 *
 * Assumes `quarter` is a well-formed "YYYY-QN" string.
 */
export function getPreviousQuarter(quarter: string): string {
  const match = QUARTER_REGEX.exec(quarter);
  if (!match) {
    throw new Error(`Invalid quarter format: ${quarter}`);
  }

  const year = parseInt(match[1], 10);
  const q = parseInt(match[2], 10) as 1 | 2 | 3 | 4;

  if (q === 1) {
    return `${year - 1}-Q4`;
  }

  return `${year}-Q${q - 1}`;
}

/**
 * Computes the "YYYY-QN" quarter string containing the given date, using the
 * same UTC-based calculation as getCurrentQuarter (which is hardcoded to `new Date()`).
 */
function quarterOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const q = Math.floor(month / 3) + 1;
  return `${year}-Q${q}`;
}

/**
 * The quarter an *automatic* fixed-date run should evaluate: the quarter
 * immediately preceding `now`'s current quarter.
 *
 * Req 1.1-1.4: a run on Apr 1 evaluates Q1, Jul 1 evaluates Q2, Oct 1 evaluates Q3,
 * Jan 1 evaluates Q4 of the previous year — in every case, this is exactly the
 * quarter preceding the one containing `now`.
 */
export function resolveAutoDetectionQuarter(now: Date = new Date()): string {
  return getPreviousQuarter(quarterOf(now));
}

export type DetectionQuarterResolution =
  | { valid: true; quarter: string }
  | { valid: false; error: { code: string; message: string } };

/**
 * Resolves the Detection_Quarter for a job run.
 *
 * - explicitQuarter provided (manual trigger, Req 1.6): validated via parseQuarter
 *   (format + not-future) and returned as-is — NOT checked against the fixed-date
 *   mapping that governs automatic runs.
 * - explicitQuarter omitted (automatic run): resolveAutoDetectionQuarter(now).
 */
export function resolveDetectionQuarter(
  explicitQuarter: string | undefined,
  now?: Date,
): DetectionQuarterResolution {
  if (explicitQuarter === undefined) {
    return { valid: true, quarter: resolveAutoDetectionQuarter(now) };
  }

  const result = parseQuarter(explicitQuarter);
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true, quarter: explicitQuarter };
}
