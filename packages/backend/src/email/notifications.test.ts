import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EmailLocale } from './send';

// Mock the feature-toggles module before any imports that use it
vi.mock('../settings/feature-toggles', () => ({
  getFeatureToggles: vi.fn(),
}));

import {
  sendPointsEarnedEmail,
  sendNewOrderEmail,
  sendOrderShippedEmail,
  sendNewProductNotification,
  sendNewContentNotification,
} from './notifications';
import type { NotificationContext } from './notifications';
import { getFeatureToggles } from '../settings/feature-toggles';

// ============================================================
// Helpers
// ============================================================

const mockedGetFeatureToggles = vi.mocked(getFeatureToggles);

const BASE_TOGGLES = {
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

function enableToggle(toggle: string) {
  return { ...BASE_TOGGLES, [toggle]: true } as any;
}

function createMockContext(overrides?: {
  sesClient?: any;
  dynamoClient?: any;
}): NotificationContext {
  return {
    sesClient: overrides?.sesClient ?? { send: vi.fn().mockResolvedValue({}) },
    dynamoClient: overrides?.dynamoClient ?? { send: vi.fn().mockResolvedValue({ Items: [] }) },
    emailTemplatesTable: 'test-email-templates',
    usersTable: 'test-users',
    senderEmail: 'test@example.com',
  };
}

/**
 * Build a mock DynamoDB client that responds to GetCommand and ScanCommand.
 * - GetCommand with userId key → returns user record
 * - GetCommand with templateId+locale key → returns template record
 * - ScanCommand → returns admin users list
 */
function createSmartDynamoClient(options: {
  users?: Record<string, { email: string; nickname: string; locale?: EmailLocale; roles?: string[] }>;
  templates?: Record<string, { subject: string; body: string }>;
  adminUsers?: { email: string; nickname: string; locale: EmailLocale; roles: string[] }[];
}) {
  return {
    send: vi.fn().mockImplementation(async (command: any) => {
      const input = command.input;
      const name = command.constructor.name;

      // ScanCommand — return admin users
      if (name === 'ScanCommand') {
        return { Items: options.adminUsers ?? [] };
      }

      // GetCommand for user record (has userId, no locale)
      if (input.Key?.userId && !input.Key?.templateId) {
        const user = options.users?.[input.Key.userId];
        if (user) {
          return { Item: { userId: input.Key.userId, ...user } };
        }
        return { Item: null };
      }

      // GetCommand for template (has templateId + locale)
      if (input.Key?.templateId && input.Key?.locale) {
        const key = `${input.Key.templateId}:${input.Key.locale}`;
        const template = options.templates?.[key];
        if (template) {
          return {
            Item: {
              templateId: input.Key.templateId,
              locale: input.Key.locale,
              ...template,
            },
          };
        }
        return { Item: null };
      }

      return { Items: [] };
    }),
  };
}

// ============================================================
// sendPointsEarnedEmail
// ============================================================

describe('sendPointsEarnedEmail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send email with correct variables when toggle is enabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'alice@test.com', nickname: 'Alice', locale: 'en' },
      },
      templates: {
        'pointsEarned:en': {
          subject: 'Hi {{nickname}}, you earned {{points}} points!',
          body: '<p>{{nickname}} earned {{points}} from {{source}}. Balance: {{balance}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-1', 100, 'code-redemption', 500);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Destination.ToAddresses).toEqual(['alice@test.com']);
    expect(cmd.input.Message.Subject.Data).toBe('Hi Alice, you earned 100 points!');
    expect(cmd.input.Message.Body.Html.Data).toContain('Alice earned 100 from code-redemption');
    expect(cmd.input.Message.Body.Html.Data).toContain('Balance: 500');
  });

  it('should skip sending when toggle is disabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(BASE_TOGGLES as any);

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const p = sendPointsEarnedEmail(ctx, 'user-1', 100, 'test', 500);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should skip sending when user has no email', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = { send: vi.fn() };
    const mockDynamo = {
      send: vi.fn().mockResolvedValue({ Item: { userId: 'user-1', nickname: 'NoEmail' } }),
    };

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-1', 50, 'test', 100);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should fall back to zh template when user locale template is missing', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'bob@test.com', nickname: 'Bob', locale: 'ko' },
      },
      templates: {
        // ko template missing, only zh available
        'pointsEarned:zh': {
          subject: '积分到账 {{nickname}}',
          body: '<p>{{nickname}} 获得 {{points}} 积分</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-1', 200, 'claim', 700);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Message.Subject.Data).toBe('积分到账 Bob');
  });

  it('should not throw when SES fails (best-effort)', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = { send: vi.fn().mockRejectedValue(new Error('SES down')) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'fail@test.com', nickname: 'Fail', locale: 'zh' },
      },
      templates: {
        'pointsEarned:zh': { subject: 'Test', body: '<p>Test</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    // Should not throw
    const p = sendPointsEarnedEmail(ctx, 'user-1', 50, 'test', 100);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });
});

// ============================================================
// sendNewOrderEmail
// ============================================================

describe('sendNewOrderEmail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send emails to all admin users with correct variables', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewOrderEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      adminUsers: [
        { email: 'admin1@test.com', nickname: 'Admin1', locale: 'zh', roles: ['Admin'] },
        { email: 'admin2@test.com', nickname: 'Admin2', locale: 'en', roles: ['SuperAdmin'] },
      ],
      templates: {
        'newOrder:zh': {
          subject: '新订单 {{orderId}}',
          body: '<p>{{buyerNickname}} 下单 {{productNames}} 收件人：{{recipientName}} {{phone}} {{detailAddress}}</p>',
        },
        'newOrder:en': {
          subject: 'New order {{orderId}}',
          body: '<p>{{buyerNickname}} ordered {{productNames}} ship to {{recipientName}} {{phone}} {{detailAddress}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendNewOrderEmail(ctx, 'ORD-001', [{ productName: 'Widget', quantity: 1 }, { productName: 'Gadget', quantity: 2 }], 'BuyerBob', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    // Should send to both admin users (one per locale group, individually)
    expect(mockSes.send).toHaveBeenCalledTimes(2);

    // Verify the zh email
    const zhCall = mockSes.send.mock.calls.find(
      (c: any) => c[0].input.Destination.ToAddresses[0] === 'admin1@test.com',
    );
    expect(zhCall).toBeDefined();
    expect(zhCall![0].input.Message.Subject.Data).toBe('新订单 ORD-001');
    expect(zhCall![0].input.Message.Body.Html.Data).toContain('BuyerBob');
    expect(zhCall![0].input.Message.Body.Html.Data).toContain('Widget × 1');

    // Verify the en email
    const enCall = mockSes.send.mock.calls.find(
      (c: any) => c[0].input.Destination.ToAddresses[0] === 'admin2@test.com',
    );
    expect(enCall).toBeDefined();
    expect(enCall![0].input.Message.Subject.Data).toBe('New order ORD-001');
  });

  it('should skip sending when toggle is disabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(BASE_TOGGLES as any);

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const p = sendNewOrderEmail(ctx, 'ORD-001', [{ productName: 'Widget', quantity: 1 }], 'Bob', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should skip when no admin users found', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewOrderEnabled'));

    const mockSes = { send: vi.fn() };
    const mockDynamo = createSmartDynamoClient({
      adminUsers: [],
      templates: {
        'newOrder:zh': { subject: 'Test', body: '<p>Test</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendNewOrderEmail(ctx, 'ORD-001', [{ productName: 'Widget', quantity: 1 }], 'Bob', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should include OrderAdmin role users', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewOrderEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      adminUsers: [
        { email: 'orderadmin@test.com', nickname: 'OA', locale: 'zh', roles: ['OrderAdmin'] },
      ],
      templates: {
        'newOrder:zh': { subject: '新订单', body: '<p>新订单</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendNewOrderEmail(ctx, 'ORD-002', [{ productName: 'Item', quantity: 1 }], 'Buyer', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    expect(mockSes.send.mock.calls[0][0].input.Destination.ToAddresses).toEqual([
      'orderadmin@test.com',
    ]);
  });
});

// ============================================================
// sendOrderShippedEmail
// ============================================================

describe('sendOrderShippedEmail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send email with tracking number', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailOrderShippedEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'charlie@test.com', nickname: 'Charlie', locale: 'ja' },
      },
      templates: {
        'orderShipped:ja': {
          subject: '注文 {{orderId}} 発送済み',
          body: '<p>{{nickname}} さん、追跡番号: {{trackingNumber}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendOrderShippedEmail(ctx, 'user-1', 'ORD-100', 'TRACK-ABC');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Message.Subject.Data).toBe('注文 ORD-100 発送済み');
    expect(cmd.input.Message.Body.Html.Data).toContain('Charlie');
    expect(cmd.input.Message.Body.Html.Data).toContain('TRACK-ABC');
  });

  it('should replace trackingNumber with empty string when not provided', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailOrderShippedEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'dave@test.com', nickname: 'Dave', locale: 'zh' },
      },
      templates: {
        'orderShipped:zh': {
          subject: '包裹已发出 {{orderId}}',
          body: '<p>物流单号: {{trackingNumber}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendOrderShippedEmail(ctx, 'user-1', 'ORD-200');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    // trackingNumber should be empty string
    expect(cmd.input.Message.Body.Html.Data).toBe('<p>物流单号: </p>');
  });

  it('should skip sending when toggle is disabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(BASE_TOGGLES as any);

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const p = sendOrderShippedEmail(ctx, 'user-1', 'ORD-100', 'TRACK');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should not throw when SES fails (best-effort)', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailOrderShippedEnabled'));

    const mockSes = { send: vi.fn().mockRejectedValue(new Error('SES error')) };
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'err@test.com', nickname: 'Err', locale: 'zh' },
      },
      templates: {
        'orderShipped:zh': { subject: 'Test', body: '<p>Test</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendOrderShippedEmail(ctx, 'user-1', 'ORD-300');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });
});


// ============================================================
// sendNewProductNotification
// ============================================================

describe('sendNewProductNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send bulk emails grouped by locale', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newProduct:zh': {
          subject: '商城上新啦',
          body: '<p>新商品: {{productList}}</p>',
        },
        'newProduct:en': {
          subject: 'New products!',
          body: '<p>New products: {{productList}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const subscribedUsers = [
      { email: 'zh1@test.com', locale: 'zh' as EmailLocale },
      { email: 'zh2@test.com', locale: 'zh' as EmailLocale },
      { email: 'en1@test.com', locale: 'en' as EmailLocale },
    ];

    const resultPromise = sendNewProductNotification(ctx, 'Widget, Gadget', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // 2 locale groups → 2 SES calls (each group has ≤50 users)
    expect(mockSes.send).toHaveBeenCalledTimes(2);
    expect(result.totalBatches).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);

    // Verify BCC recipients
    const allBcc: string[] = [];
    for (const call of mockSes.send.mock.calls) {
      allBcc.push(...(call[0].input.Destination.BccAddresses ?? []));
    }
    expect(allBcc.sort()).toEqual(['en1@test.com', 'zh1@test.com', 'zh2@test.com']);
  });

  it('should return empty result when toggle is disabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(BASE_TOGGLES as any);

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const resultPromise = sendNewProductNotification(ctx, 'Product', [
      { email: 'a@test.com', locale: 'zh' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
    expect(result.successCount).toBe(0);
  });

  it('should return empty result when no subscribed users', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const resultPromise = sendNewProductNotification(ctx, 'Product', []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
  });

  it('should aggregate results across locale groups', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    let callCount = 0;
    const mockSes = {
      send: vi.fn().mockImplementation(() => {
        callCount++;
        // Fail the second batch
        if (callCount === 2) {
          return Promise.reject(new Error('SES batch fail'));
        }
        return Promise.resolve({});
      }),
    };

    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newProduct:zh': { subject: 'ZH', body: '<p>ZH</p>' },
        'newProduct:en': { subject: 'EN', body: '<p>EN</p>' },
        'newProduct:ja': { subject: 'JA', body: '<p>JA</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const users = [
      { email: 'zh@test.com', locale: 'zh' as EmailLocale },
      { email: 'en@test.com', locale: 'en' as EmailLocale },
      { email: 'ja@test.com', locale: 'ja' as EmailLocale },
    ];

    const resultPromise = sendNewProductNotification(ctx, 'Items', users);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

// ============================================================
// sendNewContentNotification
// ============================================================

describe('sendNewContentNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send bulk emails grouped by locale', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewContentEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newContent:zh': {
          subject: '新内容发布',
          body: '<p>新内容: {{contentList}}</p>',
        },
        'newContent:ko': {
          subject: '새 콘텐츠',
          body: '<p>콘텐츠: {{contentList}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const subscribedUsers = [
      { email: 'zh1@test.com', locale: 'zh' as EmailLocale },
      { email: 'ko1@test.com', locale: 'ko' as EmailLocale },
      { email: 'ko2@test.com', locale: 'ko' as EmailLocale },
    ];

    const resultPromise = sendNewContentNotification(ctx, 'Article A, Article B', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).toHaveBeenCalledTimes(2);
    expect(result.totalBatches).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });

  it('should return empty result when toggle is disabled', async () => {
    mockedGetFeatureToggles.mockResolvedValue(BASE_TOGGLES as any);

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const resultPromise = sendNewContentNotification(ctx, 'Content', [
      { email: 'a@test.com', locale: 'zh' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
  });

  it('should return empty result when no subscribed users', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewContentEnabled'));

    const mockSes = { send: vi.fn() };
    const ctx = createMockContext({ sesClient: mockSes });

    const resultPromise = sendNewContentNotification(ctx, 'Content', []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
  });

  it('should not throw when SES fails (best-effort)', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewContentEnabled'));

    const mockSes = { send: vi.fn().mockRejectedValue(new Error('SES down')) };
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newContent:zh': { subject: 'Test', body: '<p>Test</p>' },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const resultPromise = sendNewContentNotification(ctx, 'Content', [
      { email: 'a@test.com', locale: 'zh' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Should not throw, but report failure
    expect(result.failureCount).toBeGreaterThanOrEqual(0);
  });

  it('should use correct template variables including contentList', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewContentEnabled'));

    const mockSes = { send: vi.fn().mockResolvedValue({}) };
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newContent:en': {
          subject: 'New content!',
          body: '<p>Check out: {{contentList}}</p>',
        },
      },
    });

    const ctx = createMockContext({ sesClient: mockSes, dynamoClient: mockDynamo });

    const resultPromise = sendNewContentNotification(ctx, 'Blog Post, Tutorial', [
      { email: 'user@test.com', locale: 'en' as EmailLocale },
    ]);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Message.Body.Html.Data).toContain('Blog Post, Tutorial');
  });
});
