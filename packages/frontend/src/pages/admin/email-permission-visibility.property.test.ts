// @vitest-environment jsdom

// Feature: admin-email-permission, Property 4: Dashboard card visibility matrix
// Validates: Requirements 3.1, 3.2, 3.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Minimal representation of an ADMIN_LINKS entry, containing only the
 * fields relevant to the dashboard filter logic under test.
 */
interface AdminLink {
  key: string;
  superAdminOnly?: boolean;
  featureToggleKey?: string;
  adminPermissionKey?: string;
}

/**
 * Feature toggles relevant to the email permission cards.
 */
interface FeatureToggles {
  adminEmailProductsEnabled: boolean;
  adminEmailContentEnabled: boolean;
  [key: string]: boolean;
}

/**
 * Pure replication of the two-stage filter logic from
 * packages/frontend/src/pages/admin/index.tsx.
 *
 * Stage 1: hide superAdminOnly cards unless user is SuperAdmin.
 * Stage 2: hide featureToggleKey-gated cards when toggle is false;
 *          hide adminPermissionKey-gated cards for non-SuperAdmin when toggle is false.
 */
function filterAdminLinks(
  links: AdminLink[],
  userRoles: string[],
  featureToggles: FeatureToggles,
): AdminLink[] {
  return links
    .filter((link) => !link.superAdminOnly || userRoles.includes('SuperAdmin'))
    .filter((link) => {
      if (link.featureToggleKey && featureToggles[link.featureToggleKey] === false) return false;
      if (link.adminPermissionKey && !userRoles.includes('SuperAdmin')) {
        if (featureToggles[link.adminPermissionKey] === false) return false;
      }
      return true;
    });
}

/** The two email cards as they appear in ADMIN_LINKS */
const EMAIL_CARDS: AdminLink[] = [
  { key: 'email-products', adminPermissionKey: 'adminEmailProductsEnabled' },
  { key: 'email-content', adminPermissionKey: 'adminEmailContentEnabled' },
];

describe('Property 4: Dashboard card visibility matrix', () => {
  it('SuperAdmin always sees both email cards; Admin sees a card iff its toggle is true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Admin' as const, 'SuperAdmin' as const),
        fc.boolean(), // adminEmailProductsEnabled
        fc.boolean(), // adminEmailContentEnabled
        (role, productsToggle, contentToggle) => {
          const userRoles = [role];
          const toggles: FeatureToggles = {
            adminEmailProductsEnabled: productsToggle,
            adminEmailContentEnabled: contentToggle,
          };

          const visible = filterAdminLinks(EMAIL_CARDS, userRoles, toggles);
          const visibleKeys = visible.map((l) => l.key);

          if (role === 'SuperAdmin') {
            // Requirement 3.3: SuperAdmin always sees both email cards
            expect(visibleKeys).toContain('email-products');
            expect(visibleKeys).toContain('email-content');
          } else {
            // Requirement 3.1: Admin sees email-products iff toggle is true
            if (productsToggle) {
              expect(visibleKeys).toContain('email-products');
            } else {
              expect(visibleKeys).not.toContain('email-products');
            }

            // Requirement 3.2: Admin sees email-content iff toggle is true
            if (contentToggle) {
              expect(visibleKeys).toContain('email-content');
            } else {
              expect(visibleKeys).not.toContain('email-content');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
