/**
 * Feature: property-test-await-reliability, Property 1: Async property assertions are observable
 *
 * Bug Condition A exploration, part 1: the hidden verdict. Each test spawns a child Vitest run over
 * one fixture spec and records the reported pass/fail counts, the unhandled-error count, and the
 * process exit code.
 *
 * The fixtures live in `__fixtures__/` and are named `*.fixture.ts`, so they sit outside the corpus
 * that `vitest.config.ts` discovers. That keeps their deliberately un-awaited assertions out of the
 * audit in `property-await-guard.test.ts`, and lets each fixture be observed as an isolated run.
 *
 * Recorded on UNFIXED code (Vitest 3.2.4, fast-check 4.1.1):
 *
 * | fixture                            | Tests   | Errors | exit code | violation visible as        |
 * |------------------------------------|---------|--------|-----------|-----------------------------|
 * | hidden-verdict-unawaited           | 1 passed| 1      | 1         | unhandled-rejection noise   |
 * | hidden-verdict-late-unawaited      | 1 passed| 0      | 0         | nothing at all              |
 * | hidden-verdict-awaited (control)   | 1 failed| 0      | 1         | a failed test                |
 *
 * Hypothesis A.3 ("Vitest's unhandled-rejection handling is advisory in practice") is confirmed as
 * timing-dependent, not unconditional: when the orphaned property rejects before the reporter
 * finalizes, Vitest attributes the rejection to no test, keeps the failure count at 0, but does exit
 * non-zero; when the rejection lands after the run has been reported, it disappears completely and
 * the run is green with exit code 0. In both cases the verdict of the property itself is never tied
 * to the test that owns it, which is what requirements 1.1, 1.2 and 2.2 are about.
 *
 * **Validates: Requirements 1.1, 1.2, 2.2, 2.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractCounterexamples, runFixture } from './fixture-runner';

const RUN_TIMEOUT_MS = 120_000;

describe('Feature: property-test-await-reliability, Property 1: Async property assertions are observable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'control: a violated AWAITED async property fails its own test and exits non-zero',
    () => {
      const run = runFixture('hidden-verdict-awaited');

      // This is the behavior requirements 2.2 and 2.6 demand of every converted assertion.
      expect(run.testsFailed, run.output).toBe(1);
      expect(run.testsPassed).toBe(0);
      expect(run.unhandledErrors).toBe(0);
      expect(run.hasUnhandledRejectionNoise).toBe(false);
      expect(run.exitCode).not.toBe(0);
      expect(extractCounterexamples(run.output).length).toBeGreaterThan(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'defect: a violated UN-AWAITED async property is reported as passed, the violation degrading to unhandled-rejection noise',
    () => {
      const run = runFixture('hidden-verdict-unawaited');

      // Wrong outcome, recorded as evidence for requirements 1.1 and 1.2: the owning test is
      // reported green and the run's failure total stays at zero.
      expect(run.testsPassed, run.output).toBe(1);
      expect(run.testsFailed).toBe(0);

      // The violation exists only as advisory console output, attributed to no test.
      expect(run.hasUnhandledRejectionNoise).toBe(true);
      expect(run.unhandledErrors).toBeGreaterThan(0);
      expect(run.output).toContain('DELIBERATE_VIOLATION');
      expect(extractCounterexamples(run.output).length).toBeGreaterThan(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'defect: when the orphaned rejection lands after the run is reported, the violation vanishes and the run exits 0',
    () => {
      const run = runFixture('hidden-verdict-late');

      // Wrong outcome, recorded as evidence for requirement 1.2: fully green, exit code 0, and no
      // trace of the violation anywhere in the output.
      expect(run.testsPassed, run.output).toBe(1);
      expect(run.testsFailed).toBe(0);
      expect(run.unhandledErrors).toBe(0);
      expect(run.hasUnhandledRejectionNoise).toBe(false);
      expect(run.exitCode).toBe(0);
      expect(run.output).not.toContain('DELIBERATE_VIOLATION_LATE');
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'contrast: the same violated property is a failure when awaited and a pass when not',
    () => {
      const awaited = runFixture('hidden-verdict-awaited');
      const unawaited = runFixture('hidden-verdict-unawaited');

      expect(awaited.testsFailed).toBe(1);
      expect(unawaited.testsFailed).toBe(0);
      expect(unawaited.testsPassed).toBe(1);
    },
    RUN_TIMEOUT_MS * 2,
  );
});
