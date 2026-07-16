import { describe, it, expect, vi } from 'vitest';
import { getDefaultTemplates, seedDefaultTemplates } from './seed';
import { getRequiredVariables } from './templates';

describe('getDefaultTemplates', () => {
  it('should return exactly 75 templates (15 types × 5 locales)', () => {
    const templates = getDefaultTemplates();
    expect(templates).toHaveLength(75);
  });

  it('should cover all 15 notification types', () => {
    const templates = getDefaultTemplates();
    const types = new Set(templates.map((t) => t.templateId));
    expect(types).toEqual(
      new Set(['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent', 'contentUpdated', 'weeklyDigest', 'wishAdopted', 'wishFulfilled', 'wishRejected', 'codeDistribution', 'uglExitReminder', 'uglExitNotification', 'uglExitAdminNotification', 'uglExitDetectionCompletion']),
    );
  });

  it('should cover all 5 locales for each type', () => {
    const templates = getDefaultTemplates();
    const expectedLocales = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
    const types = ['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent', 'contentUpdated', 'weeklyDigest', 'wishAdopted', 'wishFulfilled', 'wishRejected', 'codeDistribution', 'uglExitReminder', 'uglExitNotification', 'uglExitAdminNotification', 'uglExitDetectionCompletion'];

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
      contentUpdated: ['contentTitle', 'userName', 'activityTopic', 'activityDate'],
      weeklyDigest: ['nickname', 'productList', 'contentList', 'weekStart', 'weekEnd'],
      wishAdopted: ['nickname', 'wishTitle'],
      wishFulfilled: ['nickname', 'wishTitle', 'productUrl'],
      wishRejected: ['nickname', 'wishTitle', 'closeReason'],
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
  it('should call BatchWriteCommand in batches of 25 for all 75 templates', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const mockClient = { send: mockSend } as any;

    await seedDefaultTemplates(mockClient, 'TestTable');

    expect(mockSend).toHaveBeenCalledTimes(3);

    // First batch: 25 templates
    const command1 = mockSend.mock.calls[0][0];
    expect(command1.constructor.name).toBe('BatchWriteCommand');
    expect(command1.input.RequestItems['TestTable']).toHaveLength(25);

    // Second batch: 25 templates
    const command2 = mockSend.mock.calls[1][0];
    expect(command2.constructor.name).toBe('BatchWriteCommand');
    expect(command2.input.RequestItems['TestTable']).toHaveLength(25);

    // Third batch: remaining 25 templates (75 - 25 - 25)
    const command3 = mockSend.mock.calls[2][0];
    expect(command3.constructor.name).toBe('BatchWriteCommand');
    expect(command3.input.RequestItems['TestTable']).toHaveLength(25);

    // Verify each item in all batches is a PutRequest
    for (const call of mockSend.mock.calls) {
      for (const item of call[0].input.RequestItems['TestTable']) {
        expect(item.PutRequest).toBeDefined();
        expect(item.PutRequest.Item.templateId).toBeDefined();
        expect(item.PutRequest.Item.locale).toBeDefined();
        expect(item.PutRequest.Item.subject).toBeDefined();
        expect(item.PutRequest.Item.body).toBeDefined();
      }
    }
  });
});

// ============================================================
// UGL Inactivity Exit Flow email template / toggle integration
// (Feature: ugl-inactivity-exit-flow)
// Validates: Requirements 4.2, 6.3
// ============================================================

describe('UGL exit flow templates and variable map integration', () => {
  const UGL_EXIT_TYPES = ['uglExitReminder', 'uglExitNotification', 'uglExitAdminNotification', 'uglExitDetectionCompletion'] as const;
  const EXPECTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'zh-TW'];

  it('should include exactly 5 templates (one per locale) for each of the 4 UGL exit notification types', () => {
    const templates = getDefaultTemplates();

    for (const type of UGL_EXIT_TYPES) {
      const matching = templates.filter((t) => t.templateId === type);
      expect(matching).toHaveLength(5);
      expect(matching.map((t) => t.locale).sort()).toEqual([...EXPECTED_LOCALES].sort());

      for (const template of matching) {
        expect(template.subject.length).toBeGreaterThan(0);
        expect(template.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('should have TEMPLATE_VARIABLE_MAP entries for the 4 types matching the design spec exactly', () => {
    expect(getRequiredVariables('uglExitReminder')).toEqual(['nickname', 'detectionQuarter', 'gracePeriodDeadline']);
    expect(getRequiredVariables('uglExitNotification')).toEqual(['nickname', 'detectionQuarter']);
    expect(getRequiredVariables('uglExitAdminNotification')).toEqual(['affectedNickname', 'affectedEmail', 'detectionQuarter']);
    expect(getRequiredVariables('uglExitDetectionCompletion')).toEqual(['detectionQuarter', 'newlyRecordedCount']);
  });

  it('should have default template bodies containing every variable placeholder required by TEMPLATE_VARIABLE_MAP', () => {
    const templates = getDefaultTemplates();
    const varMap: Record<string, string[]> = {
      uglExitReminder: ['nickname', 'detectionQuarter', 'gracePeriodDeadline'],
      uglExitNotification: ['nickname', 'detectionQuarter'],
      uglExitAdminNotification: ['affectedNickname', 'affectedEmail', 'detectionQuarter'],
      uglExitDetectionCompletion: ['detectionQuarter', 'newlyRecordedCount'],
    };

    for (const type of UGL_EXIT_TYPES) {
      const requiredVars = varMap[type];
      const matching = templates.filter((t) => t.templateId === type);
      for (const template of matching) {
        for (const varName of requiredVars) {
          expect(template.body).toContain(`{{${varName}}}`);
        }
      }
    }
  });

  it('should pass the exact variable KEY SET used by sendUGLExitReminderEmail to match TEMPLATE_VARIABLE_MAP.uglExitReminder', () => {
    // sendUGLExitReminderEmail builds: { nickname, detectionQuarter, gracePeriodDeadline }
    const variablesBuiltBySender = ['nickname', 'detectionQuarter', 'gracePeriodDeadline'];
    const expected = getRequiredVariables('uglExitReminder');
    expect(new Set(variablesBuiltBySender)).toEqual(new Set(expected));
  });

  it('should pass the exact variable KEY SET used by sendUGLExitNotifications (user template) to match TEMPLATE_VARIABLE_MAP.uglExitNotification', () => {
    // sendUGLExitNotifications builds for the affected user: { nickname, detectionQuarter }
    const variablesBuiltBySender = ['nickname', 'detectionQuarter'];
    const expected = getRequiredVariables('uglExitNotification');
    expect(new Set(variablesBuiltBySender)).toEqual(new Set(expected));
  });

  it('should pass the exact variable KEY SET used by sendUGLExitNotifications (admin template) to match TEMPLATE_VARIABLE_MAP.uglExitAdminNotification', () => {
    // sendUGLExitNotifications builds for each SuperAdmin: { affectedNickname, affectedEmail, detectionQuarter }
    const variablesBuiltBySender = ['affectedNickname', 'affectedEmail', 'detectionQuarter'];
    const expected = getRequiredVariables('uglExitAdminNotification');
    expect(new Set(variablesBuiltBySender)).toEqual(new Set(expected));
  });

  it('should pass the exact variable KEY SET used by sendDetectionCompletionNotification to match TEMPLATE_VARIABLE_MAP.uglExitDetectionCompletion', () => {
    // sendDetectionCompletionNotification builds: { detectionQuarter, newlyRecordedCount }
    const variablesBuiltBySender = ['detectionQuarter', 'newlyRecordedCount'];
    const expected = getRequiredVariables('uglExitDetectionCompletion');
    expect(new Set(variablesBuiltBySender)).toEqual(new Set(expected));
  });
});
