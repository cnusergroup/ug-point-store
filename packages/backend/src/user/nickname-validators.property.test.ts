import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateNickname } from './nickname-validators';
import { ErrorCodes } from '@points-mall/shared';

// ============================================================
// Arbitraries
// ============================================================

/** Control character ranges: U+0000–U+001F, U+007F, U+0080–U+009F */
const controlCharArb = fc.oneof(
  fc.integer({ min: 0x00, max: 0x1f }).map(c => String.fromCharCode(c)),
  fc.constant(String.fromCharCode(0x7f)),
  fc.integer({ min: 0x80, max: 0x9f }).map(c => String.fromCharCode(c)),
);

/** Arbitrary for a single non-control Unicode character (BMP, excluding control ranges) */
const nonControlCharArb = fc.oneof(
  // Printable ASCII (space through ~)
  fc.integer({ min: 0x20, max: 0x7e }).map(c => String.fromCharCode(c)),
  // Non-control range above ASCII (0xA0 to 0xD7FF to avoid surrogates)
  fc.integer({ min: 0xa0, max: 0xd7ff }).map(c => String.fromCharCode(c)),
  // Above surrogates (0xE000 to 0xFFFF)
  fc.integer({ min: 0xe000, max: 0xffff }).map(c => String.fromCharCode(c)),
);

/** Arbitrary for a valid nickname string (1–20 codepoints, no control chars) */
const validNicknameArb = fc
  .array(nonControlCharArb, { minLength: 1, maxLength: 20 })
  .map(chars => chars.join(''));

/** Arbitrary for whitespace padding */
const whitespacePaddingArb = fc.string({
  unit: fc.constantFrom(' ', '\t'),
  minLength: 0,
  maxLength: 5,
});

// ============================================================
// Helper: check if string contains control characters
// ============================================================

function hasControlChars(s: string): boolean {
  return /[\x00-\x1F\x7F\u0080-\u009F]/.test(s);
}

function codepointLength(s: string): number {
  return [...s].length;
}

// ============================================================
// Property 1: Nickname format validation
// Feature: nickname-change, Property 1: Nickname format validation
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
// ============================================================

describe('Feature: nickname-change, Property 1: Nickname format validation', () => {
  it('validateNickname accepts iff trimmed value has 1–20 codepoints and no control chars', () => {
    fc.assert(
      fc.property(
        // Generate random Unicode strings of varying lengths 0–50
        fc.string({ minLength: 0, maxLength: 50 }),
        whitespacePaddingArb,
        whitespacePaddingArb,
        (core, leadingWs, trailingWs) => {
          const input = leadingWs + core + trailingWs;
          const result = validateNickname(input);
          const trimmed = input.trim();
          const len = codepointLength(trimmed);

          // Result trimmed value should match actual trimmed value
          expect(result.trimmed).toBe(trimmed);

          if (len === 0) {
            // Should be invalid: empty
            expect(result.valid).toBe(false);
            expect(result.error?.code).toBe(ErrorCodes.NICKNAME_EMPTY);
          } else if (len > 20) {
            // Should be invalid: too long
            expect(result.valid).toBe(false);
            expect(result.error?.code).toBe(ErrorCodes.NICKNAME_TOO_LONG);
          } else if (hasControlChars(trimmed)) {
            // Should be invalid: control chars
            expect(result.valid).toBe(false);
            expect(result.error?.code).toBe(ErrorCodes.NICKNAME_INVALID_CHARS);
          } else {
            // Should be valid
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('valid nicknames (1–20 codepoints, no control chars) are always accepted', () => {
    fc.assert(
      fc.property(
        validNicknameArb,
        whitespacePaddingArb,
        whitespacePaddingArb,
        (nickname, leadingWs, trailingWs) => {
          const input = leadingWs + nickname + trailingWs;
          const result = validateNickname(input);
          expect(result.valid).toBe(true);
          expect(result.trimmed).toBe(input.trim());
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('error priority: NICKNAME_EMPTY takes precedence over NICKNAME_TOO_LONG and NICKNAME_INVALID_CHARS', () => {
    fc.assert(
      fc.property(
        whitespacePaddingArb,
        whitespacePaddingArb,
        (leadingWs, trailingWs) => {
          // Input that trims to empty — should always be NICKNAME_EMPTY
          const input = leadingWs + trailingWs;
          const result = validateNickname(input);
          if (input.trim().length === 0) {
            expect(result.valid).toBe(false);
            expect(result.error?.code).toBe(ErrorCodes.NICKNAME_EMPTY);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('error priority: NICKNAME_TOO_LONG takes precedence over NICKNAME_INVALID_CHARS for long strings with control chars', () => {
    fc.assert(
      fc.property(
        // Generate a string > 20 codepoints that also contains control chars
        fc.array(nonControlCharArb, { minLength: 19, maxLength: 45 }),
        controlCharArb,
        fc.integer({ min: 0, max: 19 }),
        (baseChars, ctrlChar, insertPos) => {
          // Insert control char somewhere in the string
          const chars = [...baseChars];
          const pos = Math.min(insertPos, chars.length);
          chars.splice(pos, 0, ctrlChar);

          // Make sure total codepoints > 20 AFTER TRIM (validateNickname trims first)
          const trimmed = chars.join('').trim();
          if (codepointLength(trimmed) <= 20) {
            // Pad with non-space chars to exceed 20 after trim
            while (codepointLength(chars.join('').trim()) <= 20) {
              chars.push('a');
            }
          }

          const input = chars.join('');
          const result = validateNickname(input);

          // Should be TOO_LONG (priority over INVALID_CHARS)
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NICKNAME_TOO_LONG);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('strings with only control chars and length 1–20 get NICKNAME_INVALID_CHARS', () => {
    fc.assert(
      fc.property(
        fc.array(controlCharArb, { minLength: 1, maxLength: 20 }),
        (ctrlChars) => {
          const input = ctrlChars.join('');
          // Only proceed if trim doesn't make it empty
          // (control chars like \t and \n may be trimmed away)
          const trimmed = input.trim();
          if (trimmed.length > 0 && codepointLength(trimmed) <= 20) {
            const result = validateNickname(input);
            expect(result.valid).toBe(false);
            expect(result.error?.code).toBe(ErrorCodes.NICKNAME_INVALID_CHARS);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('whitespace-only inputs are rejected with NICKNAME_EMPTY', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\r'), minLength: 1, maxLength: 30 }),
        (wsOnly) => {
          const result = validateNickname(wsOnly);
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NICKNAME_EMPTY);
        },
      ),
      { numRuns: 100 },
    );
  });
});
