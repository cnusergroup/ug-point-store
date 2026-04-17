import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ============================================================
// Pure function extracted from LeaderboardPage component logic
// ============================================================

/**
 * Determines tab visibility based on feature toggle states.
 *
 * Mirrors the logic in LeaderboardPage:
 *   showTabs = rankingEnabled && announcementEnabled
 *   showRanking = rankingEnabled
 *   showAnnouncement = announcementEnabled
 *   bothDisabled = !rankingEnabled && !announcementEnabled
 */
export function getTabVisibility(
  rankingEnabled: boolean,
  announcementEnabled: boolean,
): {
  showTabs: boolean;
  showRanking: boolean;
  showAnnouncement: boolean;
  disabled?: boolean;
} {
  const showTabs = rankingEnabled && announcementEnabled;
  const showRanking = rankingEnabled;
  const showAnnouncement = announcementEnabled;
  const bothDisabled = !rankingEnabled && !announcementEnabled;

  if (bothDisabled) {
    return { showTabs: false, showRanking: false, showAnnouncement: false, disabled: true };
  }

  return { showTabs, showRanking, showAnnouncement };
}

// ============================================================
// Property 6: Tab visibility is determined by toggle state
// Feature: points-leaderboard, Property 6: Tab visibility is determined by toggle state
// Validates: Requirements 2.4, 2.5, 2.6, 2.7, 8.3, 8.4
// ============================================================

describe('Feature: points-leaderboard, Property 6: Tab visibility is determined by toggle state', () => {
  it('tab visibility is fully determined by the (rankingEnabled, announcementEnabled) toggle pair', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (rankingEnabled, announcementEnabled) => {
          const result = getTabVisibility(rankingEnabled, announcementEnabled);

          if (rankingEnabled && announcementEnabled) {
            // Both enabled: tabs visible, both panels visible
            expect(result).toEqual({
              showTabs: true,
              showRanking: true,
              showAnnouncement: true,
            });
          } else if (rankingEnabled && !announcementEnabled) {
            // Only ranking enabled: no tab switcher, only ranking visible
            expect(result).toEqual({
              showTabs: false,
              showRanking: true,
              showAnnouncement: false,
            });
          } else if (!rankingEnabled && announcementEnabled) {
            // Only announcement enabled: no tab switcher, only announcement visible
            expect(result).toEqual({
              showTabs: false,
              showRanking: false,
              showAnnouncement: true,
            });
          } else {
            // Both disabled: feature not available
            expect(result).toEqual({
              showTabs: false,
              showRanking: false,
              showAnnouncement: false,
              disabled: true,
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('showTabs is true if and only if both toggles are true', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (rankingEnabled, announcementEnabled) => {
          const result = getTabVisibility(rankingEnabled, announcementEnabled);
          expect(result.showTabs).toBe(rankingEnabled && announcementEnabled);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('showRanking equals rankingEnabled', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (rankingEnabled, announcementEnabled) => {
          const result = getTabVisibility(rankingEnabled, announcementEnabled);
          expect(result.showRanking).toBe(rankingEnabled);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('showAnnouncement equals announcementEnabled', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (rankingEnabled, announcementEnabled) => {
          const result = getTabVisibility(rankingEnabled, announcementEnabled);
          expect(result.showAnnouncement).toBe(announcementEnabled);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('disabled flag is present only when both toggles are false', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (rankingEnabled, announcementEnabled) => {
          const result = getTabVisibility(rankingEnabled, announcementEnabled);
          if (!rankingEnabled && !announcementEnabled) {
            expect(result.disabled).toBe(true);
          } else {
            expect(result.disabled).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
