# Bugfix Requirements Document

## Introduction

Admin users can currently bypass permission boundaries in the user management page to perform dangerous operations on other Admin/SuperAdmin users. Specifically, the `assignRoles` backend function does not preserve existing Admin/SuperAdmin roles when a non-SuperAdmin caller edits roles — allowing an Admin to effectively strip Admin/SuperAdmin status from other users by submitting a roles list that omits those roles. Additionally, the frontend shows disable/delete action buttons for Admin/SuperAdmin target users even when the current user is only an Admin (not SuperAdmin), and the role edit modal does not visually lock Admin/SuperAdmin role toggles for non-SuperAdmin callers.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a non-SuperAdmin caller invokes `assignRoles` with a roles list that omits the target user's existing Admin role THEN the system overwrites the target user's roles, effectively removing their Admin role

1.2 WHEN a non-SuperAdmin caller invokes `assignRoles` with a roles list that omits the target user's existing SuperAdmin role THEN the system overwrites the target user's roles, effectively removing their SuperAdmin role

1.3 WHEN a non-SuperAdmin Admin user views the user management page and the target user has Admin or SuperAdmin roles THEN the system displays disable and delete action buttons for that target user

1.4 WHEN a non-SuperAdmin Admin user opens the role edit modal for a user who has Admin or SuperAdmin roles THEN the system does not show Admin/SuperAdmin role toggles as disabled or locked, allowing the caller to deselect them

### Expected Behavior (Correct)

2.1 WHEN a non-SuperAdmin caller invokes `assignRoles` for a target user who currently has the Admin role THEN the system SHALL preserve the Admin role in the final roles list regardless of whether the caller included it, and SHALL only allow changes to non-admin roles (Speaker, Volunteer, UserGroupLeader)

2.2 WHEN a non-SuperAdmin caller invokes `assignRoles` for a target user who currently has the SuperAdmin role THEN the system SHALL preserve the SuperAdmin role in the final roles list regardless of whether the caller included it, and SHALL only allow changes to non-admin roles (Speaker, Volunteer, UserGroupLeader)

2.3 WHEN a non-SuperAdmin Admin user views the user management page and the target user has Admin or SuperAdmin roles THEN the system SHALL hide the disable and delete action buttons for that target user

2.4 WHEN a non-SuperAdmin Admin user opens the role edit modal for a user who has Admin or SuperAdmin roles THEN the system SHALL display Admin/SuperAdmin role toggles as disabled (locked) with a lock icon, preventing the caller from toggling them

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a SuperAdmin caller invokes `assignRoles` for any target user THEN the system SHALL CONTINUE TO allow adding or removing the Admin role as before

3.2 WHEN a SuperAdmin caller views the user management page THEN the system SHALL CONTINUE TO display disable and delete action buttons for Admin users (SuperAdmin users remain protected from disable/delete by existing checks)

3.3 WHEN any Admin or SuperAdmin caller invokes `assignRoles` with non-admin roles (Speaker, Volunteer, UserGroupLeader) for any target user THEN the system SHALL CONTINUE TO allow those role changes as before

3.4 WHEN a non-SuperAdmin caller invokes `setUserStatus` or `deleteUser` targeting a user without Admin/SuperAdmin roles THEN the system SHALL CONTINUE TO allow the operation as before

3.5 WHEN a SuperAdmin caller invokes `setUserStatus` or `deleteUser` targeting an Admin user THEN the system SHALL CONTINUE TO allow the operation as before

3.6 WHEN any caller invokes `setUserStatus` targeting a SuperAdmin user THEN the system SHALL CONTINUE TO reject the operation with CANNOT_DISABLE_SUPERADMIN

3.7 WHEN any caller invokes `deleteUser` targeting a SuperAdmin user THEN the system SHALL CONTINUE TO reject the operation with CANNOT_DELETE_SUPERADMIN

---

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type RoleAssignmentRequest { callerRoles: string[], targetCurrentRoles: string[], newRoles: string[] }
  OUTPUT: boolean

  // The bug triggers when a non-SuperAdmin caller submits a roles list
  // that would remove an existing Admin or SuperAdmin role from the target user
  callerIsSuperAdmin ← 'SuperAdmin' IN X.callerRoles
  targetHasAdminRole ← 'Admin' IN X.targetCurrentRoles OR 'SuperAdmin' IN X.targetCurrentRoles
  newRolesOmitAdmin ← ('Admin' IN X.targetCurrentRoles AND 'Admin' NOT IN X.newRoles)
                       OR ('SuperAdmin' IN X.targetCurrentRoles AND 'SuperAdmin' NOT IN X.newRoles)

  RETURN (NOT callerIsSuperAdmin) AND targetHasAdminRole AND newRolesOmitAdmin
END FUNCTION
```

### Property Specification — Fix Checking

```pascal
// Property: Fix Checking — Admin/SuperAdmin role preservation
FOR ALL X WHERE isBugCondition(X) DO
  result ← assignRoles'(X.targetUserId, X.newRoles, client, table, X.callerRoles)
  // After the fix, the target user's Admin/SuperAdmin roles are preserved
  finalRoles ← getUserRoles(X.targetUserId)
  IF 'Admin' IN X.targetCurrentRoles THEN
    ASSERT 'Admin' IN finalRoles
  END IF
  IF 'SuperAdmin' IN X.targetCurrentRoles THEN
    ASSERT 'SuperAdmin' IN finalRoles
  END IF
  ASSERT result.success = true
END FOR
```

### Property Specification — Preservation Checking

```pascal
// Property: Preservation Checking — Non-buggy inputs unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT assignRoles(X) = assignRoles'(X)
END FOR
```

### UI Bug Condition

```pascal
FUNCTION isUIBugCondition(X)
  INPUT: X of type UIContext { currentUserRoles: string[], targetUserRoles: string[] }
  OUTPUT: boolean

  currentUserIsSuperAdmin ← 'SuperAdmin' IN X.currentUserRoles
  targetHasAdminRole ← 'Admin' IN X.targetUserRoles OR 'SuperAdmin' IN X.targetUserRoles

  RETURN (NOT currentUserIsSuperAdmin) AND targetHasAdminRole
END FUNCTION
```

```pascal
// Property: UI Fix Checking — Hide disable/delete for admin targets
FOR ALL X WHERE isUIBugCondition(X) DO
  ASSERT disableButtonVisible(X) = false
  ASSERT deleteButtonVisible(X) = false
  ASSERT adminRoleToggleDisabled(X) = true
END FOR
```
