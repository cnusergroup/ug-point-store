import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  calculateAvailableCount,
  validateTravelApplicationInput,
  submitTravelApplication,
  resubmitTravelApplication,
  clampPageSize,
  SubmitTravelApplicationInput,
  ResubmitTravelApplicationInput,
} from './apply';

// ============================================================
// Feature: speaker-travel-sponsorship, Property 3: Quota calculation correctness
//
// For any non-negative integers earnTotal, travelEarnUsed, and non-negative integer threshold,
// calculateAvailableCount(earnTotal, travelEarnUsed, threshold) should return:
// - floor((earnTotal - travelEarnUsed) / threshold) when threshold > 0 and earnTotal >= travelEarnUsed
// - 0 when threshold === 0
// - 0 when travelEarnUsed > earnTotal
//
// **Validates: Requirements 3.1, 3.3, 3.4**
// ============================================================

describe('Property 3: Quota calculation correctness', () => {
  it('should return floor((earnTotal - travelEarnUsed) / threshold) when threshold > 0 and earnTotal >= travelEarnUsed', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (earnTotal, travelEarnUsed, threshold) => {
          fc.pre(earnTotal >= travelEarnUsed);
          const result = calculateAvailableCount(earnTotal, travelEarnUsed, threshold);
          const expected = Math.floor((earnTotal - travelEarnUsed) / threshold);
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
        (earnTotal, travelEarnUsed) => {
          const result = calculateAvailableCount(earnTotal, travelEarnUsed, 0);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return 0 when travelEarnUsed > earnTotal', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (earnTotal, extra, threshold) => {
          // Ensure travelEarnUsed > earnTotal
          const travelEarnUsed = earnTotal + extra + 1;
          const result = calculateAvailableCount(earnTotal, travelEarnUsed, threshold);
          expect(result).toBe(0);
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
// Feature: speaker-travel-sponsorship, Property 5: Submission creates application record and deducts quota atomically
//
// For any valid travel application submission where the user has sufficient quota,
// after submitTravelApplication succeeds:
// (a) application status is pending and earnDeducted equals the corresponding category's threshold
// (b) TransactWriteCommand was used
// (c) totalCost = flightCost + hotelCost
//
// **Validates: Requirements 4.8, 4.9, 15.2**
// ============================================================

describe('Property 5: Submission creates application record and deducts quota atomically', () => {
  function createMockClient(domesticThreshold: number, internationalThreshold: number, earnTotal: number, travelEarnUsed: number) {
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

    // Call 2: queryEarnTotal (QueryCommand)
    sendMock.mockResolvedValueOnce({
      Items: [{ amount: earnTotal }],
      LastEvaluatedKey: undefined,
    });

    // Call 3: GetCommand for user record (travelEarnUsed)
    sendMock.mockResolvedValueOnce({
      Item: { userId: 'user-001', travelEarnUsed },
    });

    // Call 4: TransactWriteCommand
    sendMock.mockResolvedValueOnce({});

    return { send: sendMock } as any;
  }

  const tables = {
    usersTable: 'Users',
    pointsRecordsTable: 'PointsRecords',
    travelApplicationsTable: 'TravelApplications',
  };

  it('should create application with status=pending, correct earnDeducted, correct totalCost, and use TransactWriteCommand', () => {
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
        async (category, communityRole, eventLink, cfpScreenshotUrl, flightCost, hotelCost, domesticThreshold, internationalThreshold) => {
          const threshold = category === 'domestic' ? domesticThreshold : internationalThreshold;
          // Ensure user has sufficient quota: earnTotal must be >= threshold
          const earnTotal = threshold + fc.sample(fc.nat({ max: 10_000 }), 1)[0];
          const travelEarnUsed = 0;

          const client = createMockClient(domesticThreshold, internationalThreshold, earnTotal, travelEarnUsed);

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

          // (a) application status is pending and earnDeducted equals threshold
          expect(result.success).toBe(true);
          expect(result.application).toBeDefined();
          expect(result.application!.status).toBe('pending');
          expect(result.application!.earnDeducted).toBe(threshold);

          // (b) TransactWriteCommand was used
          const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1][0];
          expect(lastCall.constructor.name).toBe('TransactWriteCommand');

          // (c) totalCost = flightCost + hotelCost
          expect(result.application!.totalCost).toBe(flightCost + hotelCost);
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
// Feature: speaker-travel-sponsorship, Property 11: Resubmission correctly recalculates quota
//
// For any rejected travel application with original earnDeducted = D_old and original category C_old,
// when resubmitted with new category C_new:
// (a) travelEarnUsed increases by new threshold (since D_old was returned on rejection)
// (b) application status is pending with earnDeducted = new threshold
//
// **Validates: Requirements 7.5, 7.6, 7.8**
// ============================================================

describe('Property 11: Resubmission correctly recalculates quota', () => {
  const tables = {
    usersTable: 'Users',
    pointsRecordsTable: 'PointsRecords',
    travelApplicationsTable: 'TravelApplications',
  };

  function createResubmitMockClient(
    rejectedApp: Record<string, unknown>,
    domesticThreshold: number,
    internationalThreshold: number,
    earnTotal: number,
    travelEarnUsed: number,
  ) {
    const sendMock = vi.fn();

    // Call 1: GetCommand for existing application
    sendMock.mockResolvedValueOnce({ Item: rejectedApp });

    // Call 2: queryEarnTotal (QueryCommand)
    sendMock.mockResolvedValueOnce({
      Items: [{ amount: earnTotal }],
      LastEvaluatedKey: undefined,
    });

    // Call 3: GetCommand for user record (travelEarnUsed)
    sendMock.mockResolvedValueOnce({
      Item: { userId: rejectedApp.userId, travelEarnUsed },
    });

    // Call 4: getTravelSettings (GetCommand)
    sendMock.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold,
        internationalThreshold,
      },
    });

    // Call 5: TransactWriteCommand
    sendMock.mockResolvedValueOnce({});

    return { send: sendMock } as any;
  }

  it('should set status to pending and earnDeducted to new threshold after resubmission', () => {
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
          const oldThreshold = oldCategory === 'domestic' ? domesticThreshold : internationalThreshold;
          const newThreshold = newCategory === 'domestic' ? domesticThreshold : internationalThreshold;

          // Ensure user has sufficient quota for the new threshold
          const earnTotal = newThreshold + fc.sample(fc.nat({ max: 10_000 }), 1)[0];
          // After rejection, travelEarnUsed was reduced by oldThreshold, so it's 0 for simplicity
          const travelEarnUsed = 0;

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
            earnDeducted: oldThreshold,
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
            earnTotal,
            travelEarnUsed,
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

          // (a) travelEarnUsed increases by new threshold — verified via TransactWriteCommand
          // The TransactWriteCommand's Update expression adds newThreshold to travelEarnUsed
          const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1][0];
          expect(lastCall.constructor.name).toBe('TransactWriteCommand');
          const transactItems = lastCall.input.TransactItems;
          const updateItem = transactItems.find((item: any) => item.Update);
          expect(updateItem).toBeDefined();
          expect(updateItem.Update.ExpressionAttributeValues[':threshold']).toBe(newThreshold);

          // (b) application status is pending with earnDeducted = new threshold
          expect(result.success).toBe(true);
          expect(result.application).toBeDefined();
          expect(result.application!.status).toBe('pending');
          expect(result.application!.earnDeducted).toBe(newThreshold);
        },
      ),
      { numRuns: 100 },
    );
  });
});
