/**
 * Check if the current user can manage (disable/delete) a target user.
 * Returns false when the viewer is not SuperAdmin and the target has Admin or SuperAdmin roles.
 */
export function canManageUser(viewerRoles: string[], targetRoles: string[]): boolean {
  const viewerIsSuperAdmin = viewerRoles.includes('SuperAdmin');
  if (viewerIsSuperAdmin) return true;
  const targetHasAdminRole = targetRoles.includes('Admin') || targetRoles.includes('SuperAdmin');
  return !targetHasAdminRole;
}
