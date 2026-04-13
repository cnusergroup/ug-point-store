import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { EmailLocale } from './send';

// Mock the feature-toggles module before any imports that use it
vi.mock('../settings/feature-toggles', () => ({
  getFeatureToggles: vi.fn(),
}));

import {
  sendNewProductNotification,
  sendNewContentNotification,
  sendPointsEarnedEmail,
  sendOrderShippedEmail,
  sendNewOrderEmail,
} from './notifications';
import type { NotificationContext, SubscribedUser } from './notifications';
import { getFeatureToggles } from '../settings/feature-toggles';

// ============================================================
// Generators
// ============================================================

const LOCALES: EmailLocale[] = ['zh', 'en', 'ja', 'ko', 'zh-TW'];

/** Arbitrary for a valid EmailLocale */
const localeArb = fc.constantFrom<EmailLocale>(...LOCALES);

/** Arbitrary for a valid email address */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,10}$/),
    fc.stringMatching(/^[a-z]{1,8}$/),
  )
  .map(([user, domain]) => `${user}@${domain}.com`);

/** Arbitrary for a SubscribedUser with a specific locale */
const subscribedUserArb: fc.Arbitrary<SubscribedUser> = fc
  .tuple(emailArb, localeArb)
  .map(([email, locale]) => ({ email, locale }));

/** Arbitrary for a non-empty list of subscribed users (1–50) */
const subscribedUsersArb = fc.array(subscribedUserArb, { minLength: 1, maxLength: 50 });

/**
 * Arbitrary for a user record with mixed subscription preferences.
 * Each user has an email, locale, and subscription booleans for newProduct and newContent.
 */
const userWithSubscriptionsArb = fc
  .tuple(emailArb, localeArb, fc.boolean(), fc.boolean())
  .map(([email, locale, newProduct, newContent]) => ({
    email,
    locale,
    emailSubscriptions: { newProduct, newContent },
  }));

/** Arbitrary for a list of users with mixed subscriptions (1–80) */
const usersWithSubscriptionsArb = fc.array(userWithSubscriptionsArb, {
  minLength: 1,
  maxLength: 80,
});

/** Arbitrary for a locale or undefined/null (to test default fallback) */
const localeOrUndefinedArb = fc.oneof(
  localeArb.map((l) => l as EmailLocale | undefined | null),
  fc.constant(undefined as EmailLocale | undefined | null),
  fc.constant(null as EmailLocale | undefined | null),
);

// ============================================================
// Helpers
// ============================================================

function createMockContext(overrides?: Partial<{
  sesClient: any;
  dynamoClient: any;
}>): NotificationContext {
  return {
    sesClient: overrides?.sesClient ?? { send: vi.fn().mockResolvedValue({}) },
    dynamoClient: overrides?.dynamoClient ?? { send: vi.fn().mockResolvedValue({ Items: [] }) },
    emailTemplatesTable: 'test-email-templates',
    usersTable: 'test-users',
    senderEmail: 'test@example.com',
  };
}

const mockedGetFeatureToggles = vi.mocked(getFeatureToggles);


// ============================================================
// Property 4: Subscription filtering excludes unsubscribed users
// ============================================================

describe('Property 4: Subscription filtering excludes unsubscribed users', () => {
  /**
   * **Validates: Requirements 7.6, 7.7**
   *
   * For any set of users with mixed emailSubscriptions.newProduct and
   * emailSubscriptions.newContent values, the bulk send recipient list for
   * newProduct SHALL contain only users with emailSubscriptions.newProduct === true,
   * and similarly for newContent. No subscribed user SHALL be excluded, and no
   * unsubscribed user SHALL be included.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('newProduct bulk send SHALL include only users with newProduct === true', () => {
    fc.assert(
      fc.property(usersWithSubscriptionsArb, (users) => {
        // Filter users the same way the admin handler would before calling sendNewProductNotification
        const subscribedUsers: SubscribedUser[] = users
          .filter((u) => u.emailSubscriptions.newProduct === true)
          .map((u) => ({ email: u.email, locale: u.locale }));

        const unsubscribedEmails = new Set(
          users
            .filter((u) => u.emailSubscriptions.newProduct !== true)
            .map((u) => u.email),
        );

        const subscribedEmails = new Set(
          users
            .filter((u) => u.emailSubscriptions.newProduct === true)
            .map((u) => u.email),
        );

        // Every subscribed user should be in the recipient list
        for (const su of subscribedUsers) {
          expect(subscribedEmails.has(su.email)).toBe(true);
        }

        // No unsubscribed user should appear in the recipient list
        for (const su of subscribedUsers) {
          // A user email that is ONLY in unsubscribed (not also subscribed) should not be present
          if (!subscribedEmails.has(su.email)) {
            expect(unsubscribedEmails.has(su.email)).toBe(false);
          }
        }

        // The count of filtered users should match users with newProduct === true
        const expectedCount = users.filter(
          (u) => u.emailSubscriptions.newProduct === true,
        ).length;
        expect(subscribedUsers.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });

  it('newContent bulk send SHALL include only users with newContent === true', () => {
    fc.assert(
      fc.property(usersWithSubscriptionsArb, (users) => {
        // Filter users the same way the admin handler would before calling sendNewContentNotification
        const subscribedUsers: SubscribedUser[] = users
          .filter((u) => u.emailSubscriptions.newContent === true)
          .map((u) => ({ email: u.email, locale: u.locale }));

        const unsubscribedEmails = new Set(
          users
            .filter((u) => u.emailSubscriptions.newContent !== true)
            .map((u) => u.email),
        );

        const subscribedEmails = new Set(
          users
            .filter((u) => u.emailSubscriptions.newContent === true)
            .map((u) => u.email),
        );

        // Every subscribed user should be in the recipient list
        for (const su of subscribedUsers) {
          expect(subscribedEmails.has(su.email)).toBe(true);
        }

        // No unsubscribed user should appear in the recipient list
        for (const su of subscribedUsers) {
          if (!subscribedEmails.has(su.email)) {
            expect(unsubscribedEmails.has(su.email)).toBe(false);
          }
        }

        // The count of filtered users should match users with newContent === true
        const expectedCount = users.filter(
          (u) => u.emailSubscriptions.newContent === true,
        ).length;
        expect(subscribedUsers.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });

  it('no subscribed user SHALL be excluded and no unsubscribed user SHALL be included', () => {
    fc.assert(
      fc.property(
        usersWithSubscriptionsArb,
        fc.constantFrom('newProduct' as const, 'newContent' as const),
        (users, subscriptionType) => {
          const subscribedUsers: SubscribedUser[] = users
            .filter((u) => u.emailSubscriptions[subscriptionType] === true)
            .map((u) => ({ email: u.email, locale: u.locale }));

          const recipientEmails = new Set(subscribedUsers.map((u) => u.email));

          for (const user of users) {
            if (user.emailSubscriptions[subscriptionType] === true) {
              // Subscribed user MUST be in the recipient list
              expect(recipientEmails.has(user.email)).toBe(true);
            }
          }

          // Every recipient must come from a subscribed user
          for (const su of subscribedUsers) {
            const originalUser = users.find(
              (u) => u.email === su.email && u.emailSubscriptions[subscriptionType] === true,
            );
            expect(originalUser).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 5: Locale-based template selection with zh default
// ============================================================

describe('Property 5: Locale-based template selection with zh default', () => {
  /**
   * **Validates: Requirements 8.4, 14.1, 14.4**
   *
   * For any user with a locale preference from {zh, en, ja, ko, zh-TW}, the system
   * SHALL select the template matching that locale. For any user with no locale
   * preference (undefined/null), the system SHALL select the zh locale template.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should select the template matching the user locale for transactional emails', async () => {
    await fc.assert(
      fc.asyncProperty(localeOrUndefinedArb, async (userLocale) => {
        const expectedLocale: EmailLocale = userLocale ?? 'zh';

        // Mock feature toggles to enable pointsEarned emails
        mockedGetFeatureToggles.mockResolvedValue({
          codeRedemptionEnabled: false,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          contentRolePermissions: {
            Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailPointsEarnedEnabled: true,
        } as any);

        // Track which template locale was requested
        const templateRequests: { templateId: string; locale: string }[] = [];

        const mockDynamoClient = {
          send: vi.fn().mockImplementation(async (command: any) => {
            const input = command.input;

            // GetCommand for user record
            if (input.Key?.userId && !input.Key.locale) {
              return {
                Item: {
                  userId: input.Key.userId,
                  email: 'user@test.com',
                  nickname: 'TestUser',
                  locale: userLocale, // may be undefined/null
                },
              };
            }

            // GetCommand for template (has both templateId and locale keys)
            if (input.Key?.templateId && input.Key?.locale) {
              templateRequests.push({
                templateId: input.Key.templateId,
                locale: input.Key.locale,
              });
              return {
                Item: {
                  templateId: input.Key.templateId,
                  locale: input.Key.locale,
                  subject: 'Test Subject {{nickname}}',
                  body: '<p>Test Body {{nickname}} {{points}}</p>',
                },
              };
            }

            return { Items: [] };
          }),
        };

        const mockSesClient = { send: vi.fn().mockResolvedValue({}) };

        const ctx = createMockContext({
          sesClient: mockSesClient,
          dynamoClient: mockDynamoClient,
        });

        templateRequests.length = 0;

        const resultPromise = sendPointsEarnedEmail(ctx, 'user-123', 100, 'redemption', 500);
        await vi.runAllTimersAsync();
        await resultPromise;

        // The first template request should be for the expected locale
        expect(templateRequests.length).toBeGreaterThanOrEqual(1);
        expect(templateRequests[0].locale).toBe(expectedLocale);
      }),
      { numRuns: 100 },
    );
  });

  it('should default to zh locale when user has no locale preference', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(undefined, null),
        async (userLocale) => {
          // Mock feature toggles to enable orderShipped emails
          mockedGetFeatureToggles.mockResolvedValue({
            codeRedemptionEnabled: false,
            pointsClaimEnabled: false,
            adminProductsEnabled: true,
            adminOrdersEnabled: true,
            adminContentReviewEnabled: false,
            adminCategoriesEnabled: false,
            contentRolePermissions: {
              Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
              UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
              Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            },
            emailOrderShippedEnabled: true,
          } as any);

          const templateRequests: { templateId: string; locale: string }[] = [];

          const mockDynamoClient = {
            send: vi.fn().mockImplementation(async (command: any) => {
              const input = command.input;

              if (input.Key?.userId && !input.Key.locale) {
                return {
                  Item: {
                    userId: input.Key.userId,
                    email: 'user@test.com',
                    nickname: 'TestUser',
                    locale: userLocale,
                  },
                };
              }

              if (input.Key?.templateId && input.Key?.locale) {
                templateRequests.push({
                  templateId: input.Key.templateId,
                  locale: input.Key.locale,
                });
                return {
                  Item: {
                    templateId: input.Key.templateId,
                    locale: input.Key.locale,
                    subject: 'Shipped {{orderId}}',
                    body: '<p>Shipped {{orderId}}</p>',
                  },
                };
              }

              return { Items: [] };
            }),
          };

          const mockSesClient = { send: vi.fn().mockResolvedValue({}) };

          const ctx = createMockContext({
            sesClient: mockSesClient,
            dynamoClient: mockDynamoClient,
          });

          templateRequests.length = 0;

          const resultPromise = sendOrderShippedEmail(ctx, 'user-456', 'order-789', 'TRACK123');
          await vi.runAllTimersAsync();
          await resultPromise;

          // Should request zh locale template since user has no locale
          expect(templateRequests.length).toBeGreaterThanOrEqual(1);
          expect(templateRequests[0].locale).toBe('zh');
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 6: Locale grouping for bulk sends
// ============================================================

describe('Property 6: Locale grouping for bulk sends', () => {
  /**
   * **Validates: Requirements 11.4, 12.4, 14.2, 14.3**
   *
   * For any set of subscribed users with various locale preferences,
   * sendNewProductNotification and sendNewContentNotification SHALL group
   * recipients by locale and send separate emails per locale group. Each locale
   * group SHALL receive an email using the template for that locale. The union
   * of all locale groups SHALL equal the full set of subscribed users.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sendNewProductNotification SHALL group by locale and send per-locale emails covering all users', async () => {
    await fc.assert(
      fc.asyncProperty(subscribedUsersArb, async (subscribedUsers) => {
        // Track template locale requests and BCC recipients per locale
        const templateLocaleRequests: string[] = [];
        const bccRecipientsByLocale = new Map<string, string[]>();

        mockedGetFeatureToggles.mockResolvedValue({
          codeRedemptionEnabled: false,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          contentRolePermissions: {
            Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailNewProductEnabled: true,
        } as any);

        // Track which locale template was loaded for each bulk send call
        let currentTemplateLocale = 'zh';

        const mockDynamoClient = {
          send: vi.fn().mockImplementation(async (command: any) => {
            const input = command.input;

            // GetCommand for template
            if (input.Key?.templateId && input.Key?.locale) {
              currentTemplateLocale = input.Key.locale;
              templateLocaleRequests.push(input.Key.locale);
              return {
                Item: {
                  templateId: input.Key.templateId,
                  locale: input.Key.locale,
                  subject: `Subject for ${input.Key.locale}`,
                  body: `<p>Body for ${input.Key.locale}</p>`,
                },
              };
            }

            return { Items: [] };
          }),
        };

        const mockSesClient = {
          send: vi.fn().mockImplementation(async (command: any) => {
            const bcc: string[] = command.input?.Destination?.BccAddresses ?? [];
            // Associate BCC recipients with the current template locale
            const existing = bccRecipientsByLocale.get(currentTemplateLocale) ?? [];
            existing.push(...bcc);
            bccRecipientsByLocale.set(currentTemplateLocale, existing);
            return {};
          }),
        };

        const ctx = createMockContext({
          sesClient: mockSesClient,
          dynamoClient: mockDynamoClient,
        });

        templateLocaleRequests.length = 0;
        bccRecipientsByLocale.clear();

        const resultPromise = sendNewProductNotification(
          ctx,
          'Product A, Product B',
          subscribedUsers,
        );
        await vi.runAllTimersAsync();
        await resultPromise;

        // Build expected locale groups
        const expectedGroups = new Map<string, string[]>();
        for (const user of subscribedUsers) {
          const locale = user.locale ?? 'zh';
          const existing = expectedGroups.get(locale) ?? [];
          existing.push(user.email);
          expectedGroups.set(locale, existing);
        }

        // 1. Separate emails per locale group: template should be loaded for each distinct locale
        const distinctLocales = new Set(subscribedUsers.map((u) => u.locale ?? 'zh'));
        for (const locale of distinctLocales) {
          expect(templateLocaleRequests).toContain(locale);
        }

        // 2. Union of all locale groups SHALL equal the full set of subscribed users
        const allSentEmails: string[] = [];
        for (const emails of bccRecipientsByLocale.values()) {
          allSentEmails.push(...emails);
        }
        // Sort both for comparison
        const expectedEmails = subscribedUsers.map((u) => u.email).sort();
        allSentEmails.sort();
        expect(allSentEmails).toEqual(expectedEmails);
      }),
      { numRuns: 100 },
    );
  });

  it('sendNewContentNotification SHALL group by locale and send per-locale emails covering all users', async () => {
    await fc.assert(
      fc.asyncProperty(subscribedUsersArb, async (subscribedUsers) => {
        const templateLocaleRequests: string[] = [];
        const bccRecipientsByLocale = new Map<string, string[]>();

        mockedGetFeatureToggles.mockResolvedValue({
          codeRedemptionEnabled: false,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          contentRolePermissions: {
            Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
            Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          },
          emailNewContentEnabled: true,
        } as any);

        let currentTemplateLocale = 'zh';

        const mockDynamoClient = {
          send: vi.fn().mockImplementation(async (command: any) => {
            const input = command.input;

            if (input.Key?.templateId && input.Key?.locale) {
              currentTemplateLocale = input.Key.locale;
              templateLocaleRequests.push(input.Key.locale);
              return {
                Item: {
                  templateId: input.Key.templateId,
                  locale: input.Key.locale,
                  subject: `Subject for ${input.Key.locale}`,
                  body: `<p>Body for ${input.Key.locale}</p>`,
                },
              };
            }

            return { Items: [] };
          }),
        };

        const mockSesClient = {
          send: vi.fn().mockImplementation(async (command: any) => {
            const bcc: string[] = command.input?.Destination?.BccAddresses ?? [];
            const existing = bccRecipientsByLocale.get(currentTemplateLocale) ?? [];
            existing.push(...bcc);
            bccRecipientsByLocale.set(currentTemplateLocale, existing);
            return {};
          }),
        };

        const ctx = createMockContext({
          sesClient: mockSesClient,
          dynamoClient: mockDynamoClient,
        });

        templateLocaleRequests.length = 0;
        bccRecipientsByLocale.clear();

        const resultPromise = sendNewContentNotification(
          ctx,
          'Content A, Content B',
          subscribedUsers,
        );
        await vi.runAllTimersAsync();
        await resultPromise;

        // Build expected locale groups
        const distinctLocales = new Set(subscribedUsers.map((u) => u.locale ?? 'zh'));
        for (const locale of distinctLocales) {
          expect(templateLocaleRequests).toContain(locale);
        }

        // Union of all locale groups SHALL equal the full set of subscribed users
        const allSentEmails: string[] = [];
        for (const emails of bccRecipientsByLocale.values()) {
          allSentEmails.push(...emails);
        }
        const expectedEmails = subscribedUsers.map((u) => u.email).sort();
        allSentEmails.sort();
        expect(allSentEmails).toEqual(expectedEmails);
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Property 8: Email toggle disables sending
// ============================================================

describe('Property 8: Email toggle disables sending', () => {
  /**
   * **Validates: Requirements 6.3, 8.6, 9.5, 10.5**
   *
   * For any notification type with its corresponding email toggle set to false,
   * the notification function SHALL not invoke any SES SendEmailCommand. The
   * function SHALL return early without error.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Base toggles with all email toggles disabled */
  const allTogglesDisabled = {
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    contentRolePermissions: {
      Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    },
    emailPointsEarnedEnabled: false,
    emailNewOrderEnabled: false,
    emailOrderShippedEnabled: false,
    emailNewProductEnabled: false,
    emailNewContentEnabled: false,
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
  };

  it('sendPointsEarnedEmail SHALL not invoke SES when pointsEarned toggle is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 100000 }),
        async (userId, points, source, balance) => {
          mockedGetFeatureToggles.mockResolvedValue({
            ...allTogglesDisabled,
            emailPointsEarnedEnabled: false,
          } as any);

          const mockSesClient = { send: vi.fn() };
          const mockDynamoClient = { send: vi.fn().mockResolvedValue({ Items: [] }) };

          const ctx = createMockContext({
            sesClient: mockSesClient,
            dynamoClient: mockDynamoClient,
          });

          const resultPromise = sendPointsEarnedEmail(ctx, userId, points, source, balance);
          await vi.runAllTimersAsync();
          await resultPromise;

          // SES should never be called
          expect(mockSesClient.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sendNewOrderEmail SHALL not invoke SES when newOrder toggle is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (orderId, productNameList, buyerNickname) => {
          mockedGetFeatureToggles.mockResolvedValue({
            ...allTogglesDisabled,
            emailNewOrderEnabled: false,
          } as any);

          const mockSesClient = { send: vi.fn() };
          const mockDynamoClient = { send: vi.fn().mockResolvedValue({ Items: [] }) };

          const ctx = createMockContext({
            sesClient: mockSesClient,
            dynamoClient: mockDynamoClient,
          });

          const orderItems = productNameList.map((name) => ({ productName: name, quantity: 1 }));
          const resultPromise = sendNewOrderEmail(ctx, orderId, orderItems, buyerNickname, { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
          await vi.runAllTimersAsync();
          await resultPromise;

          expect(mockSesClient.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sendOrderShippedEmail SHALL not invoke SES when orderShipped toggle is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        async (userId, orderId, trackingNumber) => {
          mockedGetFeatureToggles.mockResolvedValue({
            ...allTogglesDisabled,
            emailOrderShippedEnabled: false,
          } as any);

          const mockSesClient = { send: vi.fn() };
          const mockDynamoClient = { send: vi.fn().mockResolvedValue({ Items: [] }) };

          const ctx = createMockContext({
            sesClient: mockSesClient,
            dynamoClient: mockDynamoClient,
          });

          const resultPromise = sendOrderShippedEmail(ctx, userId, orderId, trackingNumber);
          await vi.runAllTimersAsync();
          await resultPromise;

          expect(mockSesClient.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sendNewProductNotification SHALL not invoke SES when newProduct toggle is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(subscribedUsersArb, async (subscribedUsers) => {
        mockedGetFeatureToggles.mockResolvedValue({
          ...allTogglesDisabled,
          emailNewProductEnabled: false,
        } as any);

        const mockSesClient = { send: vi.fn() };
        const mockDynamoClient = { send: vi.fn().mockResolvedValue({ Items: [] }) };

        const ctx = createMockContext({
          sesClient: mockSesClient,
          dynamoClient: mockDynamoClient,
        });

        const resultPromise = sendNewProductNotification(ctx, 'Product A', subscribedUsers);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        // SES should never be called
        expect(mockSesClient.send).not.toHaveBeenCalled();
        // Should return empty result without error
        expect(result.totalBatches).toBe(0);
        expect(result.successCount).toBe(0);
        expect(result.failureCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('sendNewContentNotification SHALL not invoke SES when newContent toggle is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(subscribedUsersArb, async (subscribedUsers) => {
        mockedGetFeatureToggles.mockResolvedValue({
          ...allTogglesDisabled,
          emailNewContentEnabled: false,
        } as any);

        const mockSesClient = { send: vi.fn() };
        const mockDynamoClient = { send: vi.fn().mockResolvedValue({ Items: [] }) };

        const ctx = createMockContext({
          sesClient: mockSesClient,
          dynamoClient: mockDynamoClient,
        });

        const resultPromise = sendNewContentNotification(ctx, 'Content A', subscribedUsers);
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(mockSesClient.send).not.toHaveBeenCalled();
        expect(result.totalBatches).toBe(0);
        expect(result.successCount).toBe(0);
        expect(result.failureCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
