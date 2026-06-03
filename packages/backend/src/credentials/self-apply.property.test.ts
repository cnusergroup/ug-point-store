import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  applyForCredential,
  validateRecipientName,
  type ApplyInput,
  type SelfApplyTables,
} from './self-apply';
import { getMyApplications } from './eligibility';
import { getMyCredentials } from './my-credentials';
import {
  createAssociation,
  updateAssociation,
  deleteAssociation,
  type AssociationInput,
} from './association';
import { formatCredentialId } from './credential-id';
import {
  SOURCE_ROLE_CODES,
  type ActivityTemplateAssociation,
  type AllowedRoleConfig,
  type Credential,
  type Season,
  type SourceRole,
} from './types';

// Feature: credential-self-application, Property 4: 收件人姓名校验
//
// For any string, validateRecipientName judges it valid if and only if its
// trimmed length is in the range 1..100. For empty strings, whitespace-only
// strings, or strings whose trimmed length exceeds 100, it judges them invalid
// and returns a descriptive error message. Non-string inputs are also invalid.
//
// Validates: Requirements 5.2, 5.4

const RECIPIENT_NAME_MIN_LENGTH = 1;
const RECIPIENT_NAME_MAX_LENGTH = 100;

/** Whitespace characters used to pad inputs and exercise the trim logic. */
const WHITESPACE = [' ', '\t', '\n', '\r', '\f', '\v'];
const whitespaceArb = fc.string({
  minLength: 0,
  maxLength: 6,
  unit: fc.constantFrom(...WHITESPACE),
});

/**
 * Arbitrary for a "core" string that is non-empty after trimming and whose
 * trimmed length is between 1 and 100. The first and last characters are
 * non-whitespace so the trimmed length is deterministic.
 */
const validCoreArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .map((s) => s.trim())
  .filter(
    (s) =>
      s.length >= RECIPIENT_NAME_MIN_LENGTH &&
      s.length <= RECIPIENT_NAME_MAX_LENGTH,
  );

/**
 * Arbitrary for a valid recipient name: a valid core optionally padded with
 * leading/trailing whitespace. The trimmed value still has length 1..100.
 */
const validNameArb = fc
  .tuple(whitespaceArb, validCoreArb, whitespaceArb)
  .map(([lead, core, trail]) => lead + core + trail);

/** Arbitrary for whitespace-only strings (trimmed length 0). */
const whitespaceOnlyArb = fc.string({
  minLength: 1,
  maxLength: 12,
  unit: fc.constantFrom(...WHITESPACE),
});

/** Arbitrary for strings whose trimmed length exceeds 100. */
const tooLongArb = fc
  .string({ minLength: 101, maxLength: 300 })
  .filter((s) => s.trim().length > RECIPIENT_NAME_MAX_LENGTH);

/** Arbitrary for non-string inputs. */
const nonStringArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string()),
  fc.object(),
);

describe('Property 4: 收件人姓名校验', () => {
  it('去空白后长度 1–100 的字符串判定合法，且 value 等于去空白后的输入', () => {
    fc.assert(
      fc.property(validNameArb, (name) => {
        const result = validateRecipientName(name);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.value).toBe(name.trim());
          expect(result.value.length).toBeGreaterThanOrEqual(
            RECIPIENT_NAME_MIN_LENGTH,
          );
          expect(result.value.length).toBeLessThanOrEqual(
            RECIPIENT_NAME_MAX_LENGTH,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('空字符串与纯空白字符串判定非法并返回描述性错误', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(''), whitespaceOnlyArb),
        (name) => {
          const result = validateRecipientName(name);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(typeof result.message).toBe('string');
            expect(result.message.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('去空白后超过 100 个字符的字符串判定非法并返回描述性错误', () => {
    fc.assert(
      fc.property(tooLongArb, (name) => {
        const result = validateRecipientName(name);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(typeof result.message).toBe('string');
          expect(result.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('非字符串输入判定非法并返回描述性错误', () => {
    fc.assert(
      fc.property(nonStringArb, (input) => {
        const result = validateRecipientName(input);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(typeof result.message).toBe('string');
          expect(result.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('当且仅当去空白后长度在 1–100 之间时判定合法（综合不变式）', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (name) => {
        const result = validateRecipientName(name);
        const trimmedLength = name.trim().length;
        const shouldBeValid =
          trimmedLength >= RECIPIENT_NAME_MIN_LENGTH &&
          trimmedLength <= RECIPIENT_NAME_MAX_LENGTH;
        expect(result.valid).toBe(shouldBeValid);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: credential-self-application, Property 5: 自助证书生成不变式
//
// For any eligible (用户, 活动, Source_Role) triple plus a valid recipient name,
// `applyForCredential` writes a Self_Applied_Credential whose:
//   - status === 'active'
//   - locale === 'en'
//   - issueDate matches /^\d{4}-\d{2}-\d{2}$/ and equals today's date
//   - identityText === the association's allowedRoles entry whose role === sourceRole
//   - appliedByUserId / sourceActivityId / sourceRole are all non-empty and equal the input
//   - returned url === `${baseUrl}/c/${credentialId}` and credentialId === the formatted ID
//     for the association's eventPrefix/year/season + derived roleCode + allocated sequence.
// For any ineligible triple (no association, sourceRole not in allowedRoles, or no identity
// points) it returns 403 and writes NO credential. When the matching allowedRoles config is
// present but lacks an identityText/roleCode, it aborts with a descriptive error and writes
// nothing.
//
// Validates: Requirements 5.3, 5.7, 6.1, 6.5, 7.5, 7.6, 10.2

const CREDENTIALS_TABLE = 'PointsMall-Credentials';
const ASSOCIATIONS_TABLE = 'PointsMall-ActivityTemplateAssociations';
const POINTS_RECORDS_TABLE = 'PointsMall-PointsRecords';
const CREDENTIAL_SEQUENCES_TABLE = 'PointsMall-CredentialSequences';

const SELF_APPLY_TABLES: SelfApplyTables = {
  credentialsTable: CREDENTIALS_TABLE,
  associationsTable: ASSOCIATIONS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  credentialSequencesTable: CREDENTIAL_SEQUENCES_TABLE,
};

// GSI / index names used by applyForCredential's reads & writes.
const ACTIVITY_ID_INDEX = 'activityId-index';
const POINTS_USER_INDEX = 'userId-createdAt-index';
const DEDUPE_INDEX = 'appliedDedupeKey-index';

const ALL_SOURCE_ROLES: SourceRole[] = ['Speaker', 'UserGroupLeader', 'Volunteer'];

/** Scenario inputs that drive the in-memory fake DynamoDB client's responses. */
interface FakeConfig {
  /** Association returned by the activityId-index query (null → no association). */
  association: ActivityTemplateAssociation | null;
  /** Whether the user has ≥1 identity points record for the (activityId, sourceRole). */
  hasIdentityPoints: boolean;
  /** Whether a self-applied credential already exists (appliedDedupeKey-index hit). */
  dedupeExists?: boolean;
}

interface FakeClientBundle {
  client: DynamoDBDocumentClient;
  /** Credential items written via PutCommand to PointsMall-Credentials. */
  writtenCredentials: Credential[];
  /** Mutable counters/sequence tracker observed across commands. */
  state: { lastSequence: number | null; credentialPutCount: number };
}

/**
 * Build an in-memory fake DynamoDBDocumentClient routed by command constructor
 * name AND by IndexName / TableName / UpdateExpression. It models exactly the
 * commands `applyForCredential` issues:
 *  - QueryCommand on associationsTable.activityId-index → the configured association.
 *  - QueryCommand on pointsRecordsTable.userId-createdAt-index → a matching identity
 *    points record iff `hasIdentityPoints`.
 *  - QueryCommand on credentialsTable.appliedDedupeKey-index → empty (unless `dedupeExists`).
 *  - PutCommand on credentialSequencesTable with `attribute_not_exists(sequenceKey)` →
 *    succeeds and records the lock (rejects ConditionalCheckFailedException if re-locked).
 *  - UpdateCommand ADD on credentialSequencesTable → in-memory atomic counter.
 *  - PutCommand on credentialsTable (no condition) → captures the written Credential.
 */
function createFakeClient(config: FakeConfig): FakeClientBundle {
  const writtenCredentials: Credential[] = [];
  const locks = new Set<string>();
  const counters = new Map<string, number>();
  const state = { lastSequence: null as number | null, credentialPutCount: 0 };

  const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const name = cmd?.constructor?.name;
    const input = cmd?.input ?? {};

    if (name === 'QueryCommand') {
      switch (input.IndexName) {
        case ACTIVITY_ID_INDEX:
          expect(input.TableName).toBe(ASSOCIATIONS_TABLE);
          return Promise.resolve({
            Items: config.association ? [config.association] : [],
          });
        case POINTS_USER_INDEX:
          expect(input.TableName).toBe(POINTS_RECORDS_TABLE);
          return Promise.resolve({
            Items: config.hasIdentityPoints
              ? [
                  {
                    activityId: input.ExpressionAttributeValues?.[':aid'],
                    targetRole: input.ExpressionAttributeValues?.[':role'],
                  },
                ]
              : [],
            LastEvaluatedKey: undefined,
          });
        case DEDUPE_INDEX:
          expect(input.TableName).toBe(CREDENTIALS_TABLE);
          return Promise.resolve({
            Items: config.dedupeExists
              ? [{ appliedDedupeKey: input.ExpressionAttributeValues?.[':key'] }]
              : [],
          });
        default:
          return Promise.reject(
            new Error(`Unexpected QueryCommand IndexName: ${String(input.IndexName)}`),
          );
      }
    }

    if (name === 'PutCommand') {
      if (input.TableName === CREDENTIAL_SEQUENCES_TABLE) {
        // Apply-lock conditional write (attribute_not_exists(sequenceKey)).
        const key = input.Item?.sequenceKey as string;
        if (locks.has(key)) {
          const err = new Error('The conditional request failed') as Error & {
            name: string;
          };
          err.name = 'ConditionalCheckFailedException';
          return Promise.reject(err);
        }
        locks.add(key);
        return Promise.resolve({});
      }
      if (input.TableName === CREDENTIALS_TABLE) {
        state.credentialPutCount += 1;
        writtenCredentials.push(input.Item as Credential);
        return Promise.resolve({});
      }
      return Promise.reject(
        new Error(`Unexpected PutCommand TableName: ${String(input.TableName)}`),
      );
    }

    if (name === 'UpdateCommand') {
      // Atomic ADD counter on the CredentialSequences table.
      expect(input.TableName).toBe(CREDENTIAL_SEQUENCES_TABLE);
      const key = input.Key?.sequenceKey as string;
      const inc = (input.ExpressionAttributeValues?.[':inc'] as number) ?? 1;
      const next = (counters.get(key) ?? 0) + inc;
      counters.set(key, next);
      state.lastSequence = next;
      return Promise.resolve({ Attributes: { currentValue: next } });
    }

    return Promise.reject(new Error(`Unexpected command: ${String(name)}`));
  });

  return {
    client: { send } as unknown as DynamoDBDocumentClient,
    writtenCredentials,
    state,
  };
}

/** Assemble an ActivityTemplateAssociation from scenario fields. */
function buildAssociation(fields: {
  activityId: string;
  eventName: string;
  eventPrefix: string;
  year: string;
  season: Season;
  allowedRoles: AllowedRoleConfig[];
}): ActivityTemplateAssociation {
  return {
    associationId: 'assoc-1',
    activityId: fields.activityId,
    eventName: fields.eventName,
    eventPrefix: fields.eventPrefix,
    year: fields.year,
    season: fields.season,
    allowedRoles: fields.allowedRoles,
    locale: 'en',
    issuingOrganization: 'AWS User Group China',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
  };
}

// --- Arbitraries shared by Property 5 ---

const sourceRoleArb = fc.constantFrom<SourceRole>(...ALL_SOURCE_ROLES);

const seasonArb = fc.constantFrom<Season>('Spring', 'Summer', 'Fall', 'Winter');

const yearArb = fc.integer({ min: 2000, max: 2100 }).map((y) => String(y));

const UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// eventPrefix: 1–20 uppercase letters — matches /^[A-Z-]{1,20}$/ and is parseable.
const eventPrefixArb = fc.string({
  minLength: 1,
  maxLength: 20,
  unit: fc.constantFrom(...UPPER_LETTERS),
});

// Non-empty identity text (1–100 after trimming).
const identityTextArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1 && s.length <= 100);

// Non-empty ids (userId / activityId).
const nonEmptyIdArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1);

const eventNameArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1);

const baseUrlArb = fc.constantFrom(
  'https://creds.awscommunity.cn',
  'https://example.com/base',
  '',
);

/** Allowed-role config for a given role with a derived role code. */
function configFor(role: SourceRole, identityText: string): AllowedRoleConfig {
  return { role, roleCode: SOURCE_ROLE_CODES[role], identityText };
}

describe('Property 5: 自助证书生成不变式', () => {
  it('合格三元组生成的证书满足全部不变式（active/en/今日 issueDate/身份文案/来源字段/URL/凭证 ID）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          primaryIdentityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
          // Additional allowed roles that must NOT shadow the primary match.
          extras: fc.array(
            fc.record({ role: sourceRoleArb, identityText: identityTextArb }),
            { maxLength: 3 },
          ),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            primaryIdentityText,
            recipientName,
            baseUrl,
            extras,
          } = scenario;

          // Primary entry first (so `find(role === sourceRole)` resolves to it),
          // then any extra roles other than the source role (deduped).
          const allowedRoles: AllowedRoleConfig[] = [
            configFor(sourceRole, primaryIdentityText),
          ];
          const seen = new Set<SourceRole>([sourceRole]);
          for (const extra of extras) {
            if (!seen.has(extra.role)) {
              seen.add(extra.role);
              allowedRoles.push(configFor(extra.role, extra.identityText));
            }
          }

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles,
          });
          const fake = createFakeClient({ association, hasIdentityPoints: true });

          const todayBefore = new Date().toISOString().slice(0, 10);
          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );
          const todayAfter = new Date().toISOString().slice(0, 10);

          // --- Success result. ---
          expect(result.success).toBe(true);
          if (!result.success) return;

          // Exactly one credential written.
          expect(fake.state.credentialPutCount).toBe(1);
          expect(fake.writtenCredentials).toHaveLength(1);
          const cred = fake.writtenCredentials[0];

          // status / locale.
          expect(cred.status).toBe('active');
          expect(cred.locale).toBe('en');

          // issueDate format + equals today (allow rollover across the call).
          expect(cred.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect([todayBefore, todayAfter]).toContain(cred.issueDate);

          // identityText equals the matching allowedRoles entry.
          expect(cred.identityText).toBe(primaryIdentityText);

          // Source fields non-empty and equal to the input.
          expect(cred.appliedByUserId).toBe(userId);
          expect(cred.sourceActivityId).toBe(activityId);
          expect(cred.sourceRole).toBe(sourceRole);
          expect((cred.appliedByUserId ?? '').length).toBeGreaterThan(0);
          expect((cred.sourceActivityId ?? '').length).toBeGreaterThan(0);
          expect((cred.sourceRole ?? '').length).toBeGreaterThan(0);

          // role persisted as the SourceRole value.
          expect(cred.role).toBe(sourceRole);

          // URL == baseUrl + '/c/' + credentialId.
          expect(result.url).toBe(`${baseUrl}/c/${result.credentialId}`);

          // credentialId == formatted ID for prefix/year/season + derived roleCode + sequence.
          const roleCode = SOURCE_ROLE_CODES[sourceRole];
          const expectedId = formatCredentialId({
            eventPrefix,
            year,
            season,
            roleCode,
            sequence: fake.state.lastSequence!,
          });
          expect(result.credentialId).toBe(expectedId);
          expect(cred.credentialId).toBe(result.credentialId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不合格三元组（无关联 / 身份不在允许集合 / 无身份积分）返回 403 且不写入任何证书', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
          kind: fc.constantFrom('NO_ASSOCIATION', 'ROLE_NOT_ALLOWED', 'NO_POINTS'),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            recipientName,
            baseUrl,
            kind,
          } = scenario;

          let config: FakeConfig;
          if (kind === 'NO_ASSOCIATION') {
            config = { association: null, hasIdentityPoints: true };
          } else if (kind === 'ROLE_NOT_ALLOWED') {
            // Association exists but allowedRoles excludes the requested sourceRole.
            const otherRoles = ALL_SOURCE_ROLES.filter((r) => r !== sourceRole);
            const allowedRoles = otherRoles.map((r) => configFor(r, identityText));
            const association = buildAssociation({
              activityId,
              eventName,
              eventPrefix,
              year,
              season,
              allowedRoles,
            });
            config = { association, hasIdentityPoints: true };
          } else {
            // sourceRole IS allowed, but the user has no identity points.
            const association = buildAssociation({
              activityId,
              eventName,
              eventPrefix,
              year,
              season,
              allowedRoles: [configFor(sourceRole, identityText)],
            });
            config = { association, hasIdentityPoints: false };
          }

          const fake = createFakeClient(config);
          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );

          // 403 NOT_ELIGIBLE with a descriptive message, and nothing written.
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.statusCode).toBe(403);
          expect(result.code).toBe('NOT_ELIGIBLE');
          expect(typeof result.message).toBe('string');
          expect(result.message.length).toBeGreaterThan(0);
          expect(fake.state.credentialPutCount).toBe(0);
          expect(fake.writtenCredentials).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('关联中匹配身份配置缺失 identityText/roleCode 时中止生成、不写入证书并返回描述性错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
          // Which required sub-field is missing on the matching config.
          missing: fc.constantFrom('identityText', 'roleCode'),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            recipientName,
            baseUrl,
            missing,
          } = scenario;

          // Matching config present, but its identityText or roleCode is empty.
          const matching: AllowedRoleConfig = {
            role: sourceRole,
            roleCode: missing === 'roleCode' ? '' : SOURCE_ROLE_CODES[sourceRole],
            identityText: missing === 'identityText' ? '' : 'Speaker',
          };
          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [matching],
          });
          const fake = createFakeClient({ association, hasIdentityPoints: true });

          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );

          // Aborts with a descriptive error and writes no credential.
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(typeof result.message).toBe('string');
          expect(result.message.length).toBeGreaterThan(0);
          expect(fake.state.credentialPutCount).toBe(0);
          expect(fake.writtenCredentials).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: credential-self-application, Property 8: 同一三元组至多一张证书（并发互斥）
//
// For any N concurrent `applyForCredential` calls targeting the SAME
// (userId, activityId, sourceRole) triple — launched via Promise.all against a
// single SHARED, stateful fake DynamoDB client that models the
// `attribute_not_exists(sequenceKey)` conditional-write semantics ATOMICALLY
// (synchronous check-and-set inside `send`) — EXACTLY ONE call succeeds and ALL
// others fail with code 'ALREADY_APPLIED' (statusCode 409, message '该证书已申请').
// Afterwards EXACTLY ONE credential exists in the shared store.
//
// For a triple that already has a credential (shared store + apply-lock seeded),
// a subsequent application is rejected with ALREADY_APPLIED and the existing
// credential is left completely unchanged (store length stays the same; the
// stored item is neither mutated nor overwritten).
//
// Validates: Requirements 5.5, 5.6

interface SharedFakeBundle {
  client: DynamoDBDocumentClient;
  /** Shared credentials store (PointsMall-Credentials). Same reference as writes. */
  credentialsStore: Credential[];
  /** Shared apply-lock set (sequenceKeys on PointsMall-CredentialSequences). */
  locks: Set<string>;
  /** Number of PutCommands issued against the credentials table. */
  state: { credentialPutCount: number };
}

/**
 * Build a SHARED, stateful fake DynamoDBDocumentClient for the concurrency
 * property. Unlike `createFakeClient` (Property 5), the lock set and credentials
 * store live for the lifetime of the bundle so that N concurrent calls observe
 * each other's effects. The apply-lock conditional write performs a synchronous
 * check-and-set on the shared `locks` Set (no `await` between the existence
 * check and the insert), giving it the same atomicity guarantee that
 * DynamoDB's `attribute_not_exists(sequenceKey)` provides: exactly one of N
 * concurrent writers for the same key wins.
 *
 * Commands modeled (exactly those `applyForCredential` issues):
 *  - QueryCommand activityId-index           → the configured association.
 *  - QueryCommand userId-createdAt-index      → a matching identity points record
 *                                               (the user is always eligible).
 *  - QueryCommand appliedDedupeKey-index      → reflects the CURRENT shared store
 *                                               (eventual-consistency-faithful).
 *  - PutCommand sequences (attribute_not_exists) → atomic check-and-set lock.
 *  - UpdateCommand ADD sequences              → in-memory atomic counter.
 *  - PutCommand credentials                   → push to the shared store.
 */
function createSharedFakeClient(args: {
  association: ActivityTemplateAssociation;
  seedCredentials?: Credential[];
  seedLocks?: string[];
}): SharedFakeBundle {
  const credentialsStore: Credential[] = [...(args.seedCredentials ?? [])];
  const locks = new Set<string>(args.seedLocks ?? []);
  const counters = new Map<string, number>();
  const state = { credentialPutCount: 0 };

  const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const name = cmd?.constructor?.name;
    const input = cmd?.input ?? {};

    if (name === 'QueryCommand') {
      switch (input.IndexName) {
        case ACTIVITY_ID_INDEX:
          expect(input.TableName).toBe(ASSOCIATIONS_TABLE);
          return Promise.resolve({ Items: [args.association] });
        case POINTS_USER_INDEX:
          expect(input.TableName).toBe(POINTS_RECORDS_TABLE);
          // The user is always eligible in this scenario.
          return Promise.resolve({
            Items: [
              {
                activityId: input.ExpressionAttributeValues?.[':aid'],
                targetRole: input.ExpressionAttributeValues?.[':role'],
              },
            ],
            LastEvaluatedKey: undefined,
          });
        case DEDUPE_INDEX: {
          expect(input.TableName).toBe(CREDENTIALS_TABLE);
          const key = input.ExpressionAttributeValues?.[':key'];
          // Reflect the CURRENT shared store state (models eventual consistency).
          const items = credentialsStore.filter((c) => c.appliedDedupeKey === key);
          return Promise.resolve({ Items: items });
        }
        default:
          return Promise.reject(
            new Error(`Unexpected QueryCommand IndexName: ${String(input.IndexName)}`),
          );
      }
    }

    if (name === 'PutCommand') {
      if (input.TableName === CREDENTIAL_SEQUENCES_TABLE) {
        // Apply-lock conditional write — ATOMIC synchronous check-and-set so
        // that exactly one of N concurrent writers for the same key wins.
        const key = input.Item?.sequenceKey as string;
        if (locks.has(key)) {
          const err = new Error('The conditional request failed') as Error & {
            name: string;
          };
          err.name = 'ConditionalCheckFailedException';
          return Promise.reject(err);
        }
        locks.add(key);
        return Promise.resolve({});
      }
      if (input.TableName === CREDENTIALS_TABLE) {
        state.credentialPutCount += 1;
        credentialsStore.push(input.Item as Credential);
        return Promise.resolve({});
      }
      return Promise.reject(
        new Error(`Unexpected PutCommand TableName: ${String(input.TableName)}`),
      );
    }

    if (name === 'UpdateCommand') {
      // Atomic ADD counter on the CredentialSequences table.
      expect(input.TableName).toBe(CREDENTIAL_SEQUENCES_TABLE);
      const key = input.Key?.sequenceKey as string;
      const inc = (input.ExpressionAttributeValues?.[':inc'] as number) ?? 1;
      const next = (counters.get(key) ?? 0) + inc;
      counters.set(key, next);
      return Promise.resolve({ Attributes: { currentValue: next } });
    }

    return Promise.reject(new Error(`Unexpected command: ${String(name)}`));
  });

  return {
    client: { send } as unknown as DynamoDBDocumentClient,
    credentialsStore,
    locks,
    state,
  };
}

describe('Property 8: 同一三元组至多一张证书（并发互斥）', () => {
  it('对同一三元组并发 N 次申请：恰一次成功，其余返回「该证书已申请」(409)，且仅生成一张证书', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
          n: fc.integer({ min: 2, max: 8 }),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            recipientName,
            baseUrl,
            n,
          } = scenario;

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });

          // One SHARED client observed by all N concurrent calls.
          const fake = createSharedFakeClient({ association });

          const results = await Promise.all(
            Array.from({ length: n }, () =>
              applyForCredential(
                userId,
                { activityId, sourceRole, recipientName },
                fake.client,
                SELF_APPLY_TABLES,
                baseUrl,
              ),
            ),
          );

          // Exactly one success.
          const successes = results.filter((r) => r.success);
          const failures = results.filter((r) => !r.success);
          expect(successes).toHaveLength(1);
          expect(failures).toHaveLength(n - 1);

          // Every loser is ALREADY_APPLIED with 409 + the exact message.
          for (const failure of failures) {
            if (failure.success) continue;
            expect(failure.code).toBe('ALREADY_APPLIED');
            expect(failure.statusCode).toBe(409);
            expect(failure.message).toBe('该证书已申请');
          }

          // Exactly one credential exists in the shared store afterward.
          expect(fake.state.credentialPutCount).toBe(1);
          expect(fake.credentialsStore).toHaveLength(1);

          // The winner's result is consistent with the single stored credential.
          const winner = successes[0];
          if (winner.success) {
            const stored = fake.credentialsStore[0];
            expect(stored.credentialId).toBe(winner.credentialId);
            expect(winner.url).toBe(`${baseUrl}/c/${winner.credentialId}`);
            expect(stored.appliedDedupeKey).toBe(
              `${userId}#${activityId}#${sourceRole}`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('对已存在证书的三元组再次申请：被拒（ALREADY_APPLIED 409），且已有证书不被改变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            recipientName,
            baseUrl,
          } = scenario;

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });

          // Seed a pre-existing credential + its apply-lock for the triple.
          const dedupeKey = `${userId}#${activityId}#${sourceRole}`;
          const existingCredential: Credential = {
            credentialId: formatCredentialId({
              eventPrefix,
              year,
              season,
              roleCode: SOURCE_ROLE_CODES[sourceRole],
              sequence: 1,
            }),
            recipientName: 'Existing Holder',
            eventName,
            role: sourceRole,
            issueDate: '2026-01-01',
            issuingOrganization: 'AWS User Group China',
            status: 'active',
            locale: 'en',
            createdAt: '2026-01-01T00:00:00.000Z',
            identityText,
            appliedByUserId: userId,
            sourceActivityId: activityId,
            sourceRole,
            appliedDedupeKey: dedupeKey,
          };
          // Deep snapshot to detect any mutation/overwrite of the stored item.
          const snapshot: Credential = JSON.parse(JSON.stringify(existingCredential));

          const fake = createSharedFakeClient({
            association,
            seedCredentials: [existingCredential],
            seedLocks: [dedupeKey],
          });

          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );

          // Rejected as ALREADY_APPLIED with the exact 409 message.
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.code).toBe('ALREADY_APPLIED');
          expect(result.statusCode).toBe(409);
          expect(result.message).toBe('该证书已申请');

          // No new credential written; the existing one is unchanged.
          expect(fake.state.credentialPutCount).toBe(0);
          expect(fake.credentialsStore).toHaveLength(1);
          expect(fake.credentialsStore[0]).toEqual(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: credential-self-application, Property 12: 积分数据零副作用
//
// For any credential-self-application operation — eligibility computation
// (getMyApplications), application submission + credential generation
// (applyForCredential), "my credentials" query (getMyCredentials), and any
// association create / update / delete — NO write command is EVER issued
// against a points-mall CORE data table: the points-records table
// (PointsMall-PointsRecords), the products table (PointsMall-Products), the
// orders table (PointsMall-Orders), or the users/balances table
// (PointsMall-Users). Reads of PointsRecords are permitted (used for
// eligibility) but never writes. An in-memory snapshot of the points-records
// store is byte-for-byte unchanged across every operation.
//
// Additionally, the set of tables each operation writes to is constrained:
//   - applyForCredential   writes ⊆ { credentialsTable, credentialSequencesTable }
//   - association CRUD      writes ⊆ { associationsTable }
//   - getMyApplications / getMyCredentials issue NO writes at all.
//
// Writes are classified by command constructor name:
//   read  : QueryCommand / GetCommand / ScanCommand / BatchGetCommand
//   write : PutCommand / UpdateCommand / DeleteCommand / BatchWriteCommand /
//           TransactWriteCommand
//
// Validates: Requirements 5.8, 11.1, 11.3

// --- Points-mall CORE data tables that must NEVER be written by this feature. ---
const PRODUCTS_TABLE = 'PointsMall-Products';
const ORDERS_TABLE = 'PointsMall-Orders';
const USERS_TABLE = 'PointsMall-Users';
/** Read-only activities table (association CRUD verifies activityId existence). */
const ACTIVITIES_TABLE = 'PointsMall-Activities';

/** The deny-list: writing to any of these tables is a Property-12 violation. */
const CORE_DATA_TABLES: ReadonlySet<string> = new Set([
  POINTS_RECORDS_TABLE,
  PRODUCTS_TABLE,
  ORDERS_TABLE,
  USERS_TABLE,
]);

/** GSI used by the eligibility / my-credentials reads on the Credentials table. */
const APPLIED_BY_USER_INDEX = 'appliedByUserId-index';

const READ_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'QueryCommand',
  'GetCommand',
  'ScanCommand',
  'BatchGetCommand',
]);
const WRITE_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'PutCommand',
  'UpdateCommand',
  'DeleteCommand',
  'BatchWriteCommand',
  'TransactWriteCommand',
]);

/** Classify a command constructor name as a read, a write, or neither. */
function classifyCommand(name: string): 'read' | 'write' | 'other' {
  if (READ_COMMAND_NAMES.has(name)) return 'read';
  if (WRITE_COMMAND_NAMES.has(name)) return 'write';
  return 'other';
}

/** A single recorded DynamoDB command with its table + read/write classification. */
interface RecordedCommand {
  name: string;
  table: string;
  indexName?: string;
  kind: 'read' | 'write' | 'other';
}

/** A points record as stored in the (read-only) in-memory points table. */
interface PointsRecordItem {
  userId: string;
  activityId: string;
  targetRole: string;
  points: number;
  createdAt: string;
}

interface InstrumentedConfig {
  /** Association returned by the activityId-index query (null → none). */
  association?: ActivityTemplateAssociation | null;
  /** Whether the user has ≥1 identity points record (apply re-check path). */
  hasIdentityPoints?: boolean;
  /** appliedDedupeKey-index hit (apply dedupe path). */
  dedupeExists?: boolean;
  /** Credentials returned by the appliedByUserId-index query. */
  appliedCredentials?: Credential[];
  /** Existing association returned by GetCommand on the associations table (update path). */
  existingAssociationById?: ActivityTemplateAssociation | null;
  /** Whether GetCommand on the activities table reports the activity exists. */
  activityExists?: boolean;
  /** Seed rows for the in-memory points-records store (the snapshot target). */
  pointsRecordsSeed?: PointsRecordItem[];
}

interface InstrumentedBundle {
  client: DynamoDBDocumentClient;
  /** Every command observed, in order. */
  commands: RecordedCommand[];
  /** The in-memory points-records store — must be unchanged after any op. */
  pointsRecordsStore: PointsRecordItem[];
  /** All recorded write commands. */
  writes(): RecordedCommand[];
  /** Recorded writes whose TableName is a points-mall core data table. */
  coreTableWrites(): RecordedCommand[];
  /** Distinct table names that received a write. */
  writtenTables(): Set<string>;
}

/**
 * Build an instrumented fake `DynamoDBDocumentClient` that records EVERY command
 * (name, TableName, IndexName + read/write classification) and returns
 * responses for exactly the commands the credential-self-application operations
 * issue. Reads of the points-records store return projected COPIES of seeded
 * rows so the store is genuinely read but never mutated.
 */
function createInstrumentedClient(config: InstrumentedConfig): InstrumentedBundle {
  const commands: RecordedCommand[] = [];
  const pointsRecordsStore: PointsRecordItem[] = (config.pointsRecordsSeed ?? []).map(
    (r) => ({ ...r }),
  );
  const locks = new Set<string>();
  const counters = new Map<string, number>();

  const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const name = cmd?.constructor?.name ?? '';
    const input = cmd?.input ?? {};
    commands.push({
      name,
      table: String(input.TableName ?? ''),
      indexName: input.IndexName,
      kind: classifyCommand(name),
    });

    if (name === 'QueryCommand') {
      switch (input.IndexName) {
        case ACTIVITY_ID_INDEX:
          return Promise.resolve({
            Items: config.association ? [config.association] : [],
          });
        case POINTS_USER_INDEX: {
          // Read the in-memory points store (never mutate it).
          const aid = input.ExpressionAttributeValues?.[':aid'];
          const role = input.ExpressionAttributeValues?.[':role'];
          const rows = pointsRecordsStore
            .filter((r) => (aid ? r.activityId === aid : true))
            .filter((r) => (role ? r.targetRole === role : true))
            .map((r) => ({ activityId: r.activityId, targetRole: r.targetRole }));
          // The apply re-check honors `hasIdentityPoints`; the eligibility
          // read returns whatever the store projects.
          if (aid && role) {
            return Promise.resolve({
              Items: config.hasIdentityPoints ? rows : [],
              LastEvaluatedKey: undefined,
            });
          }
          return Promise.resolve({ Items: rows, LastEvaluatedKey: undefined });
        }
        case DEDUPE_INDEX:
          return Promise.resolve({
            Items: config.dedupeExists
              ? [{ appliedDedupeKey: input.ExpressionAttributeValues?.[':key'] }]
              : [],
          });
        case APPLIED_BY_USER_INDEX:
          return Promise.resolve({
            Items: config.appliedCredentials ?? [],
            LastEvaluatedKey: undefined,
          });
        default:
          return Promise.resolve({ Items: [] });
      }
    }

    if (name === 'GetCommand') {
      if (input.TableName === ACTIVITIES_TABLE) {
        return Promise.resolve({
          Item: config.activityExists ? { activityId: input.Key?.activityId } : undefined,
        });
      }
      if (input.TableName === ASSOCIATIONS_TABLE) {
        return Promise.resolve({ Item: config.existingAssociationById ?? undefined });
      }
      return Promise.resolve({ Item: undefined });
    }

    if (name === 'PutCommand') {
      if (input.TableName === CREDENTIAL_SEQUENCES_TABLE) {
        const key = input.Item?.sequenceKey as string;
        if (locks.has(key)) {
          const err = new Error('The conditional request failed') as Error & {
            name: string;
          };
          err.name = 'ConditionalCheckFailedException';
          return Promise.reject(err);
        }
        locks.add(key);
        return Promise.resolve({});
      }
      // Credentials / Associations puts succeed (recorded above).
      return Promise.resolve({});
    }

    if (name === 'UpdateCommand') {
      const key = input.Key?.sequenceKey as string;
      const inc = (input.ExpressionAttributeValues?.[':inc'] as number) ?? 1;
      const next = (counters.get(key) ?? 0) + inc;
      counters.set(key, next);
      return Promise.resolve({ Attributes: { currentValue: next } });
    }

    if (name === 'DeleteCommand') {
      return Promise.resolve({});
    }

    if (name === 'ScanCommand') {
      return Promise.resolve({ Items: [], LastEvaluatedKey: undefined });
    }

    return Promise.reject(new Error(`Unexpected command: ${String(name)}`));
  });

  return {
    client: { send } as unknown as DynamoDBDocumentClient,
    commands,
    pointsRecordsStore,
    writes: () => commands.filter((c) => c.kind === 'write'),
    coreTableWrites: () =>
      commands.filter((c) => c.kind === 'write' && CORE_DATA_TABLES.has(c.table)),
    writtenTables: () =>
      new Set(commands.filter((c) => c.kind === 'write').map((c) => c.table)),
  };
}

/** Build a few points-records rows for a (userId, activityId, role) triple. */
function seedPointsRecords(
  userId: string,
  activityId: string,
  role: SourceRole,
): PointsRecordItem[] {
  return [
    { userId, activityId, targetRole: role, points: 10, createdAt: '2026-01-02T00:00:00.000Z' },
    { userId, activityId, targetRole: role, points: 5, createdAt: '2026-01-03T00:00:00.000Z' },
    // An unrelated SpecialActivity record that must also remain untouched.
    {
      userId,
      activityId: `${activityId}-other`,
      targetRole: 'SpecialActivity',
      points: 99,
      createdAt: '2026-01-04T00:00:00.000Z',
    },
  ];
}

describe('Property 12: 积分数据零副作用', () => {
  it('applyForCredential（合格）：不写入任何核心数据表，写入仅限 {Credentials, CredentialSequences}，积分记录不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            recipientName,
            baseUrl,
          } = scenario;

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });
          const fake = createInstrumentedClient({
            association,
            hasIdentityPoints: true,
            pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
          });
          const before = JSON.stringify(fake.pointsRecordsStore);

          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );

          // The eligible apply must succeed (so writes actually occur).
          expect(result.success).toBe(true);

          // No write ever targets a points-mall core data table.
          expect(fake.coreTableWrites()).toEqual([]);

          // Writes are a subset of { credentialsTable, credentialSequencesTable }.
          const allowedWriteTables = new Set([
            CREDENTIALS_TABLE,
            CREDENTIAL_SEQUENCES_TABLE,
          ]);
          for (const table of fake.writtenTables()) {
            expect(allowedWriteTables.has(table)).toBe(true);
          }

          // The points-records store is byte-for-byte unchanged.
          expect(JSON.stringify(fake.pointsRecordsStore)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('applyForCredential（不合格 / 已申请）：同样不写入任何核心数据表，积分记录不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
          kind: fc.constantFrom('NO_ASSOCIATION', 'NO_POINTS', 'ALREADY_APPLIED'),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            recipientName,
            baseUrl,
            kind,
          } = scenario;

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });

          let config: InstrumentedConfig;
          if (kind === 'NO_ASSOCIATION') {
            config = {
              association: null,
              hasIdentityPoints: true,
              pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
            };
          } else if (kind === 'NO_POINTS') {
            config = {
              association,
              hasIdentityPoints: false,
              pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
            };
          } else {
            // Already applied: dedupe-index hit short-circuits before any write.
            config = {
              association,
              hasIdentityPoints: true,
              dedupeExists: true,
              pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
            };
          }

          const fake = createInstrumentedClient(config);
          const before = JSON.stringify(fake.pointsRecordsStore);

          const result = await applyForCredential(
            userId,
            { activityId, sourceRole, recipientName },
            fake.client,
            SELF_APPLY_TABLES,
            baseUrl,
          );

          // These scenarios are all rejected (no credential generated).
          expect(result.success).toBe(false);

          // No write ever targets a points-mall core data table.
          expect(fake.coreTableWrites()).toEqual([]);
          // The points-records store is unchanged.
          expect(JSON.stringify(fake.pointsRecordsStore)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getMyApplications：纯读取，零写入，积分记录不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
          } = scenario;

          const association = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });
          const fake = createInstrumentedClient({
            association,
            appliedCredentials: [],
            pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
          });
          const before = JSON.stringify(fake.pointsRecordsStore);

          await getMyApplications(userId, fake.client, {
            pointsRecordsTable: POINTS_RECORDS_TABLE,
            associationsTable: ASSOCIATIONS_TABLE,
            credentialsTable: CREDENTIALS_TABLE,
          });

          // No writes whatsoever, hence none to any core data table.
          expect(fake.writes()).toEqual([]);
          expect(fake.coreTableWrites()).toEqual([]);
          expect(JSON.stringify(fake.pointsRecordsStore)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getMyCredentials：纯读取，零写入，积分记录不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          baseUrl: baseUrlArb,
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            baseUrl,
          } = scenario;

          const credential: Credential = {
            credentialId: formatCredentialId({
              eventPrefix,
              year,
              season,
              roleCode: SOURCE_ROLE_CODES[sourceRole],
              sequence: 1,
            }),
            recipientName: 'Holder',
            eventName,
            role: sourceRole,
            issueDate: '2026-01-01',
            issuingOrganization: 'AWS User Group China',
            status: 'active',
            locale: 'en',
            createdAt: '2026-01-01T00:00:00.000Z',
            identityText,
            appliedByUserId: userId,
            sourceActivityId: activityId,
            sourceRole,
            appliedDedupeKey: `${userId}#${activityId}#${sourceRole}`,
          };
          const fake = createInstrumentedClient({
            appliedCredentials: [credential],
            pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
          });
          const before = JSON.stringify(fake.pointsRecordsStore);

          await getMyCredentials(
            userId,
            fake.client,
            { credentialsTable: CREDENTIALS_TABLE },
            baseUrl,
          );

          expect(fake.writes()).toEqual([]);
          expect(fake.coreTableWrites()).toEqual([]);
          expect(JSON.stringify(fake.pointsRecordsStore)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('关联创建 / 编辑 / 删除：不写入任何核心数据表，写入仅限关联表，积分记录不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: nonEmptyIdArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          op: fc.constantFrom('create', 'update', 'delete'),
        }),
        async (scenario) => {
          const {
            userId,
            activityId,
            eventPrefix,
            year,
            season,
            eventName,
            sourceRole,
            identityText,
            op,
          } = scenario;

          const input: AssociationInput = {
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [{ role: sourceRole, identityText }],
          };

          const existing = buildAssociation({
            activityId,
            eventName,
            eventPrefix,
            year,
            season,
            allowedRoles: [configFor(sourceRole, identityText)],
          });

          const fake = createInstrumentedClient({
            // create: no duplicate association exists yet.
            association: op === 'create' ? null : existing,
            existingAssociationById: existing,
            activityExists: true,
            pointsRecordsSeed: seedPointsRecords(userId, activityId, sourceRole),
          });
          const before = JSON.stringify(fake.pointsRecordsStore);

          if (op === 'create') {
            await createAssociation({
              input,
              createdBy: userId,
              dynamoClient: fake.client,
              associationsTable: ASSOCIATIONS_TABLE,
              activitiesTable: ACTIVITIES_TABLE,
            });
          } else if (op === 'update') {
            await updateAssociation({
              associationId: existing.associationId,
              input,
              updatedBy: userId,
              dynamoClient: fake.client,
              associationsTable: ASSOCIATIONS_TABLE,
              activitiesTable: ACTIVITIES_TABLE,
            });
          } else {
            await deleteAssociation({
              associationId: existing.associationId,
              dynamoClient: fake.client,
              associationsTable: ASSOCIATIONS_TABLE,
            });
          }

          // No write ever targets a points-mall core data table.
          expect(fake.coreTableWrites()).toEqual([]);
          // Writes are confined to the associations table.
          for (const table of fake.writtenTables()) {
            expect(table).toBe(ASSOCIATIONS_TABLE);
          }
          // The points-records store is unchanged.
          expect(JSON.stringify(fake.pointsRecordsStore)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: credential-self-application, Property 11: 用户侧数据隔离
//
// For ANY client-supplied user identifier (whether placed in a request body or a
// query parameter), the USER-SIDE functions return data belonging ONLY to the
// authenticated `userId`, and the client-supplied identifier is IGNORED.
//
// The user-side functions under test:
//   - getMyApplications(userId, client, tables)  — keys the points
//     `userId-createdAt-index` query AND the credentials `appliedByUserId-index`
//     query on the authenticated `userId`.
//   - getMyCredentials(userId, client, tables, baseUrl) — keys the credentials
//     `appliedByUserId-index` query on the authenticated `userId`.
//   - applyForCredential(userId, input, client, tables, baseUrl) — the written
//     credential's `appliedByUserId` equals the authenticated `userId`, and its
//     `appliedDedupeKey` is `${userId}#…` using the authenticated id — NEVER any
//     identifier carried inside `input`.
//
// Modeling strategy: a FAITHFUL multi-user fake DynamoDB client. GSI queries on a
// user-keyed index (`userId-createdAt-index`, `appliedByUserId-index`) return
// ONLY rows whose partition key equals the queried `:uid` (exactly DynamoDB GSI
// semantics) AND record the `:uid` value the function actually queried with. The
// store is seeded with rows for the authenticated user AND for one or more
// "forged"/other users. We then assert:
//   1. Every user-keyed query was issued with `:uid === authenticated userId`
//      (the forged id is never used as a query key).
//   2. No other user's rows ever leak into the returned data.
//   3. applyForCredential ignores any identifier inside `input`: the written
//      credential's `appliedByUserId === authenticated userId` and its
//      `appliedDedupeKey` starts with `${authenticated userId}#`.
//
// Validates: Requirements 9.5

/** Arbitrary producing two guaranteed-distinct user ids (auth vs forged). */
const distinctUserIdsArb = fc
  .tuple(nonEmptyIdArb, nonEmptyIdArb)
  .map(([auth, forged]) => ({
    authUserId: `auth-${auth}`,
    forgedUserId: `forged-${forged}`,
  }));

/** Arbitrary producing two guaranteed-distinct activity ids (auth vs forged). */
const distinctActivityIdsArb = fc
  .tuple(nonEmptyIdArb, nonEmptyIdArb)
  .map(([auth, forged]) => ({
    authActivityId: `auth-act-${auth}`,
    forgedActivityId: `forged-act-${forged}`,
  }));

/** A points record row keyed (in the fake store) by its owning userId. */
interface IsolationPointsRow {
  activityId: string;
  targetRole: string;
}

interface IsolationConfig {
  /** activityId → association (returned by the activityId-index query). */
  associationsByActivity: Map<string, ActivityTemplateAssociation>;
  /** userId → that user's points records (userId-createdAt-index partition). */
  pointsByUser: Map<string, IsolationPointsRow[]>;
  /** userId → that user's self-applied credentials (appliedByUserId-index partition). */
  credentialsByUser: Map<string, Credential[]>;
}

interface IsolationBundle {
  client: DynamoDBDocumentClient;
  /** `:uid` values used on the points `userId-createdAt-index`. */
  pointsQueryUids: string[];
  /** `:uid` values used on the credentials `appliedByUserId-index`. */
  appliedByUserUids: string[];
  /** `:key` values used on the credentials `appliedDedupeKey-index`. */
  dedupeQueryKeys: string[];
  /** `sequenceKey`s written as apply-locks on the sequences table. */
  lockKeys: string[];
  /** Credentials written via PutCommand to the credentials table. */
  writtenCredentials: Credential[];
}

/**
 * Build a faithful, multi-user fake DynamoDBDocumentClient for the data-isolation
 * property. User-keyed GSI queries return ONLY the partition matching the queried
 * `:uid` (mirroring DynamoDB) and record the queried key so the test can assert
 * the function never keys on a foreign/forged identifier.
 */
function createIsolationClient(config: IsolationConfig): IsolationBundle {
  const pointsQueryUids: string[] = [];
  const appliedByUserUids: string[] = [];
  const dedupeQueryKeys: string[] = [];
  const lockKeys: string[] = [];
  const writtenCredentials: Credential[] = [];
  const locks = new Set<string>();
  const counters = new Map<string, number>();

  const send = vi.fn(
    (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
      const name = cmd?.constructor?.name;
      const input = cmd?.input ?? {};

      if (name === 'QueryCommand') {
        switch (input.IndexName) {
          case ACTIVITY_ID_INDEX: {
            expect(input.TableName).toBe(ASSOCIATIONS_TABLE);
            const aid = input.ExpressionAttributeValues?.[':aid'];
            const assoc = config.associationsByActivity.get(aid);
            return Promise.resolve({ Items: assoc ? [assoc] : [] });
          }
          case POINTS_USER_INDEX: {
            expect(input.TableName).toBe(POINTS_RECORDS_TABLE);
            const uid = input.ExpressionAttributeValues?.[':uid'] as string;
            pointsQueryUids.push(uid);
            // GSI semantics: only this user's partition is visible.
            let rows = config.pointsByUser.get(uid) ?? [];
            // Honor the apply path's FilterExpression (activityId + targetRole).
            const aid = input.ExpressionAttributeValues?.[':aid'];
            const role = input.ExpressionAttributeValues?.[':role'];
            if (aid !== undefined) rows = rows.filter((r) => r.activityId === aid);
            if (role !== undefined) rows = rows.filter((r) => r.targetRole === role);
            return Promise.resolve({
              Items: rows.map((r) => ({
                activityId: r.activityId,
                targetRole: r.targetRole,
              })),
              LastEvaluatedKey: undefined,
            });
          }
          case APPLIED_BY_USER_INDEX: {
            expect(input.TableName).toBe(CREDENTIALS_TABLE);
            const uid = input.ExpressionAttributeValues?.[':uid'] as string;
            appliedByUserUids.push(uid);
            // GSI semantics: only this user's credentials are visible.
            const creds = config.credentialsByUser.get(uid) ?? [];
            return Promise.resolve({
              Items: creds.map((c) => ({ ...c })),
              LastEvaluatedKey: undefined,
            });
          }
          case DEDUPE_INDEX: {
            expect(input.TableName).toBe(CREDENTIALS_TABLE);
            const key = input.ExpressionAttributeValues?.[':key'] as string;
            dedupeQueryKeys.push(key);
            // A self-applied credential matches iff some user owns this dedupe key.
            const hit = [...config.credentialsByUser.values()]
              .flat()
              .some((c) => c.appliedDedupeKey === key);
            return Promise.resolve({ Items: hit ? [{ appliedDedupeKey: key }] : [] });
          }
          default:
            return Promise.reject(
              new Error(`Unexpected QueryCommand IndexName: ${String(input.IndexName)}`),
            );
        }
      }

      if (name === 'PutCommand') {
        if (input.TableName === CREDENTIAL_SEQUENCES_TABLE) {
          const key = input.Item?.sequenceKey as string;
          if (locks.has(key)) {
            const err = new Error('The conditional request failed') as Error & {
              name: string;
            };
            err.name = 'ConditionalCheckFailedException';
            return Promise.reject(err);
          }
          locks.add(key);
          lockKeys.push(key);
          return Promise.resolve({});
        }
        if (input.TableName === CREDENTIALS_TABLE) {
          writtenCredentials.push(input.Item as Credential);
          return Promise.resolve({});
        }
        return Promise.reject(
          new Error(`Unexpected PutCommand TableName: ${String(input.TableName)}`),
        );
      }

      if (name === 'UpdateCommand') {
        expect(input.TableName).toBe(CREDENTIAL_SEQUENCES_TABLE);
        const key = input.Key?.sequenceKey as string;
        const inc = (input.ExpressionAttributeValues?.[':inc'] as number) ?? 1;
        const next = (counters.get(key) ?? 0) + inc;
        counters.set(key, next);
        return Promise.resolve({ Attributes: { currentValue: next } });
      }

      return Promise.reject(new Error(`Unexpected command: ${String(name)}`));
    },
  );

  return {
    client: { send } as unknown as DynamoDBDocumentClient,
    pointsQueryUids,
    appliedByUserUids,
    dedupeQueryKeys,
    lockKeys,
    writtenCredentials,
  };
}

/** Build a self-applied credential owned by `userId` for `(activityId, role)`. */
function buildCredentialForUser(
  userId: string,
  activityId: string,
  role: SourceRole,
  sequence: number,
  identityText: string,
): Credential {
  return {
    credentialId: formatCredentialId({
      eventPrefix: 'ACD',
      year: '2026',
      season: 'Summer',
      roleCode: SOURCE_ROLE_CODES[role],
      sequence,
    }),
    recipientName: `Holder-${userId}`,
    eventName: `Event-${activityId}`,
    role,
    issueDate: '2026-06-20',
    issuingOrganization: 'AWS User Group China',
    status: 'active',
    locale: 'en',
    createdAt: '2026-06-20T00:00:00.000Z',
    identityText,
    appliedByUserId: userId,
    sourceActivityId: activityId,
    sourceRole: role,
    appliedDedupeKey: `${userId}#${activityId}#${role}`,
  };
}

describe('Property 11: 用户侧数据隔离', () => {
  it('getMyApplications：仅以认证 userId 为查询键，伪造标识符从不被使用，他人数据从不泄漏', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          users: distinctUserIdsArb,
          activities: distinctActivityIdsArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          authEventName: eventNameArb,
          forgedEventName: eventNameArb,
          sourceRole: sourceRoleArb,
          authIdentityText: identityTextArb,
          forgedIdentityText: identityTextArb,
        }),
        async (scenario) => {
          const { authUserId, forgedUserId } = scenario.users;
          const { authActivityId, forgedActivityId } = scenario.activities;
          const { sourceRole } = scenario;

          // Both the auth user and the forged user have eligible identity points
          // for distinct activities, and BOTH activities have associations that
          // allow the role. A leak (querying the forged id) would surface the
          // forged user's activity in the result.
          const authAssoc = buildAssociation({
            activityId: authActivityId,
            eventName: scenario.authEventName,
            eventPrefix: scenario.eventPrefix,
            year: scenario.year,
            season: scenario.season,
            allowedRoles: [configFor(sourceRole, scenario.authIdentityText)],
          });
          const forgedAssoc = buildAssociation({
            activityId: forgedActivityId,
            eventName: scenario.forgedEventName,
            eventPrefix: scenario.eventPrefix,
            year: scenario.year,
            season: scenario.season,
            allowedRoles: [configFor(sourceRole, scenario.forgedIdentityText)],
          });

          const associationsByActivity = new Map<string, ActivityTemplateAssociation>([
            [authActivityId, authAssoc],
            [forgedActivityId, forgedAssoc],
          ]);
          const pointsByUser = new Map<string, IsolationPointsRow[]>([
            [authUserId, [{ activityId: authActivityId, targetRole: sourceRole }]],
            [forgedUserId, [{ activityId: forgedActivityId, targetRole: sourceRole }]],
          ]);
          // The forged user already applied; the auth user has not.
          const credentialsByUser = new Map<string, Credential[]>([
            [authUserId, []],
            [
              forgedUserId,
              [
                buildCredentialForUser(
                  forgedUserId,
                  forgedActivityId,
                  sourceRole,
                  7,
                  scenario.forgedIdentityText,
                ),
              ],
            ],
          ]);

          const fake = createIsolationClient({
            associationsByActivity,
            pointsByUser,
            credentialsByUser,
          });

          const { items } = await getMyApplications(authUserId, fake.client, {
            pointsRecordsTable: POINTS_RECORDS_TABLE,
            associationsTable: ASSOCIATIONS_TABLE,
            credentialsTable: CREDENTIALS_TABLE,
          });

          // 1. Every user-keyed query used the authenticated userId — never the
          //    forged id.
          expect(fake.pointsQueryUids.length).toBeGreaterThan(0);
          for (const uid of fake.pointsQueryUids) expect(uid).toBe(authUserId);
          for (const uid of fake.appliedByUserUids) expect(uid).toBe(authUserId);
          expect(fake.pointsQueryUids).not.toContain(forgedUserId);
          expect(fake.appliedByUserUids).not.toContain(forgedUserId);

          // 2. Result references ONLY the auth user's activity — no leak of the
          //    forged user's data.
          expect(items).toHaveLength(1);
          for (const item of items) {
            expect(item.activityId).toBe(authActivityId);
            expect(item.activityId).not.toBe(forgedActivityId);
          }
          // The auth user has not applied → the single item is applied:false.
          expect(items[0].applied).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getMyCredentials：仅返回认证 userId 名下证书，他人证书从不泄漏，伪造标识符从不被用作查询键', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          users: distinctUserIdsArb,
          activities: distinctActivityIdsArb,
          sourceRole: sourceRoleArb,
          authIdentityText: identityTextArb,
          forgedIdentityText: identityTextArb,
          baseUrl: baseUrlArb,
          authCount: fc.integer({ min: 0, max: 4 }),
          forgedCount: fc.integer({ min: 1, max: 4 }),
        }),
        async (scenario) => {
          const { authUserId, forgedUserId } = scenario.users;
          const { authActivityId, forgedActivityId } = scenario.activities;
          const { sourceRole } = scenario;

          const authCreds = Array.from({ length: scenario.authCount }, (_, i) =>
            buildCredentialForUser(
              authUserId,
              `${authActivityId}-${i}`,
              sourceRole,
              i + 1,
              scenario.authIdentityText,
            ),
          );
          // Offset the forged sequences so the two users' credential IDs are
          // genuinely disjoint (auth seqs 1..authCount, forged seqs 1001..).
          // This keeps the "no forged ID leaks" assertion meaningful rather than
          // accidentally colliding on a shared (prefix, role, sequence) ID.
          const forgedCreds = Array.from({ length: scenario.forgedCount }, (_, i) =>
            buildCredentialForUser(
              forgedUserId,
              `${forgedActivityId}-${i}`,
              sourceRole,
              i + 1001,
              scenario.forgedIdentityText,
            ),
          );

          const credentialsByUser = new Map<string, Credential[]>([
            [authUserId, authCreds],
            [forgedUserId, forgedCreds],
          ]);

          const fake = createIsolationClient({
            associationsByActivity: new Map(),
            pointsByUser: new Map(),
            credentialsByUser,
          });

          const { items } = await getMyCredentials(
            authUserId,
            fake.client,
            { credentialsTable: CREDENTIALS_TABLE },
            scenario.baseUrl,
          );

          // The query keyed ONLY on the authenticated userId.
          expect(fake.appliedByUserUids.length).toBeGreaterThan(0);
          for (const uid of fake.appliedByUserUids) expect(uid).toBe(authUserId);
          expect(fake.appliedByUserUids).not.toContain(forgedUserId);

          // Returns EXACTLY the auth user's credentials — none of the forged user's.
          expect(items).toHaveLength(authCreds.length);
          const authCredentialIds = new Set(authCreds.map((c) => c.credentialId));
          const forgedCredentialIds = new Set(forgedCreds.map((c) => c.credentialId));
          for (const item of items) {
            expect(authCredentialIds.has(item.credentialId)).toBe(true);
            expect(forgedCredentialIds.has(item.credentialId)).toBe(false);
            expect(item.url).toBe(`${scenario.baseUrl}/c/${item.credentialId}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('applyForCredential：生成证书的 appliedByUserId 等于认证 userId，input 中伪造的标识符被忽略', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          users: distinctUserIdsArb,
          activityId: nonEmptyIdArb,
          eventPrefix: eventPrefixArb,
          year: yearArb,
          season: seasonArb,
          eventName: eventNameArb,
          sourceRole: sourceRoleArb,
          identityText: identityTextArb,
          recipientName: validNameArb,
          baseUrl: baseUrlArb,
        }),
        async (scenario) => {
          const { authUserId, forgedUserId } = scenario.users;
          const { sourceRole } = scenario;
          const activityId = `auth-act-${scenario.activityId}`;

          const association = buildAssociation({
            activityId,
            eventName: scenario.eventName,
            eventPrefix: scenario.eventPrefix,
            year: scenario.year,
            season: scenario.season,
            allowedRoles: [configFor(sourceRole, scenario.identityText)],
          });

          // Only the AUTH user has identity points for the activity. The forged
          // user is present in the store but must never be consulted.
          const fake = createIsolationClient({
            associationsByActivity: new Map([[activityId, association]]),
            pointsByUser: new Map<string, IsolationPointsRow[]>([
              [authUserId, [{ activityId, targetRole: sourceRole }]],
              [forgedUserId, [{ activityId, targetRole: sourceRole }]],
            ]),
            credentialsByUser: new Map(),
          });

          // Inject FORGED identifiers into the request body. `applyForCredential`
          // accepts `ApplyInput` (activityId / sourceRole / recipientName) only;
          // these extra fields model a client trying to spoof another user and
          // MUST be ignored.
          const forgedInput = {
            activityId,
            sourceRole,
            recipientName: scenario.recipientName,
            userId: forgedUserId,
            appliedByUserId: forgedUserId,
            appliedDedupeKey: `${forgedUserId}#${activityId}#${sourceRole}`,
          } as unknown as ApplyInput;

          const result = await applyForCredential(
            authUserId,
            forgedInput,
            fake.client,
            SELF_APPLY_TABLES,
            scenario.baseUrl,
          );

          expect(result.success).toBe(true);
          if (!result.success) return;

          // Exactly one credential written, owned by the AUTHENTICATED user.
          expect(fake.writtenCredentials).toHaveLength(1);
          const cred = fake.writtenCredentials[0];
          expect(cred.appliedByUserId).toBe(authUserId);
          expect(cred.appliedByUserId).not.toBe(forgedUserId);

          // The dedupe key / apply-lock is derived from the authenticated id.
          expect(cred.appliedDedupeKey).toBe(`${authUserId}#${activityId}#${sourceRole}`);
          expect(cred.appliedDedupeKey?.startsWith(`${authUserId}#`)).toBe(true);
          expect(cred.appliedDedupeKey?.startsWith(`${forgedUserId}#`)).toBe(false);
          for (const key of fake.lockKeys) {
            expect(key.startsWith(`${authUserId}#`)).toBe(true);
            expect(key.startsWith(`${forgedUserId}#`)).toBe(false);
          }

          // The identity-points re-check keyed on the authenticated userId only.
          expect(fake.pointsQueryUids.length).toBeGreaterThan(0);
          for (const uid of fake.pointsQueryUids) expect(uid).toBe(authUserId);
          // The dedupe lookup used the authenticated id's dedupe key.
          for (const key of fake.dedupeQueryKeys) {
            expect(key.startsWith(`${authUserId}#`)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
