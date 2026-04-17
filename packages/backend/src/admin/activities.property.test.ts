import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { listActivities } from './activities';

// ============================================================
// Property 9: Activity list query returns filtered results in descending date order
// Feature: activity-points-tracking, Property 9: Activity list query returns filtered results in descending date order
// **Validates: Requirements 19.2, 19.3, 19.4**
// ============================================================

// ============================================================
// Arbitraries
// ============================================================

const UG_NAMES = ['Tokyo UG', 'Osaka UG', 'Security UG', 'Kiro UG', 'Hangzhou UG'];
const ACTIVITY_TYPES = ['线上活动', '线下活动'] as const;

/** Generate a random ISO date string (YYYY-MM-DD) within a reasonable range */
const dateArb = fc
  .integer({ min: 0, max: 3650 }) // ~10 years of days
  .map((dayOffset) => {
    const d = new Date(2020, 0, 1);
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  });

/** Generate a random activity record */
const activityRecordArb = fc.record({
  activityId: fc.uuid(),
  pk: fc.constant('ALL'),
  activityType: fc.constantFrom(...ACTIVITY_TYPES),
  ugName: fc.constantFrom(...UG_NAMES),
  topic: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  activityDate: dateArb,
  syncedAt: fc.constant('2024-01-01T00:00:00Z'),
  sourceUrl: fc.constant('https://feishu.cn/table/xxx'),
});

/** Generate a set of activity records (1–30) */
const activitySetArb = fc.array(activityRecordArb, { minLength: 1, maxLength: 30 });

// ============================================================
// Helpers
// ============================================================

/**
 * Simulate what DynamoDB would return for a given set of activities and query options.
 * This applies the same filtering/sorting logic that DynamoDB + GSI would perform,
 * so we can verify that listActivities builds the correct query parameters.
 */
function simulateDBResult(
  activities: Array<Record<string, any>>,
  options: {
    ugName?: string;
    startDate?: string;
    endDate?: string;
    keyword?: string;
    pageSize?: number;
  },
) {
  let filtered = [...activities];

  // Date range filter (KeyConditionExpression on activityDate SK)
  if (options.startDate && options.endDate) {
    filtered = filtered.filter(
      (a) => a.activityDate >= options.startDate! && a.activityDate <= options.endDate!,
    );
  } else if (options.startDate) {
    filtered = filtered.filter((a) => a.activityDate >= options.startDate!);
  } else if (options.endDate) {
    filtered = filtered.filter((a) => a.activityDate <= options.endDate!);
  }

  // ugName filter (FilterExpression)
  if (options.ugName) {
    filtered = filtered.filter((a) => a.ugName === options.ugName);
  }

  // keyword filter (FilterExpression contains on topic)
  if (options.keyword) {
    filtered = filtered.filter((a) => a.topic.includes(options.keyword!));
  }

  // Sort by activityDate descending (ScanIndexForward=false)
  filtered.sort((a, b) => b.activityDate.localeCompare(a.activityDate));

  // Clamp pageSize
  const rawPageSize = options.pageSize ?? 20;
  const pageSize = Math.max(1, Math.min(100, Math.floor(rawPageSize)));

  // Limit to pageSize
  const page = filtered.slice(0, pageSize);

  return { page, totalFiltered: filtered.length, pageSize };
}

function createMockDynamoClient(items: any[]) {
  return {
    send: vi.fn().mockResolvedValue({ Items: items }),
  } as any;
}

// ============================================================
// Tests
// ============================================================

describe('Feature: activity-points-tracking, Property 9: Activity list query returns filtered results in descending date order', () => {
  const ACTIVITIES_TABLE = 'Activities';

  // ----------------------------------------------------------
  // 9a: ugName filter is correctly applied
  // ----------------------------------------------------------
  it('when ugName is provided, FilterExpression includes ugName filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        activitySetArb,
        fc.constantFrom(...UG_NAMES),
        async (activities, ugName) => {
          const { page } = simulateDBResult(activities, { ugName });
          const client = createMockDynamoClient(page);

          const result = await listActivities({ ugName }, client, ACTIVITIES_TABLE);

          expect(result.success).toBe(true);

          // Verify the QueryCommand was built with ugName filter
          const queryCmd = client.send.mock.calls[0][0];
          expect(queryCmd.input.FilterExpression).toContain('#ugName = :ugName');
          expect(queryCmd.input.ExpressionAttributeValues[':ugName']).toBe(ugName);
          expect(queryCmd.input.ExpressionAttributeNames['#ugName']).toBe('ugName');

          // All returned activities should match the ugName
          for (const act of result.activities!) {
            expect(act.ugName).toBe(ugName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 9b: date range filter is correctly applied
  // ----------------------------------------------------------
  it('when startDate/endDate are provided, KeyConditionExpression includes date range', async () => {
    await fc.assert(
      fc.asyncProperty(
        activitySetArb,
        dateArb,
        dateArb,
        async (activities, date1, date2) => {
          // Ensure startDate <= endDate
          const startDate = date1 <= date2 ? date1 : date2;
          const endDate = date1 <= date2 ? date2 : date1;

          const { page } = simulateDBResult(activities, { startDate, endDate });
          const client = createMockDynamoClient(page);

          const result = await listActivities({ startDate, endDate }, client, ACTIVITIES_TABLE);

          expect(result.success).toBe(true);

          // Verify the QueryCommand was built with date range in KeyConditionExpression
          const queryCmd = client.send.mock.calls[0][0];
          expect(queryCmd.input.KeyConditionExpression).toContain('BETWEEN');
          expect(queryCmd.input.ExpressionAttributeValues[':startDate']).toBe(startDate);
          expect(queryCmd.input.ExpressionAttributeValues[':endDate']).toBe(endDate);

          // All returned activities should be within the date range
          for (const act of result.activities!) {
            expect(act.activityDate >= startDate).toBe(true);
            expect(act.activityDate <= endDate).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 9c: keyword filter is correctly applied
  // ----------------------------------------------------------
  it('when keyword is provided, FilterExpression includes contains(topic, keyword)', async () => {
    await fc.assert(
      fc.asyncProperty(
        activitySetArb,
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        async (activities, keyword) => {
          const { page } = simulateDBResult(activities, { keyword });
          const client = createMockDynamoClient(page);

          const result = await listActivities({ keyword }, client, ACTIVITIES_TABLE);

          expect(result.success).toBe(true);

          // Verify the QueryCommand was built with keyword filter
          const queryCmd = client.send.mock.calls[0][0];
          expect(queryCmd.input.FilterExpression).toContain('contains(#topic, :keyword)');
          expect(queryCmd.input.ExpressionAttributeValues[':keyword']).toBe(keyword);
          expect(queryCmd.input.ExpressionAttributeNames['#topic']).toBe('topic');

          // All returned activities should contain the keyword in topic
          for (const act of result.activities!) {
            expect(act.topic).toContain(keyword);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 9d: all filters applied simultaneously
  // ----------------------------------------------------------
  it('ugName, date range, and keyword filters are applied simultaneously', async () => {
    await fc.assert(
      fc.asyncProperty(
        activitySetArb,
        fc.constantFrom(...UG_NAMES),
        dateArb,
        dateArb,
        fc.string({ minLength: 1, maxLength: 5 }).filter((s) => s.trim().length > 0),
        async (activities, ugName, date1, date2, keyword) => {
          const startDate = date1 <= date2 ? date1 : date2;
          const endDate = date1 <= date2 ? date2 : date1;

          const { page } = simulateDBResult(activities, { ugName, startDate, endDate, keyword });
          const client = createMockDynamoClient(page);

          const result = await listActivities(
            { ugName, startDate, endDate, keyword },
            client,
            ACTIVITIES_TABLE,
          );

          expect(result.success).toBe(true);

          // Verify query parameters include all filters
          const queryCmd = client.send.mock.calls[0][0];

          // Date range in KeyConditionExpression
          expect(queryCmd.input.KeyConditionExpression).toContain('BETWEEN');

          // ugName and keyword in FilterExpression
          expect(queryCmd.input.FilterExpression).toContain('#ugName = :ugName');
          expect(queryCmd.input.FilterExpression).toContain('contains(#topic, :keyword)');
          expect(queryCmd.input.FilterExpression).toContain(' AND ');

          // All returned activities satisfy all filters
          for (const act of result.activities!) {
            expect(act.ugName).toBe(ugName);
            expect(act.activityDate >= startDate).toBe(true);
            expect(act.activityDate <= endDate).toBe(true);
            expect(act.topic).toContain(keyword);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 9e: ScanIndexForward is always false (descending order)
  // ----------------------------------------------------------
  it('results are always queried with ScanIndexForward=false for descending date order', async () => {
    await fc.assert(
      fc.asyncProperty(
        activitySetArb,
        fc.record({
          ugName: fc.option(fc.constantFrom(...UG_NAMES), { nil: undefined }),
          startDate: fc.option(dateArb, { nil: undefined }),
          endDate: fc.option(dateArb, { nil: undefined }),
          keyword: fc.option(
            fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
            { nil: undefined },
          ),
        }),
        async (activities, queryParams) => {
          const { page } = simulateDBResult(activities, queryParams);
          const client = createMockDynamoClient(page);

          const result = await listActivities(queryParams, client, ACTIVITIES_TABLE);

          expect(result.success).toBe(true);

          // ScanIndexForward must always be false
          const queryCmd = client.send.mock.calls[0][0];
          expect(queryCmd.input.ScanIndexForward).toBe(false);

          // Returned activities must be in descending activityDate order
          const acts = result.activities!;
          for (let i = 1; i < acts.length; i++) {
            expect(acts[i - 1].activityDate >= acts[i].activityDate).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 9f: pageSize is clamped to [1, 100] with default 20
  // ----------------------------------------------------------
  it('pageSize is clamped to [1, 100] with default 20', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.integer({ min: -100, max: 500 }), { nil: undefined }),
        async (pageSize) => {
          const client = createMockDynamoClient([]);

          await listActivities({ pageSize }, client, ACTIVITIES_TABLE);

          const queryCmd = client.send.mock.calls[0][0];
          const actualLimit = queryCmd.input.Limit;

          if (pageSize === undefined) {
            // Default is 20
            expect(actualLimit).toBe(20);
          } else {
            // Clamped to [1, 100]
            const expected = Math.max(1, Math.min(100, Math.floor(pageSize)));
            expect(actualLimit).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
