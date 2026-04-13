import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  replaceVariables,
  validateTemplateInput,
  getRequiredVariables,
  getTemplate,
  updateTemplate,
  listTemplates,
} from './templates';
import type { EmailTemplate } from './templates';

// ============================================================
// Helpers
// ============================================================

function createMockDynamoClient(options?: {
  getItem?: Record<string, unknown> | null;
  queryItems?: Record<string, unknown>[];
  scanItems?: Record<string, unknown>[];
  putShouldFail?: boolean;
}) {
  const send = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;

    if (name === 'GetCommand') {
      return Promise.resolve({ Item: options?.getItem ?? null });
    }
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: options?.queryItems ?? [] });
    }
    if (name === 'ScanCommand') {
      return Promise.resolve({ Items: options?.scanItems ?? [] });
    }
    if (name === 'PutCommand') {
      if (options?.putShouldFail) {
        return Promise.reject(new Error('DynamoDB put failed'));
      }
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });

  return { send } as any;
}

// ============================================================
// replaceVariables
// ============================================================

describe('replaceVariables', () => {
  it('should replace all placeholders with provided values', () => {
    const template = 'Hi {{nickname}}, you earned {{points}} points!';
    const result = replaceVariables(template, { nickname: 'Alice', points: '100' });
    expect(result).toBe('Hi Alice, you earned 100 points!');
  });

  it('should replace missing values with empty string', () => {
    const template = 'Hi {{nickname}}, tracking: {{trackingNumber}}';
    const result = replaceVariables(template, { nickname: 'Bob' });
    expect(result).toBe('Hi Bob, tracking: ');
  });

  it('should handle template with no placeholders', () => {
    const template = 'No variables here';
    const result = replaceVariables(template, { nickname: 'Alice' });
    expect(result).toBe('No variables here');
  });

  it('should handle empty values map', () => {
    const template = '{{a}} and {{b}}';
    const result = replaceVariables(template, {});
    expect(result).toBe(' and ');
  });

  it('should handle empty template string', () => {
    const result = replaceVariables('', { nickname: 'Alice' });
    expect(result).toBe('');
  });

  it('should replace multiple occurrences of the same variable', () => {
    const template = '{{name}} said hello to {{name}}';
    const result = replaceVariables(template, { name: 'Eve' });
    expect(result).toBe('Eve said hello to Eve');
  });
});

// ============================================================
// validateTemplateInput
// ============================================================

describe('validateTemplateInput', () => {
  it('should accept valid subject and body', () => {
    const result = validateTemplateInput('Valid Subject', '<p>Valid body</p>');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty subject', () => {
    const result = validateTemplateInput('', '<p>Body</p>');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Subject');
  });

  it('should reject subject over 200 chars', () => {
    const longSubject = 'a'.repeat(201);
    const result = validateTemplateInput(longSubject, '<p>Body</p>');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Subject');
  });

  it('should accept subject at exactly 200 chars', () => {
    const subject = 'a'.repeat(200);
    const result = validateTemplateInput(subject, '<p>Body</p>');
    expect(result.valid).toBe(true);
  });

  it('should accept subject at exactly 1 char', () => {
    const result = validateTemplateInput('a', '<p>Body</p>');
    expect(result.valid).toBe(true);
  });

  it('should reject empty body', () => {
    const result = validateTemplateInput('Subject', '');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Body');
  });

  it('should reject body over 10000 chars', () => {
    const longBody = 'b'.repeat(10001);
    const result = validateTemplateInput('Subject', longBody);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Body');
  });

  it('should accept body at exactly 10000 chars', () => {
    const body = 'b'.repeat(10000);
    const result = validateTemplateInput('Subject', body);
    expect(result.valid).toBe(true);
  });

  it('should accept body at exactly 1 char', () => {
    const result = validateTemplateInput('Subject', 'x');
    expect(result.valid).toBe(true);
  });
});

// ============================================================
// getRequiredVariables
// ============================================================

describe('getRequiredVariables', () => {
  it('should return variables for pointsEarned', () => {
    const vars = getRequiredVariables('pointsEarned');
    expect(vars).toEqual(['nickname', 'points', 'source', 'balance']);
  });

  it('should return variables for newOrder', () => {
    const vars = getRequiredVariables('newOrder');
    expect(vars).toEqual(['orderId', 'productNames', 'buyerNickname', 'recipientName', 'phone', 'detailAddress']);
  });

  it('should return variables for orderShipped', () => {
    const vars = getRequiredVariables('orderShipped');
    expect(vars).toEqual(['nickname', 'orderId', 'trackingNumber']);
  });

  it('should return variables for newProduct', () => {
    const vars = getRequiredVariables('newProduct');
    expect(vars).toEqual(['nickname', 'productList']);
  });

  it('should return variables for newContent', () => {
    const vars = getRequiredVariables('newContent');
    expect(vars).toEqual(['nickname', 'contentList']);
  });
});

// ============================================================
// getTemplate
// ============================================================

describe('getTemplate', () => {
  it('should return template when found', async () => {
    const mockTemplate: EmailTemplate = {
      templateId: 'pointsEarned',
      locale: 'zh',
      subject: 'Test Subject',
      body: '<p>Test</p>',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const dynamo = createMockDynamoClient({ getItem: mockTemplate });

    const result = await getTemplate(dynamo, 'TestTable', 'pointsEarned', 'zh');

    expect(result).toEqual(mockTemplate);
    expect(dynamo.send).toHaveBeenCalledOnce();
    const command = dynamo.send.mock.calls[0][0];
    expect(command.input.TableName).toBe('TestTable');
    expect(command.input.Key).toEqual({ templateId: 'pointsEarned', locale: 'zh' });
  });

  it('should return null when template not found', async () => {
    const dynamo = createMockDynamoClient({ getItem: null });

    const result = await getTemplate(dynamo, 'TestTable', 'newOrder', 'en');

    expect(result).toBeNull();
  });
});

// ============================================================
// updateTemplate
// ============================================================

describe('updateTemplate', () => {
  it('should update template with valid input', async () => {
    const dynamo = createMockDynamoClient({ getItem: null });

    const result = await updateTemplate(dynamo, 'TestTable', {
      templateId: 'pointsEarned',
      locale: 'zh',
      subject: 'New Subject',
      body: '<p>New Body</p>',
      updatedBy: 'admin-1',
    });

    expect(result.templateId).toBe('pointsEarned');
    expect(result.locale).toBe('zh');
    expect(result.subject).toBe('New Subject');
    expect(result.body).toBe('<p>New Body</p>');
    expect(result.updatedBy).toBe('admin-1');
    expect(result.updatedAt).toBeDefined();
    // GetCommand + PutCommand = 2 calls
    expect(dynamo.send).toHaveBeenCalledTimes(2);
  });

  it('should merge with existing template when partial update', async () => {
    const existing = {
      templateId: 'pointsEarned',
      locale: 'zh',
      subject: 'Old Subject',
      body: '<p>Old Body</p>',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const dynamo = createMockDynamoClient({ getItem: existing });

    const result = await updateTemplate(dynamo, 'TestTable', {
      templateId: 'pointsEarned',
      locale: 'zh',
      subject: 'Updated Subject',
    });

    expect(result.subject).toBe('Updated Subject');
    expect(result.body).toBe('<p>Old Body</p>');
  });

  it('should throw on invalid subject length', async () => {
    const dynamo = createMockDynamoClient({ getItem: null });

    await expect(
      updateTemplate(dynamo, 'TestTable', {
        templateId: 'pointsEarned',
        locale: 'zh',
        subject: '',
        body: '<p>Body</p>',
      }),
    ).rejects.toThrow('Subject');
  });

  it('should throw on invalid body length', async () => {
    const dynamo = createMockDynamoClient({ getItem: null });

    await expect(
      updateTemplate(dynamo, 'TestTable', {
        templateId: 'pointsEarned',
        locale: 'zh',
        subject: 'Subject',
        body: 'x'.repeat(10001),
      }),
    ).rejects.toThrow('Body');
  });
});

// ============================================================
// listTemplates
// ============================================================

describe('listTemplates', () => {
  it('should query by templateId when provided', async () => {
    const items = [
      { templateId: 'pointsEarned', locale: 'zh', subject: 'S1', body: 'B1', updatedAt: '' },
      { templateId: 'pointsEarned', locale: 'en', subject: 'S2', body: 'B2', updatedAt: '' },
    ];
    const dynamo = createMockDynamoClient({ queryItems: items });

    const result = await listTemplates(dynamo, 'TestTable', 'pointsEarned');

    expect(result).toHaveLength(2);
    const command = dynamo.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input.KeyConditionExpression).toBe('templateId = :tid');
    expect(command.input.ExpressionAttributeValues).toEqual({ ':tid': 'pointsEarned' });
  });

  it('should scan all templates when no templateId provided', async () => {
    const items = [
      { templateId: 'pointsEarned', locale: 'zh', subject: 'S1', body: 'B1', updatedAt: '' },
      { templateId: 'newOrder', locale: 'zh', subject: 'S2', body: 'B2', updatedAt: '' },
    ];
    const dynamo = createMockDynamoClient({ scanItems: items });

    const result = await listTemplates(dynamo, 'TestTable');

    expect(result).toHaveLength(2);
    const command = dynamo.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('ScanCommand');
  });

  it('should return empty array when no templates found', async () => {
    const dynamo = createMockDynamoClient({ queryItems: [] });

    const result = await listTemplates(dynamo, 'TestTable', 'newContent');

    expect(result).toEqual([]);
  });
});
