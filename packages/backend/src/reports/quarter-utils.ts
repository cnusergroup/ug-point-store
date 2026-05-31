/** 季度格式验证结果 */
export type QuarterValidationResult =
  | { valid: true; year: number; quarter: 1 | 2 | 3 | 4 }
  | { valid: false; error: { code: string; message: string } };

/** 季度日期范围（ISO 8601 UTC） */
export interface QuarterDateRange {
  start: string;
  end: string;
}

const QUARTER_REGEX = /^\d{4}-Q[1-4]$/;

/**
 * 解析并验证季度字符串。
 * 格式: YYYY-QN (N = 1|2|3|4)
 * 如果格式不匹配返回 INVALID_QUARTER_FORMAT 错误。
 * 如果是未来季度（季度开始时间 > 当前时间）返回 FUTURE_QUARTER 错误。
 */
export function parseQuarter(quarter: string): QuarterValidationResult {
  if (!QUARTER_REGEX.test(quarter)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_QUARTER_FORMAT',
        message: '季度格式无效，请使用 YYYY-QN 格式',
      },
    };
  }

  const year = parseInt(quarter.substring(0, 4), 10);
  const q = parseInt(quarter.charAt(6), 10) as 1 | 2 | 3 | 4;

  // Check if the quarter is in the future (quarter start > now)
  const { start } = quarterToDateRange(year, q);
  const quarterStart = new Date(start);
  const now = new Date();

  if (quarterStart > now) {
    return {
      valid: false,
      error: {
        code: 'FUTURE_QUARTER',
        message: '不能查询未来季度',
      },
    };
  }

  return { valid: true, year, quarter: q };
}

/**
 * 获取当前日历季度字符串。
 * 返回格式: "YYYY-QN"
 */
export function getCurrentQuarter(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const q = Math.floor(month / 3) + 1;
  return `${year}-Q${q}`;
}

/**
 * 将季度转换为日期范围（UTC）。
 * Q1: Jan 1 00:00:00.000Z → Mar 31 23:59:59.999Z
 * Q2: Apr 1 00:00:00.000Z → Jun 30 23:59:59.999Z
 * Q3: Jul 1 00:00:00.000Z → Sep 30 23:59:59.999Z
 * Q4: Oct 1 00:00:00.000Z → Dec 31 23:59:59.999Z
 */
export function quarterToDateRange(year: number, quarter: 1 | 2 | 3 | 4): QuarterDateRange {
  const startMonth = (quarter - 1) * 3; // 0-indexed: Q1=0, Q2=3, Q3=6, Q4=9

  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));

  // End is last millisecond of the last day of the quarter
  // Next quarter's first day minus 1ms
  const endMonth = startMonth + 3; // month after the quarter ends
  const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0) - 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * 生成可选季度列表（从 2024-Q1 到当前季度）。
 * 返回降序排列（最近的在前）。
 */
export function getAvailableQuarters(): string[] {
  const current = getCurrentQuarter();
  const currentYear = parseInt(current.substring(0, 4), 10);
  const currentQ = parseInt(current.charAt(6), 10);

  const quarters: string[] = [];
  const startYear = 2026;
  const startQ = 1;

  for (let year = startYear; year <= currentYear; year++) {
    const qStart = year === startYear ? startQ : 1;
    const qEnd = year === currentYear ? currentQ : 4;
    for (let q = qStart; q <= qEnd; q++) {
      quarters.push(`${year}-Q${q}`);
    }
  }

  // Reverse for descending order (most recent first)
  return quarters.reverse();
}
