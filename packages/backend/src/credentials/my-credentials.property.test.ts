import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getMyCredentials, type MyCredentialsTables } from './my-credentials';
import type { Credential, CredentialStatus, CredentialRole, SourceRole } from './types';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Feature: credential-self-application, Property 13: 我的证书查询完整性与排序
//
// For any set of credentials owned by various users (each either a self-applied
// credential — i.e. carrying `appliedByUserId` — or a batch-imported credential
// without it), the "我的证书" query `getMyCredentials(userId, ...)` returns a
// list that is EXACTLY the set of self-applied credentials whose
// `appliedByUserId` equals the queried `userId` (no more, no fewer), including
// BOTH `active` and `revoked` statuses, sorted by `issueDate` descending. Each
// returned item exposes `url === baseUrl + '/c/' + credentialId`, and the
// source type is correctly determined as self-applied by the presence of
// `appliedByUserId` (batch-imported credentials, which lack the GSI partition
// key, never appear).
//
// Validates: Requirements 8.2, 10.3

const CREDENTIALS_TABLE = 'PointsMall-Credentials';
const APPLIED_BY_USER_ID_INDEX = 'appliedByUserId-index';

const tables: MyCredentialsTables = { credentialsTable: CREDENTIALS_TABLE };

/**
 * Build an in-memory fake DynamoDBDocumentClient that mimics the
 * `appliedByUserId-index` GSI semantics: a `QueryCommand` keyed on
 * `appliedByUserId = :uid` returns only the items whose `appliedByUserId`
 * attribute is PRESENT and equals `:uid`. Items missing that attribute (i.e.
 * batch-imported credentials) are not projected into the index and therefore
 * never returned — exactly as real DynamoDB behaves. All matching items are
 * returned in a single page (no pagination).
 */
function createFakeDynamoClient(store: Credential[]): DynamoDBDocumentClient {
  const client = {
    send: vi.fn((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const cmdName = cmd?.constructor?.name;
      if (cmdName !== 'QueryCommand') {
        return Promise.reject(new Error(`Unexpected command: ${cmdName}`));
      }
      const input = cmd.input as {
        TableName?: string;
        IndexName?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
      // Sanity: the query must target the Credentials table + GSI.
      expect(input.TableName).toBe(CREDENTIALS_TABLE);
      expect(input.IndexName).toBe(APPLIED_BY_USER_ID_INDEX);

      const uid = input.ExpressionAttributeValues?.[':uid'];
      const matching = store.filter(
        (c) => c.appliedByUserId !== undefined && c.appliedByUserId === uid,
      );
      return Promise.resolve({ Items: matching });
    }),
  };
  return client as unknown as DynamoDBDocumentClient;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// An `issueDate` as `YYYY-MM-DD`. Lexicographic order on this format coincides
// with chronological order, which `getMyCredentials` relies on for sorting.
const issueDateArb = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${pad2(m)}-${pad2(d)}`);

const statusArb = fc.constantFrom<CredentialStatus>('active', 'revoked');

const roleArb = fc.constantFrom<CredentialRole | SourceRole>(
  'Volunteer',
  'Speaker',
  'Workshop',
  'Organizer',
  'UserGroupLeader',
);

// `identityText` may be absent, blank (whitespace), or a real value — exercising
// the resolveIdentityText fallback to `role`.
const identityTextArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('', '   '),
  fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
);

// Owner of a credential, expressed relative to the queried user:
//  - 'SELF'    → belongs to the queried user (self-applied)
//  - 'OTHER_A' → another user's self-applied credential
//  - 'OTHER_B' → yet another user's self-applied credential
//  - 'BATCH'   → batch-imported (no appliedByUserId)
const ownerTagArb = fc.constantFrom('SELF', 'OTHER_A', 'OTHER_B', 'BATCH');

interface RecordSpec {
  ownerTag: 'SELF' | 'OTHER_A' | 'OTHER_B' | 'BATCH';
  issueDate: string;
  status: CredentialStatus;
  role: CredentialRole | SourceRole;
  identityText?: string;
  eventName: string;
}

const recordSpecArb: fc.Arbitrary<RecordSpec> = fc.record({
  ownerTag: ownerTagArb,
  issueDate: issueDateArb,
  status: statusArb,
  role: roleArb,
  identityText: identityTextArb,
  eventName: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
});

// A non-empty queried userId; other owners are derived from it so they are
// guaranteed distinct from the queried user.
const userIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

const baseUrlArb = fc.constantFrom(
  'https://creds.awscommunity.cn',
  'https://example.com/base',
  '',
);

/** Resolve the display identity the same way the implementation does. */
function expectedIdentityText(cred: Credential): string {
  if (cred.identityText && cred.identityText.trim().length > 0) {
    return cred.identityText;
  }
  return (cred.role as string) ?? '';
}

/** Turn record specs into concrete Credential rows with unique ids + owners. */
function buildStore(userId: string, specs: RecordSpec[]): Credential[] {
  return specs.map((spec, i) => {
    let appliedByUserId: string | undefined;
    switch (spec.ownerTag) {
      case 'SELF':
        appliedByUserId = userId;
        break;
      case 'OTHER_A':
        appliedByUserId = `${userId}#other-a`;
        break;
      case 'OTHER_B':
        appliedByUserId = `${userId}#other-b`;
        break;
      case 'BATCH':
        appliedByUserId = undefined;
        break;
    }
    const cred: Credential = {
      credentialId: `cred-${i}`,
      recipientName: `Recipient ${i}`,
      eventName: spec.eventName,
      role: spec.role,
      issueDate: spec.issueDate,
      issuingOrganization: 'AWS User Group China',
      status: spec.status,
      locale: 'en',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    if (spec.identityText !== undefined) cred.identityText = spec.identityText;
    if (appliedByUserId !== undefined) {
      cred.appliedByUserId = appliedByUserId;
      cred.sourceActivityId = `act-${i}`;
      cred.sourceRole = 'Speaker';
    }
    return cred;
  });
}

describe('Property 13: 我的证书查询完整性与排序', () => {
  it('returns exactly the user\'s self-applied credentials (both states), sorted by issueDate desc, with correct url and source type', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(recordSpecArb, { maxLength: 30 }),
        baseUrlArb,
        async (userId, specs, baseUrl) => {
          const store = buildStore(userId, specs);
          const client = createFakeDynamoClient(store);

          const { items } = await getMyCredentials(userId, client, tables, baseUrl);

          // The exact set of credentials that SHOULD be returned: every credential
          // whose appliedByUserId === userId (self-applied), regardless of status.
          const expected = store.filter((c) => c.appliedByUserId === userId);
          const expectedById = new Map(expected.map((c) => [c.credentialId, c]));

          // (1) Completeness + exactness: returned ids === expected ids (no more, no fewer).
          const returnedIds = items.map((it) => it.credentialId).sort();
          const expectedIds = expected.map((c) => c.credentialId).sort();
          expect(returnedIds).toEqual(expectedIds);

          // (2) Source type: every returned id corresponds to a self-applied
          // credential (appliedByUserId present); no batch-imported credential
          // (appliedByUserId absent) ever appears.
          for (const it of items) {
            const src = expectedById.get(it.credentialId);
            expect(src).toBeDefined();
            expect(src!.appliedByUserId).toBeDefined();
            expect(src!.appliedByUserId).toBe(userId);
          }

          // (3) Both active and revoked are included — when the user owns
          // credentials of a given status, every one of them appears.
          const returnedSet = new Set(items.map((it) => it.credentialId));
          for (const c of expected) {
            expect(returnedSet.has(c.credentialId)).toBe(true);
          }

          // (4) Sorted by issueDate descending (lexicographic == chronological
          // for YYYY-MM-DD).
          for (let i = 0; i + 1 < items.length; i++) {
            expect(items[i].issueDate.localeCompare(items[i + 1].issueDate)).toBeGreaterThanOrEqual(0);
          }

          // (5) Each item carries the correct public URL and faithfully mirrors
          // its source credential's fields.
          for (const it of items) {
            const src = expectedById.get(it.credentialId)!;
            expect(it.url).toBe(`${baseUrl}/c/${it.credentialId}`);
            expect(it.status).toBe(src.status);
            expect(it.eventName).toBe(src.eventName);
            expect(it.issueDate).toBe(src.issueDate);
            expect(it.identityText).toBe(expectedIdentityText(src));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
