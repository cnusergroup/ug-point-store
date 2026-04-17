# Implementation Plan: Travel Independent Quota

## Overview

Decouple domestic and international travel sponsorship quotas by replacing the shared `travelEarnUsed` counter with independent per-category quota calculation. The new formula derives available counts from `floor(earnTotal / categoryThreshold) - categoryUsedCount`, where `categoryUsedCount` comes from counting pending+approved applications per category. This eliminates all reads/writes to `travelEarnUsed` on the Users table and simplifies submit, resubmit, and reject flows by removing cross-table transactions.

## Tasks

- [x] 1. Update `calculateAvailableCount` signature and logic
  - [x] 1.1 Change `calculateAvailableCount` in `packages/backend/src/travel/apply.ts`
    - Change signature from `(earnTotal, travelEarnUsed, threshold)` to `(earnTotal, threshold, categoryUsedCount)`
    - Replace logic with: `if (threshold === 0) return 0; return Math.max(0, Math.floor(earnTotal / threshold) - categoryUsedCount);`
    - Remove the old `travelEarnUsed > earnTotal` branch — no longer needed
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [x] 1.2 Write property test: Quota calculation correctness (Property 1)
    - **Property 1: Quota calculation correctness**
    - Test that for any non-negative `earnTotal`, `threshold`, and `categoryUsedCount`: if `threshold === 0` result is `0`; if `threshold > 0` result is `max(0, floor(earnTotal / threshold) - categoryUsedCount)`
    - Update existing "Property 3: Quota calculation correctness" in `packages/backend/src/travel/apply.property.test.ts` to use the new signature `(earnTotal, threshold, categoryUsedCount)`
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**

  - [x] 1.3 Write property test: Category independence (Property 3)
    - **Property 3: Category independence**
    - Test that for any valid `earnTotal`, `domesticThreshold`, `internationalThreshold`, `domesticUsedCount`, and two different `internationalUsedCount` values, `domesticAvailable` is identical regardless of `internationalUsedCount` (and symmetrically for international)
    - Add new test in `packages/backend/src/travel/apply.property.test.ts`
    - **Validates: Requirements 8.1, 8.2, 8.5**

  - [x] 1.4 Write property test: Available plus used invariant (Property 4)
    - **Property 4: Available plus used does not exceed total quota**
    - Test that for any valid `earnTotal`, positive `threshold`, and non-negative `categoryUsedCount`, `calculateAvailableCount(earnTotal, threshold, categoryUsedCount) + categoryUsedCount <= floor(earnTotal / threshold)`
    - Add new test in `packages/backend/src/travel/apply.property.test.ts`
    - **Validates: Requirements 8.3, 8.4**

  - [x] 1.5 Update existing unit tests for `calculateAvailableCount` in `packages/backend/src/travel/apply.test.ts`
    - Update all test cases to use the new 3-parameter signature `(earnTotal, threshold, categoryUsedCount)`
    - Replace `travelEarnUsed`-based test descriptions and assertions with `categoryUsedCount`-based ones
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Update `TravelQuota` interface and remove `travelEarnUsed`
  - [x] 2.1 Remove `travelEarnUsed` from `TravelQuota` interface in `packages/shared/src/types.ts`
    - Delete the `travelEarnUsed: number;` line from the `TravelQuota` interface
    - _Requirements: 3.2_

  - [x] 2.2 Remove `travelEarnUsed` i18n keys from all language files
    - Remove `travelEarnUsed` key from `packages/frontend/src/i18n/zh.ts`, `en.ts`, `ja.ts`, `ko.ts`, `zh-TW.ts`
    - Remove `travelEarnUsed` key from `packages/frontend/src/i18n/types.ts`
    - _Requirements: 3.3_

  - [x] 2.3 Make `earnDeducted` optional on `TravelApplication` interface in `packages/shared/src/types.ts`
    - Change `earnDeducted: number` to `earnDeducted?: number` to mark it as deprecated
    - _Requirements: 4.4, 5.3_

- [x] 3. Update `getTravelQuota` to use independent calculation
  - [x] 3.1 Modify `getTravelQuota` in `packages/backend/src/travel/apply.ts`
    - Remove the `GetCommand` that reads `travelEarnUsed` from the Users table
    - Make `travelApplicationsTable` parameter required (change from `travelApplicationsTable?: string` to `travelApplicationsTable: string`)
    - Call `calculateAvailableCount(earnTotal, settings.domesticThreshold, domesticUsedCount)` and `calculateAvailableCount(earnTotal, settings.internationalThreshold, internationalUsedCount)` with the new signature
    - Remove `travelEarnUsed` from the returned `TravelQuota` object
    - _Requirements: 1.1, 1.4, 2.1, 2.4, 3.1, 3.2_

  - [x] 3.2 Write property test: Used count derivation from applications (Property 2)
    - **Property 2: Used count derivation from applications**
    - Test that for any set of travel application records with mixed statuses and categories, `domesticUsedCount` equals the count of records where `status ∈ {pending, approved}` AND `category = domestic`, and `internationalUsedCount` equals the count where `status ∈ {pending, approved}` AND `category = international`
    - Add new test in `packages/backend/src/travel/apply.property.test.ts`
    - **Validates: Requirements 1.4, 2.4**

  - [x] 3.3 Update existing unit tests for `getTravelQuota` in `packages/backend/src/travel/apply.test.ts`
    - Remove mock for `GetCommand` that reads `travelEarnUsed` from Users table
    - Add mock for `QueryCommand` that counts pending+approved applications per category
    - Remove assertions on `quota.travelEarnUsed`
    - Update expected `domesticAvailable` and `internationalAvailable` values to match new formula
    - _Requirements: 3.1, 3.2_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Simplify `submitTravelApplication` — remove `travelEarnUsed` write
  - [x] 5.1 Modify `submitTravelApplication` in `packages/backend/src/travel/apply.ts`
    - Remove the `GetCommand` that reads `travelEarnUsed` from the Users table
    - Add a query to count pending+approved applications for the target category to get `categoryUsedCount`
    - Use `calculateAvailableCount(earnTotal, threshold, categoryUsedCount)` for availability check
    - Replace `TransactWriteCommand` (Put + Update) with a single `PutCommand` for the application record
    - Remove `earnDeducted` field from the new application record
    - Remove `TransactWriteCommand` import if no longer used in this file
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.2 Write property test: Submit availability gate (Property 5)
    - **Property 5: Submit and resubmit availability gate**
    - Test that for any category, `earnTotal`, `categoryThreshold > 0`, and `categoryUsedCount`, submission succeeds if and only if `categoryUsedCount < floor(earnTotal / categoryThreshold)`; otherwise returns `INSUFFICIENT_EARN_QUOTA`
    - Update existing "Property 5" in `packages/backend/src/travel/apply.property.test.ts` to use the new flow (PutCommand instead of TransactWriteCommand, no travelEarnUsed)
    - **Validates: Requirements 4.1, 4.2, 4.3, 5.1, 5.2**

  - [x] 5.3 Update existing unit tests for `submitTravelApplication` in `packages/backend/src/travel/apply.test.ts`
    - Remove mock for `GetCommand` that reads `travelEarnUsed`
    - Add mock for `QueryCommand` that counts category-specific pending+approved applications
    - Change assertion from `TransactWriteCommand` to `PutCommand`
    - Remove assertions on `earnDeducted` field
    - Remove assertions on Users table update
    - _Requirements: 4.4, 4.5_

- [x] 6. Simplify `resubmitTravelApplication` — remove `travelEarnUsed` write
  - [x] 6.1 Modify `resubmitTravelApplication` in `packages/backend/src/travel/apply.ts`
    - Remove the `GetCommand` that reads `travelEarnUsed` from the Users table
    - Add a query to count pending+approved applications for the new category (excluding the current rejected application) to get `categoryUsedCount`
    - Use `calculateAvailableCount(earnTotal, newThreshold, categoryUsedCount)` for availability check
    - Replace `TransactWriteCommand` (Put + Update) with a single `PutCommand` for the application record
    - Remove `earnDeducted` field from the updated application record
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.2 Update existing unit tests for `resubmitTravelApplication` in `packages/backend/src/travel/apply.test.ts`
    - Remove mock for `GetCommand` that reads `travelEarnUsed`
    - Add mock for `QueryCommand` that counts category-specific pending+approved applications
    - Change assertion from `TransactWriteCommand` to `PutCommand`
    - Remove assertions on `earnDeducted` field
    - Remove assertions on Users table update
    - Update existing "Property 11" in `packages/backend/src/travel/apply.property.test.ts` to use the new flow
    - _Requirements: 5.3, 5.4_

- [x] 7. Simplify `reviewTravelApplication` reject — remove `travelEarnUsed` refund
  - [x] 7.1 Modify reject path in `reviewTravelApplication` in `packages/backend/src/travel/review.ts`
    - Replace `TransactWriteCommand` (Update application + Update user travelEarnUsed) with a single `UpdateCommand` on the application record
    - Remove the user record update that decrements `travelEarnUsed`
    - Remove `TransactWriteCommand` import if no longer used in this file
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Write property test: Reject preserves required output fields (Property 6)
    - **Property 6: Reject preserves required output fields**
    - Test that for any pending travel application and any non-empty reject reason string, after rejection the returned application has `status = 'rejected'`, a non-empty `rejectReason`, a valid `reviewerId`, a valid `reviewerNickname`, and a valid ISO timestamp `reviewedAt`
    - Add new test in `packages/backend/src/travel/review.property.test.ts`
    - **Validates: Requirements 6.1**

  - [x] 7.3 Update existing unit tests for `reviewTravelApplication` in `packages/backend/src/travel/review.test.ts`
    - Change reject test assertion from `TransactWriteCommand` to `UpdateCommand`
    - Remove assertion that verifies 2 TransactItems (application update + user update)
    - Remove assertion on Users table `travelEarnUsed` decrement
    - Verify reject uses single `UpdateCommand` on TravelApplications table only
    - Verify approve path remains unchanged (still uses `UpdateCommand`, no `travelEarnUsed` write)
    - _Requirements: 6.2, 6.3, 7.1, 7.2_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Clean up unused imports and verify frontend compilation
  - [x] 9.1 Remove unused imports in `packages/backend/src/travel/apply.ts`
    - Remove `TransactWriteCommand` import if no longer used
    - Remove `GetCommand` import if no longer used (check if still needed for other functions)
    - Add `PutCommand` import if not already present
    - _Requirements: 4.4, 4.5, 5.3, 5.4_

  - [x] 9.2 Remove unused imports in `packages/backend/src/travel/review.ts`
    - Remove `TransactWriteCommand` import if no longer used
    - _Requirements: 6.2, 6.3_

  - [x] 9.3 Verify frontend compiles without `travelEarnUsed` references
    - Run TypeScript compilation for the frontend package to ensure no references to the removed `travelEarnUsed` property
    - The i18n keys were already removed in task 2.2; verify no TSX files reference `quota.travelEarnUsed`
    - _Requirements: 3.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `travelEarnUsed` field is deprecated (stop reading/writing) but not physically removed from existing DynamoDB records
- The `earnDeducted` field on `TravelApplication` is deprecated — new records omit it, existing records retain it
