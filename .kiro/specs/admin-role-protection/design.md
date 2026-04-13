# Admin Role Protection Bugfix Design

## Overview

The `assignRoles` function in `packages/backend/src/admin/roles.ts` replaces the target user's entire roles list with the caller-provided list. When a non-SuperAdmin Admin caller submits a roles list that omits the target's existing Admin or SuperAdmin role, those privileged roles are silently stripped. Additionally, the frontend user management page (`packages/frontend/src/pages/admin/users.tsx`) does not hide disable/delete buttons or lock Admin/SuperAdmin role toggles when the current user lacks SuperAdmin privileges, allowing the UI to facilitate these unauthorized operations.

The fix adds server-side role preservation logic in `assignRoles` to merge back any existing admin-level roles that a non-SuperAdmin caller cannot modify, and updates the frontend to conditionally hide dangerous actions and lock privileged role toggles.

## Glossary

- **Bug_Condition (C)**: A non-SuperAdmin caller invokes `assignRoles` with a roles list that omits the target user's existing Admin or SuperAdmin role, causing those roles to be stripped
- **Property (P)**: After `assignRoles` completes, the target user's Admin/SuperAdmin roles are preserved regardless of what the non-SuperAdmin caller submitted
- **Preservation**: SuperAdmin callers can still freely add/remove Admin roles; all callers can still modify regular roles (Speaker, Volunteer, UserGroupLeader); existing `setUserStatus`/`deleteUser` permission checks remain unchanged
- **assignRoles**: The function in `packages/backend/src/admin/roles.ts` that replaces a user's entire roles list via DynamoDB UpdateCommand
- **ADMIN_ROLES**: The set `['Admin', 'SuperAdmin']` defined in `packages/shared/src/types.ts`
- **REGULAR_ROLES**: The set `['UserGroupLeader', 'Speaker', 'Volunteer']` defined in `packages/shared/src/types.ts`

## Bug Details

### Bug Condition

The bug manifests when a non-SuperAdmin caller invokes `assignRoles` for a target user who currently holds Admin or SuperAdmin roles. The function blindly overwrites the target's roles with the caller-provided list, without checking whether the caller has permission to remove admin-level roles. Since `validateRoleAssignment` only checks whether the *new* roles list contains Admin/SuperAdmin (to prevent *adding* them), it does not detect the case where admin roles are being *removed by omission*.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { callerRoles: string[], targetCurrentRoles: string[], newRoles: string[] }
  OUTPUT: boolean

  callerIsSuperAdmin ← 'SuperAdmin' IN input.callerRoles
  targetHasAdmin ← 'Admin' IN input.targetCurrentRoles
  targetHasSuperAdmin ← 'SuperAdmin' IN input.targetCurrentRoles
  newRolesOmitAdmin ← targetHasAdmin AND 'Admin' NOT IN input.newRoles
  newRolesOmitSuperAdmin ← targetHasSuperAdmin AND 'SuperAdmin' NOT IN input.newRoles

  RETURN (NOT callerIsSuperAdmin)
         AND (targetHasAdmin OR targetHasSuperAdmin)
         AND (newRolesOmitAdmin OR newRolesOmitSuperAdmin)
END FUNCTION
```

### Examples

- **Admin role stripped**: Admin caller assigns `['Speaker']` to a target who currently has `['Admin', 'Speaker']` → target loses Admin role (should keep it)
- **SuperAdmin role stripped**: Admin caller assigns `['Volunteer']` to a target who currently has `['SuperAdmin', 'Volunteer']` → target loses SuperAdmin role (should keep it)
- **Both roles stripped**: Admin caller assigns `['UserGroupLeader']` to a target who currently has `['Admin', 'SuperAdmin', 'UserGroupLeader']` → target loses both Admin and SuperAdmin (should keep both)
- **UI: buttons visible**: Admin user sees disable/delete buttons next to another Admin user in the user list (should be hidden)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- SuperAdmin callers can freely add or remove the Admin role from any target user via `assignRoles`
- Any Admin or SuperAdmin caller can add or remove regular roles (Speaker, Volunteer, UserGroupLeader) for any target user
- `setUserStatus` continues to reject disabling SuperAdmin users with `CANNOT_DISABLE_SUPERADMIN`
- `setUserStatus` continues to require SuperAdmin caller to manage Admin targets with `ONLY_SUPERADMIN_CAN_MANAGE_ADMIN`
- `deleteUser` continues to reject deleting SuperAdmin users with `CANNOT_DELETE_SUPERADMIN`
- `deleteUser` continues to require SuperAdmin caller to delete Admin targets
- Mouse/touch interactions on the frontend user management page remain unchanged
- SuperAdmin users continue to see all action buttons for Admin targets

**Scope:**
All inputs where the caller IS a SuperAdmin, or where the target does NOT have Admin/SuperAdmin roles, should be completely unaffected by this fix. This includes:
- SuperAdmin callers performing any role assignment
- Any caller modifying roles for regular (non-admin) users
- All existing `setUserStatus` and `deleteUser` permission checks
- Frontend rendering for SuperAdmin viewers

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Missing read-before-write in `assignRoles`**: The function (`roles.ts:55-82`) directly writes the caller-provided roles list to DynamoDB without first reading the target user's current roles. It has no mechanism to detect that admin-level roles are being removed by omission.

2. **`validateRoleAssignment` only checks additions**: The validation function (`roles.ts:30-39`) checks whether the *new* roles list contains Admin or SuperAdmin, preventing unauthorized *addition*. But it does not compare against the target's *current* roles to detect unauthorized *removal*.

3. **Frontend missing conditional rendering**: The user list component (`users.tsx:170-190`) renders disable/delete action buttons unconditionally for all users. There is no check comparing the current user's roles against the target user's roles to hide these buttons when the current user lacks SuperAdmin privileges and the target has admin roles.

4. **Frontend role editor missing disabled state**: The role edit modal (`users.tsx:220-240`) renders all `assignableRoles` as toggleable. When a non-SuperAdmin opens the editor for a user with Admin/SuperAdmin roles, those roles appear in `selectedRoles` but are not rendered as disabled/locked toggles, allowing the caller to deselect them.

## Correctness Properties

Property 1: Bug Condition - Admin/SuperAdmin Role Preservation

_For any_ input where a non-SuperAdmin caller invokes `assignRoles` for a target user who currently holds Admin or SuperAdmin roles, the fixed `assignRoles` function SHALL preserve those admin-level roles in the final roles list, regardless of whether the caller included them in the submitted roles array. The function SHALL return `success: true` and the resulting roles in DynamoDB SHALL contain all original admin-level roles plus any valid regular role changes.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Non-Buggy Input Behavior Unchanged

_For any_ input where the caller IS a SuperAdmin, OR the target does NOT have Admin/SuperAdmin roles, the fixed `assignRoles` function SHALL produce exactly the same result as the original function, preserving all existing role assignment behavior including permission checks, validation, and DynamoDB writes.

**Validates: Requirements 3.1, 3.3**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `packages/backend/src/admin/roles.ts`

**Function**: `assignRoles`

**Specific Changes**:
1. **Add read-before-write**: Before writing roles, fetch the target user's current roles from DynamoDB using a `GetCommand` with a projection on the `roles` field.

2. **Merge admin roles for non-SuperAdmin callers**: If the caller does NOT have SuperAdmin in their roles, extract any existing Admin/SuperAdmin roles from the target's current roles and merge them into the new roles list. This ensures admin-level roles cannot be removed by omission.

3. **Filter caller-submitted admin roles for non-SuperAdmin**: Strip any Admin/SuperAdmin roles from the caller-submitted list if the caller is not SuperAdmin (the existing `validateRoleAssignment` already blocks adding Admin, but this adds defense-in-depth).

4. **Deduplicate merged roles**: After merging, deduplicate the roles array to avoid storing duplicates.

**File**: `packages/frontend/src/pages/admin/users.tsx`

**Function**: `AdminUsersPage` (component)

**Specific Changes**:
5. **Conditionally hide disable/delete buttons**: Add a helper function `canManageUser(targetRoles)` that returns `false` when the current user is not SuperAdmin and the target has Admin or SuperAdmin roles. Use this to conditionally render the disable/delete action buttons.

6. **Lock admin role toggles in edit modal**: When rendering the role edit list, check if each role is an admin-level role that the target currently holds and the current user is not SuperAdmin. If so, render the toggle as disabled with a lock icon, preventing deselection.

7. **Prevent toggling locked roles**: In the `toggleRole` function, add a guard that prevents toggling roles that are locked (admin-level roles on the target when the caller is not SuperAdmin).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `assignRoles` with a non-SuperAdmin caller and a roles list that omits the target's existing Admin/SuperAdmin role. Run these tests on the UNFIXED code to observe that admin roles are stripped.

**Test Cases**:
1. **Admin Role Stripped Test**: Non-SuperAdmin caller assigns `['Speaker']` to target with current roles `['Admin', 'Speaker']` — assert Admin is NOT in final roles (will fail on unfixed code, confirming the bug)
2. **SuperAdmin Role Stripped Test**: Non-SuperAdmin caller assigns `['Volunteer']` to target with current roles `['SuperAdmin', 'Volunteer']` — assert SuperAdmin is NOT in final roles (will fail on unfixed code)
3. **Both Roles Stripped Test**: Non-SuperAdmin caller assigns `['UserGroupLeader']` to target with `['Admin', 'SuperAdmin', 'UserGroupLeader']` — assert both admin roles are stripped (will fail on unfixed code)
4. **Empty Regular Roles Test**: Non-SuperAdmin caller assigns `['Speaker']` to target with only `['Admin']` — assert Admin is stripped and only Speaker remains (will fail on unfixed code)

**Expected Counterexamples**:
- The `assignRoles` function writes the caller-provided roles directly to DynamoDB without reading or preserving existing admin roles
- Root cause confirmed: no read-before-write, no role merging logic

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  // Setup: target user exists in DB with targetCurrentRoles
  result := assignRoles_fixed(input.targetUserId, input.newRoles, client, table, input.callerRoles)
  finalRoles := readUserRoles(input.targetUserId)

  IF 'Admin' IN input.targetCurrentRoles THEN
    ASSERT 'Admin' IN finalRoles
  END IF
  IF 'SuperAdmin' IN input.targetCurrentRoles THEN
    ASSERT 'SuperAdmin' IN finalRoles
  END IF
  ASSERT result.success = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT assignRoles_original(input) = assignRoles_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of caller roles, target roles, and new roles automatically
- It catches edge cases like empty roles, single roles, all regular roles, mixed roles
- It provides strong guarantees that behavior is unchanged for SuperAdmin callers and non-admin targets

**Test Plan**: Observe behavior on UNFIXED code first for SuperAdmin callers and non-admin targets, then write property-based tests capturing that behavior.

**Test Cases**:
1. **SuperAdmin Caller Preservation**: Verify SuperAdmin callers can still add/remove Admin role freely — behavior unchanged after fix
2. **Regular User Target Preservation**: Verify any admin caller can modify roles for users without Admin/SuperAdmin — behavior unchanged after fix
3. **Regular Role Changes Preservation**: Verify adding/removing Speaker, Volunteer, UserGroupLeader works identically before and after fix
4. **Existing Permission Checks Preservation**: Verify `setUserStatus` and `deleteUser` permission checks remain unchanged

### Unit Tests

- Test `assignRoles` with non-SuperAdmin caller and target with Admin role — verify Admin preserved
- Test `assignRoles` with non-SuperAdmin caller and target with SuperAdmin role — verify SuperAdmin preserved
- Test `assignRoles` with SuperAdmin caller and target with Admin role — verify Admin can be removed
- Test `assignRoles` with any caller and target without admin roles — verify normal behavior
- Test frontend `canManageUser` helper with various role combinations
- Test frontend role toggle disabled state for admin roles

### Property-Based Tests

- Generate random non-SuperAdmin caller roles and random target roles containing Admin/SuperAdmin, with random new roles omitting admin roles — verify admin roles are always preserved in the result
- Generate random SuperAdmin caller inputs — verify behavior matches original function exactly
- Generate random inputs where target has no admin roles — verify behavior matches original function exactly
- Generate random regular role combinations for any caller — verify regular role changes work identically

### Integration Tests

- Test full API flow: Admin caller PUTs roles for an Admin target — verify 200 response and Admin role preserved in DB
- Test full API flow: SuperAdmin caller PUTs roles for an Admin target — verify Admin role can be removed
- Test frontend rendering: Admin viewer sees no disable/delete buttons for Admin targets
- Test frontend rendering: SuperAdmin viewer sees disable/delete buttons for Admin targets
- Test frontend role editor: Admin viewer sees locked Admin toggle for Admin target
