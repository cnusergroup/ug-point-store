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
 * Check review permission (three-layer + mode check):
 * 1. SuperAdmin → true
 * 2. adminContentReviewEnabled === false → false
 * 3. adminContentReviewEnabled === true:
 *    - contentReviewMode === 'all' (or undefined) and Admin → true
 *    - contentReviewMode === 'specific' and Admin and userId in contentReviewerIds → true
 *    - Otherwise → false
 *
 * New parameters are optional for backward compatibility with existing callers.
 */
export function checkReviewPermission(
  userRoles: string[],
  adminContentReviewEnabled: boolean,
  userId?: string,
  contentReviewMode?: 'all' | 'specific',
  contentReviewerIds?: string[],
): boolean {
  // Layer 1: SuperAdmin always wins
  if (userRoles.includes('SuperAdmin')) {
    return true;
  }

  // Layer 2: Feature disabled → denied
  if (!adminContentReviewEnabled) {
    return false;
  }

  // Layer 3: Feature enabled — check mode
  if (!userRoles.includes('Admin')) {
    return false;
  }

  const mode = contentReviewMode ?? 'all';

  if (mode === 'all') {
    return true;
  }

  // mode === 'specific': Admin must be in the reviewer list
  const reviewerIds = contentReviewerIds ?? [];
  return userId !== undefined && reviewerIds.includes(userId);
}
