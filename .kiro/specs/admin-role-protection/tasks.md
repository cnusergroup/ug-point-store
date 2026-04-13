# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Admin/SuperAdmin Role Stripping via assignRoles
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: non-SuperAdmin caller invokes `assignRoles` with a roles list that omits the target's existing Admin or SuperAdmin role
  - Create test file `packages/backend/src/admin/roles-protection.property.test.ts`
  - Use fast-check to generate: non-SuperAdmin caller roles (subsets of `['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin']` that do NOT contain `'SuperAdmin'`), target current roles containing at least one of `['Admin', 'SuperAdmin']`, and new roles that omit at least one existing admin-level role
  - Mock DynamoDB: `GetCommand` returns target user with `targetCurrentRoles`; capture `UpdateCommand` input to inspect final written roles
  - Assert: after `assignRoles` completes, the roles written to DynamoDB still contain all original Admin/SuperAdmin roles from `targetCurrentRoles`
  - Bug Condition from design: `isBugCondition(input) = (NOT callerIsSuperAdmin) AND (targetHasAdmin OR targetHasSuperAdmin) AND (newRolesOmitAdmin OR newRolesOmitSuperAdmin)`
  - Expected Behavior from design: Admin/SuperAdmin roles are preserved in final roles list regardless of caller submission
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists because `assignRoles` blindly overwrites roles without read-before-write)
  - Document counterexamples found (e.g., "Admin caller assigns `['Speaker']` to target with `['Admin', 'Speaker']` → Admin role is stripped")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy assignRoles Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (cases where `isBugCondition` returns false):
    - SuperAdmin caller assigning any roles to any target → observe roles are written as-is
    - Any caller assigning roles to a target WITHOUT Admin/SuperAdmin roles → observe roles are written as-is
    - Any caller assigning roles that include all existing admin roles (no omission) → observe roles are written as-is
  - Write property-based tests in `packages/backend/src/admin/roles-protection.property.test.ts`:
    - Generate SuperAdmin caller roles and arbitrary target roles → verify `assignRoles` writes the exact caller-provided roles list (behavior unchanged)
    - Generate any caller roles and target roles with NO Admin/SuperAdmin → verify `assignRoles` writes the exact caller-provided roles list (behavior unchanged)
    - Generate non-SuperAdmin caller and target with admin roles, but new roles that INCLUDE all existing admin roles → verify `assignRoles` writes the exact caller-provided roles list (no unnecessary merging)
  - Also verify preservation of `setUserStatus` and `deleteUser` permission checks:
    - SuperAdmin caller can disable/delete Admin targets (unchanged)
    - Non-SuperAdmin caller is blocked from disabling/deleting Admin targets (unchanged)
    - SuperAdmin targets cannot be disabled/deleted by anyone (unchanged)
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Backend fix — `assignRoles` in roles.ts (read-before-write + admin role preservation)

  - [x] 3.1 Implement read-before-write and admin role merging in `assignRoles`
    - In `packages/backend/src/admin/roles.ts`, modify `assignRoles` function:
    - Import `GetCommand` from `@aws-sdk/lib-dynamodb`
    - Before writing roles, fetch the target user's current roles from DynamoDB using `GetCommand` with projection on `roles` field
    - If the caller does NOT have `'SuperAdmin'` in `callerRoles`:
      - Extract existing admin-level roles (`'Admin'`, `'SuperAdmin'`) from the target's current roles
      - Filter out any admin-level roles from the caller-submitted `roles` list (defense-in-depth, since `validateRoleAssignment` already blocks adding Admin for non-SuperAdmin)
      - Merge the preserved admin roles back into the new roles list
      - Deduplicate the merged roles array using `[...new Set(mergedRoles)]`
    - If the caller IS SuperAdmin, proceed with existing behavior (write caller-provided roles as-is)
    - _Bug_Condition: isBugCondition(input) where NOT callerIsSuperAdmin AND targetHasAdminRole AND newRolesOmitAdminRole_
    - _Expected_Behavior: Admin/SuperAdmin roles preserved in final roles list for non-SuperAdmin callers_
    - _Preservation: SuperAdmin callers write roles as-is; non-admin targets write roles as-is_
    - _Requirements: 2.1, 2.2, 3.1, 3.3_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Admin/SuperAdmin Role Preservation
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy assignRoles Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Backend fix — permission checks in users.ts (if needed)

  - [x] 4.1 Review and confirm existing permission checks in `setUserStatus` and `deleteUser`
    - In `packages/backend/src/admin/users.ts`, verify that:
      - `setUserStatus` already rejects disabling SuperAdmin users (`CANNOT_DISABLE_SUPERADMIN`)
      - `setUserStatus` already requires SuperAdmin caller to manage Admin targets (`ONLY_SUPERADMIN_CAN_MANAGE_ADMIN`)
      - `deleteUser` already rejects deleting SuperAdmin users (`CANNOT_DELETE_SUPERADMIN`)
      - `deleteUser` already requires SuperAdmin caller to delete Admin targets
    - These checks are already implemented — confirm no changes needed
    - If any gaps are found, add the missing checks
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

- [x] 5. Frontend fix — users.tsx (hide buttons, lock role toggles)

  - [x] 5.1 Add `canManageUser` helper and conditionally hide disable/delete buttons
    - In `packages/frontend/src/pages/admin/users.tsx`:
    - Add helper function: `canManageUser(targetRoles: string[]): boolean` that returns `false` when the current user is NOT SuperAdmin and the target has Admin or SuperAdmin roles
    - Wrap the disable/enable and delete action buttons with a conditional check using `canManageUser(user.roles)`
    - When `canManageUser` returns `false`, do not render the disable/enable and delete buttons for that user row
    - SuperAdmin users continue to see all action buttons for Admin targets
    - _Requirements: 2.3, 3.2_

  - [x] 5.2 Lock admin role toggles in role edit modal
    - In `packages/frontend/src/pages/admin/users.tsx`:
    - When rendering the role edit list, for each role check if it is an admin-level role (`'Admin'` or `'SuperAdmin'`) that the target currently holds AND the current user is NOT SuperAdmin
    - If so, render the toggle as disabled with a lock icon (🔒), preventing deselection
    - In the `toggleRole` function, add a guard that prevents toggling roles that are locked
    - Ensure `selectedRoles` always includes locked admin roles when submitting
    - _Requirements: 2.4, 3.1_

- [x] 6. Write unit tests

  - [x] 6.1 Backend unit tests for `assignRoles` fix
    - In `packages/backend/src/admin/roles.test.ts`, add test cases:
    - Non-SuperAdmin caller assigns `['Speaker']` to target with `['Admin', 'Speaker']` → verify Admin is preserved in final roles
    - Non-SuperAdmin caller assigns `['Volunteer']` to target with `['SuperAdmin', 'Volunteer']` → verify SuperAdmin is preserved
    - Non-SuperAdmin caller assigns `['UserGroupLeader']` to target with `['Admin', 'SuperAdmin', 'UserGroupLeader']` → verify both Admin and SuperAdmin preserved
    - SuperAdmin caller assigns `['Speaker']` to target with `['Admin', 'Speaker']` → verify Admin CAN be removed (behavior unchanged)
    - Any caller assigns `['Speaker', 'Volunteer']` to target with `['Speaker']` (no admin roles) → verify normal behavior unchanged
    - _Requirements: 2.1, 2.2, 3.1, 3.3_

  - [x] 6.2 Frontend unit tests for `canManageUser` logic
    - Verify `canManageUser` returns `false` for Admin viewer + Admin target
    - Verify `canManageUser` returns `false` for Admin viewer + SuperAdmin target
    - Verify `canManageUser` returns `true` for SuperAdmin viewer + Admin target
    - Verify `canManageUser` returns `true` for any viewer + regular user target
    - _Requirements: 2.3, 3.2_

- [x] 7. Checkpoint — Ensure all tests pass
  - Run all tests: `npx vitest run packages/backend/src/admin/roles` to verify backend fixes
  - Run all tests: `npx vitest run packages/backend/src/admin/users` to verify users.ts preservation
  - Run the full property test suite for roles-protection: `npx vitest run packages/backend/src/admin/roles-protection.property.test.ts`
  - Confirm no regressions in existing role and user management tests
  - Ensure all tests pass, ask the user if questions arise
