/**
 * Recorded PRE-FIX (unfixed code) observations for the preservation comparison of
 * Feature: property-test-await-reliability.
 *
 * These are the targeted-invocation and prior-fix results required by requirements 3.6 and 3.7.
 * Task 6.7 re-runs exactly the same commands after the fix and compares against these numbers.
 * The only accepted post-fix difference is a change in outcome caused by the 10 intended
 * conversions in `packages/backend/src/travel/apply.property.test.ts` and
 * `packages/backend/src/travel/review.property.test.ts` surfacing a previously hidden failure.
 *
 * Captured on Node v24.16.0, Vitest 3.2.4, Windows.
 */

export interface RecordedRun {
  /** The exact command that was run, from the repo root. */
  command: string;
  /** Why this run is part of the preservation record. */
  purpose: string;
  testFiles: { passed: number; failed: number };
  tests: { passed: number; failed: number };
  exitCode: number;
  /** Notes worth carrying to the post-fix comparison. */
  notes?: string;
}

/** Requirement 3.6 - single-directory and single-file invocations keep working and reporting. */
export const PRE_FIX_TARGETED_RUNS: RecordedRun[] = [
  {
    command: 'npx vitest --run packages/backend/src/travel',
    purpose: 'single-directory invocation, covers both files holding the 10 un-awaited assertions',
    testFiles: { passed: 6, failed: 0 },
    tests: { passed: 142, failed: 0 },
    exitCode: 0,
    notes:
      'apply.property.test.ts reports 20 tests and review.property.test.ts 6 tests, all passing - ' +
      'the 10 un-awaited async properties are reported as passed without ever being observed.',
  },
  {
    command: 'npx vitest --run packages/backend/src/travel/review.property.test.ts',
    purpose: 'single-file invocation',
    testFiles: { passed: 1, failed: 0 },
    tests: { passed: 6, failed: 0 },
    exitCode: 0,
    notes: '5 of these 6 tests are un-awaited async properties (lines 77, 137, 203, 262, 347).',
  },
];

/** Requirement 3.7 - the already-shipped fixes keep passing unmodified. */
export const PRE_FIX_PRIOR_FIX_RUNS: RecordedRun[] = [
  {
    command:
      'npx vitest --run packages/backend/src/email/send.test.ts ' +
      'packages/backend/src/email/send.property.test.ts ' +
      'packages/backend/src/user/change-nickname.property.test.ts ' +
      'packages/backend/src/user/nickname-validators.property.test.ts ' +
      'packages/backend/src/user/nickname-validators.test.ts',
    purpose:
      'SES 49-BCC-per-message cap, change-nickname.property.test.ts, nickname-validators generator',
    testFiles: { passed: 5, failed: 0 },
    tests: { passed: 39, failed: 0 },
    exitCode: 0,
    notes:
      'send.test.ts asserts batch sizes 49/49/22 and a To+Cc+Bcc total of at most 50 - the shipped ' +
      'SES cap fix. change-nickname.property.test.ts passes with its assertions awaited.',
  },
  {
    command: 'npx vitest --run packages/backend/src/content',
    purpose: 'the corrected content/handler assertion',
    testFiles: { passed: 24, failed: 0 },
    tests: { passed: 321, failed: 0 },
    exitCode: 0,
  },
];
