import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { getFeatureToggles } from '../settings/feature-toggles';
import { getTemplate } from '../email/templates';
import { sendBulkEmail } from '../email/send';
import type { EmailLocale } from '../email/send';
import {
  queryNewProducts,
  queryNewContent,
  querySubscribers,
  groupByLocale,
} from './query';
import type { DigestProduct, DigestContentItem, DigestSubscriber } from './query';
import {
  getDigestVariant,
  formatProductList,
  formatContentList,
  composeDigestEmail,
  shouldSkipDigest,
} from './compose';
import type { DigestVariant } from './compose';

// ============================================================
// Clients (module-level singletons)
// ============================================================

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sesClient = new SESClient({});

// ============================================================
// Environment variables
// ============================================================

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE ?? '';
const CONTENT_ITEMS_TABLE = process.env.CONTENT_ITEMS_TABLE ?? '';
const USERS_TABLE = process.env.USERS_TABLE ?? '';
const EMAIL_TEMPLATES_TABLE = process.env.EMAIL_TEMPLATES_TABLE ?? '';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? '';

// ============================================================
// Constants
// ============================================================

const DEFAULT_LOCALE: EmailLocale = 'zh';

// ============================================================
// Handler
// ============================================================

export async function handler(_event: unknown): Promise<void> {
  console.log('[Digest] Starting weekly digest execution');

  // Step 1: Check feature toggle
  let toggleEnabled = false;
  try {
    const toggles = await getFeatureToggles(dynamoClient, USERS_TABLE);
    toggleEnabled = toggles.emailWeeklyDigestEnabled === true;
  } catch {
    // Feature toggle read fails → treat as disabled
    console.error('[Digest] Failed to read feature toggles, treating as disabled');
    console.log('[Digest] Feature disabled, skipping');
    return;
  }

  if (!toggleEnabled) {
    console.log('[Digest] Feature disabled, skipping');
    return;
  }

  // Step 2: Query products and content (past 7 days)
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let products: DigestProduct[];
  let contentItems: DigestContentItem[];
  try {
    [products, contentItems] = await Promise.all([
      queryNewProducts(dynamoClient, PRODUCTS_TABLE, since),
      queryNewContent(dynamoClient, CONTENT_ITEMS_TABLE, since),
    ]);
  } catch (err) {
    console.error('[Digest] DynamoDB read error during product/content query:', err);
    return;
  }

  // Step 3: Check if digest should be skipped
  if (shouldSkipDigest(products, contentItems)) {
    console.log('[Digest] No new products or content, skipping');
    return;
  }

  // Step 4: Find subscribers
  let subscribers: DigestSubscriber[];
  try {
    subscribers = await querySubscribers(dynamoClient, USERS_TABLE);
  } catch (err) {
    console.error('[Digest] DynamoDB read error during subscriber query:', err);
    return;
  }

  if (subscribers.length === 0) {
    console.log('[Digest] No subscribers found, skipping');
    return;
  }

  // Step 5: Group by locale
  const localeGroups = groupByLocale(subscribers);

  // Step 6: Compute date range strings for template
  const weekEnd = now.toISOString().slice(0, 10);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Step 7: Send per-locale, per-variant emails
  let totalSent = 0;
  let totalFailed = 0;

  for (const [locale, localeSubscribers] of localeGroups) {
    // Load template with zh fallback
    let template = await getTemplate(dynamoClient, EMAIL_TEMPLATES_TABLE, 'weeklyDigest', locale);
    if (!template && locale !== DEFAULT_LOCALE) {
      template = await getTemplate(dynamoClient, EMAIL_TEMPLATES_TABLE, 'weeklyDigest', DEFAULT_LOCALE);
    }
    if (!template) {
      console.error(`[Digest] Template not found for locale ${locale}, skipping locale group`);
      continue;
    }

    // Group subscribers by digest variant
    const variantGroups = new Map<DigestVariant, DigestSubscriber[]>();
    for (const sub of localeSubscribers) {
      const variant = getDigestVariant(sub);
      const existing = variantGroups.get(variant);
      if (existing) {
        existing.push(sub);
      } else {
        variantGroups.set(variant, [sub]);
      }
    }

    // Send per-variant
    for (const [variant, variantSubscribers] of variantGroups) {
      const productListHtml = variant === 'contentOnly'
        ? formatProductList([], locale)
        : formatProductList(products, locale);

      const contentListHtml = variant === 'productsOnly'
        ? formatContentList([], locale)
        : formatContentList(contentItems, locale);

      const email = composeDigestEmail(
        { subject: template.subject, body: template.body },
        {
          nickname: '',
          productList: productListHtml,
          contentList: contentListHtml,
          weekStart,
          weekEnd,
        },
      );

      const recipients = variantSubscribers.map((s) => s.email);

      const result = await sendBulkEmail(
        sesClient,
        { recipients, subject: email.subject, htmlBody: email.htmlBody },
        SENDER_EMAIL,
      );

      // Log per-batch results
      const totalBatches = result.totalBatches;
      for (let i = 0; i < totalBatches; i++) {
        const isFailed = result.errors.some((e) => e.batchIndex === i);
        if (isFailed) {
          const err = result.errors.find((e) => e.batchIndex === i);
          console.error(`[Digest] Batch ${i + 1}/${totalBatches} failed: ${err?.error}`);
        } else {
          const batchSize = Math.min(50, recipients.length - i * 50);
          console.log(`[Digest] Batch ${i + 1}/${totalBatches} sent (${batchSize} recipients, locale: ${locale})`);
        }
      }

      totalSent += result.successCount;
      totalFailed += result.failureCount;
    }
  }

  // Step 8: Log execution summary
  console.log(
    `[Digest] Complete: ${subscribers.length} subscribers, ${totalSent} sent, ${totalFailed} failed, ${products.length} products, ${contentItems.length} content items`,
  );
}
