import type { DigestProduct, DigestContentItem, DigestSubscriber } from './query';
import type { EmailLocale } from '../email/send';
import { replaceVariables } from '../email/templates';

// ============================================================
// Types
// ============================================================

export type DigestVariant = 'both' | 'productsOnly' | 'contentOnly';

export interface DigestEmailContent {
  subject: string;
  htmlBody: string;
}

// ============================================================
// Locale-aware fallback messages
// ============================================================

const EMPTY_PRODUCT_MESSAGES: Record<EmailLocale, string> = {
  zh: '本周暂无新商品',
  en: 'No new products this week',
  ja: '今週の新着グッズはありません',
  ko: '이번 주 새 굿즈가 없습니다',
  'zh-TW': '本週暫無新商品',
};

const EMPTY_CONTENT_MESSAGES: Record<EmailLocale, string> = {
  zh: '本周暂无新内容',
  en: 'No new content this week',
  ja: '今週の新着コンテンツはありません',
  ko: '이번 주 새 콘텐츠가 없습니다',
  'zh-TW': '本週暫無新內容',
};

// ============================================================
// Functions
// ============================================================

/**
 * Determine which digest variant a subscriber should receive.
 * - 'productsOnly' when wantsProducts=true and wantsContent=false
 * - 'contentOnly' when wantsProducts=false and wantsContent=true
 * - 'both' when both are true
 */
export function getDigestVariant(subscriber: DigestSubscriber): DigestVariant {
  if (subscriber.wantsProducts && subscriber.wantsContent) {
    return 'both';
  }
  if (subscriber.wantsProducts) {
    return 'productsOnly';
  }
  return 'contentOnly';
}

/**
 * Format product list as HTML string for template insertion.
 * Returns locale-appropriate "no new products" message if list is empty.
 */
export function formatProductList(
  products: DigestProduct[],
  locale: EmailLocale,
): string {
  if (products.length === 0) {
    return `<p>${EMPTY_PRODUCT_MESSAGES[locale]}</p>`;
  }

  const items = products
    .map(
      (p) =>
        `<li>${escapeHtml(p.name)} — ${p.pointsCost} pts</li>`,
    )
    .join('');

  return `<ul>${items}</ul>`;
}

/**
 * Format content list as HTML string for template insertion.
 * Returns locale-appropriate "no new content" message if list is empty.
 */
export function formatContentList(
  contentItems: DigestContentItem[],
  locale: EmailLocale,
): string {
  if (contentItems.length === 0) {
    return `<p>${EMPTY_CONTENT_MESSAGES[locale]}</p>`;
  }

  const items = contentItems
    .map(
      (c) =>
        `<li>${escapeHtml(c.title)} — ${escapeHtml(c.authorName)}</li>`,
    )
    .join('');

  return `<ul>${items}</ul>`;
}

/**
 * Compose the final email content by replacing template variables.
 * Uses the shared replaceVariables function from email/templates.
 */
export function composeDigestEmail(
  template: { subject: string; body: string },
  variables: {
    nickname: string;
    productList: string;
    contentList: string;
    weekStart: string;
    weekEnd: string;
  },
): DigestEmailContent {
  const vars: Record<string, string> = {
    nickname: variables.nickname,
    productList: variables.productList,
    contentList: variables.contentList,
    weekStart: variables.weekStart,
    weekEnd: variables.weekEnd,
  };

  return {
    subject: replaceVariables(template.subject, vars),
    htmlBody: replaceVariables(template.body, vars),
  };
}

/**
 * Determine if digest should be skipped (both lists empty).
 * Returns true iff both lists have length zero.
 */
export function shouldSkipDigest(
  products: DigestProduct[],
  contentItems: DigestContentItem[],
): boolean {
  return products.length === 0 && contentItems.length === 0;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Escape HTML special characters to prevent XSS in email content.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
