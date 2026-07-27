/**
 * Fixture: control for the hidden-verdict demonstration.
 *
 * Identical violated property to `hidden-verdict-unawaited.fixture.ts`, but in the correct shape:
 * `async` callback plus `await fc.assert(...)`. This is what the fixed corpus must look like, and
 * its child run is the reference verdict the un-awaited run is compared against.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('fixture: hidden verdict (awaited async property)', () => {
  it('violated async property in an async callback', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (n) => {
        await Promise.resolve();
        // Always false: the property is violated on every run.
        expect(n, 'DELIBERATE_VIOLATION').toBeLessThan(0);
      }),
      { numRuns: 10 },
    );
  });
});
