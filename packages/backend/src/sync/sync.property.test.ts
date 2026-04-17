/**
 * Property 5: Activity sync deduplication prevents duplicate records
 * Feature: activity-points-tracking, Property 5: Activity sync deduplication prevents duplicate records
 * **Validates: Requirements 7.3**
 *
 * For any set of activity records, syncing the same activities (same topic + activityDate + ugName
 * combination) multiple times should not create duplicate records in the Activities table.
 * The number of records after N syncs of the same data should equal the number of unique activities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { SyncConfig } from './handler';

// ============================================================
// Mock feishu-scraper and feishu-api modules BEFORE importing handler
// ============================================================

// Activities returned by the mock scraper — set per test iteration
let mockScrapedActivities: Array<{
  activityType: string;
  ugName: string;
  topic: string;
  activityDate: string;
}> = [];

vi.mock('./feishu-scraper', () => ({
  scrapeFeishuBitable: vi.fn(async () => ({
    success: true,
    activities: mockScrapedActivities,
  })),
}));

vi.mock('./feishu-api', () => ({
  fetchFeishuBitableApi: vi.fn(async () => ({
    success: true,
    activities: mockScrapedActivities,
  })),
}));

// Import syncActivities AFTER mocks are set up
import { syncActivities } from './handler';

// ============================================================
// Arbitraries
// ============================================================

/** Generate a valid activity date in YYYY-MM-DD format */
const activityDateArb = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );

/** Generate a non-empty alphanumeric string (avoids '#' which is the dedupeKey separator) */
const safeStringArb = fc
  .stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff]+$/)
  .filter(s => s.length >= 1 && s.length <= 30);

/** Generate a single raw activity record */
const rawActivityArb = fc.record({
  activityType: fc.constantFrom('线上活动', '线下活动'),
  ugName: safeStringArb,
  topic: safeStringArb,
  activityDate: activityDateArb,
});

/** Generate a set of unique activities (unique by dedupeKey = topic#date#ugName) */
const uniqueActivitiesArb = fc
  .array(rawActivityArb, { minLength: 1, maxLength: 15 })
  .map(activities => {
    const seen = new Set<string>();
    return activities.filter(a => {
      const key = `${a.topic}#${a.activityDate}#${a.ugName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .filter(arr => arr.length >= 1);

// ============================================================
// Test helpers
// ============================================================

/** Build a SyncConfig that uses web scraping (no API credentials) */
function buildSyncConfig(): SyncConfig {
  return {
    settingKey: 'activity-sync-config',
    syncIntervalDays: 1,
    feishuTableUrl: 'https://example.feishu.cn/base/test123',
    feishuAppId: '',
    feishuAppSecret: '',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test-user',
  };
}

/**
 * Create a mock DynamoDB document client that:
 * - Tracks all PutCommand calls
 * - Simulates the dedupeKey-index GSI by maintaining an in-memory set of written dedupeKeys
 */
function createMockDynamoClient() {
  const writtenDedupeKeys = new Set<string>();
  const putCalls: Array<{ dedupeKey: string; item: Record<string, unknown> }> = [];

  const mockClient = {
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;

      if (commandName === 'QueryCommand') {
        // Simulate dedupeKey-index GSI lookup
        const dedupeKey = command.input.ExpressionAttributeValues?.[':dk'] as string;
        const exists = writtenDedupeKeys.has(dedupeKey);
        return Promise.resolve({ Count: exists ? 1 : 0 });
      }

      if (commandName === 'PutCommand') {
        // Record the write and add dedupeKey to the set
        const item = command.input.Item as Record<string, unknown>;
        const dedupeKey = item.dedupeKey as string;
        writtenDedupeKeys.add(dedupeKey);
        putCalls.push({ dedupeKey, item });
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;

  return { mockClient, putCalls, writtenDedupeKeys };
}

// ============================================================
// Property Test
// ============================================================

describe('Feature: activity-points-tracking, Property 5: Activity sync deduplication prevents duplicate records', () => {
  const ACTIVITIES_TABLE = 'Activities';

  beforeEach(() => {
    vi.clearAllMocks();
    mockScrapedActivities = [];
  });

  it('syncing the same activities twice produces exactly N PutCommand calls (not 2N)', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueActivitiesArb, async (activities) => {
        // Set the mock scraper to return these activities
        mockScrapedActivities = activities;

        const config = buildSyncConfig();
        const { mockClient, putCalls } = createMockDynamoClient();

        // First sync — should write all N unique activities
        const result1 = await syncActivities(config, mockClient, ACTIVITIES_TABLE);
        expect(result1.success).toBe(true);
        expect(result1.syncedCount).toBe(activities.length);
        expect(result1.skippedCount).toBe(0);

        const putCountAfterFirstSync = putCalls.length;
        expect(putCountAfterFirstSync).toBe(activities.length);

        // Second sync — same activities, should skip all (dedupeKey already exists)
        const result2 = await syncActivities(config, mockClient, ACTIVITIES_TABLE);
        expect(result2.success).toBe(true);
        expect(result2.syncedCount).toBe(0);
        expect(result2.skippedCount).toBe(activities.length);

        // Total PutCommand calls should still be N, not 2N
        expect(putCalls.length).toBe(activities.length);
      }),
      { numRuns: 100 },
    );
  });

  it('activities with duplicate dedupeKeys within a single batch are only written once', async () => {
    await fc.assert(
      fc.asyncProperty(
        rawActivityArb,
        fc.integer({ min: 2, max: 5 }),
        async (activity, duplicateCount) => {
          // Create a batch with the same activity repeated multiple times
          mockScrapedActivities = Array.from({ length: duplicateCount }, () => ({ ...activity }));

          const config = buildSyncConfig();
          const { mockClient, putCalls } = createMockDynamoClient();

          const result = await syncActivities(config, mockClient, ACTIVITIES_TABLE);
          expect(result.success).toBe(true);

          // Only 1 PutCommand should have been issued (first occurrence writes, rest are skipped)
          expect(putCalls.length).toBe(1);
          expect(result.syncedCount).toBe(1);
          expect(result.skippedCount).toBe(duplicateCount - 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the number of records after N syncs equals the number of unique activities', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueActivitiesArb,
        fc.integer({ min: 2, max: 5 }),
        async (activities, syncCount) => {
          mockScrapedActivities = activities;

          const config = buildSyncConfig();
          const { mockClient, putCalls } = createMockDynamoClient();

          // Sync N times
          for (let i = 0; i < syncCount; i++) {
            const result = await syncActivities(config, mockClient, ACTIVITIES_TABLE);
            expect(result.success).toBe(true);
          }

          // Total PutCommand calls should equal the number of unique activities
          expect(putCalls.length).toBe(activities.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
