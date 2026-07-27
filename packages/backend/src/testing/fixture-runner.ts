/**
 * Child-process Vitest runner used by the fixture-driven exploration tests of the
 * `property-test-await-reliability` spec.
 *
 * A fixture spec has to be observed as a whole run - reported pass/fail counts, unhandled-error
 * count, console noise, and process exit code - which is only possible from outside the run. This
 * helper spawns `node node_modules/vitest/vitest.mjs run` against
 * `src/testing/__fixtures__/vitest.fixtures.config.ts` and parses the summary.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface FixtureRunResult {
  /** Process exit code of the child Vitest run. */
  exitCode: number;
  /** Combined stdout + stderr with ANSI escapes removed. */
  output: string;
  /** Count from the `Tests` summary line. */
  testsPassed: number;
  /** Count from the `Tests` summary line. */
  testsFailed: number;
  /** Count from the `Errors  N error(s)` summary line - Vitest's unhandled-error total. */
  unhandledErrors: number;
  /** Whether the run printed the advisory "Unhandled Rejection" / "Unhandled Errors" banner. */
  hasUnhandledRejectionNoise: boolean;
}

/** Locate the repo root by walking up until `vitest.config.ts` is found. */
export function findRepoRoot(start: string = __dirname): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'vitest.config.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate vitest.config.ts above ${start}`);
    dir = parent;
  }
}

const ANSI = /\u001b\[[0-9;]*m/g;

function firstNumber(source: string | undefined): number {
  if (!source) return 0;
  const m = /(\d+)/.exec(source);
  return m ? Number(m[1]) : 0;
}

/**
 * Run a single fixture spec in a child Vitest process.
 *
 * @param filter substring of the fixture file name, e.g. `hidden-verdict-unawaited`
 */
export function runFixture(filter: string, root: string = findRepoRoot()): FixtureRunResult {
  const vitestBin = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const configPath = path.join(
    root,
    'packages',
    'backend',
    'src',
    'testing',
    '__fixtures__',
    'vitest.fixtures.config.ts',
  );

  const child = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', configPath, '--reporter=default', filter],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`.replace(ANSI, '');
  const testsLine = /^\s*Tests\s+(.*)$/m.exec(output)?.[1] ?? '';
  const errorsLine = /^\s*Errors\s+(.*)$/m.exec(output)?.[1] ?? '';

  return {
    exitCode: child.status ?? -1,
    output,
    testsPassed: firstNumber(/(\d+)\s+passed/.exec(testsLine)?.[0]),
    testsFailed: firstNumber(/(\d+)\s+failed/.exec(testsLine)?.[0]),
    unhandledErrors: firstNumber(/(\d+)\s+error/.exec(errorsLine)?.[0]),
    hasUnhandledRejectionNoise:
      output.includes('Unhandled Rejection') || output.includes('Unhandled Errors'),
  };
}

/** Extract every fast-check counterexample printed by a run, in order. */
export function extractCounterexamples(output: string): string[] {
  return Array.from(output.matchAll(/^Counterexample:\s*(.*)$/gm)).map((m) => m[1].trim());
}
