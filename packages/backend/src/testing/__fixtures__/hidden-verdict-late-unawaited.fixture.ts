/**
 * Fixture: Bug Condition A, hidden verdict where the rejection lands AFTER the run has finished.
 *
 * Same C_A shape as `hidden-verdict-unawaited.fixture.ts`, but the violation is delayed so the
 * orphaned property's rejection arrives after Vitest has already reported the run. This is the
 * variant that probes hypothesis A.3: whether the unhandled rejection is advisory (run stays green,
 * exit code 0) or whether Vitest catches it in time and exits non-zero.
 *
 * NOTE: the un-awaited assertion here is intentional. Do NOT "fix" it.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('fixture: hidden verdict, late rejection (un-awaited async property)', () => {
  it('violated async property whose rejection lands after the run ends', () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (n) => {
        await sleep(1500);
        expect(n, 'DELIBERATE_VIOLATION_LATE').toBeLessThan(0);
      }),
      { numRuns: 1 },
    );
  });
});
