import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderCredentialPage, generateQrSvg } from './render';
import { formatCredentialId, type CredentialIdComponents } from './credential-id';
import { SOURCE_ROLE_CODES, type Credential, type SourceRole } from './types';

// Feature: credential-self-application, Property 9: 自助证书公开页面渲染完整性
//
// For any self-applied credential, renderCredentialPage returns HTML that
// simultaneously contains the recipient name, the credential identity
// (identityText), the event name, the issue date, the credential ID, the
// issuing organization, a QR code encoding the full page URL
// (baseUrl + '/c/' + credentialId), and the five OG meta tags (og:title,
// og:description, og:url, og:type, og:image). All fixed copy is rendered in
// English because self-applied credentials use locale = 'en'. When the
// credential status is 'revoked', the HTML contains the revocation marker and
// does NOT contain the "Add to LinkedIn" button.
//
// Validates: Requirements 7.2, 7.4, 7.7

// ── Generators ──────────────────────────────────────────────────────────────

// Alphabet that survives HTML escaping unchanged (no & < > " ') so that the
// generated values appear verbatim in the rendered HTML. The first character is
// always alphanumeric to guarantee a meaningful, non-empty, findable substring.
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SAFE_EXTRA = ' .,_()';
const alnumCharArb = fc.constantFrom(...ALNUM.split(''));
const safeCharArb = fc.constantFrom(...(ALNUM + SAFE_EXTRA).split(''));

/** Safe text of length [min, max] with no HTML-special characters. */
function safeTextArb(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .tuple(alnumCharArb, fc.array(safeCharArb, { minLength: min - 1, maxLength: max - 1 }))
    .map(([head, rest]) => head + rest.join(''));
}

/** issueDate matching ^\d{4}-\d{2}-\d{2}$ (days capped at 28 to stay valid). */
const issueDateArb = fc
  .record({
    y: fc.integer({ min: 2000, max: 2099 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, m, d }) =>
      `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

/** A realistic, escaping-safe credential ID for a self-applied credential. */
const eventPrefixArb = fc
  .array(fc.stringMatching(/^[A-Z]{1,6}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('-'));

const sourceRoleArb = fc.constantFrom<SourceRole>('Speaker', 'UserGroupLeader', 'Volunteer');

/** Base URL with no HTML-special characters. */
const baseUrlArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 3,
    maxLength: 20,
  })
  .map((a) => `https://${a.join('')}.example.com`);

interface SelfAppliedCase {
  credential: Credential;
  baseUrl: string;
}

const selfAppliedCaseArb: fc.Arbitrary<SelfAppliedCase> = fc
  .record({
    eventPrefix: eventPrefixArb,
    year: fc.integer({ min: 2000, max: 2099 }).map((n) => String(n).padStart(4, '0')),
    season: fc.constantFrom('Spring', 'Summer', 'Fall', 'Winter'),
    sequence: fc.integer({ min: 1, max: 9999 }),
    sourceRole: sourceRoleArb,
    recipientName: safeTextArb(1, 100),
    eventName: safeTextArb(1, 200),
    identityText: safeTextArb(1, 100),
    issuingOrganization: safeTextArb(1, 200),
    issueDate: issueDateArb,
    appliedByUserId: safeTextArb(1, 40),
    sourceActivityId: safeTextArb(1, 40),
    status: fc.constantFrom<'active' | 'revoked'>('active', 'revoked'),
    baseUrl: baseUrlArb,
  })
  .map((g) => {
    const components: CredentialIdComponents = {
      eventPrefix: g.eventPrefix,
      year: g.year,
      season: g.season,
      roleCode: SOURCE_ROLE_CODES[g.sourceRole],
      sequence: g.sequence,
    };
    const credentialId = formatCredentialId(components);
    const credential: Credential = {
      credentialId,
      recipientName: g.recipientName,
      eventName: g.eventName,
      role: g.sourceRole,
      issueDate: g.issueDate,
      issuingOrganization: g.issuingOrganization,
      status: g.status,
      locale: 'en',
      createdAt: `${g.issueDate}T00:00:00.000Z`,
      // Self-applied identity fields
      identityText: g.identityText,
      appliedByUserId: g.appliedByUserId,
      sourceActivityId: g.sourceActivityId,
      sourceRole: g.sourceRole,
      appliedDedupeKey: `${g.appliedByUserId}#${g.sourceActivityId}#${g.sourceRole}`,
    };
    return { credential, baseUrl: g.baseUrl };
  });

// ── Property ──────────────────────────────────────────────────────────────

describe('Property 9: 自助证书公开页面渲染完整性', () => {
  it('renders all required self-applied credential elements in English, with QR + OG tags, and correct revoked behaviour', async () => {
    await fc.assert(
      fc.asyncProperty(selfAppliedCaseArb, async ({ credential, baseUrl }) => {
        const html = await renderCredentialPage({ credential, baseUrl });
        const fullUrl = `${baseUrl}/c/${credential.credentialId}`;

        // ── Always-present core content ──
        expect(html).toContain(credential.recipientName); // 收件人姓名
        expect(html).toContain(credential.identityText!); // 证书身份 (identityText)
        expect(html).toContain(credential.eventName); // 活动名称
        expect(html).toContain(credential.issueDate); // 签发日期
        expect(html).toContain(credential.credentialId); // 凭证 ID
        expect(html).toContain(credential.issuingOrganization); // 签发组织

        // The full page URL is always embedded (og:url for every credential).
        expect(html).toContain(fullUrl);

        // ── Five OG meta tags ──
        expect(html).toContain('property="og:title"');
        expect(html).toContain('property="og:description"');
        expect(html).toContain('property="og:url"');
        expect(html).toContain('property="og:type"');
        expect(html).toContain('property="og:image"');
        // og:url content is exactly the full credential page URL.
        expect(html).toContain(`<meta property="og:url" content="${fullUrl}">`);

        // ── English fixed copy (locale = 'en') ──
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('Issue Date');
        expect(html).toContain('Issuing Organization');
        expect(html).toContain('Credential ID');
        // No Chinese fixed copy leaks through (generated values are ASCII-only).
        expect(html).not.toContain('签发日期');
        expect(html).not.toContain('签发组织');
        expect(html).not.toContain('凭证 ID');

        if (credential.status === 'revoked') {
          // 撤销标记：撤销角标 + 英文撤销提示
          expect(html).toContain('revoked-banner');
          expect(html).toContain('This credential has been revoked');
          expect(html).toContain('Credential Revoked');
          // 无「Add to LinkedIn」按钮（CSS 中的 .linkedin-btn 选择器不计）
          expect(html).not.toContain('linkedin.com/profile/add');
          expect(html).not.toContain('class="linkedin-btn"');
        } else {
          // Active: QR code panel encodes exactly the full page URL.
          const expectedQr = await generateQrSvg(fullUrl);
          expect(html).toContain('qr-box');
          expect(html).toContain(expectedQr);
          // Active credentials expose the "Add to LinkedIn" action.
          expect(html).toContain('class="linkedin-btn"');
          expect(html).toContain('linkedin.com/profile/add');
          expect(html).toContain('Add to LinkedIn');
        }
      }),
      { numRuns: 100 },
    );
  });
});
