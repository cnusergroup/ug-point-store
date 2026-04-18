/**
 * Taiwan UG date parser module.
 *
 * Parses Chinese and mixed-format date strings into YYYY-MM-DD format.
 * Used by the Taiwan UG website scraper to normalize event dates.
 *
 * Supported formats:
 * - Chinese: "3月12日(四)19:00-21:00"
 * - English: "February 7, 2026 13:30~18:00"
 * - Pipe-separated: "1月29日(三) | 19:30~21:00"
 * - ISO-like: "2024-03-12"
 */

/** Map of English month names (lowercase) to 1-based month numbers */
const ENGLISH_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * Pad a number to 2 digits with leading zero.
 */
function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Infer the year for a month/day that has no explicit year.
 *
 * Logic: use the reference year. If the resulting date is more than 2 months
 * in the past relative to referenceDate, assume it belongs to next year.
 */
function inferYear(month: number, day: number, referenceDate: Date): number {
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth() + 1; // 1-based
  const refDay = referenceDate.getDate();

  // Calculate how many months the candidate date is behind the reference date
  // within the same year
  const candidateMonths = month;
  const referenceMonths = refMonth;

  // Difference in months (negative means candidate is in the past)
  let monthDiff = candidateMonths - referenceMonths;
  if (monthDiff === 0) {
    // Same month — check day
    if (day < refDay) {
      // Same month but day already passed — still current year (within 0 months)
      monthDiff = 0;
    }
  }

  // If the date is more than 2 months in the past, use next year
  if (monthDiff < -2) {
    return refYear + 1;
  }

  // Edge case: month diff is exactly -2, check the day
  if (monthDiff === -2 && day < refDay) {
    return refYear + 1;
  }

  return refYear;
}

/**
 * Validate that a year/month/day combination forms a real date.
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Use Date constructor to validate — month is 0-based in JS Date
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Try to parse an ISO-like date string: "2024-03-12" or "2024-03-12T..."
 */
function tryParseISO(dateStr: string): string | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s|T|$)/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidDate(year, month, day)) return null;
  return formatDate(year, month, day);
}

/**
 * Try to parse a Chinese date format: "3月12日", "3月12日(四)19:00-21:00"
 * Also handles pipe-separated: "1月29日(三) | 19:30~21:00"
 */
function tryParseChinese(dateStr: string, referenceDate: Date): string | null {
  // Strip everything after pipe separator if present
  const beforePipe = dateStr.split('|')[0].trim();

  // Match Chinese date pattern: X月Y日
  const match = beforePipe.match(/(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);

  // Check for an explicit year before the month (e.g., "2024年3月12日")
  const yearMatch = beforePipe.match(/(\d{4})年/);
  const year = yearMatch
    ? parseInt(yearMatch[1], 10)
    : inferYear(month, day, referenceDate);

  if (!isValidDate(year, month, day)) return null;
  return formatDate(year, month, day);
}

/**
 * Try to parse an English date format: "February 7, 2026 13:30~18:00"
 * Also handles: "February 7, 2026", "Feb 7, 2026"
 */
function tryParseEnglish(dateStr: string, referenceDate: Date): string | null {
  // Match pattern: MonthName Day, Year (with optional time after)
  const match = dateStr.match(
    /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/,
  );
  if (!match) return null;

  const monthName = match[1].toLowerCase();
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  const month = ENGLISH_MONTHS[monthName];
  if (!month) return null;

  if (!isValidDate(year, month, day)) return null;
  return formatDate(year, month, day);
}

/**
 * Try to parse English date without explicit year: "February 7 13:30~18:00"
 */
function tryParseEnglishNoYear(dateStr: string, referenceDate: Date): string | null {
  // Match pattern: MonthName Day (no year, possibly followed by time)
  // But NOT if there's a year (4 digits) right after the day
  const match = dateStr.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:\s|,|$)/,
  );
  if (!match) return null;

  const monthName = match[1].toLowerCase();
  const day = parseInt(match[2], 10);

  const month = ENGLISH_MONTHS[monthName];
  if (!month) return null;

  // Check this isn't actually a full English date with year
  if (/[A-Za-z]+\s+\d{1,2},?\s+\d{4}/.test(dateStr)) return null;

  const year = inferYear(month, day, referenceDate);

  if (!isValidDate(year, month, day)) return null;
  return formatDate(year, month, day);
}

/**
 * Parse a Chinese/mixed-format date string into YYYY-MM-DD.
 * Returns null if the string cannot be parsed.
 *
 * Supported formats:
 * - Chinese: "3月12日(四)19:00-21:00", "1月29日(三) | 19:30~21:00"
 * - English: "February 7, 2026 13:30~18:00"
 * - ISO-like: "2024-03-12"
 *
 * Year inference: If no year is present, uses current year.
 * If the resulting date is more than 2 months in the past, uses next year.
 *
 * @param dateStr - The date string to parse
 * @param referenceDate - Reference date for year inference (defaults to now)
 * @returns YYYY-MM-DD string on success, null on failure
 */
export function parseTaiwanDate(dateStr: string, referenceDate?: Date): string | null {
  if (!dateStr || typeof dateStr !== 'string') {
    console.warn('[taiwan-date-parser] Invalid input:', dateStr);
    return null;
  }

  const trimmed = dateStr.trim();
  if (!trimmed) {
    console.warn('[taiwan-date-parser] Empty date string');
    return null;
  }

  const ref = referenceDate ?? new Date();

  // Try each parser in order of specificity
  const result =
    tryParseISO(trimmed) ??
    tryParseChinese(trimmed, ref) ??
    tryParseEnglish(trimmed, ref) ??
    tryParseEnglishNoYear(trimmed, ref);

  if (!result) {
    console.warn('[taiwan-date-parser] Unable to parse date string:', trimmed);
    return null;
  }

  return result;
}
