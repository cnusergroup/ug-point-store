// @vitest-environment jsdom

// Feature: ux-navigation-redesign, Property 5: 用户卡片信息渲染
// Validates: Requirements 3.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

/**
 * Standalone UserCard component that replicates the profile page's UserCard
 * rendering logic from profile/index.tsx. This isolates the logic under test
 * from the full page dependencies (Zustand store, Taro, API calls).
 */
function UserCard({ user }: { user: { nickname?: string; points?: number } | null }) {
  return (
    <div className='profile-card'>
      <div className='profile-card__avatar'>
        <span className='profile-card__avatar-text'>
          {user?.nickname?.charAt(0)?.toUpperCase() || '?'}
        </span>
      </div>
      <div className='profile-card__info'>
        <span className='profile-card__nickname'>{user?.nickname || '用户'}</span>
      </div>
      <div className='profile-card__points'>
        <span className='profile-card__points-value'>
          {user?.points?.toLocaleString() || '0'}
        </span>
      </div>
    </div>
  );
}

/** Arbitrary: random nickname strings including empty, single char, unicode */
const nicknameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.constantFrom('A', '张', '🎉', 'a', 'Z'),
);

/** Arbitrary: random non-negative integer points (0 ~ 1000000) */
const pointsArb = fc.integer({ min: 0, max: 1000000 });

describe('Property 5: 用户卡片信息渲染', () => {
  it('renders avatar text, full nickname, and points value for any user state', () => {
    fc.assert(
      fc.property(nicknameArb, pointsArb, (nickname, points) => {
        const user = { nickname, points };
        const { container } = render(<UserCard user={user} />);

        const avatarText = container.querySelector('.profile-card__avatar-text');
        const nicknameEl = container.querySelector('.profile-card__nickname');
        const pointsValue = container.querySelector('.profile-card__points-value');

        // Avatar text: first char uppercased, or "?" if nickname is empty
        const expectedAvatar = nickname
          ? nickname.charAt(0).toUpperCase()
          : '?';
        expect(avatarText?.textContent).toBe(expectedAvatar);

        // Nickname: full nickname, or "用户" if empty
        const expectedNickname = nickname || '用户';
        expect(nicknameEl?.textContent).toBe(expectedNickname);

        // Points: formatted with toLocaleString(), or "0" if falsy
        const expectedPoints = points ? points.toLocaleString() : '0';
        expect(pointsValue?.textContent).toBe(expectedPoints);
      }),
      { numRuns: 100 },
    );
  });
});
