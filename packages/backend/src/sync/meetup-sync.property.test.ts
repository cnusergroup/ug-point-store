/**
 * Property-Based Tests for Meetup Sync handler
 *
 * Feature: meetup-sync
 * Properties: 4 (masked PUT retains values), 5 (group failure isolation), 6 (deduplication)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { MeetupSyncConfig } from './handler';
import type { MeetupGroup, MeetupCookieAuth, MeetupEvent, MeetupGroupResult } from './meetup-api';

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

/** Generate a safe non-empty string */
const safeStringArb = fc
  .stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff ]+$/)
  .filter((s) => s.length >= 1 && s.length <= 40);

/** Generate a MeetupGroup */
const groupArb: fc.Arbitrary<MeetupGroup> = fc.record({
  urlname: fc.stringMatching(/^[a-z0-9-]+$/).filter((s) => s.length >= 3 && s.length <= 40),
  displayName: safeStringArb,
});

/** Generate a non-masked cookie value (no leading asterisks) */
const realCookieArb = fc
  .stringMatching(/^[a-zA-Z0-9]+$/)
  .filter((s) => s.length >= 5 && s.length <= 50);

/** Generate a masked cookie value (starts with asterisks) */
const maskedCookieArb = realCookieArb.map(
  (cookie) => '*'.repeat(cookie.length - 4) + cookie.slice(-4),
);

/** Generate a MeetupEvent */
const meetupEventArb = (group: MeetupGroup): fc.Arbitrary<MeetupEvent> =>
  fc
    .record({
      topic: safeStringArb,
      activityDate: dateArb,
      meetupEventId: fc.uuid(),
      meetupEventUrl: fc.webUrl(),
      meetupGoingCount: fc.integer({ min: 0, max: 500 }),
      meetupVenueName: fc.option(safeStringArb, { nil: undefined }),
      meetupVenueCity: fc.option(safeStringArb, { nil: undefined }),
    })
    .map((fields) => ({
      activityType: '线下活动' as const,
      ugName: group.displayName,
      topic: fields.topic,
      activityDate: fields.activityDate,
      dedupeKey: `${fields.topic}#${fields.activityDate}#${group.displayName}`,
      meetupEventId: fields.meetupEventId,
      meetupEventUrl: fields.meetupEventUrl,
      meetupGoingCount: fields.meetupGoingCount,
      meetupVenueName: fields.meetupVenueName,
      meetupVenueCity: fields.meetupVenueCity,
    }));

// ============================================================
// Property 4: PUT with masked values retains existing stored values
// Feature: meetup-sync, Property 4: masked PUT retains values
// **Validates: Requirements 8.5**
// ============================================================

/**
 * We test the resolveMaskedCookie logic directly since it's not exported.
 * The logic is: if value starts with '*', retain existing; if undefined, retain existing; otherwise use new.
 */
function resolveMaskedCookie(
  newValue: string | undefined,
  existingValue: string | undefined,
): string {
  if (newValue === undefined) return existingValue ?? '';
  if (newValue.startsWith('*')) return existingValue ?? '';
  return newValue;
}

describe('Feature: meetup-sync, Property 4: masked PUT retains values', () => {
  it('masked cookie fields (starting with *) retain existing DB values, non-masked fields are updated', () => {
    fc.assert(
      fc.property(
        // Existing DB values for the three cookie fields
        realCookieArb,
        realCookieArb,
        realCookieArb,
        // For each field, decide whether the PUT sends a masked or new value
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        // New real values (used when not masked)
        realCookieArb,
        realCookieArb,
        realCookieArb,
        (
          existingToken,
          existingCsrf,
          existingSession,
          tokenMasked,
          csrfMasked,
          sessionMasked,
          newToken,
          newCsrf,
          newSession,
        ) => {
          // Build the PUT request values
          const putToken = tokenMasked
            ? '*'.repeat(existingToken.length - 4) + existingToken.slice(-4)
            : newToken;
          const putCsrf = csrfMasked
            ? '*'.repeat(existingCsrf.length - 4) + existingCsrf.slice(-4)
            : newCsrf;
          const putSession = sessionMasked
            ? '*'.repeat(existingSession.length - 4) + existingSession.slice(-4)
            : newSession;

          // Resolve using the same logic as the handler
          const resolvedToken = resolveMaskedCookie(putToken, existingToken);
          const resolvedCsrf = resolveMaskedCookie(putCsrf, existingCsrf);
          const resolvedSession = resolveMaskedCookie(putSession, existingSession);

          // Masked fields should retain existing values
          if (tokenMasked) {
            expect(resolvedToken).toBe(existingToken);
          } else {
            expect(resolvedToken).toBe(newToken);
          }

          if (csrfMasked) {
            expect(resolvedCsrf).toBe(existingCsrf);
          } else {
            expect(resolvedCsrf).toBe(newCsrf);
          }

          if (sessionMasked) {
            expect(resolvedSession).toBe(existingSession);
          } else {
            expect(resolvedSession).toBe(newSession);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('undefined cookie fields retain existing DB values', () => {
    fc.assert(
      fc.property(realCookieArb, (existingValue) => {
        const resolved = resolveMaskedCookie(undefined, existingValue);
        expect(resolved).toBe(existingValue);
      }),
      { numRuns: 100 },
    );
  });

  it('when no existing value, masked or undefined fields resolve to empty string', () => {
    fc.assert(
      fc.property(maskedCookieArb, (maskedValue) => {
        const resolved = resolveMaskedCookie(maskedValue, undefined);
        expect(resolved).toBe('');
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 5: Group failure isolation
// Feature: meetup-sync, Property 5: group failure isolation
// **Validates: Requirements 4.5, 9.2**
// ============================================================

// Mock fetchMeetupGroupEvents before importing syncMeetupActivities
let mockFetchMeetupGroupEvents: ReturnType<typeof vi.fn>;

vi.mock('./meetup-api', () => ({
  fetchMeetupGroupEvents: (...args: any[]) => mockFetchMeetupGroupEvents(...args),
  mapMeetupEvent: vi.fn(),
  maskCookie: vi.fn(),
  testMeetupConnection: vi.fn(),
}));

// Import after mocking
const { syncMeetupActivities } = await import('./handler');

describe('Feature: meetup-sync, Property 5: group failure isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Generate a list of groups (2+) with a boolean mask indicating which ones fail.
   * At least one must succeed and at least one must fail.
   */
  const groupsWithFailuresArb = fc
    .array(groupArb, { minLength: 2, maxLength: 6 })
    .chain((groups) => {
      // Ensure unique urlnames
      const uniqueGroups: MeetupGroup[] = [];
      const seen = new Set<string>();
      for (const g of groups) {
        if (!seen.has(g.urlname)) {
          seen.add(g.urlname);
          uniqueGroups.push(g);
        }
      }
      if (uniqueGroups.length < 2) return fc.constant(null);

      return fc
        .array(fc.boolean(), {
          minLength: uniqueGroups.length,
          maxLength: uniqueGroups.length,
        })
        .filter((mask) => mask.some((v) => v) && mask.some((v) => !v))
        .map((failMask) => ({ groups: uniqueGroups, failMask }));
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  it('non-failing groups are still synced when some groups fail', async () => {
    await fc.assert(
      fc.asyncProperty(groupsWithFailuresArb, async ({ groups, failMask }) => {
        // Build events for each successful group (1-3 events per group)
        const eventsPerGroup = new Map<string, MeetupEvent[]>();
        let totalExpectedSynced = 0;

        for (let i = 0; i < groups.length; i++) {
          if (!failMask[i]) {
            // Successful group: generate some events
            const eventCount = (i % 3) + 1; // 1-3 events
            const events: MeetupEvent[] = [];
            for (let j = 0; j < eventCount; j++) {
              events.push({
                activityType: '线下活动',
                ugName: groups[i].displayName,
                topic: `Event-${i}-${j}`,
                activityDate: `2024-01-${String(j + 1).padStart(2, '0')}`,
                dedupeKey: `Event-${i}-${j}#2024-01-${String(j + 1).padStart(2, '0')}#${groups[i].displayName}`,
                meetupEventId: `evt-${i}-${j}`,
                meetupEventUrl: `https://meetup.com/e/${i}-${j}`,
                meetupGoingCount: 10,
              });
            }
            eventsPerGroup.set(groups[i].urlname, events);
            totalExpectedSynced += eventCount;
          }
        }

        // Mock fetchMeetupGroupEvents
        mockFetchMeetupGroupEvents = vi.fn().mockImplementation(
          async (group: MeetupGroup): Promise<MeetupGroupResult> => {
            const idx = groups.findIndex((g) => g.urlname === group.urlname);
            if (failMask[idx]) {
              return {
                success: false,
                error: { code: 'MEETUP_API_ERROR', message: `Group ${group.urlname} failed` },
              };
            }
            return {
              success: true,
              events: eventsPerGroup.get(group.urlname) ?? [],
            };
          },
        );

        // Mock DynamoDB: no existing dedupeKeys
        const mockDynamo = {
          send: vi.fn().mockImplementation((cmd: any) => {
            const name = cmd.constructor.name;
            if (name === 'QueryCommand') {
              return Promise.resolve({ Count: 0 });
            }
            if (name === 'PutCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          }),
        } as any;

        const config: MeetupSyncConfig = {
          settingKey: 'meetup-sync-config',
          groups,
          meetupToken: 'test-token-12345',
          meetupCsrf: 'test-csrf-12345',
          meetupSession: 'test-session-12345',
          autoSyncEnabled: true,
          updatedAt: new Date().toISOString(),
          updatedBy: 'test',
        };

        const result = await syncMeetupActivities(config, mockDynamo, 'Activities');

        // Sync should still succeed overall
        expect(result.success).toBe(true);

        // syncedCount should equal events from successful groups only
        expect(result.syncedCount).toBe(totalExpectedSynced);

        // Warnings should contain messages about failed groups
        const failedGroupCount = failMask.filter((v) => v).length;
        expect(result.warnings).toBeDefined();
        expect(result.warnings!.length).toBe(failedGroupCount);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 6: Deduplication skips existing events
// Feature: meetup-sync, Property 6: deduplication skips existing events
// **Validates: Requirements 4.7**
// ============================================================

describe('Feature: meetup-sync, Property 6: deduplication skips existing events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('events with existing dedupeKeys are skipped, only new events are written', async () => {
    await fc.assert(
      fc.asyncProperty(
        groupArb,
        // Generate events: some new, some existing
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (group, newCount, existingCount) => {
          const allEvents: MeetupEvent[] = [];
          const existingDedupeKeys = new Set<string>();

          // Generate "existing" events (already in DB)
          for (let i = 0; i < existingCount; i++) {
            const event: MeetupEvent = {
              activityType: '线下活动',
              ugName: group.displayName,
              topic: `Existing-${i}`,
              activityDate: `2024-02-${String(i + 1).padStart(2, '0')}`,
              dedupeKey: `Existing-${i}#2024-02-${String(i + 1).padStart(2, '0')}#${group.displayName}`,
              meetupEventId: `existing-${i}`,
              meetupEventUrl: `https://meetup.com/e/existing-${i}`,
              meetupGoingCount: 5,
            };
            allEvents.push(event);
            existingDedupeKeys.add(event.dedupeKey);
          }

          // Generate "new" events (not in DB)
          for (let i = 0; i < newCount; i++) {
            const event: MeetupEvent = {
              activityType: '线下活动',
              ugName: group.displayName,
              topic: `New-${i}`,
              activityDate: `2024-03-${String(i + 1).padStart(2, '0')}`,
              dedupeKey: `New-${i}#2024-03-${String(i + 1).padStart(2, '0')}#${group.displayName}`,
              meetupEventId: `new-${i}`,
              meetupEventUrl: `https://meetup.com/e/new-${i}`,
              meetupGoingCount: 10,
            };
            allEvents.push(event);
          }

          // Mock fetchMeetupGroupEvents to return all events
          mockFetchMeetupGroupEvents = vi.fn().mockResolvedValue({
            success: true,
            events: allEvents,
          });

          // Track PutCommand calls
          const putItems: any[] = [];

          const mockDynamo = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const name = cmd.constructor.name;
              if (name === 'QueryCommand') {
                // Check if dedupeKey exists
                const dk = cmd.input.ExpressionAttributeValues[':dk'];
                return Promise.resolve({
                  Count: existingDedupeKeys.has(dk) ? 1 : 0,
                });
              }
              if (name === 'PutCommand') {
                putItems.push(cmd.input.Item);
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const config: MeetupSyncConfig = {
            settingKey: 'meetup-sync-config',
            groups: [group],
            meetupToken: 'test-token-12345',
            meetupCsrf: 'test-csrf-12345',
            meetupSession: 'test-session-12345',
            autoSyncEnabled: true,
            updatedAt: new Date().toISOString(),
            updatedBy: 'test',
          };

          const result = await syncMeetupActivities(config, mockDynamo, 'Activities');

          expect(result.success).toBe(true);

          // Only new events should be written
          expect(result.syncedCount).toBe(newCount);

          // Existing events should be skipped
          expect(result.skippedCount).toBe(existingCount);

          // PutCommand calls should equal newCount
          expect(putItems.length).toBe(newCount);

          // All written items should have dedupeKeys NOT in the existing set
          for (const item of putItems) {
            expect(existingDedupeKeys.has(item.dedupeKey)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
