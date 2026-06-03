import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  formatCredentialId,
  parseCredentialId,
  validateCredentialId,
  type CredentialIdComponents,
} from './credential-id';

// Feature: credential-self-application, Property 6: 凭证 ID 往返一致性
//
// For any valid credential ID components (eventPrefix, year, season,
// roleCode ∈ {SPK, VOL, UGL, WKS, ORG}, sequence), formatting them into a
// string and then parsing that string yields components identical to the
// originals, with the sequence segment rendered as a 4-digit zero-padded
// number. For any string that does not match the expected format,
// parseCredentialId throws a descriptive error and validateCredentialId
// returns a descriptive error message.
//
// Validates: Requirements 6.2

/** Same grammar as CREDENTIAL_ID_REGEX in credential-id.ts (used to reject
 *  accidentally-valid strings from the invalid-string generator). */
const CREDENTIAL_ID_REGEX =
  /^([A-Z](?:[A-Z-]*[A-Z])?)-(\d{4})-(Spring|Summer|Fall|Winter)-(VOL|SPK|WKS|ORG|UGL)-(\d{4})$/;

/** Arbitrary for a valid event prefix: one or more letter-only segments
 *  joined by single hyphens (e.g. "ACD", "ACD-BASE"). Always starts and ends
 *  with an uppercase letter, satisfying the prefix grammar. */
const eventPrefixArb = fc
  .array(
    fc.stringMatching(/^[A-Z]{1,6}$/),
    { minLength: 1, maxLength: 3 },
  )
  .map((segments) => segments.join('-'));

/** Arbitrary for a 4-digit year string (zero-padded). */
const yearArb = fc
  .integer({ min: 0, max: 9999 })
  .map((n) => String(n).padStart(4, '0'));

const seasonArb = fc.constantFrom('Spring', 'Summer', 'Fall', 'Winter');

const roleCodeArb = fc.constantFrom('SPK', 'VOL', 'UGL', 'WKS', 'ORG');

/** Sequence kept within 0–9999 so it round-trips as a 4-digit zero-padded value. */
const sequenceArb = fc.integer({ min: 0, max: 9999 });

const componentsArb: fc.Arbitrary<CredentialIdComponents> = fc.record({
  eventPrefix: eventPrefixArb,
  year: yearArb,
  season: seasonArb,
  roleCode: roleCodeArb,
  sequence: sequenceArb,
});

describe('Property 6: 凭证 ID 往返一致性', () => {
  it('parseCredentialId(formatCredentialId(c)) 与原始组件完全一致（覆盖 SPK/VOL/UGL/WKS/ORG）', () => {
    fc.assert(
      fc.property(componentsArb, (components) => {
        const id = formatCredentialId(components);
        const parsed = parseCredentialId(id);
        expect(parsed).toEqual(components);
      }),
      { numRuns: 100 },
    );
  });

  it('格式化后的序号段恰为四位零填充数字', () => {
    fc.assert(
      fc.property(componentsArb, (components) => {
        const id = formatCredentialId(components);
        const segments = id.split('-');
        const sequenceSegment = segments[segments.length - 1];
        expect(sequenceSegment).toMatch(/^\d{4}$/);
        expect(sequenceSegment).toBe(String(components.sequence).padStart(4, '0'));
      }),
      { numRuns: 100 },
    );
  });

  it('非法字符串：parseCredentialId 抛出描述性错误且 validateCredentialId 返回错误', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !CREDENTIAL_ID_REGEX.test(s)),
        (invalid) => {
          // validateCredentialId reports the failure with a descriptive message.
          const result = validateCredentialId(invalid);
          expect(result.valid).toBe(false);
          expect(typeof result.error).toBe('string');
          expect(result.error!.length).toBeGreaterThan(0);

          // parseCredentialId throws with that same descriptive message.
          expect(() => parseCredentialId(invalid)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});
