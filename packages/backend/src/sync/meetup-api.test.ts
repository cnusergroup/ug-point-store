import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapMeetupEvent, maskCookie, fetchMeetupGroupEvents, testMeetupConnection } from './meetup-api';
import type { MeetupGroup, MeetupCookieAuth, MeetupGraphQLEventNode } from './meetup-api';

// ============================================================
// mapMeetupEvent
// ============================================================

describe('mapMeetupEvent', () => {
  const group: MeetupGroup = { urlname: 'aws-ughk', displayName: 'AWS UGHK' };

  it('maps a valid event node to MeetupEvent', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-1',
      title: 'AWS re:Invent Recap',
      dateTime: '2024-03-15T18:00:00+08:00',
      eventUrl: 'https://www.meetup.com/aws-ughk/events/evt-1/',
      going: { totalCount: 42 },
      venue: { name: 'WeWork', city: 'Hong Kong' },
    };

    const result = mapMeetupEvent(node, group);
    expect(result).not.toBeNull();
    expect(result!.activityType).toBe('线下活动');
    expect(result!.ugName).toBe('AWS UGHK');
    expect(result!.topic).toBe('AWS re:Invent Recap');
    expect(result!.activityDate).toBe('2024-03-15');
    expect(result!.dedupeKey).toBe('AWS re:Invent Recap#2024-03-15#AWS UGHK');
    expect(result!.meetupEventId).toBe('evt-1');
    expect(result!.meetupEventUrl).toBe('https://www.meetup.com/aws-ughk/events/evt-1/');
    expect(result!.meetupGoingCount).toBe(42);
    expect(result!.meetupVenueName).toBe('WeWork');
    expect(result!.meetupVenueCity).toBe('Hong Kong');
  });

  it('returns null when id is missing', () => {
    const node: MeetupGraphQLEventNode = {
      title: 'Test',
      dateTime: '2024-01-01T10:00:00Z',
    };
    expect(mapMeetupEvent(node, group)).toBeNull();
  });

  it('returns null when title is missing', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-2',
      dateTime: '2024-01-01T10:00:00Z',
    };
    expect(mapMeetupEvent(node, group)).toBeNull();
  });

  it('returns null when dateTime is missing', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-3',
      title: 'Test Event',
    };
    expect(mapMeetupEvent(node, group)).toBeNull();
  });

  it('handles missing venue gracefully', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-4',
      title: 'Online Event',
      dateTime: '2024-06-01T14:00:00Z',
    };
    const result = mapMeetupEvent(node, group);
    expect(result).not.toBeNull();
    expect(result!.meetupVenueName).toBeUndefined();
    expect(result!.meetupVenueCity).toBeUndefined();
  });

  it('handles missing going count gracefully', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-5',
      title: 'Small Meetup',
      dateTime: '2024-07-10T19:00:00+09:00',
    };
    const result = mapMeetupEvent(node, group);
    expect(result).not.toBeNull();
    expect(result!.meetupGoingCount).toBe(0);
  });

  it('handles missing eventUrl gracefully', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-6',
      title: 'No URL Event',
      dateTime: '2024-08-20T10:00:00Z',
    };
    const result = mapMeetupEvent(node, group);
    expect(result).not.toBeNull();
    expect(result!.meetupEventUrl).toBe('');
  });

  it('extracts date from YYYY-MM-DD format', () => {
    const node: MeetupGraphQLEventNode = {
      id: 'evt-7',
      title: 'Date Test',
      dateTime: '2024-12-25',
    };
    const result = mapMeetupEvent(node, group);
    expect(result!.activityDate).toBe('2024-12-25');
  });
});

// ============================================================
// maskCookie
// ============================================================

describe('maskCookie', () => {
  it('returns empty string for empty input', () => {
    expect(maskCookie('')).toBe('');
  });

  it('returns "****" for short strings (length <= 4)', () => {
    expect(maskCookie('ab')).toBe('****');
    expect(maskCookie('abcd')).toBe('****');
  });

  it('masks all but last 4 characters for longer strings', () => {
    expect(maskCookie('abcdefgh')).toBe('****efgh');
    expect(maskCookie('12345')).toBe('*2345');
  });

  it('handles very long strings', () => {
    const long = 'a'.repeat(100) + 'LAST';
    const result = maskCookie(long);
    expect(result.length).toBe(104);
    expect(result.endsWith('LAST')).toBe(true);
    expect(result.startsWith('*'.repeat(100))).toBe(true);
  });
});

// ============================================================
// fetchMeetupGroupEvents — mock global fetch
// ============================================================

describe('fetchMeetupGroupEvents', () => {
  const group: MeetupGroup = { urlname: 'test-group', displayName: 'Test Group' };
  const auth: MeetupCookieAuth = {
    meetupToken: 'tok123',
    meetupCsrf: 'csrf456',
    meetupSession: 'sess789',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns events from both PAST and UPCOMING queries', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: any, options: any) => {
      callCount++;
      const body = JSON.parse(options.body);
      const queryStr: string = body.query || '';
      const isPast = queryStr.includes('status: PAST');

      const events = isPast
        ? [{ node: { id: 'p1', title: 'Past Event', dateTime: '2024-01-10T10:00:00Z', eventUrl: 'https://meetup.com/p1', going: { totalCount: 10 }, venue: { name: 'V1', city: 'C1' } } }]
        : [{ node: { id: 'u1', title: 'Upcoming Event', dateTime: '2024-06-15T18:00:00Z', eventUrl: 'https://meetup.com/u1', going: { totalCount: 5 }, venue: { name: 'V2', city: 'C2' } } }];

      return new Response(JSON.stringify({
        data: {
          groupByUrlname: {
            events: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: events,
            },
          },
        },
      }), { status: 200 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events![0].topic).toBe('Past Event');
    expect(result.events![1].topic).toBe('Upcoming Event');
    // Should have been called twice (PAST + UPCOMING)
    expect(callCount).toBe(2);
  });

  it('paginates through multiple pages', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: any, options: any) => {
      callCount++;
      const body = JSON.parse(options.body);
      const queryStr: string = body.query || '';
      const isPast = queryStr.includes('status: PAST');
      const after = body.variables.after;

      // Only paginate for PAST query
      if (isPast && !after) {
        return new Response(JSON.stringify({
          data: {
            groupByUrlname: {
              events: {
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                edges: [{ node: { id: 'p1', title: 'Page 1 Event', dateTime: '2024-01-01T10:00:00Z' } }],
              },
            },
          },
        }), { status: 200 });
      }

      if (isPast && after === 'cursor-1') {
        return new Response(JSON.stringify({
          data: {
            groupByUrlname: {
              events: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [{ node: { id: 'p2', title: 'Page 2 Event', dateTime: '2024-02-01T10:00:00Z' } }],
              },
            },
          },
        }), { status: 200 });
      }

      // UPCOMING: no events
      return new Response(JSON.stringify({
        data: {
          groupByUrlname: {
            events: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      }), { status: 200 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events![0].topic).toBe('Page 1 Event');
    expect(result.events![1].topic).toBe('Page 2 Event');
    // PAST page 1 + PAST page 2 + UPCOMING page 1 = 3 calls
    expect(callCount).toBe(3);
  });

  it('returns MEETUP_AUTH_EXPIRED for HTTP 401', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_AUTH_EXPIRED');
  });

  it('returns MEETUP_AUTH_EXPIRED for HTTP 403', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Forbidden', { status: 403 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_AUTH_EXPIRED');
  });

  it('returns MEETUP_API_ERROR for HTTP 500', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Server Error', { status: 500 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_API_ERROR');
    expect(result.error!.message).toContain('500');
  });

  it('returns MEETUP_TIMEOUT on AbortError', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new DOMException('The operation was aborted', 'AbortError');
      throw err;
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_TIMEOUT');
  });

  it('returns MEETUP_API_ERROR for GraphQL errors in response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        errors: [{ message: 'Group not found' }],
      }), { status: 200 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_API_ERROR');
    expect(result.error!.message).toBe('Group not found');
  });

  it('skips malformed events in response', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: any, options: any) => {
      callCount++;
      const body = JSON.parse(options.body);
      const queryStr: string = body.query || '';
      const isPast = queryStr.includes('status: PAST');

      if (isPast) {
        return new Response(JSON.stringify({
          data: {
            groupByUrlname: {
              events: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [
                  { node: { id: 'good', title: 'Good Event', dateTime: '2024-05-01T10:00:00Z' } },
                  { node: { id: null, title: 'Bad Event', dateTime: '2024-05-02T10:00:00Z' } },
                  { node: { id: 'good2', title: 'Another Good', dateTime: '2024-05-03T10:00:00Z' } },
                ],
              },
            },
          },
        }), { status: 200 });
      }

      // UPCOMING: no events
      return new Response(JSON.stringify({
        data: {
          groupByUrlname: {
            events: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      }), { status: 200 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(true);
    // Only 2 valid events (the one with null id is skipped)
    expect(result.events).toHaveLength(2);
  });

  it('handles empty group (no events data) gracefully', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        data: {
          groupByUrlname: null,
        },
      }), { status: 200 });
    }) as any;

    const result = await fetchMeetupGroupEvents(group, auth);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
  });

  it('sends correct headers with cookie auth', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: any, options: any) => {
      capturedHeaders = options.headers;
      return new Response(JSON.stringify({
        data: {
          groupByUrlname: {
            events: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      }), { status: 200 });
    }) as any;

    await fetchMeetupGroupEvents(group, auth);
    expect(capturedHeaders['Cookie']).toContain('__meetup_auth_access_token=tok123');
    expect(capturedHeaders['Cookie']).toContain('MEETUP_SESSION=sess789');
    expect(capturedHeaders['X-Csrf-Token']).toBe('csrf456');
    expect(capturedHeaders['Authorization']).toBe('Bearer tok123');
  });
});

// ============================================================
// testMeetupConnection
// ============================================================

describe('testMeetupConnection', () => {
  const auth: MeetupCookieAuth = {
    meetupToken: 'tok',
    meetupCsrf: 'csrf',
    meetupSession: 'sess',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success when API responds with valid data', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        data: { self: { id: '123', name: 'Test User' } },
      }), { status: 200 });
    }) as any;

    const result = await testMeetupConnection(auth);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns failure when API returns auth error', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const result = await testMeetupConnection(auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_AUTH_EXPIRED');
  });

  it('returns failure when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    }) as any;

    const result = await testMeetupConnection(auth);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('MEETUP_API_ERROR');
    expect(result.error!.message).toBe('Network error');
  });
});
