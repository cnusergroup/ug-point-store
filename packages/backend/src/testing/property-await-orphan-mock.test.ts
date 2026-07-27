/**
 * Feature: property-test-await-reliability, Property 1: Async property assertions are observable
 *
 * Bug Condition A exploration, part 2: the orphaned property colliding with the mock lifecycle.
 * A child Vitest run executes `__fixtures__/orphan-mock.fixture.ts`, where two un-awaited
 * properties are still in flight when a later test's `beforeEach` calls `vi.restoreAllMocks()`.
 *
 * Recorded on UNFIXED code (Vitest 3.2.4, fast-check 4.1.1):
 *
 *   Test Files  1 passed (1)
 *         Tests  3 passed (3)
 *        Errors  2 errors
 *     exit code  1
 *
 *   Unhandled Rejection #1
 *     Caused by: TypeError: Cannot read properties of undefined (reading 'Items')
 *       at listItemsForUser packages/backend/src/testing/__fixtures__/orphan-mock-service.ts:32:53
 *     Counterexample: [["%p"]]
 *   Unhandled Rejection #2
 *     Caused by: Error: sharedClient.send must be mocked
 *       at listItemsForUser packages/backend/src/testing/__fixtures__/orphan-mock-service.ts:25:33
 *     Counterexample: [["( 8x:gg\"",""]]
 *
 * Hypothesis A.4 (mock-lifecycle collision) is CONFIRMED, for both mock styles:
 *   - a bare `vi.fn()` with `mockResolvedValueOnce(...)` (the corpus convention) is wiped by
 *     `vi.restoreAllMocks()` and then resolves to `undefined`, so the next `.Items` read throws
 *     inside the production-shaped call path - the exact misdirection described in requirement 1.3;
 *   - a `vi.spyOn(...)` is restored to the original implementation, so the in-flight property calls
 *     real code instead of the mock.
 * Both failures are attributed to the LAST test Vitest saw running, never to the test that started
 * the property, and all three tests are still reported as passed.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.3, 2.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractCounterexamples, runFixture } from './fixture-runner';

const RUN_TIMEOUT_MS = 120_000;

describe('Feature: property-test-await-reliability, Property 1: Orphaned properties outlive their test', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'defect: a later beforeEach wipes an in-flight property\'s vi.fn() mocks, misdirecting the error into the production call path',
    () => {
      const run = runFixture('orphan-mock');

      // Wrong outcome, recorded as evidence for requirements 1.1 and 1.3.
      expect(run.testsPassed, run.output).toBe(3);
      expect(run.testsFailed).toBe(0);
      expect(run.unhandledErrors).toBeGreaterThanOrEqual(1);
      expect(run.hasUnhandledRejectionNoise).toBe(true);

      // The reported symptom from the bug report, reproduced verbatim.
      expect(run.output).toContain("Cannot read properties of undefined (reading 'Items')");
      // ...and attributed to the production-shaped call path, not to the test that wiped the mock.
      expect(run.output).toContain('listItemsForUser');
      expect(run.output).toContain('orphan-mock-service.ts');

      // The vi.spyOn variant is restored to the original implementation instead.
      expect(run.output).toContain('sharedClient.send must be mocked');

      // Vitest can only blame the last test it saw, never the test that started the property.
      expect(run.output).toContain('The latest test that might');
      expect(extractCounterexamples(run.output).length).toBeGreaterThanOrEqual(1);
    },
    RUN_TIMEOUT_MS,
  );
});
