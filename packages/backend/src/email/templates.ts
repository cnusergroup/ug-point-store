import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationType, EmailLocale } from './send';

// ============================================================
// Types
// ============================================================

export interface EmailTemplate {
  templateId: string;   // NotificationType
  locale: EmailLocale;
  subject: string;      // 1–200 chars
  body: string;         // HTML, 1–10000 chars
  updatedAt: string;
  updatedBy?: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================
// Constants
// ============================================================

const TEMPLATE_VARIABLE_MAP: Record<NotificationType, string[]> = {
  pointsEarned: ['nickname', 'points', 'source', 'balance'],
  newOrder: ['orderId', 'productNames', 'buyerNickname', 'recipientName', 'phone', 'detailAddress'],
  orderShipped: ['nickname', 'orderId', 'trackingNumber'],
  newProduct: ['nickname', 'productList'],
  newContent: ['nickname', 'contentList'],
  contentUpdated: ['contentTitle', 'userName', 'activityTopic', 'activityDate'],
  weeklyDigest: ['nickname', 'productList', 'contentList', 'weekStart', 'weekEnd'],
};

const SUBJECT_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 10000;

// ============================================================
// Template variable replacement
// ============================================================

/**
 * Replace all `{{variableName}}` placeholders in a template string.
 * Missing values are replaced with an empty string.
 */
export function replaceVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    return variables[varName] ?? '';
  });
}

// ============================================================
// Template validation
// ============================================================

/**
 * Validate template subject and body lengths.
 * Subject: 1–200 chars, Body: 1–10000 chars.
 */
export function validateTemplateInput(
  subject: string,
  body: string,
): TemplateValidationResult {
  if (!subject || subject.length < 1 || subject.length > SUBJECT_MAX_LENGTH) {
    return {
      valid: false,
      error: `Subject must be between 1 and ${SUBJECT_MAX_LENGTH} characters`,
    };
  }

  if (!body || body.length < 1 || body.length > BODY_MAX_LENGTH) {
    return {
      valid: false,
      error: `Body must be between 1 and ${BODY_MAX_LENGTH} characters`,
    };
  }

  return { valid: true };
}

// ============================================================
// Required variables lookup
// ============================================================

/**
 * Return the list of required variable names for a given notification type.
 */
export function getRequiredVariables(templateId: NotificationType): string[] {
  return TEMPLATE_VARIABLE_MAP[templateId] ?? [];
}

// ============================================================
// DynamoDB operations
// ============================================================

/**
 * Fetch a single email template by notification type and locale.
 * Returns null if not found.
 */
export async function getTemplate(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  templateId: NotificationType,
  locale: EmailLocale,
): Promise<EmailTemplate | null> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { templateId, locale },
    }),
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as EmailTemplate;
}

/**
 * Update (or create) an email template. Validates subject/body before writing.
 * Returns the updated template record.
 */
export async function updateTemplate(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  template: Partial<EmailTemplate> & { templateId: string; locale: string },
): Promise<EmailTemplate> {
  // Read existing template to merge fields
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { templateId: template.templateId, locale: template.locale },
    }),
  );

  const subject = template.subject ?? (existing.Item?.subject as string) ?? '';
  const body = template.body ?? (existing.Item?.body as string) ?? '';

  // Validate
  const validation = validateTemplateInput(subject, body);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const now = new Date().toISOString();

  const record: EmailTemplate = {
    templateId: template.templateId,
    locale: template.locale as EmailLocale,
    subject,
    body,
    updatedAt: now,
    updatedBy: template.updatedBy,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
    }),
  );

  return record;
}

/**
 * List email templates. If templateId is provided, returns all locale variants
 * for that notification type (Query on PK). Otherwise returns all templates (Scan).
 */
export async function listTemplates(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  templateId?: NotificationType,
): Promise<EmailTemplate[]> {
  if (templateId) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'templateId = :tid',
        ExpressionAttributeValues: { ':tid': templateId },
      }),
    );
    return (result.Items ?? []) as EmailTemplate[];
  }

  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
    }),
  );
  return (result.Items ?? []) as EmailTemplate[];
}
