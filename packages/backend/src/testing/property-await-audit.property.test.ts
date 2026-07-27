/**
 * Feature: property-test-await-reliability, Property 4: The detector is sound and complete on the C_A shape
 *
 * The guard test (`property-await-guard.test.ts`) is only as trustworthy as the detector it runs,
 * so the detector is checked against generated sources with a known ground truth. Sources are
 * composed from labelled blocks - awaited-async, un-awaited-async, synchronous, async-in-comment,
 * async-in-string, and `fc.asyncProperty` in a non-first argument position - with random
 * indentation, random `numRuns`, and random interleaving. The un-awaited-async block positions are
 * the ground truth the detector's findings must reproduce exactly.
 *
 * Every fixture source lives in a template literal, which the detector masks, so this file
 * contributes no findings of its own to the corpus audit.
 *
 * **Validates: Requirements 2.9**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { collectBaselineStats, findUnawaitedAsyncAssertions } from './property-await-audit';

type BlockKind =
  | 'unawaited-async'
  | 'awaited-async'
  | 'synchronous'
  | 'async-in-comment'
  | 'async-in-string'
  | 'async-not-first-argument';

interface Block {
  kind: BlockKind;
  /** Rendered lines of the block. */
  lines: string[];
  /**
   * 0-based offset within `lines` of the line the detector must report, for `unawaited-async`
   * blocks. Undefined for every other kind.
   */
  findingOffset?: number;
}

const BLOCK_KINDS: BlockKind[] = [
  'unawaited-async',
  'awaited-async',
  'synchronous',
  'async-in-comment',
  'async-in-string',
  'async-not-first-argument',
];

/** Render a block of a given kind with the given indentation, layout and numRuns. */
function renderBlock(
  kind: BlockKind,
  indent: string,
  multiline: boolean,
  numRuns: number,
  index: number,
): Block {
  const inner = `${indent}  `;
  const name = `case ${index}`;

  if (kind === 'unawaited-async') {
    const lines = multiline
      ? [
          `${indent}it('${name}', () => {`,
          `${inner}fc.assert(`,
          `${inner}  fc.asyncProperty(fc.integer(), async (n) => {`,
          `${inner}    expect(n).toBe(n);`,
          `${inner}  }),`,
          `${inner}  { numRuns: ${numRuns} },`,
          `${inner});`,
          `${indent}});`,
        ]
      : [
          `${indent}it('${name}', () => {`,
          `${inner}fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: ${numRuns} });`,
          `${indent}});`,
        ];
    return { kind, lines, findingOffset: 1 };
  }

  if (kind === 'awaited-async') {
    const lines = multiline
      ? [
          `${indent}it('${name}', async () => {`,
          `${inner}await fc.assert(`,
          `${inner}  fc.asyncProperty(fc.integer(), async (n) => {`,
          `${inner}    expect(n).toBe(n);`,
          `${inner}  }),`,
          `${inner}  { numRuns: ${numRuns} },`,
          `${inner});`,
          `${indent}});`,
        ]
      : [
          `${indent}it('${name}', async () => {`,
          `${inner}await fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: ${numRuns} });`,
          `${indent}});`,
        ];
    return { kind, lines };
  }

  if (kind === 'synchronous') {
    const lines = multiline
      ? [
          `${indent}it('${name}', () => {`,
          `${inner}fc.assert(`,
          `${inner}  fc.property(fc.integer(), (n) => {`,
          `${inner}    expect(n).toBe(n);`,
          `${inner}  }),`,
          `${inner}  { numRuns: ${numRuns} },`,
          `${inner});`,
          `${indent}});`,
        ]
      : [
          `${indent}it('${name}', () => {`,
          `${inner}fc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: ${numRuns} });`,
          `${indent}});`,
        ];
    return { kind, lines };
  }

  if (kind === 'async-in-comment') {
    const lines = multiline
      ? [
          `${indent}/*`,
          `${indent} * fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: ${numRuns} });`,
          `${indent} */`,
        ]
      : [
          `${indent}// fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: ${numRuns} });`,
        ];
    return { kind, lines };
  }

  if (kind === 'async-in-string') {
    const lines = multiline
      ? [
          `${indent}const doc${index} = \``,
          `${indent}fc.assert(fc.asyncProperty(fc.integer(), async (n) => n === n), { numRuns: ${numRuns} });`,
          `${indent}\`;`,
        ]
      : [
          `${indent}const doc${index} = 'fc.assert(fc.asyncProperty(fc.integer(), async () => true))';`,
        ];
    return { kind, lines };
  }

  // async-not-first-argument: an fc.asyncProperty that is not the direct argument of fc.assert.
  const lines = multiline
    ? [
        `${indent}const prop${index} = fc.asyncProperty(fc.integer(), async (n) => n === n);`,
        `${indent}it('${name}', () => {`,
        `${inner}fc.assert(`,
        `${inner}  withTimeout(fc.asyncProperty(fc.integer(), async (n) => n === n)),`,
        `${inner}  { numRuns: ${numRuns} },`,
        `${inner});`,
        `${indent}});`,
      ]
    : [
        `${indent}const prop${index} = fc.asyncProperty(fc.integer(), async (n) => n === n);`,
        `${indent}it('${name}', () => {`,
        `${inner}fc.assert(withTimeout(prop${index}), { numRuns: ${numRuns} });`,
        `${indent}});`,
      ];
  return { kind, lines };
}

interface GeneratedSource {
  source: string;
  /** 1-based line numbers the detector must report, in order. */
  expectedLines: number[];
  blocks: Block[];
}

const HEADER = [`import { describe, it, expect } from 'vitest';`, `import fc from 'fast-check';`, ``];

/** Compose a source file from a list of block specs, tracking the ground-truth finding lines. */
function composeSource(
  specs: { kind: BlockKind; indent: string; multiline: boolean; numRuns: number }[],
  blankLinesBetween: number,
): GeneratedSource {
  const lines: string[] = [...HEADER];
  const expectedLines: number[] = [];
  const blocks: Block[] = [];

  specs.forEach((spec, index) => {
    const block = renderBlock(spec.kind, spec.indent, spec.multiline, spec.numRuns, index);
    blocks.push(block);
    if (block.findingOffset !== undefined) {
      // +1 converts the 0-based array position to a 1-based line number.
      expectedLines.push(lines.length + block.findingOffset + 1);
    }
    lines.push(...block.lines);
    for (let i = 0; i < blankLinesBetween; i++) lines.push('');
  });

  return { source: lines.join('\n'), expectedLines, blocks };
}

const blockSpecArb = fc.record({
  kind: fc.constantFrom(...BLOCK_KINDS),
  indent: fc.constantFrom('', '  ', '    ', '\t'),
  multiline: fc.boolean(),
  numRuns: fc.integer({ min: 1, max: 500 }),
});

const generatedSourceArb = fc
  .record({
    specs: fc.array(blockSpecArb, { minLength: 1, maxLength: 8 }),
    blankLinesBetween: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ specs, blankLinesBetween }) => composeSource(specs, blankLinesBetween));

/**
 * The mechanical conversion applied to every finding by the fix: make the enclosing callback
 * `async` and await the `fc.assert` call. Test-local on purpose - the rewrite of the real corpus
 * is a hand-applied edit, and this is only here to check the detector's fixed point.
 */
function rewriteUnawaitedAsyncAssertions(source: string): string {
  const lines = source.split('\n');
  for (const finding of findUnawaitedAsyncAssertions(source)) {
    const idx = finding.line - 1;
    lines[idx] = lines[idx].replace(/(^\s*)fc\s*\.\s*assert\s*\(/, '$1await fc.assert(');
    // Make the nearest enclosing it()/test() callback async, searching upwards.
    for (let j = idx; j >= 0; j--) {
      const match = /^(\s*)(it|test)\((.*?)(,\s*)\(\)\s*=>\s*\{\s*$/.exec(lines[j]);
      if (match) {
        lines[j] = `${match[1]}${match[2]}(${match[3]}${match[4]}async () => {`;
        break;
      }
    }
  }
  return lines.join('\n');
}

describe('Feature: property-test-await-reliability, Property 4: The detector is sound and complete on the C_A shape', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports findings at exactly the un-awaited async assertion positions', () => {
    fc.assert(
      fc.property(generatedSourceArb, ({ source, expectedLines }) => {
        const findings = findUnawaitedAsyncAssertions(source);
        expect(findings.map((f) => f.line)).toEqual(expectedLines);
        expect(findings).toHaveLength(expectedLines.length);
      }),
      { numRuns: 300 },
    );
  });

  it('reports no finding for any source built without un-awaited async blocks', () => {
    const cleanSpecArb = fc.record({
      kind: fc.constantFrom(...BLOCK_KINDS.filter((k) => k !== 'unawaited-async')),
      indent: fc.constantFrom('', '  ', '    '),
      multiline: fc.boolean(),
      numRuns: fc.integer({ min: 1, max: 500 }),
    });

    fc.assert(
      fc.property(
        fc.array(cleanSpecArb, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 2 }),
        (specs, blanks) => {
          const { source } = composeSource(specs, blanks);
          expect(findUnawaitedAsyncAssertions(source)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is idempotent under the conversion rewrite', () => {
    fc.assert(
      fc.property(generatedSourceArb, ({ source }) => {
        const once = rewriteUnawaitedAsyncAssertions(source);
        expect(findUnawaitedAsyncAssertions(once)).toEqual([]);
        const twice = rewriteUnawaitedAsyncAssertions(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it('leaves the baseline statistics unchanged across the rewrite', () => {
    const markerArb = fc.array(
      fc.constantFrom(
        `it.skip('parked', () => {});`,
        `it.todo('planned');`,
        `describe.only('focused', () => {});`,
      ),
      { maxLength: 3 },
    );

    fc.assert(
      fc.property(generatedSourceArb, markerArb, ({ source }, markers) => {
        const withMarkers = markers.length === 0 ? source : `${source}\n${markers.join('\n')}`;
        const before = collectBaselineStats(withMarkers);
        const after = collectBaselineStats(rewriteUnawaitedAsyncAssertions(withMarkers));

        // The rewrite only adds `await` and `async`: synchronous assertions, the numRuns multiset
        // and the suppression-marker counts must be untouched, and every previously un-awaited
        // async assertion must have moved into the awaited set at the same line.
        expect(after.syncAssertionLines).toEqual(before.syncAssertionLines);
        expect(after.numRuns).toEqual(before.numRuns);
        expect(after.markers).toEqual(before.markers);
        expect(after.unawaitedAsyncAssertionLines).toEqual([]);
        expect(after.awaitedAsyncAssertionLines).toEqual(
          [...before.awaitedAsyncAssertionLines, ...before.unawaitedAsyncAssertionLines].sort(
            (a, b) => a - b,
          ),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('reports the same findings under token-order-preserving reformatting', () => {
    fc.assert(
      fc.property(
        generatedSourceArb,
        fc.integer({ min: 1, max: 3 }),
        ({ source, blocks }, extraIndent) => {
          const pad = ' '.repeat(extraIndent);
          // Reindent every line and insert a blank line after each one: token order is unchanged,
          // so the finding count must be unchanged and each finding must shift predictably.
          const reindented = source
            .split('\n')
            .map((line) => (line.trim() === '' ? line : pad + line))
            .join('\n');

          const before = findUnawaitedAsyncAssertions(source);
          const afterIndent = findUnawaitedAsyncAssertions(reindented);
          expect(afterIndent.map((f) => f.line)).toEqual(before.map((f) => f.line));

          const doubleSpaced = source.split('\n').join('\n\n');
          const afterBlanks = findUnawaitedAsyncAssertions(doubleSpaced);
          expect(afterBlanks).toHaveLength(before.length);
          expect(afterBlanks.map((f) => f.line)).toEqual(before.map((f) => f.line * 2 - 1));

          // Sanity: the ground truth is the number of un-awaited blocks, however formatted.
          expect(before).toHaveLength(
            blocks.filter((b) => b.kind === 'unawaited-async').length,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
