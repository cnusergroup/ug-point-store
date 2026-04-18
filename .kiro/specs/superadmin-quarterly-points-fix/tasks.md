# Tasks — SuperAdmin Quarterly Points Fix

## Task 1: Add `skipPointsValidation` to `BatchDistributionInput` interface

- [x] 1.1 Add `skipPointsValidation?: boolean` optional field to `BatchDistributionInput` interface in `packages/backend/src/admin/batch-points.ts`

## Task 2: Conditionally skip POINTS_MISMATCH validation

- [x] 2.1 In `executeBatchDistribution()` in `packages/backend/src/admin/batch-points.ts`, wrap the `POINTS_MISMATCH` check with `if (!input.skipPointsValidation && ...)` so it is skipped when `skipPointsValidation` is `true`

## Task 3: Pass `skipPointsValidation: true` from `handleQuarterlyAward()`

- [x] 3.1 In `handleQuarterlyAward()` in `packages/backend/src/admin/handler.ts`, add `skipPointsValidation: true` to the input object passed to `executeBatchDistribution()`

## Task 4: Unit tests for the fix

- [x] 4.1 Add unit test: `skipPointsValidation=true` with custom points succeeds (no POINTS_MISMATCH error) in `packages/backend/src/admin/batch-points.test.ts`
- [x] 4.2 Add unit test: `skipPointsValidation=undefined` with mismatched points still returns POINTS_MISMATCH in `packages/backend/src/admin/batch-points.test.ts`
- [x] 4.3 Add unit test: `skipPointsValidation=true` still enforces volunteer limit, dedup, and duplicate distribution checks in `packages/backend/src/admin/batch-points.test.ts`

## Task 5: Property-based tests for fix and preservation

- [x] 5.1 (**PBT - Exploration**) Property test: on UNFIXED code, for any input with `skipPointsValidation=true` and `points ≠ expectedPoints`, `executeBatchDistribution()` returns POINTS_MISMATCH (demonstrates the bug) `packages/backend/src/admin/batch-points.property.test.ts`
- [x] 5.2 (**PBT - Fix**) Property test: on FIXED code, for any input with `skipPointsValidation=true` and any positive integer points, `executeBatchDistribution()` succeeds with correct `distributionId`, `successCount`, and `totalPoints` `packages/backend/src/admin/batch-points.property.test.ts`
- [x] 5.3 (**PBT - Preservation**) Property test: on FIXED code, for any input with `skipPointsValidation=undefined` and `points ≠ expectedPoints`, `executeBatchDistribution()` returns POINTS_MISMATCH error `packages/backend/src/admin/batch-points.property.test.ts`

## Task 6: Run all tests and verify

- [x] 6.1 Run existing batch-points tests to confirm no regressions: `npx vitest run packages/backend/src/admin/batch-points.test.ts`
- [x] 6.2 Run property-based tests to confirm fix and preservation: `npx vitest run packages/backend/src/admin/batch-points.property.test.ts`
