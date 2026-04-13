import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  checkContentPermission,
  checkReviewPermission,
  computeEffectivePermissions,
  type ContentPermissionKey,
} from './content-permission';
import type { FeatureToggles } from '../settings/feature-toggles';

// ============================================================
// Arbitraries
// ============================================================

const ALL_ROLES = ['SuperAdmin', 'Admin', 'Speaker', 'UserGroupLeader', 'Volunteer'] as const;
const CONTENT_ROLES = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
const PERMISSION_KEYS: ContentPermissionKey[] = ['canAccess', 'canUpload', 'canDownload', 'canReserve'];

/** Arbitrary for a roles array (any combination, with possible duplicates) */
const rolesArb = fc.array(fc.constantFrom(...ALL_ROLES));

/** Arbitrary for a permission key */
const permissionKeyArb = fc.constantFrom(...PERMISSION_KEYS);

/** Arbitrary for a single RolePermissions object */
const rolePermissionsArb = fc.record({
  canAccess: fc.boolean(),
  canUpload: fc.boolean(),
  canDownload: fc.boolean(),
  canReserve: fc.boolean(),
});

/** Arbitrary for a ContentRolePermissions object */
const contentRolePermissionsArb = fc.record({
  Speaker: rolePermissionsArb,
  UserGroupLeader: rolePermissionsArb,
  Volunteer: rolePermissionsArb,
});

/**
 * Minimal FeatureToggles arbitrary — only contentRolePermissions is needed
 * by checkContentPermission / computeEffectivePermissions.
 */
const featureTogglesArb: fc.Arbitrary<FeatureToggles> = contentRolePermissionsArb.map(
  (contentRolePermissions) => ({
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    contentRolePermissions,
  }),
);

// ============================================================
// Property 5: checkContentPermission 三层逻辑正确性
// Feature: content-role-settings, Property 5: checkContentPermission 三层逻辑正确性
// Validates: Requirements 6.1–6.6, 7.1–7.6, 8.1–8.7, 9.1–9.7
// ============================================================

describe('Feature: content-role-settings, Property 5: checkContentPermission 三层逻辑正确性', () => {
  it('SuperAdmin always returns true regardless of permission or featureToggles', () => {
    fc.assert(
      fc.property(
        rolesArb,
        permissionKeyArb,
        featureTogglesArb,
        (roles, permission, toggles) => {
          if (!roles.includes('SuperAdmin')) return true; // only test SuperAdmin cases
          return checkContentPermission(roles, permission, toggles) === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('no Content_Role in roles always returns false', () => {
    fc.assert(
      fc.property(
        // Roles that contain no Content_Role (only SuperAdmin/Admin or empty)
        fc.array(fc.constantFrom('Admin' as const)),
        permissionKeyArb,
        featureTogglesArb,
        (roles, permission, toggles) => {
          // Skip if SuperAdmin is present (covered by layer 1)
          if (roles.includes('SuperAdmin' as never)) return true;
          return checkContentPermission(roles, permission, toggles) === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('with Content_Role(s) and no SuperAdmin, result equals OR of matching role permissions', () => {
    fc.assert(
      fc.property(
        rolesArb,
        permissionKeyArb,
        featureTogglesArb,
        (roles, permission, toggles) => {
          // Skip SuperAdmin cases (layer 1)
          if (roles.includes('SuperAdmin')) return true;

          const contentRoles = roles.filter((r): r is typeof CONTENT_ROLES[number] =>
            (CONTENT_ROLES as readonly string[]).includes(r),
          );

          // Skip no-Content_Role cases (layer 2)
          if (contentRoles.length === 0) return true;

          // Layer 3: result must equal OR of all matching Content_Role permission values
          const expected = contentRoles.some(
            (role) => toggles.contentRolePermissions[role][permission],
          );
          return checkContentPermission(roles, permission, toggles) === expected;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('three-layer logic is fully consistent across all role combinations', () => {
    fc.assert(
      fc.property(
        rolesArb,
        permissionKeyArb,
        featureTogglesArb,
        (roles, permission, toggles) => {
          const result = checkContentPermission(roles, permission, toggles);

          if (roles.includes('SuperAdmin')) {
            return result === true;
          }

          const contentRoles = roles.filter((r): r is typeof CONTENT_ROLES[number] =>
            (CONTENT_ROLES as readonly string[]).includes(r),
          );

          if (contentRoles.length === 0) {
            return result === false;
          }

          const expected = contentRoles.some(
            (role) => toggles.contentRolePermissions[role][permission],
          );
          return result === expected;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ============================================================
// Property 6: checkReviewPermission 审批权限逻辑正确性
// Feature: content-role-settings, Property 6: checkReviewPermission 审批权限逻辑正确性
// Validates: Requirements 10.1–10.4
// ============================================================

describe('Feature: content-role-settings, Property 6: checkReviewPermission 审批权限逻辑正确性', () => {
  it('SuperAdmin always returns true regardless of adminContentReviewEnabled', () => {
    fc.assert(
      fc.property(
        rolesArb,
        fc.boolean(),
        (roles, adminContentReviewEnabled) => {
          if (!roles.includes('SuperAdmin')) return true;
          return checkReviewPermission(roles, adminContentReviewEnabled) === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Admin with adminContentReviewEnabled=true returns true', () => {
    fc.assert(
      fc.property(
        rolesArb,
        (roles) => {
          if (roles.includes('SuperAdmin')) return true;
          if (!roles.includes('Admin')) return true;
          return checkReviewPermission(roles, true) === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Admin with adminContentReviewEnabled=false returns false', () => {
    fc.assert(
      fc.property(
        // Roles that include Admin but not SuperAdmin
        fc.array(fc.constantFrom('Admin' as const, 'Speaker' as const, 'UserGroupLeader' as const, 'Volunteer' as const)),
        (roles) => {
          if (roles.includes('SuperAdmin' as never)) return true;
          if (!roles.includes('Admin')) return true;
          return checkReviewPermission(roles, false) === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('non-Admin, non-SuperAdmin always returns false', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Speaker' as const, 'UserGroupLeader' as const, 'Volunteer' as const)),
        fc.boolean(),
        (roles, adminContentReviewEnabled) => {
          return checkReviewPermission(roles, adminContentReviewEnabled) === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('full three-branch logic is consistent across all inputs', () => {
    fc.assert(
      fc.property(
        rolesArb,
        fc.boolean(),
        (roles, adminContentReviewEnabled) => {
          const result = checkReviewPermission(roles, adminContentReviewEnabled);

          if (roles.includes('SuperAdmin')) {
            return result === true;
          }
          if (adminContentReviewEnabled && roles.includes('Admin')) {
            return result === true;
          }
          return result === false;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ============================================================
// Property 9: computeEffectivePermissions 与 checkContentPermission 一致性
// Feature: content-role-settings, Property 9: computeEffectivePermissions 与 checkContentPermission 一致性
// Validates: Requirements 13.1–13.9
// ============================================================

describe('Feature: content-role-settings, Property 9: computeEffectivePermissions 与 checkContentPermission 一致性', () => {
  it('computeEffectivePermissions results equal four separate checkContentPermission calls', () => {
    fc.assert(
      fc.property(
        rolesArb,
        featureTogglesArb,
        (roles, toggles) => {
          const effective = computeEffectivePermissions(roles, toggles);

          return (
            effective.canAccess === checkContentPermission(roles, 'canAccess', toggles) &&
            effective.canUpload === checkContentPermission(roles, 'canUpload', toggles) &&
            effective.canDownload === checkContentPermission(roles, 'canDownload', toggles) &&
            effective.canReserve === checkContentPermission(roles, 'canReserve', toggles)
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('computeEffectivePermissions returns all four boolean fields', () => {
    fc.assert(
      fc.property(
        rolesArb,
        featureTogglesArb,
        (roles, toggles) => {
          const effective = computeEffectivePermissions(roles, toggles);
          return (
            typeof effective.canAccess === 'boolean' &&
            typeof effective.canUpload === 'boolean' &&
            typeof effective.canDownload === 'boolean' &&
            typeof effective.canReserve === 'boolean'
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('canDownload and canReserve are evaluated independently', () => {
    fc.assert(
      fc.property(
        rolesArb,
        featureTogglesArb,
        (roles, toggles) => {
          const effective = computeEffectivePermissions(roles, toggles);
          // canDownload and canReserve must each independently match checkContentPermission
          const downloadOk = effective.canDownload === checkContentPermission(roles, 'canDownload', toggles);
          const reserveOk = effective.canReserve === checkContentPermission(roles, 'canReserve', toggles);
          return downloadOk && reserveOk;
        },
      ),
      { numRuns: 200 },
    );
  });
});
