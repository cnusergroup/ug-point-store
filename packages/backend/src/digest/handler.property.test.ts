import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ============================================================
// Mocks — must be declared before importing handler
// ============================================================

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

const mockGetFeatureToggles = vi.fn();
vi.mock('../settings/feature-toggles', () => ({
  getFeatureToggles: (...args: any[]) => mockGetFeatureToggles(...args),
}));

const mockGetTemplate = vi.fn();
vi.mock('../email/templates', () => ({
  getTemplate: (...args: any[]) => mockGetTemplate(...args),
  replaceVariables: vi.fn((template: string, vars: Record<string, string>) => {
    return template.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => vars[k] ?? '');
  }),
}));

const mockSendBulkEmail = vi.fn();
vi.mock('../email/send', () => ({
  sendBulkEmail: (...args: any[]) => mockSendBulkEmail(...args),
}));

const mockQueryNewProducts = vi.fn();
const mockQueryNewContent = vi.fn();
const mockQuerySubscribers = vi.fn();
const mockGroupByLocale = vi.fn();
vi.mock('./query', () => ({
  queryNewProducts: (...args: any[]) => mockQueryNewProducts(...args),
  queryNewContent: (...args: any[]) => mockQueryNewContent(...args),
  querySubscribers: (...args: any[]) => mockQuerySubscribers(...args),
  groupByLocale: (...args: any[]) => mockGroupByLocale(...args),
}));

const mockGetDigestVariant = vi.fn();
const mockFormatProductList = vi.fn();
const mockFormatContentList = vi.fn();
const mockComposeDigestEmail = vi.fn();
const mockShouldSkipDigest = vi.fn();
vi.mock('./compose', () => ({
  getDigestVariant: (...args: any[]) => mockGetDigestVariant(...args),
  formatProductList: (...args: any[]) => mockFormatProductList(...args),
  formatContentList: (...args: any[]) => mockFormatContentList(...args),
  composeDigestEmail: (...args: any[]) => mockComposeDigestEmail(...args),
  shouldSkipDigest: (...args: any[]) => mockShouldSkipDigest(...args),
}));

import { handler } from './handler';

// ============================================================
// Helpers
// ============================================================

function resetAllMocks() {
  mockGetFeatureToggles.mockReset();
  mockGetTemplate.mockReset();
  mockSendBulkEmail.mockReset();
  mockQueryNewProducts.mockReset();
  mockQueryNewContent.mockReset();
  mockQuerySubscribers.mockReset();
  mockGroupByLocale.mockReset();
  mockGetDigestVariant.mockReset();
  mockFormatProductList.mockReset();
  mockFormatContentList.mockReset();
  mockComposeDigestEmail.mockReset();
  mockShouldSkipDigest.mockReset();
}

// ============================================================
// Property Tests — Properties 9–11
// ============================================================

describe('Digest Handler Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  /**
   * Feature: weekly-digest-email, Property 9: Toggle disables all processing
   *
   * For any system state where emailWeeklyDigestEnabled is false,
   * the digest handler SHALL not perform any DynamoDB scans for products,
   * content, or subscribers, and SHALL not invoke any SES send operations.
   *
   * **Validates: Requirements 8.2**
   */
  it('Property 9: When toggle is false, no DynamoDB scans or SES sends occur', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary toggle objects where emailWeeklyDigestEnabled is always false
        fc.record({
          emailWeeklyDigestEnabled: fc.constant(false),
          codeRedemptionEnabled: fc.boolean(),
          pointsClaimEnabled: fc.boolean(),
          emailPointsEarnedEnabled: fc.boolean(),
          emailNewOrderEnabled: fc.boolean(),
        }),
        async (toggles) => {
          resetAllMocks();

          mockGetFeatureToggles.mockResolvedValue(toggles);

          await handler({});

          // No DynamoDB scans should occur
          expect(mockQueryNewProducts).not.toHaveBeenCalled();
          expect(mockQueryNewContent).not.toHaveBeenCalled();
          expect(mockQuerySubscribers).not.toHaveBeenCalled();

          // No SES sends should occur
          expect(mockSendBulkEmail).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: weekly-digest-email, Property 10: DynamoDB error prevents email sending
   *
   * For any DynamoDB read error during product or content querying,
   * the digest handler SHALL not invoke any SES send operations
   * and SHALL terminate gracefully.
   *
   * **Validates: Requirements 12.1**
   */
  it('Property 10: When DynamoDB read error occurs, no SES sends happen', async () => {
    const errorScenarioArb = fc.constantFrom(
      'products' as const,
      'content' as const,
      'subscribers' as const,
    );

    const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 });

    await fc.assert(
      fc.asyncProperty(
        errorScenarioArb,
        errorMessageArb,
        async (errorSource, errorMessage) => {
          resetAllMocks();

          mockGetFeatureToggles.mockResolvedValue({ emailWeeklyDigestEnabled: true });

          if (errorSource === 'products') {
            mockQueryNewProducts.mockRejectedValue(new Error(errorMessage));
            mockQueryNewContent.mockResolvedValue([]);
          } else if (errorSource === 'content') {
            mockQueryNewProducts.mockResolvedValue([]);
            mockQueryNewContent.mockRejectedValue(new Error(errorMessage));
          } else {
            // subscribers error
            mockQueryNewProducts.mockResolvedValue([{ name: 'P', pointsCost: 1, createdAt: '2024-01-01' }]);
            mockQueryNewContent.mockResolvedValue([]);
            mockShouldSkipDigest.mockReturnValue(false);
            mockQuerySubscribers.mockRejectedValue(new Error(errorMessage));
          }

          await handler({});

          // No SES sends should occur regardless of which DynamoDB operation failed
          expect(mockSendBulkEmail).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Feature: weekly-digest-email, Property 11: SES batch error resilience
   *
   * For any sequence of N email batches where batch K fails (0 ≤ K < N),
   * all batches after K SHALL still be attempted.
   * The total number of batch attempts SHALL equal N regardless of individual failures.
   *
   * **Validates: Requirements 12.2**
   */
  it('Property 11: When batch K fails, all remaining batches still attempted (total attempts = N)', async () => {
    const localeArb = fc.constantFrom('zh', 'en', 'ja', 'ko', 'zh-TW') as fc.Arbitrary<string>;

    const subscriberArb = fc.record({
      email: fc.emailAddress(),
      nickname: fc.string({ minLength: 1, maxLength: 20 }),
      wantsProducts: fc.constant(true),
      wantsContent: fc.constant(true),
    });

    // Generate 1-4 unique locale groups, each with 1-3 subscribers
    const localeGroupsArb = fc.array(
      fc.tuple(localeArb, fc.array(subscriberArb, { minLength: 1, maxLength: 3 })),
      { minLength: 1, maxLength: 4 },
    ).map((groups) => {
      const seen = new Set<string>();
      return groups.filter(([locale]) => {
        if (seen.has(locale)) return false;
        seen.add(locale);
        return true;
      });
    }).filter((groups) => groups.length >= 1);

    const failingBatchArb = fc.nat({ max: 10 });

    await fc.assert(
      fc.asyncProperty(
        localeGroupsArb,
        failingBatchArb,
        async (localeGroups, failingBatchIdx) => {
          resetAllMocks();

          mockGetFeatureToggles.mockResolvedValue({ emailWeeklyDigestEnabled: true });

          const products = [{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }];
          mockQueryNewProducts.mockResolvedValue(products);
          mockQueryNewContent.mockResolvedValue([]);
          mockShouldSkipDigest.mockReturnValue(false);

          // Build subscribers and locale map
          const allSubscribers: any[] = [];
          const localeMap = new Map<string, any[]>();

          for (const [locale, subs] of localeGroups) {
            const fullSubs = subs.map((s) => ({
              ...s,
              locale,
              wantsProducts: true,
              wantsContent: true,
            }));
            allSubscribers.push(...fullSubs);
            localeMap.set(locale, fullSubs);
          }

          mockQuerySubscribers.mockResolvedValue(allSubscribers);
          mockGroupByLocale.mockReturnValue(localeMap);

          mockGetTemplate.mockImplementation((_c: any, _t: any, _type: any, locale: string) => {
            return Promise.resolve({
              templateId: 'weeklyDigest',
              locale,
              subject: 'Digest',
              body: '<p>Body</p>',
              updatedAt: '2024-01-01',
            });
          });

          mockGetDigestVariant.mockReturnValue('both');
          mockFormatProductList.mockReturnValue('<ul><li>P1</li></ul>');
          mockFormatContentList.mockReturnValue('<p>No content</p>');
          mockComposeDigestEmail.mockReturnValue({
            subject: 'Digest',
            htmlBody: '<p>Body</p>',
          });

          // Total expected sendBulkEmail calls = number of locale groups
          // (each locale group has one variant: 'both')
          const expectedCalls = localeGroups.length;

          // Normalize failingBatchIdx to be within range
          const actualFailIdx = failingBatchIdx % expectedCalls;

          let callCount = 0;
          mockSendBulkEmail.mockImplementation(() => {
            const idx = callCount++;
            if (idx === actualFailIdx) {
              // This batch "fails" — sendBulkEmail returns a result with failureCount > 0
              return Promise.resolve({
                totalBatches: 1,
                successCount: 0,
                failureCount: 1,
                errors: [{ batchIndex: 0, error: 'SES throttle' }],
              });
            }
            return Promise.resolve({
              totalBatches: 1,
              successCount: 1,
              failureCount: 0,
              errors: [],
            });
          });

          await handler({});

          // All batches should be attempted regardless of failures
          expect(mockSendBulkEmail).toHaveBeenCalledTimes(expectedCalls);
        },
      ),
      { numRuns: 100 },
    );
  });
});
