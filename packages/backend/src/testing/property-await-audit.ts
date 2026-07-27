/**
 * Property-await audit tooling.
 *
 * Feature: property-test-await-reliability
 *
 * Detector for Bug Condition A: an `fc.assert(fc.asyncProperty(...))` call whose returned Promise
 * is never awaited, so the enclosing Vitest test completes before the property has run.
 *
 * `findUnawaitedAsyncAssertions` is pure (source text in, findings out) so it is directly
 * unit- and property-testable. `collectCorpusFiles` reads the `include` patterns from
 * `vitest.config.ts` - that config is the single source of truth for the corpus file list.
 *
 * ## Verification Commands
 *
 * The following commands form the verification command set for the property-test-await-reliability
 * bugfix:
 *
 * - `npm run typecheck` — Type-checks all workspace packages (shared, backend, cdk) using their
 *   own tsconfig.json. Catches unimported identifiers in test files that `npm run lint` misses
 *   because the root tsconfig.json excludes `packages/`.
 * - `npm test` — Runs the full Vitest suite including the guard test
 *   (`property-await-guard.test.ts`) which fails when any un-awaited async assertion exists.
 * - `npm run lint` — Unchanged; runs `tsc --noEmit` against the root tsconfig (excludes packages).
 */

import fs from 'fs';
import path from 'path';

export interface Finding {
  /** 1-based line number of the offending `fc.assert(` call. */
  line: number;
  /** Trimmed source text of that line, for human-readable reporting. */
  snippet: string;
}

export interface FileAudit {
  /** Repo-relative, forward-slash separated path. */
  file: string;
  findings: Finding[];
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'cdk.out',
  '.vite',
  '.turbo',
  '.kiro',
]);

/**
 * Replace the contents of comments, string literals, template literals and regex literals with
 * spaces, preserving both total length and line structure so offsets and line numbers computed on
 * the masked text still map onto the original source.
 */
export function stripCommentsAndStrings(source: string): string {
  const out = source.split('');
  const n = source.length;

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  // Tracks whether a `/` can start a regex literal at the current position.
  const regexAllowedAfter = (idx: number): boolean => {
    let j = idx - 1;
    while (j >= 0 && /\s/.test(source[j])) j--;
    if (j < 0) return true;
    const c = source[j];
    if ('(,=:[!&|?{};+-*%~^<>'.includes(c)) return true;
    // keyword-preceded regex, e.g. `return /x/.test(s)`
    const wordMatch = /([A-Za-z_$][\w$]*)$/.exec(source.slice(0, j + 1));
    if (wordMatch) {
      return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof'].includes(
        wordMatch[1],
      );
    }
    return false;
  };

  let i = 0;
  // Template literal nesting: each entry is the brace depth at which the `${` opened.
  const templateStack: number[] = [];
  let braceDepth = 0;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === c || source[j] === '\n') break;
        j++;
      }
      blank(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }

    if (c === '`') {
      // Walk the template literal, blanking the literal chunks but leaving `${ ... }`
      // expressions to the outer scanner (they can contain nested strings and templates).
      let j = i + 1;
      out[i] = ' ';
      while (j < n) {
        if (source[j] === '\\') {
          blank(j, j + 2);
          j += 2;
          continue;
        }
        if (source[j] === '`') {
          out[j] = ' ';
          j++;
          break;
        }
        if (source[j] === '$' && source[j + 1] === '{') {
          out[j] = ' ';
          out[j + 1] = ' ';
          templateStack.push(braceDepth);
          braceDepth++;
          j += 2;
          break;
        }
        if (source[j] !== '\n') out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }

    if (c === '{') {
      braceDepth++;
      i++;
      continue;
    }

    if (c === '}') {
      braceDepth--;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        // Closing a `${ ... }` hole: resume the enclosing template literal.
        templateStack.pop();
        out[i] = ' ';
        let j = i + 1;
        while (j < n) {
          if (source[j] === '\\') {
            blank(j, j + 2);
            j += 2;
            continue;
          }
          if (source[j] === '`') {
            out[j] = ' ';
            j++;
            break;
          }
          if (source[j] === '$' && source[j + 1] === '{') {
            out[j] = ' ';
            out[j + 1] = ' ';
            templateStack.push(braceDepth);
            braceDepth++;
            j += 2;
            break;
          }
          if (source[j] !== '\n') out[j] = ' ';
          j++;
        }
        i = j;
        continue;
      }
      i++;
      continue;
    }

    if (c === '/' && regexAllowedAfter(i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = source[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '\n') break;
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        blank(i, j);
        i = j;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

const ASSERT_RE = /\bfc\s*\.\s*assert\s*\(/g;
const ASYNC_PROPERTY_RE = /^fc\s*\.\s*asyncProperty\s*\(/;
const SYNC_PROPERTY_RE = /^fc\s*\.\s*property\s*\(/;

function isPrecededByAwait(masked: string, assertStart: number): boolean {
  let j = assertStart - 1;
  while (j >= 0 && /\s/.test(masked[j])) j--;
  if (j < 4) return false;
  if (masked.slice(j - 4, j + 1) !== 'await') return false;
  const before = j - 5;
  return before < 0 || !/[\w$]/.test(masked[before]);
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index && k < source.length; k++) {
    if (source[k] === '\n') line++;
  }
  return line;
}

/**
 * Find every `fc.assert(...)` call whose **direct** first argument is `fc.asyncProperty(...)` and
 * which is not awaited.
 *
 * Anchoring on the direct argument position matters: a window scan over the source misclassifies
 * a synchronous `fc.assert(fc.property(...))` that merely sits near an async one.
 */
export function findUnawaitedAsyncAssertions(source: string): Finding[] {
  const masked = stripCommentsAndStrings(source);
  const lines = source.split('\n');
  const findings: Finding[] = [];

  ASSERT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASSERT_RE.exec(masked)) !== null) {
    const assertStart = m.index;
    const argStart = m.index + m[0].length;
    const rest = masked.slice(argStart).replace(/^\s*/, '');
    const skipped = masked.slice(argStart).length - rest.length;
    if (!ASYNC_PROPERTY_RE.test(rest)) continue;
    if (isPrecededByAwait(masked, assertStart)) continue;

    const line = lineOf(source, assertStart);
    const snippetLine = (lines[line - 1] ?? '').trim();
    const argLine = lineOf(source, argStart + skipped);
    const snippet =
      argLine === line
        ? snippetLine
        : `${snippetLine} ${(lines[argLine - 1] ?? '').trim()}`.trim();
    findings.push({ line, snippet: snippet.slice(0, 160) });
  }

  return findings;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i++;
      continue;
    }
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`);
}

/**
 * Read the Vitest `include` patterns. `vitest.config.ts` is the single source of truth for the
 * corpus; the patterns are never duplicated in code.
 */
export function readVitestIncludePatterns(root: string): string[] {
  const configPath = path.join(root, 'vitest.config.ts');
  const config = fs.readFileSync(configPath, 'utf8');
  const match = /include:\s*\[([\s\S]*?)\]/.exec(config);
  if (!match) {
    throw new Error(`Could not find an "include" array in ${configPath}`);
  }
  const patterns = Array.from(match[1].matchAll(/['"`]([^'"`]+)['"`]/g)).map((m) => m[1]);
  if (patterns.length === 0) {
    throw new Error(`The "include" array in ${configPath} is empty`);
  }
  return patterns;
}

/**
 * Walk `root` and return every file matched by the Vitest `include` patterns, as repo-relative
 * forward-slash paths, sorted.
 */
export function collectCorpusFiles(root: string): string[] {
  const patterns = readVitestIncludePatterns(root).map((p) => ({
    pattern: p,
    re: globToRegExp(p),
  }));
  const out: string[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = toPosix(path.relative(root, full));
      if (patterns.some((p) => p.re.test(rel))) out.push(rel);
    }
  };

  walk(root);
  return out.sort();
}

/**
 * Run the detector over the whole corpus. Returns one entry per file that has at least one
 * finding, sorted by path.
 */
export function auditCorpus(root: string): FileAudit[] {
  const results: FileAudit[] = [];
  for (const rel of collectCorpusFiles(root)) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const findings = findUnawaitedAsyncAssertions(source);
    if (findings.length > 0) results.push({ file: rel, findings });
  }
  return results;
}

/** Total finding count across an audit result. */
export function countFindings(audit: FileAudit[]): number {
  return audit.reduce((sum, entry) => sum + entry.findings.length, 0);
}

/** Render an audit result as a `file:line` list, one finding per line. */
export function formatAudit(audit: FileAudit[]): string {
  return audit
    .flatMap((entry) => entry.findings.map((f) => `${entry.file}:${f.line}  ${f.snippet}`))
    .join('\n');
}

/* ------------------------------------------------------------------------------------------------
 * Preservation baseline (the `F` side of `F(X) = F'(X)`)
 * ---------------------------------------------------------------------------------------------- */

/** One `fc.assert(...)` call, classified by its direct first argument. */
export interface AssertCall {
  /** 1-based line number of the `fc.assert(` token. */
  line: number;
  /** `async` = direct argument is `fc.asyncProperty(`, `sync` = `fc.property(`, else `other`. */
  kind: 'async' | 'sync' | 'other';
  /** Whether the call is preceded by `await`. */
  awaited: boolean;
}

export interface MarkerCounts {
  skip: number;
  todo: number;
  only: number;
  dangerouslyIgnoreUnhandledErrors: number;
}

/** Per-file statistics that must not regress across the fix. */
export interface BaselineStats {
  /** Lines of synchronous `fc.assert(fc.property(...))` calls that are not awaited. */
  syncAssertionLines: number[];
  /** Lines of synchronous assertions that are awaited (should normally be empty). */
  awaitedSyncAssertionLines: number[];
  /** Lines of correctly awaited `fc.assert(fc.asyncProperty(...))` calls. */
  awaitedAsyncAssertionLines: number[];
  /** Lines of un-awaited `fc.assert(fc.asyncProperty(...))` calls (Bug Condition A). */
  unawaitedAsyncAssertionLines: number[];
  /** Every `numRuns` value in the file, sorted ascending (a multiset, duplicates kept). */
  numRuns: number[];
  markers: MarkerCounts;
}

/**
 * Classify every `fc.assert(...)` call in `source` by its direct first argument and whether it is
 * awaited. Anchoring on the direct argument (rather than a text window) is what keeps a
 * synchronous assertion sitting next to an async one from being misread.
 */
export function scanAssertCalls(source: string): AssertCall[] {
  const masked = stripCommentsAndStrings(source);
  const calls: AssertCall[] = [];

  const re = new RegExp(ASSERT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const assertStart = m.index;
    const rest = masked.slice(m.index + m[0].length).replace(/^\s*/, '');
    const kind: AssertCall['kind'] = ASYNC_PROPERTY_RE.test(rest)
      ? 'async'
      : SYNC_PROPERTY_RE.test(rest)
        ? 'sync'
        : 'other';
    calls.push({
      line: lineOf(source, assertStart),
      kind,
      awaited: isPrecededByAwait(masked, assertStart),
    });
  }

  return calls;
}

const NUM_RUNS_RE = /\bnumRuns\s*:\s*(\d+)/g;
const SUPPRESSION_MARKER_RE =
  /\b(?:describe|suite|it|test|bench)\s*\.\s*(skip|todo|only)\b/g;
const IGNORE_UNHANDLED_RE = /\bdangerouslyIgnoreUnhandledErrors\b/g;

/**
 * Pure per-file baseline statistics: assertion counts and positions by kind, every `numRuns` value
 * (inline `{ numRuns: 100 }` and multiline options objects alike), and the suppression-marker
 * counts. Comments and string literals are masked out first, so a marker name mentioned in prose
 * or in a string does not inflate the counts.
 */
export function collectBaselineStats(source: string): BaselineStats {
  const masked = stripCommentsAndStrings(source);
  const calls = scanAssertCalls(source);

  const numRuns: number[] = [];
  NUM_RUNS_RE.lastIndex = 0;
  let n: RegExpExecArray | null;
  while ((n = NUM_RUNS_RE.exec(masked)) !== null) numRuns.push(Number(n[1]));
  numRuns.sort((a, b) => a - b);

  const markers: MarkerCounts = { skip: 0, todo: 0, only: 0, dangerouslyIgnoreUnhandledErrors: 0 };
  SUPPRESSION_MARKER_RE.lastIndex = 0;
  let k: RegExpExecArray | null;
  while ((k = SUPPRESSION_MARKER_RE.exec(masked)) !== null) {
    markers[k[1] as 'skip' | 'todo' | 'only']++;
  }
  IGNORE_UNHANDLED_RE.lastIndex = 0;
  while (IGNORE_UNHANDLED_RE.exec(masked) !== null) markers.dangerouslyIgnoreUnhandledErrors++;

  const linesOf = (kind: AssertCall['kind'], awaited: boolean): number[] =>
    calls.filter((c) => c.kind === kind && c.awaited === awaited).map((c) => c.line);

  return {
    syncAssertionLines: linesOf('sync', false),
    awaitedSyncAssertionLines: linesOf('sync', true),
    awaitedAsyncAssertionLines: linesOf('async', true),
    unawaitedAsyncAssertionLines: linesOf('async', false),
    numRuns,
    markers,
  };
}

/** True when a file contributes nothing to the preservation comparison. */
export function isEmptyBaselineStats(stats: BaselineStats): boolean {
  return (
    stats.syncAssertionLines.length === 0 &&
    stats.awaitedSyncAssertionLines.length === 0 &&
    stats.awaitedAsyncAssertionLines.length === 0 &&
    stats.unawaitedAsyncAssertionLines.length === 0 &&
    stats.numRuns.length === 0 &&
    stats.markers.skip === 0 &&
    stats.markers.todo === 0 &&
    stats.markers.only === 0 &&
    stats.markers.dangerouslyIgnoreUnhandledErrors === 0
  );
}

/**
 * Files created by this bugfix itself. They did not exist pre-fix, so they are not part of the
 * corpus under preservation - including them would make the baseline unstable as the remaining
 * tasks add their own test files.
 */
export const BASELINE_EXCLUDED_PREFIXES = ['packages/backend/src/testing/'];

export interface CorpusBaseline {
  spec: string;
  phase: string;
  note: string;
  /** Prefixes deliberately kept out of `files` / `stats`. */
  excludedPrefixes: string[];
  vitestInclude: string[];
  /** Test-level `exclude` patterns in `vitest.config.ts` (not the coverage ones). */
  vitestTestExclude: string[];
  /** Every corpus file outside `excludedPrefixes`, sorted. */
  files: string[];
  /** Stats for the subset of `files` that has any non-zero statistic. */
  stats: Record<string, BaselineStats>;
  totals: {
    files: number;
    syncAssertions: number;
    awaitedAsyncAssertions: number;
    unawaitedAsyncAssertions: number;
    numRunsValues: number;
    markers: MarkerCounts;
  };
}

/**
 * Read the test-level `exclude` patterns from `vitest.config.ts`. Only an `exclude` that is a
 * direct child of the `test:` object counts; the `coverage.exclude` nested inside it does not.
 */
export function readVitestTestExcludePatterns(root: string): string[] {
  const configPath = path.join(root, 'vitest.config.ts');
  const config = fs.readFileSync(configPath, 'utf8');
  const masked = stripCommentsAndStrings(config);

  const testKey = /\btest\s*:\s*\{/.exec(masked);
  if (!testKey) return [];
  const bodyStart = testKey.index + testKey[0].length;

  let depth = 0;
  const patterns: string[] = [];
  for (let i = bodyStart; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{' || c === '[') {
      depth++;
      continue;
    }
    if (c === '}' || c === ']') {
      if (depth === 0) break; // end of the test object
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    const ahead = masked.slice(i);
    const hit = /^\bexclude\s*:\s*\[/.exec(ahead);
    if (hit) {
      const arrayStart = i + hit[0].length;
      const arrayEnd = masked.indexOf(']', arrayStart);
      const raw = config.slice(arrayStart, arrayEnd === -1 ? config.length : arrayEnd);
      patterns.push(...Array.from(raw.matchAll(/['"`]([^'"`]+)['"`]/g)).map((mm) => mm[1]));
    }
  }
  return patterns;
}

/** Collect the whole-corpus baseline snapshot for `root`. */
export function collectCorpusBaseline(root: string): CorpusBaseline {
  const files = collectCorpusFiles(root).filter(
    (f) => !BASELINE_EXCLUDED_PREFIXES.some((prefix) => f.startsWith(prefix)),
  );

  const stats: Record<string, BaselineStats> = {};
  const totals: CorpusBaseline['totals'] = {
    files: files.length,
    syncAssertions: 0,
    awaitedAsyncAssertions: 0,
    unawaitedAsyncAssertions: 0,
    numRunsValues: 0,
    markers: { skip: 0, todo: 0, only: 0, dangerouslyIgnoreUnhandledErrors: 0 },
  };

  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    const fileStats = collectBaselineStats(source);
    if (isEmptyBaselineStats(fileStats)) continue;
    stats[rel] = fileStats;
    totals.syncAssertions += fileStats.syncAssertionLines.length;
    totals.awaitedAsyncAssertions += fileStats.awaitedAsyncAssertionLines.length;
    totals.unawaitedAsyncAssertions += fileStats.unawaitedAsyncAssertionLines.length;
    totals.numRunsValues += fileStats.numRuns.length;
    totals.markers.skip += fileStats.markers.skip;
    totals.markers.todo += fileStats.markers.todo;
    totals.markers.only += fileStats.markers.only;
    totals.markers.dangerouslyIgnoreUnhandledErrors +=
      fileStats.markers.dangerouslyIgnoreUnhandledErrors;
  }

  return {
    spec: 'property-test-await-reliability',
    phase: 'pre-fix',
    note:
      'Preservation baseline captured on UNFIXED code. Regenerate only with an explicit, ' +
      'reviewed decision - it is the F side of F(X) = F\u0027(X).',
    excludedPrefixes: [...BASELINE_EXCLUDED_PREFIXES],
    vitestInclude: readVitestIncludePatterns(root),
    vitestTestExclude: readVitestTestExcludePatterns(root),
    files,
    stats,
    totals,
  };
}

/**
 * True when no value in `after` is lower than the corresponding value in `baseline`: sorted
 * descending, `after` must be at least as long and pairwise greater than or equal. Detects any
 * `numRuns` reduction even if tests were added or removed.
 */
export function noNumRunsLowered(baseline: number[], after: number[]): boolean {
  const b = [...baseline].sort((x, y) => y - x);
  const a = [...after].sort((x, y) => y - x);
  if (a.length < b.length) return false;
  return b.every((value, i) => a[i] >= value);
}

/**
 * Locate the repo root by walking up from `start` until a directory containing `vitest.config.ts`
 * is found.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'vitest.config.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate vitest.config.ts above ${start}`);
    }
    dir = parent;
  }
}

// Optional CLI entry: `npx tsx packages/backend/src/testing/property-await-audit.ts`
if (typeof require !== 'undefined' && require.main === module) {
  const root = findRepoRoot();
  const audit = auditCorpus(root);
  const total = countFindings(audit);
  if (total === 0) {
    console.log('No un-awaited fc.assert(fc.asyncProperty(...)) calls found.');
    process.exit(0);
  }
  console.log(`${total} un-awaited fc.assert(fc.asyncProperty(...)) call(s) found:`);
  console.log(formatAudit(audit));
  process.exit(1);
}
