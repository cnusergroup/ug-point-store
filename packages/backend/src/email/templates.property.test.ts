import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateTemplateInput } from './templates';

// ============================================================================
// Feature: code-user-email-distribution, Property 18: 模板长度校验
//
// validateTemplateInput(subject, body) returns { valid: true } if and only if:
//   - subject length is in [1, 200], AND
//   - body length is in [1, 10000]
// Any string outside those bounds (including empty) must yield valid === false.
//
// **Validates: Requirements 7.7**
// ============================================================================

const SUBJECT_MIN = 1;
const SUBJECT_MAX = 200;
const BODY_MIN = 1;
const BODY_MAX = 10000;

// Build a string of an EXACT length using varied single-code-unit ASCII
// characters, so that String.prototype.length (used by the validator) matches
// the generated target length deterministically.
const ASCII_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%'.split('');

function fixedLengthAscii(length: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ASCII_CHARS), { minLength: length, maxLength: length })
    .map((chars) => chars.join(''));
}

describe('Feature: code-user-email-distribution, Property 18: 模板长度校验', () => {
  it('validateTemplateInput is valid iff subject length in [1,200] and body length in [1,10000]', () => {
    fc.assert(
      fc.property(
        // Span both valid and invalid ranges around each boundary.
        fc.integer({ min: 0, max: SUBJECT_MAX + 50 }),
        fc.integer({ min: 0, max: BODY_MAX + 50 }),
        (subjectLen, bodyLen) => {
          const subject = ASCII_CHARS[0].repeat(subjectLen);
          const body = ASCII_CHARS[0].repeat(bodyLen);

          const result = validateTemplateInput(subject, body);

          const subjectOk = subjectLen >= SUBJECT_MIN && subjectLen <= SUBJECT_MAX;
          const bodyOk = bodyLen >= BODY_MIN && bodyLen <= BODY_MAX;
          const expectedValid = subjectOk && bodyOk;

          expect(result.valid).toBe(expectedValid);
          // Invalid results must carry an error message; valid results must not.
          if (expectedValid) {
            expect(result.error).toBeUndefined();
          } else {
            expect(typeof result.error).toBe('string');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('holds for varied (non-uniform) content at random lengths', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SUBJECT_MAX + 10 }).chain((len) =>
          fixedLengthAscii(len).map((s) => ({ len, s })),
        ),
        fc.integer({ min: 0, max: BODY_MAX + 10 }).chain((len) =>
          fixedLengthAscii(len).map((s) => ({ len, s })),
        ),
        (subject, body) => {
          const result = validateTemplateInput(subject.s, body.s);

          const subjectOk = subject.len >= SUBJECT_MIN && subject.len <= SUBJECT_MAX;
          const bodyOk = body.len >= BODY_MIN && body.len <= BODY_MAX;

          expect(result.valid).toBe(subjectOk && bodyOk);
        },
      ),
      { numRuns: 100 },
    );
  });
});
