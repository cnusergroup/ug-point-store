# Implementation Plan: Property Test Await Reliability (Bugfix)

## Overview

Two independent defects are fixed here. Defect A: `fc.assert(fc.asyncProperty(...))` inside a
non-`async` `it`/`test` callback with no `await`, so the test is reported passed before the property
runs. Defect B: `npx vitest --run packages/backend` dies with a JS heap out-of-memory fatal error,
so there is no aggregate backend result.

Order of work follows the bugfix methodology: exploration first (build the detector, audit the
unfixed corpus, demonstrate the hidden verdict and the orphaned-property mock wipe, reproduce and
measure the OOM), then capture the preservation baseline on unfixed code, then implement the fix
(convert the un-awaited assertions, triage what awaiting exposes, add a packages-covering
type-check script, make the full suite completable), then re-run every exploration and preservation
check.

The detector `findUnawaitedAsyncAssertions` in `packages/backend/src/testing/property-await-audit.ts`
is the leverage point: audit tool, regression guard, and subject of the property tests, all from one
pure function.

## Tasks

- [x] 1. Write bug condition A exploration test (detector + corpus audit)
  - **Property 1: Bug Condition** - Un-awaited async property assertions are unobservable
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `isBugConditionA` holds in the real corpus
  - **Scoped PBT Approach**: Defect A is deterministic, so scope this check to the concrete corpus: the audit runs over the exact file set matched by the `include` patterns in `vitest.config.ts` (`packages/*/src/**/*.test.ts(x)`, `packages/cdk/lambda/**/*.test.ts`, `packages/cdk/test/**/*.test.ts`)
  - Create `packages/backend/src/testing/property-await-audit.ts` with `findUnawaitedAsyncAssertions(source: string): Finding[]` (pure: strips comments and string literals, anchors on the **direct** first argument of `fc.assert`, returns `{ line, snippet }`), `collectCorpusFiles(root: string): string[]` (walks the `vitest.config.ts` `include` globs - that config is the single source of truth), and `auditCorpus(root: string)`
  - Create `packages/backend/src/testing/property-await-guard.test.ts` asserting `auditCorpus` returns zero findings, failing with the `file:line` list of every finding
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with a non-empty finding list (this is correct - it proves the bug exists). Current expectation is 10 findings: `packages/backend/src/travel/apply.property.test.ts` lines 43, 119, 236, 599, 780 and `packages/backend/src/travel/review.property.test.ts` lines 77, 137, 203, 262, 347. The audit result, not this list, is the authority on completeness
  - Confirm no false positives on `packages/backend/src/admin/roles-permission.property.test.ts`, `packages/backend/src/travel/settings.property.test.ts`, `packages/backend/src/ugl-exit/`, `packages/backend/src/digest/`, `packages/backend/src/email/send.property.test.ts` (guards against the 400-character window-scan misclassification observed during analysis)
  - Document counterexamples found (file:line list plus the audit's total count) to understand root cause
  - Mark task complete when the detector and guard test are written, run, and the failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.9_

- [x] 2. Write bug condition A hidden-verdict and orphan-mock exploration tests
  - **Property 1: Bug Condition** - Hidden verdicts and orphaned properties
  - **CRITICAL**: These tests MUST FAIL (or demonstrate the wrong outcome) on unfixed code
  - **GOAL**: Confirm or refute root cause hypotheses A.3 (advisory unhandled-rejection handling) and A.4 (mock-lifecycle collision). If refuted, re-hypothesize before implementing
  - Add fixture-driven integration tests under `packages/backend/src/testing/` that run a child Vitest process against a fixture spec containing a deliberately violated `fc.asyncProperty` in a non-`async` callback; record the reported pass/fail state, failure count, exit code, and whether the violation appears only as unhandled-rejection console noise
  - Add a fixture spec where an un-awaited property is followed by a test whose `beforeEach` calls `vi.restoreAllMocks()`; record whether the wiped `vi.fn()` mocks reproduce `TypeError: Cannot read properties of undefined (reading 'Items')` attributed to a production call path
  - Awaited-conversion probe: in a scratch working copy, convert only `packages/backend/src/travel/review.property.test.ts` to `async` callbacks with `await fc.assert(...)`, run it, and record which of the 5 properties actually fail plus their counterexamples - this list is the input to the triage step in task 6.2
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: violated property reported as passed with exit code 0; misdirected `undefined` errors reproduced; the review.property.test.ts probe yields a concrete failure/counterexample list
  - Mark task complete when the demonstrations are run and their outputs are documented
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.6_

- [x] 3. Write bug condition B exploration probe (full backend suite reproduction)
  - **Property 3: Bug Condition** - The full backend suite cannot complete
  - **CRITICAL**: This probe MUST reproduce the fatal error on unfixed code
  - **GOAL**: Reproduce the heap exhaustion and measure where it lands BEFORE changing any runner knob
  - Run `npx vitest --run packages/backend` and record the fatal error (`Ineffective mark-compacts near heap limit` / `Allocation failed - JavaScript heap out of memory`) and the absence of any aggregate summary
  - Re-run with `NODE_OPTIONS=--max-old-space-size=8192` set to confirm the setting has no effect (tests hypothesis B.2: Vitest launches pool children with their own `execArgv`)
  - Run with `--logHeapUsage` over shards to record the per-file heap curve, identify whether the parent process or a pool worker dies, and name the files that dominate memory
  - Record the discovered backend file count (expected 204 under `packages/backend/src`, 104 of them `*.property.test.ts`) as the file set the fixed run must execute in full
  - **EXPECTED OUTCOME**: fatal heap error reproduced, and the measurement identifies parent vs worker plus the dominant files - these numbers decide which fix steps in task 6.4 are needed
  - Mark task complete when the reproduction and the heap measurement are documented
  - _Requirements: 1.5, 1.6, 2.5_

- [x] 4. Write preservation baseline and preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-buggy test cases and run scopes are unchanged
  - **IMPORTANT**: Follow observation-first methodology - capture `F` on UNFIXED code first, then assert against it
  - Add `collectBaselineStats(source: string)` to `packages/backend/src/testing/property-await-audit.ts`: per file, the count and line positions of synchronous `fc.assert(fc.property(...))` assertions, the count of already-awaited async assertions, every `numRuns` value (inline and multiline options objects), and the count of `skip` / `todo` / `only` / `dangerouslyIgnoreUnhandledErrors` markers
  - Observe on unfixed code and commit the result as a JSON baseline fixture under `packages/backend/src/testing/` - this is the `F` side of `FOR ALL X WHERE NOT (isBugConditionA(X) OR isBugConditionB(X)) DO ASSERT F(X) = F'(X)`
  - Write property-based tests in `packages/backend/src/testing/property-await-preservation.property.test.ts` that recompute the stats over the corpus and compare against the baseline: synchronous assertion counts and positions identical (3.1); awaited-async counts unchanged except for the 10 intended conversions (3.3); every `numRuns` greater than or equal to its baseline value (3.2, 2.8); suppression-marker counts not increased and no file added to Vitest `exclude` (2.8, 3.5); discovered file set equal to the baseline file set (3.5)
  - Observe and record the pre-fix pass/fail result of `npx vitest --run packages/backend/src/travel` and of a single-file run, for the targeted-invocation comparison after the fix (3.6)
  - Observe and record that the prior fixes pass unmodified: the SES 49-BCC-per-message cap tests, `packages/backend/src/user/change-nickname.property.test.ts`, the nickname-validators generator, and the corrected content/handler assertion (3.7)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when the baseline is committed and the preservation tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

- [x] 5. Write detector soundness and completeness tests
  - **Property 4: Guard** - The detector is sound and complete on the C_A shape
  - **IMPORTANT**: The guard is only trustworthy if the detector is; write these before relying on the audit to drive the fix
  - Unit tests in `packages/backend/src/testing/property-await-audit.test.ts`: one finding with the correct line number for a hand-written un-awaited case; no finding for `await fc.assert(fc.asyncProperty(...))`; no finding for `fc.assert(fc.property(...))`; a finding for an un-awaited assertion inside an `async` callback (async alone is not sufficient); no finding for `fc.asyncProperty` in a comment or string literal; exactly one finding for a synchronous assertion textually adjacent to an async one (regression test for the `roles-permission.property.test.ts` false positive); a finding for the repo's prevailing multiline `fc.assert(\n  fc.asyncProperty(` layout; `collectCorpusFiles` matching the `include` patterns over a fixture tree; `collectBaselineStats` extracting `numRuns` from inline and multiline options objects
  - Property tests in `packages/backend/src/testing/property-await-audit.property.test.ts`: generate sources by composing labelled blocks (awaited-async, un-awaited-async, synchronous, async-in-comment, async-in-string, `fc.asyncProperty` as a non-first argument) with random indentation, random `numRuns`, and random interleaving, then assert the detector's finding count and line numbers equal the un-awaited-async block positions; assert rewrite idempotence (post-rewrite audit is empty, re-rewrite is a no-op); assert `collectBaselineStats` output is identical before and after rewrite for synchronous count, `numRuns` multiset, and `skip`/`todo` count; assert findings are invariant under token-order-preserving reformatting
  - Follow existing conventions: `describe('Feature: property-test-await-reliability, Property 4: <title>')`, `beforeEach(() => vi.restoreAllMocks())`, and every `fc.assert(fc.asyncProperty(...))` awaited
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (the detector is new code; these tests validate it, not the buggy corpus)
  - _Requirements: 2.9_

- [x] 6. Fix for un-awaited async property assertions and the uncompletable backend suite

  - [x] 6.1 Convert the un-awaited async assertions found by the audit
    - Mechanically rewrite each finding to `async () => { await fc.assert(fc.asyncProperty(...), { numRuns: N }); }`, matching the shape of the reference fix in `packages/backend/src/user/change-nickname.property.test.ts`
    - Apply to `packages/backend/src/travel/apply.property.test.ts` (lines 43, 119, 236, 599, 780) and `packages/backend/src/travel/review.property.test.ts` (lines 77, 137, 203, 262, 347), plus any further position the audit from task 1 reported
    - Change nothing inside the property body, the arbitraries, or the options object; carry `numRuns` over verbatim
    - Leave synchronous `fc.assert(fc.property(...))` assertions untouched, including `apply.property.test.ts:414`
    - Re-run `auditCorpus` after conversion; the audit result, not the line list in the design, is the authority on completeness
    - _Bug_Condition: isBugConditionA(X) = X.usesAsyncProperty AND (NOT X.callbackIsAsync OR NOT X.assertIsAwaited)_
    - _Expected_Behavior: fixed.callbackIsAsync = TRUE AND fixed.assertIsAwaited = TRUE AND fixed.numRuns >= X.numRuns AND assertionsPreserved(fixed, X)_
    - _Preservation: Preservation Requirements from design - synchronous assertions unconverted, already-awaited assertions unmodified, no numRuns lowered_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 6.2 Triage each newly surfaced failure on its merits
    - Work through the failure list recorded in task 2's awaited-conversion probe plus any further failure the full conversion exposes
    - Decision rule: reproduce the counterexample against production code with mocks reflecting the real service contract. If production behavior is wrong, fix production and add a regression test. If the generator produces inputs outside the real domain or the expectation is stale, fix the test or generator
    - Record the verdict and the reasoning per failure
    - No blanket suppression, no `skip`/`todo`, no assertion weakening or removal, no `numRuns` reduction, no production change made for test convenience
    - _Bug_Condition: failures revealed once isBugConditionA cases are awaited_
    - _Expected_Behavior: each failure resolved by a production fix or a test/generator fix_
    - _Preservation: production source unchanged unless genuinely implicated (3.4); prior fixes not re-implemented or reverted (3.7)_
    - _Requirements: 2.7, 2.8, 3.4, 3.7_
    - **Triage Verdict (recorded):**
      - Task 2 awaited-conversion probe: ALL 5 properties in `review.property.test.ts` PASS — no counterexamples produced
      - Full conversion run `apply.property.test.ts`: 20 tests passed, 0 failures
      - Full conversion run `review.property.test.ts`: 6 tests passed, 0 failures
      - Guard test: 0 findings remaining in corpus (3 tests passed)
      - **Verdict: No failures surfaced.** The conversion was purely mechanical — all properties hold against production code with the existing mocks. No production fix needed (3.4 satisfied), no test/generator fix needed, no suppression applied (2.8 satisfied), prior fixes untouched (3.7 satisfied).

  - [x] 6.3 Make missing imports visible via a packages-covering type-check script
    - Add a `typecheck` script to the root `package.json` that covers the packages (e.g. `tsc --noEmit -p packages/backend`, or `tsc --noEmit && npm run build --workspaces`), since the root `tsconfig.json` excludes `packages` and the existing `lint` script therefore never type-checks backend test files
    - Leave the existing `lint` script's behavior unchanged
    - Document the script as part of the verification command set
    - Verify with a fixture test file referencing an unimported identifier: it fails type-check and fails at runtime rather than reporting as passed
    - _Bug_Condition: an unimported identifier used inside an un-awaited async property (1.4)_
    - _Expected_Behavior: unresolved identifiers surface as a visible test or type-check failure_
    - _Preservation: `lint` keeps its current behavior; `packages/backend/tsconfig.json` include unchanged_
    - _Requirements: 1.4, 2.4_

  - [x] 6.4 Make the full backend suite complete and report an aggregate result
    - Apply the ordered, stop-when-green plan using the measurements from task 3
    - If a pool worker dies: set `poolOptions.forks.execArgv: ['--max-old-space-size=<N>']` and cap `maxForks` in `vitest.config.ts` so the limit reaches the process that needs it
    - If the parent dies, or worker tuning is insufficient: add a `test:backend` script that runs `vitest --run --shard=i/N --reporter=blob packages/backend` sequentially, merges the blobs into one aggregate summary, and propagates a non-zero exit code if any shard fails - this is the documented single command for 2.5
    - Only if specific files dominate: move oversized module-scope fixtures inside the property callback so they are collectable per run
    - Explicitly out of bounds: adding files to Vitest `exclude`, reducing `numRuns` to save memory, setting `dangerouslyIgnoreUnhandledErrors`
    - Document the single command that produces the aggregate backend result
    - _Bug_Condition: isBugConditionB(X) = X.scope = 'packages/backend' AND X.runsAllDiscoveredFiles = TRUE_
    - _Expected_Behavior: result.completed AND NOT result.heapExhausted AND result.filesExecuted = discoveredFiles(X) AND result.unhandledRejections = 0 AND (anyPropertyViolated IMPLIES failureCount > 0 AND exitCode <> 0)_
    - _Preservation: discovery still matches every `include`-covered file (3.5); single-file and single-directory invocations still supported (3.6)_
    - _Requirements: 1.5, 1.6, 2.5, 2.6, 3.5, 3.6_

  - [x] 6.5 Verify the bug condition A exploration tests now pass
    - **Property 1: Expected Behavior** - Async property assertions are observable
    - **IMPORTANT**: Re-run the SAME tests from tasks 1 and 2 - do NOT write new tests
    - The guard test from task 1 encodes the expected behavior; when it passes, the C_A shape is gone from the corpus
    - Run `packages/backend/src/testing/property-await-guard.test.ts`: zero findings
    - Re-run the violation-visibility fixture: a violated awaited property fails its test, counts toward the failure total, and exits non-zero
    - Re-run the orphan/mock-wipe fixture: no in-flight property survives its test, no `Cannot read properties of undefined` misdirection, no unhandled rejections
    - **EXPECTED OUTCOME**: Tests PASS (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [x] 6.6 Verify the bug condition B behavior now holds
    - **Property 3: Expected Behavior** - The full backend suite completes and reports honestly
    - **IMPORTANT**: Re-run the same scope as task 3 - the documented single command over `packages/backend`
    - Confirm the run completes without heap exhaustion, executes exactly the discovered file set recorded in task 3, prints an aggregate pass/fail summary, reports zero unhandled rejections, and exits non-zero when any property is violated
    - **EXPECTED OUTCOME**: Run completes with an aggregate summary (confirms Defect B is fixed)
    - _Requirements: 2.5, 2.6_

  - [x] 6.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-buggy test cases and run scopes are unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 4 - do NOT write new tests
    - Run the preservation property tests against the committed baseline: synchronous assertion counts and positions unchanged, awaited-async counts unchanged except for the intended conversions, no `numRuns` lowered, no new suppression markers, discovered file set unchanged
    - Re-run `npx vitest --run packages/backend/src/travel` and the single-file invocation; compare against the pre-fix results recorded in task 4, modulo the intended conversions
    - Confirm the prior fixes still pass unmodified (SES 49-BCC cap, `change-nickname.property.test.ts`, nickname-validators generator, content/handler assertion)
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [x] 6.8 Verify no failure was suppressed
    - **Property 5: Preservation** - Newly surfaced failures are resolved, not suppressed
    - Review the diff for the whole fix: no blanket suppression, no `skip`/`todo`/`only` added, no assertion weakened or removed, no `numRuns` lowered, no file added to Vitest `exclude`, no `dangerouslyIgnoreUnhandledErrors`, no production change made for test convenience
    - Cross-check against the suppression-marker counts in the committed baseline
    - Confirm each triage verdict from task 6.2 is a production fix or a test/generator fix, with recorded reasoning
    - **EXPECTED OUTCOME**: Review passes with zero suppression findings
    - _Requirements: 2.7, 2.8, 3.4, 3.7_

  - [x] 6.9 Re-run the detector tests after the corpus rewrite
    - **Property 4: Guard** - The detector is sound and complete on the C_A shape
    - **IMPORTANT**: Re-run the SAME tests from task 5 - do NOT write new tests
    - Confirm the unit and property tests for `findUnawaitedAsyncAssertions`, `collectCorpusFiles`, and `collectBaselineStats` still pass, so the guard remains trustworthy as a regression gate
    - **EXPECTED OUTCOME**: Tests PASS
    - _Requirements: 2.9_

- [x] 7. Checkpoint - Ensure all tests pass
  - Run the documented single backend command, the new type-check script, and the guard, detector, and preservation tests
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks 1-3 are exploratory: they are expected to FAIL or reproduce a fatal error on unfixed code. Do not fix the code or the test when they fail - the failure is the evidence
- Tasks 4 and 5 are expected to PASS on unfixed code. Task 4 captures `F` (the baseline); task 5 validates the detector itself
- The corpus is the file set matched by the `include` patterns in `vitest.config.ts`; the config is the single source of truth for the file list, never a duplicated list in code or docs
- The audit result, not the 10 line positions listed in the design, is the authority on which assertions need conversion
- New files: `packages/backend/src/testing/property-await-audit.ts`, `property-await-audit.test.ts`, `property-await-audit.property.test.ts`, `property-await-guard.test.ts`, `property-await-preservation.property.test.ts`, plus the committed baseline JSON fixture
- Conventions: `*.test.ts` for unit/integration, `*.property.test.ts` for fast-check properties, `describe('Feature: property-test-await-reliability, Property N: <title>')` with a `**Validates: Requirements X.Y**` comment block, vitest `globals: true`, `beforeEach(() => vi.restoreAllMocks())`, every `fc.assert(fc.asyncProperty(...))` awaited
- Out of bounds for the whole fix: adding files to Vitest `exclude`, lowering `numRuns`, setting `dangerouslyIgnoreUnhandledErrors`, `skip`/`todo` marking, weakening assertions, changing production code for test convenience
- Out of scope (already fixed, must not be redone or reverted): the SES 49-BCC-per-message cap, `change-nickname.property.test.ts`, the nickname-validators generator, the corrected content/handler assertion
- Defect B fix is measure-then-tune and stop-when-green: the heap measurement from task 3 decides which sub-steps of 6.4 are applied

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "4", "5"] },
    { "id": 2, "tasks": ["6.1"] },
    { "id": 3, "tasks": ["6.2"] },
    { "id": 4, "tasks": ["6.3", "6.4"] },
    { "id": 5, "tasks": ["6.5", "6.6", "6.7", "6.8", "6.9"] },
    { "id": 6, "tasks": ["7"] }
  ]
}
```
