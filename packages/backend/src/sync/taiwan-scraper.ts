/**
 * Taiwan UG Website Scraper — 台灣 AWS 使用者社群網站抓取
 *
 * 從兩個台灣 AWS UG 網站抓取活動資料：
 * 1. tw.events.awsug.net — 伺服器端渲染 HTML，使用 cheerio 解析
 * 2. awsug.com.tw — SPA 網站，嘗試發現嵌入資料或 JSON API
 *
 * 注意：網站結構可能變化，此實現為 best-effort。
 */

import * as cheerio from 'cheerio';
import { parseTaiwanDate } from './taiwan-date-parser';

// ============================================================
// Interfaces
// ============================================================

/** 從網站抓取的原始活動記錄 */
export interface ScrapedEvent {
  title: string;
  date: string;          // YYYY-MM-DD
  location?: string;
  sourceUrl: string;
  isUpcoming: boolean;   // true if event is future/coming soon
}

/** 抓取結果 */
export interface ScrapeResult {
  success: boolean;
  events?: ScrapedEvent[];
  error?: { code: string; message: string };
}

/** 映射後的活動記錄，對應 Activities 表格式 */
export interface MappedActivity {
  activityType: string;    // Always "线下活动"
  ugName: string;          // From source displayName
  topic: string;           // Event title
  activityDate: string;    // YYYY-MM-DD
  dedupeKey: string;       // {topic}#{ugName}
  sourceUrl: string;       // Source website URL
}

/** mapAndFilterEvents 的回傳結果 */
export interface MapAndFilterResult {
  activities: MappedActivity[];
  skippedFuture: number;
  skippedMissing: number;
}

// ============================================================
// Constants
// ============================================================

const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ============================================================
// Public Functions
// ============================================================

/**
 * Scrape events from tw.events.awsug.net (server-rendered HTML).
 *
 * Strategy:
 * 1. Fetch the page HTML with browser-like headers
 * 2. Parse event cards using cheerio
 * 3. Extract title, date, location, and status indicators
 * 4. Events with "已截止" or "已結束" are past events (isUpcoming = false)
 */
export async function scrapeAwsugNet(url: string): Promise<ScrapeResult> {
  if (!url || url.trim().length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_URL', message: 'URL 不能為空' },
    };
  }

  try {
    console.log(`[taiwan-scraper] Fetching tw.events.awsug.net: ${url}`);

    const html = await fetchWithTimeout(url);
    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    // Strategy: look for common event card patterns
    // tw.events.awsug.net uses event card elements with title, date, location, status
    // Try multiple selectors to be resilient to minor HTML changes

    // Pattern 1: Event cards with class-based selectors
    $('a[href*="event"], .event-card, .event-item, .event, [class*="event"]').each((_i, el) => {
      const event = parseAwsugNetEventCard($, el, url);
      if (event) {
        events.push(event);
      }
    });

    // Pattern 2: If no events found with pattern 1, try card/list-item patterns
    if (events.length === 0) {
      $('.card, .list-item, .activity-item, article').each((_i, el) => {
        const event = parseAwsugNetEventCard($, el, url);
        if (event) {
          events.push(event);
        }
      });
    }

    // Pattern 3: If still no events, try table rows
    if (events.length === 0) {
      $('tr, .row').each((_i, el) => {
        const event = parseAwsugNetEventCard($, el, url);
        if (event) {
          events.push(event);
        }
      });
    }

    // Deduplicate by title+date
    const seen = new Set<string>();
    const uniqueEvents = events.filter((e) => {
      const key = `${e.title}#${e.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(
      `[taiwan-scraper] Parsed ${uniqueEvents.length} events from tw.events.awsug.net`,
    );
    return { success: true, events: uniqueEvents };
  } catch (err) {
    return handleFetchError(err, 'tw.events.awsug.net');
  }
}

/**
 * Scrape events from awsug.com.tw (SPA site).
 *
 * Strategy:
 * 1. Attempt to discover embedded data or JSON API endpoint
 * 2. If JSON data found, parse it directly
 * 3. Fall back to parsing available HTML with warning
 * 4. Skip events marked "COMING SOON"
 */
export async function scrapeAwsugComTw(url: string): Promise<ScrapeResult> {
  if (!url || url.trim().length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_URL', message: 'URL 不能為空' },
    };
  }

  try {
    console.log(`[taiwan-scraper] Fetching awsug.com.tw: ${url}`);

    const html = await fetchWithTimeout(url);

    // Attempt 1: Look for embedded JSON data (SPA frameworks often embed initial state)
    const jsonEvents = tryExtractEmbeddedData(html, url);
    if (jsonEvents) {
      console.log(
        `[taiwan-scraper] Parsed ${jsonEvents.length} events from embedded data (awsug.com.tw)`,
      );
      return { success: true, events: jsonEvents };
    }

    // Attempt 2: Try to discover API endpoint from script tags
    const apiEvents = await tryDiscoverApi(html, url);
    if (apiEvents) {
      console.log(
        `[taiwan-scraper] Parsed ${apiEvents.length} events from discovered API (awsug.com.tw)`,
      );
      return { success: true, events: apiEvents };
    }

    // Attempt 3: Fall back to parsing whatever HTML is available
    console.warn(
      '[taiwan-scraper] No embedded data or API found for awsug.com.tw, falling back to HTML parsing (data may be incomplete)',
    );
    const events = parseAwsugComTwHtml(html, url);
    console.log(
      `[taiwan-scraper] Parsed ${events.length} events from HTML fallback (awsug.com.tw)`,
    );
    return { success: true, events };
  } catch (err) {
    return handleFetchError(err, 'awsug.com.tw');
  }
}

/**
 * Generic scraper dispatcher based on URL pattern.
 * Routes to the correct scraper implementation.
 */
export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  if (!url || url.trim().length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_URL', message: 'URL 不能為空' },
    };
  }

  const normalizedUrl = url.trim().toLowerCase();

  if (normalizedUrl.includes('tw.events.awsug.net')) {
    return scrapeAwsugNet(url);
  }

  if (normalizedUrl.includes('awsug.com.tw')) {
    return scrapeAwsugComTw(url);
  }

  // Unknown website — attempt generic HTML scraping
  console.warn(`[taiwan-scraper] Unknown website pattern: ${url}, attempting generic scrape`);
  return scrapeAwsugNet(url);
}

/**
 * Map scraped events to Activities table format and filter out ineligible events.
 *
 * Filtering rules:
 * 1. Skip events with `isUpcoming === true` (COMING SOON from awsug.com.tw)
 * 2. Skip events with date after today (future events)
 * 3. Skip events missing required fields (title or date)
 * 4. Include events with "已截止" or "已結束" status (past events from tw.events.awsug.net)
 *
 * @param events - Scraped events from a website source
 * @param displayName - The display name of the sync source (used as ugName)
 * @param referenceDate - Reference date for "today" comparison (defaults to now, useful for testing)
 * @returns Mapped activities + counts of skipped events
 */
export function mapAndFilterEvents(
  events: ScrapedEvent[],
  displayName: string,
  referenceDate?: Date,
): MapAndFilterResult {
  const today = referenceDate ?? new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const activities: MappedActivity[] = [];
  let skippedFuture = 0;
  let skippedMissing = 0;

  for (const event of events) {
    // Skip events missing required fields (title or date)
    if (!event.title || !event.title.trim()) {
      console.warn(`[taiwan-scraper] Skipping event with missing title from ${displayName}`);
      skippedMissing++;
      continue;
    }
    if (!event.date || !event.date.trim()) {
      console.warn(`[taiwan-scraper] Skipping event with missing date: "${event.title}" from ${displayName}`);
      skippedMissing++;
      continue;
    }

    // Skip COMING SOON / upcoming events
    if (event.isUpcoming) {
      console.log(`[taiwan-scraper] Skipping upcoming/COMING SOON event: "${event.title}"`);
      skippedFuture++;
      continue;
    }

    // Skip future events (date after today)
    if (event.date > todayStr) {
      console.log(`[taiwan-scraper] Skipping future event: "${event.title}" (${event.date} > ${todayStr})`);
      skippedFuture++;
      continue;
    }

    // Map to Activities table format
    const topic = event.title.trim();
    const activityDate = event.date.trim();
    const ugName = displayName;

    activities.push({
      activityType: '线下活动',
      ugName,
      topic,
      activityDate,
      dedupeKey: `${topic}#${ugName}`,
      sourceUrl: event.sourceUrl,
    });
  }

  console.log(
    `[taiwan-scraper] mapAndFilterEvents for "${displayName}": ` +
    `${activities.length} synced, ${skippedFuture} future/upcoming skipped, ${skippedMissing} missing fields skipped`,
  );

  return { activities, skippedFuture, skippedMissing };
}

// ============================================================
// Internal Helpers — HTTP
// ============================================================

/**
 * Fetch a URL with timeout and browser-like headers.
 * Throws on HTTP errors (4xx/5xx) or network failures.
 */
async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & {
        statusCode: number;
      };
      error.statusCode = response.status;
      throw error;
    }

    return await response.text();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Handle fetch errors and return a ScrapeResult with appropriate error info.
 */
function handleFetchError(err: unknown, source: string): ScrapeResult {
  if (err instanceof Error && err.name === 'AbortError') {
    console.error(`[taiwan-scraper] Timeout fetching ${source} (${FETCH_TIMEOUT_MS}ms)`);
    return {
      success: false,
      error: {
        code: 'FETCH_TIMEOUT',
        message: `請求超時 (${FETCH_TIMEOUT_MS / 1000}秒): ${source}`,
      },
    };
  }

  const statusCode = (err as any)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400) {
    console.error(`[taiwan-scraper] HTTP ${statusCode} from ${source}`);
    return {
      success: false,
      error: {
        code: 'HTTP_ERROR',
        message: `HTTP ${statusCode} 錯誤: ${source}`,
      },
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`[taiwan-scraper] Fetch failed for ${source}:`, message);
  return {
    success: false,
    error: {
      code: 'FETCH_FAILED',
      message: `網站抓取失敗: ${message}`,
    },
  };
}

// ============================================================
// Internal Helpers — tw.events.awsug.net parsing
// ============================================================

/**
 * Parse a single event card element from tw.events.awsug.net.
 * Returns null if the element doesn't contain valid event data.
 */
function parseAwsugNetEventCard(
  $: cheerio.CheerioAPI,
  el: cheerio.Element,
  sourceUrl: string,
): ScrapedEvent | null {
  const $el = $(el);
  const text = $el.text();

  // Extract title — look for heading elements or prominent text
  const title =
    $el.find('h1, h2, h3, h4, h5, .title, .event-title, [class*="title"]').first().text().trim() ||
    $el.find('a').first().text().trim() ||
    '';

  if (!title) return null;

  // Extract date text — look for date-related elements or Chinese date patterns in text
  const dateText =
    $el.find('.date, .event-date, [class*="date"], time').first().text().trim() ||
    extractDateFromText(text);

  if (!dateText) {
    console.warn(`[taiwan-scraper] Skipping event without date: "${title}"`);
    return null;
  }

  const parsedDate = parseTaiwanDate(dateText);
  if (!parsedDate) {
    console.warn(`[taiwan-scraper] Skipping event with unparseable date: "${title}" — "${dateText}"`);
    return null;
  }

  // Extract location
  const location =
    $el.find('.location, .venue, .event-location, [class*="location"], [class*="venue"]')
      .first()
      .text()
      .trim() || undefined;

  // Determine if event is upcoming or past based on status indicators
  const isUpcoming = !isPastEvent(text);

  return {
    title,
    date: parsedDate,
    location,
    sourceUrl,
    isUpcoming,
  };
}

/**
 * Extract a date string from free text using Chinese date patterns.
 */
function extractDateFromText(text: string): string {
  // Match Chinese date: X月Y日
  const chineseMatch = text.match(/\d{1,2}月\d{1,2}日[^]*?(?:\d{2}:\d{2})?/);
  if (chineseMatch) return chineseMatch[0];

  // Match English date: Month Day, Year
  const englishMatch = text.match(
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
  );
  if (englishMatch) return englishMatch[0];

  // Match ISO date: YYYY-MM-DD
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  return '';
}

/**
 * Check if event text contains past-event indicators.
 * "已截止" (closed) and "已結束" (ended) indicate past events.
 */
function isPastEvent(text: string): boolean {
  return text.includes('已截止') || text.includes('已結束');
}

// ============================================================
// Internal Helpers — awsug.com.tw parsing
// ============================================================

/**
 * Try to extract embedded JSON data from SPA HTML.
 * SPA frameworks often embed initial state in script tags.
 */
function tryExtractEmbeddedData(html: string, sourceUrl: string): ScrapedEvent[] | null {
  // Pattern 1: window.__INITIAL_STATE__ or window.__NUXT__
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
    /window\.__NUXT__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
    /window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const events = extractEventsFromJson(data, sourceUrl);
        if (events.length > 0) {
          return events;
        }
      } catch {
        // JSON parse failed, try next pattern
      }
    }
  }

  return null;
}

/**
 * Try to discover an API endpoint from script tags and fetch data from it.
 */
async function tryDiscoverApi(html: string, sourceUrl: string): Promise<ScrapedEvent[] | null> {
  // Look for API URLs in script tags
  const apiPatterns = [
    /["'](https?:\/\/[^"']*api[^"']*events[^"']*)["']/gi,
    /["'](https?:\/\/[^"']*\/api\/[^"']*)["']/gi,
    /["'](\/api\/[^"']*)["']/gi,
  ];

  const baseUrl = new URL(sourceUrl);

  for (const pattern of apiPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      let apiUrl = match[1];
      // Resolve relative URLs
      if (apiUrl.startsWith('/')) {
        apiUrl = `${baseUrl.protocol}//${baseUrl.host}${apiUrl}`;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            const data = await response.json();
            const events = extractEventsFromJson(data, sourceUrl);
            if (events.length > 0) {
              return events;
            }
          }
        }
      } catch {
        // API fetch failed, try next URL
      }
    }
  }

  return null;
}

/**
 * Extract events from a JSON data structure.
 * Handles various possible shapes of event data.
 */
function extractEventsFromJson(data: unknown, sourceUrl: string): ScrapedEvent[] {
  const events: ScrapedEvent[] = [];
  const items = findEventArray(data);

  if (!items) return events;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    const title = extractStringField(obj, ['title', 'name', 'topic', 'subject', '主題', '標題']);
    const dateStr = extractStringField(obj, ['date', 'dateTime', 'event_date', 'activityDate', '日期']);
    const location = extractStringField(obj, ['location', 'venue', 'place', '地點']) || undefined;
    const status = extractStringField(obj, ['status', 'state', '狀態']);

    if (!title || !dateStr) continue;

    // Skip "COMING SOON" events
    if (isComingSoon(title, status)) {
      console.log(`[taiwan-scraper] Skipping COMING SOON event: "${title}"`);
      continue;
    }

    const parsedDate = parseTaiwanDate(dateStr);
    if (!parsedDate) {
      console.warn(`[taiwan-scraper] Skipping event with unparseable date: "${title}" — "${dateStr}"`);
      continue;
    }

    events.push({
      title,
      date: parsedDate,
      location,
      sourceUrl,
      isUpcoming: isComingSoon(title, status),
    });
  }

  return events;
}

/**
 * Recursively search for an array of event-like objects in JSON data.
 */
function findEventArray(data: unknown, depth = 0): unknown[] | null {
  if (depth > 5) return null;
  if (Array.isArray(data) && data.length > 0) return data;
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Check common keys for event arrays
  for (const key of ['events', 'items', 'data', 'records', 'results', 'list']) {
    if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) {
      return obj[key] as unknown[];
    }
  }

  // Recurse into nested objects
  for (const key of ['data', 'props', 'pageProps', 'payload']) {
    if (obj[key] && typeof obj[key] === 'object') {
      const result = findEventArray(obj[key], depth + 1);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Extract a string field from an object by trying multiple possible keys.
 */
function extractStringField(obj: Record<string, unknown>, candidates: string[]): string {
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/**
 * Check if an event is marked as "COMING SOON".
 */
function isComingSoon(title: string, status: string): boolean {
  const combined = `${title} ${status}`.toUpperCase();
  return combined.includes('COMING SOON');
}

/**
 * Parse HTML from awsug.com.tw as a fallback when no embedded data or API is found.
 */
function parseAwsugComTwHtml(html: string, sourceUrl: string): ScrapedEvent[] {
  const $ = cheerio.load(html);
  const events: ScrapedEvent[] = [];

  // Try common SPA-rendered card patterns
  $('a[href*="event"], .event-card, .event-item, .card, article, [class*="event"]').each(
    (_i, el) => {
      const $el = $(el);
      const text = $el.text();

      const title =
        $el.find('h1, h2, h3, h4, h5, .title, [class*="title"]').first().text().trim() ||
        $el.find('a').first().text().trim() ||
        '';

      if (!title) return;

      // Skip "COMING SOON" events
      if (isComingSoon(text, '')) {
        console.log(`[taiwan-scraper] Skipping COMING SOON event: "${title}"`);
        return;
      }

      const dateText =
        $el.find('.date, [class*="date"], time').first().text().trim() ||
        extractDateFromText(text);

      if (!dateText) {
        console.warn(`[taiwan-scraper] Skipping event without date: "${title}"`);
        return;
      }

      const parsedDate = parseTaiwanDate(dateText);
      if (!parsedDate) {
        console.warn(
          `[taiwan-scraper] Skipping event with unparseable date: "${title}" — "${dateText}"`,
        );
        return;
      }

      const location =
        $el.find('.location, .venue, [class*="location"], [class*="venue"]')
          .first()
          .text()
          .trim() || undefined;

      events.push({
        title,
        date: parsedDate,
        location,
        sourceUrl,
        isUpcoming: false,
      });
    },
  );

  // Deduplicate
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.title}#${e.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
