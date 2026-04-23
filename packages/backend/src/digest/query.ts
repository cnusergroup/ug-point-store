import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { EmailLocale } from '../email/send';

// ============================================================
// Types
// ============================================================

export interface DigestProduct {
  name: string;
  pointsCost: number;
  createdAt: string;
}

export interface DigestContentItem {
  title: string;
  authorName: string;
  createdAt: string;
}

export interface DigestSubscriber {
  email: string;
  nickname: string;
  locale: EmailLocale;
  wantsProducts: boolean;
  wantsContent: boolean;
}

// ============================================================
// Pure functions
// ============================================================

/**
 * Filter items by createdAt in [since, until).
 * Inclusive of `since`, exclusive of `until`.
 */
export function filterByDateRange<T extends { createdAt: string }>(
  items: T[],
  since: string,
  until: string,
): T[] {
  return items.filter((item) => item.createdAt >= since && item.createdAt < until);
}

/**
 * Sort items by createdAt descending (newest first).
 * Returns a new array; does not mutate the input.
 */
export function sortByCreatedAtDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Identify digest subscribers from raw user records.
 * A subscriber must have a non-empty email and at least one of
 * emailSubscriptions.newProduct or emailSubscriptions.newContent = true.
 */
export function identifySubscribers(
  users: Array<{
    email?: string;
    nickname?: string;
    locale?: string;
    emailSubscriptions?: { newProduct?: boolean; newContent?: boolean };
  }>,
): DigestSubscriber[] {
  const result: DigestSubscriber[] = [];

  for (const user of users) {
    // Must have a non-empty email
    if (!user.email || user.email.trim() === '') continue;

    const wantsProducts = user.emailSubscriptions?.newProduct === true;
    const wantsContent = user.emailSubscriptions?.newContent === true;

    // Must have at least one subscription enabled
    if (!wantsProducts && !wantsContent) continue;

    const locale = isValidLocale(user.locale) ? user.locale : 'zh';

    result.push({
      email: user.email,
      nickname: user.nickname ?? '',
      locale,
      wantsProducts,
      wantsContent,
    });
  }

  return result;
}

/**
 * Group subscribers by locale.
 */
export function groupByLocale(
  subscribers: DigestSubscriber[],
): Map<EmailLocale, DigestSubscriber[]> {
  const groups = new Map<EmailLocale, DigestSubscriber[]>();

  for (const sub of subscribers) {
    const existing = groups.get(sub.locale);
    if (existing) {
      existing.push(sub);
    } else {
      groups.set(sub.locale, [sub]);
    }
  }

  return groups;
}

// ============================================================
// Helpers
// ============================================================

const VALID_LOCALES: Set<string> = new Set(['zh', 'en', 'ja', 'ko', 'zh-TW']);

function isValidLocale(locale: string | undefined): locale is EmailLocale {
  return typeof locale === 'string' && VALID_LOCALES.has(locale);
}

// ============================================================
// DynamoDB query functions
// ============================================================

/**
 * Query products created since the given date.
 * Scans Products table with FilterExpression createdAt >= :since.
 * Returns products sorted by createdAt descending.
 */
export async function queryNewProducts(
  dynamoClient: DynamoDBDocumentClient,
  productsTable: string,
  since: string,
): Promise<DigestProduct[]> {
  const items: DigestProduct[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: productsTable,
        FilterExpression: 'createdAt >= :since',
        ExpressionAttributeValues: {
          ':since': since,
        },
        ProjectionExpression: '#name, pointsCost, createdAt',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      items.push({
        name: (item.name as string) ?? '',
        pointsCost: (item.pointsCost as number) ?? 0,
        createdAt: (item.createdAt as string) ?? '',
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return sortByCreatedAtDesc(items);
}

/**
 * Query approved content items created since the given date.
 * Scans ContentItems table with FilterExpression createdAt >= :since AND status = approved.
 * Returns items sorted by createdAt descending.
 */
export async function queryNewContent(
  dynamoClient: DynamoDBDocumentClient,
  contentItemsTable: string,
  since: string,
): Promise<DigestContentItem[]> {
  const items: DigestContentItem[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: contentItemsTable,
        FilterExpression: 'createdAt >= :since AND #status = :approved',
        ExpressionAttributeValues: {
          ':since': since,
          ':approved': 'approved',
        },
        ProjectionExpression: 'title, authorName, createdAt, #status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      items.push({
        title: (item.title as string) ?? '',
        authorName: (item.authorName as string) ?? '',
        createdAt: (item.createdAt as string) ?? '',
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return sortByCreatedAtDesc(items);
}

/**
 * Scan users table for digest subscribers.
 * A subscriber has a valid email and at least one of
 * emailSubscriptions.newProduct or emailSubscriptions.newContent = true.
 */
export async function querySubscribers(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<DigestSubscriber[]> {
  const rawUsers: Array<{
    email?: string;
    nickname?: string;
    locale?: string;
    emailSubscriptions?: { newProduct?: boolean; newContent?: boolean };
  }> = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: usersTable,
        FilterExpression:
          'attribute_exists(email) AND email <> :empty AND (emailSubscriptions.newProduct = :true OR emailSubscriptions.newContent = :true)',
        ExpressionAttributeValues: {
          ':empty': '',
          ':true': true,
        },
        ProjectionExpression: 'email, nickname, locale, emailSubscriptions',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      rawUsers.push({
        email: item.email as string | undefined,
        nickname: item.nickname as string | undefined,
        locale: item.locale as string | undefined,
        emailSubscriptions: item.emailSubscriptions as
          | { newProduct?: boolean; newContent?: boolean }
          | undefined,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return identifySubscribers(rawUsers);
}
