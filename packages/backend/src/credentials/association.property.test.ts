import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  validateAssociationInput,
  assertSuperAdmin,
  createAssociation,
  updateAssociation,
  deleteAssociation,
} from './association';
import { SOURCE_ROLE_CODES, type SourceRole } from './types';

// Feature: credential-self-application, Property 2: 关联输入校验正确性
//
// For any association input, validateAssociationInput judges the input valid
// *if and only if* every field constraint holds:
//   - eventName: 1–200 chars after trim
//   - eventPrefix: /^[A-Z-]{1,20}$/ (uppercase A–Z and '-' only, length 1–20)
//   - year: four digits with value in [2000, 2100]
//   - season ∈ {Spring, Summer, Fall, Winter}
//   - allowedRoles: 1–3 items; each role ∈ {Speaker, UserGroupLeader, Volunteer},
//     distinct, identityText 1–100 chars after trim
//   - optional eventLocation / issuingOrganization: 1–200 chars when provided
// On success the normalized result backfills each role's roleCode per
// SOURCE_ROLE_CODES, sets locale='en', and defaults issuingOrganization to
// 'AWS User Group China' when omitted. For illegal / duplicate / missing
// required inputs it returns a descriptive error (code + message) and produces
// NO normalized result.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.7, 2.3, 2.5, 2.7

const DEFAULT_ISSUING_ORGANIZATION = 'AWS User Group China';
const VALID_SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
const VALID_ROLES: readonly SourceRole[] = [
  'Speaker',
  'UserGroupLeader',
  'Volunteer',
];
const EVENT_PREFIX_REGEX = /^[A-Z-]{1,20}$/;
const YEAR_REGEX = /^\d{4}$/;

// ============================================================
// Arbitraries — building blocks that always satisfy a constraint
// ============================================================

/** Alphanumeric chars (no whitespace) so trimming never changes length. */
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const alnumCharArb = fc.constantFrom(...ALNUM.split(''));

/** Non-blank text whose trimmed length is exactly within [min, max]. */
const textArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(alnumCharArb, { minLength: min, maxLength: max })
    .map((cs) => cs.join(''));

/** Event prefix matching /^[A-Z-]{1,20}$/. */
const PREFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-';
const eventPrefixArb = fc
  .array(fc.constantFrom(...PREFIX_CHARS.split('')), {
    minLength: 1,
    maxLength: 20,
  })
  .map((cs) => cs.join(''));

/** Four-digit year string in the inclusive range [2000, 2100]. */
const yearArb = fc.integer({ min: 2000, max: 2100 }).map((n) => String(n));

const seasonArb = fc.constantFrom(...VALID_SEASONS);

/** 1–3 distinct roles, each with a valid (1–100 char) identityText. */
const allowedRolesArb = fc
  .subarray([...VALID_ROLES], { minLength: 1, maxLength: 3 })
  .chain((roles) =>
    fc
      .array(textArb(1, 100), {
        minLength: roles.length,
        maxLength: roles.length,
      })
      .map((texts) =>
        roles.map((role, i) => ({ role, identityText: texts[i] })),
      ),
  );

/** Whitespace-only (non-empty) string: not "absent" but trims to length 0. */
const whitespaceArb = fc.constantFrom(' ', '  ', '   ', '\t', '\n', ' \t ');

/** A fully valid association input. */
const validInputArb = fc.record({
  activityId: textArb(1, 40),
  eventName: textArb(1, 200),
  eventPrefix: eventPrefixArb,
  year: yearArb,
  season: seasonArb,
  allowedRoles: allowedRolesArb,
  eventLocation: fc.option(textArb(1, 200), { nil: undefined }),
  issuingOrganization: fc.option(textArb(1, 200), { nil: undefined }),
});

// ============================================================
// Arbitraries — inputs that violate exactly one constraint
// ============================================================

/** Non-empty string that fails the event-prefix grammar. */
const badPrefixArb = fc
  .string({ minLength: 1, maxLength: 25 })
  .filter((s) => s.length > 0 && !EVENT_PREFIX_REGEX.test(s));

/** Four-digit year string outside [2000, 2100]. */
const outOfRangeYearArb = fc
  .oneof(fc.integer({ min: 0, max: 1999 }), fc.integer({ min: 2101, max: 9999 }))
  .map((n) => String(n).padStart(4, '0'));

/** Year string that is not exactly four digits. */
const nonFourDigitYearArb = fc.oneof(
  fc.integer({ min: 0, max: 999 }).map((n) => String(n)),
  fc.integer({ min: 10000, max: 99999 }).map((n) => String(n)),
);

/** Non-empty string that is not one of the four valid seasons. */
const badSeasonArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => !(VALID_SEASONS as readonly string[]).includes(s));

/** Non-empty string that is not a valid Source_Role. */
const badRoleArb = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => !(VALID_ROLES as readonly string[]).includes(s));

function omit<T extends object>(obj: T, key: keyof T): Partial<T> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}

/** Inputs that violate exactly one constraint → expect INVALID_REQUEST. */
const invalidRequestArb = validInputArb.chain((base) =>
  fc.oneof(
    // eventPrefix not matching grammar
    badPrefixArb.map((eventPrefix) => ({ ...base, eventPrefix })),
    // year 4-digit but out of range
    outOfRangeYearArb.map((year) => ({ ...base, year })),
    // year not 4 digits
    nonFourDigitYearArb.map((year) => ({ ...base, year })),
    // season not in the allowed set
    badSeasonArb.map((season) => ({ ...base, season })),
    // eventName over-length (>200 after trim)
    textArb(201, 220).map((eventName) => ({ ...base, eventName })),
    // eventName whitespace-only (trims to length 0)
    whitespaceArb.map((eventName) => ({ ...base, eventName })),
    // allowedRoles has more than 3 items
    fc.constant({
      ...base,
      allowedRoles: [
        { role: 'Speaker', identityText: 'a' },
        { role: 'UserGroupLeader', identityText: 'b' },
        { role: 'Volunteer', identityText: 'c' },
        { role: 'Speaker', identityText: 'd' },
      ],
    }),
    // duplicate role within allowedRoles
    fc.constant({
      ...base,
      allowedRoles: [
        { role: 'Speaker', identityText: 'a' },
        { role: 'Speaker', identityText: 'b' },
      ],
    }),
    // illegal role value
    badRoleArb.map((role) => ({
      ...base,
      allowedRoles: [{ role, identityText: 'x' }],
    })),
    // identityText over-length (>100 after trim)
    textArb(101, 120).map((identityText) => ({
      ...base,
      allowedRoles: [{ role: 'Speaker', identityText }],
    })),
    // identityText whitespace-only (trims to length 0)
    whitespaceArb.map((identityText) => ({
      ...base,
      allowedRoles: [{ role: 'Speaker', identityText }],
    })),
    // eventLocation provided but over-length
    textArb(201, 220).map((eventLocation) => ({ ...base, eventLocation })),
    // issuingOrganization provided but over-length
    textArb(201, 220).map((issuingOrganization) => ({
      ...base,
      issuingOrganization,
    })),
  ),
);

/** Inputs missing a required field → expect MISSING_REQUIRED_FIELD. */
const missingFieldArb = validInputArb.chain((base) =>
  fc.oneof(
    fc.constant(omit(base, 'activityId')),
    fc.constant({ ...base, activityId: '' }),
    fc.constant(omit(base, 'eventName')),
    fc.constant(omit(base, 'eventPrefix')),
    fc.constant(omit(base, 'year')),
    fc.constant(omit(base, 'season')),
    fc.constant(omit(base, 'allowedRoles')),
    fc.constant({ ...base, allowedRoles: [] }),
    // identityText absent within an otherwise valid role
    fc.constant({
      ...base,
      allowedRoles: [{ role: 'Speaker', identityText: '' }],
    }),
    fc.constant({ ...base, allowedRoles: [{ role: 'Speaker' }] }),
  ),
);

// ============================================================
// Property 2
// ============================================================

describe('Property 2: 关联输入校验正确性', () => {
  it('全部约束满足时判定合法，并回填 roleCode / locale / issuingOrganization 默认值', () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const result = validateAssociationInput(input);

        expect(result.valid).toBe(true);
        if (!result.valid) return; // narrow for type-checker

        const { normalized } = result;

        // locale is fixed to 'en'
        expect(normalized.locale).toBe('en');

        // roleCode backfilled per SOURCE_ROLE_CODES; roles preserved
        expect(normalized.allowedRoles.map((r) => r.role)).toEqual(
          input.allowedRoles.map((r) => r.role),
        );
        for (const ar of normalized.allowedRoles) {
          expect(ar.roleCode).toBe(SOURCE_ROLE_CODES[ar.role]);
        }

        // issuingOrganization defaults when omitted, otherwise trimmed value
        if (input.issuingOrganization === undefined) {
          expect(normalized.issuingOrganization).toBe(
            DEFAULT_ISSUING_ORGANIZATION,
          );
        } else {
          expect(normalized.issuingOrganization).toBe(
            input.issuingOrganization.trim(),
          );
        }

        // optional eventLocation passthrough
        if (input.eventLocation === undefined) {
          expect(normalized.eventLocation).toBeUndefined();
        } else {
          expect(normalized.eventLocation).toBe(input.eventLocation.trim());
        }

        // sanity: the validated fields satisfy their constraints
        expect(normalized.eventName.length).toBeGreaterThanOrEqual(1);
        expect(normalized.eventName.length).toBeLessThanOrEqual(200);
        expect(EVENT_PREFIX_REGEX.test(normalized.eventPrefix)).toBe(true);
        expect(YEAR_REGEX.test(normalized.year)).toBe(true);
        const yearNum = parseInt(normalized.year, 10);
        expect(yearNum).toBeGreaterThanOrEqual(2000);
        expect(yearNum).toBeLessThanOrEqual(2100);
        expect(VALID_SEASONS).toContain(normalized.season);
        expect(normalized.allowedRoles.length).toBeGreaterThanOrEqual(1);
        expect(normalized.allowedRoles.length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 100 },
    );
  });

  it('违反单个字段约束时返回 INVALID_REQUEST 描述性错误且无规范化结果', () => {
    fc.assert(
      fc.property(invalidRequestArb, (input) => {
        const result = validateAssociationInput(input);

        expect(result.valid).toBe(false);
        if (result.valid) return; // narrow for type-checker

        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(typeof result.error.message).toBe('string');
        expect(result.error.message.length).toBeGreaterThan(0);
        // no normalized result is produced on failure
        expect('normalized' in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('缺失必填字段时返回 MISSING_REQUIRED_FIELD 描述性错误且无规范化结果', () => {
    fc.assert(
      fc.property(missingFieldArb, (input) => {
        const result = validateAssociationInput(input);

        expect(result.valid).toBe(false);
        if (result.valid) return; // narrow for type-checker

        expect(result.error.code).toBe('MISSING_REQUIRED_FIELD');
        expect(typeof result.error.message).toBe('string');
        expect(result.error.message.length).toBeGreaterThan(0);
        // no normalized result is produced on failure
        expect('normalized' in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: credential-self-application, Property 10: 关联管理操作仅限 SuperAdmin
//
// For any role set, creating / editing / deleting an Activity_Template_Association
// is permitted *if and only if* the role set contains 'SuperAdmin'. For any role
// set lacking 'SuperAdmin' (including undefined / empty), the authorization gate
// (`assertSuperAdmin`) returns authorized:false with statusCode 403 and a
// FORBIDDEN code — so the caller rejects the request BEFORE invoking any CRUD
// function, meaning no association is created, modified, or deleted (proven by a
// spy DynamoDB client whose `send` is never reached on the unauthorized path).
//
// Validates: Requirements 2.8, 2.9, 9.7, 9.8

// --- Role pools ---------------------------------------------------------------

/** Plausible non-SuperAdmin roles in this system. */
const NON_SUPERADMIN_ROLES = [
  'Admin',
  'User',
  'Leader',
  'UserGroupLeader',
  'Speaker',
  'Volunteer',
  'Moderator',
  'Editor',
  'Guest',
];

/** Full pool including SuperAdmin — for fully-random role sets. */
const ROLE_POOL = ['SuperAdmin', ...NON_SUPERADMIN_ROLES];

/** Role sets that are GUARANTEED to contain 'SuperAdmin' (inserted anywhere). */
const rolesWithSuperAdminArb: fc.Arbitrary<string[]> = fc
  .subarray(NON_SUPERADMIN_ROLES)
  .chain((others) =>
    fc.integer({ min: 0, max: others.length }).map((idx) => {
      const roles = [...others];
      roles.splice(idx, 0, 'SuperAdmin');
      return roles;
    }),
  );

/** Role sets that are GUARANTEED to exclude 'SuperAdmin' (may be empty). */
const rolesWithoutSuperAdminArb: fc.Arbitrary<string[]> =
  fc.subarray(NON_SUPERADMIN_ROLES);

/** Fully-random role sets drawn from the full pool (either branch may occur). */
const randomRolesArb: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(...ROLE_POOL),
  { maxLength: 6 },
);

// --- Gate + spy modelling the handler's SuperAdmin enforcement ----------------

/** A minimal, fully valid association input so create/update pass validation. */
const VALID_ASSOCIATION_INPUT = {
  activityId: 'act-001',
  eventName: 'AWS Community Day',
  eventPrefix: 'ACD',
  year: '2026',
  season: 'Summer',
  allowedRoles: [{ role: 'Speaker', identityText: 'Speaker' }],
};

/**
 * Spy DynamoDBDocumentClient that records how many times `send` is invoked, so
 * the unauthorized path can assert ZERO persistence calls (no association
 * touched). Returns a benign empty response for whichever command runs.
 */
function makeSpyClient(): {
  client: DynamoDBDocumentClient;
  getSendCount: () => number;
} {
  let sendCount = 0;
  const client = {
    send: async () => {
      sendCount += 1;
      return {} as Record<string, never>;
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, getSendCount: () => sendCount };
}

type MutationOp = 'create' | 'update' | 'delete';
const MUTATION_OPS: MutationOp[] = ['create', 'update', 'delete'];

/**
 * Mirror the handler's enforcement: authorize first, and only invoke the real
 * CRUD function when authorized. Returns whether the request was rejected at the
 * gate (with status/code) without ever touching DynamoDB.
 */
async function runGatedMutation(
  roles: readonly string[] | undefined,
  op: MutationOp,
  client: DynamoDBDocumentClient,
): Promise<
  | { rejected: true; statusCode: number; code: string }
  | { rejected: false }
> {
  const auth = assertSuperAdmin(roles);
  if (!auth.authorized) {
    // Caller rejects here — no CRUD function is ever called.
    return { rejected: true, statusCode: auth.statusCode, code: auth.code };
  }

  // Authorized → the operation proceeds to the persistence layer.
  if (op === 'create') {
    await createAssociation({
      input: VALID_ASSOCIATION_INPUT,
      createdBy: 'u-admin',
      dynamoClient: client,
      associationsTable: 'Assoc',
      activitiesTable: 'Activities',
    });
  } else if (op === 'update') {
    await updateAssociation({
      associationId: 'assoc-1',
      input: VALID_ASSOCIATION_INPUT,
      updatedBy: 'u-admin',
      dynamoClient: client,
      associationsTable: 'Assoc',
      activitiesTable: 'Activities',
    });
  } else {
    await deleteAssociation({
      associationId: 'assoc-1',
      dynamoClient: client,
      associationsTable: 'Assoc',
    });
  }
  return { rejected: false };
}

describe('Property 10: 关联管理操作仅限 SuperAdmin', () => {
  it('授权当且仅当角色集合含 SuperAdmin（iff）', () => {
    fc.assert(
      fc.property(randomRolesArb, (roles) => {
        const auth = assertSuperAdmin(roles);
        // The biconditional: authorized exactly when 'SuperAdmin' is present.
        expect(auth.authorized).toBe(roles.includes('SuperAdmin'));
      }),
      { numRuns: 100 },
    );
  });

  it('含 SuperAdmin 的任意角色集合：授权通过', () => {
    fc.assert(
      fc.property(rolesWithSuperAdminArb, (roles) => {
        const auth = assertSuperAdmin(roles);
        expect(auth.authorized).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('不含 SuperAdmin 的任意角色集合：返回 403 FORBIDDEN', () => {
    fc.assert(
      fc.property(rolesWithoutSuperAdminArb, (roles) => {
        const auth = assertSuperAdmin(roles);
        expect(auth.authorized).toBe(false);
        if (auth.authorized) return; // narrow for type-checker
        expect(auth.statusCode).toBe(403);
        expect(auth.code).toBe('FORBIDDEN');
        expect(typeof auth.message).toBe('string');
        expect(auth.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('undefined / 空角色集合：返回 403 FORBIDDEN', () => {
    for (const roles of [undefined, []] as Array<string[] | undefined>) {
      const auth = assertSuperAdmin(roles);
      expect(auth.authorized).toBe(false);
      if (auth.authorized) continue;
      expect(auth.statusCode).toBe(403);
      expect(auth.code).toBe('FORBIDDEN');
    }
  });

  it('不含 SuperAdmin 时：创建/编辑/删除均被拒，且不触碰任何关联（零持久化调用）', async () => {
    await fc.assert(
      fc.asyncProperty(
        rolesWithoutSuperAdminArb,
        fc.constantFrom(...MUTATION_OPS),
        async (roles, op) => {
          const { client, getSendCount } = makeSpyClient();
          const outcome = await runGatedMutation(roles, op, client);

          // Rejected at the gate with a 403 FORBIDDEN.
          expect(outcome.rejected).toBe(true);
          if (!outcome.rejected) return; // narrow
          expect(outcome.statusCode).toBe(403);
          expect(outcome.code).toBe('FORBIDDEN');

          // No CRUD function was invoked → DynamoDB was never touched, so no
          // association was created, modified, or deleted.
          expect(getSendCount()).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('含 SuperAdmin 时：创建/编辑/删除被放行，操作进入持久化层', async () => {
    await fc.assert(
      fc.asyncProperty(
        rolesWithSuperAdminArb,
        fc.constantFrom(...MUTATION_OPS),
        async (roles, op) => {
          const { client, getSendCount } = makeSpyClient();
          const outcome = await runGatedMutation(roles, op, client);

          // Authorized → not rejected at the gate; the operation proceeded to
          // the persistence layer (at least one DynamoDB call was made).
          expect(outcome.rejected).toBe(false);
          expect(getSendCount()).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
