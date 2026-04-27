# Implementation Plan: Employee Store Access Control (员工商城访问控制)

## Overview

This plan implements the `employeeStoreEnabled` feature toggle that allows SuperAdmin to control whether employee users can access store functions (browse products, cart, orders, redeem codes). The implementation follows a bottom-up approach: shared error code first, then feature toggles extension, auth middleware extension, pure check function, handler integration, user profile API, frontend settings, frontend blocked UI, and finally i18n keys.

## Tasks

- [x] 1. Add shared error code EMPLOYEE_STORE_DISABLED
  - Add `EMPLOYEE_STORE_DISABLED: 'EMPLOYEE_STORE_DISABLED'` to `ErrorCodes` in `packages/shared/src/errors.ts`
  - Add `[ErrorCodes.EMPLOYEE_STORE_DISABLED]: 403` to `ErrorHttpStatus`
  - Add `[ErrorCodes.EMPLOYEE_STORE_DISABLED]: '员工商城功能暂时关闭'` to `ErrorMessages`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2. Extend Feature Toggles with employeeStoreEnabled
  - [x] 2.1 Update FeatureToggles interface and defaults
    - Add `employeeStoreEnabled: boolean` to `FeatureToggles` interface in `packages/backend/src/settings/feature-toggles.ts`
    - Add `employeeStoreEnabled: true` to `DEFAULT_TOGGLES` (employees can use store by default)
    - In `getFeatureToggles`, add `employeeStoreEnabled: result.Item.employeeStoreEnabled !== false` (safe default: missing → true)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Update UpdateFeatureTogglesInput and updateFeatureToggles
    - Add `employeeStoreEnabled: boolean` to `UpdateFeatureTogglesInput` interface
    - Add `typeof input.employeeStoreEnabled !== 'boolean'` to the validation block
    - Add `employeeStoreEnabled = :ese` to the UpdateExpression
    - Add `':ese': input.employeeStoreEnabled` to ExpressionAttributeValues
    - Include `employeeStoreEnabled` in the returned settings object
    - _Requirements: 7.1, 7.2, 7.3, 8.3_

  - [ ]* 2.3 Write property tests for employeeStoreEnabled in feature toggles
    - **Property 1: Safe default for employeeStoreEnabled**
    - **Property 2: Existing fields unaffected by new toggle**
    - **Property 4: Update validation rejects non-boolean employeeStoreEnabled**
    - **Property 5: Feature toggles round-trip preservation**
    - **Validates: Requirements 1.2, 1.3, 1.4, 7.3, 8.1, 8.2, 8.4**
    - Test file: `packages/backend/src/settings/feature-toggles.property.test.ts`

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend auth middleware to pass isEmployee
  - [x] 4.1 Update AuthenticatedUser interface and withAuth logic
    - Add `isEmployee: boolean` to `AuthenticatedUser` interface in `packages/backend/src/middleware/auth-middleware.ts`
    - In the `needsDbRead === false` branch (new token): add `isEmployee` to `ProjectionExpression` (`'rolesVersion, #r, #s, isEmployee'`), read `isEmployee` from `versionRecord.Item`
    - In the `needsDbRead === true` branch (old token): add `isEmployee` to `ProjectionExpression` (`'#r, #s, isEmployee'`), read `isEmployee` from `userRecord.Item`
    - Set `isEmployee: userRecord?.Item?.isEmployee === true` (missing → false) when building `authenticatedEvent.user`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5. Create isEmployeeStoreBlocked pure function
  - [x] 5.1 Create `packages/backend/src/middleware/employee-store-check.ts`
    - Export `isEmployeeStoreBlocked(isEmployee: boolean, employeeStoreEnabled: boolean): boolean`
    - Return `isEmployee && !employeeStoreEnabled`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.2 Write property test for isEmployeeStoreBlocked
    - **Property 3: Employee store access check correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4**
    - Test file: `packages/backend/src/middleware/employee-store-check.property.test.ts`

- [x] 6. Add employee store checks to product handler
  - [x] 6.1 Update `packages/backend/src/products/handler.ts`
    - Import `getFeatureToggles` from `../settings/feature-toggles` and `isEmployeeStoreBlocked` from `../middleware/employee-store-check`
    - In `GET /api/products` route: read toggles, if `isEmployeeStoreBlocked(event.user.isEmployee, toggles.employeeStoreEnabled)` return `jsonResponse(200, { products: [], employeeStoreBlocked: true })`
    - In `GET /api/products/:id` route: read toggles, if blocked return `errorResponse('EMPLOYEE_STORE_DISABLED', '员工商城功能暂时关闭', 403)`
    - Add `USERS_TABLE` env var reference for `getFeatureToggles`
    - _Requirements: 3.1, 3.2, 3.6, 3.7, 6.1_

- [x] 7. Add employee store checks to cart handler
  - [x] 7.1 Update `packages/backend/src/cart/handler.ts`
    - Import `getFeatureToggles` and `isEmployeeStoreBlocked`
    - In `POST /api/cart/items` route: read toggles, if blocked return 403 `EMPLOYEE_STORE_DISABLED`
    - In `GET /api/cart` route: read toggles, if blocked return 403 `EMPLOYEE_STORE_DISABLED`
    - Add `USERS_TABLE` env var reference for `getFeatureToggles`
    - _Requirements: 3.3, 3.6, 3.7, 6.2_

- [x] 8. Add employee store checks to orders handler
  - [x] 8.1 Update `packages/backend/src/orders/handler.ts`
    - Import `isEmployeeStoreBlocked` from `../middleware/employee-store-check`
    - In `POST /api/orders` route: read toggles (already imported), if blocked return 403 `EMPLOYEE_STORE_DISABLED`
    - In `POST /api/orders/direct` route: read toggles, if blocked return 403 `EMPLOYEE_STORE_DISABLED`
    - Note: `getFeatureToggles` is already imported in this handler; only add the check logic
    - _Requirements: 3.4, 3.6, 3.7, 6.3_

- [x] 9. Add employee store check to redeem-code in points handler
  - [x] 9.1 Update `packages/backend/src/points/handler.ts`
    - Import `isEmployeeStoreBlocked` from `../middleware/employee-store-check`
    - In `POST /api/points/redeem-code` route: after reading toggles (already done for `codeRedemptionEnabled`), add `isEmployeeStoreBlocked` check before the existing `codeRedemptionEnabled` check, return 403 `EMPLOYEE_STORE_DISABLED` if blocked
    - _Requirements: 3.5, 3.6, 3.7, 6.4_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Extend user profile API with isEmployee
  - [x] 11.1 Update `packages/backend/src/user/profile.ts`
    - In `getUserProfile`, add `isEmployee: item.isEmployee === true` to the returned profile object
    - Update `UserProfile` type in `packages/shared/src/types.ts` to include `isEmployee?: boolean`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 12. Update frontend settings page with employee store toggle
  - [x] 12.1 Update `packages/frontend/src/pages/admin/settings.tsx`
    - Add `employeeStoreEnabled: boolean` to the frontend `FeatureToggles` interface
    - Add a new toggle item in the feature-toggles section, visible only when `isSuperAdmin`
    - Use i18n keys `admin.settings.employeeStoreLabel` and `admin.settings.employeeStoreDesc`
    - Wire the toggle to `handleToggleChange('employeeStoreEnabled', e.detail.value)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 13. Create EmployeeStoreBlocked frontend component
  - [x] 13.1 Create `packages/frontend/src/components/EmployeeStoreBlocked.tsx`
    - Create a centered blocked-state component with a lock icon, title, and description
    - Use i18n keys `store.employeeBlocked.title` and `store.employeeBlocked.description`
    - Add corresponding SCSS styles in `packages/frontend/src/components/EmployeeStoreBlocked.scss`
    - _Requirements: 4.1, 4.4, 4.5_

  - [x] 13.2 Integrate EmployeeStoreBlocked into product list page
    - In the product list page, check `isEmployee` from user store and `employeeStoreEnabled` from feature toggles
    - If `isEmployee && !employeeStoreEnabled`, render `<EmployeeStoreBlocked />` instead of the product list
    - Also handle the `employeeStoreBlocked: true` flag from the API response
    - _Requirements: 4.1_

  - [x] 13.3 Integrate EmployeeStoreBlocked into product detail page
    - In the product detail page, check the same condition
    - If blocked, render `<EmployeeStoreBlocked />` instead of product detail content
    - _Requirements: 4.2_

  - [x] 13.4 Integrate EmployeeStoreBlocked into cart page
    - In the cart page, check the same condition
    - If blocked, render `<EmployeeStoreBlocked />` instead of cart content
    - _Requirements: 4.3_

- [x] 14. Add i18n keys for all 5 locales
  - [x] 14.1 Add i18n keys to all locale files
    - Add `admin.settings.employeeStoreLabel` and `admin.settings.employeeStoreDesc` keys
    - Add `store.employeeBlocked.title` and `store.employeeBlocked.description` keys
    - Update all 5 locale files: zh, en, ja, ko, zh-TW
    - _Requirements: 4.4, 2.5_

- [x] 15. Update frontend user store with isEmployee
  - [x] 15.1 Update frontend user state and fetchProfile
    - Add `isEmployee?: boolean` to the frontend `UserState` interface
    - In `fetchProfile` action, save `isEmployee` from the profile API response to the store
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The `employeeStoreEnabled` field defaults to `true` when missing from DynamoDB (backward compatible, safe degradation)
- Non-employee users and non-store functions are completely unaffected by this feature
- The `isEmployeeStoreBlocked` pure function is shared across all handlers for consistency and testability
