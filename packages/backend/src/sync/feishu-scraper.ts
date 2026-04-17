/**
 * Feishu Bitable Web Scraping — 飞书多维表格公开分享链接抓取
 *
 * 访问飞书多维表格的公开分享链接，解析 HTML/JSON 响应，
 * 提取 activityType、ugName、topic、activityDate 四个字段。
 *
 * 注意：飞书页面结构可能变化，此实现为 best-effort。
 */

// ============================================================
// Interfaces
// ============================================================

/** 从飞书抓取的原始活动记录 */
export interface ScrapedActivity {
  activityType: string;
  ugName: string;
  topic: string;
  activityDate: string;
}

/** 抓取结果 */
export interface ScrapeResult {
  success: boolean;
  activities?: ScrapedActivity[];
  error?: { code: string; message: string };
}

// ============================================================
// Scraper Implementation
// ============================================================

/**
 * Scrape activities from a Feishu Bitable public share link.
 *
 * Strategy:
 * 1. Fetch the share page HTML
 * 2. Look for embedded JSON data (Feishu often embeds table data in script tags)
 * 3. Parse the JSON to extract activity records
 *
 * The Feishu Bitable share page typically embeds data in a script tag
 * with a pattern like `window.__INITIAL_STATE__` or similar JSON payload.
 */
export async function scrapeFeishuBitable(tableUrl: string): Promise<ScrapeResult> {
  if (!tableUrl || tableUrl.trim().length === 0) {
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: '飞书表格 URL 不能为空' },
    };
  }

  try {
    console.log(`[feishu-scraper] Fetching URL: ${tableUrl}`);

    const response = await fetch(tableUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PointsMall-Sync/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/json',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.error(`[feishu-scraper] HTTP ${response.status}: ${response.statusText}`);
      return {
        success: false,
        error: {
          code: 'SYNC_FAILED',
          message: `飞书页面请求失败: HTTP ${response.status}`,
        },
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    // Attempt 1: Response is JSON directly
    if (contentType.includes('application/json')) {
      return parseJsonResponse(body);
    }

    // Attempt 2: Extract embedded JSON from HTML
    return parseHtmlResponse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[feishu-scraper] Scrape failed:`, message);
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: `飞书数据抓取失败: ${message}` },
    };
  }
}

/**
 * Parse a JSON response body to extract activity records.
 */
function parseJsonResponse(body: string): ScrapeResult {
  try {
    const data = JSON.parse(body);
    const activities = extractActivitiesFromData(data);
    console.log(`[feishu-scraper] Parsed ${activities.length} activities from JSON response`);
    return { success: true, activities };
  } catch (err) {
    console.error('[feishu-scraper] Failed to parse JSON response:', err);
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: '飞书 JSON 响应解析失败' },
    };
  }
}

/**
 * Parse HTML response, looking for embedded JSON data in script tags.
 *
 * Common patterns in Feishu share pages:
 * - window.__INITIAL_STATE__ = {...}
 * - window.__NEXT_DATA__ = {...}
 * - <script id="__NEXT_DATA__" type="application/json">{...}</script>
 */
function parseHtmlResponse(html: string): ScrapeResult {
  // Pattern 1: window.__INITIAL_STATE__ = {...};
  const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/);
  if (initialStateMatch) {
    try {
      const data = JSON.parse(initialStateMatch[1]);
      const activities = extractActivitiesFromData(data);
      console.log(`[feishu-scraper] Parsed ${activities.length} activities from __INITIAL_STATE__`);
      return { success: true, activities };
    } catch {
      console.warn('[feishu-scraper] Failed to parse __INITIAL_STATE__');
    }
  }

  // Pattern 2: <script id="__NEXT_DATA__" ...>{...}</script>
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const activities = extractActivitiesFromData(data);
      console.log(`[feishu-scraper] Parsed ${activities.length} activities from __NEXT_DATA__`);
      return { success: true, activities };
    } catch {
      console.warn('[feishu-scraper] Failed to parse __NEXT_DATA__');
    }
  }

  // Pattern 3: Generic JSON object in script tags containing records/rows
  const jsonBlockMatch = html.match(/<script[^>]*>([\s\S]*?"records"[\s\S]*?)<\/script>/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1]);
      const activities = extractActivitiesFromData(data);
      console.log(`[feishu-scraper] Parsed ${activities.length} activities from generic script block`);
      return { success: true, activities };
    } catch {
      console.warn('[feishu-scraper] Failed to parse generic script block');
    }
  }

  console.error('[feishu-scraper] No recognizable data structure found in HTML');
  return {
    success: false,
    error: {
      code: 'SYNC_FAILED',
      message: '无法从飞书页面中提取活动数据，页面结构可能已变更',
    },
  };
}

/**
 * Extract activity records from a parsed data object.
 *
 * Handles multiple possible data structures:
 * - { records: [...] }
 * - { data: { records: [...] } }
 * - { props: { pageProps: { data: { records: [...] } } } }
 * - Array of records directly
 */
function extractActivitiesFromData(data: unknown): ScrapedActivity[] {
  const records = findRecordsArray(data);
  if (!records || !Array.isArray(records)) {
    return [];
  }

  const activities: ScrapedActivity[] = [];

  for (const record of records) {
    const activity = extractSingleActivity(record);
    if (activity) {
      activities.push(activity);
    }
  }

  return activities;
}

/**
 * Recursively search for a "records" or "rows" array in the data.
 */
function findRecordsArray(data: unknown, depth = 0): unknown[] | null {
  if (depth > 5) return null;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Direct records/rows array
  if (Array.isArray(obj.records)) return obj.records;
  if (Array.isArray(obj.rows)) return obj.rows;
  if (Array.isArray(obj.items)) return obj.items;

  // Nested data
  if (obj.data && typeof obj.data === 'object') {
    const result = findRecordsArray(obj.data, depth + 1);
    if (result) return result;
  }

  // Next.js props pattern
  if (obj.props && typeof obj.props === 'object') {
    const result = findRecordsArray(obj.props, depth + 1);
    if (result) return result;
  }
  if (obj.pageProps && typeof obj.pageProps === 'object') {
    const result = findRecordsArray(obj.pageProps, depth + 1);
    if (result) return result;
  }

  return null;
}

/**
 * Extract a single activity from a record object.
 *
 * Feishu Bitable records typically have a `fields` object with column values.
 * We look for common Chinese/English field names for the 4 required fields.
 */
function extractSingleActivity(record: unknown): ScrapedActivity | null {
  if (!record || typeof record !== 'object') return null;

  const obj = record as Record<string, unknown>;
  const fields = (obj.fields ?? obj) as Record<string, unknown>;

  // Filter by approval status — only include approved activities
  const approvalStatus = extractFieldValue(fields, [
    '审批状态', '审批', 'status', 'approval', '状态', '审核状态',
  ]);
  if (approvalStatus) {
    const lower = approvalStatus.toLowerCase();
    const isApproved = lower.includes('通过') || lower.includes('approved') || lower.includes('pass');
    if (!isApproved) {
      return null;
    }
  }

  // Field name candidates for each required field
  const activityType = extractFieldValue(fields, [
    '活动类型', 'activityType', 'activity_type', 'type', '类型',
  ]);
  const ugName = extractFieldValue(fields, [
    '申请所属UG', '申请所属 UG', 'ugName', 'ug_name', 'UG', '所属UG', '所属 UG', 'ug',
  ]);
  const topic = extractFieldValue(fields, [
    '活动主题', 'topic', 'title', '主题', '活动名称',
  ]);
  const activityDate = extractFieldValue(fields, [
    '活动日期', 'activityDate', 'activity_date', 'date', '日期',
  ]);

  // All 4 fields are required
  if (!activityType || !ugName || !topic || !activityDate) {
    return null;
  }

  return {
    activityType: normalizeActivityType(activityType),
    ugName,
    topic,
    activityDate: normalizeDate(activityDate),
  };
}

/**
 * Extract a field value by trying multiple possible field names.
 */
function extractFieldValue(fields: Record<string, unknown>, candidates: string[]): string {
  for (const name of candidates) {
    const value = fields[name];
    if (value !== undefined && value !== null) {
      // Feishu may wrap values in arrays or objects
      if (typeof value === 'string') return value.trim();
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === 'string') return first.trim();
        if (first && typeof first === 'object' && 'text' in first) {
          return String((first as Record<string, unknown>).text).trim();
        }
      }
      if (typeof value === 'number') return String(value);
    }
  }
  return '';
}

/**
 * Normalize activity type to "线上活动" or "线下活动".
 */
function normalizeActivityType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('线上') || lower.includes('online')) return '线上活动';
  if (lower.includes('线下') || lower.includes('offline')) return '线下活动';
  return raw; // Return as-is if unrecognized
}

/**
 * Normalize date to ISO 8601 date format (YYYY-MM-DD).
 */
function normalizeDate(raw: string): string {
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Try parsing as timestamp (milliseconds)
  const timestamp = Number(raw);
  if (!isNaN(timestamp) && timestamp > 1000000000) {
    // Could be seconds or milliseconds
    const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    return new Date(ms).toISOString().split('T')[0];
  }

  // Try parsing as Date string
  try {
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // ignore
  }

  return raw; // Return as-is if unparseable
}
