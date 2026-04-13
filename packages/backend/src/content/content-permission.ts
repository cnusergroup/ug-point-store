import type { FeatureToggles } from '../settings/feature-toggles';

export type ContentPermissionKey = 'canAccess' | 'canUpload' | 'canDownload' | 'canReserve';

const CONTENT_ROLES = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
type ContentRole = (typeof CONTENT_ROLES)[number];

/**
 * Three-layer permission check:
 * 1. SuperAdmin in roles → true
 * 2. No Content_Role (Speaker/UserGroupLeader/Volunteer) in roles → false
 * 3. Otherwise → OR of all matching Content_Role permission values
 */
export function checkContentPermission(
  userRoles: string[],
  permission: ContentPermissionKey,
  featureToggles: FeatureToggles,
): boolean {
  // Layer 1: SuperAdmin always wins
  if (userRoles.includes('SuperAdmin')) {
    return true;
  }

  // Layer 2: Pure_Admin — has no Content_Role → always denied
  const contentRoles = userRoles.filter((r): r is ContentRole =>
    (CONTENT_ROLES as readonly string[]).includes(r),
  );
  if (contentRoles.length === 0) {
    return false;
  }

  // Layer 3: OR union of all matching Content_Role permission values
  return contentRoles.some(
    (role) => featureToggles.contentRolePermissions[role][permission],
  );
}

/**
 * Compute all four effective permissions for a user.
 * Calls checkContentPermission four times.
 */
export function computeEffectivePermissions(
  userRoles: string[],
  featureToggles: FeatureToggles,
): { canAccess: boolean; canUpload: boolean; canDownload: boolean; canReserve: boolean } {
  return {
    canAccess: checkContentPermission(userRoles, 'canAccess', featureToggles),
    canUpload: checkContentPermission(userRoles, 'canUpload', featureToggles),
    canDownload: checkContentPermission(userRoles, 'canDownload', featureToggles),
    canReserve: checkContentPermission(userRoles, 'canReserve', featureToggles),
  };
}

/**
 * Check review permission:
 * 1. SuperAdmin → true
 * 2. adminContentReviewEnabled && Admin in roles → true
 * 3. Otherwise → false
 */
export function checkReviewPermission(
  userRoles: string[],
  adminContentReviewEnabled: boolean,
): boolean {
  // Layer 1: SuperAdmin always wins
  if (userRoles.includes('SuperAdmin')) {
    return true;
  }

  // Layer 2: Admin allowed when feature is enabled
  if (adminContentReviewEnabled && userRoles.includes('Admin')) {
    return true;
  }

  // Layer 3: Denied
  return false;
}
