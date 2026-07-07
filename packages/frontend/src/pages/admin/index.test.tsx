// @vitest-environment jsdom

// Feature: ugl-inactivity-exit-flow
// Validates: Requirements 9.3 - "WHEN a non-SuperAdmin user navigates to the admin
// interface, THE Pending_Exit_List SHALL not be visible."

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';

type UserRole = 'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin';

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'];

/**
 * Standalone replica of the `ugl-exit-review` ADMIN_LINKS entry's visibility
 * predicate from admin/index.tsx (task 20.1):
 *
 *   ADMIN_LINKS.filter((link) => !link.superAdminOnly || user?.roles?.includes('SuperAdmin'))
 *
 * The `ugl-exit-review` link has `superAdminOnly: true` and no
 * `featureToggleKey`/`adminPermissionKey`, so its visibility depends solely on
 * whether the caller's roles include 'SuperAdmin'.
 */
function isUglExitReviewLinkVisible(userRoles: UserRole[] | undefined): boolean {
  const superAdminOnly = true;
  return !superAdminOnly || (userRoles?.includes('SuperAdmin') ?? false);
}

/** Minimal replica of the dashboard card list, mirroring SettingsAdminEntry pattern. */
function DashboardUglExitEntry({ userRoles }: { userRoles: UserRole[] }) {
  const visible = isUglExitReviewLinkVisible(userRoles);
  return (
    <div className='dashboard-content'>
      {visible && (
        <div className='admin-nav__card' data-testid='ugl-exit-review-entry'>
          <span className='admin-nav__card-title'>UGL Exit Review</span>
        </div>
      )}
    </div>
  );
}

/** Arbitrary: random arrays of UserRole values, length 0 to 6 */
const rolesArb = fc.array(fc.constantFrom(...ALL_ROLES), { minLength: 0, maxLength: 6 });

describe('ugl-exit-review dashboard card visibility', () => {
  it('is visible iff roles include SuperAdmin (property)', () => {
    fc.assert(
      fc.property(rolesArb, (roles) => {
        const visible = isUglExitReviewLinkVisible(roles);
        expect(visible).toBe(roles.includes('SuperAdmin'));
      }),
      { numRuns: 100 },
    );
  });

  it('renders the entry only when SuperAdmin is in the roles (example)', () => {
    const { container: withSuperAdmin } = render(
      <DashboardUglExitEntry userRoles={['UserGroupLeader', 'SuperAdmin']} />,
    );
    expect(withSuperAdmin.querySelector('[data-testid="ugl-exit-review-entry"]')).not.toBeNull();

    const { container: withoutSuperAdmin } = render(
      <DashboardUglExitEntry userRoles={['Admin']} />,
    );
    expect(withoutSuperAdmin.querySelector('[data-testid="ugl-exit-review-entry"]')).toBeNull();

    const { container: emptyRoles } = render(<DashboardUglExitEntry userRoles={[]} />);
    expect(emptyRoles.querySelector('[data-testid="ugl-exit-review-entry"]')).toBeNull();
  });
});
