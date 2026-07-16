import { SESClient } from '@aws-sdk/client-ses';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationType, EmailLocale, BulkSendResult } from './send';
import { sendEmail, sendBulkEmail } from './send';
import { getTemplate, replaceVariables } from './templates';
import { getDefaultTemplates } from './seed';
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

// codeDistribution is intentionally omitted: distribution emails are
// admin-initiated transactional mails that bypass subscription toggle gating.
const TOGGLE_MAP: Partial<Record<NotificationType, string>> = {
  pointsEarned: 'emailPointsEarnedEnabled',
  newOrder: 'emailNewOrderEnabled',
  orderShipped: 'emailOrderShippedEnabled',
  newProduct: 'emailNewProductEnabled',
  newContent: 'emailNewContentEnabled',
  contentUpdated: 'emailContentUpdatedEnabled',
  weeklyDigest: 'emailWeeklyDigestEnabled',
  wishAdopted: 'emailWishAdoptedEnabled',
  wishFulfilled: 'emailWishFulfilledEnabled',
  wishRejected: 'emailWishRejectedEnabled',
  uglExitReminder: 'emailUglExitReminderEnabled',
  uglExitNotification: 'emailUglExitNotificationEnabled',
  uglExitAdminNotification: 'emailUglExitNotificationEnabled',
  uglExitDetectionCompletion: 'emailUglExitNotificationEnabled',
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
    if (!field) return false;
    return (toggles as unknown as Record<string, unknown>)[field] === true;
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
    const adminOrdersEnabled = (toggles as unknown as Record<string, unknown>).adminOrdersEnabled === true;

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
 * When trackingNumber is missing or empty, substitutes a contact email message.
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

    const CONTACT_EMAIL = 'yuanliang@busite.cn';

    const variables: Record<string, string> = {
      nickname: user.nickname,
      orderId,
      trackingNumber: trackingNumber && trackingNumber.trim()
        ? trackingNumber
        : `如需查询发货状态，请邮件联系 ${CONTACT_EMAIL}`,
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

// ============================================================
// Content Updated notification
// ============================================================

/**
 * Send a "content updated" email to a single reservation user.
 * Checks toggle, loads user locale, loads template, replaces variables, sends.
 */
export async function sendContentUpdatedEmail(
  ctx: NotificationContext,
  userId: string,
  contentTitle: string,
  activityTopic: string,
  activityDate: string,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'contentUpdated'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping contentUpdated: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'contentUpdated', user.locale);
    if (!template) {
      console.error('[Notification] contentUpdated template not found');
      return;
    }

    const variables: Record<string, string> = {
      contentTitle,
      userName: user.nickname,
      activityTopic,
      activityDate,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] contentUpdated email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send contentUpdated email:', err);
  }
}

// ============================================================
// Wish Pool notification functions
// ============================================================

/**
 * Send a "wish adopted" email to the wish author.
 * Best-effort: failure does not block the main operation.
 */
export async function sendWishAdoptedEmail(
  ctx: NotificationContext,
  userId: string,
  wishTitle: string,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'wishAdopted'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping wishAdopted: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'wishAdopted', user.locale);
    if (!template) {
      console.error('[Notification] wishAdopted template not found');
      return;
    }

    const variables: Record<string, string> = {
      nickname: user.nickname,
      wishTitle,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] wishAdopted email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send wishAdopted email:', err);
  }
}

/**
 * Send a "wish fulfilled" email to the wish author with product link.
 * Best-effort: failure does not block the main operation.
 */
export async function sendWishFulfilledEmail(
  ctx: NotificationContext,
  userId: string,
  wishTitle: string,
  productId: string,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'wishFulfilled'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping wishFulfilled: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'wishFulfilled', user.locale);
    if (!template) {
      console.error('[Notification] wishFulfilled template not found');
      return;
    }

    // Construct product URL — relative path that works with the frontend
    const productUrl = `/products/${productId}`;

    const variables: Record<string, string> = {
      nickname: user.nickname,
      wishTitle,
      productUrl,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] wishFulfilled email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send wishFulfilled email:', err);
  }
}

/**
 * Send a "wish rejected" email to the wish author with close reason.
 * Best-effort: failure does not block the main operation.
 */
export async function sendWishRejectedEmail(
  ctx: NotificationContext,
  userId: string,
  wishTitle: string,
  closeReason: string,
): Promise<void> {
  try {
    if (!(await isEmailEnabled(ctx, 'wishRejected'))) {
      return;
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping wishRejected: user ${userId} not found or no email`);
      return;
    }

    const template = await loadTemplateWithFallback(ctx, 'wishRejected', user.locale);
    if (!template) {
      console.error('[Notification] wishRejected template not found');
      return;
    }

    const variables: Record<string, string> = {
      nickname: user.nickname,
      wishTitle,
      closeReason,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] wishRejected email sent to ${user.email}`);
  } catch (err) {
    console.error('[Notification] Failed to send wishRejected email:', err);
  }
}

// ============================================================
// Code distribution notification (admin transactional)
// ============================================================

export interface CodeDistributionEmailResult {
  status: 'sent' | 'failed' | 'no_email';
  error?: string;
}

/**
 * Load the codeDistribution template for a locale, falling back to the zh
 * locale and then to the built-in system default template (Req 7.6).
 * Unlike loadTemplateWithFallback, this never returns null: a configured
 * template is always available so distribution mails can be delivered.
 */
function loadCodeDistributionDefault(locale: EmailLocale): { subject: string; body: string } {
  const defaults = getDefaultTemplates().filter((t) => t.templateId === 'codeDistribution');
  const match =
    defaults.find((t) => t.locale === locale) ??
    defaults.find((t) => t.locale === DEFAULT_LOCALE) ??
    defaults[0];
  return { subject: match.subject, body: match.body };
}

/**
 * Send a code distribution email to a single allocated recipient.
 *
 * This is an admin-initiated transactional mail, so it intentionally does NOT
 * pass through the isEmailEnabled subscription toggle gating — the codes must
 * reach the recipient regardless of their newsletter preferences.
 *
 * Loads the user → returns { status: 'no_email' } when the user has no email.
 * Loads the codeDistribution template (locale → zh fallback, then system
 * default if missing) → renders nickname/codeList/productNames/codeCount/storeUrl
 * → sends. codeList is joined as an HTML list (one code per line);
 * codeCount = codeValues.length.
 */
export async function sendCodeDistributionEmail(
  ctx: NotificationContext & { senderEmail: string },
  userId: string,
  codeValues: string[],
  productNames: string[],
  storeUrl: string,
): Promise<CodeDistributionEmailResult> {
  const user = await loadUser(ctx, userId);
  if (!user) {
    return { status: 'no_email' };
  }

  try {
    // Locale → zh fallback from DynamoDB; fall back to system default when missing.
    const template =
      (await loadTemplateWithFallback(ctx, 'codeDistribution', user.locale)) ??
      loadCodeDistributionDefault(user.locale);

    const variables: Record<string, string> = {
      nickname: user.nickname,
      codeList: codeValues.join('<br>'),
      productNames: productNames.join('、'),
      codeCount: String(codeValues.length),
      storeUrl,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] codeDistribution email sent to ${user.email}`);
    return { status: 'sent' };
  } catch (err) {
    console.error('[Notification] Failed to send codeDistribution email:', err);
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// UGL Inactivity Exit Flow notification functions
// ============================================================

/**
 * Send a "UGL exit reminder" email to a Fully_Inactive_UGL at the start of
 * their 30-day grace period.
 *
 * Checks the emailUglExitReminderEnabled toggle, loads user locale, loads
 * template (locale → zh fallback), replaces variables, sends via SES.
 * Mirrors sendPointsEarnedEmail's error handling: catches and logs its own
 * errors, never throws. Sends only to the target user's registered email.
 */
export async function sendUGLExitReminderEmail(
  ctx: NotificationContext,
  userId: string,
  detectionQuarter: string,
  gracePeriodDeadline: string,
): Promise<{ sent: boolean }> {
  try {
    if (!(await isEmailEnabled(ctx, 'uglExitReminder'))) {
      return { sent: false };
    }

    const user = await loadUser(ctx, userId);
    if (!user) {
      console.warn(`[Notification] Skipping uglExitReminder: user ${userId} not found or no email`);
      return { sent: false };
    }

    const template = await loadTemplateWithFallback(ctx, 'uglExitReminder', user.locale);
    if (!template) {
      console.error('[Notification] uglExitReminder template not found');
      return { sent: false };
    }

    const variables: Record<string, string> = {
      nickname: user.nickname,
      detectionQuarter,
      gracePeriodDeadline,
    };

    const subject = replaceVariables(template.subject, variables);
    const htmlBody = replaceVariables(template.body, variables);

    await sendEmail(ctx.sesClient, { to: user.email, subject, htmlBody }, ctx.senderEmail);
    console.log(`[Notification] uglExitReminder email sent to ${user.email}`);
    return { sent: true };
  } catch (err) {
    console.error('[Notification] Failed to send uglExitReminder email:', err);
    return { sent: false };
  }
}

/**
 * Send the Exit_Notification to the affected Pending_Exit_UGL and to every
 * current SuperAdmin user.
 *
 * Both the user notification and the admin notifications are gated by the
 * SAME emailUglExitNotificationEnabled toggle (checked once up front) — per
 * design.md, uglExitNotification and uglExitAdminNotification share one
 * toggle since they are the same logical Exit_Notification event.
 *
 * Best-effort throughout: a failure sending to the affected user does not
 * prevent admin notifications from being attempted, and a failure sending to
 * one SuperAdmin never blocks the others. Mirrors sendNewOrderEmail's
 * admin-lookup Scan shape (ProjectionExpression + #roles filter) but filters
 * to SuperAdmin only, and sends individually per-recipient so failures are
 * isolated.
 */
export async function sendUGLExitNotifications(
  ctx: NotificationContext,
  affectedUserId: string,
  detectionQuarter: string,
): Promise<{ userSent: boolean; adminsSent: number; adminsFailed: number }> {
  let userSent = false;
  let adminsSent = 0;
  let adminsFailed = 0;

  try {
    if (!(await isEmailEnabled(ctx, 'uglExitNotification'))) {
      return { userSent: false, adminsSent: 0, adminsFailed: 0 };
    }

    // Load the affected user once — reused for both the user notification
    // (step below) and the affectedNickname/affectedEmail variables in the
    // admin notification (per TEMPLATE_VARIABLE_MAP's uglExitAdminNotification entry).
    const affectedUser = await loadUser(ctx, affectedUserId);

    // 1. Send uglExitNotification to the affected user (best-effort).
    if (affectedUser) {
      try {
        const template = await loadTemplateWithFallback(ctx, 'uglExitNotification', affectedUser.locale);
        if (!template) {
          console.error('[Notification] uglExitNotification template not found');
        } else {
          const variables: Record<string, string> = {
            nickname: affectedUser.nickname,
            detectionQuarter,
          };

          const subject = replaceVariables(template.subject, variables);
          const htmlBody = replaceVariables(template.body, variables);

          await sendEmail(ctx.sesClient, { to: affectedUser.email, subject, htmlBody }, ctx.senderEmail);
          console.log(`[Notification] uglExitNotification email sent to ${affectedUser.email}`);
          userSent = true;
        }
      } catch (err) {
        console.error('[Notification] Failed to send uglExitNotification email to affected user:', err);
      }
    } else {
      console.warn(`[Notification] Skipping uglExitNotification: user ${affectedUserId} not found or no email`);
    }

    // 2. Find all SuperAdmin recipients (Scan, mirroring sendNewOrderEmail's admin-lookup shape).
    const result = await ctx.dynamoClient.send(
      new ScanCommand({
        TableName: ctx.usersTable,
        ProjectionExpression: 'email, nickname, locale, #roles',
        ExpressionAttributeNames: { '#roles': 'roles' },
      }),
    );

    const superAdmins: { email: string; locale: EmailLocale }[] = [];
    for (const item of result.Items ?? []) {
      const roles: string[] = Array.isArray(item.roles) ? item.roles : [];
      if (roles.includes('SuperAdmin') && item.email) {
        superAdmins.push({
          email: item.email as string,
          locale: (item.locale as EmailLocale) ?? DEFAULT_LOCALE,
        });
      }
    }

    // 3. Send uglExitAdminNotification to each SuperAdmin (best-effort per recipient).
    for (const admin of superAdmins) {
      try {
        const template = await loadTemplateWithFallback(ctx, 'uglExitAdminNotification', admin.locale);
        if (!template) {
          console.error('[Notification] uglExitAdminNotification template not found');
          adminsFailed += 1;
          continue;
        }

        const variables: Record<string, string> = {
          affectedNickname: affectedUser?.nickname ?? '',
          affectedEmail: affectedUser?.email ?? '',
          detectionQuarter,
        };

        const subject = replaceVariables(template.subject, variables);
        const htmlBody = replaceVariables(template.body, variables);

        await sendEmail(ctx.sesClient, { to: admin.email, subject, htmlBody }, ctx.senderEmail);
        adminsSent += 1;
      } catch (err) {
        console.error(`[Notification] Failed to send uglExitAdminNotification email to ${admin.email}:`, err);
        adminsFailed += 1;
      }
    }

    console.log(
      `[Notification] uglExitNotification complete: userSent=${userSent}, adminsSent=${adminsSent}, adminsFailed=${adminsFailed}`,
    );
    return { userSent, adminsSent, adminsFailed };
  } catch (err) {
    console.error('[Notification] Failed to send uglExitNotifications:', err);
    return { userSent, adminsSent, adminsFailed };
  }
}

/**
 * Send the Detection_Completion_Notification summarizing a UGL_Detection_Job
 * run's Detection_Quarter and the count of newly recorded Awaiting_Reminder_UGL
 * entries (including zero) to every current SuperAdmin's registered email
 * address and every address in Additional_Notification_Recipients.
 *
 * Gated by the emailUglExitNotificationEnabled toggle (shared with
 * uglExitNotification/uglExitAdminNotification — see TOGGLE_MAP), checked
 * once up front. Recipient lookup mirrors sendUGLExitNotifications's
 * SuperAdmin Scan shape (ProjectionExpression + #roles filter); the
 * Additional_Notification_Recipients addresses come from
 * getFeatureToggles(...).additionalNotificationRecipients and are not
 * required to belong to any registered account, so they are sent to directly
 * without going through loadUser/locale resolution — they always receive the
 * DEFAULT_LOCALE-rendered template. Best-effort per recipient: one failure is
 * logged and does not block delivery to any other recipient. Sent even when
 * newlyRecordedCount === 0, per Req 6.2.
 */
export async function sendDetectionCompletionNotification(
  ctx: NotificationContext,
  detectionQuarter: string,
  newlyRecordedCount: number,
): Promise<{ recipientsSent: number; recipientsFailed: number }> {
  let recipientsSent = 0;
  let recipientsFailed = 0;

  try {
    if (!(await isEmailEnabled(ctx, 'uglExitDetectionCompletion'))) {
      return { recipientsSent: 0, recipientsFailed: 0 };
    }

    // 1. Find all SuperAdmin recipients (Scan, mirroring sendUGLExitNotifications's admin-lookup shape).
    const result = await ctx.dynamoClient.send(
      new ScanCommand({
        TableName: ctx.usersTable,
        ProjectionExpression: 'email, nickname, locale, #roles',
        ExpressionAttributeNames: { '#roles': 'roles' },
      }),
    );

    const superAdmins: { email: string; locale: EmailLocale }[] = [];
    for (const item of result.Items ?? []) {
      const roles: string[] = Array.isArray(item.roles) ? item.roles : [];
      if (roles.includes('SuperAdmin') && item.email) {
        superAdmins.push({
          email: item.email as string,
          locale: (item.locale as EmailLocale) ?? DEFAULT_LOCALE,
        });
      }
    }

    // 2. Load Additional_Notification_Recipients from the feature-toggles settings record.
    const toggles = await getFeatureToggles(ctx.dynamoClient, ctx.usersTable);
    const additionalRecipients: string[] = Array.isArray(toggles.additionalNotificationRecipients)
      ? toggles.additionalNotificationRecipients
      : [];

    // 3. Union of every SuperAdmin email and every additional recipient (de-duplicated).
    const recipients = new Map<string, EmailLocale>();
    for (const admin of superAdmins) {
      recipients.set(admin.email, admin.locale);
    }
    for (const email of additionalRecipients) {
      if (!recipients.has(email)) {
        recipients.set(email, DEFAULT_LOCALE);
      }
    }

    const variables: Record<string, string> = {
      detectionQuarter,
      newlyRecordedCount: String(newlyRecordedCount),
    };

    // 4. Send to each recipient, best-effort (one failure never blocks the others).
    for (const [email, locale] of recipients) {
      try {
        const template = await loadTemplateWithFallback(ctx, 'uglExitDetectionCompletion', locale);
        if (!template) {
          console.error('[Notification] uglExitDetectionCompletion template not found');
          recipientsFailed += 1;
          continue;
        }

        const subject = replaceVariables(template.subject, variables);
        const htmlBody = replaceVariables(template.body, variables);

        await sendEmail(ctx.sesClient, { to: email, subject, htmlBody }, ctx.senderEmail);
        recipientsSent += 1;
      } catch (err) {
        console.error(`[Notification] Failed to send uglExitDetectionCompletion email to ${email}:`, err);
        recipientsFailed += 1;
      }
    }

    console.log(
      `[Notification] uglExitDetectionCompletion complete: recipientsSent=${recipientsSent}, recipientsFailed=${recipientsFailed}`,
    );
    return { recipientsSent, recipientsFailed };
  } catch (err) {
    console.error('[Notification] Failed to send uglExitDetectionCompletion notifications:', err);
    return { recipientsSent, recipientsFailed };
  }
}
