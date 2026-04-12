import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { validateTravelSettingsInput, updateTravelSettings, getTravelSettings } from './settings';

// Feature: speaker-travel-sponsorship, Property 1: Travel settings validation accepts valid inputs and rejects invalid inputs
// For any request body object, the validateTravelSettingsInput function should accept it if and only if:
// travelSponsorshipEnabled is a boolean, domesticThreshold is a positive integer >= 1,
// and internationalThreshold is a positive integer >= 1.
// All other inputs should be rejected with error code INVALID_REQUEST.
// **Validates: Requirements 1.6, 1.7**

/** Arbitrary for valid travel settings input */
const validSettingsArb = fc.record({
  travelSponsorshipEnabled: fc.boolean(),
  domesticThreshold: fc.integer({ min: 1, max: 1_000_000 }),
  internationalThreshold: fc.integer({ min: 1, max: 1_000_000 }),
});

/** Arbitrary for invalid travelSponsorshipEnabled (non-boolean) */
const nonBooleanArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.float(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.anything()),
  fc.object(),
);

/** Arbitrary for invalid threshold values (not positive integers >= 1) */
const invalidThresholdArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -1_000_000, max: 0 }),
  fc.double({ min: 0.01, max: 1_000_000, noInteger: true }),
  fc.string(),
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
);

describe('Property 1: Travel settings validation accepts valid inputs and rejects invalid inputs', () => {
  it('should accept any valid input (boolean enabled + positive integers >= 1 for thresholds)', () => {
    fc.assert(
      fc.property(validSettingsArb, (input) => {
        const result = validateTravelSettingsInput(input);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject null body with INVALID_REQUEST', () => {
    const result = validateTravelSettingsInput(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when travelSponsorshipEnabled is not a boolean', () => {
    fc.assert(
      fc.property(
        nonBooleanArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (enabled, domestic, international) => {
          // Skip if enabled happens to be a boolean (oneof could theoretically produce one)
          if (typeof enabled === 'boolean') return;

          const result = validateTravelSettingsInput({
            travelSponsorshipEnabled: enabled,
            domesticThreshold: domestic,
            internationalThreshold: international,
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

  it('should reject when domesticThreshold is not a positive integer >= 1', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        invalidThresholdArb,
        fc.integer({ min: 1, max: 1_000_000 }),
        (enabled, domestic, international) => {
          // Skip if domestic happens to be a valid positive integer >= 1
          if (typeof domestic === 'number' && Number.isInteger(domestic) && domestic >= 1) return;

          const result = validateTravelSettingsInput({
            travelSponsorshipEnabled: enabled,
            domesticThreshold: domestic,
            internationalThreshold: international,
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

  it('should reject when internationalThreshold is not a positive integer >= 1', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1, max: 1_000_000 }),
        invalidThresholdArb,
        (enabled, domestic, international) => {
          // Skip if international happens to be a valid positive integer >= 1
          if (typeof international === 'number' && Number.isInteger(international) && international >= 1) return;

          const result = validateTravelSettingsInput({
            travelSponsorshipEnabled: enabled,
            domesticThreshold: domestic,
            internationalThreshold: international,
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

  it('should have valid=true if and only if all three fields are valid (completeness check)', () => {
    // Generate arbitrary objects that may or may not be valid, and verify the result matches expectations
    const arbitraryInput = fc.record({
      travelSponsorshipEnabled: fc.oneof(fc.boolean(), fc.string(), fc.integer(), fc.constant(undefined)),
      domesticThreshold: fc.oneof(fc.integer({ min: -100, max: 10_000 }), fc.double({ min: -100, max: 10_000 }), fc.string(), fc.constant(undefined)),
      internationalThreshold: fc.oneof(fc.integer({ min: -100, max: 10_000 }), fc.double({ min: -100, max: 10_000 }), fc.string(), fc.constant(undefined)),
    });

    fc.assert(
      fc.property(arbitraryInput, (input) => {
        const result = validateTravelSettingsInput(input);

        const enabledValid = typeof input.travelSponsorshipEnabled === 'boolean';
        const domesticValid =
          typeof input.domesticThreshold === 'number' &&
          Number.isInteger(input.domesticThreshold) &&
          input.domesticThreshold >= 1;
        const internationalValid =
          typeof input.internationalThreshold === 'number' &&
          Number.isInteger(input.internationalThreshold) &&
          input.internationalThreshold >= 1;

        const shouldBeValid = enabledValid && domesticValid && internationalValid;

        if (shouldBeValid) {
          expect(result.valid).toBe(true);
        } else {
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.code).toBe('INVALID_REQUEST');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: speaker-travel-sponsorship, Property 2: Travel settings round-trip preserves data
// For any valid travel settings input (travelSponsorshipEnabled as boolean, domesticThreshold
// and internationalThreshold as positive integers), writing the settings via updateTravelSettings
// and then reading them via getTravelSettings should return the same travelSponsorshipEnabled,
// domesticThreshold, and internationalThreshold values.
// **Validates: Requirements 1.2, 1.8, 2.1**

describe('Property 2: Travel settings round-trip preserves data', () => {
  /**
   * Creates a mock DynamoDB client that simulates read-after-write:
   * - PutCommand captures the written Item
   * - GetCommand returns the captured Item
   */
  function createRoundTripMockClient() {
    let storedItem: Record<string, unknown> | undefined;

    return {
      send: vi.fn(async (command: { constructor: { name: string }; input: any }) => {
        if (command.constructor.name === 'PutCommand') {
          storedItem = { ...command.input.Item };
          return {};
        }
        if (command.constructor.name === 'GetCommand') {
          return { Item: storedItem ? { ...storedItem } : undefined };
        }
        return {};
      }),
    } as any;
  }

  it('should preserve travelSponsorshipEnabled, domesticThreshold, and internationalThreshold after write then read', async () => {
    await fc.assert(
      fc.asyncProperty(validSettingsArb, fc.string({ minLength: 1, maxLength: 50 }), async (settings, updatedBy) => {
        const client = createRoundTripMockClient();
        const tableName = 'TestUsersTable';

        // Write settings
        const writeResult = await updateTravelSettings(
          {
            travelSponsorshipEnabled: settings.travelSponsorshipEnabled,
            domesticThreshold: settings.domesticThreshold,
            internationalThreshold: settings.internationalThreshold,
            updatedBy,
          },
          client,
          tableName,
        );

        expect(writeResult.success).toBe(true);

        // Read settings back
        const readResult = await getTravelSettings(client, tableName);

        // Verify round-trip preserves the three core fields
        expect(readResult.travelSponsorshipEnabled).toBe(settings.travelSponsorshipEnabled);
        expect(readResult.domesticThreshold).toBe(settings.domesticThreshold);
        expect(readResult.internationalThreshold).toBe(settings.internationalThreshold);
      }),
      { numRuns: 100 },
    );
  });
});
