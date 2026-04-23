/**
 * Meetup GraphQL Client — Meetup.com 活动数据获取
 *
 * 通过 Cookie 认证向 Meetup 的 GraphQL gql2 端点发送查询，
 * 获取指定 Meetup Group 的 PAST 和 UPCOMING 活动数据，
 * 映射为统一的 MeetupEvent 格式。
 */

// ============================================================
// Interfaces
// ============================================================

/** Meetup group configuration */
export interface MeetupGroup {
  urlname: string;       // e.g. "hong-kong-amazon-aws-user-group"
  displayName: string;   // e.g. "AWS UGHK"
}

/** Cookie auth credentials */
export interface MeetupCookieAuth {
  meetupToken: string;   // MEETUP_MEMBER cookie value
  meetupCsrf: string;    // CSRF token
  meetupSession: string; // Session cookie
}

/** Single mapped Meetup event */
export interface MeetupEvent {
  activityType: string;    // Always "线下活动"
  ugName: string;          // From group displayName
  topic: string;           // Event title
  activityDate: string;    // YYYY-MM-DD from dateTime
  dedupeKey: string;       // meetup#{meetupEventId}
  // Meetup-specific extra fields
  meetupEventId: string;
  meetupEventUrl: string;
  meetupGoingCount: number;
  meetupVenueName?: string;
  meetupVenueCity?: string;
}

/** Result from fetching a single group's events */
export interface MeetupGroupResult {
  success: boolean;
  events?: MeetupEvent[];
  error?: { code: string; message: string };
}

/** Raw GraphQL event node from Meetup API */
export interface MeetupGraphQLEventNode {
  id?: string;
  title?: string;
  dateTime?: string;
  eventUrl?: string;
  going?: { totalCount?: number };
  venue?: { name?: string; city?: string };
}

// ============================================================
// Constants
// ============================================================

const MEETUP_GQL_ENDPOINT = 'https://www.meetup.com/gql2';
const FETCH_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 50;

/** GraphQL query for fetching group PAST events */
const PAST_EVENTS_QUERY = `
query getPastEvents($urlname: String!, $first: Int!, $after: String) {
  groupByUrlname(urlname: $urlname) {
    events(first: $first, after: $after, status: PAST) {
      edges {
        node {
          id title dateTime eventUrl
          going { totalCount }
          venue { name city country }
          isOnline
        }
      }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
}
`;

/** GraphQL query for fetching group UPCOMING events */
const UPCOMING_EVENTS_QUERY = `
query getUpcomingEvents($urlname: String!, $first: Int!, $after: String) {
  groupByUrlname(urlname: $urlname) {
    events(first: $first, after: $after, status: UPCOMING) {
      edges {
        node {
          id title dateTime eventUrl
          going { totalCount }
          venue { name city country }
          isOnline
        }
      }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
}
`;

/** Lightweight query to verify connection */
const TEST_CONNECTION_QUERY = `{ self { id name } }`;

// ============================================================
// Public Functions
// ============================================================

/**
 * Map a raw GraphQL event node to MeetupEvent.
 * Returns null if required fields (id, title, dateTime) are missing.
 */
export function mapMeetupEvent(
  node: MeetupGraphQLEventNode,
  group: MeetupGroup,
): MeetupEvent | null {
  // Skip malformed events missing required fields
  if (!node.id || !node.title || !node.dateTime) {
    console.warn('[meetup-api] Skipping malformed event: missing required fields', {
      id: node.id,
      title: node.title,
      dateTime: node.dateTime,
    });
    return null;
  }

  const topic = node.title;
  const activityDate = extractDate(node.dateTime);
  const ugName = group.displayName;

  return {
    activityType: '线下活动',
    ugName,
    topic,
    activityDate,
    dedupeKey: `meetup#${node.id}`,
    meetupEventId: node.id,
    meetupEventUrl: node.eventUrl ?? '',
    meetupGoingCount: node.going?.totalCount ?? 0,
    meetupVenueName: node.venue?.name,
    meetupVenueCity: node.venue?.city,
  };
}

/**
 * Fetch all events for a single Meetup group.
 * Queries both PAST and UPCOMING statuses, paginating each with cursor-based `after`.
 */
export async function fetchMeetupGroupEvents(
  group: MeetupGroup,
  auth: MeetupCookieAuth,
): Promise<MeetupGroupResult> {
  try {
    const urlname = extractUrlname(group.urlname);

    // Use the meetup-events-fetcher Lambda in us-east-1 as a proxy
    // (Meetup blocks requests from ap-northeast-1 AWS IPs with 503)
    const FETCHER_FUNCTION = 'meetup-events-fetcher';
    const FETCHER_REGION = 'us-east-1';

    try {
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({ region: FETCHER_REGION });

      const invokeResult = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: FETCHER_FUNCTION,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ groups: [urlname] })),
        }),
      );

      if (!invokeResult.Payload) {
        return { success: false, error: { code: 'MEETUP_API_ERROR', message: 'Empty response from fetcher Lambda' } };
      }

      const payloadStr = Buffer.from(invokeResult.Payload).toString('utf-8');
      const lambdaResponse = JSON.parse(payloadStr);
      const body = typeof lambdaResponse.body === 'string' ? JSON.parse(lambdaResponse.body) : lambdaResponse;

      const rawEvents = body.events ?? [];
      const allEvents: MeetupEvent[] = [];

      for (const evt of rawEvents) {
        if (!evt.id || !evt.title || !evt.dateTime) continue;
        const mapped = mapMeetupEvent(
          {
            id: evt.id,
            title: evt.title,
            dateTime: evt.dateTime,
            eventUrl: evt.eventUrl,
            going: evt.attendees != null ? { totalCount: evt.attendees } : undefined,
            venue: evt.venue,
          },
          group,
        );
        if (mapped) allEvents.push(mapped);
      }

      console.log(`[meetup-api] Fetched ${allEvents.length} events for group "${group.urlname}" via fetcher Lambda`);
      return { success: true, events: allEvents };
    } catch (lambdaErr) {
      console.warn(`[meetup-api] Fetcher Lambda failed, falling back to direct API:`, lambdaErr);
      // Fall through to direct API call below
    }

    // Fallback: direct API call (may fail with 503 from ap-northeast-1)
    const allEvents: MeetupEvent[] = [];
    for (const query of [PAST_EVENTS_QUERY]) {
      let hasNextPage = true;
      let cursor: string | null = null;

      while (hasNextPage) {
        const variables: Record<string, unknown> = {
          urlname,
          first: PAGE_SIZE,
        };
        if (cursor) {
          variables.after = cursor;
        }

        const result = await sendGraphQLQuery(query, variables, auth);

        if (!result.success) {
          return {
            success: false,
            error: result.error,
          };
        }

        const eventsData = result.data?.groupByUrlname?.events;
        if (!eventsData) {
          // Group may not exist or have no events for this status
          break;
        }

        const edges = eventsData.edges ?? [];
        for (const edge of edges) {
          if (!edge?.node) continue;
          const mapped = mapMeetupEvent(edge.node as MeetupGraphQLEventNode, group);
          if (mapped) {
            allEvents.push(mapped);
          }
        }

        const pageInfo = eventsData.pageInfo;
        hasNextPage = pageInfo?.hasNextPage === true;
        cursor = pageInfo?.endCursor ?? null;
      }
    }

    console.log(`[meetup-api] Fetched ${allEvents.length} events for group "${group.urlname}"`);
    return { success: true, events: allEvents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[meetup-api] Failed to fetch events for group "${group.urlname}":`, message);
    return {
      success: false,
      error: { code: 'MEETUP_API_ERROR', message },
    };
  }
}

/**
 * Test connection by sending a lightweight GraphQL query.
 * Verifies that cookie auth credentials are valid.
 */
export async function testMeetupConnection(
  auth: MeetupCookieAuth,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    const result = await sendGraphQLQuery(TEST_CONNECTION_QUERY, {}, auth);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: { code: 'MEETUP_API_ERROR', message },
    };
  }
}

/**
 * Mask a cookie value for safe display.
 * Returns asterisks + last 4 characters for strings > 4 chars,
 * or "****" for shorter strings.
 */
export function maskCookie(value: string): string {
  if (!value || value.length <= 4) return value ? '****' : '';
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Extract the urlname from a Meetup URL or return as-is if already a urlname.
 * Examples:
 *   "https://www.meetup.com/hong-kong-aws-user-group/" → "hong-kong-aws-user-group"
 *   "https://www.meetup.com/hong-kong-aws-user-group/events/past/" → "hong-kong-aws-user-group"
 *   "hong-kong-aws-user-group" → "hong-kong-aws-user-group"
 */
export function extractUrlname(input: string): string {
  const trimmed = input.trim();
  // Try to extract from a Meetup URL pattern
  const match = trimmed.match(/meetup\.com\/([^/?#]+)/i);
  if (match) return match[1];
  // Already a urlname — strip any trailing slashes
  return trimmed.replace(/\/+$/, '');
}

/**
 * Extract YYYY-MM-DD date from a dateTime string.
 * Handles ISO 8601 format and other common date formats.
 */
function extractDate(dateTime: string): string {
  // If already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTime)) return dateTime;

  // Try to extract YYYY-MM-DD from the beginning of an ISO string
  const isoMatch = dateTime.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Fallback: parse as Date
  try {
    const date = new Date(dateTime);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // ignore
  }

  return dateTime;
}

/**
 * Build HTTP headers for Meetup GraphQL requests.
 * Includes Cookie-based auth matching the working Lambda pattern.
 */
function buildHeaders(auth: MeetupCookieAuth): Record<string, string> {
  const cookie = `__meetup_auth_access_token=${auth.meetupToken}; MEETUP_SESSION=${auth.meetupSession}; MEETUP_CSRF=${auth.meetupCsrf}`;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.meetupToken}`,
    'X-Csrf-Token': auth.meetupCsrf,
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 Chrome/124.0.0.0',
  };
}

/**
 * Send a GraphQL query to the Meetup gql2 endpoint.
 * Handles timeout, HTTP errors, and GraphQL errors.
 */
async function sendGraphQLQuery(
  query: string,
  variables: Record<string, unknown>,
  auth: MeetupCookieAuth,
): Promise<{
  success: boolean;
  data?: Record<string, any>;
  error?: { code: string; message: string };
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(MEETUP_GQL_ENDPOINT, {
      method: 'POST',
      headers: buildHeaders(auth),
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: {
          code: 'MEETUP_AUTH_EXPIRED',
          message: `Meetup authentication failed (HTTP ${response.status}). Please update your cookie credentials.`,
        },
      };
    }

    // Handle other HTTP errors
    if (!response.ok) {
      return {
        success: false,
        error: {
          code: 'MEETUP_API_ERROR',
          message: `Meetup API returned HTTP ${response.status}`,
        },
      };
    }

    const json = (await response.json()) as {
      data?: Record<string, any>;
      errors?: Array<{ message: string }>;
    };

    // Handle GraphQL errors
    if (json.errors && json.errors.length > 0) {
      return {
        success: false,
        error: {
          code: 'MEETUP_API_ERROR',
          message: json.errors[0].message,
        },
      };
    }

    return { success: true, data: json.data };
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle timeout / abort
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: {
          code: 'MEETUP_TIMEOUT',
          message: 'Meetup API request timed out after 20 seconds',
        },
      };
    }

    throw err;
  }
}
