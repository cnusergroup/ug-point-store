import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getFeatureToggles, updateFeatureToggles } from './feature-toggles';

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
          ':aepe': 'adminEmailProductsEnabled',
          ':aece': 'adminEmailContentEnabled',
          ':ua': 'updatedAt',
          ':ub': 'updatedBy',
          ':crp': 'contentRolePermissions',
          ':updatedAt': 'updatedAt',
          ':updatedBy': 'updatedBy',
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

// ============================================================================
// Property 1: Feature toggle round-trip preserves values
// Feature: admin-email-permission, Property 1: Feature toggle round-trip preserves values
//
// For any valid set of boolean values for adminEmailProductsEnabled and
// adminEmailContentEnabled, calling updateFeatureToggles with those values and
// then calling getFeatureToggles should return the same boolean values for both fields.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6**
// ============================================================================

describe('Feature: admin-email-permission, Property 1: Feature toggle round-trip preserves values', () => {
  it(
    'updateFeatureToggles then getFeatureToggles should return the same adminEmailProductsEnabled and adminEmailContentEnabled values',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          async (adminEmailProducts, adminEmailContent) => {
            const client = createInMemoryClient();

            const writeResult = await updateFeatureToggles(
              {
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
                adminEmailProductsEnabled: adminEmailProducts,
                adminEmailContentEnabled: adminEmailContent,
                updatedBy: 'test-admin',
              },
              client,
              TABLE,
            );

            expect(writeResult.success).toBe(true);

            const readResult = await getFeatureToggles(client, TABLE);

            expect(readResult.adminEmailProductsEnabled).toBe(adminEmailProducts);
            expect(readResult.adminEmailContentEnabled).toBe(adminEmailContent);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'round-trip preserves values across all combinations of other toggles',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          async (
            codeRedemption,
            pointsClaim,
            adminEmailProducts,
            adminEmailContent,
            emailNewProduct,
            emailNewContent,
          ) => {
            const client = createInMemoryClient();

            const writeResult = await updateFeatureToggles(
              {
                codeRedemptionEnabled: codeRedemption,
                pointsClaimEnabled: pointsClaim,
                adminProductsEnabled: true,
                adminOrdersEnabled: true,
                adminContentReviewEnabled: false,
                adminCategoriesEnabled: false,
                emailPointsEarnedEnabled: false,
                emailNewOrderEnabled: false,
                emailOrderShippedEnabled: false,
                emailNewProductEnabled: emailNewProduct,
                emailNewContentEnabled: emailNewContent,
                adminEmailProductsEnabled: adminEmailProducts,
                adminEmailContentEnabled: adminEmailContent,
                updatedBy: 'test-admin',
              },
              client,
              TABLE,
            );

            expect(writeResult.success).toBe(true);

            const readResult = await getFeatureToggles(client, TABLE);

            expect(readResult.adminEmailProductsEnabled).toBe(adminEmailProducts);
            expect(readResult.adminEmailContentEnabled).toBe(adminEmailContent);
            expect(readResult.codeRedemptionEnabled).toBe(codeRedemption);
            expect(readResult.pointsClaimEnabled).toBe(pointsClaim);
            expect(readResult.emailNewProductEnabled).toBe(emailNewProduct);
            expect(readResult.emailNewContentEnabled).toBe(emailNewContent);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

// ============================================================================
// Property 2: Feature toggle validation rejects non-boolean inputs
// Feature: admin-email-permission, Property 2: Feature toggle validation rejects non-boolean inputs
//
// For any input where adminEmailProductsEnabled or adminEmailContentEnabled is
// not a boolean type (string, number, null, undefined, object, array),
// updateFeatureToggles should return { success: false } with an error.
//
// **Validates: Requirements 1.5**
// ============================================================================

/** Arbitrary that generates any non-boolean value */
const nonBooleanArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.float(),
  fc.constant(null),
  fc.constant(undefined),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string()),
  fc.array(fc.integer(), { maxLength: 5 }),
);

describe('Feature: admin-email-permission, Property 2: Feature toggle validation rejects non-boolean inputs', () => {
  it(
    'should reject with INVALID_REQUEST when adminEmailProductsEnabled is not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBooleanArb, fc.boolean(), async (invalidValue, validBool) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: true,
              pointsClaimEnabled: true,
              adminProductsEnabled: true,
              adminOrdersEnabled: true,
              adminContentReviewEnabled: false,
              adminCategoriesEnabled: false,
              emailPointsEarnedEnabled: false,
              emailNewOrderEnabled: false,
              emailOrderShippedEnabled: false,
              emailNewProductEnabled: false,
              emailNewContentEnabled: false,
              adminEmailProductsEnabled: invalidValue as any,
              adminEmailContentEnabled: validBool,
              updatedBy: 'test-user',
            },
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
    'should reject with INVALID_REQUEST when adminEmailContentEnabled is not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), nonBooleanArb, async (validBool, invalidValue) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: true,
              pointsClaimEnabled: true,
              adminProductsEnabled: true,
              adminOrdersEnabled: true,
              adminContentReviewEnabled: false,
              adminCategoriesEnabled: false,
              emailPointsEarnedEnabled: false,
              emailNewOrderEnabled: false,
              emailOrderShippedEnabled: false,
              emailNewProductEnabled: false,
              emailNewContentEnabled: false,
              adminEmailProductsEnabled: validBool,
              adminEmailContentEnabled: invalidValue as any,
              updatedBy: 'test-user',
            },
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
    'should reject with INVALID_REQUEST when both fields are not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBooleanArb, nonBooleanArb, async (invalidA, invalidB) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: true,
              pointsClaimEnabled: true,
              adminProductsEnabled: true,
              adminOrdersEnabled: true,
              adminContentReviewEnabled: false,
              adminCategoriesEnabled: false,
              emailPointsEarnedEnabled: false,
              emailNewOrderEnabled: false,
              emailOrderShippedEnabled: false,
              emailNewProductEnabled: false,
              emailNewContentEnabled: false,
              adminEmailProductsEnabled: invalidA as any,
              adminEmailContentEnabled: invalidB as any,
              updatedBy: 'test-user',
            },
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
});
