/**
 * Feature: property-test-await-reliability, Property 2: Non-buggy test cases and run scopes are
 * unchanged
 *
 * Preservation checking for `FOR ALL X WHERE NOT (isBugConditionA(X) OR isBugConditionB(X)) DO
 * ASSERT F(X) = F'(X)`.
 *
 * `F` is the committed baseline fixture `property-await-baseline.json`, captured on UNFIXED code.
 * `F'` is recomputed here from the corpus on every run. The properties quantify over the corpus
 * file set - the domain of X - and compare the two.
 *
 * The baseline deliberately excludes `packages/backend/src/testing/` (see
 * `BASELINE_EXCLUDED_PREFIXES`): those files are created by this bugfix itself, did not exist
 * pre-fix, and the remaining tasks add more of them. Excluding them keeps the baseline stable
 * while still asserting that nothing pre-existing was dropped from discovery.
 *
 * Regenerating the baseline is an explicit, reviewed act:
 *   UPDATE_PROPERTY_AWAIT_BASELINE=1 npx vitest --run packages/backend/src/testing
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7**
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  BASELINE_EXCLUDED_PREFIXES,
  collectCorpusBaseline,
  findRepoRoot,
  noNumRunsLowered,
  readVitestTestExcludePatterns,
  type BaselineStats,
  type CorpusBaseline,
} from './property-await-audit';
import {
  PRE_FIX_PRIOR_FIX_RUNS,
  PRE_FIX_TARGETED_RUNS,
  type RecordedRun,
} from './property-await-prefix-runs';

const ROOT = findRepoRoot();
const BASELINE_PATH = path.join(
  ROOT,
  'packages/backend/src/testing/property-await-baseline.json',
);

if (process.env.UPDATE_PROPERTY_AWAIT_BASELINE === '1') {
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(collectCorpusBaseline(ROOT), null, 2)}\n`,
    'utf8',
  );
}

function loadBaseline(): CorpusBaseline {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(
      `Missing preservation baseline at ${BASELINE_PATH}. It must be captured on pre-fix code ` +
        'with UPDATE_PROPERTY_AWAIT_BASELINE=1.',
    );
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as CorpusBaseline;
}

const BASELINE = loadBaseline();
const CURRENT = collectCorpusBaseline(ROOT);

const EMPTY_STATS: BaselineStats = {
  syncAssertionLines: [],
  awaitedSyncAssertionLines: [],
  awaitedAsyncAssertionLines: [],
  unawaitedAsyncAssertionLines: [],
  numRuns: [],
  markers: { skip: 0, todo: 0, only: 0, dangerouslyIgnoreUnhandledErrors: 0 },
};

const baselineStatsOf = (file: string): BaselineStats => BASELINE.stats[file] ?? EMPTY_STATS;
const currentStatsOf = (file: string): BaselineStats => CURRENT.stats[file] ?? EMPTY_STATS;

/** Files where the fix is allowed to turn un-awaited async assertions into awaited ones. */
const CONVERSION_FILES = Object.entries(BASELINE.stats)
  .filter(([, stats]) => stats.unawaitedAsyncAssertionLines.length > 0)
  .map(([file]) => file);

/** Every file the baseline recorded, used as the generated domain for the properties. */
const BASELINE_FILES = BASELINE.files;

/** Files that carry at least one statistic - the interesting part of the domain. */
const STAT_FILES = Object.keys(BASELINE.stats);

const fileArb = fc.constantFrom(...BASELINE_FILES);
const statFileArb = fc.constantFrom(...STAT_FILES);

describe('Feature: property-test-await-reliability, Property 2: Non-buggy test cases and run scopes are unchanged', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has a usable baseline covering the pre-fix corpus', () => {
    expect(BASELINE.spec).toBe('property-test-await-reliability');
    expect(BASELINE_FILES.length).toBeGreaterThan(0);
    expect(STAT_FILES.length).toBeGreaterThan(0);
    expect(BASELINE.excludedPrefixes).toEqual([...BASELINE_EXCLUDED_PREFIXES]);
  });

  // 3.1 - synchronous fc.assert(fc.property(...)) assertions are neither converted nor moved.
  it('keeps every synchronous assertion count and position identical to the baseline', () => {
    fc.assert(
      fc.property(fileArb, (file) => {
        const before = baselineStatsOf(file);
        const after = currentStatsOf(file);

        expect(
          after.syncAssertionLines.length,
          `${file}: synchronous assertion count changed`,
        ).toBe(before.syncAssertionLines.length);

        // No synchronous assertion may acquire an `await` (that would be a conversion).
        expect(
          after.awaitedSyncAssertionLines,
          `${file}: a synchronous assertion became awaited`,
        ).toEqual(before.awaitedSyncAssertionLines);

        // Positions must be byte-for-byte stable everywhere except the files where the
        // intended conversions happen, whose line numbers may shift.
        if (!CONVERSION_FILES.includes(file)) {
          expect(
            after.syncAssertionLines,
            `${file}: synchronous assertion positions moved`,
          ).toEqual(before.syncAssertionLines);
        }
      }),
      { numRuns: 300 },
    );
  });

  // 3.3 - already-awaited async assertions are untouched; only the intended conversions add to
  // the awaited count, and the total number of async assertions per file never changes.
  it('keeps awaited-async counts unchanged except for the intended conversions', () => {
    fc.assert(
      fc.property(fileArb, (file) => {
        const before = baselineStatsOf(file);
        const after = currentStatsOf(file);

        const asyncTotalBefore =
          before.awaitedAsyncAssertionLines.length + before.unawaitedAsyncAssertionLines.length;
        const asyncTotalAfter =
          after.awaitedAsyncAssertionLines.length + after.unawaitedAsyncAssertionLines.length;

        expect(asyncTotalAfter, `${file}: async assertion total changed`).toBe(asyncTotalBefore);

        expect(
          after.awaitedAsyncAssertionLines.length,
          `${file}: awaited-async count decreased`,
        ).toBeGreaterThanOrEqual(before.awaitedAsyncAssertionLines.length);

        if (before.unawaitedAsyncAssertionLines.length === 0) {
          // Nothing to convert here, so nothing may change.
          expect(
            after.awaitedAsyncAssertionLines,
            `${file}: awaited-async assertions moved or changed count`,
          ).toEqual(before.awaitedAsyncAssertionLines);
          expect(
            after.unawaitedAsyncAssertionLines,
            `${file}: a new un-awaited async assertion appeared`,
          ).toEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('caps the corpus-wide awaited-async delta at the number of intended conversions', () => {
    const delta = BASELINE_FILES.reduce(
      (sum, file) =>
        sum +
        (currentStatsOf(file).awaitedAsyncAssertionLines.length -
          baselineStatsOf(file).awaitedAsyncAssertionLines.length),
      0,
    );
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(BASELINE.totals.unawaitedAsyncAssertions);
  });

  // 3.2, 2.8 - no numRuns value is ever lowered.
  it('never lowers a numRuns value below its baseline', () => {
    fc.assert(
      fc.property(statFileArb, (file) => {
        const before = baselineStatsOf(file).numRuns;
        const after = currentStatsOf(file).numRuns;
        expect(
          noNumRunsLowered(before, after),
          `${file}: numRuns lowered - baseline ${JSON.stringify(before)}, now ${JSON.stringify(after)}`,
        ).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  // 2.8, 3.5 - suppression markers are not added, and nothing is excluded from discovery.
  it('does not increase suppression-marker counts in any file', () => {
    fc.assert(
      fc.property(fileArb, (file) => {
        const before = baselineStatsOf(file).markers;
        const after = currentStatsOf(file).markers;
        for (const marker of ['skip', 'todo', 'only', 'dangerouslyIgnoreUnhandledErrors'] as const) {
          expect(
            after[marker],
            `${file}: ${marker} count rose from ${before[marker]} to ${after[marker]}`,
          ).toBeLessThanOrEqual(before[marker]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('adds no file to the Vitest test-level exclude list', () => {
    expect(readVitestTestExcludePatterns(ROOT)).toEqual(BASELINE.vitestTestExclude);
    expect(CURRENT.vitestInclude).toEqual(BASELINE.vitestInclude);
    expect(CURRENT.totals.markers.dangerouslyIgnoreUnhandledErrors).toBeLessThanOrEqual(
      BASELINE.totals.markers.dangerouslyIgnoreUnhandledErrors,
    );
  });

  // 3.5 - discovery still matches exactly the pre-fix corpus (outside this fix's own tooling dir).
  it('discovers exactly the baseline file set', () => {
    const current = new Set(CURRENT.files);
    const missing = BASELINE_FILES.filter((file) => !current.has(file));
    const added = CURRENT.files.filter((file) => !BASELINE_FILES.includes(file));
    expect(missing, `files dropped from discovery: ${missing.join(', ')}`).toEqual([]);
    expect(added, `files added to discovery: ${added.join(', ')}`).toEqual([]);
  });

  // 3.6, 3.7 - the recorded pre-fix results for targeted invocations and for the prior fixes.
  // These are observations, not re-executions: task 6.7 re-runs the same commands and compares.
  it('records a green pre-fix result for every targeted and prior-fix invocation', () => {
    const runs: RecordedRun[] = [...PRE_FIX_TARGETED_RUNS, ...PRE_FIX_PRIOR_FIX_RUNS];
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.command, 'a recorded run must name its command').toMatch(/^npx vitest --run /);
      expect(run.exitCode, `${run.command}: recorded a non-zero exit code`).toBe(0);
      expect(run.tests.failed, `${run.command}: recorded test failures`).toBe(0);
      expect(run.testFiles.failed, `${run.command}: recorded file failures`).toBe(0);
      expect(run.tests.passed, `${run.command}: recorded no passing tests`).toBeGreaterThan(0);
    }
  });

  it('still finds every baseline file on disk', () => {
    fc.assert(
      fc.property(fileArb, (file) => {
        expect(fs.existsSync(path.join(ROOT, file)), `${file}: missing on disk`).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
