import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterActivities, ActivityItem } from './activity-filter';

// ============================================================
// Property 6: Activity selector filters by active UG and search query
// Feature: activity-points-tracking, Property 6: Activity selector filters by active UG and search query
// **Validates: Requirements 14.2, 14.3**
// ============================================================

// ============================================================
// Arbitraries
// ============================================================

const ALL_UG_NAMES = ['Tokyo UG', 'Osaka UG', 'Security UG', 'Kiro UG', 'Hangzhou UG', 'Seoul UG', 'Berlin UG'];
const ACTIVITY_TYPES = ['线上活动', '线下活动'] as const;

/** Generate a random ISO date string (YYYY-MM-DD) */
const dateArb = fc
  .integer({ min: 0, max: 3650 })
  .map((dayOffset) => {
    const d = new Date(2020, 0, 1);
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  });

/** Generate a random activity record */
const activityArb = fc.record({
  activityId: fc.uuid(),
  activityType: fc.constantFrom(...ACTIVITY_TYPES),
  ugName: fc.constantFrom(...ALL_UG_NAMES),
  topic: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  activityDate: dateArb,
  syncedAt: fc.constant('2024-01-01T00:00:00Z'),
  sourceUrl: fc.constant('https://feishu.cn/table/xxx'),
});

/** Generate a set of activities (1–30) */
const activitySetArb = fc.array(activityArb, { minLength: 1, maxLength: 30 });

/** Generate a subset of UG names to be "active" */
const activeUGNamesArb = fc
  .subarray(ALL_UG_NAMES, { minLength: 0, maxLength: ALL_UG_NAMES.length })
  .map((names) => new Set(names));

/** Generate a search query (may be empty) */
const searchQueryArb = fc.oneof(
  fc.constant(''),
  fc.constant('  '),
  fc.constantFrom(...ALL_UG_NAMES).map((n) => n.substring(0, 3)),
  fc.string({ minLength: 1, maxLength: 10 }),
  // Use a fragment from a date to test activityDate matching
  dateArb.map((d) => d.substring(0, 7)),
);

// ============================================================
// Tests
// ============================================================

describe('Feature: activity-points-tracking, Property 6: Activity selector filters by active UG and search query', () => {
  // ----------------------------------------------------------
  // 6a: Filtered results only include activities from active UGs
  // ----------------------------------------------------------
  it('filtered results only include activities whose ugName is in activeUGNames', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        activeUGNamesArb,
        searchQueryArb,
        (activities, activeUGNames, searchQuery) => {
          const result = filterActivities(activities, activeUGNames, searchQuery);

          for (const activity of result) {
            expect(activeUGNames.has(activity.ugName)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 6b: Filtered results match the search keyword (case-insensitive)
  // ----------------------------------------------------------
  it('when search query is non-empty, filtered results match on ugName, topic, or activityDate (case-insensitive)', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        activeUGNamesArb,
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        (activities, activeUGNames, searchQuery) => {
          const result = filterActivities(activities, activeUGNames, searchQuery);
          const q = searchQuery.trim().toLowerCase();

          for (const activity of result) {
            const matchesUgName = activity.ugName.toLowerCase().includes(q);
            const matchesTopic = activity.topic.toLowerCase().includes(q);
            const matchesDate = activity.activityDate.includes(q);
            expect(matchesUgName || matchesTopic || matchesDate).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 6c: No matching activity should be excluded (completeness)
  // ----------------------------------------------------------
  it('no activity that matches both active UG and search query is excluded from results', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        activeUGNamesArb,
        searchQueryArb,
        (activities, activeUGNames, searchQuery) => {
          const result = filterActivities(activities, activeUGNames, searchQuery);
          const resultIds = new Set(result.map((a) => a.activityId));

          // Manually compute expected matches
          for (const activity of activities) {
            if (!activeUGNames.has(activity.ugName)) continue;

            if (searchQuery.trim()) {
              const q = searchQuery.trim().toLowerCase();
              const matches =
                activity.ugName.toLowerCase().includes(q) ||
                activity.topic.toLowerCase().includes(q) ||
                activity.activityDate.includes(q);
              if (!matches) continue;
            }

            // This activity should be in the result
            expect(resultIds.has(activity.activityId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 6d: Empty search query does not filter by keyword
  // ----------------------------------------------------------
  it('when search query is empty or whitespace-only, all active-UG activities are returned', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        activeUGNamesArb,
        fc.constantFrom('', '  ', '   '),
        (activities, activeUGNames, searchQuery) => {
          const result = filterActivities(activities, activeUGNames, searchQuery);
          const expected = activities.filter((a) => activeUGNames.has(a.ugName));

          expect(result.length).toBe(expected.length);
          const resultIds = new Set(result.map((a) => a.activityId));
          for (const act of expected) {
            expect(resultIds.has(act.activityId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 6e: Empty activeUGNames returns no results
  // ----------------------------------------------------------
  it('when activeUGNames is empty, no activities are returned regardless of search query', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        searchQueryArb,
        (activities, searchQuery) => {
          const emptySet = new Set<string>();
          const result = filterActivities(activities, emptySet, searchQuery);
          expect(result.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ----------------------------------------------------------
  // 6f: Result is a subset of the input activities
  // ----------------------------------------------------------
  it('result is always a subset of the input activities', async () => {
    fc.assert(
      fc.property(
        activitySetArb,
        activeUGNamesArb,
        searchQueryArb,
        (activities, activeUGNames, searchQuery) => {
          const result = filterActivities(activities, activeUGNames, searchQuery);
          const inputIds = new Set(activities.map((a) => a.activityId));

          expect(result.length).toBeLessThanOrEqual(activities.length);
          for (const activity of result) {
            expect(inputIds.has(activity.activityId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
