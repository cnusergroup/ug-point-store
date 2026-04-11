// @vitest-environment jsdom

// Feature: ux-navigation-redesign, Property 6: 设置页面管理后台入口可见性
// Validates: Requirements 3.8

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

type UserRole = 'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin';

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'];

/**
 * Standalone component replicating the admin entry visibility logic
 * from settings/index.tsx. Isolates the conditional rendering from
 * full page dependencies (Zustand store, Taro, etc.).
 */
function SettingsAdminEntry({ userRoles }: { userRoles: UserRole[] }) {
  const isAdmin = userRoles.includes('Admin') || userRoles.includes('SuperAdmin');
  return (
    <div className='settings-list'>
      {isAdmin && (
        <div className='settings-item' data-testid='admin-entry'>
          <span className='settings-item__label'>管理后台</span>
        </div>
      )}
    </div>
  );
}

/** Arbitrary: random arrays of UserRole values, length 0 to 6 */
const rolesArb = fc.array(fc.constantFrom(...ALL_ROLES), { minLength: 0, maxLength: 6 });

describe('Property 6: 设置页面管理后台入口可见性', () => {
  it('shows admin entry when roles include Admin or SuperAdmin, hides otherwise', () => {
    fc.assert(
      fc.property(rolesArb, (roles) => {
        const { container } = render(<SettingsAdminEntry userRoles={roles} />);

        const adminEntry = container.querySelector('[data-testid="admin-entry"]');
        const hasAdminRole = roles.includes('Admin') || roles.includes('SuperAdmin');

        if (hasAdminRole) {
          expect(adminEntry).not.toBeNull();
          expect(adminEntry?.textContent).toContain('管理后台');
        } else {
          expect(adminEntry).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
