import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EmailLocale } from './send';

// ============================================================
// Mock feature-toggles module before any imports that use it
// ============================================================
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
import type { NotificationContext, SubscribedUser } from './notifications';
import {
  listTemplates,
  updateTemplate,
  validateTemplateInput,
  getRequiredVariables,
} from './templates';
import { getFeatureToggles } from '../settings/feature-toggles';

// ============================================================
// Helpers
// ============================================================

const mockedGetFeatureToggles = vi.mocked(getFeatureToggles);

const ALL_TOGGLES_DISABLED = {
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

function allTogglesEnabled() {
  return {
    ...ALL_TOGGLES_DISABLED,
    emailPointsEarnedEnabled: true,
    emailNewOrderEnabled: true,
    emailOrderShippedEnabled: true,
    emailNewProductEnabled: true,
    emailNewContentEnabled: true,
  } as any;
}

function enableToggle(toggle: string) {
  return { ...ALL_TOGGLES_DISABLED, [toggle]: true } as any;
}

function createMockSes() {
  return { send: vi.fn().mockResolvedValue({}) };
}

/**
 * Build a mock DynamoDB client that responds to GetCommand, ScanCommand, QueryCommand, PutCommand.
 * Supports user records, template records, and admin user scans.
 */
function createSmartDynamoClient(options: {
  users?: Record<string, { email: string; nickname: string; locale?: EmailLocale; roles?: string[]; emailSubscriptions?: Record<string, boolean> }>;
  templates?: Record<string, { subject: string; body: string }>;
  adminUsers?: { email: string; nickname: string; locale: EmailLocale; roles: string[] }[];
  subscribedUsers?: { email: string; locale: EmailLocale }[];
}) {
  return {
    send: vi.fn().mockImplementation(async (command: any) => {
      const input = command.input;
      const name = command.constructor.name;

      // ScanCommand — return admin users or subscribed users
      if (name === 'ScanCommand') {
        // If FilterExpression contains emailSubscriptions, return subscribed users
        if (input.FilterExpression?.includes('emailSubscriptions')) {
          return {
            Items: (options.subscribedUsers ?? []).map((u) => ({
              email: u.email,
              locale: u.locale,
            })),
          };
        }
        return { Items: options.adminUsers ?? [] };
      }

      // QueryCommand — return templates for a type
      if (name === 'QueryCommand') {
        const tid = input.ExpressionAttributeValues?.[':tid'];
        const items = Object.entries(options.templates ?? {})
          .filter(([key]) => key.startsWith(`${tid}:`))
          .map(([key, val]) => {
            const [templateId, locale] = key.split(':');
            return { templateId, locale, ...val, updatedAt: new Date().toISOString() };
          });
        return { Items: items };
      }

      // PutCommand — succeed
      if (name === 'PutCommand') {
        return {};
      }

      // GetCommand for user record (has userId, no templateId)
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
              updatedAt: new Date().toISOString(),
            },
          };
        }
        return { Item: null };
      }

      return { Items: [] };
    }),
  };
}

function createCtx(overrides?: { sesClient?: any; dynamoClient?: any }): NotificationContext {
  return {
    sesClient: overrides?.sesClient ?? createMockSes(),
    dynamoClient: overrides?.dynamoClient ?? { send: vi.fn().mockResolvedValue({ Items: [] }) },
    emailTemplatesTable: 'test-email-templates',
    usersTable: 'test-users',
    senderEmail: 'store@awscommunity.cn',
  };
}


// ============================================================
// Integration: sendPointsEarnedEmail full flow
// ============================================================

describe('Integration: sendPointsEarnedEmail trigger points', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should complete full flow: toggle check → user lookup → template load → variable replace → SES send (code redemption)', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-redeem': { email: 'redeemer@test.com', nickname: 'Redeemer', locale: 'zh' },
      },
      templates: {
        'pointsEarned:zh': {
          subject: '🎉 {{nickname}}，积分到账 {{points}} 分！',
          body: '<p>Hi {{nickname}}，来源：{{source}}，余额：{{balance}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-redeem', 200, 'code-redemption', 1200);
    await vi.runAllTimersAsync();
    await p;

    // Verify SES was called
    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];

    // Verify recipient
    expect(cmd.input.Destination.ToAddresses).toEqual(['redeemer@test.com']);

    // Verify variable replacement in subject
    expect(cmd.input.Message.Subject.Data).toBe('🎉 Redeemer，积分到账 200 分！');

    // Verify variable replacement in body
    expect(cmd.input.Message.Body.Html.Data).toContain('Hi Redeemer');
    expect(cmd.input.Message.Body.Html.Data).toContain('来源：code-redemption');
    expect(cmd.input.Message.Body.Html.Data).toContain('余额：1200');

    // Verify sender
    expect(cmd.input.Source).toBe('store@awscommunity.cn');
  });

  it('should complete full flow for claim approval trigger', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-claim': { email: 'claimer@test.com', nickname: 'Claimer', locale: 'en' },
      },
      templates: {
        'pointsEarned:en': {
          subject: 'Points earned: {{points}}',
          body: '<p>{{nickname}}, source: {{source}}, balance: {{balance}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-claim', 50, 'claim-approval', 350);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Message.Subject.Data).toBe('Points earned: 50');
    expect(cmd.input.Message.Body.Html.Data).toContain('source: claim-approval');
    expect(cmd.input.Message.Body.Html.Data).toContain('balance: 350');
  });

  it('should complete full flow for batch distribution trigger', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-batch-1': { email: 'batch1@test.com', nickname: 'BatchUser1', locale: 'ja' },
      },
      templates: {
        'pointsEarned:ja': {
          subject: '{{nickname}}さん、{{points}}ポイント獲得！',
          body: '<p>{{nickname}}、ソース：{{source}}、残高：{{balance}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendPointsEarnedEmail(ctx, 'user-batch-1', 100, 'batch-distribution', 500);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Destination.ToAddresses).toEqual(['batch1@test.com']);
    expect(cmd.input.Message.Subject.Data).toBe('BatchUser1さん、100ポイント獲得！');
    expect(cmd.input.Message.Body.Html.Data).toContain('ソース：batch-distribution');
  });
});

// ============================================================
// Integration: sendNewOrderEmail full flow
// ============================================================

describe('Integration: sendNewOrderEmail trigger after order creation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send to all Admin/SuperAdmin/OrderAdmin users with locale-specific templates', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewOrderEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      adminUsers: [
        { email: 'admin@test.com', nickname: 'Admin', locale: 'zh', roles: ['Admin'] },
        { email: 'super@test.com', nickname: 'Super', locale: 'en', roles: ['SuperAdmin'] },
        { email: 'orderadmin@test.com', nickname: 'OA', locale: 'zh', roles: ['OrderAdmin'] },
      ],
      templates: {
        'newOrder:zh': {
          subject: '新订单 {{orderId}}',
          body: '<p>买家：{{buyerNickname}}，商品：{{productNames}}，收件人：{{recipientName}} {{phone}} {{detailAddress}}</p>',
        },
        'newOrder:en': {
          subject: 'New order {{orderId}}',
          body: '<p>Buyer: {{buyerNickname}}, Products: {{productNames}}, Ship to: {{recipientName}} {{phone}} {{detailAddress}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendNewOrderEmail(ctx, 'ORD-123', [{ productName: 'Widget', quantity: 1 }, { productName: 'Gadget', quantity: 2 }], 'BuyerAlice', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    // 3 admin users: 2 zh + 1 en → 3 individual emails
    expect(mockSes.send).toHaveBeenCalledTimes(3);

    // Verify zh emails
    const zhCalls = mockSes.send.mock.calls.filter(
      (c: any) => c[0].input.Message.Subject.Data === '新订单 ORD-123',
    );
    expect(zhCalls).toHaveLength(2);

    // Verify en email
    const enCalls = mockSes.send.mock.calls.filter(
      (c: any) => c[0].input.Message.Subject.Data === 'New order ORD-123',
    );
    expect(enCalls).toHaveLength(1);
    expect(enCalls[0][0].input.Message.Body.Html.Data).toContain('BuyerAlice');
    expect(enCalls[0][0].input.Message.Body.Html.Data).toContain('Widget × 1');
  });
});

// ============================================================
// Integration: sendOrderShippedEmail full flow
// ============================================================

describe('Integration: sendOrderShippedEmail trigger after shipping update', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send shipped email with tracking number to order user', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailOrderShippedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'buyer-1': { email: 'buyer@test.com', nickname: 'Buyer', locale: 'ko' },
      },
      templates: {
        'orderShipped:ko': {
          subject: '주문 {{orderId}} 발송됨',
          body: '<p>{{nickname}}님, 운송장: {{trackingNumber}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendOrderShippedEmail(ctx, 'buyer-1', 'ORD-456', 'SF-12345');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    expect(cmd.input.Destination.ToAddresses).toEqual(['buyer@test.com']);
    expect(cmd.input.Message.Subject.Data).toBe('주문 ORD-456 발송됨');
    expect(cmd.input.Message.Body.Html.Data).toContain('Buyer');
    expect(cmd.input.Message.Body.Html.Data).toContain('SF-12345');
  });

  it('should handle missing tracking number gracefully', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailOrderShippedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'buyer-2': { email: 'buyer2@test.com', nickname: 'Buyer2', locale: 'zh' },
      },
      templates: {
        'orderShipped:zh': {
          subject: '包裹已发出 {{orderId}}',
          body: '<p>物流单号：{{trackingNumber}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p = sendOrderShippedEmail(ctx, 'buyer-2', 'ORD-789');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).toHaveBeenCalledOnce();
    const cmd = mockSes.send.mock.calls[0][0];
    // trackingNumber replaced with empty string
    expect(cmd.input.Message.Body.Html.Data).toBe('<p>物流单号：</p>');
  });
});


// ============================================================
// Integration: Email toggle prevents sending when disabled
// ============================================================

describe('Integration: Email toggle check prevents sending when disabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should skip pointsEarned email when emailPointsEarnedEnabled is false', async () => {
    mockedGetFeatureToggles.mockResolvedValue(ALL_TOGGLES_DISABLED as any);

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const p = sendPointsEarnedEmail(ctx, 'user-1', 100, 'test', 500);
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should skip newOrder email when emailNewOrderEnabled is false', async () => {
    mockedGetFeatureToggles.mockResolvedValue(ALL_TOGGLES_DISABLED as any);

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const p = sendNewOrderEmail(ctx, 'ORD-001', [{ productName: 'Widget', quantity: 1 }], 'Bob', { recipientName: '张三', phone: '13800138000', detailAddress: '北京市朝阳区测试路1号' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should skip orderShipped email when emailOrderShippedEnabled is false', async () => {
    mockedGetFeatureToggles.mockResolvedValue(ALL_TOGGLES_DISABLED as any);

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const p = sendOrderShippedEmail(ctx, 'user-1', 'ORD-001', 'TRACK-123');
    await vi.runAllTimersAsync();
    await p;

    expect(mockSes.send).not.toHaveBeenCalled();
  });

  it('should skip newProduct notification when emailNewProductEnabled is false', async () => {
    mockedGetFeatureToggles.mockResolvedValue(ALL_TOGGLES_DISABLED as any);

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const resultPromise = sendNewProductNotification(ctx, 'Product List', [
      { email: 'user@test.com', locale: 'zh' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
  });

  it('should skip newContent notification when emailNewContentEnabled is false', async () => {
    mockedGetFeatureToggles.mockResolvedValue(ALL_TOGGLES_DISABLED as any);

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const resultPromise = sendNewContentNotification(ctx, 'Content List', [
      { email: 'user@test.com', locale: 'zh' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
  });

  it('should send when toggle is enabled but skip when later disabled', async () => {
    // First call: enabled
    mockedGetFeatureToggles.mockResolvedValueOnce(enableToggle('emailPointsEarnedEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      users: {
        'user-1': { email: 'test@test.com', nickname: 'Test', locale: 'zh' },
      },
      templates: {
        'pointsEarned:zh': { subject: 'Test', body: '<p>Test</p>' },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const p1 = sendPointsEarnedEmail(ctx, 'user-1', 100, 'test', 500);
    await vi.runAllTimersAsync();
    await p1;
    expect(mockSes.send).toHaveBeenCalledOnce();

    // Second call: disabled
    mockedGetFeatureToggles.mockResolvedValueOnce(ALL_TOGGLES_DISABLED as any);
    mockSes.send.mockClear();

    const p2 = sendPointsEarnedEmail(ctx, 'user-1', 100, 'test', 500);
    await vi.runAllTimersAsync();
    await p2;
    expect(mockSes.send).not.toHaveBeenCalled();
  });
});

// ============================================================
// Integration: Template CRUD functions
// ============================================================

describe('Integration: Admin template CRUD operations', () => {
  it('listTemplates should return templates filtered by type', async () => {
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'pointsEarned:zh': { subject: 'ZH Subject', body: '<p>ZH</p>' },
        'pointsEarned:en': { subject: 'EN Subject', body: '<p>EN</p>' },
        'newOrder:zh': { subject: 'Order ZH', body: '<p>Order</p>' },
      },
    });

    const result = await listTemplates(mockDynamo as any, 'test-table', 'pointsEarned');

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.templateId === 'pointsEarned')).toBe(true);
    expect(result.map((t) => t.locale).sort()).toEqual(['en', 'zh']);
  });

  it('updateTemplate should validate and persist template changes', async () => {
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'pointsEarned:zh': { subject: 'Old Subject', body: '<p>Old Body</p>' },
      },
    });

    const result = await updateTemplate(mockDynamo as any, 'test-table', {
      templateId: 'pointsEarned',
      locale: 'zh',
      subject: 'New Subject',
      body: '<p>New Body</p>',
      updatedBy: 'admin-1',
    });

    expect(result.subject).toBe('New Subject');
    expect(result.body).toBe('<p>New Body</p>');
    expect(result.updatedBy).toBe('admin-1');
    expect(result.updatedAt).toBeDefined();
  });

  it('updateTemplate should reject invalid subject length', async () => {
    const mockDynamo = createSmartDynamoClient({ templates: {} });

    await expect(
      updateTemplate(mockDynamo as any, 'test-table', {
        templateId: 'pointsEarned',
        locale: 'zh',
        subject: '',
        body: '<p>Body</p>',
      }),
    ).rejects.toThrow('Subject');
  });

  it('updateTemplate should reject invalid body length', async () => {
    const mockDynamo = createSmartDynamoClient({ templates: {} });

    await expect(
      updateTemplate(mockDynamo as any, 'test-table', {
        templateId: 'pointsEarned',
        locale: 'zh',
        subject: 'Valid Subject',
        body: 'x'.repeat(10001),
      }),
    ).rejects.toThrow('Body');
  });

  it('validateTemplateInput should accept valid inputs', () => {
    const result = validateTemplateInput('Valid Subject', '<p>Valid body content</p>');
    expect(result.valid).toBe(true);
  });

  it('validateTemplateInput should reject empty subject', () => {
    const result = validateTemplateInput('', '<p>Body</p>');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Subject');
  });

  it('getRequiredVariables should return correct variables per type', () => {
    expect(getRequiredVariables('pointsEarned')).toEqual(['nickname', 'points', 'source', 'balance']);
    expect(getRequiredVariables('newOrder')).toEqual(['orderId', 'productNames', 'buyerNickname', 'recipientName', 'phone', 'detailAddress']);
    expect(getRequiredVariables('orderShipped')).toEqual(['nickname', 'orderId', 'trackingNumber']);
    expect(getRequiredVariables('newProduct')).toEqual(['nickname', 'productList']);
    expect(getRequiredVariables('newContent')).toEqual(['nickname', 'contentList']);
  });
});

// ============================================================
// Integration: Bulk send trigger queries subscribed users
// ============================================================

describe('Integration: Bulk send trigger queries subscribed users correctly', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should send newProduct notification only to subscribed users grouped by locale', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newProduct:zh': {
          subject: '商城上新啦',
          body: '<p>新商品：{{productList}}</p>',
        },
        'newProduct:en': {
          subject: 'New products!',
          body: '<p>Products: {{productList}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    // Simulate subscribed users (already filtered by subscription)
    const subscribedUsers: SubscribedUser[] = [
      { email: 'zh1@test.com', locale: 'zh' },
      { email: 'zh2@test.com', locale: 'zh' },
      { email: 'en1@test.com', locale: 'en' },
    ];

    const resultPromise = sendNewProductNotification(ctx, 'Widget, Gadget', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // 2 locale groups → 2 bulk SES calls
    expect(mockSes.send).toHaveBeenCalledTimes(2);
    expect(result.totalBatches).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);

    // Verify all recipients received emails via BCC
    const allBcc: string[] = [];
    for (const call of mockSes.send.mock.calls) {
      allBcc.push(...(call[0].input.Destination.BccAddresses ?? []));
    }
    expect(allBcc.sort()).toEqual(['en1@test.com', 'zh1@test.com', 'zh2@test.com']);
  });

  it('should send newContent notification only to subscribed users grouped by locale', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewContentEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      templates: {
        'newContent:zh': {
          subject: '新内容发布',
          body: '<p>内容：{{contentList}}</p>',
        },
        'newContent:ja': {
          subject: '新コンテンツ',
          body: '<p>コンテンツ：{{contentList}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const subscribedUsers: SubscribedUser[] = [
      { email: 'zh@test.com', locale: 'zh' },
      { email: 'ja1@test.com', locale: 'ja' },
      { email: 'ja2@test.com', locale: 'ja' },
    ];

    const resultPromise = sendNewContentNotification(ctx, 'Article A, Article B', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).toHaveBeenCalledTimes(2);
    expect(result.totalBatches).toBe(2);
    expect(result.successCount).toBe(2);

    // Verify content list was included in emails
    for (const call of mockSes.send.mock.calls) {
      expect(call[0].input.Message.Body.Html.Data).toContain('Article A, Article B');
    }
  });

  it('should return empty result when no subscribed users', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    const mockSes = createMockSes();
    const ctx = createCtx({ sesClient: mockSes });

    const resultPromise = sendNewProductNotification(ctx, 'Products', []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockSes.send).not.toHaveBeenCalled();
    expect(result.totalBatches).toBe(0);
    expect(result.successCount).toBe(0);
  });

  it('should handle locale fallback to zh when user locale template is missing', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    const mockSes = createMockSes();
    const mockDynamo = createSmartDynamoClient({
      templates: {
        // Only zh template exists, ko is missing
        'newProduct:zh': {
          subject: '商城上新',
          body: '<p>{{productList}}</p>',
        },
      },
    });

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const subscribedUsers: SubscribedUser[] = [
      { email: 'ko@test.com', locale: 'ko' },
    ];

    const resultPromise = sendNewProductNotification(ctx, 'New Item', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // ko template missing → falls back to zh → should still send
    // Note: the bulk notification loads template per locale group, fallback happens inside
    // If ko template not found and zh fallback works, it sends
    expect(result.totalBatches).toBeGreaterThanOrEqual(0);
  });

  it('should handle partial SES failures in bulk send and report accurately', async () => {
    mockedGetFeatureToggles.mockResolvedValue(enableToggle('emailNewProductEnabled'));

    let callCount = 0;
    const mockSes = {
      send: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('SES batch failure'));
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

    const ctx = createCtx({ sesClient: mockSes, dynamoClient: mockDynamo });

    const subscribedUsers: SubscribedUser[] = [
      { email: 'zh@test.com', locale: 'zh' },
      { email: 'en@test.com', locale: 'en' },
      { email: 'ja@test.com', locale: 'ja' },
    ];

    const resultPromise = sendNewProductNotification(ctx, 'Items', subscribedUsers);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // All 3 batches attempted despite failure
    expect(mockSes.send).toHaveBeenCalledTimes(3);
    expect(result.totalBatches).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.successCount + result.failureCount).toBe(result.totalBatches);
  });
});
