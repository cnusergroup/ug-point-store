import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeEligibleApplications } from './eligibility';
import { SOURCE_ROLE_CODES } from './types';
import type {
  ActivityTemplateAssociation,
  CredentialStatus,
  SourceRole,
} from './types';

// Feature: credential-self-application, Property 3: 资格判定正确性
//
// For any set of identity points records, activity→association map and applied
// credential set, computeEligibleApplications marks a given (activity, Source_Role)
// triple as EXACTLY ONE eligible item if and only if:
//   - at least one identity points record exists for that activity+role
//     (targetRole ∈ {Speaker, UserGroupLeader, Volunteer} with a non-empty activityId),
//   - the activity has an association, and
//   - that role is in the association's allowedRoles.
// Records with targetRole = 'SpecialActivity' or an empty activityId NEVER produce
// an eligible item; multiple records for the same triple produce only ONE item
// (dedup); a triple with an existing applied credential (active OR revoked) is
// marked applied = true with credentialId/status, otherwise applied = false.
// identityText equals the matching allowedRoles entry's identityText, and eventName
// equals the association's eventName.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

const ALL_SOURCE_ROLES: SourceRole[] = ['Speaker', 'UserGroupLeader', 'Volunteer'];
const VALID_ROLES = new Set<string>(ALL_SOURCE_ROLES);

/** Small fixed pool of activity IDs so collisions / duplicates occur frequently. */
const ACTIVITY_POOL = ['act-1', 'act-2', 'act-3'];

/** Builds a fully-formed (valid) association; only eventName / allowedRoles vary. */
function makeAssociation(
  activityId: string,
  eventName: string,
  allowedRoles: ActivityTemplateAssociation['allowedRoles'],
): ActivityTemplateAssociation {
  return {
    associationId: `assoc-${activityId}`,
    activityId,
    eventName,
    eventPrefix: 'ACD',
    year: '2026',
    season: 'Summer',
    allowedRoles,
    locale: 'en',
    issuingOrganization: 'AWS User Group China',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
  };
}

/** allowedRoles: a non-empty distinct subset of source roles, each with its own
 *  generated identityText (so the test can confirm the correct text is selected). */
const allowedRolesArb = fc
  .subarray(ALL_SOURCE_ROLES, { minLength: 1, maxLength: 3 })
  .chain((roles) =>
    fc
      .tuple(...roles.map(() => fc.string({ minLength: 1, maxLength: 30 })))
      .map((texts) =>
        roles.map((role, i) => ({
          role,
          roleCode: SOURCE_ROLE_CODES[role],
          identityText: texts[i],
        })),
      ),
  );

const associationBodyArb = (activityId: string) =>
  fc
    .record({
      eventName: fc.string({ minLength: 1, maxLength: 50 }),
      allowedRoles: allowedRolesArb,
    })
    .map(({ eventName, allowedRoles }) =>
      makeAssociation(activityId, eventName, allowedRoles),
    );

/** A Map<activityId, association> covering a random subset of the activity pool,
 *  so some activities have associations and some do not (exercises req 3.5). */
const associationsArb = fc
  .subarray(ACTIVITY_POOL, { minLength: 0, maxLength: ACTIVITY_POOL.length })
  .chain((activityIds) =>
    fc
      .tuple(...activityIds.map((aid) => associationBodyArb(aid)))
      .map((assocs) => {
        const map = new Map<string, ActivityTemplateAssociation>();
        for (const a of assocs) map.set(a.activityId, a);
        return map;
      }),
  );

/** Identity points records: valid source roles plus SpecialActivity, and an
 *  empty activityId option (both of which must never yield eligible items). */
type TestRecord = { activityId: string; targetRole: string };
const recordArb: fc.Arbitrary<TestRecord> = fc.record({
  activityId: fc.constantFrom(...ACTIVITY_POOL, ''),
  targetRole: fc.constantFrom(
    'Speaker',
    'UserGroupLeader',
    'Volunteer',
    'SpecialActivity',
  ),
});
const recordsArb = fc.array(recordArb, { maxLength: 30 });

/** Applied credentials referencing (activity, role) triples, some matching
 *  eligible triples, some not, possibly duplicated. */
const appliedCredentialArb = fc.record({
  sourceActivityId: fc.constantFrom(...ACTIVITY_POOL),
  sourceRole: fc.constantFrom(...ALL_SOURCE_ROLES),
  credentialId: fc.string({ minLength: 1, maxLength: 12 }),
  status: fc.constantFrom<CredentialStatus>('active', 'revoked'),
});
const appliedCredentialsArb = fc.array(appliedCredentialArb, { maxLength: 12 });

const tripleKey = (activityId: string, role: string) => `${activityId}#${role}`;

/** Independent reference computation derived directly from the spec conditions. */
function referenceEligible(
  records: TestRecord[],
  associationsByActivityId: Map<string, ActivityTemplateAssociation>,
  appliedCredentials: Array<{
    sourceActivityId: string;
    sourceRole: SourceRole;
    credentialId: string;
    status: CredentialStatus;
  }>,
) {
  // First applied credential per triple wins.
  const appliedByTriple = new Map<
    string,
    { credentialId: string; status: CredentialStatus }
  >();
  for (const c of appliedCredentials) {
    const k = tripleKey(c.sourceActivityId, c.sourceRole);
    if (!appliedByTriple.has(k)) {
      appliedByTriple.set(k, { credentialId: c.credentialId, status: c.status });
    }
  }

  const expected = new Map<
    string,
    {
      activityId: string;
      sourceRole: string;
      eventName: string;
      identityText: string;
      applied: boolean;
      credentialId?: string;
      status?: CredentialStatus;
    }
  >();

  for (const r of records) {
    if (!r.activityId) continue; // no activityId → never eligible
    if (!VALID_ROLES.has(r.targetRole)) continue; // SpecialActivity / junk → excluded
    const k = tripleKey(r.activityId, r.targetRole);
    if (expected.has(k)) continue; // dedup: one item per triple

    const assoc = associationsByActivityId.get(r.activityId);
    if (!assoc) continue; // no association → not eligible
    const allowed = assoc.allowedRoles.find((x) => x.role === r.targetRole);
    if (!allowed) continue; // role not allowed → not eligible

    const applied = appliedByTriple.get(k);
    expected.set(k, {
      activityId: r.activityId,
      sourceRole: r.targetRole,
      eventName: assoc.eventName,
      identityText: allowed.identityText,
      applied: !!applied,
      credentialId: applied?.credentialId,
      status: applied?.status,
    });
  }

  return expected;
}

describe('Property 3: 资格判定正确性', () => {
  it('输出与独立参考计算完全一致（iff 条件、eventName/identityText、已申请标记）', () => {
    fc.assert(
      fc.property(
        recordsArb,
        associationsArb,
        appliedCredentialsArb,
        (records, associationsByActivityId, appliedCredentials) => {
          const actual = computeEligibleApplications({
            identityPointsRecords: records as Array<{
              activityId: string;
              targetRole: SourceRole;
            }>,
            associationsByActivityId,
            appliedCredentials,
          });

          const expected = referenceEligible(
            records,
            associationsByActivityId,
            appliedCredentials,
          );

          // Exactly one item per qualifying triple, no duplicate triples.
          const actualKeys = actual.map((it) =>
            tripleKey(it.activityId, it.sourceRole),
          );
          expect(new Set(actualKeys).size).toBe(actual.length);
          expect(actual.length).toBe(expected.size);

          for (const it of actual) {
            const k = tripleKey(it.activityId, it.sourceRole);
            const exp = expected.get(k);
            expect(exp).toBeDefined();
            expect(it.eventName).toBe(exp!.eventName);
            expect(it.identityText).toBe(exp!.identityText);
            expect(it.applied).toBe(exp!.applied);
            if (exp!.applied) {
              expect(it.credentialId).toBe(exp!.credentialId);
              expect(it.status).toBe(exp!.status);
            } else {
              expect(it.credentialId).toBeUndefined();
              expect(it.status).toBeUndefined();
            }
            // Output never contains an excluded record's footprint.
            expect(it.activityId).not.toBe('');
            expect(ALL_SOURCE_ROLES).toContain(it.sourceRole);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('SpecialActivity 记录与无 activityId 记录绝不产生可申请项', () => {
    fc.assert(
      fc.property(
        // Only excluded records: SpecialActivity, or empty activityId (any role).
        fc.array(
          fc.oneof(
            fc.record({
              activityId: fc.constantFrom(...ACTIVITY_POOL),
              targetRole: fc.constant('SpecialActivity'),
            }),
            fc.record({
              activityId: fc.constant(''),
              targetRole: fc.constantFrom(
                'Speaker',
                'UserGroupLeader',
                'Volunteer',
                'SpecialActivity',
              ),
            }),
          ),
          { maxLength: 20 },
        ),
        associationsArb,
        (records, associationsByActivityId) => {
          const actual = computeEligibleApplications({
            identityPointsRecords: records as Array<{
              activityId: string;
              targetRole: SourceRole;
            }>,
            associationsByActivityId,
            appliedCredentials: [],
          });
          expect(actual).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('同一三元组的多条记录只产生一个可申请项', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTIVITY_POOL),
        fc.constantFrom(...ALL_SOURCE_ROLES),
        fc.integer({ min: 1, max: 8 }),
        associationBodyArb('act-1'),
        (activityId, role, count, baseAssoc) => {
          // Force the activity to have an association that allows this role.
          const assoc = makeAssociation(activityId, baseAssoc.eventName, [
            {
              role,
              roleCode: SOURCE_ROLE_CODES[role],
              identityText: `text-${role}`,
            },
          ]);
          const associationsByActivityId = new Map([[activityId, assoc]]);

          // N duplicate records for the same triple.
          const records = Array.from({ length: count }, () => ({
            activityId,
            targetRole: role,
          }));

          const actual = computeEligibleApplications({
            identityPointsRecords: records,
            associationsByActivityId,
            appliedCredentials: [],
          });

          expect(actual).toHaveLength(1);
          expect(actual[0].activityId).toBe(activityId);
          expect(actual[0].sourceRole).toBe(role);
          expect(actual[0].applied).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('已存在证书（active 或 revoked）的三元组被标记为已申请', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTIVITY_POOL),
        fc.constantFrom(...ALL_SOURCE_ROLES),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom<CredentialStatus>('active', 'revoked'),
        (activityId, role, credentialId, status) => {
          const assoc = makeAssociation(activityId, 'Event', [
            {
              role,
              roleCode: SOURCE_ROLE_CODES[role],
              identityText: `text-${role}`,
            },
          ]);
          const associationsByActivityId = new Map([[activityId, assoc]]);

          const actual = computeEligibleApplications({
            identityPointsRecords: [{ activityId, targetRole: role }],
            associationsByActivityId,
            appliedCredentials: [
              { sourceActivityId: activityId, sourceRole: role, credentialId, status },
            ],
          });

          expect(actual).toHaveLength(1);
          expect(actual[0].applied).toBe(true);
          expect(actual[0].credentialId).toBe(credentialId);
          expect(actual[0].status).toBe(status);
        },
      ),
      { numRuns: 100 },
    );
  });
});
