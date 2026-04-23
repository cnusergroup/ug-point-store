import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getDigestVariant,
  formatProductList,
  formatContentList,
  composeDigestEmail,
  shouldSkipDigest,
} from './compose';
import type { DigestSubscriber, DigestProduct, DigestContentItem } from './query';
import type { EmailLocale } from '../email/send';

// ============================================================
// Arbitraries
// ============================================================

const VALID_LOCALES: EmailLocale[] = ['zh', 'en', 'ja', 'ko', 'zh-TW'];

const localeArb = fc.constantFrom<EmailLocale>(...VALID_LOCALES);

/** Generate a subscriber with at least one subscription enabled */
const subscriberArb: fc.Arbitrary<DigestSubscriber> = fc
  .record({
    email: fc.emailAddress(),
    nickname: fc.string({ minLength: 0, maxLength: 20 }),
    locale: localeArb,
    wantsProducts: fc.boolean(),
    wantsContent: fc.boolean(),
  })
  .filter((s) => s.wantsProducts || s.wantsContent);

/** Generate a random ISO datetime string within a reasonable range */
const isoDateArb = fc
  .integer({ min: 0, max: 365 * 3 })
  .chain((dayOffset) =>
    fc.integer({ min: 0, max: 86399 }).map((secondOffset) => {
      const d = new Date(2022, 0, 1);
      d.setDate(d.getDate() + dayOffset);
      d.setSeconds(d.getSeconds() + secondOffset);
      return d.toISOString();
    }),
  );

/** Generate a product record */
const productArb: fc.Arbitrary<DigestProduct> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }),
  pointsCost: fc.integer({ min: 0, max: 10000 }),
  createdAt: isoDateArb,
});

/** Generate a content item record */
const contentItemArb: fc.Arbitrary<DigestContentItem> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 60 }),
  authorName: fc.string({ minLength: 1, maxLength: 20 }),
  createdAt: isoDateArb,
});

/** Generate a non-empty string that does not contain {{ or }} */
const safeNonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !s.includes('{{') && !s.includes('}}'));

// ============================================================
// Property 6: Per-user content personalization
// Feature: weekly-digest-email, Property 6: Per-user content personalization
// **Validates: Requirements 5.2, 5.3, 5.4**
// ============================================================

describe('Feature: weekly-digest-email, Property 6: Per-user content personalization', () => {
  it('getDigestVariant returns correct variant based on wantsProducts/wantsContent', () => {
    fc.assert(
      fc.property(subscriberArb, (subscriber) => {
        const variant = getDigestVariant(subscriber);

        if (subscriber.wantsProducts && subscriber.wantsContent) {
          expect(variant).toBe('both');
        } else if (subscriber.wantsProducts && !subscriber.wantsContent) {
          expect(variant).toBe('productsOnly');
        } else if (!subscriber.wantsProducts && subscriber.wantsContent) {
          expect(variant).toBe('contentOnly');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('getDigestVariant always returns one of the three valid variants', () => {
    fc.assert(
      fc.property(subscriberArb, (subscriber) => {
        const variant = getDigestVariant(subscriber);
        expect(['both', 'productsOnly', 'contentOnly']).toContain(variant);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: Empty list fallback messages
// Feature: weekly-digest-email, Property 7: Empty list fallback messages
// **Validates: Requirements 6.6, 6.7**
// ============================================================

describe('Feature: weekly-digest-email, Property 7: Empty list fallback messages', () => {
  it('formatProductList with empty array returns non-empty fallback string for any locale', () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const result = formatProductList([], locale);
        expect(result.length).toBeGreaterThan(0);
        expect(typeof result).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('formatContentList with empty array returns non-empty fallback string for any locale', () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const result = formatContentList([], locale);
        expect(result.length).toBeGreaterThan(0);
        expect(typeof result).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('formatProductList with non-empty array returns HTML containing product info', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 1, maxLength: 10 }),
        localeArb,
        (products, locale) => {
          const result = formatProductList(products, locale);
          expect(result).toContain('<ul>');
          expect(result).toContain('<li>');
          expect(result).toContain('</ul>');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('formatContentList with non-empty array returns HTML containing content info', () => {
    fc.assert(
      fc.property(
        fc.array(contentItemArb, { minLength: 1, maxLength: 10 }),
        localeArb,
        (contentItems, locale) => {
          const result = formatContentList(contentItems, locale);
          expect(result).toContain('<ul>');
          expect(result).toContain('<li>');
          expect(result).toContain('</ul>');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 8: Template variable replacement completeness
// Feature: weekly-digest-email, Property 8: Template variable replacement completeness
// **Validates: Requirements 7.3**
// ============================================================

describe('Feature: weekly-digest-email, Property 8: Template variable replacement completeness', () => {
  it('composeDigestEmail with all 5 placeholders and non-empty values produces output with no remaining {{...}} patterns', () => {
    fc.assert(
      fc.property(
        safeNonEmptyStringArb, // nickname
        safeNonEmptyStringArb, // productList
        safeNonEmptyStringArb, // contentList
        safeNonEmptyStringArb, // weekStart
        safeNonEmptyStringArb, // weekEnd
        (nickname, productList, contentList, weekStart, weekEnd) => {
          const template = {
            subject: 'Hello {{nickname}}, digest for {{weekStart}} - {{weekEnd}}',
            body: '<h1>Hi {{nickname}}</h1><div>{{productList}}</div><div>{{contentList}}</div><p>{{weekStart}} to {{weekEnd}}</p>',
          };

          const result = composeDigestEmail(template, {
            nickname,
            productList,
            contentList,
            weekStart,
            weekEnd,
          });

          // No remaining {{...}} patterns in subject or body
          expect(result.subject).not.toMatch(/\{\{[^}]+\}\}/);
          expect(result.htmlBody).not.toMatch(/\{\{[^}]+\}\}/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('composeDigestEmail replaces all known variables with their provided values', () => {
    fc.assert(
      fc.property(
        safeNonEmptyStringArb,
        safeNonEmptyStringArb,
        safeNonEmptyStringArb,
        safeNonEmptyStringArb,
        safeNonEmptyStringArb,
        (nickname, productList, contentList, weekStart, weekEnd) => {
          const template = {
            subject: '{{nickname}}',
            body: '{{nickname}}|{{productList}}|{{contentList}}|{{weekStart}}|{{weekEnd}}',
          };

          const result = composeDigestEmail(template, {
            nickname,
            productList,
            contentList,
            weekStart,
            weekEnd,
          });

          expect(result.subject).toBe(nickname);
          expect(result.htmlBody).toBe(
            `${nickname}|${productList}|${contentList}|${weekStart}|${weekEnd}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
