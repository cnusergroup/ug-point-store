import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { updateFeatureToggles } from './feature-toggles';

// ---- In-memory DynamoDB mock ----

/**
 * Creates a mock DynamoDB client backed by an in-memory store.
 * Supports GetCommand and UpdateCommand for round-trip tests.
 */
function createInMemoryClient() {
  const store = new Map<string, Record<string, unknown>>();

  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;

      if (name === 'GetCommand') {
        const key = command.input.Key.userId as string;
        const item = store.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      if (name === 'UpdateCommand') {
        const key = command.input.Key.userId as string;
        const existing = store.get(key) ?? { userId: key };
        const vals = command.input.ExpressionAttributeValues ?? {};
        const updated = { ...existing };
        const fieldMap: Record<string, string> = {
          ':cre': 'codeRedemptionEnabled',
          ':pce': 'pointsClaimEnabled',
          ':ape': 'adminProductsEnabled',
          ':aoe': 'adminOrdersEnabled',
          ':acre': 'adminContentReviewEnabled',
          ':acae': 'adminCategoriesEnabled',
          ':epe': 'emailPointsEarnedEnabled',
          ':eno': 'emailNewOrderEnabled',
          ':eos': 'emailOrderShippedEnabled',
          ':enp': 'emailNewProductEnabled',
          ':enc': 'emailNewContentEnabled',
          ':ecu': 'emailContentUpdatedEnabled',
          ':ewde': 'emailWeeklyDigestEnabled',
          ':aepe': 'adminEmailProductsEnabled',
          ':aece': 'adminEmailContentEnabled',
          ':rap': 'reservationApprovalPoints',
          ':lre': 'leaderboardRankingEnabled',
          ':lae': 'leaderboardAnnouncementEnabled',
          ':luf': 'leaderboardUpdateFrequency',
          ':blle': 'brandLogoListEnabled',
          ':blde': 'brandLogoDetailEnabled',
          ':ese': 'employeeStoreEnabled',
          ':crm': 'contentReviewMode',
          ':cri': 'contentReviewerIds',
          ':ua': 'updatedAt',
          ':ub': 'updatedBy',
        };
        for (const [placeholder, value] of Object.entries(vals)) {
          const field = fieldMap[placeholder];
          if (field) {
            updated[field] = value;
          }
        }
        store.set(key, updated);
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
    _store: store,
  } as any;
}

const TABLE = 'users-table';

/** Valid base input with all required fields set to valid defaults */
function validBaseInput(frequencyOverride: any) {
  return {
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    emailPointsEarnedEnabled: false,
    emailNewOrderEnabled: false,
    emailOrderShippedEnabled: false,
    emailNewProductEnabled: false,
    emailNewContentEnabled: false,
    emailContentUpdatedEnabled: false,
    emailWeeklyDigestEnabled: false,
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
    reservationApprovalPoints: 10,
    leaderboardRankingEnabled: false,
    leaderboardAnnouncementEnabled: false,
    leaderboardUpdateFrequency: frequencyOverride,
    brandLogoListEnabled: true,
    brandLogoDetailEnabled: true,
    employeeStoreEnabled: true,
    contentReviewMode: 'all' as const,
    contentReviewerIds: [] as string[],
    updatedBy: 'test-admin',
  };
}

const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

// ============================================================================
// Feature: points-leaderboard, Property 7: Update frequency validation accepts only valid values
//
// For any string value for leaderboardUpdateFrequency, the validator should
// accept it if and only if it is one of "daily", "weekly", or "monthly".
// All other values (including empty string, null, undefined, and arbitrary
// strings) should be rejected with error code INVALID_REQUEST.
//
// **Validates: Requirements 14.4, 14.5**
// ============================================================================

describe('Feature: points-leaderboard, Property 7: Update frequency validation accepts only valid values', () => {
  it(
    'accepts only "daily", "weekly", "monthly" as valid leaderboardUpdateFrequency values',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...VALID_FREQUENCIES),
          async (validFrequency) => {
            const client = createInMemoryClient();
            const result = await updateFeatureToggles(
              validBaseInput(validFrequency),
              client,
              TABLE,
            );

            expect(result.success).toBe(true);
            expect(result.settings?.leaderboardUpdateFrequency).toBe(validFrequency);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'rejects arbitrary strings that are not "daily", "weekly", or "monthly" with INVALID_REQUEST',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter(
            (s) => s !== 'daily' && s !== 'weekly' && s !== 'monthly',
          ),
          async (invalidFrequency) => {
            const client = createInMemoryClient();
            const result = await updateFeatureToggles(
              validBaseInput(invalidFrequency) as any,
              client,
              TABLE,
            );

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe('INVALID_REQUEST');
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'rejects null, undefined, and non-string types with INVALID_REQUEST',
    async () => {
      const nonStringArb = fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.integer(),
        fc.float(),
        fc.boolean(),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string()),
        fc.array(fc.integer(), { maxLength: 3 }),
      );

      await fc.assert(
        fc.asyncProperty(nonStringArb, async (invalidValue) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            validBaseInput(invalidValue) as any,
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('INVALID_REQUEST');
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'rejects empty string with INVALID_REQUEST',
    async () => {
      const client = createInMemoryClient();
      const result = await updateFeatureToggles(
        validBaseInput('') as any,
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REQUEST');
    },
  );
});
