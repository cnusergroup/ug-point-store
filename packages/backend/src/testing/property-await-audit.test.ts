/**
 * Feature: property-test-await-reliability, Property 4: The detector is sound and complete on the C_A shape
 *
 * Unit tests for the audit tooling in `property-await-audit.ts`. The guard test is only
 * trustworthy if the detector is, so every shape the corpus actually contains is pinned here:
 * the un-awaited case, the awaited case, the synchronous case, the `async`-callback-without-`await`
 * case, comments and string literals, the repo's prevailing multiline layout, and the adjacency
 * case that produced a false positive with a window scan.
 *
 * Fixture sources are held in template literals on purpose: the detector masks string literals,
 * so this file contributes no findings of its own to the corpus audit.
 *
 * **Validates: Requirements 2.9**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findUnawaitedAsyncAssertions,
  stripCommentsAndStrings,
  collectBaselineStats,
  collectCorpusFiles,
  readVitestIncludePatterns,
} from './property-await-audit';

/** Build a source file from lines so expected line numbers are unambiguous. */
const src = (...lines: string[]): string => lines.join('\n');

describe('Feature: property-test-await-reliability, Property 4: The detector is sound and complete on the C_A shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports one finding with the correct line number for an un-awaited async assertion', () => {
    const source = src(
      `import fc from 'fast-check';`,
      ``,
      `describe('suite', () => {`,
      `  it('un-awaited', () => {`,
      `    fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 10 });`,
      `  });`,
      `});`,
    );

    const findings = findUnawaitedAsyncAssertions(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(5);
    expect(findings[0].snippet).toContain('fc.assert(fc.asyncProperty(');
  });

  it('reports no finding for an awaited async assertion', () => {
    const source = src(
      `it('awaited', async () => {`,
      `  await fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 10 });`,
      `});`,
    );

    expect(findUnawaitedAsyncAssertions(source)).toEqual([]);
  });

  it('reports no finding for a synchronous fc.property assertion', () => {
    const source = src(
      `it('synchronous', () => {`,
      `  fc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: 100 });`,
      `});`,
    );

    expect(findUnawaitedAsyncAssertions(source)).toEqual([]);
  });

  it('reports a finding when the callback is async but the assertion is still not awaited', () => {
    const source = src(
      `it('async callback, missing await', async () => {`,
      `  fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 25 });`,
      `});`,
    );

    const findings = findUnawaitedAsyncAssertions(source);

    expect(findings.map((f) => f.line)).toEqual([2]);
  });

  it('reports exactly one finding when a synchronous assertion sits next to an un-awaited async one', () => {
    // Regression test for the 400-character window scan that misclassified all five assertions in
    // packages/backend/src/admin/roles-permission.property.test.ts.
    const source = src(
      `it('synchronous first', () => {`,
      `  fc.assert(`,
      `    fc.property(fc.integer(), (n) => n === n),`,
      `    { numRuns: 100 },`,
      `  );`,
      `});`,
      ``,
      `it('async second', () => {`,
      `  fc.assert(`,
      `    fc.asyncProperty(fc.integer(), async (n) => n === n),`,
      `    { numRuns: 50 },`,
      `  );`,
      `});`,
      ``,
      `it('synchronous third', () => {`,
      `  fc.assert(`,
      `    fc.property(fc.nat(), (n) => n >= 0),`,
      `    { numRuns: 100 },`,
      `  );`,
      `});`,
    );

    const findings = findUnawaitedAsyncAssertions(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(9);
  });

  it('reports no finding for fc.asyncProperty inside comments or string literals', () => {
    const source = src(
      `// fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n));`,
      `/*`,
      ` * fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n));`,
      ` */`,
      `const single = 'fc.assert(fc.asyncProperty(fc.integer(), async () => true))';`,
      `const double = "fc.assert(fc.asyncProperty(fc.integer(), async () => true))";`,
      `const template = \`fc.assert(fc.asyncProperty(fc.integer(), async () => true))\`;`,
      `it('documented', () => {`,
      `  fc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: 10 });`,
      `});`,
    );

    expect(findUnawaitedAsyncAssertions(source)).toEqual([]);
  });

  it('reports a finding for the multiline fc.assert(\\n  fc.asyncProperty( layout', () => {
    const source = src(
      `it('multiline', () => {`,
      `  fc.assert(`,
      `    fc.asyncProperty(`,
      `      fc.integer(),`,
      `      async (n) => {`,
      `        expect(n).toBe(n);`,
      `      },`,
      `    ),`,
      `    { numRuns: 30 },`,
      `  );`,
      `});`,
    );

    const findings = findUnawaitedAsyncAssertions(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].snippet).toContain('fc.asyncProperty(');
  });

  it('reports no finding when fc.asyncProperty is not the direct argument of fc.assert', () => {
    const source = src(
      `const wrapped = fc.asyncProperty(fc.integer(), async (n) => n === n);`,
      `it('wrapped', () => {`,
      `  fc.assert(withTimeout(fc.asyncProperty(fc.integer(), async (n) => n === n)), {`,
      `    numRuns: 10,`,
      `  });`,
      `});`,
    );

    expect(findUnawaitedAsyncAssertions(source)).toEqual([]);
  });

  it('masks comments and literals without changing length or line structure', () => {
    const source = src(
      `const a = 'hello'; // trailing`,
      `const b = \`multi`,
      `line\`;`,
    );

    const masked = stripCommentsAndStrings(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    expect(masked).not.toContain('hello');
    expect(masked).not.toContain('trailing');
  });
});

describe('Feature: property-test-await-reliability, Property 4: Corpus discovery follows the vitest include patterns', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const writeFile = (rel: string, contents: string): void => {
    const full = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf8');
  };

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'await-audit-corpus-'));
    writeFile(
      'vitest.config.ts',
      [
        `import { defineConfig } from 'vitest/config';`,
        ``,
        `export default defineConfig({`,
        `  test: {`,
        `    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx', 'packages/cdk/lambda/**/*.test.ts', 'packages/cdk/test/**/*.test.ts'],`,
        `  },`,
        `});`,
      ].join('\n'),
    );
    writeFile('packages/backend/src/a.test.ts', '// matched');
    writeFile('packages/backend/src/deep/nested/b.test.ts', '// matched');
    writeFile('packages/backend/src/c.ts', '// not a test file');
    writeFile('packages/frontend/src/d.test.tsx', '// matched');
    writeFile('packages/cdk/lambda/e.test.ts', '// matched');
    writeFile('packages/cdk/test/f.test.ts', '// matched');
    writeFile('packages/cdk/src/g.test.ts', '// matched');
    writeFile('packages/backend/node_modules/dep/h.test.ts', '// ignored dependency');
    writeFile('packages/backend/dist/i.test.ts', '// ignored build output');
    writeFile('scripts/j.test.ts', '// outside the include patterns');
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('reads the include patterns from vitest.config.ts rather than a duplicated list', () => {
    expect(readVitestIncludePatterns(fixtureRoot)).toEqual([
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'packages/cdk/lambda/**/*.test.ts',
      'packages/cdk/test/**/*.test.ts',
    ]);
  });

  it('collects exactly the files matched by the include patterns over a fixture tree', () => {
    expect(collectCorpusFiles(fixtureRoot)).toEqual([
      'packages/backend/src/a.test.ts',
      'packages/backend/src/deep/nested/b.test.ts',
      'packages/cdk/lambda/e.test.ts',
      'packages/cdk/src/g.test.ts',
      'packages/cdk/test/f.test.ts',
      'packages/frontend/src/d.test.tsx',
    ]);
  });
});

describe('Feature: property-test-await-reliability, Property 4: Baseline statistics are extracted faithfully', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts numRuns from both inline and multiline options objects', () => {
    const source = src(
      `it('inline options', async () => {`,
      `  await fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 100 });`,
      `});`,
      ``,
      `it('multiline options', () => {`,
      `  fc.assert(`,
      `    fc.property(fc.integer(), (n) => n === n),`,
      `    {`,
      `      numRuns: 250,`,
      `      verbose: true,`,
      `    },`,
      `  );`,
      `});`,
    );

    const stats = collectBaselineStats(source);

    expect(stats.numRuns).toEqual([100, 250]);
  });

  it('classifies assertions by direct argument and await, and counts suppression markers', () => {
    const source = src(
      `it('awaited async', async () => {`,
      `  await fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 10 });`,
      `});`,
      ``,
      `it('un-awaited async', () => {`,
      `  fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: 20 });`,
      `});`,
      ``,
      `it('synchronous', () => {`,
      `  fc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: 30 });`,
      `});`,
      ``,
      `it.skip('parked', () => {});`,
      `it.todo('planned');`,
      `describe.only('focused', () => {});`,
    );

    const stats = collectBaselineStats(source);

    expect(stats.awaitedAsyncAssertionLines).toEqual([2]);
    expect(stats.unawaitedAsyncAssertionLines).toEqual([6]);
    expect(stats.syncAssertionLines).toEqual([10]);
    expect(stats.awaitedSyncAssertionLines).toEqual([]);
    expect(stats.numRuns).toEqual([10, 20, 30]);
    expect(stats.markers).toEqual({
      skip: 1,
      todo: 1,
      only: 1,
      dangerouslyIgnoreUnhandledErrors: 0,
    });
  });

  it('ignores numRuns and marker names that appear only in comments or string literals', () => {
    const source = src(
      `// numRuns: 999 and it.skip in prose`,
      `const doc = 'numRuns: 888, dangerouslyIgnoreUnhandledErrors';`,
      `it('real', () => {`,
      `  fc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: 15 });`,
      `});`,
    );

    const stats = collectBaselineStats(source);

    expect(stats.numRuns).toEqual([15]);
    expect(stats.markers).toEqual({
      skip: 0,
      todo: 0,
      only: 0,
      dangerouslyIgnoreUnhandledErrors: 0,
    });
  });
});
