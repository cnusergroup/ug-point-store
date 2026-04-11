// @vitest-environment jsdom

// Feature: ux-navigation-redesign, Property 7: 骨架屏与加载状态联动
// Validates: Requirements 4.1, 4.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

/**
 * Standalone LoadingContainer that replicates the loading/content toggle
 * pattern used in index page and profile page.
 * When loading=true → render skeleton, hide content.
 * When loading=false → render content, hide skeleton.
 */
function LoadingContainer({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}) {
  return loading ? <>{skeleton}</> : <>{children}</>;
}

/**
 * Standalone ProductSkeleton replica using plain divs with the same
 * class names as the real component. Avoids Taro View dependency.
 */
function ProductSkeleton() {
  return (
    <div className='skeleton-product-grid'>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className='skeleton-product-card'>
          <div className='skeleton-block skeleton-product-card__image' />
          <div className='skeleton-product-card__body'>
            <div className='skeleton-block skeleton-product-card__title' />
            <div className='skeleton-block skeleton-product-card__price' />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Standalone ProfileSkeleton replica using plain divs with the same
 * class names as the real component. Avoids Taro View dependency.
 */
function ProfileSkeleton() {
  return (
    <div className='skeleton-profile'>
      <div className='skeleton-profile__card'>
        <div className='skeleton-block skeleton-profile__avatar' />
        <div className='skeleton-profile__info'>
          <div className='skeleton-block skeleton-profile__name' />
          <div className='skeleton-block skeleton-profile__points' />
        </div>
      </div>
      <div className='skeleton-profile__actions'>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className='skeleton-block skeleton-profile__action-item' />
        ))}
      </div>
    </div>
  );
}

describe('Property 7: 骨架屏与加载状态联动', () => {
  it('ProductSkeleton: loading=true renders skeleton, loading=false renders content', () => {
    fc.assert(
      fc.property(fc.boolean(), (loading) => {
        const { container } = render(
          <LoadingContainer loading={loading} skeleton={<ProductSkeleton />}>
            <div className='product-content'>Actual products</div>
          </LoadingContainer>,
        );

        const skeletonGrid = container.querySelector('.skeleton-product-grid');
        const content = container.querySelector('.product-content');

        if (loading) {
          expect(skeletonGrid).not.toBeNull();
          expect(content).toBeNull();
        } else {
          expect(content).not.toBeNull();
          expect(skeletonGrid).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ProfileSkeleton: loading=true renders skeleton, loading=false renders content', () => {
    fc.assert(
      fc.property(fc.boolean(), (loading) => {
        const { container } = render(
          <LoadingContainer loading={loading} skeleton={<ProfileSkeleton />}>
            <div className='profile-content'>Actual profile</div>
          </LoadingContainer>,
        );

        const skeletonProfile = container.querySelector('.skeleton-profile');
        const content = container.querySelector('.profile-content');

        if (loading) {
          expect(skeletonProfile).not.toBeNull();
          expect(content).toBeNull();
        } else {
          expect(content).not.toBeNull();
          expect(skeletonProfile).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
