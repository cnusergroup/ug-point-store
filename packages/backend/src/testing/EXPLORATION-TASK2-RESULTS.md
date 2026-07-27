# Task 2: Bug Condition A — Hidden-Verdict and Orphan-Mock Exploration Results

**Run date**: Recorded on unfixed code (Vitest 3.2.4, fast-check 4.1.1)

---

## 1. Hidden-Verdict Demonstration (Hypothesis A.3: advisory unhandled-rejection handling)

**Test file**: `packages/backend/src/testing/property-await-hidden-verdict.test.ts`
**Fixtures used**: `hidden-verdict-awaited.fixture.ts`, `hidden-verdict-unawaited.fixture.ts`, `hidden-verdict-late-unawaited.fixture.ts`

### Results

| Fixture                         | Tests Passed | Tests Failed | Errors | Exit Code | Violation Visible As         |
|---------------------------------|-------------|-------------|--------|-----------|-------------------------------|
| hidden-verdict-awaited (control)| 0           | 1           | 0      | non-zero  | A failed test with counterexample |
| hidden-verdict-unawaited        | 1           | 0           | ≥1     | non-zero* | Unhandled-rejection noise only |
| hidden-verdict-late             | 1           | 0           | 0      | 0         | Nothing at all (fully green)   |

*The unawaited variant exits non-zero because Vitest catches the rejection before the reporter
finalizes. But the TEST itself is reported as PASSED — the failure count stays at 0, and the
property's verdict is never tied to the owning test.

### Hypothesis A.3 Confirmation

**CONFIRMED** — Vitest's unhandled-rejection handling is advisory and timing-dependent:
- When the orphaned property rejects BEFORE Vitest finalizes, the rejection is attributed to no
  test, the failure count stays at 0, and Vitest exits non-zero (but the test is still reported
  green).
- When the rejection lands AFTER the run is reported (the "late" variant with a 1.5s delay), it
  disappears completely: exit code 0, no trace in output, fully green.

In BOTH cases the verdict of the property itself is never tied to the test that owns it, which is
what requirements 1.1, 1.2, and 2.2 are about.

**All 4 sub-tests passed**, confirming the bug exists on unfixed code.

---

## 2. Orphan-Mock / Mock-Lifecycle Collision (Hypothesis A.4)

**Test file**: `packages/backend/src/testing/property-await-orphan-mock.test.ts`
**Fixture used**: `orphan-mock.fixture.ts` + `orphan-mock-service.ts`

### Results

The child Vitest run of the orphan-mock fixture produced:
- **Tests**: 3 passed (3), 0 failed
- **Errors**: ≥1 unhandled errors
- **Exit code**: non-zero (but all tests reported green)
- **Observed symptoms**:
  - `TypeError: Cannot read properties of undefined (reading 'Items')` from inside `orphan-mock-service.ts:listItemsForUser` (production-shaped call path)
  - `Error: sharedClient.send must be mocked` (vi.spyOn variant restored to original)
  - Both attributed to the LAST test Vitest saw running, never to the test that started the property

### Hypothesis A.4 Confirmation

**CONFIRMED** — Mock-lifecycle collision reproduced for both mock styles:
1. A bare `vi.fn()` with `mockResolvedValueOnce(...)` is wiped by `vi.restoreAllMocks()` and then
   resolves to `undefined`, so the next `.Items` read throws inside the production-shaped call
   path — the exact misdirection described in requirement 1.3.
2. A `vi.spyOn(...)` is restored to the original implementation, so the in-flight property calls
   real code instead of the mock.

**The test passed**, confirming the bug exists on unfixed code.

---

## 3. Awaited-Conversion Probe: `review.property.test.ts`

**Procedure**: Temporarily converted all 5 `fc.assert(fc.asyncProperty(...))` calls in
`packages/backend/src/travel/review.property.test.ts` from non-async callbacks to
`async () => { await fc.assert(...) }` form. Ran the file. Then reverted to original.

### Properties Probed

| # | Property Name | Status After Awaiting |
|---|--------------|----------------------|
| 1 | Property 6: Approval preserves quota | ✅ PASSED |
| 2 | Property 6: Reject preserves required output fields | ✅ PASSED |
| 3 | Property 7: Rejection uses simple UpdateCommand | ✅ PASSED |
| 4 | Property 8: User isolation in list queries | ✅ PASSED |
| 5 | Property 9: Status filter returns only matching records in descending time order | ✅ PASSED |
| 6 | Property 12: travelEarnUsed non-negative invariant (synchronous, untouched) | ✅ PASSED |

### Conclusion

**All 5 async properties PASS when properly awaited.** No counterexamples were produced.

This means:
- The production code (`reviewTravelApplication`, `listMyTravelApplications`, `listAllTravelApplications`) is correct.
- The test generators and assertions are valid.
- The ONLY issue was that the properties were never actually being executed to completion before
  the tests were reported as passed — confirming that Defect A is purely a test-infrastructure
  defect, not a production logic defect in these particular properties.

**Triage input for task 6.2**: No failures to triage for `review.property.test.ts`. The
conversion is purely mechanical — `async` callback + `await fc.assert(...)` — with no production
fix or test/generator fix needed.

---

## Summary

| Hypothesis | Status | Evidence |
|-----------|--------|----------|
| A.3: Advisory unhandled-rejection handling | **CONFIRMED** | Timing-dependent: early rejection = exit non-zero but test green; late rejection = fully invisible |
| A.4: Mock-lifecycle collision | **CONFIRMED** | `vi.restoreAllMocks()` wipes in-flight property's mocks → `Cannot read properties of undefined (reading 'Items')` from production call path |

**Counterexamples from the fixtures**:
- The hidden-verdict fixtures demonstrate that a violated property is reported as PASSED
- The orphan-mock fixture reproduces the exact `TypeError` attributed to production code
- The review.property.test.ts probe shows no production bugs — all properties are valid

**File reverted**: `review.property.test.ts` has been restored to its original un-awaited form.
