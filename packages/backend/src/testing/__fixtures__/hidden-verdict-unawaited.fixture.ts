/**
 * Fixture: Bug Condition A, hidden verdict.
 *
 * A deliberately violated `fc.asyncProperty` handed to `fc.assert` inside a NON-async callback,
 * with the returned Promise never awaited. This is the exact C_A shape.
 *
 * Run by `property-await-hidden-verdict.test.ts` in a child Vitest process. Never run as part of
 * the main suite: the file is `*.fixture.ts`, outside the corpus `include` patterns.
 *
 * NOTE: the un-awaited assertion here is intentional. Do NOT "fix" it.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('fixture: hidden verdict (un-awaited async property)', () => {
  it('violated async property in a non-async callback', () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (n) => {
        await Promise.resolve();
        // Always false: the property is violated on every run.
        expect(n, 'DELIBERATE_VIOLATION').toBeLessThan(0);
      }),
      { numRuns: 10 },
    );
  });
});
