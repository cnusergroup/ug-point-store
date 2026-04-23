import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function makeToggles(overrides: Record<string, unknown> = {}) {
  return {
    emailWeeklyDigestEnabled: true,
    ...overrides,
  };
}

function makeTemplate(locale: string) {
  return {
    templateId: 'weeklyDigest',
    locale,
    subject: '{{nickname}} Weekly Digest',
    body: '<p>Products: {{productList}}, Content: {{contentList}}</p>',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ============================================================
// Tests
// ============================================================

describe('Digest Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('Toggle check (5.2)', () => {
    it('skips processing when toggle is disabled', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles({ emailWeeklyDigestEnabled: false }));

      await handler({});

      expect(console.log).toHaveBeenCalledWith('[Digest] Starting weekly digest execution');
      expect(console.log).toHaveBeenCalledWith('[Digest] Feature disabled, skipping');
      expect(mockQueryNewProducts).not.toHaveBeenCalled();
      expect(mockQueryNewContent).not.toHaveBeenCalled();
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });

    it('treats toggle read failure as disabled', async () => {
      mockGetFeatureToggles.mockRejectedValue(new Error('DynamoDB error'));

      await handler({});

      expect(console.log).toHaveBeenCalledWith('[Digest] Feature disabled, skipping');
      expect(mockQueryNewProducts).not.toHaveBeenCalled();
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });
  });

  describe('Empty digest skip (5.3)', () => {
    it('skips when both product and content lists are empty', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockResolvedValue([]);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(true);

      await handler({});

      expect(console.log).toHaveBeenCalledWith('[Digest] No new products or content, skipping');
      expect(mockQuerySubscribers).not.toHaveBeenCalled();
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });

    it('proceeds when products exist but content is empty', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockResolvedValue([{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }]);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);
      mockQuerySubscribers.mockResolvedValue([]);

      await handler({});

      expect(mockQuerySubscribers).toHaveBeenCalled();
    });
  });

  describe('DynamoDB error handling', () => {
    it('terminates gracefully on product query error', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockRejectedValue(new Error('Products scan failed'));
      mockQueryNewContent.mockResolvedValue([]);

      await handler({});

      expect(console.error).toHaveBeenCalledWith(
        '[Digest] DynamoDB read error during product/content query:',
        expect.any(Error),
      );
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });

    it('terminates gracefully on content query error', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockResolvedValue([]);
      mockQueryNewContent.mockRejectedValue(new Error('Content scan failed'));

      await handler({});

      expect(console.error).toHaveBeenCalledWith(
        '[Digest] DynamoDB read error during product/content query:',
        expect.any(Error),
      );
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });

    it('terminates gracefully on subscriber query error', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockResolvedValue([{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }]);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);
      mockQuerySubscribers.mockRejectedValue(new Error('Users scan failed'));

      await handler({});

      expect(console.error).toHaveBeenCalledWith(
        '[Digest] DynamoDB read error during subscriber query:',
        expect.any(Error),
      );
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });
  });

  describe('Per-locale, per-variant sending (5.4)', () => {
    it('sends emails grouped by locale and variant', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }];
      const content = [{ title: 'C1', authorName: 'Author', createdAt: '2024-01-10' }];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue(content);
      mockShouldSkipDigest.mockReturnValue(false);

      const zhSubscribers = [
        { email: 'a@test.com', nickname: 'A', locale: 'zh', wantsProducts: true, wantsContent: true },
        { email: 'b@test.com', nickname: 'B', locale: 'zh', wantsProducts: true, wantsContent: false },
      ];
      const enSubscribers = [
        { email: 'c@test.com', nickname: 'C', locale: 'en', wantsProducts: false, wantsContent: true },
      ];
      mockQuerySubscribers.mockResolvedValue([...zhSubscribers, ...enSubscribers]);

      const localeMap = new Map();
      localeMap.set('zh', zhSubscribers);
      localeMap.set('en', enSubscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      mockGetTemplate.mockImplementation((_client: any, _table: any, _type: any, locale: string) => {
        return Promise.resolve(makeTemplate(locale));
      });

      mockGetDigestVariant.mockImplementation((sub: any) => {
        if (sub.wantsProducts && sub.wantsContent) return 'both';
        if (sub.wantsProducts) return 'productsOnly';
        return 'contentOnly';
      });

      mockFormatProductList.mockReturnValue('<ul><li>P1</li></ul>');
      mockFormatContentList.mockReturnValue('<ul><li>C1</li></ul>');
      mockComposeDigestEmail.mockReturnValue({
        subject: 'Weekly Digest',
        htmlBody: '<p>Digest content</p>',
      });

      mockSendBulkEmail.mockResolvedValue({
        totalBatches: 1,
        successCount: 1,
        failureCount: 0,
        errors: [],
      });

      await handler({});

      // Should send 3 batches: zh-both (1 recipient), zh-productsOnly (1 recipient), en-contentOnly (1 recipient)
      expect(mockSendBulkEmail).toHaveBeenCalledTimes(3);
    });

    it('falls back to zh template when locale template not found', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);

      const subscribers = [
        { email: 'a@test.com', nickname: 'A', locale: 'ja', wantsProducts: true, wantsContent: false },
      ];
      mockQuerySubscribers.mockResolvedValue(subscribers);

      const localeMap = new Map();
      localeMap.set('ja', subscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      // Return null for ja, return template for zh
      mockGetTemplate.mockImplementation((_client: any, _table: any, _type: any, locale: string) => {
        if (locale === 'ja') return Promise.resolve(null);
        if (locale === 'zh') return Promise.resolve(makeTemplate('zh'));
        return Promise.resolve(null);
      });

      mockGetDigestVariant.mockReturnValue('productsOnly');
      mockFormatProductList.mockReturnValue('<ul><li>P1</li></ul>');
      mockFormatContentList.mockReturnValue('<p>No content</p>');
      mockComposeDigestEmail.mockReturnValue({
        subject: 'Digest',
        htmlBody: '<p>Content</p>',
      });
      mockSendBulkEmail.mockResolvedValue({
        totalBatches: 1,
        successCount: 1,
        failureCount: 0,
        errors: [],
      });

      await handler({});

      // getTemplate called twice: once for ja (null), once for zh (fallback)
      expect(mockGetTemplate).toHaveBeenCalledTimes(2);
      expect(mockSendBulkEmail).toHaveBeenCalledTimes(1);
    });

    it('skips locale group when neither locale nor zh template found', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);

      const subscribers = [
        { email: 'a@test.com', nickname: 'A', locale: 'ko', wantsProducts: true, wantsContent: false },
      ];
      mockQuerySubscribers.mockResolvedValue(subscribers);

      const localeMap = new Map();
      localeMap.set('ko', subscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      mockGetTemplate.mockResolvedValue(null);

      await handler({});

      expect(console.error).toHaveBeenCalledWith(
        '[Digest] Template not found for locale ko, skipping locale group',
      );
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });

    it('skips sending when no subscribers found', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());
      mockQueryNewProducts.mockResolvedValue([{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }]);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);
      mockQuerySubscribers.mockResolvedValue([]);

      await handler({});

      expect(console.log).toHaveBeenCalledWith('[Digest] No subscribers found, skipping');
      expect(mockSendBulkEmail).not.toHaveBeenCalled();
    });
  });

  describe('Execution summary logging (5.5)', () => {
    it('logs correct summary after successful execution', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [
        { name: 'P1', pointsCost: 100, createdAt: '2024-01-10' },
        { name: 'P2', pointsCost: 200, createdAt: '2024-01-11' },
      ];
      const content = [
        { title: 'C1', authorName: 'Author1', createdAt: '2024-01-10' },
      ];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue(content);
      mockShouldSkipDigest.mockReturnValue(false);

      const subscribers = [
        { email: 'a@test.com', nickname: 'A', locale: 'zh', wantsProducts: true, wantsContent: true },
        { email: 'b@test.com', nickname: 'B', locale: 'zh', wantsProducts: true, wantsContent: true },
      ];
      mockQuerySubscribers.mockResolvedValue(subscribers);

      const localeMap = new Map();
      localeMap.set('zh', subscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      mockGetTemplate.mockResolvedValue(makeTemplate('zh'));
      mockGetDigestVariant.mockReturnValue('both');
      mockFormatProductList.mockReturnValue('<ul><li>P1</li><li>P2</li></ul>');
      mockFormatContentList.mockReturnValue('<ul><li>C1</li></ul>');
      mockComposeDigestEmail.mockReturnValue({
        subject: 'Digest',
        htmlBody: '<p>Content</p>',
      });
      mockSendBulkEmail.mockResolvedValue({
        totalBatches: 1,
        successCount: 1,
        failureCount: 0,
        errors: [],
      });

      await handler({});

      expect(console.log).toHaveBeenCalledWith(
        '[Digest] Complete: 2 subscribers, 1 sent, 0 failed, 2 products, 1 content items',
      );
    });

    it('logs summary with failed batches', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [{ name: 'P1', pointsCost: 100, createdAt: '2024-01-10' }];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue([]);
      mockShouldSkipDigest.mockReturnValue(false);

      const subscribers = [
        { email: 'a@test.com', nickname: 'A', locale: 'zh', wantsProducts: true, wantsContent: false },
      ];
      mockQuerySubscribers.mockResolvedValue(subscribers);

      const localeMap = new Map();
      localeMap.set('zh', subscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      mockGetTemplate.mockResolvedValue(makeTemplate('zh'));
      mockGetDigestVariant.mockReturnValue('productsOnly');
      mockFormatProductList.mockReturnValue('<ul><li>P1</li></ul>');
      mockFormatContentList.mockReturnValue('<p>No content</p>');
      mockComposeDigestEmail.mockReturnValue({
        subject: 'Digest',
        htmlBody: '<p>Content</p>',
      });
      mockSendBulkEmail.mockResolvedValue({
        totalBatches: 2,
        successCount: 1,
        failureCount: 1,
        errors: [{ batchIndex: 1, error: 'SES throttle' }],
      });

      await handler({});

      expect(console.log).toHaveBeenCalledWith(
        '[Digest] Complete: 1 subscribers, 1 sent, 1 failed, 1 products, 0 content items',
      );
      expect(console.error).toHaveBeenCalledWith(
        '[Digest] Batch 2/2 failed: SES throttle',
      );
    });
  });

  describe('Full flow integration', () => {
    it('executes complete happy path', async () => {
      mockGetFeatureToggles.mockResolvedValue(makeToggles());

      const products = [{ name: 'Product A', pointsCost: 50, createdAt: '2024-01-12' }];
      const content = [{ title: 'Article B', authorName: 'Writer', createdAt: '2024-01-13' }];
      mockQueryNewProducts.mockResolvedValue(products);
      mockQueryNewContent.mockResolvedValue(content);
      mockShouldSkipDigest.mockReturnValue(false);

      const subscribers = [
        { email: 'user@test.com', nickname: 'User', locale: 'zh', wantsProducts: true, wantsContent: true },
      ];
      mockQuerySubscribers.mockResolvedValue(subscribers);

      const localeMap = new Map();
      localeMap.set('zh', subscribers);
      mockGroupByLocale.mockReturnValue(localeMap);

      mockGetTemplate.mockResolvedValue(makeTemplate('zh'));
      mockGetDigestVariant.mockReturnValue('both');
      mockFormatProductList.mockReturnValue('<ul><li>Product A — 50 pts</li></ul>');
      mockFormatContentList.mockReturnValue('<ul><li>Article B — Writer</li></ul>');
      mockComposeDigestEmail.mockReturnValue({
        subject: 'Weekly Digest',
        htmlBody: '<p>Your digest</p>',
      });
      mockSendBulkEmail.mockResolvedValue({
        totalBatches: 1,
        successCount: 1,
        failureCount: 0,
        errors: [],
      });

      await handler({});

      expect(console.log).toHaveBeenCalledWith('[Digest] Starting weekly digest execution');
      expect(mockGetFeatureToggles).toHaveBeenCalled();
      expect(mockQueryNewProducts).toHaveBeenCalled();
      expect(mockQueryNewContent).toHaveBeenCalled();
      expect(mockQuerySubscribers).toHaveBeenCalled();
      expect(mockGroupByLocale).toHaveBeenCalled();
      expect(mockGetTemplate).toHaveBeenCalled();
      expect(mockComposeDigestEmail).toHaveBeenCalled();
      expect(mockSendBulkEmail).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        '[Digest] Complete: 1 subscribers, 1 sent, 0 failed, 1 products, 1 content items',
      );
    });
  });
});
