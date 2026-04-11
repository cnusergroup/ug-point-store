// Feature: ux-navigation-redesign, Property 9: SVG 图标属性一致性
// Validates: Requirements 6.2, 6.5

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import {
  HomeIcon,
  HomeActiveIcon,
  CartIcon,
  CartActiveIcon,
  OrderIcon,
  OrderActiveIcon,
  ProfileIcon,
  ProfileActiveIcon,
  TicketIcon,
  LocationIcon,
  ClaimIcon,
  SettingsIcon,
  GiftIcon,
  LockIcon,
  PackageIcon,
  RefreshIcon,
  KeyIcon,
  LogoutIcon,
  AdminIcon,
  VoucherIcon,
  ShoppingBagIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
} from './index';
import type { IconProps } from './types';

type IconComponent = (props: IconProps) => JSX.Element;

/** All icon components to test */
const ALL_ICONS: { name: string; component: IconComponent; isActive: boolean }[] = [
  { name: 'HomeIcon', component: HomeIcon, isActive: false },
  { name: 'HomeActiveIcon', component: HomeActiveIcon, isActive: true },
  { name: 'CartIcon', component: CartIcon, isActive: false },
  { name: 'CartActiveIcon', component: CartActiveIcon, isActive: true },
  { name: 'OrderIcon', component: OrderIcon, isActive: false },
  { name: 'OrderActiveIcon', component: OrderActiveIcon, isActive: true },
  { name: 'ProfileIcon', component: ProfileIcon, isActive: false },
  { name: 'ProfileActiveIcon', component: ProfileActiveIcon, isActive: true },
  { name: 'TicketIcon', component: TicketIcon, isActive: false },
  { name: 'LocationIcon', component: LocationIcon, isActive: false },
  { name: 'ClaimIcon', component: ClaimIcon, isActive: false },
  { name: 'SettingsIcon', component: SettingsIcon, isActive: false },
  { name: 'GiftIcon', component: GiftIcon, isActive: false },
  { name: 'LockIcon', component: LockIcon, isActive: false },
  { name: 'PackageIcon', component: PackageIcon, isActive: false },
  { name: 'RefreshIcon', component: RefreshIcon, isActive: false },
  { name: 'KeyIcon', component: KeyIcon, isActive: false },
  { name: 'LogoutIcon', component: LogoutIcon, isActive: false },
  { name: 'AdminIcon', component: AdminIcon, isActive: false },
  { name: 'VoucherIcon', component: VoucherIcon, isActive: false },
  { name: 'ShoppingBagIcon', component: ShoppingBagIcon, isActive: false },
  { name: 'ChevronRightIcon', component: ChevronRightIcon, isActive: false },
  { name: 'ArrowLeftIcon', component: ArrowLeftIcon, isActive: false },
];

/** Arbitrary for random size 1~200 */
const sizeArb = fc.integer({ min: 1, max: 200 });

/** Arbitrary for random color strings (hex, named, rgb) */
const hexCharArb = fc.constantFrom(...'0123456789abcdef'.split(''));
const hexColorArb = fc.tuple(hexCharArb, hexCharArb, hexCharArb, hexCharArb, hexCharArb, hexCharArb).map(
  (chars) => `#${chars.join('')}`,
);
const colorArb = fc.oneof(
  hexColorArb,
  fc.constantFrom('red', 'blue', 'green', 'black', 'white', 'orange', 'purple'),
  fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map(
    ([r, g, b]) => `rgb(${r},${g},${b})`,
  ),
);

/** Arbitrary that picks one icon entry from ALL_ICONS */
const iconArb = fc.constantFrom(...ALL_ICONS);

describe('Property 9: SVG 图标属性一致性', () => {
  it('renders SVG with correct width, height, and stroke attributes for random size and color', () => {
    fc.assert(
      fc.property(iconArb, sizeArb, colorArb, (iconEntry, size, color) => {
        const Component = iconEntry.component;
        const { container } = render(<Component size={size} color={color} />);
        const svg = container.querySelector('svg')!;

        expect(svg).toBeTruthy();

        // width and height should match the provided size
        expect(svg.getAttribute('width')).toBe(String(size));
        expect(svg.getAttribute('height')).toBe(String(size));

        // stroke or fill should equal the provided color
        const stroke = svg.getAttribute('stroke');
        const fill = svg.getAttribute('fill');
        const colorMatches = stroke === color || fill === color;
        expect(colorMatches).toBe(true);

        // All icons must have these stroke attributes
        expect(svg.getAttribute('stroke-width')).toBe('2');
        expect(svg.getAttribute('stroke-linecap')).toBe('round');
        expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      }),
      { numRuns: 100 },
    );
  });

  it('renders SVG with default size=24 and color=currentColor when no props provided', () => {
    fc.assert(
      fc.property(iconArb, (iconEntry) => {
        const Component = iconEntry.component;
        const { container } = render(<Component />);
        const svg = container.querySelector('svg')!;

        expect(svg).toBeTruthy();

        // Default size should be 24
        expect(svg.getAttribute('width')).toBe('24');
        expect(svg.getAttribute('height')).toBe('24');

        // Default color should be currentColor
        const stroke = svg.getAttribute('stroke');
        const fill = svg.getAttribute('fill');
        const hasCurrentColor = stroke === 'currentColor' || fill === 'currentColor';
        expect(hasCurrentColor).toBe(true);

        // Stroke attributes must always be present
        expect(svg.getAttribute('stroke-width')).toBe('2');
        expect(svg.getAttribute('stroke-linecap')).toBe('round');
        expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      }),
      { numRuns: 100 },
    );
  });

  it('active icon variants use fill={color} while regular icons use fill="none"', () => {
    fc.assert(
      fc.property(iconArb, colorArb, (iconEntry, color) => {
        const Component = iconEntry.component;
        const { container } = render(<Component color={color} />);
        const svg = container.querySelector('svg')!;

        const fill = svg.getAttribute('fill');
        if (iconEntry.isActive) {
          // Active variants should have fill={color}
          expect(fill).toBe(color);
        } else {
          // Regular icons should have fill="none"
          expect(fill).toBe('none');
        }
      }),
      { numRuns: 100 },
    );
  });
});
