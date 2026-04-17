# Implementation Plan: Settings Page UI/UX Polish

## Overview

Apply visual refinements to the admin settings page (`settings.tsx` + `settings.scss`) to match the quality of the redesigned admin dashboard. All changes are confined to these two files — no new files, no backend changes. The implementation replaces emoji icons with SVG components, polishes the toolbar header, converts toggle items to a flat list layout, adds modal backdrop blur, and applies three-tier responsive padding.

## Tasks

- [x] 1. Update icon imports and SETTINGS_CATEGORIES configuration in settings.tsx
  - Import `SettingsIcon`, `KeyIcon`, `ProfileIcon`, `MailIcon`, `LocationIcon`, `GiftIcon`, `AdminIcon`, `ArrowLeftIcon` from `../../components/icons`
  - Change `CategoryConfig.icon` type from `string` to `React.ComponentType<{ size: number; color: string }>` (matching `DashboardCategory` pattern from `index.tsx`)
  - Update all 7 entries in `SETTINGS_CATEGORIES` to use SVG icon components instead of emoji strings:
    - `feature-toggles` → `SettingsIcon`
    - `admin-permissions` → `KeyIcon`
    - `content-roles` → `ProfileIcon`
    - `email-notifications` → `MailIcon`
    - `travel-sponsorship` → `LocationIcon`
    - `invite-settings` → `GiftIcon`
    - `superadmin` → `AdminIcon`
  - _Requirements: 1.1, 1.2, 1.5_

- [x] 2. Update CategoryNav component to render SVG icon components
  - Change the icon rendering from `<Text className='category-nav__icon'>{cat.icon}</Text>` to instantiating the icon component: `const IconComp = cat.icon; <View className='category-nav__icon'><IconComp size={18} color={isActive ? 'var(--text-inverse)' : 'var(--text-secondary)'} /></View>`
  - Use `<View>` wrapper instead of `<Text>` for the icon container (SVG components need a View host)
  - Pass dynamic `color` prop: `var(--text-secondary)` for default state, `var(--text-inverse)` for active state
  - Match the `DashboardCategoryNav` rendering pattern from `index.tsx`
  - _Requirements: 1.3, 1.4, 1.6, 7.1_

- [x] 3. Update toolbar JSX to use ArrowLeftIcon and pill-shaped back button
  - Replace the plain text back button with a pill-shaped button containing `<ArrowLeftIcon size={16} color='var(--accent-primary)' />` alongside the text label
  - Add `admin-settings__back-text` className to the text element inside the back button
  - Keep the existing `handleBack` onClick handler and `t('admin.settings.backButton')` text
  - _Requirements: 2.1, 2.3, 2.5_

- [x] 4. Checkpoint — Verify TSX changes compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update toolbar SCSS styles for gradient header and pill-shaped back button
  - Change `.admin-settings__toolbar` background from `var(--bg-surface)` to `linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)`
  - Style `.admin-settings__back` as pill-shaped: `display: inline-flex`, `align-items: center`, `gap: var(--space-2)`, `padding: var(--space-2) var(--space-3)`, `background: var(--bg-elevated)`, `border: 1px solid var(--card-border)`, `border-radius: var(--radius-md)`, `color: var(--accent-primary)`, hover state with `--bg-hover`
  - Add `.admin-settings__back-text` styles: `font-family: var(--font-body)`, `font-size: var(--text-body-sm)`, `font-weight: 500`, `color: var(--accent-primary)`
  - Update `.admin-settings__title` to use `font-size: var(--text-h3)` (was `--text-body-lg`)
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

- [x] 6. Update category navigation SCSS styles to match dashboard pattern
  - Update `.category-nav` padding from `var(--space-4)` to `var(--space-3)`, min-width from `200px` to `220px`
  - Update `.category-nav__icon` to use `display: flex`, `align-items: center`, `justify-content: center` (replacing the emoji text styling)
  - Update `.category-nav__label` font-size from `var(--text-body)` to `var(--text-body-sm)` to match dashboard
  - Ensure `.category-nav__item--active` uses `background: var(--accent-primary)` and active hover stays on `--accent-primary`
  - _Requirements: 7.1, 7.2_

- [x] 7. Update toggle item SCSS for flat list layout with dividers
  - Remove individual card styling from `.toggle-item`: set `background: transparent`, `border-radius: 0`, remove left/right/top borders
  - Add `border-bottom: 1px solid var(--card-border)` as divider between items
  - Remove bottom border on last child: `&:last-child { border-bottom: none; }`
  - Add hover feedback: `&:hover { background: var(--bg-hover); }`
  - Change hover from `border-color` change to `background-color` change
  - _Requirements: 3.1, 3.5, 3.6_

- [x] 8. Update content area category title and collapsible section SCSS
  - Update `.settings-content__category-title` font-size from `var(--text-body-lg)` to `var(--text-h3)`, add `margin-bottom: var(--space-5)` (was `--space-2`)
  - Verify collapsible section spacing matches requirements: `--space-4` vertical / `--space-5` horizontal padding on header, `--transition-fast` on chevron and content
  - _Requirements: 7.3, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9. Update email template modal SCSS for backdrop blur and sizing refinements
  - Add `backdrop-filter: blur(4px)` to `.template-editor-overlay`
  - Add `box-shadow: var(--shadow-lg)` to `.template-editor`
  - Change `.template-editor` max-height from `90vh` to `85vh`
  - Update `.template-editor__header` padding to `var(--space-5)`
  - Update `.template-editor__title` font-size from `var(--text-body-lg)` to `var(--text-h3)`
  - Update `.template-editor__close` dimensions from `28px` to `32px`, add `&:hover { background: var(--bg-hover); color: var(--text-primary); }`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.9_

- [x] 10. Update responsive breakpoints for three-tier padding
  - Mobile (`max-width: 767px`): Change `.settings-content` padding from `var(--space-4)` to `var(--space-3)`, add `.category-nav` background `var(--bg-surface)`, add `.template-editor-overlay` padding `var(--space-3)`, add `.template-editor` max-width `100%`, add `.permissions-matrix` overflow-x auto with min-width `480px` on header/row
  - Add tablet breakpoint (`min-width: 768px` and `max-width: 1023px`): `.settings-content` padding `var(--space-4)`
  - Add desktop breakpoint (`min-width: 1024px`): `.settings-content` padding `var(--space-6)`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 11. Add prefers-reduced-motion rules for new transitions
  - Add to existing `@media (prefers-reduced-motion: reduce)` block: `.admin-settings__back { transition: none; }`, `.category-nav__item { transition: none; }`, `.toggle-item { transition: none; }`, `.permissions-matrix__row { transition: none; }`, `.template-editor-overlay { backdrop-filter: none; }`
  - _Requirements: 10.7, 11.2_

- [x] 12. Final checkpoint — Verify all changes compile and visual consistency
  - Ensure all tests pass, ask the user if questions arise.
  - Verify no hardcoded color values, pixel-based spacing (outside media queries), or inline styles for design tokens were introduced
  - Verify all CSS variables used exist in the design system (`app.scss`)
  - _Requirements: 9.1–9.10, 10.1, 10.2_

## Notes

- All changes are confined to `settings.tsx` and `settings.scss` — no new files
- No backend changes, no API changes, no data model changes
- The design has no Correctness Properties section — PBT is not applicable for this pure UI/UX polish
- All existing functionality (toggles, permissions matrix, email template editor, travel sponsorship, invite settings, SuperAdmin transfer) is preserved identically
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
