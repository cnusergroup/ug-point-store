import { SESClient } from '@aws-sdk/client-ses';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationType, EmailLocale, BulkSendResult } from './send';
import { sendEmail, sendBulkEmail } from './send';
import { getTemplate, replaceVariables } from './templates';
import { getFeatureToggles } from '../settings/feature-toggles';

// ============================================================
// Types
// ============================================================

export interface NotificationContext {
  sesClient: SESClient;
  dynamoClient: DynamoDBDocumentClient;
  emailTemplatesTable: string;
  usersTable: string;
  senderEmail: string;
}

export interface SubscribedUser {
  email: string;
  locale: EmailLocale;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_LOCALE: EmailLocale = 'zh';

const TOGGLE_MAP: Record<NotificationType, string> = {
  pointsEarned: 'emailPointsEarnedEnabled',
  newOrder: 'emailNewOrderEnabled',
  orderShipped: 'emailOrderShippedEnabled',
  newProduct: 'emailNewProductEnabled',
  newContent: 'emailNewContentEnabled',
};

const ADMIN_ROLES = ['Admin', 'SuperAdmin', 'OrderAdmin'];

// ============================================================
// Helpers
// ============================================================

/**
 * Check if the email toggle for a given notification type is enabled.
 * Returns false if the toggle field doesn't exist (treat undefined as disabled).
 */
async function isEmailEnabled(
  ctx: NotificationContext,
  type: NotificationType,
): Promise<boolean> {
  try {
    const toggles = await getFeatureToggles(ctx.dynamoClient, ctx.usersTable);
    const field = TOGGLE_MAP[type];
    return (toggles as Record<string, unknown>)[field] === true;
  } catch {
    return false;
  }
}

/**
 * Load a user record from DynamoDB and return email, nickname, and locale.
 * Returns null if user not found or has no email.
 */
async function loadUser(
  ctx: NotificationContext,
  userId: string,
): Promise<{ email: string; nickname: string; locale: EmailLocale } | null> {
  try {
    const result = await ctx.dynamoClient.send(
      new GetCommand({
        TableName: ctx.usersTable,
        Key: { userId },
      }),
    );

    if (!result.Item || !result.Item.email) {
      return null;
    }

    return {
      email: result.Item.email as string,
      nickname: (result.Item.nickname as string) ?? '',
      locale: (result.Item.locale as EmailLocale) ?? DEFAULT_LOCALE,
    };
  } catch (err) {
    console.error(`[Notification] Failed to load user ${userId}:`, err);
    return null;
  }
}

/**
 * Load a template for the given type and locale, falling back to zh if not found.
 * Returns null if neither the requested locale nor zh template exists.
 */
async function loadTemplateWithFallback(
  ctx: NotificationContext,
  type: NotificationType,
  locale: EmailLocale,
): Promise<{ subject: string; body: string } | null> {
  let template = await getTemplate(
    ctx.dynamoClient,
    ctx.emailTemplatesTable,
    type,
    locale,
  );

  if (!template && locale !== DEFAULT_LOCALE) {
    template = await getTemplate(
      ctx.dynamoClient,
      ctx.emailTemplatesTable,
      type,
      DEFAULT_LOCALE,
    );
  }

  if (!template) {
    return null;
  }

  return { subject: template.subject, body: template.body };
}

/**
 * Group subscribed users by locale.
 */
function groupByLocale(
  users: SubscribedUser[],
): Map<EmailLocale, string[]> {
  const groups = new Map<EmailLocale, string[]>();
  for (const user of users) {
    const locale = user.locale ?? DEFAULT_LOCALE;
    const existing = groups.get(locale);
    if (existing) {
      existing.push(user.email);
    } else {
      groups.set(locale, [user.email]);
    }
  }
  return groups;
}

// ============================================================
// Transactional notification functions
// ============================================================

/**
 * Send a "points earned" email to a single user.
 * Checks toggle, loads user locale, loads template, replaces variables, sends.
 */
export async function sendPointsEarnedEmail(
  ctx: NotificationContext,
  userId: string,
  points: number,
  source: string,
  balance: number,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'pointsEarned'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping pointsEarned: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'pointsEarned', user.locale);
    if (!template) {
      console.error('[Notification] pointsEarned template not found');
      return;
    }

    const variables: Record<string, string> = {
      nickname: user.nickname,
      points: String(points),
      source,
      balance: String(balance),
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] pointsEarned email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send pointsEarned email:', err);
  }
}

export interface OrderShippingInfo {
  recipientName: string;
  phone: string;
  detailAddress: string;
}

/**
 * Send a "new order" email to all Admin, SuperAdmin, and OrderAdmin users.
 * Groups recipients by locale and sends per-locale emails.
 */
export async function sendNewOrderEmail(
  ctx: NotificationContext,
  orderId: string,
  orderItems: { productName: string; quantity: number; selectedSize?: string }[],
  buyerNickname: string,
  shippingInfo: OrderShippingInfo,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'newOrder'))) {
      return;
    }

    // Find all Admin/SuperAdmin/OrderAdmin users
    // Admin users only receive if adminOrdersEnabled is true
    const toggles = await getFeatureToggles(ctx.dynamoClient, ctx.usersTable);
    const adminOrdersEnabled = (toggles as Record<string, unknown>).adminOrdersEnabled === true;

    const adminUsers: { email: string; nickname: string; locale: EmailLocale }[] = [];

    const result = await ctx.dynamoClient.send(
      new ScanCommand({
        TableName: ctx.usersTable,
        ProjectionExpression: 'email, nickname, locale, #roles',
        ExpressionAttributeNames: { '#roles': 'roles' },
      }),
    );

    for (const item of result.Items ?? []) {
      const roles: string[] = Array.isArray(item.roles) ? item.roles : [];
      const isSuperAdmin = roles.includes('SuperAdmin');
      const isOrderAdmin = roles.includes('OrderAdmin');
      const isAdmin = roles.includes('Admin');

      // SuperAdmin and OrderAdmin always receive; Admin only when adminOrdersEnabled
      const shouldReceive = isSuperAdmin || isOrderAdmin || (isAdmin && adminOrdersEnabled);
      if (shouldReceive && item.email) {
        adminUsers.push({
          email: item.email as string,
          nickname: (item.nickname as string) ?? '',
          locale: (item.locale as EmailLocale) ?? DEFAULT_LOCALE,
        });
      }
    }

    if (adminUsers.length === 0) {
      console.warn('[Notification] No admin users found for newOrder notification');
      return;
    }

    const variables: Record<string, string> = {
      orderId,
      productNames: orderItems.map((i) => {
        let line = `${i.productName} × ${i.quantity}`;
        if (i.selectedSize) line += `（尺码：${i.selectedSize}）`;
        return line;
      }).join('\n'),
      buyerNickname,
      recipientName: shippingInfo.recipientName,
      phone: shippingInfo.phone,
      detailAddress: shippingInfo.detailAddress,
    };

    // Group by locale and send per-locale emails
    const localeGroups = new Map<EmailLocale, string[]>();
    for (const user of adminUsers) {
      const locale = user.locale ?? DEFAULT_LOCALE;
      const existing = localeGroups.get(locale);
      if (existing) {
        existing.push(user.email);
      } else {
        localeGroups.set(locale, [user.email]);
      }
    }

    for (const [locale, emails] of localeGroups) {
      const template = await loadTemplateWithFallback(ctx, 'newOrder', locale);
      if (!template) {
        console.error(`[Notification] newOrder template not found for locale ${locale}`);
        continue;
      }

      const subject = replaceVariables(template.subject, variables);
      const htmlBody = replaceVariables(template.body, variables);

      // Send individually to each admin so they get personalized TO field
      for (const email of emails) {
        try {
          await sendEmail(ctx.sesClient, { to: email, subject, htmlBody }, ctx.senderEmail);
        } catch (err) {
          console.error(`[Notification] Failed to send newOrder email to ${email}:`, err);
        }
      }
    }

    console.log(`[Notification] newOrder emails sent to ${adminUsers.length} admin users`);
  } catch (err) {
    console.error('[Notification] Failed to send newOrder emails:', err);
  }
}

/**
 * Send an "order shipped" email to the order's user.
 * Checks toggle, loads user locale, sends.
 */
export async function sendOrderShippedEmail(
  ctx: NotificationContext,
  userId: string,
  orderId: string,
  trackingNumber?: string,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'orderShipped'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping orderShipped: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'orderShipped', user.locale);
    if (!template) {
      console.error('[Notification] orderShipped template not found');
      return;
    }

    const variables: Record<string, string> = {
      nickname: user.nickname,
      orderId,
      trackingNumber: trackingNumber ?? '',
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] orderShipped email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send orderShipped email:', err);
  }
}

// ============================================================
// Bulk notification functions
// ============================================================

/**
 * Send a "new product" notification to subscribed users.
 * Groups by locale, loads per-locale template, sends bulk emails.
 */
export async function sendNewProductNotification(
  ctx: NotificationContext,
  productList: string,
  subscribedUsers: SubscribedUser[],
): Promise<BulkSendResult> {
  const emptyResult: BulkSendResult = {
    totalBatches: 0,
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  try {
    if (!(await isEmailEnabled(ctx, 'newProduct'))) {
      return emptyResult;
    }

    if (subscribedUsers.length === 0) {
      return emptyResult;
    }

    const localeGroups = groupByLocale(subscribedUsers);
    const aggregated: BulkSendResult = {
      totalBatches: 0,
      successCount: 0,
      failureCount: 0,
      errors: [],
    };

    for (const [locale, emails] of localeGroups) {
      const template = await loadTemplateWithFallback(ctx, 'newProduct', locale);
      if (!template) {
        console.error(`[Notification] newProduct template not found for locale ${locale}`);
        continue;
      }

      const variables: Record<string, string> = {
        nickname: '',
        productList,
      };

      const subject = replaceVariables(template.subject, variables);
      const htmlBody = replaceVariables(template.body, variables);

      const result = await sendBulkEmail(
        ctx.sesClient,
        { recipients: emails, subject, htmlBody },
        ctx.senderEmail,
      );

      aggregated.totalBatches += result.totalBatches;
      aggregated.successCount += result.successCount;
      aggregated.failureCount += result.failureCount;
      aggregated.errors.push(...result.errors);
    }

    console.log(
      `[Notification] newProduct bulk send complete: ${aggregated.successCount} success, ${aggregated.failureCount} failed`,
    );
    return aggregated;
  } catch (err) {
    console.error('[Notification] Failed to send newProduct notifications:', err);
    return emptyResult;
  }
}

/**
 * Send a "new content" notification to subscribed users.
 * Groups by locale, loads per-locale template, sends bulk emails.
 */
export async function sendNewContentNotification(
  ctx: NotificationContext,
  contentList: string,
  subscribedUsers: SubscribedUser[],
): Promise<BulkSendResult> {
  const emptyResult: BulkSendResult = {
    totalBatches: 0,
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  try {
    if (!(await isEmailEnabled(ctx, 'newContent'))) {
      return emptyResult;
    }

    if (subscribedUsers.length === 0) {
      return emptyResult;
    }

    const localeGroups = groupByLocale(subscribedUsers);
    const aggregated: BulkSendResult = {
      totalBatches: 0,
      successCount: 0,
      failureCount: 0,
      errors: [],
    };

    for (const [locale, emails] of localeGroups) {
      const template = await loadTemplateWithFallback(ctx, 'newContent', locale);
      if (!template) {
        console.error(`[Notification] newContent template not found for locale ${locale}`);
        continue;
      }

      const variables: Record<string, string> = {
        nickname: '',
        contentList,
      };

      const subject = replaceVariables(template.subject, variables);
      const htmlBody = replaceVariables(template.body, variables);

      const result = await sendBulkEmail(
        ctx.sesClient,
        { recipients: emails, subject, htmlBody },
        ctx.senderEmail,
      );

      aggregated.totalBatches += result.totalBatches;
      aggregated.successCount += result.successCount;
      aggregated.failureCount += result.failureCount;
      aggregated.errors.push(...result.errors);
    }

    console.log(
      `[Notification] newContent bulk send complete: ${aggregated.successCount} success, ${aggregated.failureCount} failed`,
    );
    return aggregated;
  } catch (err) {
    console.error('[Notification] Failed to send newContent notifications:', err);
    return emptyResult;
  }
}
