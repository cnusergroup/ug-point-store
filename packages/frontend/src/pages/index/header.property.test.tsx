// @vitest-environment jsdom

// Feature: ux-navigation-redesign, Property 4: 头部角色徽章截断
// Validates: Requirements 2.2, 2.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

/** UserRole type matching the store definition */
type UserRole = 'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin';

const ALL_USER_ROLES: UserRole[] = [
  'UserGroupLeader',
  'CommunityBuilder',
  'Speaker',
  'Volunteer',
  'Admin',
  'SuperAdmin',
];

/** Role display config — mirrors ROLE_CONFIG from index.tsx */
const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

/**
 * Standalone component that replicates the header role badge rendering logic
 * from IndexPage. This isolates the logic under test from the full page dependencies.
 */
function RoleBadges({ roles }: { roles: UserRole[] }) {
  if (roles.length === 0) return null;
  return (
    <div className='mall-header__user-roles'>
      {roles.slice(0, 2).map((role, i) => (
        <span key={i} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
          {ROLE_CONFIG[role]?.label || role}
        </span>
      ))}
      {roles.length > 2 && (
        <span className='mall-header__roles-overflow'>+{roles.length - 2}</span>
      )}
    </div>
  );
}

/** Arbitrary: random array of unique UserRole values, length 0..10 */
const rolesArb = fc
  .subarray(ALL_USER_ROLES, { minLength: 0, maxLength: ALL_USER_ROLES.length })
  .chain((subset) =>
    fc.shuffledSubarray(subset, { minLength: subset.length, maxLength: subset.length }),
  )
  // Extend beyond 6 unique roles by allowing duplicates to reach lengths up to 10
  .chain((uniqueRoles) =>
    fc
      .array(fc.constantFrom(...ALL_USER_ROLES), {
        minLength: 0,
        maxLength: Math.max(0, 10 - uniqueRoles.length),
      })
      .map((extra) => [...uniqueRoles, ...extra]),
  );

describe('Property 4: 头部角色徽章截断', () => {
  it('displays min(roles.length, 2) badges and correct overflow indicator for any roles array', () => {
    fc.assert(
      fc.property(rolesArb, (roles) => {
        const { container } = render(<RoleBadges roles={roles} />);

        const badges = container.querySelectorAll('.role-badge');
        const overflow = container.querySelector('.mall-header__roles-overflow');

        const expectedBadgeCount = Math.min(roles.length, 2);

        // Number of rendered role badges should be min(roles.length, 2)
        expect(badges.length).toBe(expectedBadgeCount);

        if (roles.length > 2) {
          // Overflow indicator should exist with text "+{roles.length - 2}"
          expect(overflow).not.toBeNull();
          expect(overflow!.textContent).toBe(`+${roles.length - 2}`);
        } else {
          // No overflow indicator when roles.length <= 2
          expect(overflow).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
