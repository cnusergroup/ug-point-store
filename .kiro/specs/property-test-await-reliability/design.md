# Property Test Await Reliability Bugfix Design

## Overview

Two independent defects make the backend test suite report success without validating anything.

**Defect A** is a per-test-case defect: an `fc.assert(fc.asyncProperty(...))` call sits inside a
non-`async` `it`/`test` callback and its Promise is never awaited. Vitest ends the test when the
callback returns, so the test is reported as passed before the property has run. A violation
surfaces only as unhandled-rejection console noise, and the orphaned property keeps running into
the next test, where `vi.restoreAllMocks()` wipes its `vi.fn()` mocks and produces misleading
errors that look like production faults.

**Defect B** is a per-suite-run defect: `npx vitest --run packages/backend` dies with a
V8 heap out-of-memory fatal error before the run finishes, so there is no aggregate pass/fail
signal for the backend package.

The fix strategy is mechanical for Defect A and empirical for Defect B:

1. Build a pure, testable detector for the Defect A shape, run it over the whole test corpus,
   and convert every occurrence to `async` callback + `await fc.assert(...)`.
2. Triage each failure that awaiting newly exposes, on its merits (fix production code when
   production is wrong, fix the test or generator when the expectation or input domain is wrong)
   with no suppression, no `skip`, no assertion weakening, no `numRuns` reduction.
3. Make the run configuration able to execute all discovered backend files to completion, using
   measurement (per-file heap logging) before changing knobs, and expose one documented command
   that produces an aggregate result.
4. Wire the detector in as a guard test so the defect class cannot silently return.

The detector is the leverage point: it is the audit tool, the regression guard, and the subject of
the property-based tests, all from one pure function.

## Glossary

- **Bug_Condition A (C_A)**: A single `it`/`test` block whose `fc.assert` receives an
  `fc.asyncProperty` while the enclosing callback is not `async` or the `fc.assert` call is not
  awaited.
- **Bug_Condition B (C_B)**: A runner invocation whose scope is the whole `packages/backend`
  package and which is expected to execute every discovered test file.
- **Property (P)**: The desired behavior — an async property assertion whose completion is tied to
  its test, whose violation fails the run with a non-zero exit code; and a full-suite run that
  completes and reports an aggregate summary.
- **Preservation**: Everything outside C_A and C_B must behave identically: synchronous
  `fc.property` assertions, already-awaited async assertions, genuinely passing tests with their
  original `numRuns`, existing `include` discovery, and single-file / single-directory invocations.
- **Orphaned property**: A property execution still in flight after its owning test has completed.
  Its mocks are subject to a later test's `vi.restoreAllMocks()`.
- **Corpus**: All files matched by the Vitest `include` patterns in `vitest.config.ts`
  (`packages/*/src/**/*.test.ts(x)`, `packages/cdk/lambda/**/*.test.ts`,
  `packages/cdk/test/**/*.test.ts`). 204 of these live under `packages/backend/src`, 104 of them
  property-test files.
- **Detector**: `findUnawaitedAsyncAssertions(source)` — pure function, source text in, list of
  `{ line, snippet }` findings out. No filesystem, no globbing, so it is directly property-testable.
- **Guard**: A test file that runs the detector over the corpus and fails when any finding exists.
- **Baseline**: A committed JSON snapshot of pre-fix corpus statistics (per file: count of
  synchronous `fc.property` assertions, count of already-awaited async assertions, every `numRuns`
  value, count of `skip`/`todo` markers). It is the `F` side of the preservation comparison.

## Bug Details

### Bug Condition A

The bug manifests when a test file hands an `fc.asyncProperty` to `fc.assert` without awaiting the
returned Promise. Vitest's per-test completion is driven by the callback's return value, so an
un-awaited assertion detaches the property's lifetime from the test's lifetime. Three consequences
follow from that one detachment: the verdict is never observed, the violation degrades to an
unhandled rejection, and the property's mocks outlive the mock lifecycle that owns them.

**Formal Specification:**

```
FUNCTION isBugConditionA(X)
  INPUT: X of type TestCase          // one it()/test() block in a corpus file
  OUTPUT: boolean

  RETURN X.usesAsyncProperty = TRUE            // fc.assert's direct argument is fc.asyncProperty
     AND (X.callbackIsAsync = FALSE OR X.assertIsAwaited = FALSE)
END FUNCTION
```

Note the precision required of `usesAsyncProperty`: it is the **direct first argument** of
`fc.assert`, not "an `fc.asyncProperty` appears somewhere nearby". A naive window scan over the
source misclassifies `fc.assert(fc.property(...))` blocks that are merely adjacent to async ones —
verified during this analysis, where a 400-character window produced a false positive on
`packages/backend/src/admin/roles-permission.property.test.ts` (all five of its assertions are
correctly formed). The detector must anchor on the argument position.

### Bug Condition B

```
FUNCTION isBugConditionB(X)
  INPUT: X of type SuiteRun           // an invocation scope for the test runner
  OUTPUT: boolean

  RETURN X.scope = 'packages/backend' AND X.runsAllDiscoveredFiles = TRUE
END FUNCTION
```

### Examples

Audit of the current corpus (anchored detection, whole `packages/` tree) found exactly 10
occurrences of C_A, in two files:

| File | Lines of un-awaited `fc.assert(fc.asyncProperty(...))` |
|------|-------------------------------------------------------|
| `packages/backend/src/travel/apply.property.test.ts` | 43, 119, 236, 599, 780 |
| `packages/backend/src/travel/review.property.test.ts` | 77, 137, 203, 262, 347 |

- `review.property.test.ts:77` — "Approval preserves quota": the property asserts status, reviewer
  fields, and an unchanged `travelEarnUsed` through a mocked `UpdateCommand`. Expected: the test
  fails if any of those assertions break. Actual: the test is reported passed without the property
  ever being observed.
- `apply.property.test.ts:43` — "speakerEarnTotal equals the sum of only Speaker earn records".
  Expected: a mis-summed total fails the run. Actual: reported passed.
- `packages/backend/src/user/change-nickname.property.test.ts` before its reference fix — reported
  "34 passed" while four tests threw on undefined `GetCommand` / `QueryCommand` / `UpdateCommand`
  (used with `instanceof`, never imported). Expected: an unresolved identifier is a visible
  failure. Actual: swallowed, all green. Already fixed; out of scope.
- Sibling in the same file set: `apply.property.test.ts:414` uses `fc.assert(fc.property(...))`
  synchronously. Expected and actual: correct as-is, and it must stay untouched.
- `npx vitest --run packages/backend` — aborts with
  `FATAL ERROR: Ineffective mark-compacts near heap limit / Allocation failed - JavaScript heap out
  of memory`, reproducing with `NODE_OPTIONS=--max-old-space-size=8192` set. Expected: a completed
  run with an aggregate summary.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Synchronous `fc.assert(fc.property(...))` assertions keep executing and reporting exactly as
  today; no conversion to `async`/`await`, no change to the assertion body.
- Tests that pass today for genuine reasons keep passing, with assertions and `numRuns` values
  untouched.
- Already-correct async assertions (`packages/backend/src/ugl-exit/`,
  `packages/backend/src/digest/`, `packages/backend/src/email/send.property.test.ts`,
  `packages/backend/src/admin/roles-permission.property.test.ts`,
  `packages/backend/src/travel/settings.property.test.ts:204`, and the rest) run unchanged.
- Test discovery keeps matching every file covered by the existing `include` patterns; no file is
  excluded to make the suite fit in memory.
- Targeted invocations keep working and reporting: `npx vitest --run packages/backend/src/travel`,
  and single-file runs.
- Production source is unchanged unless a newly surfaced failure genuinely implicates it. No
  production change is made for test convenience.
- Already-shipped fixes stay as they are and are not re-implemented or reverted: the SES
  49-BCC-per-message cap, `change-nickname.property.test.ts`, the nickname-validators generator,
  and the corrected content/handler assertion.
- `vi.restoreAllMocks()` in `beforeEach` stays as the mock-lifecycle convention. Defect A is fixed
  by tying property lifetime to the test, not by moving or removing mock resets.

**Scope:**

All test cases and run scopes that do NOT satisfy C_A or C_B are completely unaffected. That
includes:

- Every synchronous `fc.property` assertion in the corpus.
- Every already-awaited `fc.asyncProperty` assertion.
- Every plain (non-property) unit and integration test.
- Every single-file and single-directory runner invocation.
- Frontend, shared, and cdk test files.

The one intended and accepted difference: violations previously hidden by Defect A become visible
failures. Each is then resolved on its merits.

## Hypothesized Root Cause

### Defect A

1. **No mechanical enforcement of floating Promises**: the repo has no ESLint setup, so
   `@typescript-eslint/no-floating-promises` (the rule that would catch this exact shape) is not
   available. `npm run lint` is `tsc --noEmit` at the root, and the root `tsconfig.json` **excludes
   `packages`**, so backend test files are not type-checked by the lint script at all. This is also
   the most likely reason the missing `GetCommand`/`QueryCommand`/`UpdateCommand` imports survived:
   only `tsc -b` in `packages/backend` (whose `include` is `src/**/*.ts`, test files included)
   would have flagged them, and that is the build script, not the lint script.
2. **Template drift through copy-paste**: `apply.property.test.ts` and `review.property.test.ts`
   both mix synchronous and asynchronous properties. The synchronous form correctly needs no
   `await`, and the async blocks appear to have been copied from the synchronous ones, keeping the
   non-`async` callback.
3. **Vitest's unhandled-rejection handling is advisory in practice for this shape**: the rejection
   arrives after the owning test has been reported. Whether the run's exit code stays 0 depends on
   when the rejection lands relative to the end of the file/run; the observed behavior was a
   zero-failure, success-status run. `dangerouslyIgnoreUnhandledErrors` is not set in
   `vitest.config.ts`, so this must be verified empirically rather than assumed.
4. **Mock lifecycle collision**: `beforeEach(() => vi.restoreAllMocks())` is the file-wide
   convention. Combined with an orphaned property, it wipes live `vi.fn()` implementations
   mid-flight, so the next `send()` returns `undefined` and the failure presents as
   `TypeError: Cannot read properties of undefined (reading 'Items')` from inside a production call
   path — a misdirection, not a production bug.

### Defect B

Cause is unconfirmed and must be measured before any knob is changed. Candidate causes, most to
least likely:

1. **Heap accumulation in reused worker processes**: Vitest's default `forks` pool reuses child
   processes across files. Module registries are isolated per file, but memory retained by module-
   scope closures, large generated arrays, and fast-check shrink history is not necessarily
   reclaimed between files in the same worker. 204 backend files, 104 of them property files, is
   enough to exhaust a default worker heap.
2. **`NODE_OPTIONS` not reaching the process that dies**: Vitest launches pool children with its
   own `execArgv`, so a `--max-old-space-size` set on the parent shell may not apply to the child
   that actually exhausts its heap. This would explain the 8 GB setting having no effect and is
   cheap to confirm.
3. **Module-scope retention in test files**: arbitraries, fixtures, or mock stores declared at
   module scope and captured by closures keep whole generated datasets alive for the file's
   lifetime, multiplied by however many files share a worker.
4. **Main-process aggregation**: the parent process accumulates per-file results, serialized errors,
   and console output for 204 files. If the fatal error is in the parent rather than a worker, the
   remedy is sharding, not worker heap sizing.
5. **Oversized generated values in specific files**: a few arbitraries produce large arrays or long
   strings at high `numRuns`, making one or two files disproportionately expensive. Per-file heap
   logging will name them.

## Correctness Properties

Property 1: Bug Condition A - Async property assertions are observable

_For any_ test case where the bug condition holds (`isBugConditionA` returns true), the fixed test
file SHALL have an `async` enclosing callback and an awaited `fc.assert` call, such that the test
does not complete until the property has finished, a property violation fails the owning test and
counts toward the run's failure total with a non-zero exit code, no property execution belonging to
a completed test is still in flight, and the run emits no unhandled rejection.

**Validates: Requirements 2.1, 2.2, 2.3, 2.6**

Property 2: Preservation - Non-buggy test cases and run scopes are unchanged

_For any_ test case or run scope where neither bug condition holds (`isBugConditionA` and
`isBugConditionB` both return false), the fixed suite SHALL produce the same observable result as
the original suite: synchronous `fc.property` assertions unconverted and unmodified, already-awaited
async assertions unmodified, each test's `numRuns` not lowered and its assertions not weakened or
skipped, discovery still matching every file covered by the existing `include` patterns, and
single-file / single-directory invocations still supported and reported.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6**

Property 3: Bug Condition B - The full backend suite completes and reports honestly

_For any_ run scope where `isBugConditionB` returns true, the documented single command SHALL run
every discovered backend test file to completion without exhausting the JS heap, report an aggregate
pass/fail summary over exactly the discovered file set, emit zero unhandled rejections, and exit
non-zero with a positive failure count whenever any property is violated.

**Validates: Requirements 2.5, 2.6**

Property 4: Guard - The detector is sound and complete on the C_A shape

_For any_ generated test-file source, the detector SHALL report a finding at exactly those
`fc.assert` calls whose direct argument is `fc.asyncProperty` and which are not awaited, and SHALL
report no finding for awaited async assertions, for synchronous `fc.property` assertions, for
`fc.asyncProperty` occurrences that are not the direct argument of `fc.assert`, or for occurrences
inside comments or string literals — so that an un-awaited assertion introduced by a new or
modified file fails the guard check and a correctly written file never does.

**Validates: Requirements 2.9**

Property 5: Preservation - Newly surfaced failures are resolved, not suppressed

_For any_ test that begins failing once its assertion is awaited, the resolution SHALL be a
production fix (when production behavior is wrong) or a test/generator fix (when the expectation or
input domain is wrong), and SHALL NOT be blanket suppression, `skip`/`todo` marking, assertion
weakening or removal, `numRuns` reduction, or a production change made for test convenience.

**Validates: Requirements 2.7, 2.8, 3.4, 3.7**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct.

**1. Detector module (new)**

**File**: `packages/backend/src/testing/property-await-audit.ts`

Placed under a corpus-covered path so the existing Vitest `include` patterns discover its tests and
`tsc -b` type-checks it — no config change, no new dependency. It follows the existing convention
for repo tooling that lives beside source (see
`packages/backend/src/admin/migrate-skill-points-to-volunteer.ts`, which guards its CLI entry with
`require.main === module`).

- `findUnawaitedAsyncAssertions(source: string): Finding[]` — pure. Strips comments and string
  literals, then matches `fc.assert(` optionally preceded by `await`, resolves the **direct**
  first argument, and records a finding when that argument is `fc.asyncProperty` and no `await` is
  present. Returns `{ line, snippet }` per finding.
- `collectCorpusFiles(root: string): string[]` — walks the `include` globs from
  `vitest.config.ts`; the single source of truth for the file list is that config, not a duplicated
  list.
- `auditCorpus(root: string): { file: string; findings: Finding[] }[]` — composition of the two.
- `collectBaselineStats(source: string)` — per-file counts of synchronous `fc.property` assertions,
  already-awaited async assertions, `numRuns` values, and `skip`/`todo` markers. Used by the
  preservation comparison.
- Optional CLI entry under `require.main === module` printing findings and exiting non-zero, for
  ad-hoc use via `npx ts-node`.

**2. Guard test (new)**

**File**: `packages/backend/src/testing/property-await-guard.test.ts`

Runs `auditCorpus` over the repo and fails with the file:line list when any finding exists.
Expressing the guard as a test means `npm test` and any CI that runs it enforce 2.9 with zero new
tooling, and it satisfies "an automated guard flags it and fails the check".

**3. Convert the 10 un-awaited assertions**

**Files**: `packages/backend/src/travel/apply.property.test.ts` (lines 43, 119, 236, 599, 780) and
`packages/backend/src/travel/review.property.test.ts` (lines 77, 137, 203, 262, 347)

Mechanical rewrite, matching the shape already used in the reference fix
(`packages/backend/src/user/change-nickname.property.test.ts`):

```ts
// before
it('...', () => {
  fc.assert(
    fc.asyncProperty(/* ... */),
    { numRuns: 50 },
  );
});

// after
it('...', async () => {
  await fc.assert(
    fc.asyncProperty(/* ... */),
    { numRuns: 50 },
  );
});
```

Nothing inside the property body, the arbitraries, or the options object changes. `numRuns` is
carried over verbatim. Re-run the audit after conversion; the audit result — not the list in this
document — is the authority on completeness.

**4. Verify missing-import visibility**

**File**: `package.json` (root)

Requirement 2.4 needs an unresolved identifier in a test file to surface as a visible failure.
`packages/backend/tsconfig.json` already includes `src/**/*.ts`, so `tsc -b` covers test files,
but the root `lint` script excludes `packages` entirely. Add a type-check script that covers the
packages (e.g. `"typecheck": "tsc --noEmit && npm run build --workspaces"` or a per-package
`tsc --noEmit -p packages/backend`) and document it as part of the verification command set. No
change to `lint`'s existing behavior.

**5. Make the full backend suite completable — measure, then tune**

**Files**: `vitest.config.ts`, `package.json` (root), and possibly a small runner script under
`scripts/`

Ordered, stop-when-green:

1. **Measure**: run with per-file heap logging (`--logHeapUsage`) over shards to identify whether
   the fatal error is in a worker or the parent, and which files dominate. Record the numbers;
   they decide steps 2–4.
2. **Worker heap and concurrency** (if the worker dies): set
   `poolOptions.forks.execArgv: ['--max-old-space-size=<N>']` and cap `maxForks` in
   `vitest.config.ts`, so the limit reaches the process that actually needs it.
3. **Sharded aggregate run** (if the parent dies, or if step 2 is insufficient): a
   `test:backend` script that runs `vitest --run --shard=i/N --reporter=blob packages/backend`
   sequentially and then merges the blobs into one aggregate summary, propagating a non-zero exit
   code if any shard fails. This is the documented single command for 2.5.
4. **Targeted retention fixes** (only if specific files dominate): move oversized module-scope
   fixtures inside the property callback so they are collectable per run. No `numRuns` reduction,
   no assertion change, no file exclusion.

Explicitly not on the table: adding files to `exclude`, reducing `numRuns` to save memory, or
setting `dangerouslyIgnoreUnhandledErrors`.

**6. Triage newly surfaced failures**

Each failure exposed by awaiting is handled individually. Decision rule: reproduce the
counterexample against production code with mocks that reflect the real service contract. If
production is wrong, fix production and add a regression test. If the generator produces inputs
outside the real domain, or the expectation is stale, fix the test. Record the verdict per failure.
No suppression, no `skip`, no weakening, no `numRuns` reduction.

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples on unfixed code: run the detector over the current
corpus, await one file's assertions and observe what breaks, and run the full backend suite to
reproduce the OOM. Then verify the fix holds and that everything outside the bug conditions is
untouched.

Test placement and style follow existing conventions: `*.test.ts` for unit/integration,
`*.property.test.ts` for fast-check properties, `describe('Feature: <spec>, Property N: <title>')`
headers with a `**Validates: Requirements X.Y**` comment block, vitest `globals: true`,
`beforeEach(() => vi.restoreAllMocks())`, and every `fc.assert(fc.asyncProperty(...))` awaited.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate both defects BEFORE implementing the fix, and
confirm or refute the root cause analysis. If refuted, re-hypothesize.

**Test Plan**: Write the detector first and run it over the unfixed corpus. Separately, convert a
single file's assertions in a scratch working copy and observe which tests then fail and with what
messages — that is the direct test of hypothesis A.4 (mock-lifecycle collision). For Defect B, run
the backend suite with per-file heap logging and record where the fatal error lands.

**Test Cases**:

1. **Corpus audit on unfixed code**: `auditCorpus` reports a non-empty finding list (will fail a
   zero-findings assertion on unfixed code). Current expectation: 10 findings across
   `apply.property.test.ts` and `review.property.test.ts`.
2. **False-positive check on unfixed code**: the audit reports no findings for
   `roles-permission.property.test.ts`, `settings.property.test.ts`, `ugl-exit/`, `digest/`, and
   `email/send.property.test.ts` (guards against the window-scan misclassification observed during
   analysis).
3. **Hidden-verdict demonstration**: an intentionally violated async property in a non-`async`
   callback is reported as passed with exit code 0 (will fail after the fix, which is the point).
4. **Orphan/mock-wipe demonstration**: an un-awaited property in one test plus
   `vi.restoreAllMocks()` in the next test's `beforeEach` reproduces a
   `Cannot read properties of undefined` error attributed to production code.
5. **Awaited-conversion probe**: after converting `review.property.test.ts`, record which of the
   five properties actually fail and their counterexamples — input to the triage step.
6. **Full-suite reproduction**: `npx vitest --run packages/backend` aborts with heap exhaustion,
   also with `NODE_OPTIONS=--max-old-space-size=8192`; record whether the parent or a worker dies
   and the per-file heap curve.

**Expected Counterexamples**:

- Un-awaited async assertions at the 10 known file:line positions; the audit is re-run rather than
  trusted, so additional positions may appear.
- Tests reported passed while their property never ran or threw.
- `TypeError: Cannot read properties of undefined (reading 'Items')` surfacing from a production
  call path whose real cause is a wiped mock in an orphaned property.
- `Allocation failed - JavaScript heap out of memory` before any aggregate summary is printed.
- Possible causes: no floating-Promise enforcement (no ESLint, root `tsc` excludes `packages`),
  copy-paste from the synchronous form, advisory unhandled-rejection handling, mock resets racing
  in-flight properties; and for Defect B, worker heap accumulation, `NODE_OPTIONS` not reaching the
  dying process, module-scope retention, or parent-side aggregation.

### Fix Checking

**Goal**: Verify that for all inputs where a bug condition holds, the fixed suite produces the
expected behavior.

**Pseudocode:**

```
FOR ALL X WHERE isBugConditionA(X) DO
  fixed := rewrite(X)                          // async callback + awaited fc.assert
  ASSERT fixed.callbackIsAsync = TRUE
     AND fixed.assertIsAwaited = TRUE
     AND (propertyViolated(fixed) IMPLIES testReportedFailed(fixed))
     AND no_unhandled_rejection(run(fixed))
     AND fixed.numRuns >= X.numRuns
     AND assertionsPreserved(fixed, X)         // no weakening, no skip
END FOR

FOR ALL X WHERE isBugConditionB(X) DO
  result := run_fixed(X)
  ASSERT result.completed = TRUE
     AND result.heapExhausted = FALSE
     AND result.filesExecuted = discoveredFiles(X)
     AND result.unhandledRejections = 0
     AND (anyPropertyViolated(result) IMPLIES
            (result.failureCount > 0 AND result.exitCode <> 0))
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where neither bug condition holds, the fixed suite produces
the same result as the original suite.

**Pseudocode:**

```
FOR ALL X WHERE NOT (isBugConditionA(X) OR isBugConditionB(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach**: Property-based testing is the right tool here for two reasons. First, the
preservation domain is the whole corpus — 204 backend files and every `fc.assert` call in them —
which is exactly the kind of large, enumerable input space where generated cases beat hand-picked
ones. Second, the detector that drives the fix is a pure text-in/findings-out function, so
fast-check can generate synthetic test-file sources with a known ground-truth label and check the
detector's verdict against it, including the awkward cases (nested calls, multiline arguments,
comments, string literals) that hand-written cases miss.

`F` is made concrete as a committed baseline snapshot: `collectBaselineStats` is run over the corpus
at the pre-fix commit and the result stored as a JSON fixture. The preservation test recomputes the
stats on the fixed corpus and compares.

**Test Plan**: Capture the baseline on unfixed code first, then write the property tests that
compare the fixed corpus against it. Separately, record the pass/fail result of a targeted run
(`npx vitest --run packages/backend/src/travel`) before and after the fix.

**Test Cases**:

1. **Synchronous assertions untouched**: observe on unfixed code that every
   `fc.assert(fc.property(...))` is non-async and unmodified; verify after the fix that the count
   and positions per file match the baseline exactly (3.1).
2. **Already-awaited assertions untouched**: observe the awaited-async count per file on unfixed
   code (`ugl-exit/`, `digest/`, `email/send.property.test.ts`,
   `roles-permission.property.test.ts`, `settings.property.test.ts`); verify it is unchanged except
   for the 10 intended conversions (3.3).
3. **`numRuns` never lowered**: compare every `numRuns` value against the baseline; assert each is
   greater than or equal to its baseline value (3.2, 2.8).
4. **No new suppression**: assert the corpus-wide count of `skip`, `todo`, `only`, and
   `dangerouslyIgnoreUnhandledErrors` occurrences has not increased over the baseline, and that no
   file was added to Vitest `exclude` (2.8, 3.5).
5. **Discovery unchanged**: assert the discovered file set equals the baseline file set — no file
   dropped to fit the suite in memory (3.5).
6. **Targeted runs unchanged**: a single-directory and a single-file invocation produce the same
   pass/fail result as recorded pre-fix, modulo the intended conversions (3.6).
7. **Prior fixes intact**: the SES 49-BCC cap tests, `change-nickname.property.test.ts`, the
   nickname-validators generator, and the content/handler assertion all still pass unmodified
   (3.7).

### Unit Tests

**File**: `packages/backend/src/testing/property-await-audit.test.ts`

- `findUnawaitedAsyncAssertions` on a hand-written un-awaited case returns one finding with the
  correct line number.
- On `await fc.assert(fc.asyncProperty(...))` returns no finding.
- On `fc.assert(fc.property(...))` returns no finding.
- On an un-awaited assertion inside an `async` callback (async callback, missing `await`) returns a
  finding — the callback being `async` is not sufficient.
- On a synchronous assertion textually adjacent to an async one returns exactly one finding — the
  regression test for the window-scan false positive on `roles-permission.property.test.ts`.
- On `fc.asyncProperty` inside a comment or a string literal returns no finding.
- On a multiline `fc.assert(\n  fc.asyncProperty(` layout (the repo's prevailing formatting)
  returns a finding.
- `collectCorpusFiles` returns the same set as the Vitest `include` patterns for a fixture tree.
- `collectBaselineStats` extracts `numRuns` from both inline and multiline options objects.

### Property-Based Tests

**File**: `packages/backend/src/testing/property-await-audit.property.test.ts`

- **Property 4 (detector soundness/completeness)**: generate a test-file source by composing a
  random sequence of labelled blocks — awaited-async, un-awaited-async, synchronous, async-in-
  comment, async-in-string, `fc.asyncProperty` passed as a non-first argument — with random
  indentation, random `numRuns`, and random interleaving. Assert the detector's finding count and
  line numbers equal the count and positions of the un-awaited-async blocks.
- **Property 4 (idempotence under rewrite)**: for any generated source, applying the conversion
  rewrite and re-running the detector yields zero findings, and re-applying the rewrite is a no-op.
- **Property 2 (baseline preservation over generated corpora)**: for any generated source, the
  synchronous-assertion count, `numRuns` multiset, and `skip`/`todo` count computed by
  `collectBaselineStats` are identical before and after the rewrite.
- **Property 1/3 (whitespace and formatting invariance)**: for any generated source, detector
  findings are invariant under reformatting that preserves token order (extra blank lines, changed
  indentation, trailing commas).

### Integration Tests

**File**: `packages/backend/src/testing/property-await-guard.test.ts` plus documented manual runs

- **Guard over the real corpus**: `auditCorpus` on the repo returns zero findings; the failure
  message lists file:line for each finding. Fails before the fix, passes after (Property 1, 2.9).
- **Violation visibility end to end**: a fixture spec containing an awaited, deliberately violated
  async property, run in a child Vitest process, exits non-zero with a failure count of at least 1
  and no unhandled-rejection-only output (2.2, 2.6).
- **No in-flight properties across tests**: a fixture spec where an awaited property is followed by
  a test whose `beforeEach` calls `vi.restoreAllMocks()` runs clean, with no
  `Cannot read properties of undefined` errors (2.3).
- **Missing import visibility**: a fixture test file referencing an unimported identifier fails
  type-check via the packages-covering typecheck script, and fails at runtime rather than reporting
  as passed (2.4).
- **Full backend suite**: the documented single command runs all discovered backend files to
  completion, prints an aggregate summary, reports zero unhandled rejections, and exits non-zero if
  anything fails (2.5, Property 3).
- **Targeted runs**: `npx vitest --run packages/backend/src/travel` and a single-file run still
  report results, matching the pre-fix outcome for unconverted tests (3.6).
- **Travel suites after conversion**: `apply.property.test.ts` and `review.property.test.ts` run
  with all 10 properties actually executed, and every triaged failure resolved on its merits (2.7,
  Property 5).
