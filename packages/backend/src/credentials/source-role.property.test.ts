import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveRoleCode } from './association';
import { SOURCE_ROLE_CODES, type SourceRole } from './types';

// Feature: credential-self-application, Property 1: 角色代码派生固定且全覆盖
//
// For any Source_Role (one of Speaker / Volunteer / UserGroupLeader),
// deriveRoleCode returns a fixed Role_Code mapping:
//   Speaker → SPK, Volunteer → VOL, UserGroupLeader → UGL.
// For any string outside that set, deriveRoleCode either throws or otherwise
// fails to produce a valid code (the implementation throws a descriptive
// error). The mapping is total over the Source_Role set (full coverage) and
// deterministic (fixed).
//
// Validates: Requirements 1.4, 2.4, 6.4

/** The complete, fixed Source_Role → Role_Code mapping under test. */
const FIXED_MAPPING: Record<SourceRole, string> = {
  Speaker: 'SPK',
  Volunteer: 'VOL',
  UserGroupLeader: 'UGL',
};

/** The three valid Source_Role values. */
const VALID_SOURCE_ROLES = Object.keys(FIXED_MAPPING) as SourceRole[];

/** The set of valid Role_Codes a successful derivation may yield. */
const VALID_CODES = new Set(Object.values(FIXED_MAPPING)); // {SPK, VOL, UGL}

/** Arbitrary drawing exactly from the Source_Role set. */
const sourceRoleArb = fc.constantFrom(...VALID_SOURCE_ROLES);

describe('Property 1: 角色代码派生固定且全覆盖', () => {
  it('对 Speaker/Volunteer/UserGroupLeader 恒返回 SPK/VOL/UGL（固定且确定）', () => {
    fc.assert(
      fc.property(sourceRoleArb, (role) => {
        const code = deriveRoleCode(role);
        // Fixed mapping: the derived code equals the expected constant.
        expect(code).toBe(FIXED_MAPPING[role]);
        // Determinism: repeated derivation yields the identical code.
        expect(deriveRoleCode(role)).toBe(code);
        // Consistency with the source-of-truth map exported from types.ts.
        expect(code).toBe(SOURCE_ROLE_CODES[role]);
      }),
      { numRuns: 100 },
    );
  });

  it('全覆盖：每个 Source_Role 都派生出一个非空有效代码', () => {
    // The mapping is total over the Source_Role set — no role is left
    // undefined and no two roles collide onto an empty/invalid code.
    for (const role of VALID_SOURCE_ROLES) {
      const code = deriveRoleCode(role);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it('对集合外的任意字符串：返回错误或不产生有效代码', () => {
    fc.assert(
      fc.property(
        fc
          .string()
          .filter((s) => !(VALID_SOURCE_ROLES as string[]).includes(s)),
        (notARole) => {
          // Per Property 1, out-of-set input must NOT produce a valid Role_Code:
          // deriveRoleCode either throws (error) OR returns something that is
          // not one of {SPK, VOL, UGL} (no valid code). It must never silently
          // yield a valid code for a non-role string.
          let produced: unknown;
          try {
            produced = deriveRoleCode(notARole as SourceRole);
          } catch {
            // Threw an error — acceptable ("返回错误").
            return;
          }
          // Did not throw — then the result must not be a valid code
          // ("不产生有效代码").
          expect(
            typeof produced === 'string' && VALID_CODES.has(produced),
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
