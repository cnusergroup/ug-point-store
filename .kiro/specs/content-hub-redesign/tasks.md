# Implementation Plan: Content Hub UI Redesign

## Overview

Apply visual polish and design system compliance to the three content hub pages: content list (`packages/frontend/src/pages/content/index.tsx`), content detail (`packages/frontend/src/pages/content/detail.tsx`), and content upload (`packages/frontend/src/pages/content/upload.tsx`). This is a pure frontend SCSS refactor with minimal TSX changes (emoji-to-SVG icon replacement in the detail page stats bar). No backend changes, no new components, no new API endpoints. All existing functionality is preserved identically.

## Tasks

- [x] 1. Refine Content List Page card hover styles in `index.scss`
  - [x] 1.1 Update `.content-card` hover state to ensure `--card-border-hover` border color and `--shadow-card-hover` box-shadow are applied consistently across all breakpoints
    - Verify the existing hover rule uses design system variables (no hardcoded values)
    - Ensure the hover transition uses `--transition-fast` timing
    - _Requirements: 2.5, 2.6, 10.1_
  - [x] 1.2 Verify Content List Page stats icons use text symbols (not emoji) — confirm `♡`, `✎`, `⊞` are already non-emoji and no changes needed
    - The list page already uses text-based stat icons; this is a verification-only sub-task
    - _Requirements: 2.8_

- [x] 2. Checkpoint — Verify content list page compiles
  - Ensure the project compiles without errors after list page changes, ask the user if questions arise.

- [x] 3. Refine Content Detail Page header in `detail.scss`
  - [x] 3.1 Update `.detail-header` to add `gap: var(--space-4)` for consistent spacing between back button, title, and spacer
    - _Requirements: 4.2, 10.1_
  - [x] 3.2 Update `.detail-header__back` to add border, padding, and border-radius matching the upload page header back button style
    - Add `padding: var(--space-2) var(--space-3)`, `border-radius: var(--radius-md)`, `border: 1px solid var(--card-border)`
    - Add `flex-shrink: 0` to prevent back button from shrinking
    - Add `border-color: var(--card-border-hover)` on hover
    - _Requirements: 4.2, 10.1, 10.4_
  - [x] 3.3 Update `.detail-header__title` to add `flex: 1` and `text-align: center` for proper centering
    - _Requirements: 4.1, 10.3_
  - [x] 3.4 Update `.detail-header__spacer` to add `flex-shrink: 0` and adjust width to `72px` to match back button width for visual centering balance
    - _Requirements: 4.2_
  - [x] 3.5 Remove `justify-content: space-between` from `.detail-header` since gap + flex handles the layout
    - _Requirements: 4.2_

- [x] 4. Replace emoji stats icons with SVG icons in `detail.tsx`
  - [x] 4.1 Create inline SVG icon components (`HeartIcon`, `CommentIcon`, `ClipboardIcon`) in `detail.tsx` with `size` and `color` props
    - Use feather-style SVG paths as specified in the design document
    - Each icon accepts `size` (default 16) and `color` (default `currentColor`) props
    - _Requirements: 5.1, 10.1_
  - [x] 4.2 Replace the three emoji `Text` elements in the stats bar (`♥`, `💬`, `📋`) with the new SVG icon components
    - `♥` → `<HeartIcon size={16} color="var(--error)" />` for likes
    - `💬` → `<CommentIcon size={16} color="currentColor" />` for comments
    - `📋` → `<ClipboardIcon size={16} color="currentColor" />` for reservations
    - _Requirements: 5.1, 5.2, 10.1_
  - [x] 4.3 Update `.detail-stats__icon` in `detail.scss` to support SVG sizing — ensure the icon container uses `display: inline-flex`, `align-items: center` for proper SVG alignment, and remove the `font-size` rule that only applies to text/emoji
    - _Requirements: 5.1, 5.2, 10.1_

- [x] 5. Checkpoint — Verify detail page compiles with SVG icons
  - Ensure the project compiles without errors after detail page header and SVG icon changes, ask the user if questions arise.

- [x] 6. Verify upload page requires no changes
  - [x] 6.1 Confirm `upload.scss` and `upload.tsx` are already fully aligned with the design system — no SCSS or TSX changes needed
    - The upload page header already has border/radius on back button, centered title, proper form field focus states, dashed file area, and responsive card layout
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4_

- [x] 7. Cross-cutting design system compliance verification
  - [x] 7.1 Verify all three content hub SCSS files use only CSS variables from `app.scss` for colors, spacing, typography, radius, shadows, and transitions — no hardcoded values
    - _Requirements: 10.1, 10.2_
  - [x] 7.2 Verify `--font-display` is used for page titles and numeric display values, and `--font-body` for labels, descriptions, and body text across all three pages
    - _Requirements: 10.3_
  - [x] 7.3 Verify global `.btn-primary`, `.btn-secondary`, and `.role-badge` classes are used directly without page-level redefinitions
    - _Requirements: 10.4_
  - [x] 7.4 Verify `prefers-reduced-motion` support is inherited from the global `app.scss` rule — no page-level overrides needed since the global rule covers all elements
    - _Requirements: 10.5, 12.2_

- [x] 8. Final checkpoint — Ensure all changes compile and existing functionality is preserved
  - Ensure the project compiles without errors, ask the user if questions arise.

- [x] 9. Manual verification of all three pages
  - [x] 9.1 Verify Content List Page: header displays correctly, category tab bar scrolls horizontally, tag cloud works, content cards show proper hover states with `--card-border-hover` and `--shadow-card-hover`, NEW badge pulses, stats use text icons (no emoji), single-column mobile / 2-column desktop grid, FAB visible
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 9.2 Verify Content Detail Page: back button has border/radius, title is centered, meta row displays uploader + role badge + category + date, stats bar uses SVG icons (no emoji), document preview iframe has border/radius, like button has liked/unliked states, comments section renders correctly with role badges and dividers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4_
  - [x] 9.3 Verify Content Upload Page: header with bordered back button, form fields with focus states, file upload area with dashed border, responsive card layout on desktop — all already correct, no changes made
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4_
  - [x] 9.4 Verify all existing functionality is preserved: category filtering, tag cloud filtering, infinite scroll, card navigation, like/reserve/download, comments, file upload, authentication guards, role-based permissions, i18n translations
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x] 9.5 Verify accessibility: focus-visible outlines on interactive elements (inherited from `app.scss`), `prefers-reduced-motion` disables animations, keyboard-navigable tab bar
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

## Notes

- This is a pure UI/UX visual redesign — no backend changes, no new API endpoints, no new components
- The content list page and upload page are already well-aligned with the design system — changes focus on the detail page
- The main code change is replacing emoji stat icons (`♥`, `💬`, `📋`) with inline SVG components in `detail.tsx`
- The detail page header gets border/radius/padding on the back button to match the upload page header style
- Property-based testing does not apply (no data transformations or business logic changes)
- The upload page requires no changes — it's already fully styled from the initial implementation
- All `prefers-reduced-motion` support is inherited from the global `app.scss` rule
- Each task references specific requirements for traceability
