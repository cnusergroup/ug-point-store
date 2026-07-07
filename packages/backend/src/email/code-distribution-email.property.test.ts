import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { EmailLocale } from './send';

// ============================================================
// Mock the SES-backed send module so we can capture the rendered
// subject/body that sendCodeDistributionEmail produces, without
// performing any real network calls.
// ============================================================
vi.mock('./send', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendBulkEmail: vi.fn().mockResolvedValue({
    totalBatches: 0,
    successCount: 0,
    failureCount: 0,
    errors: [],
  }),
}));

import { sendCodeDistributionEmail } from './notifications';
import type { NotificationContext } from './notifications';
import { resendCodeEmail } from '../admin/codes-distribution';
import { sendEmail } from './send';

const mockedSendEmail = vi.mocked(sendEmail);

// ============================================================
// Constants / fixtures
// ============================================================

const USERS_TABLE = 'test-users';
const TEMPLATES_TABLE = 'test-email-templates';
const CODES_TABLE = 'test-codes';
const PRODUCTS_TABLE = 'test-products';
const TEST_USER_ID = 'user-1';

// The provided template variables for codeDistribution emails. After rendering,
// none of these placeholders should remain in the body.
const PROVIDED_VARIABLES = ['nickname', 'codeList', 'productNames', 'codeCount', 'storeUrl'];

/**
 * A fully-featured configured codeDistribution template that exercises every
 * provided variable, including an anchor whose href is the {{storeUrl}}.
 */
function configuredTemplate(locale: EmailLocale) {
  return {
    templateId: 'codeDistribution',
    locale,
    subject: '🎁 你有 {{codeCount}} 个兑换码 {{nickname}}',
    body: [
      '<div>',
      '<h2>Hi {{nickname}}</h2>',
      '<p>你收到了 {{codeCount}} 个兑换码</p>',
      '<p>候选商品：{{productNames}}</p>',
      '<div style="font-family:monospace;">{{codeList}}</div>',
      '<p style="text-align:center;"><a href="{{storeUrl}}" style="display:inline-block;padding:10px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;">前往积分兑换广场</a></p>',
      '</div>',
    ].join('\n'),
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
}

/**
 * Build a NotificationContext whose dynamo client returns a user (with email)
 * for GetCommand against the users table, and a (possibly absent) template for
 * GetCommand against the templates table.
 *
 * @param templateItem  The Item returned for template lookups. When undefined,
 *                       getTemplate returns null and the system default kicks in.
 */
function createMockContext(
  templateItem: Record<string, unknown> | undefined,
  locale: EmailLocale = 'zh',
): NotificationContext & { senderEmail: string } {
  const dynamoClient = {
    send: vi.fn(async (command: { input?: { TableName?: string } }) => {
      const tableName = command?.input?.TableName;
      if (tableName === USERS_TABLE) {
        return {
          Item: {
            userId: TEST_USER_ID,
            email: 'recipient@example.com',
            nickname: '小测',
            locale,
          },
        };
      }
      if (tableName === TEMPLATES_TABLE) {
        return templateItem ? { Item: templateItem } : {};
      }
      return {};
    }),
  };

  return {
    sesClient: { send: vi.fn().mockResolvedValue({}) } as never,
    dynamoClient: dynamoClient as never,
    emailTemplatesTable: TEMPLATES_TABLE,
    usersTable: USERS_TABLE,
    senderEmail: 'store@example.com',
  };
}

/** Read the htmlBody/subject captured by the most recent sendEmail call. */
function lastSentEmail(): { to: string; subject: string; htmlBody: string } {
  const calls = mockedSendEmail.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  // sendEmail(sesClient, { to, subject, htmlBody }, senderEmail)
  return calls[calls.length - 1][1] as { to: string; subject: string; htmlBody: string };
}

// ============================================================
// Generators
// ============================================================

/** Distinct, easy-to-locate redemption code values (uppercase alnum). */
const codeValuesArb = fc.uniqueArray(
  fc.string({ unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split('')), minLength: 4, maxLength: 12 }),
  { minLength: 1, maxLength: 8 },
).filter((codes) => codes.every((c) => c.length >= 4));

/** Candidate product names (non-empty, no HTML-breaking characters). */
const productNamesArb = fc.array(
  fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz 商品周边贴纸".split('')), minLength: 1, maxLength: 16 })
    .map((s) => s.trim() || 'Item')
    .map((s) => s.replace(/[<>"&]/g, '')),
  { minLength: 1, maxLength: 5 },
);

/** A store URL composed of safe characters (no quotes/braces). */
const storeUrlArb = fc
  .string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-/".split('')), minLength: 0, maxLength: 24 })
  .map((path) => `https://store.example.com/${path}`);

// ============================================================
// Property 13: 分发邮件包含本人全部码且含商城链接
// ============================================================

describe('Feature: code-user-email-distribution, Property 13: 分发邮件包含本人全部码且含商城链接', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.3, 7.3, 7.5**
   *
   * For any recipient with a valid email and any set of allocated code values +
   * storeUrl, the rendered distribution email body SHALL contain every one of
   * that user's allocated code values, SHALL contain an anchor whose href is the
   * storeUrl, and SHALL NOT leave any provided-variable `{{placeholder}}` behind.
   */
  beforeEach(() => {
    mockedSendEmail.mockClear();
    mockedSendEmail.mockResolvedValue(undefined);
  });

  it('renders all codes, a storeUrl link, and no leftover placeholders', async () => {
    await fc.assert(
      fc.asyncProperty(
        codeValuesArb,
        productNamesArb,
        storeUrlArb,
        async (codeValues, productNames, storeUrl) => {
          mockedSendEmail.mockClear();

          const ctx = createMockContext(configuredTemplate('zh'), 'zh');

          const result = await sendCodeDistributionEmail(
            ctx,
            TEST_USER_ID,
            codeValues,
            productNames,
            storeUrl,
          );

          expect(result.status).toBe('sent');

          const { htmlBody } = lastSentEmail();

          // (1) Every allocated code value appears in the rendered body.
          for (const code of codeValues) {
            expect(htmlBody).toContain(code);
          }

          // (2) An anchor whose href is exactly the storeUrl exists.
          expect(htmlBody).toContain(`href="${storeUrl}"`);

          // (3) No provided-variable placeholder remains unrendered.
          for (const name of PROVIDED_VARIABLES) {
            expect(htmlBody.includes(`{{${name}}}`)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Task 7.3 — Template fallback example (EDGE_CASE)
// Validates: Requirements 7.6
// ============================================================

describe('codeDistribution template fallback (Validates: Requirements 7.6)', () => {
  beforeEach(() => {
    mockedSendEmail.mockClear();
    mockedSendEmail.mockResolvedValue(undefined);
  });

  it('uses the system default template (with a store link) when no template is configured', async () => {
    // No template configured: getTemplate returns null for every locale, so
    // sendCodeDistributionEmail falls back to the built-in system default.
    const ctx = createMockContext(undefined, 'zh');

    const codeValues = ['ABCD1234', 'WXYZ5678'];
    const productNames = ['限定贴纸', '社区周边'];
    const storeUrl = 'https://store.awscommunity.cn';

    const result = await sendCodeDistributionEmail(
      ctx,
      TEST_USER_ID,
      codeValues,
      productNames,
      storeUrl,
    );

    expect(result.status).toBe('sent');

    const { htmlBody } = lastSentEmail();

    // The default template body must carry the mall link (store CTA button).
    expect(htmlBody).toContain(`href="${storeUrl}"`);

    // The user's codes must all appear.
    for (const code of codeValues) {
      expect(htmlBody).toContain(code);
    }

    // No provided-variable placeholder should remain unrendered.
    for (const name of PROVIDED_VARIABLES) {
      expect(htmlBody.includes(`{{${name}}}`)).toBe(false);
    }
  });
});

// ============================================================
// Property 14: 收件人隔离 (Recipient isolation)
// ============================================================

/**
 * Build a NotificationContext whose users table resolves DIFFERENT user records
 * keyed by the requested `userId`, so we can verify per-recipient isolation.
 * The codeDistribution template is always configured (renders every variable).
 */
function createMultiUserMockContext(
  users: Record<string, { email: string; nickname: string; locale?: EmailLocale }>,
): NotificationContext & { senderEmail: string } {
  const dynamoClient = {
    send: vi.fn(async (command: { input?: { TableName?: string; Key?: { userId?: string } } }) => {
      const tableName = command?.input?.TableName;
      if (tableName === USERS_TABLE) {
        const uid = command?.input?.Key?.userId;
        const u = uid ? users[uid] : undefined;
        if (!u) return {};
        return { Item: { userId: uid, email: u.email, nickname: u.nickname, locale: u.locale ?? 'zh' } };
      }
      if (tableName === TEMPLATES_TABLE) {
        return { Item: configuredTemplate('zh') };
      }
      return {};
    }),
  };

  return {
    sesClient: { send: vi.fn().mockResolvedValue({}) } as never,
    dynamoClient: dynamoClient as never,
    emailTemplatesTable: TEMPLATES_TABLE,
    usersTable: USERS_TABLE,
    senderEmail: 'store@example.com',
  };
}

/** Locate a captured sendEmail call by its recipient address. */
function sentEmailTo(to: string): { to: string; subject: string; htmlBody: string } | undefined {
  return mockedSendEmail.mock.calls
    .map((call) => call[1] as { to: string; subject: string; htmlBody: string })
    .find((e) => e.to === to);
}

/**
 * Fixed-length (10-char) uppercase alnum code values. Equal-length uniqueness
 * guarantees no code is a substring of another, so a "contains" check cannot be
 * fooled by accidental overlap between A's and B's codes.
 */
const fixedLenCodeArb = fc.string({
  unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  minLength: 10,
  maxLength: 10,
});

/**
 * Two disjoint, non-empty code sets (one for user A, one for user B). Built by
 * splitting a single unique array, so the two sets share no element and — thanks
 * to fixed length — no element of one is a substring of an element of the other.
 */
const twoUserCodeSetsArb = fc
  .uniqueArray(fixedLenCodeArb, { minLength: 2, maxLength: 12 })
  .chain((codes) =>
    fc.integer({ min: 1, max: codes.length - 1 }).map((splitAt) => ({
      codesA: codes.slice(0, splitAt),
      codesB: codes.slice(splitAt),
    })),
  );

describe('Feature: code-user-email-distribution, Property 14: 收件人隔离', () => {
  beforeEach(() => {
    mockedSendEmail.mockClear();
    mockedSendEmail.mockResolvedValue(undefined);
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * For any two distinct recipients A and B with disjoint allocated code sets,
   * the email sent to A SHALL contain only A's code values (and none of B's),
   * and the email sent to B SHALL contain only B's code values (and none of A's).
   */
  it('sends each recipient only their own allocated codes, never another user\'s', async () => {
    await fc.assert(
      fc.asyncProperty(twoUserCodeSetsArb, productNamesArb, storeUrlArb, async ({ codesA, codesB }, productNames, storeUrl) => {
        mockedSendEmail.mockClear();

        const userAId = 'user-A';
        const userBId = 'user-B';
        const emailA = 'a@example.com';
        const emailB = 'b@example.com';

        const ctx = createMultiUserMockContext({
          [userAId]: { email: emailA, nickname: 'Alice' },
          [userBId]: { email: emailB, nickname: 'Bob' },
        });

        const resA = await sendCodeDistributionEmail(ctx, userAId, codesA, productNames, storeUrl);
        const resB = await sendCodeDistributionEmail(ctx, userBId, codesB, productNames, storeUrl);

        expect(resA.status).toBe('sent');
        expect(resB.status).toBe('sent');

        const mailA = sentEmailTo(emailA);
        const mailB = sentEmailTo(emailB);
        expect(mailA).toBeDefined();
        expect(mailB).toBeDefined();

        // A's email: contains all of A's codes, none of B's.
        for (const code of codesA) {
          expect(mailA!.htmlBody).toContain(code);
          expect(mailB!.htmlBody.includes(code)).toBe(false);
        }
        // B's email: contains all of B's codes, none of A's.
        for (const code of codesB) {
          expect(mailB!.htmlBody).toContain(code);
          expect(mailA!.htmlBody.includes(code)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 14 (resend): 重发仅发送给码持久化的 allocatedUserId
// ============================================================

/**
 * Build resend dependencies whose code record carries a given `allocatedUserId`
 * and `codeValue`. The users table derives a unique email per requested userId
 * (`{userId}@example.com`), so we can assert the resend goes only to the code's
 * persisted recipient. Commands are distinguished by their class name so that
 * GetCommand and UpdateCommand on the codes table are handled separately.
 */
function createResendDeps(opts: {
  codeValue: string;
  allocatedUserId: string;
  productIds: string[];
}) {
  const { codeValue, allocatedUserId, productIds } = opts;
  const dynamoClient = {
    send: vi.fn(async (command: {
      constructor: { name: string };
      input?: {
        TableName?: string;
        Key?: { userId?: string };
        RequestItems?: Record<string, { Keys: { productId: string }[] }>;
      };
    }) => {
      const name = command.constructor?.name;
      const tableName = command?.input?.TableName;

      if (name === 'GetCommand' && tableName === CODES_TABLE) {
        return {
          Item: {
            codeId: 'code-1',
            codeValue,
            type: 'product',
            maxUses: 1,
            currentUses: 0,
            status: 'active',
            productIds,
            allocatedUserId,
            batchId: 'batch-1',
            usedBy: {},
            createdAt: new Date().toISOString(),
          },
        };
      }
      if (name === 'GetCommand' && tableName === USERS_TABLE) {
        const uid = command?.input?.Key?.userId ?? 'unknown';
        return { Item: { userId: uid, email: `${uid}@example.com`, nickname: `u-${uid}`, locale: 'zh' } };
      }
      if (name === 'GetCommand' && tableName === TEMPLATES_TABLE) {
        return { Item: configuredTemplate('zh') };
      }
      if (name === 'BatchGetCommand') {
        const keys = command?.input?.RequestItems?.[PRODUCTS_TABLE]?.Keys ?? [];
        return {
          Responses: {
            [PRODUCTS_TABLE]: keys.map((k) => ({ productId: k.productId, name: `P-${k.productId}` })),
          },
        };
      }
      if (name === 'UpdateCommand') {
        return {};
      }
      return {};
    }),
  };

  return {
    dynamoClient: dynamoClient as never,
    sesClient: { send: vi.fn().mockResolvedValue({}) } as never,
    codesTable: CODES_TABLE,
    productsTable: PRODUCTS_TABLE,
    usersTable: USERS_TABLE,
    emailTemplatesTable: TEMPLATES_TABLE,
    senderEmail: 'store@example.com',
  };
}

/** userId fragments: lowercase alnum, distinct enough to derive unique emails. */
const userIdArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  minLength: 3,
  maxLength: 12,
});

const productIdsArb = fc.uniqueArray(
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 3, maxLength: 10 }),
  { minLength: 1, maxLength: 5 },
);

describe('Feature: code-user-email-distribution, Property 14: 重发仅发送给码持久化的 allocatedUserId', () => {
  beforeEach(() => {
    mockedSendEmail.mockClear();
    mockedSendEmail.mockResolvedValue(undefined);
  });

  /**
   * **Validates: Requirements 9.3, 9.6**
   *
   * For any code with a persisted `allocatedUserId`, `resendCodeEmail` SHALL send
   * exactly one email, addressed ONLY to that allocated user — never to anyone
   * else — and that email SHALL contain the code's value.
   */
  it('resends to exactly the code\'s persisted allocatedUserId and no one else', async () => {
    await fc.assert(
      fc.asyncProperty(fixedLenCodeArb, userIdArb, productIdsArb, async (codeValue, allocatedUserId, productIds) => {
        mockedSendEmail.mockClear();

        const deps = createResendDeps({ codeValue, allocatedUserId, productIds });

        const result = await resendCodeEmail('code-1', deps);

        expect(result.success).toBe(true);

        // Exactly one email was sent (no fan-out to other users).
        expect(mockedSendEmail.mock.calls.length).toBe(1);

        const sent = mockedSendEmail.mock.calls[0][1] as { to: string; htmlBody: string };

        // It went only to the persisted allocatedUserId's address.
        expect(sent.to).toBe(`${allocatedUserId}@example.com`);

        // And it contains the code's value.
        expect(sent.htmlBody).toContain(codeValue);
      }),
      { numRuns: 100 },
    );
  });
});
