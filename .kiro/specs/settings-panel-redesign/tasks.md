# Tasks

## Task 1: Define category configuration and add navigation state

- [ ] 1.1 Add `SETTINGS_CATEGORIES` constant array with 7 category objects (`key`, `label`, `icon`) to `settings.tsx`
- [ ] 1.2 Add `activeCategory` state (`useState<string>('feature-toggles')`) to `AdminSettingsPage`
- [ ] 1.3 Add `collapsedSections` state (`useState<Set<string>>(new Set())`) and toggle helper function to `AdminSettingsPage`

## Task 2: Create CategoryNav local component

- [ ] 2.1 Create `CategoryNav` component in `settings.tsx` that accepts `categories`, `activeCategory`, and `onCategoryChange` props
- [ ] 2.2 Render category items as a vertical list with icon + label, highlighting active item with `--accent-primary`
- [ ] 2.3 Add CategoryNav styles to `settings.scss`: `.category-nav`, `.category-nav__item`, `.category-nav__item--active`, `.category-nav__icon`, `.category-nav__label`

## Task 3: Create CollapsibleSection local component

- [ ] 3.1 Create `CollapsibleSection` component in `settings.tsx` that accepts `title`, `description`, `defaultExpanded`, and `children` props
- [ ] 3.2 Implement expand/collapse toggle with chevron icon rotation (right → down)
- [ ] 3.3 Add CollapsibleSection styles to `settings.scss`: `.collapsible-section`, `.collapsible-section__header`, `.collapsible-section__chevron`, `.collapsible-section__content` with `max-height` transition using `--transition-fast`

## Task 4: Create settings layout wrapper with responsive behavior

- [ ] 4.1 Add `.settings-layout` wrapper styles to `settings.scss` with CSS Grid: sidebar + content area on desktop (≥768px)
- [ ] 4.2 Add `@media (max-width: 767px)` styles to switch CategoryNav to horizontal scrollable tab bar and stack layout vertically
- [ ] 4.3 Ensure content area fills remaining width beside sidebar on desktop and has appropriate padding on all viewports

## Task 5: Refactor page render to use category-based navigation

- [ ] 5.1 Wrap the main content area in `SettingsLayout` with `CategoryNav` and a content container
- [ ] 5.2 Extract existing "功能开关" controls (codeRedemption, pointsClaim toggles) into a category render block, wrapped in CollapsibleSection
- [ ] 5.3 Extract existing "管理员权限" controls (6 admin permission toggles) into a category render block, wrapped in CollapsibleSection
- [ ] 5.4 Extract existing "内容角色权限" controls (permissions matrix) into a category render block, wrapped in CollapsibleSection
- [ ] 5.5 Extract existing "邮件通知" controls (5 email toggles + edit buttons + seed button) into a category render block, wrapped in CollapsibleSection(s)
- [ ] 5.6 Extract existing "差旅赞助" controls (toggle + threshold inputs) into a category render block, wrapped in CollapsibleSection
- [ ] 5.7 Extract existing "邀请设置" controls (expiry day selector) into a category render block, wrapped in CollapsibleSection
- [ ] 5.8 Extract existing "超级管理员" controls (transfer section) into a category render block, wrapped in CollapsibleSection
- [ ] 5.9 Add conditional rendering: only render the active category's content based on `activeCategory` state

## Task 6: Update section card styles for visual hierarchy

- [ ] 6.1 Update CollapsibleSection card styles to use `--bg-surface`, `--card-border`, `--radius-md` per design system
- [ ] 6.2 Add category title styles using `--font-display` with appropriate heading size
- [ ] 6.3 Ensure consistent spacing between sections using `--space-4` / `--space-5`
- [ ] 6.4 Verify all text hierarchy uses `--text-primary` for labels, `--text-secondary` for descriptions, `--text-tertiary` for hints

## Task 7: Verify functional preservation and test

- [ ] 7.1 Manually verify all toggle controls still trigger correct API calls (feature toggles, admin permissions, email notifications, travel sponsorship)
- [ ] 7.2 Manually verify permissions matrix toggle behavior is preserved
- [ ] 7.3 Manually verify email template editor modal opens/closes correctly from each email toggle's edit button
- [ ] 7.4 Manually verify travel sponsorship threshold input validation and blur-save behavior
- [ ] 7.5 Manually verify invite expiry day selector behavior
- [ ] 7.6 Manually verify SuperAdmin transfer flow (user selection, password input, transfer API call)
- [ ] 7.7 Manually verify auth guards still redirect non-authenticated and non-SuperAdmin users
- [ ] 7.8 Verify responsive layout: sidebar on desktop ≥768px, horizontal tabs on mobile <768px
- [ ] 7.9 Verify `prefers-reduced-motion` disables collapse/expand animations
