import { describe, it, expect, vi } from 'vitest';
import { getDefaultTemplates, seedDefaultTemplates } from './seed';

describe('getDefaultTemplates', () => {
  it('should return exactly 25 templates (5 types × 5 locales)', () => {
    const templates = getDefaultTemplates();
    expect(templates).toHaveLength(25);
  });

  it('should cover all 5 notification types', () => {
    const templates = getDefaultTemplates();
    const types = new Set(templates.map((t) => t.templateId));
    expect(types).toEqual(
      new Set(['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent']),
    );
  });

  it('should cover all 5 locales for each type', () => {
    const templates = getDefaultTemplates();
    const expectedLocales = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
    const types = ['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent'];

    for (const type of types) {
      const locales = templates.filter((t) => t.templateId === type).map((t) => t.locale);
      expect(locales.sort()).toEqual(expectedLocales.sort());
    }
  });

  it('should include all required variable placeholders per type', () => {
    const templates = getDefaultTemplates();
    const varMap: Record<string, string[]> = {
      pointsEarned: ['nickname', 'points', 'source', 'balance'],
      newOrder: ['orderId', 'productNames', 'buyerNickname', 'recipientName', 'phone', 'detailAddress'],
      orderShipped: ['nickname', 'orderId', 'trackingNumber'],
      newProduct: ['productList'],
      newContent: ['contentList'],
    };

    for (const template of templates) {
      const requiredVars = varMap[template.templateId] ?? [];
      for (const varName of requiredVars) {
        expect(template.body).toContain(`{{${varName}}}`);
      }
    }
  });

  it('should have non-empty subject and body for all templates', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(template.subject.length).toBeGreaterThan(0);
      expect(template.body.length).toBeGreaterThan(0);
    }
  });

  it('should have valid subject lengths (1–200 chars)', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(template.subject.length).toBeGreaterThanOrEqual(1);
      expect(template.subject.length).toBeLessThanOrEqual(200);
    }
  });

  it('should have valid body lengths (1–10000 chars)', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(template.body.length).toBeGreaterThanOrEqual(1);
      expect(template.body.length).toBeLessThanOrEqual(10000);
    }
  });

  it('should set updatedBy to system for all templates', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(template.updatedBy).toBe('system');
    }
  });

  it('should have ISO 8601 updatedAt for all templates', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(() => new Date(template.updatedAt)).not.toThrow();
      expect(new Date(template.updatedAt).toISOString()).toBe(template.updatedAt);
    }
  });

  it('should use playful Chinese tone for zh templates', () => {
    const templates = getDefaultTemplates();
    const zhPointsEarned = templates.find(
      (t) => t.templateId === 'pointsEarned' && t.locale === 'zh',
    );
    expect(zhPointsEarned?.subject).toContain('积分到账啦');

    const zhNewOrder = templates.find(
      (t) => t.templateId === 'newOrder' && t.locale === 'zh',
    );
    expect(zhNewOrder?.subject).toContain('有新订单啦');

    const zhOrderShipped = templates.find(
      (t) => t.templateId === 'orderShipped' && t.locale === 'zh',
    );
    expect(zhOrderShipped?.subject).toContain('包裹已发出');
  });
});

describe('seedDefaultTemplates', () => {
  it('should call BatchWriteCommand with all 25 templates', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const mockClient = { send: mockSend } as any;

    await seedDefaultTemplates(mockClient, 'TestTable');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.constructor.name).toBe('BatchWriteCommand');
    expect(command.input.RequestItems['TestTable']).toHaveLength(25);

    // Verify each item is a PutRequest
    for (const item of command.input.RequestItems['TestTable']) {
      expect(item.PutRequest).toBeDefined();
      expect(item.PutRequest.Item.templateId).toBeDefined();
      expect(item.PutRequest.Item.locale).toBeDefined();
      expect(item.PutRequest.Item.subject).toBeDefined();
      expect(item.PutRequest.Item.body).toBeDefined();
    }
  });
});
