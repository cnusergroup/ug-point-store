# Implementation Plan: Admin Dashboard Redesign

## Overview

Reorganize the admin dashboard (`packages/frontend/src/pages/admin/index.tsx`) from a flat scrolling list of 15 navigation cards into a category-based navigation layout with 6 logical groups, collapsible sections, and sidebar/tab-bar navigation. This is a pure frontend refactor — no backend changes. All existing navigation, feature toggle gating, role-based visibility, and auth guards are preserved.

## Tasks

- [x] 1. Add category configuration and state to `index.tsx`
  - [x] 1.1 Define `DashboardCategory` interface and `DASHBOARD_CATEGORIES` constant array with 6 category objects (`key`, `label`, `icon`) in `index.tsx`
    - Categories: product-management (PackageIcon), order-management (ShoppingBagIcon), user-management (ProfileIcon), content-management (GlobeIcon), operations (GiftIcon), system-settings (SettingsIcon)
    - _Requirements: 2.1, 7.4_
  - [x] 1.2 Add `category` field to each entry in the `ADMIN_LINKS` array, mapping each link to its corresponding category key
    - products/codes/email-products → product-management; orders/claims → order-management; users/invites → user-management; content/categories/tags/email-content → content-management; batch-points/batch-history/travel → operations; settings → system-settings
    - _Requirements: 2.1_
  - [x] 1.3 Add `activeCategory` state (`useState<string>('product-management')`) to `AdminDashboard` component
    - _Requirements: 1.4_

- [x] 2. Create `DashboardCategoryNav` local component in `index.tsx`
  - [x] 2.1 Create `DashboardCategoryNav` component that accepts `categories`, `activeCategory`, and `onCategoryChange` props
    - Render category items as a vertical list with SVG icon component (size=18) + text label
    - Highlight active item with `--accent-primary` background
    - Only render categories that have at least one visible link
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 6.6_
  - [x] 2.2 Add `DashboardCategoryNav` styles to `index.scss`: `.dashboard-category-nav`, `.dashboard-category-nav__item`, `.dashboard-category-nav__item--active`, `.dashboard-category-nav__icon`, `.dashboard-category-nav__label`
    - _Requirements: 1.3, 7.1, 7.3_

- [x] 3. Create `CollapsibleSection` local component in `index.tsx`
  - [x] 3.1 Create `CollapsibleSection` component that accepts `title`, `description`, `defaultExpanded` (default true), and `children` props
    - Implement expand/collapse toggle with chevron icon rotation (right → down)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_
  - [x] 3.2 Add `CollapsibleSection` styles to `index.scss`: `.collapsible-section`, `.collapsible-section__header`, `.collapsible-section__chevron`, `.collapsible-section__content` with `max-height` transition using `--transition-fast`
    - _Requirements: 4.5, 7.1, 7.5_

- [x] 4. Add dashboard layout styles with responsive behavior to `index.scss`
  - [x] 4.1 Add `.dashboard-layout` wrapper styles with CSS Grid: sidebar (220px) + content area (1fr) on desktop (≥768px)
    - _Requirements: 8.1, 8.3_
  - [x] 4.2 Add `@media (max-width: 767px)` styles to switch `DashboardCategoryNav` to horizontal scrollable tab bar with hidden scrollbar, and stack layout vertically
    - _Requirements: 8.2, 8.4_
  - [x] 4.3 Ensure content area fills remaining width beside sidebar on desktop and has appropriate padding at 375px, 768px, and 1024px viewports
    - _Requirements: 8.3, 8.5_

- [x] 5. Checkpoint — Verify components compile
  - Ensure all new components and styles compile without errors, ask the user if questions arise.

- [x] 6. Refactor page render to use category-based navigation with filtering
  - [x] 6.1 Add visibility filtering logic: filter `ADMIN_LINKS` by role/feature toggles (preserve existing logic), group visible links by category, filter `DASHBOARD_CATEGORIES` to only those with visible links
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_
  - [x] 6.2 Add fallback for `activeCategory`: if `product-management` has no visible links, default to the first visible category from `visibleCategories`
    - _Requirements: 1.4, 6.6_
  - [x] 6.3 Wrap the main content area in `.dashboard-layout` with `DashboardCategoryNav` sidebar and a content container
    - _Requirements: 1.1, 1.5_
  - [x] 6.4 Render the active category's title using `--font-display` with appropriate heading size
    - _Requirements: 2.2_
  - [x] 6.5 Render the active category's navigation cards inside a `CollapsibleSection`, filtered by `activeCategory` state
    - Only render cards belonging to the active category
    - Each card: SVG icon (size=24, color=`var(--accent-primary)`), title (`--font-display`, `--text-primary`), description (`--font-body`, `--text-secondary`), arrow indicator (`›`)
    - Preserve existing `goTo(link.url)` onClick behavior using `Taro.navigateTo`
    - _Requirements: 1.2, 2.3, 3.1, 3.2, 3.6, 5.1, 5.2_
  - [x] 6.6 Remove the old flat `.admin-nav` card list rendering and replace with the new category-based rendering
    - Preserve loading state rendering when `featureToggles === null`
    - _Requirements: 5.1_

- [x] 7. Update card styles for visual hierarchy in `index.scss`
  - [x] 7.1 Update navigation card styles to use `--bg-surface`, `--card-border`, `--radius-md` per design system
    - _Requirements: 3.1, 7.1_
  - [x] 7.2 Add card hover styles: border color transition to `rgba(124, 109, 240, 0.3)` + subtle `translateX(var(--space-1))` within 200ms, `cursor: pointer`
    - _Requirements: 3.4, 3.5_
  - [x] 7.3 Ensure consistent spacing between cards using `--space-3` or `--space-4`
    - _Requirements: 3.3_
  - [x] 7.4 Add `prefers-reduced-motion` media query to disable collapse/expand animations and card hover transitions
    - _Requirements: 7.5_

- [x] 8. Checkpoint — Ensure all components render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Verify functional preservation and responsive layout
  - [x] 9.1 Manually verify all 15 navigation cards are accessible across the 6 categories and each navigates to the correct URL via `Taro.navigateTo`
    - _Requirements: 5.1, 5.2_
  - [x] 9.2 Manually verify feature-toggle-gated cards are hidden when toggle is off, and SuperAdmin-only cards are hidden for regular Admin users
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 9.3 Manually verify categories with all cards hidden are removed from the category navigation
    - _Requirements: 6.6_
  - [x] 9.4 Manually verify auth guards: non-authenticated users redirect to login, non-Admin users redirect to home, OrderAdmin users redirect to orders page
    - _Requirements: 5.3, 5.4, 5.5_
  - [x] 9.5 Manually verify responsive layout: sidebar on desktop ≥768px, horizontal scrollable tab bar on mobile <768px
    - _Requirements: 8.1, 8.2, 8.4_
  - [x] 9.6 Manually verify collapsible sections expand/collapse with animation, and `prefers-reduced-motion` disables animations
    - _Requirements: 4.1, 4.5, 7.5_
  - [x] 9.7 Manually verify all text uses design system fonts (`--font-display` for titles, `--font-body` for descriptions) and all colors use CSS variables (no hardcoded values)
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 9.8 Manually verify SVG icon components are used for category nav items (no emoji)
    - _Requirements: 7.4_

## Notes

- This is a pure UI reorganization — no backend changes, no new API endpoints
- All existing auth guards, feature toggle fetching, and role-based visibility logic are preserved unchanged
- The design explicitly states property-based testing does not apply (no data transformations or business logic changes)
- Checkpoints ensure incremental validation during implementation
- Each task references specific requirements for traceability
- The CollapsibleSection pattern mirrors the one used in the settings-panel-redesign
