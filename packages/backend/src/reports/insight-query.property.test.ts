import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  aggregateRedemptionsByProduct,
  calculateStockConsumptionRate,
  calculateEngagementScore,
  aggregateContentByUploader,
  aggregateTravelByPeriod,
  aggregateInviteConversion,
} from './insight-query';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a redemption record with productId and pointsSpent */
const redemptionArb = fc.record({
  productId: fc.constantFrom('prod-A', 'prod-B', 'prod-C', 'prod-D', 'prod-E'),
  pointsSpent: fc.integer({ min: 0, max: 10000 }),
});

/** Arbitrary for a content item record */
const contentItemArb = fc.record({
  uploaderId: fc.constantFrom('user-1', 'user-2', 'user-3', 'user-4', 'user-5'),
  likeCount: fc.integer({ min: 0, max: 10000 }),
  commentCount: fc.integer({ min: 0, max: 10000 }),
});

/** Arbitrary for a travel application record */
const travelApplicationArb = fc.record({
  createdAt: fc.integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-12-31').getTime(),
  }).map(ts => new Date(ts).toISOString()),
  status: fc.constantFrom('approved', 'rejected', 'pending'),
  totalCost: fc.integer({ min: 0, max: 100000 }),
});

/** Arbitrary for an invite record */
const inviteArb = fc.record({
  status: fc.constantFrom('used', 'expired', 'pending'),
});

// ============================================================
// Feature: insight-reports-expansion, Property 1: Redemption count equals occurrence count per productId
// Validates: Requirements 19.1
// ============================================================

describe('Feature: insight-reports-expansion, Property 1: Redemption count per productId', () => {
  it('redemptionCount for each productId equals the number of occurrences in the input array', () => {
    fc.assert(
      fc.property(
        fc.array(redemptionArb, { minLength: 0, maxLength: 50 }),
        (redemptions) => {
          const result = aggregateRedemptionsByProduct(redemptions);

          // Build expected counts independently
          const expectedCounts = new Map<string, number>();
          for (const r of redemptions) {
            expectedCounts.set(r.productId, (expectedCounts.get(r.productId) ?? 0) + 1);
          }

          // Verify each productId has the correct redemptionCount
          expect(result.size).toBe(expectedCounts.size);
          for (const [productId, count] of expectedCounts) {
            const agg = result.get(productId);
            expect(agg).toBeDefined();
            expect(agg!.redemptionCount).toBe(count);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 2: totalPointsSpent equals sum of pointsSpent per productId
// Validates: Requirements 19.2
// ============================================================

describe('Feature: insight-reports-expansion, Property 2: totalPointsSpent per productId', () => {
  it('totalPointsSpent for each productId equals the sum of pointsSpent in the input array', () => {
    fc.assert(
      fc.property(
        fc.array(redemptionArb, { minLength: 0, maxLength: 50 }),
        (redemptions) => {
          const result = aggregateRedemptionsByProduct(redemptions);

          // Build expected sums independently
          const expectedSums = new Map<string, number>();
          for (const r of redemptions) {
            expectedSums.set(r.productId, (expectedSums.get(r.productId) ?? 0) + r.pointsSpent);
          }

          // Verify each productId has the correct totalPointsSpent
          for (const [productId, sum] of expectedSums) {
            const agg = result.get(productId);
            expect(agg).toBeDefined();
            expect(agg!.totalPointsSpent).toBe(sum);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 3: Stock consumption rate formula correctness
// Validates: Requirements 19.3
// ============================================================

describe('Feature: insight-reports-expansion, Property 3: Stock consumption rate formula', () => {
  it('returns redemptionCount / (stock + redemptionCount) × 100 rounded to 1 decimal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (stock, redemptionCount) => {
          const result = calculateStockConsumptionRate(stock, redemptionCount);
          const denominator = stock + redemptionCount;

          if (denominator === 0) {
            expect(result).toBe(0);
          } else {
            const expected = Math.round((redemptionCount / denominator) * 1000) / 10;
            expect(result).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns 0 when both stock and redemptionCount are 0', () => {
    fc.assert(
      fc.property(fc.constant(0), fc.constant(0), (stock, redemptionCount) => {
        expect(calculateStockConsumptionRate(stock, redemptionCount)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 4: Engagement score equals sum of counts
// Validates: Requirements 20.1
// ============================================================

describe('Feature: insight-reports-expansion, Property 4: Engagement score formula', () => {
  it('engagement score equals likeCount + commentCount + reservationCount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (likeCount, commentCount, reservationCount) => {
          const result = calculateEngagementScore(likeCount, commentCount, reservationCount);
          expect(result).toBe(likeCount + commentCount + reservationCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 5: approvedCount per uploaderId equals occurrence count
// Validates: Requirements 20.2
// ============================================================

describe('Feature: insight-reports-expansion, Property 5: approvedCount per uploaderId', () => {
  it('approvedCount for each uploaderId equals the number of occurrences in the input array', () => {
    fc.assert(
      fc.property(
        fc.array(contentItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const result = aggregateContentByUploader(items);

          // Build expected counts independently
          const expectedCounts = new Map<string, number>();
          for (const item of items) {
            expectedCounts.set(item.uploaderId, (expectedCounts.get(item.uploaderId) ?? 0) + 1);
          }

          // Verify each uploaderId has the correct approvedCount
          expect(result.size).toBe(expectedCounts.size);
          for (const [uploaderId, count] of expectedCounts) {
            const agg = result.get(uploaderId);
            expect(agg).toBeDefined();
            expect(agg!.approvedCount).toBe(count);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 6: totalLikes per uploaderId equals sum of likeCount
// Validates: Requirements 20.3
// ============================================================

describe('Feature: insight-reports-expansion, Property 6: totalLikes per uploaderId', () => {
  it('totalLikes for each uploaderId equals the sum of likeCount in the input array', () => {
    fc.assert(
      fc.property(
        fc.array(contentItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const result = aggregateContentByUploader(items);

          // Build expected sums independently
          const expectedSums = new Map<string, number>();
          for (const item of items) {
            expectedSums.set(item.uploaderId, (expectedSums.get(item.uploaderId) ?? 0) + item.likeCount);
          }

          // Verify each uploaderId has the correct totalLikes
          for (const [uploaderId, sum] of expectedSums) {
            const agg = result.get(uploaderId);
            expect(agg).toBeDefined();
            expect(agg!.totalLikes).toBe(sum);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 7: totalApplications equals sum of status counts per period
// Validates: Requirements 21.1
// ============================================================

describe('Feature: insight-reports-expansion, Property 7: totalApplications per period', () => {
  it('totalApplications equals approvedCount + rejectedCount + pendingCount for each period', () => {
    fc.assert(
      fc.property(
        fc.array(travelApplicationArb, { minLength: 0, maxLength: 50 }),
        fc.constantFrom<'month' | 'quarter'>('month', 'quarter'),
        (applications, periodType) => {
          const result = aggregateTravelByPeriod(applications, periodType);

          for (const record of result) {
            expect(record.totalApplications).toBe(
              record.approvedCount + record.rejectedCount + record.pendingCount,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 8: approvalRate formula correctness
// Validates: Requirements 21.2
// ============================================================

describe('Feature: insight-reports-expansion, Property 8: approvalRate formula', () => {
  it('approvalRate equals approvedCount / totalApplications × 100 rounded to 1 decimal, or 0 when totalApplications is 0', () => {
    fc.assert(
      fc.property(
        fc.array(travelApplicationArb, { minLength: 0, maxLength: 50 }),
        fc.constantFrom<'month' | 'quarter'>('month', 'quarter'),
        (applications, periodType) => {
          const result = aggregateTravelByPeriod(applications, periodType);

          for (const record of result) {
            if (record.totalApplications === 0) {
              expect(record.approvalRate).toBe(0);
            } else {
              const expected = Math.round((record.approvedCount / record.totalApplications) * 1000) / 10;
              expect(record.approvalRate).toBe(expected);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 9: totalSponsoredAmount equals sum of totalCost for approved per period
// Validates: Requirements 21.3
// ============================================================

describe('Feature: insight-reports-expansion, Property 9: totalSponsoredAmount per period', () => {
  it('totalSponsoredAmount equals sum of totalCost for approved applications in each period', () => {
    fc.assert(
      fc.property(
        fc.array(travelApplicationArb, { minLength: 0, maxLength: 50 }),
        fc.constantFrom<'month' | 'quarter'>('month', 'quarter'),
        (applications, periodType) => {
          const result = aggregateTravelByPeriod(applications, periodType);

          // Build expected sums independently by period
          const expectedSums = new Map<string, number>();
          for (const app of applications) {
            const date = new Date(app.createdAt);
            const year = date.getFullYear();
            let period: string;
            if (periodType === 'month') {
              const month = String(date.getMonth() + 1).padStart(2, '0');
              period = `${year}-${month}`;
            } else {
              const quarter = Math.ceil((date.getMonth() + 1) / 3);
              period = `${year}-Q${quarter}`;
            }

            if (!expectedSums.has(period)) {
              expectedSums.set(period, 0);
            }
            if (app.status === 'approved') {
              expectedSums.set(period, expectedSums.get(period)! + app.totalCost);
            }
          }

          // Verify each period has the correct totalSponsoredAmount
          for (const record of result) {
            const expected = expectedSums.get(record.period) ?? 0;
            expect(record.totalSponsoredAmount).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 10: totalInvites equals array length
// Validates: Requirements 22.1
// ============================================================

describe('Feature: insight-reports-expansion, Property 10: totalInvites equals array length', () => {
  it('totalInvites equals the length of the input invites array', () => {
    fc.assert(
      fc.property(
        fc.array(inviteArb, { minLength: 0, maxLength: 100 }),
        (invites) => {
          const result = aggregateInviteConversion(invites);
          expect(result.totalInvites).toBe(invites.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 11: usedCount + expiredCount + pendingCount equals totalInvites
// Validates: Requirements 22.2
// ============================================================

describe('Feature: insight-reports-expansion, Property 11: status counts sum to totalInvites', () => {
  it('usedCount + expiredCount + pendingCount equals totalInvites', () => {
    fc.assert(
      fc.property(
        fc.array(inviteArb, { minLength: 0, maxLength: 100 }),
        (invites) => {
          const result = aggregateInviteConversion(invites);
          expect(result.usedCount + result.expiredCount + result.pendingCount).toBe(result.totalInvites);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: insight-reports-expansion, Property 12: conversionRate formula correctness
// Validates: Requirements 22.3
// ============================================================

describe('Feature: insight-reports-expansion, Property 12: conversionRate formula', () => {
  it('conversionRate equals usedCount / totalInvites × 100 rounded to 1 decimal, or 0 when totalInvites is 0', () => {
    fc.assert(
      fc.property(
        fc.array(inviteArb, { minLength: 0, maxLength: 100 }),
        (invites) => {
          const result = aggregateInviteConversion(invites);

          if (result.totalInvites === 0) {
            expect(result.conversionRate).toBe(0);
          } else {
            const expected = Math.round((result.usedCount / result.totalInvites) * 1000) / 10;
            expect(result.conversionRate).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
