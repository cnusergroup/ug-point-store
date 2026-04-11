// @vitest-environment jsdom

// Feature: ux-navigation-redesign, Property 1: Tab Bar 结构完整性
// Validates: Requirements 1.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

// Mock @tarojs/taro
vi.mock('@tarojs/taro', () => ({
  default: { redirectTo: vi.fn() },
  redirectTo: vi.fn(),
}));

// Mock the Zustand store
vi.mock('../../store', () => ({
  useAppStore: vi.fn((selector: (s: { cartCount: number; locale: string }) => unknown) =>
    selector({ cartCount: 3, locale: 'zh' }),
  ),
}));

// Mock the i18n module so t() returns Chinese labels
vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'tabBar.mall': '商城',
        'tabBar.cart': '购物车',
        'tabBar.orders': '订单',
        'tabBar.profile': '我的',
      };
      return map[key] ?? key;
    },
    locale: 'zh',
  }),
}));

import TabBar, { TABS } from './index';
import { useAppStore } from '../../store';

/** Arbitrary for random path strings */
const pathArb = fc.oneof(
  // Known tab paths
  fc.constantFrom(
    '/pages/index/index',
    '/pages/cart/index',
    '/pages/orders/index',
    '/pages/profile/index',
  ),
  // Random path-like strings
  fc.array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz/.-_0123456789'.split('')),
    { minLength: 1, maxLength: 50 },
  ).map((chars) => `/${chars.join('')}`),
  // Completely random strings
  fc.string({ minLength: 0, maxLength: 60 }),
);

const EXPECTED_LABELS = ['商城', '购物车', '订单', '我的'];
const EXPECTED_PATHS = [
  '/pages/index/index',
  '/pages/cart/index',
  '/pages/orders/index',
  '/pages/profile/index',
];

describe('Property 1: Tab Bar 结构完整性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders exactly 4 tab items with correct labels and paths for any current path', () => {
    fc.assert(
      fc.property(pathArb, (currentPath) => {
        const { container } = render(<TabBar current={currentPath} />);

        // Should render exactly 4 tab items
        const tabItems = container.querySelectorAll('.tab-bar__item');
        expect(tabItems.length).toBe(4);

        // Should render exactly 4 labels
        const labels = container.querySelectorAll('.tab-bar__label, .tab-bar__label--active');
        const labelTexts = Array.from(labels).map((el) => el.textContent);
        expect(labelTexts).toEqual(EXPECTED_LABELS);

        // Verify TABS config has correct paths
        const tabPaths = TABS.map((tab) => tab.path);
        expect(tabPaths).toEqual(EXPECTED_PATHS);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: ux-navigation-redesign, Property 2: Tab 项选中状态颜色
// Validates: Requirements 1.2, 1.3

describe('Property 2: Tab 项选中状态颜色', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('active tab uses accent-primary color and --active label class; inactive tabs use text-tertiary and default label class', () => {
    fc.assert(
      fc.property(pathArb, (currentPath) => {
        const { container } = render(<TabBar current={currentPath} />);

        const tabItems = container.querySelectorAll('.tab-bar__item');

        tabItems.forEach((item, index) => {
          const tab = TABS[index];
          const isActive = tab.path === currentPath;
          // Use class-based selector to avoid picking up badge <span>
          const label = item.querySelector('.tab-bar__label, .tab-bar__label--active');
          const svg = item.querySelector('svg');

          if (isActive) {
            // Active tab: label should have --active class
            expect(label?.classList.contains('tab-bar__label--active')).toBe(true);
            // Active tab: SVG stroke should be accent-primary
            expect(svg?.getAttribute('stroke')).toBe('var(--accent-primary)');
          } else {
            // Inactive tab: label should have base class without --active
            expect(label?.classList.contains('tab-bar__label')).toBe(true);
            expect(label?.classList.contains('tab-bar__label--active')).toBe(false);
            // Inactive tab: SVG stroke should be text-tertiary
            expect(svg?.getAttribute('stroke')).toBe('var(--text-tertiary)');
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: ux-navigation-redesign, Property 3: 购物车徽标显示逻辑
// Validates: Requirements 1.4, 1.5, 1.6

describe('Property 3: 购物车徽标显示逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cart badge: hidden when 0, shows count for 1-99, shows "99+" for >99', () => {
    const cartCountArb = fc.integer({ min: 0, max: 10000 });

    fc.assert(
      fc.property(cartCountArb, (cartCount) => {
        // Re-mock useAppStore to return the generated cartCount
        vi.mocked(useAppStore).mockImplementation(
          (selector: (s: { cartCount: number; locale: string }) => unknown) =>
            selector({ cartCount, locale: 'zh' }) as ReturnType<typeof selector>,
        );

        const { container } = render(<TabBar current="/pages/index/index" />);

        // Cart tab is the second item (index 1)
        const cartTabItem = container.querySelectorAll('.tab-bar__item')[1];
        const badge = cartTabItem.querySelector('.tab-bar__badge');

        if (cartCount === 0) {
          // Badge should be hidden
          expect(badge).toBeNull();
        } else if (cartCount >= 1 && cartCount <= 99) {
          // Badge should show the exact count as string
          expect(badge).not.toBeNull();
          expect(badge!.textContent).toBe(String(cartCount));
        } else {
          // cartCount > 99: badge should show "99+"
          expect(badge).not.toBeNull();
          expect(badge!.textContent).toBe('99+');
        }
      }),
      { numRuns: 100 },
    );
  });
});
