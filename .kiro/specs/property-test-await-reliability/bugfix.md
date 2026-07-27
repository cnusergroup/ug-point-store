# Bugfix Requirements Document

## Introduction

The backend property-based test suite reports success without validating anything, in two independent ways.

**Defect A — un-awaited async property assertions.** Property test files call `fc.assert(fc.asyncProperty(...))` inside a non-`async` `it`/`test` callback and never `await` the returned Promise. Vitest ends the test as soon as the callback returns, so the test is reported as **passed** before the property has finished running. A violated property surfaces only as "Unhandled Rejection" console noise and does not fail the run. Worse, the orphaned property keeps executing after its test has ended; when the next test's `beforeEach` calls `vi.restoreAllMocks()`, the still-running property's `vi.fn()` mocks are wiped and start returning `undefined`, producing misleading errors that appear to originate inside production code paths (e.g. `TypeError: Cannot read properties of undefined (reading 'Items')`).

The reference instance, already fixed, is `packages/backend/src/user/change-nickname.property.test.ts`: six un-awaited tests, four of which were additionally broken because `GetCommand`, `QueryCommand`, and `UpdateCommand` were used with `instanceof` but never imported. The file reported "34 passed" throughout. A repo audit run while drafting this document found 10 remaining un-awaited async assertions across `packages/backend/src/travel/apply.property.test.ts` and `packages/backend/src/travel/review.property.test.ts`; the audit must be re-run and completed as part of the fix rather than trusting that list.

**Defect B — the full backend suite cannot run to completion.** `npx vitest --run packages/backend` aborts with `FATAL ERROR: Ineffective mark-compacts near heap limit / Allocation failed - JavaScript heap out of memory`, reproducing even with `NODE_OPTIONS=--max-old-space-size=8192`. Heap pressure accumulates as many property-test files load into a single process. Consequently the suite can only be run directory-by-directory today, and `"test": "vitest --run"` in the root `package.json` has no sharding or isolation configuration, so CI is almost certainly not exercising the full backend suite.

**Why it matters.** A real production defect shipped undetected because of exactly this gap: `sendBulkEmail` in `packages/backend/src/email/send.ts` placed the sender into `ToAddresses` alongside 50 `BccAddresses`, totalling 51 destinations. SES counts To + Cc + Bcc against a single 50-destination-per-message limit, so every full batch was rejected with "Recipient count exceeds 50." The weekly digest delivered only its final partial batch — 45 of 145 subscribers received it. The existing tests asserted a batch size of exactly 50 and passed, because SES was mocked and the mock never enforced the real limit.

Prior art, already fixed and explicitly out of scope: the SES 49-BCC cap, the `change-nickname.property.test.ts` file, the over-broad nickname-validators generator, and a stale content/handler assertion. These are referenced as examples only and must not be redone.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a test file passes an `fc.asyncProperty` to `fc.assert` inside an `it`/`test` callback that is not `async` and does not `await` the returned Promise THEN the system reports the test as passed regardless of whether the property holds

1.2 WHEN such an un-awaited property is violated THEN the system reports the violation only as an unhandled rejection in console output, leaves the run's failure count at zero, and exits with a success status

1.3 WHEN an orphaned property continues executing after its own test has completed and a subsequent test's `beforeEach` calls `vi.restoreAllMocks()` THEN the system wipes the still-running property's `vi.fn()` mocks so they return `undefined`, producing errors that appear to originate inside production code (e.g. `TypeError: Cannot read properties of undefined (reading 'Items')`) and misdirect diagnosis

1.4 WHEN a test file inside an un-awaited async property references an identifier that was never imported (e.g. `GetCommand`, `QueryCommand`, `UpdateCommand` used with `instanceof`) THEN the system swallows the resulting error and still reports every test in the file as passed

1.5 WHEN `npx vitest --run packages/backend` is executed THEN the system aborts with a JavaScript heap out-of-memory fatal error before the suite finishes, including when `NODE_OPTIONS=--max-old-space-size=8192` is set

1.6 WHEN the full backend suite aborts on heap exhaustion THEN the system produces no aggregate pass/fail result for the backend package, so the suite can only be executed directory-by-directory and CI obtains no full-suite signal

### Expected Behavior (Correct)

2.1 WHEN a test file passes an `fc.asyncProperty` to `fc.assert` THEN the enclosing `it`/`test` callback SHALL be `async` and the `fc.assert` call SHALL be awaited, so the test does not complete until the property has finished

2.2 WHEN an awaited async property is violated THEN the system SHALL fail the owning test, count it in the run's failure total, and exit with a non-zero status

2.3 WHEN a test completes THEN no property execution belonging to that test SHALL still be in flight, so mock resets in a later test's `beforeEach` SHALL NOT be able to interfere with a previously started property

2.4 WHEN a test file references an identifier that is not imported THEN the system SHALL surface it as a visible test or type-check failure rather than reporting the file as passed

2.5 WHEN the full backend test suite is executed via a documented single command THEN the system SHALL run every discovered backend test file to completion without exhausting the JS heap and SHALL report an aggregate pass/fail summary

2.6 WHEN any test run emits an unhandled rejection THEN the system SHALL fail the run rather than treating it as advisory output

2.7 WHEN awaiting the assertions surfaces a previously hidden failure THEN each failure SHALL be triaged individually and resolved either by fixing the implementation (when production behavior is wrong) or by fixing the test or generator (when the test's expectation or input domain is wrong)

2.8 WHEN a failure is resolved THEN the resolution SHALL NOT be blanket suppression, `skip`/`todo` marking, weakening or removal of assertions, or lowering `numRuns` to make the failure disappear

2.9 WHEN a new or modified test file introduces an un-awaited `fc.assert` on an async property THEN an automated guard (lint rule or CI check) SHALL flag it and fail the check, so the defect class cannot silently return

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a test uses the synchronous `fc.property` form THEN the system SHALL CONTINUE TO execute and report it exactly as it does today, with no conversion to `async`/`await` and no change to the assertion

3.2 WHEN a test currently passes for genuine reasons THEN the system SHALL CONTINUE TO pass it, with its assertions and `numRuns` values unchanged

3.3 WHEN an async property assertion is already correctly awaited (for example the files under `packages/backend/src/ugl-exit/`, `packages/backend/src/digest/`, and `packages/backend/src/email/send.property.test.ts`) THEN the system SHALL CONTINUE TO run it unchanged

3.4 WHEN production source code is not implicated by a newly surfaced test failure THEN the system SHALL CONTINUE TO behave exactly as it does today, with no production changes made for test-convenience reasons

3.5 WHEN test discovery runs THEN the system SHALL CONTINUE TO discover and execute every test file matched by the existing Vitest `include` patterns, with no file excluded to make the suite fit in memory

3.6 WHEN a single file or a single directory is targeted (e.g. `npx vitest --run packages/backend/src/travel`) THEN the system SHALL CONTINUE TO support that invocation and report results for it

3.7 WHEN the previously applied fixes are exercised (the SES 49-BCC-per-message cap, `change-nickname.property.test.ts`, the nickname-validators generator, and the corrected content/handler assertion) THEN the system SHALL CONTINUE TO behave as already fixed, and those fixes SHALL NOT be re-implemented or reverted

### Bug Condition and Property

Two bug conditions apply, one per defect. `F` is the test suite as it exists before the fix; `F'` is the suite after the fix.

**Defect A — bug condition**

```pascal
FUNCTION isBugConditionA(X)
  INPUT: X of type TestCase          // one it()/test() block in a *.test.ts file
  OUTPUT: boolean

  // The assertion is asynchronous but its completion is not tied to the test
  RETURN X.usesAsyncProperty = TRUE
     AND (X.callbackIsAsync = FALSE OR X.assertIsAwaited = FALSE)
END FUNCTION
```

```pascal
// Property: Fix Checking - async property assertions are observable
FOR ALL X WHERE isBugConditionA(X) DO
  fixed ← rewrite(X)                          // async callback + awaited fc.assert
  ASSERT fixed.callbackIsAsync = TRUE
     AND fixed.assertIsAwaited = TRUE
     AND (propertyViolated(fixed) IMPLIES testReportedFailed(fixed))
     AND no_unhandled_rejection(run(fixed))
     AND fixed.numRuns ≥ X.numRuns
     AND assertionsPreserved(fixed, X)        // no weakening, no skip
END FOR
```

**Defect B — bug condition**

```pascal
FUNCTION isBugConditionB(X)
  INPUT: X of type SuiteRun           // an invocation scope for the test runner
  OUTPUT: boolean

  RETURN X.scope = 'packages/backend' AND X.runsAllDiscoveredFiles = TRUE
END FUNCTION
```

```pascal
// Property: Fix Checking - the full backend suite completes and reports honestly
FOR ALL X WHERE isBugConditionB(X) DO
  result ← run'(X)
  ASSERT result.completed = TRUE
     AND result.heapExhausted = FALSE
     AND result.filesExecuted = discoveredFiles(X)
     AND result.unhandledRejections = 0
     AND (anyPropertyViolated(result) IMPLIES
            (result.failureCount > 0 AND result.exitCode ≠ 0))
END FOR
```

**Preservation goal (applies to both defects)**

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugConditionA(X) OR isBugConditionB(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

Concretely: synchronous `fc.property` tests, already-awaited async property tests, and single-file or single-directory runs must produce the same observable result before and after the fix. The one intended and accepted difference is that violations previously hidden by Defect A become visible failures, each of which is then resolved on its merits under 2.7 and 2.8.

**Counterexamples demonstrating the bug**

- `packages/backend/src/travel/review.property.test.ts` — 5 `fc.assert(fc.asyncProperty(...))` calls in non-`async` callbacks; the file reports all tests passed.
- `packages/backend/src/travel/apply.property.test.ts` — 5 further un-awaited async assertions in the same shape.
- `packages/backend/src/user/change-nickname.property.test.ts` (before the reference fix) — reported "34 passed" while 4 tests were throwing on undefined `GetCommand`/`QueryCommand`/`UpdateCommand`.
- `npx vitest --run packages/backend` — aborts with `Allocation failed - JavaScript heap out of memory`.
