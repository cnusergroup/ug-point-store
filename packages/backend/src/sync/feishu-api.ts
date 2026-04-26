/**
 * Feishu Open API — 飞书开放平台 API 方式获取多维表格数据
 *
 * 使用 app_id + app_secret 获取 tenant_access_token，
 * 然后调用 Bitable API 读取表格记录，提取 activityType、ugName、topic、activityDate。
 */

// ============================================================
// Interfaces
// ============================================================

/** 从飞书 API 获取的活动记录（与 scraper 共用结构） */
export interface FeishuApiActivity {
  activityType: string;
  ugName: string;
  topic: string;
  activityDate: string;
  feishuRecordId?: string;  // feishu bitable record_id, used for deduplication
}

/** API 获取结果 */
export interface FeishuApiResult {
  success: boolean;
  activities?: FeishuApiActivity[];
  error?: { code: string; message: string };
}

/** 飞书 tenant_access_token 响应 */
interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

/** 飞书 Bitable 记录列表响应 */
interface BitableRecordsResponse {
  code: number;
  msg: string;
  data?: {
    has_more: boolean;
    page_token?: string;
    total: number;
    items: BitableRecord[];
  };
}

/** 飞书 Bitable 单条记录 */
interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

// ============================================================
// Constants
// ============================================================

const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_BITABLE_API_BASE = 'https://open.feishu.cn/open-apis/bitable/v1/apps';

// ============================================================
// API Implementation
// ============================================================

/**
 * Fetch activities from Feishu Bitable via Open API.
 *
 * @param appId - Feishu app_id
 * @param appSecret - Feishu app_secret
 * @param tableUrl - Feishu Bitable URL (used to extract app_token and table_id)
 */
export async function fetchFeishuBitableApi(
  appId: string,
  appSecret: string,
  tableUrl: string,
): Promise<FeishuApiResult> {
  // Validate inputs
  if (!appId || !appSecret) {
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: '飞书 API 凭证不完整（缺少 app_id 或 app_secret）' },
    };
  }

  if (!tableUrl) {
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: '飞书表格 URL 不能为空' },
    };
  }

  try {
    // 1. Extract app_token and table_id from URL
    const { appToken, tableId } = parseFeishuBitableUrl(tableUrl);
    if (!appToken) {
      return {
        success: false,
        error: { code: 'SYNC_FAILED', message: '无法从飞书表格 URL 中提取 app_token' },
      };
    }

    // 2. Get tenant_access_token
    console.log('[feishu-api] Requesting tenant_access_token...');
    const token = await getTenantAccessToken(appId, appSecret);

    // 3. Fetch all records (with pagination)
    console.log(`[feishu-api] Fetching records from app=${appToken}, table=${tableId || 'auto'}...`);
    const records = await fetchAllRecords(token, appToken, tableId);

    // 4. Extract activities from records, preserving feishu record_id
    const activities = records
      .map((record) => {
        const activity = extractActivityFromRecord(record);
        if (activity) {
          activity.feishuRecordId = record.record_id;
        }
        return activity;
      })
      .filter((a): a is FeishuApiActivity => a !== null);

    console.log(`[feishu-api] Extracted ${activities.length} activities from ${records.length} records`);
    return { success: true, activities };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[feishu-api] API fetch failed:', message);
    return {
      success: false,
      error: { code: 'SYNC_FAILED', message: `飞书 API 调用失败: ${message}` },
    };
  }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Parse a Feishu Bitable URL to extract app_token and table_id.
 *
 * URL patterns:
 * - https://xxx.feishu.cn/base/{appToken}?table={tableId}
 * - https://xxx.feishu.cn/base/{appToken}/{tableId}
 * - https://open.feishu.cn/open-apis/bitable/v1/apps/{appToken}/tables/{tableId}
 */
export function parseFeishuBitableUrl(url: string): { appToken: string; tableId: string } {
  let appToken = '';
  let tableId = '';

  try {
    const parsed = new URL(url);

    // Pattern: /base/{appToken} or /base/{appToken}/{tableId}
    const baseMatch = parsed.pathname.match(/\/base\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (baseMatch) {
      appToken = baseMatch[1];
      tableId = baseMatch[2] ?? '';
    }

    // Pattern: /bitable/v1/apps/{appToken}/tables/{tableId}
    const apiMatch = parsed.pathname.match(/\/apps\/([a-zA-Z0-9_-]+)(?:\/tables\/([a-zA-Z0-9_-]+))?/);
    if (!appToken && apiMatch) {
      appToken = apiMatch[1];
      tableId = apiMatch[2] ?? '';
    }

    // Check query params for table
    if (!tableId) {
      tableId = parsed.searchParams.get('table') ?? '';
    }
  } catch {
    // If URL parsing fails, try regex on raw string
    const rawMatch = url.match(/([a-zA-Z0-9_-]{10,})/);
    if (rawMatch) {
      appToken = rawMatch[1];
    }
  }

  return { appToken, tableId };
}

/**
 * Get tenant_access_token using app_id and app_secret.
 */
async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const response = await fetch(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!response.ok) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as TenantTokenResponse;

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${data.msg} (code: ${data.code})`);
  }

  return data.tenant_access_token;
}

/**
 * Fetch all records from a Bitable table, handling pagination.
 */
async function fetchAllRecords(
  token: string,
  appToken: string,
  tableId: string,
): Promise<BitableRecord[]> {
  const allRecords: BitableRecord[] = [];
  let pageToken: string | undefined;
  let hasMore = true;

  // If no tableId, we need to list tables first and use the first one
  const resolvedTableId = tableId || (await getFirstTableId(token, appToken));
  if (!resolvedTableId) {
    throw new Error('无法确定表格 ID，请在 URL 中指定 table 参数');
  }

  while (hasMore) {
    const url = new URL(`${FEISHU_BITABLE_API_BASE}/${appToken}/tables/${resolvedTableId}/records`);
    url.searchParams.set('page_size', '100');
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });

    if (!response.ok) {
      throw new Error(`Bitable API 请求失败: HTTP ${response.status}`);
    }

    const data = (await response.json()) as BitableRecordsResponse;

    if (data.code !== 0 || !data.data) {
      throw new Error(`Bitable API 错误: ${data.msg} (code: ${data.code})`);
    }

    allRecords.push(...data.data.items);
    hasMore = data.data.has_more;
    pageToken = data.data.page_token;
  }

  return allRecords;
}

/**
 * Get the first table ID from a Bitable app (when tableId is not provided in URL).
 */
async function getFirstTableId(token: string, appToken: string): Promise<string> {
  const url = `${FEISHU_BITABLE_API_BASE}/${appToken}/tables`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  if (!response.ok) {
    throw new Error(`获取表格列表失败: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    code: number;
    msg: string;
    data?: { items: { table_id: string; name: string }[] };
  };

  if (data.code !== 0 || !data.data?.items?.length) {
    throw new Error(`获取表格列表失败: ${data.msg}`);
  }

  return data.data.items[0].table_id;
}

/**
 * Extract a single activity from a Bitable record.
 */
function extractActivityFromRecord(record: BitableRecord): FeishuApiActivity | null {
  const fields = record.fields;

  // Filter by approval status — only include approved activities
  const approvalStatus = getFieldString(fields, [
    '审批状态', '审批', 'status', 'approval', '状态', '审核状态',
  ]);
  // Skip if approval status exists and is not "通过" / "已通过" / "approved"
  if (approvalStatus) {
    const lower = approvalStatus.toLowerCase();
    const isApproved = lower.includes('通过') || lower.includes('approved') || lower.includes('pass');
    if (!isApproved) {
      return null;
    }
  }

  const activityType = getFieldString(fields, [
    '活动类型', 'activityType', 'activity_type', 'type', '类型',
  ]);
  const ugName = getFieldString(fields, [
    '申请所属UG', '申请所属 UG', 'ugName', 'ug_name', 'UG', '所属UG', '所属 UG',
  ]);
  const topic = getFieldString(fields, [
    '活动主题', 'topic', 'title', '主题', '活动名称',
  ]);
  const activityDate = getFieldString(fields, [
    '活动日期', 'activityDate', 'activity_date', 'date', '日期',
  ]);

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
 * Get a string value from fields by trying multiple field names.
 * Handles Feishu's various field value formats.
 */
function getFieldString(fields: Record<string, unknown>, candidates: string[]): string {
  for (const name of candidates) {
    const value = fields[name];
    if (value === undefined || value === null) continue;

    // Plain string
    if (typeof value === 'string') return value.trim();

    // Number (e.g., timestamp)
    if (typeof value === 'number') return String(value);

    // Array of text segments: [{ text: "..." }]
    if (Array.isArray(value)) {
      const texts = value
        .map(v => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'text' in v) return String((v as Record<string, unknown>).text);
          return '';
        })
        .filter(Boolean);
      if (texts.length > 0) return texts.join('').trim();
    }

    // Object with text property
    if (typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
      return String((value as Record<string, unknown>).text).trim();
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
  return raw;
}

/**
 * Normalize date to ISO 8601 date format (YYYY-MM-DD).
 */
function normalizeDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const timestamp = Number(raw);
  if (!isNaN(timestamp) && timestamp > 1000000000) {
    const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    // Feishu timestamps represent dates in China timezone (UTC+8).
    // Using toISOString() would give UTC date which can be 1 day behind.
    const d = new Date(ms + 8 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  try {
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // ignore
  }

  return raw;
}
