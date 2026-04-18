/**
 * Property-Based Tests for Meetup API module
 *
 * Feature: meetup-sync
 * Properties: 1 (event data mapping), 2 (pagination), 3 (cookie masking), 7 (malformed event filtering)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  mapMeetupEvent,
  maskCookie,
  fetchMeetupGroupEvents,
  type MeetupGroup,
  type MeetupCookieAuth,
  type MeetupGraphQLEventNode,
} from './meetup-api';

// ============================================================
// Arbitraries
// ============================================================

/** Generate a valid ISO date string (YYYY-MM-DD) */
const dateArb = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

/** Generate a valid ISO dateTime string (YYYY-MM-DDTHH:mm:ss) */
const dateTimeArb = dateArb.chain((date) =>
  fc
    .record({
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
    })
    .map(
      ({ hour, minute, second }) =>
        `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
    ),
);

/** Generate a safe non-empty string (no '#' to avoid dedupeKey separator conflicts) */
const safeStringArb = fc
  .stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff ]+$/)
  .filter((s) => s.length >= 1 && s.length <= 60);

/** Generate a MeetupGroup */
const groupArb: fc.Arbitrary<MeetupGroup> = fc.record({
  urlname: fc.stringMatching(/^[a-z0-9-]+$/).filter((s) => s.length >= 3 && s.length <= 60),
  displayName: safeStringArb,
});

/** Generate a valid MeetupGraphQLEventNode (all required fields present) */
const validEventNodeArb: fc.Arbitrary<MeetupGraphQLEventNode> = fc.record({
  id: fc.uuid(),
  title: safeStringArb,
  dateTime: dateTimeArb,
  eventUrl: fc.webUrl(),
  going: fc.record({ totalCount: fc.integer({ min: 0, max: 500 }) }),
  venue: fc.option(
    fc.record({
      name: safeStringArb,
      city: safeStringArb,
    }),
    { nil: undefined },
  ),
});

/** Generate a MeetupCookieAuth */
const authArb: fc.Arbitrary<MeetupCookieAuth> = fc.record({
  meetupToken: fc.string({ minLength: 10, maxLength: 50 }),
  meetupCsrf: fc.string({ minLength: 10, maxLength: 50 }),
  meetupSession: fc.string({ minLength: 10, maxLength: 50 }),
});

// ============================================================
// Property 1: Event data mapping preserves all fields
// Feature: meetup-sync, Property 1: event data mapping preserves all fields
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
// ============================================================

describe('Feature: meetup-sync, Property 1: event data mapping preserves all fields', () => {
  it('mapping a valid event node produces correct activityType, ugName, topic, activityDate, dedupeKey, and Meetup-specific fields', () => {
    fc.assert(
      fc.property(validEventNodeArb, groupArb, (node, group) => {
        const result = mapMeetupEvent(node, group);

        // Valid node should always produce a non-null result
        expect(result).not.toBeNull();
        if (!result) return;

        // activityType is always "线下活动"
        expect(result.activityType).toBe('线下活动');

        // ugName equals group's displayName
        expect(result.ugName).toBe(group.displayName);

        // topic equals event title
        expect(result.topic).toBe(node.title);

        // activityDate is the YYYY-MM-DD portion of dateTime
        const expectedDate = node.dateTime!.slice(0, 10);
        expect(result.activityDate).toBe(expectedDate);

        // dedupeKey equals {topic}#{activityDate}#{ugName}
        const expectedDedupeKey = `${node.title}#${expectedDate}#${group.displayName}`;
        expect(result.dedupeKey).toBe(expectedDedupeKey);

        // Meetup-specific fields are preserved
        expect(result.meetupEventId).toBe(node.id);
        expect(result.meetupEventUrl).toBe(node.eventUrl ?? '');
        expect(result.meetupGoingCount).toBe(node.going?.totalCount ?? 0);

        if (node.venue) {
          expect(result.meetupVenueName).toBe(node.venue.name);
          expect(result.meetupVenueCity).toBe(node.venue.city);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Pagination collects all events across pages
// Feature: meetup-sync, Property 2: pagination collects all events across pages
// **Validates: Requirements 1.3**
// ============================================================

describe('Feature: meetup-sync, Property 2: pagination collects all events across pages', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Generate a paginated sequence of GraphQL responses.
   * Each page has 0-20 events. The sequence has 1-5 pages.
   * We generate pages for both PAST and UPCOMING statuses.
   */
  const paginatedResponseArb = fc
    .array(
      fc.array(validEventNodeArb, { minLength: 0, maxLength: 10 }),
      { minLength: 1, maxLength: 3 },
    )
    .chain((pastPages) =>
      fc
        .array(
          fc.array(validEventNodeArb, { minLength: 0, maxLength: 10 }),
          { minLength: 1, maxLength: 3 },
        )
        .map((upcomingPages) => ({ pastPages, upcomingPages })),
    );

  it('total collected events equals sum of events across all pages for both PAST and UPCOMING', async () => {
    await fc.assert(
      fc.asyncProperty(paginatedResponseArb, groupArb, authArb, async (pages, group, auth) => {
        const { pastPages, upcomingPages } = pages;

        // Track which status and page we're on
        let pastPageIndex = 0;
        let upcomingPageIndex = 0;

        globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
          const body = JSON.parse(options.body);
          const queryStr: string = body.query || '';

          let currentPages: MeetupGraphQLEventNode[][];
          let pageIndex: number;

          // Detect PAST vs UPCOMING from the query string (status is embedded, not a variable)
          if (queryStr.includes('status: PAST')) {
            currentPages = pastPages;
            pageIndex = pastPageIndex++;
          } else {
            currentPages = upcomingPages;
            pageIndex = upcomingPageIndex++;
          }

          const pageEvents = pageIndex < currentPages.length ? currentPages[pageIndex] : [];
          const hasNextPage = pageIndex < currentPages.length - 1;
          const endCursor = hasNextPage ? `cursor-${pageIndex}` : null;

          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                groupByUrlname: {
                  events: {
                    pageInfo: { hasNextPage, endCursor },
                    edges: pageEvents.map((node) => ({ node })),
                  },
                },
              },
            }),
          } as any;
        });

        const result = await fetchMeetupGroupEvents(group, auth);

        expect(result.success).toBe(true);
        expect(result.events).toBeDefined();

        // Count total valid events across all pages (skip malformed ones)
        const allPastEvents = pastPages.flat();
        const allUpcomingEvents = upcomingPages.flat();
        const allEvents = [...allPastEvents, ...allUpcomingEvents];

        // Only count events with all required fields (id, title, dateTime)
        const validEventCount = allEvents.filter(
          (e) => e.id && e.title && e.dateTime,
        ).length;

        expect(result.events!.length).toBe(validEventCount);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: Cookie masking reveals only last 4 characters
// Feature: meetup-sync, Property 3: cookie masking reveals only last 4 characters
// **Validates: Requirements 7.1, 8.4**
// ============================================================

describe('Feature: meetup-sync, Property 3: cookie masking reveals only last 4 characters', () => {
  it('for strings > 4 chars: length preserved, first (L-4) are asterisks, last 4 match original', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 200 }),
        (cookie) => {
          const masked = maskCookie(cookie);

          // Length is preserved
          expect(masked.length).toBe(cookie.length);

          // First (L-4) characters are asterisks
          const asteriskPart = masked.slice(0, cookie.length - 4);
          expect(asteriskPart).toBe('*'.repeat(cookie.length - 4));

          // Last 4 characters match original
          expect(masked.slice(-4)).toBe(cookie.slice(-4));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for strings of length ≤ 4: returns "****"', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 4 }),
        (cookie) => {
          const masked = maskCookie(cookie);
          expect(masked).toBe('****');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for empty string: returns empty string', () => {
    expect(maskCookie('')).toBe('');
  });
});

// ============================================================
// Property 7: Malformed event filtering
// Feature: meetup-sync, Property 7: malformed event filtering
// **Validates: Requirements 9.3**
// ============================================================

describe('Feature: meetup-sync, Property 7: malformed event filtering', () => {
  /** Generate a malformed event node missing at least one required field */
  const malformedEventNodeArb: fc.Arbitrary<MeetupGraphQLEventNode> = fc
    .record({
      id: fc.option(fc.uuid(), { nil: undefined }),
      title: fc.option(safeStringArb, { nil: undefined }),
      dateTime: fc.option(dateTimeArb, { nil: undefined }),
      eventUrl: fc.option(fc.webUrl(), { nil: undefined }),
      going: fc.option(
        fc.record({ totalCount: fc.integer({ min: 0, max: 500 }) }),
        { nil: undefined },
      ),
      venue: fc.option(
        fc.record({ name: safeStringArb, city: safeStringArb }),
        { nil: undefined },
      ),
    })
    .filter((node) => !node.id || !node.title || !node.dateTime);

  it('mapMeetupEvent returns null for events missing required fields (id, title, or dateTime)', () => {
    fc.assert(
      fc.property(malformedEventNodeArb, groupArb, (node, group) => {
        const result = mapMeetupEvent(node, group);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('given a mixed list of valid and malformed events, only valid events are mapped', () => {
    fc.assert(
      fc.property(
        fc.array(validEventNodeArb, { minLength: 0, maxLength: 10 }),
        fc.array(malformedEventNodeArb, { minLength: 0, maxLength: 10 }),
        groupArb,
        (validNodes, malformedNodes, group) => {
          const allNodes = [...validNodes, ...malformedNodes];

          const results = allNodes
            .map((node) => mapMeetupEvent(node, group))
            .filter((r): r is NonNullable<typeof r> => r !== null);

          // Valid events count should equal the number of valid input nodes
          expect(results.length).toBe(validNodes.length);

          // Result count is always ≤ total input count
          expect(results.length).toBeLessThanOrEqual(allNodes.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
