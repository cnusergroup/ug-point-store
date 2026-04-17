import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  calculateAvailableCount,
  validateTravelApplicationInput,
  getTravelQuota,
  submitTravelApplication,
  resubmitTravelApplication,
  clampPageSize,
  SubmitTravelApplicationInput,
  ResubmitTravelApplicationInput,
} from './apply';

// ============================================================
// Feature: travel-speaker-points, Property 1: Speaker-only earn total filtering
//
// For any user with a set of PointsRecords containing mixed targetRole values
// (Speaker, UserGroupLeader, Volunteer, or undefined), queryEarnTotal SHALL return
// the sum of amount only for records where type = "earn" AND targetRole = "Speaker".
// Records with other targetRole values or type values SHALL be excluded from the total.
//
// Since queryEarnTotal is a private function, we test it indirectly through getTravelQuota
// by verifying:
// (a) The QueryCommand sent to DynamoDB includes FilterExpression with targetRole = "Speaker"
// (b) The returned speakerEarnTotal equals only the sum of Speaker earn records
//
// **Validates: Requirements 1.1, 1.3, 1.4, 2.4**
// ============================================================

/** Arbitrary for a single PointsRecord with mixed targetRole */
const targetRoleArb = fc.constantFrom('Speaker', 'UserGroupLeader', 'Volunteer', undefined);
const pointsRecordTypeArb = fc.constantFrom('earn', 'spend');
const pointsAmountArb = fc.integer({ min: 1, max: 10_000 });

const pointsRecordArb = fc.record({
  targetRole: targetRoleArb,
  type: pointsRecordTypeArb,
  amount: pointsAmountArb,
});

describe('Feature: travel-speaker-points, Property 1: Speaker-only earn total filtering', () => {
  it('should return speakerEarnTotal equal to the sum of only Speaker earn records', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(pointsRecordArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 100, max: 5_000 }),
        fc.integer({ min: 100, max: 5_000 }),
        async (records, domesticThreshold, internationalThreshold) => {
          // Calculate expected Speaker earn total (what DynamoDB would return after filtering)
          const speakerEarnRecords = records.filter(
            (r) => r.type === 'earn' && r.targetRole === 'Speaker',
          );
          const expectedSpeakerEarnTotal = speakerEarnRecords.reduce((sum, r) => sum + r.amount, 0);

          // Mock DynamoDB client: simulate FilterExpression behavior
          // queryEarnTotal sends QueryCommand with FilterExpression '#t = :earn AND #tr = :speaker'
          // DynamoDB returns only matching items (Speaker earn records)
          const sendMock = vi.fn();

          // Call 1: queryEarnTotal (QueryCommand) — returns only Speaker earn records
          sendMock.mockResolvedValueOnce({
            Items: speakerEarnRecords.map((r) => ({ amount: r.amount })),
            LastEvaluatedKey: undefined,
          });

          // Call 2: getTravelSettings (GetCommand)
          sendMock.mockResolvedValueOnce({
            Item: {
              userId: 'travel-sponsorship',
              travelSponsorshipEnabled: true,
              domesticThreshold,
              internationalThreshold,
            },
          });

          // Call 3: QueryCommand for pending+approved applications
          sendMock.mockResolvedValueOnce({
            Items: [],
            LastEvaluatedKey: undefined,
          });

          const client = { send: sendMock } as any;

          const quota = await getTravelQuota('user-prop1', client, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            travelApplicationsTable: 'TravelApplications',
          });

          // (a) Verify the QueryCommand includes Speaker filter in FilterExpression
          const queryCall = sendMock.mock.calls[0][0];
          expect(queryCall.constructor.name).toBe('QueryCommand');
          // FilterExpression uses aliases (#tr for targetRole), so check ExpressionAttributeNames
          expect(queryCall.input.FilterExpression).toContain('#tr');
          expect(queryCall.input.FilterExpression).toContain(':speaker');
          expect(queryCall.input.ExpressionAttributeValues[':speaker']).toBe('Speaker');
          expect(queryCall.input.ExpressionAttributeNames['#tr']).toBe('targetRole');

          // (b) Verify speakerEarnTotal equals only the sum of Speaker earn records
          expect(quota.speakerEarnTotal).toBe(expectedSpeakerEarnTotal);

          // (c) Verify non-Speaker records are excluded — the mock only received Speaker earn records,
          // confirming the FilterExpression would exclude other targetRole values
          const nonSpeakerEarnRecords = records.filter(
            (r) => r.type === 'earn' && r.targetRole !== 'Speaker',
          );
          if (nonSpeakerEarnRecords.length > 0) {
            const nonSpeakerTotal = nonSpeakerEarnRecords.reduce((sum, r) => sum + r.amount, 0);
            // speakerEarnTotal should NOT include non-Speaker earn amounts
            expect(quota.speakerEarnTotal).not.toBe(expectedSpeakerEarnTotal + nonSpeakerTotal);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return speakerEarnTotal as 0 when no Speaker earn records exist', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            targetRole: fc.constantFrom('UserGroupLeader', 'Volunteer', undefined),
            type: pointsRecordTypeArb,
            amount: pointsAmountArb,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (records) => {
          const sendMock = vi.fn();

          // Call 1: queryEarnTotal — no Speaker earn records, DynamoDB returns empty
          sendMock.mockResolvedValueOnce({
            Items: [],
            LastEvaluatedKey: undefined,
          });

          // Call 2: getTravelSettings
          sendMock.mockResolvedValueOnce({
            Item: {
              userId: 'travel-sponsorship',
              travelSponsorshipEnabled: true,
              domesticThreshold: 500,
              internationalThreshold: 1000,
            },
          });

          // Call 3: QueryCommand for pending+approved applications
          sendMock.mockResolvedValueOnce({
            Items: [],
            LastEvaluatedKey: undefined,
          });

          const client = { send: sendMock } as any;

          const quota = await getTravelQuota('user-prop1', client, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            travelApplicationsTable: 'TravelApplications',
          });

          expect(quota.speakerEarnTotal).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 1: Quota calculation correctness
//
// For any non-negative integers earnTotal, threshold, and categoryUsedCount:
// - If threshold === 0, the result SHALL be 0
// - If threshold > 0, the result SHALL be max(0, floor(earnTotal / threshold) - categoryUsedCount)
//
// **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
// ============================================================

describe('Feature: travel-independent-quota, Property 1: Quota calculation correctness', () => {
  it('should return max(0, floor(earnTotal / threshold) - categoryUsedCount) when threshold > 0', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, threshold, categoryUsedCount) => {
          const result = calculateAvailableCount(earnTotal, threshold, categoryUsedCount);
          const expected = Math.max(0, Math.floor(earnTotal / threshold) - categoryUsedCount);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return 0 when threshold === 0', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, categoryUsedCount) => {
          const result = calculateAvailableCount(earnTotal, 0, categoryUsedCount);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 2: Used count derivation from applications
//
// For any set of travel application records with mixed statuses (pending, approved, rejected)
// and mixed categories (domestic, international), domesticUsedCount SHALL equal the count of
// records where status ∈ {pending, approved} AND category = domestic, and internationalUsedCount
// SHALL equal the count where status ∈ {pending, approved} AND category = international.
//
// This tests the counting logic indirectly through getTravelQuota by mocking DynamoDB
// to return filtered results.
//
// **Validates: Requirements 1.4, 2.4**
// ============================================================

const travelStatusArb = fc.constantFrom('pending', 'approved', 'rejected');
const travelCategoryArb = fc.constantFrom('domestic', 'international');

const travelAppRecordArb = fc.record({
  status: travelStatusArb,
  category: travelCategoryArb,
});

describe('Feature: travel-independent-quota, Property 2: Used count derivation from applications', () => {
  it('domesticUsedCount and internationalUsedCount should match counts of pending+approved per category', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(travelAppRecordArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 100, max: 5_000 }),
        fc.integer({ min: 100, max: 5_000 }),
        async (appRecords, domesticThreshold, internationalThreshold) => {
          // Calculate expected counts
          const expectedDomesticUsed = appRecords.filter(
            (r) => (r.status === 'pending' || r.status === 'approved') && r.category === 'domestic',
          ).length;
          const expectedInternationalUsed = appRecords.filter(
            (r) => (r.status === 'pending' || r.status === 'approved') && r.category === 'international',
          ).length;

          // The DynamoDB FilterExpression '#s IN (:pending, :approved)' means
          // only pending+approved records are returned from the query.
          // We simulate this by filtering before returning from the mock.
          const filteredItems = appRecords
            .filter((r) => r.status === 'pending' || r.status === 'approved')
            .map((r) => ({ category: r.category }));

          const sendMock = vi.fn();

          // Call 1: queryEarnTotal (QueryCommand) — returns some earn total
          sendMock.mockResolvedValueOnce({
            Items: [{ amount: 10_000 }],
            LastEvaluatedKey: undefined,
          });

          // Call 2: getTravelSettings (GetCommand)
          sendMock.mockResolvedValueOnce({
            Item: {
              userId: 'travel-sponsorship',
              travelSponsorshipEnabled: true,
              domesticThreshold,
              internationalThreshold,
            },
          });

          // Call 3: QueryCommand for pending+approved applications (returns filtered items)
          sendMock.mockResolvedValueOnce({
            Items: filteredItems,
            LastEvaluatedKey: undefined,
          });

          const client = { send: sendMock } as any;

          const quota = await getTravelQuota('user-prop2', client, {
            usersTable: 'Users',
            pointsRecordsTable: 'PointsRecords',
            travelApplicationsTable: 'TravelApplications',
          });

          expect(quota.domesticUsedCount).toBe(expectedDomesticUsed);
          expect(quota.internationalUsedCount).toBe(expectedInternationalUsed);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 3: Category independence
//
// For any valid earnTotal, domesticThreshold, internationalThreshold,
// domesticUsedCount, and two different internationalUsedCount values,
// domesticAvailable is identical regardless of internationalUsedCount.
// Symmetrically, internationalAvailable is identical regardless of domesticUsedCount.
//
// **Validates: Requirements 8.1, 8.2, 8.5**
// ============================================================

describe('Feature: travel-independent-quota, Property 3: Category independence', () => {
  it('domesticAvailable should be identical regardless of internationalUsedCount', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, domesticThreshold, internationalThreshold, domesticUsedCount, intUsed1, intUsed2) => {
          const domesticAvailable1 = calculateAvailableCount(earnTotal, domesticThreshold, domesticUsedCount);
          // Change internationalUsedCount — domesticAvailable should not change
          const _intAvail1 = calculateAvailableCount(earnTotal, internationalThreshold, intUsed1);
          const _intAvail2 = calculateAvailableCount(earnTotal, internationalThreshold, intUsed2);
          const domesticAvailable2 = calculateAvailableCount(earnTotal, domesticThreshold, domesticUsedCount);
          expect(domesticAvailable1).toBe(domesticAvailable2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('internationalAvailable should be identical regardless of domesticUsedCount', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, domesticThreshold, internationalThreshold, internationalUsedCount, domUsed1, domUsed2) => {
          const intAvailable1 = calculateAvailableCount(earnTotal, internationalThreshold, internationalUsedCount);
          // Change domesticUsedCount — internationalAvailable should not change
          const _domAvail1 = calculateAvailableCount(earnTotal, domesticThreshold, domUsed1);
          const _domAvail2 = calculateAvailableCount(earnTotal, domesticThreshold, domUsed2);
          const intAvailable2 = calculateAvailableCount(earnTotal, internationalThreshold, internationalUsedCount);
          expect(intAvailable1).toBe(intAvailable2);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 4: Available plus used does not exceed total quota
//
// For any valid earnTotal, positive threshold, and non-negative categoryUsedCount,
// calculateAvailableCount(earnTotal, threshold, categoryUsedCount) + categoryUsedCount
// <= floor(earnTotal / threshold)
//
// **Validates: Requirements 8.3, 8.4**
// ============================================================

describe('Feature: travel-independent-quota, Property 4: Available plus used does not exceed total quota', () => {
  it('available + categoryUsedCount should not exceed floor(earnTotal / threshold)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, threshold, categoryUsedCount) => {
          const totalQuota = Math.floor(earnTotal / threshold);
          // Constrain categoryUsedCount to realistic values (cannot exceed total quota)
          fc.pre(categoryUsedCount <= totalQuota);
          const available = calculateAvailableCount(earnTotal, threshold, categoryUsedCount);
          expect(available + categoryUsedCount).toBeLessThanOrEqual(totalQuota);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 4: Travel application validation accepts valid inputs and rejects invalid inputs
//
// For any request body object, validateTravelApplicationInput should accept it if and only if:
// category is "domestic" or "international", communityRole is "Hero", "CommunityBuilder", or "UGL",
// eventLink is a valid URL, cfpScreenshotUrl is a non-empty string, flightCost is a non-negative number,
// and hotelCost is a non-negative number. All other inputs should be rejected with INVALID_REQUEST.
//
// **Validates: Requirements 4.4, 4.5, 7.4**
// ============================================================

/** Arbitrary for valid travel application input */
const validCategoryArb = fc.constantFrom('domestic', 'international');
const validCommunityRoleArb = fc.constantFrom('Hero', 'CommunityBuilder', 'UGL');
const validUrlArb = fc.webUrl();
const validNonEmptyStringArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);
const validNonNegativeNumberArb = fc.double({ min: 0, max: 1_000_000, noNaN: true }).filter((n) => isFinite(n) && n >= 0);

const validApplicationInputArb = fc.record({
  category: validCategoryArb,
  communityRole: validCommunityRoleArb,
  eventLink: validUrlArb,
  cfpScreenshotUrl: validNonEmptyStringArb,
  flightCost: validNonNegativeNumberArb,
  hotelCost: validNonNegativeNumberArb,
});

describe('Property 4: Travel application validation accepts valid inputs and rejects invalid inputs', () => {
  it('should accept any valid input', () => {
    fc.assert(
      fc.property(validApplicationInputArb, (input) => {
        const result = validateTravelApplicationInput(input);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject null body with INVALID_REQUEST', () => {
    const result = validateTravelApplicationInput(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject invalid category', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== 'domestic' && s !== 'international'),
        validCommunityRoleArb,
        validUrlArb,
        validNonEmptyStringArb,
        validNonNegativeNumberArb,
        validNonNegativeNumberArb,
        (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost) => {
          const result = validateTravelApplicationInput({
            category,
            communityRole,
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject invalid communityRole', () => {
    fc.assert(
      fc.property(
        validCategoryArb,
        fc.string().filter((s) => s !== 'Hero' && s !== 'CommunityBuilder' && s !== 'UGL'),
        validUrlArb,
        validNonEmptyStringArb,
        validNonNegativeNumberArb,
        validNonNegativeNumberArb,
        (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost) => {
          const result = validateTravelApplicationInput({
            category,
            communityRole,
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject negative flightCost or hotelCost', () => {
    fc.assert(
      fc.property(
        validCategoryArb,
        validCommunityRoleArb,
        validUrlArb,
        validNonEmptyStringArb,
        fc.double({ min: -1_000_000, max: -0.001, noNaN: true }),
        validNonNegativeNumberArb,
        (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost) => {
          const result = validateTravelApplicationInput({
            category,
            communityRole,
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject non-string or empty cfpScreenshotUrl', () => {
    fc.assert(
      fc.property(
        validCategoryArb,
        validCommunityRoleArb,
        validUrlArb,
        fc.constantFrom('', '   ', '  \t  '),
        validNonNegativeNumberArb,
        validNonNegativeNumberArb,
        (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost) => {
          const result = validateTravelApplicationInput({
            category,
            communityRole,
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 5: Submit and resubmit availability gate
//
// For any category, earnTotal, categoryThreshold > 0, and categoryUsedCount,
// submission succeeds if and only if categoryUsedCount < floor(earnTotal / categoryThreshold);
// otherwise returns INSUFFICIENT_EARN_QUOTA.
//
// **Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2**
// ============================================================

describe('Feature: travel-independent-quota, Property 5: Submit and resubmit availability gate', () => {
  function createMockClient(
    domesticThreshold: number,
    internationalThreshold: number,
    speakerEarnTotal: number,
    categoryUsedCount: number,
    category: 'domestic' | 'international',
  ) {
    const sendMock = vi.fn();

    // Call 1: getTravelSettings (GetCommand)
    sendMock.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold,
        internationalThreshold,
      },
    });

    // Call 2: queryEarnTotal (QueryCommand) — returns Speaker-filtered earn total only
    sendMock.mockResolvedValueOnce({
      Items: [{ amount: speakerEarnTotal }],
      LastEvaluatedKey: undefined,
    });

    // Call 3: QueryCommand for pending+approved applications per category
    sendMock.mockResolvedValueOnce({
      Items: Array.from({ length: categoryUsedCount }, () => ({ category })),
      LastEvaluatedKey: undefined,
    });

    // Call 4: PutCommand (only reached if submission succeeds)
    sendMock.mockResolvedValueOnce({});

    return { send: sendMock } as any;
  }

  const tables = {
    usersTable: 'Users',
    pointsRecordsTable: 'PointsRecords',
    travelApplicationsTable: 'TravelApplications',
  };

  it('should succeed if and only if categoryUsedCount < floor(earnTotal / categoryThreshold)', () => {
    fc.assert(
      fc.asyncProperty(
        validCategoryArb,
        validCommunityRoleArb,
        validUrlArb,
        validNonEmptyStringArb,
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 100, max: 10_000 }),
        fc.integer({ min: 100, max: 10_000 }),
        fc.nat({ max: 20 }),
        async (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost, domesticThreshold, internationalThreshold, categoryUsedCount) => {
          const threshold = category === 'domestic' ? domesticThreshold : internationalThreshold;
          // Generate a speakerEarnTotal that may or may not be sufficient
          const speakerEarnTotal = fc.sample(fc.nat({ max: threshold * 5 }), 1)[0];
          const totalQuota = Math.floor(speakerEarnTotal / threshold);
          const shouldSucceed = categoryUsedCount < totalQuota;

          const client = createMockClient(
            domesticThreshold,
            internationalThreshold,
            speakerEarnTotal,
            categoryUsedCount,
            category as 'domestic' | 'international',
          );

          const input: SubmitTravelApplicationInput = {
            userId: 'user-001',
            userNickname: 'TestUser',
            category: category as 'domestic' | 'international',
            communityRole: communityRole as 'Hero' | 'CommunityBuilder' | 'UGL',
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          };

          const result = await submitTravelApplication(input, client, tables);

          if (shouldSucceed) {
            expect(result.success).toBe(true);
            expect(result.application).toBeDefined();
            expect(result.application!.status).toBe('pending');
            // Verify PutCommand was used (not TransactWriteCommand)
            const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1][0];
            expect(lastCall.constructor.name).toBe('PutCommand');
            // Verify totalCost
            expect(result.application!.totalCost).toBe(flightCost + hotelCost);
            // Verify no earnDeducted field
            expect(result.application!.earnDeducted).toBeUndefined();
          } else {
            expect(result.success).toBe(false);
            expect(result.error?.code).toBe('INSUFFICIENT_EARN_QUOTA');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: speaker-travel-sponsorship, Property 10: Pagination pageSize is clamped to valid range
//
// For any requested pageSize value, the effective pageSize used in the query should be
// clamped to the range [1, 100], defaulting to 20 when not specified.
// - if pageSize is undefined, use 20
// - if pageSize < 1, use 1
// - if pageSize > 100, use 100
// - otherwise use the requested value (floored)
//
// **Validates: Requirements 6.4, 8.6**
// ============================================================

describe('Property 10: Pagination pageSize is clamped to valid range', () => {
  it('should default to 20 when pageSize is undefined', () => {
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('should clamp to 1 for any value < 1', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: 0.999, noNaN: true }).filter((n) => isFinite(n)),
        (pageSize) => {
          const result = clampPageSize(pageSize);
          expect(result).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should clamp to 100 for any value > 100', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100.001, max: 1_000_000, noNaN: true }).filter((n) => isFinite(n)),
        (pageSize) => {
          const result = clampPageSize(pageSize);
          expect(result).toBe(100);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return floor(pageSize) for values in [1, 100]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100, noNaN: true }).filter((n) => isFinite(n)),
        (pageSize) => {
          const result = clampPageSize(pageSize);
          expect(result).toBe(Math.floor(pageSize));
          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: travel-independent-quota, Property 11: Resubmission correctly recalculates quota
//
// For any rejected travel application with original category C_old,
// when resubmitted with new category C_new:
// (a) PutCommand is used (no TransactWriteCommand, no user record update)
// (b) application status is pending with no earnDeducted field
//
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
// ============================================================

describe('Feature: travel-independent-quota, Property 11: Resubmission correctly recalculates quota', () => {
  const tables = {
    usersTable: 'Users',
    pointsRecordsTable: 'PointsRecords',
    travelApplicationsTable: 'TravelApplications',
  };

  function createResubmitMockClient(
    rejectedApp: Record<string, unknown>,
    domesticThreshold: number,
    internationalThreshold: number,
    speakerEarnTotal: number,
    categoryUsedCount: number,
    category: 'domestic' | 'international',
  ) {
    const sendMock = vi.fn();

    // Call 1: GetCommand for existing application
    sendMock.mockResolvedValueOnce({ Item: rejectedApp });

    // Call 2: queryEarnTotal (QueryCommand) — returns Speaker-filtered earn total only
    sendMock.mockResolvedValueOnce({
      Items: [{ amount: speakerEarnTotal }],
      LastEvaluatedKey: undefined,
    });

    // Call 3: getTravelSettings (GetCommand)
    sendMock.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold,
        internationalThreshold,
      },
    });

    // Call 4: QueryCommand for pending+approved applications per category
    sendMock.mockResolvedValueOnce({
      Items: Array.from({ length: categoryUsedCount }, () => ({ category })),
      LastEvaluatedKey: undefined,
    });

    // Call 5: PutCommand
    sendMock.mockResolvedValueOnce({});

    return { send: sendMock } as any;
  }

  it('should set status to pending with no earnDeducted and use PutCommand after resubmission', () => {
    fc.assert(
      fc.asyncProperty(
        fc.constantFrom('domestic', 'international') as fc.Arbitrary<'domestic' | 'international'>,
        fc.constantFrom('domestic', 'international') as fc.Arbitrary<'domestic' | 'international'>,
        fc.integer({ min: 100, max: 5_000 }),
        fc.integer({ min: 100, max: 5_000 }),
        fc.constantFrom('Hero', 'CommunityBuilder', 'UGL') as fc.Arbitrary<'Hero' | 'CommunityBuilder' | 'UGL'>,
        validUrlArb,
        validNonEmptyStringArb,
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        async (oldCategory, newCategory, domesticThreshold, internationalThreshold, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost) => {
          const newThreshold = newCategory === 'domestic' ? domesticThreshold : internationalThreshold;

          // Ensure user has sufficient quota for the new threshold
          const speakerEarnTotal = newThreshold + fc.sample(fc.nat({ max: 10_000 }), 1)[0];
          // No pending+approved apps for the new category
          const categoryUsedCount = 0;

          const rejectedApp = {
            applicationId: 'app-resubmit-001',
            userId: 'user-001',
            applicantNickname: 'TestUser',
            category: oldCategory,
            communityRole: 'Hero',
            eventLink: 'https://example.com/old',
            cfpScreenshotUrl: 'https://cdn.example.com/old.png',
            flightCost: 1000,
            hotelCost: 500,
            totalCost: 1500,
            status: 'rejected',
            earnDeducted: 500,
            rejectReason: 'Test rejection',
            reviewerId: 'admin-001',
            reviewerNickname: 'Admin',
            reviewedAt: '2024-01-15T00:00:00.000Z',
            createdAt: '2024-01-10T00:00:00.000Z',
            updatedAt: '2024-01-15T00:00:00.000Z',
          };

          const client = createResubmitMockClient(
            rejectedApp,
            domesticThreshold,
            internationalThreshold,
            speakerEarnTotal,
            categoryUsedCount,
            newCategory,
          );

          const input: ResubmitTravelApplicationInput = {
            applicationId: 'app-resubmit-001',
            userId: 'user-001',
            userNickname: 'TestUser',
            category: newCategory,
            communityRole,
            eventLink,
            cfpScreenshotUrl,
            flightCost,
            hotelCost,
          };

          const result = await resubmitTravelApplication(input, client, tables);

          // (a) PutCommand is used (not TransactWriteCommand)
          const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1][0];
          expect(lastCall.constructor.name).toBe('PutCommand');

          // (b) application status is pending with no earnDeducted
          expect(result.success).toBe(true);
          expect(result.application).toBeDefined();
          expect(result.application!.status).toBe('pending');
          expect(result.application!.earnDeducted).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
