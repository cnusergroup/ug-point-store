/**
 * Check product management permission (three-layer + mode check):
 * 1. SuperAdmin → true
 * 2. adminProductsEnabled === false → false
 * 3. adminProductsEnabled === true:
 *    - productManagementMode === 'all' (or undefined) and Admin → true
 *    - productManagementMode === 'specific' and Admin and userId in productManagerIds → true
 *    - Otherwise → false
 */
export function checkProductPermission(
  userRoles: string[],
  adminProductsEnabled: boolean,
  userId?: string,
  productManagementMode?: 'all' | 'specific',
  productManagerIds?: string[],
): boolean {
  // Layer 1: SuperAdmin always wins
  if (userRoles.includes('SuperAdmin')) {
    return true;
  }

  // Layer 2: Feature disabled → denied
  if (!adminProductsEnabled) {
    return false;
  }

  // Layer 3: Feature enabled — check mode
  if (!userRoles.includes('Admin')) {
    return false;
  }

  const mode = productManagementMode ?? 'all';

  if (mode === 'all') {
    return true;
  }

  // mode === 'specific': Admin must be in the product manager list
  const managerIds = productManagerIds ?? [];
  return userId !== undefined && managerIds.includes(userId);
}
