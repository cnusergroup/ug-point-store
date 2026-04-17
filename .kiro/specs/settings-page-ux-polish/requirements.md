# Requirements Document

## Introduction

The admin settings page (`packages/frontend/src/pages/admin/settings.tsx` + `settings.scss`) was previously redesigned with category sidebar navigation, collapsible sections, and toggle items. However, it still needs UI/UX polish to match the quality of the recently redesigned admin dashboard (`packages/frontend/src/pages/admin/index.tsx`). This feature applies visual refinements across the entire settings page — replacing emoji icons with SVG icon components, polishing the toolbar/header, improving toggle item visual hierarchy and spacing, refining the permissions matrix table, improving the email template editor modal styling, enhancing mobile responsive layout, and ensuring overall visual consistency with the admin dashboard redesign.

This is a pure frontend UI/UX polish — no backend changes, no new API endpoints, no data model changes. All existing functionality (toggles, permissions matrix, email template editor, travel sponsorship, invite settings, SuperAdmin transfer) is preserved identically. Only `settings.tsx` and `settings.scss` are modified.

## Glossary

- **Settings_Page**: The SuperAdmin settings page at `packages/frontend/src/pages/admin/settings.tsx`
- **Settings_Toolbar**: The top bar of the Settings_Page containing a back button, page title, and optional trailing element
- **Category_Navigation**: The sidebar (desktop) or horizontal tab bar (mobile) component that lists the 7 settings categories
- **Category_Icon**: The icon displayed alongside each category label in the Category_Navigation
- **Collapsible_Section**: A card container within a category that can be expanded or collapsed to show or hide its controls
- **Toggle_Item**: A single switch control with label and description text, rendered within a Collapsible_Section
- **Permissions_Matrix**: The grid of role (Speaker/UserGroupLeader/Volunteer) × permission (canAccess/canUpload/canDownload/canReserve) switches
- **Email_Template_Modal**: The modal dialog for editing email notification templates with locale tabs, subject/body fields, and variable reference
- **Transfer_Section**: The SuperAdmin transfer form with user selector, password input, and confirmation button
- **Design_System**: The project's CSS variable system defined in `app.scss` (colors, spacing, typography, radius, transitions, shadows)
- **SVG_Icon_Component**: A React component from `packages/frontend/src/components/icons/` that renders an SVG icon with configurable `size` and `color` props
- **Admin_Dashboard**: The recently redesigned admin dashboard page at `packages/frontend/src/pages/admin/index.tsx` that serves as the visual quality reference

## Requirements

### Requirement 1: Replace Emoji Icons with SVG Icon Components

**User Story:** As a SuperAdmin, I want the settings category navigation to use consistent SVG icons instead of emoji characters, so that the page looks professional and visually consistent with the admin dashboard.

#### Acceptance Criteria

1. THE Category_Navigation SHALL use SVG_Icon_Components from `packages/frontend/src/components/icons/` for all 7 category icons instead of emoji characters
2. THE Category_Navigation SHALL map categories to the following SVG_Icon_Components:
   - "功能开关" (Feature Toggles): `SettingsIcon`
   - "管理员权限" (Admin Permissions): `KeyIcon`
   - "内容角色权限" (Content Role Permissions): `ProfileIcon`
   - "邮件通知" (Email Notifications): `MailIcon`
   - "差旅赞助" (Travel Sponsorship): `LocationIcon`
   - "邀请设置" (Invite Settings): `GiftIcon`
   - "超级管理员" (SuperAdmin): `AdminIcon`
3. EACH Category_Icon SHALL render at size 18 with color `var(--text-secondary)` in the default state
4. WHILE a category is active, THE Category_Icon SHALL render with color `var(--text-inverse)` to match the active item text color
5. THE `SETTINGS_CATEGORIES` configuration SHALL store icon references as React component types (matching the `DashboardCategory` pattern from the Admin_Dashboard) instead of emoji strings
6. THE `CategoryNav` component SHALL accept and render SVG_Icon_Components using the same pattern as `DashboardCategoryNav` in the Admin_Dashboard

### Requirement 2: Polish the Settings Toolbar/Header

**User Story:** As a SuperAdmin, I want the settings page toolbar to look polished and consistent with the admin dashboard header, so that the page feels cohesive with the rest of the admin experience.

#### Acceptance Criteria

1. THE Settings_Toolbar back button SHALL be styled as a pill-shaped button with `--bg-elevated` background, `--card-border` border, `--radius-md` border-radius, and `--accent-primary` text color
2. WHEN a SuperAdmin hovers over the back button, THE back button SHALL transition to `--bg-hover` background using `--transition-fast` timing
3. THE Settings_Toolbar back button SHALL include an `ArrowLeftIcon` SVG_Icon_Component alongside the text label for clear directional affordance
4. THE Settings_Toolbar title SHALL use `--font-display` at `--text-h3` size with font-weight 700 and `--text-primary` color
5. THE Settings_Toolbar SHALL use a gradient background from `--bg-surface` to `--bg-elevated` (matching the Admin_Dashboard header pattern) with a bottom border of `--card-border`
6. THE Settings_Toolbar SHALL use consistent padding with `--space-5` horizontal and `--space-4` vertical spacing

### Requirement 3: Improve Toggle Item Visual Hierarchy and Spacing

**User Story:** As a SuperAdmin, I want toggle items to have better visual hierarchy with clear label/description separation and comfortable spacing, so that I can scan and manage settings efficiently.

#### Acceptance Criteria

1. EACH Toggle_Item within a Collapsible_Section SHALL be rendered without individual card borders, using a flat list layout with `--card-border` dividers between items instead of separate bordered cards
2. EACH Toggle_Item label SHALL use `--font-body` at `--text-body` size with font-weight 600 and `--text-primary` color
3. EACH Toggle_Item description SHALL use `--font-body` at `--text-body-sm` size with `--text-secondary` color and line-height 1.4
4. THE spacing between Toggle_Item label and description SHALL be `--space-1`
5. THE spacing between consecutive Toggle_Items SHALL be consistent, using `--space-4` padding on each item with `--card-border` bottom border on all items except the last
6. EACH Toggle_Item SHALL provide subtle hover feedback using `--bg-hover` background transition with `--transition-fast` timing
7. THE toggle switch SHALL be vertically centered relative to the Toggle_Item label text

### Requirement 4: Refine the Permissions Matrix Table

**User Story:** As a SuperAdmin, I want the permissions matrix to be visually refined with clear column headers, row separation, and consistent alignment, so that I can quickly understand and modify role permissions.

#### Acceptance Criteria

1. THE Permissions_Matrix header row SHALL use `--bg-elevated` background with `--font-body` at `--text-body-sm` size, font-weight 600, and `--text-secondary` color for column labels
2. THE Permissions_Matrix header row SHALL have a bottom border of `--card-border` to separate it from data rows
3. EACH Permissions_Matrix data row SHALL have a bottom border of `--card-border` with the last row having no bottom border
4. EACH Permissions_Matrix data row SHALL provide subtle hover feedback using `--bg-hover` background transition with `--transition-fast` timing
5. THE Permissions_Matrix role labels SHALL use `--font-body` at `--text-body-sm` size with font-weight 600 and `--text-primary` color
6. THE Permissions_Matrix permission column headers SHALL be center-aligned, and the switch controls in data rows SHALL be center-aligned within their columns
7. THE Permissions_Matrix SHALL have consistent internal padding using `--space-3` vertical and `--space-4` horizontal on each row
8. THE Permissions_Matrix container SHALL use `--bg-surface` background, `--card-border` border, and `--radius-md` border-radius with `overflow: hidden`

### Requirement 5: Improve Email Template Editor Modal Styling

**User Story:** As a SuperAdmin, I want the email template editor modal to have polished styling with clear visual hierarchy, so that editing email templates feels smooth and professional.

#### Acceptance Criteria

1. THE Email_Template_Modal overlay SHALL use a backdrop blur effect (`backdrop-filter: blur(4px)`) in addition to the semi-transparent dark background for a modern glass effect
2. THE Email_Template_Modal container SHALL use `--bg-surface` background, `--radius-lg` border-radius, and `--shadow-lg` box-shadow for elevated appearance
3. THE Email_Template_Modal header SHALL use `--font-display` at `--text-h3` size for the title with `--space-5` padding and a `--card-border` bottom border
4. THE Email_Template_Modal close button SHALL be a 32×32 rounded button with `--radius-sm` border-radius, `--text-tertiary` color, transitioning to `--bg-hover` background and `--text-primary` color on hover
5. THE Email_Template_Modal locale tabs SHALL use `--radius-sm` border-radius with `--accent-primary` background for the active tab and `--bg-hover` background on hover for inactive tabs
6. THE Email_Template_Modal subject input and body textarea SHALL use `--bg-base` background with `--card-border` border, transitioning to `--accent-primary` border on focus
7. THE Email_Template_Modal variable reference tags SHALL use `--accent-primary` tinted background with `--font-mono` font and `--radius-sm` border-radius
8. THE Email_Template_Modal footer save button SHALL use the global `.btn-primary` styling pattern with `--accent-primary` background, and the cancel button SHALL use `--text-secondary` color with `--bg-hover` background on hover
9. THE Email_Template_Modal SHALL have a maximum height of `85vh` with scrollable body content to prevent overflow on smaller screens

### Requirement 6: Enhance Mobile Responsive Layout

**User Story:** As a SuperAdmin, I want the settings page to be comfortable and usable on mobile devices, so that I can manage settings from any screen size.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Category_Navigation SHALL be displayed as a horizontal scrollable tab bar with hidden scrollbar, touch-based scrolling, and `--bg-surface` background with `--card-border` bottom border
2. WHILE the viewport width is below 768px, THE Category_Navigation items SHALL use compact padding (`--space-2` vertical, `--space-3` horizontal) with `flex-shrink: 0` to prevent text wrapping
3. WHILE the viewport width is below 768px, THE settings content area SHALL use `--space-3` padding instead of `--space-5`
4. WHILE the viewport width is below 768px, THE Permissions_Matrix SHALL support horizontal scrolling with a minimum width to prevent column compression, and the role column SHALL remain readable
5. WHILE the viewport width is below 768px, THE Email_Template_Modal SHALL use full-width layout with `--space-3` outer padding and reduced internal padding
6. WHILE the viewport width is between 768px and 1023px, THE settings content area SHALL use `--space-4` padding
7. WHILE the viewport width is 1024px or wider, THE settings content area SHALL use `--space-6` padding for generous spacing
8. THE Settings_Toolbar SHALL maintain proper alignment and spacing across all viewport widths

### Requirement 7: Visual Consistency with Admin Dashboard

**User Story:** As a SuperAdmin, I want the settings page to feel visually cohesive with the admin dashboard, so that navigating between admin pages feels seamless.

#### Acceptance Criteria

1. THE Category_Navigation sidebar SHALL use the same styling pattern as `DashboardCategoryNav` in the Admin_Dashboard: `--space-3` padding, `--radius-md` border-radius on items, `--accent-primary` background for active items, and `--bg-hover` background on hover for inactive items
2. THE Category_Navigation item labels SHALL use `--font-body` at `--text-body-sm` size with font-weight 500, matching the Admin_Dashboard category nav label styling
3. THE settings content area category title SHALL use `--font-display` at `--text-h3` size with font-weight 700 and `--text-primary` color, with `--space-5` bottom margin, matching the Admin_Dashboard content title styling
4. THE Collapsible_Section card styling SHALL match the Admin_Dashboard pattern: `--bg-surface` background, `--card-border` border, `--radius-md` border-radius, with `--card-border-hover` border on hover
5. THE Collapsible_Section chevron SHALL use `--text-tertiary` color with `--transition-fast` rotation animation (0° collapsed → 90° expanded)
6. THE Settings_Page SHALL use `--bg-base` as the page background color, matching the Admin_Dashboard page background
7. THE Settings_Page layout SHALL use the same CSS Grid pattern as the Admin_Dashboard: `grid-template-columns: 220px 1fr` on desktop with `min-height: calc(100vh - toolbar-height)`

### Requirement 8: Collapsible Section Content Spacing

**User Story:** As a SuperAdmin, I want consistent and comfortable spacing within collapsible sections, so that the content feels well-organized and not cramped.

#### Acceptance Criteria

1. THE Collapsible_Section header SHALL use `--space-4` vertical and `--space-5` horizontal padding with `--bg-hover` background on hover
2. THE Collapsible_Section title SHALL use `--font-display` at `--text-body` size with font-weight 700 and `--text-primary` color
3. THE Collapsible_Section description SHALL use `--font-body` at `--text-body-sm` size with `--text-secondary` color and line-height 1.4
4. THE Collapsible_Section expanded content area SHALL use `--space-4` padding on all sides with `--transition-fast` max-height animation
5. THE spacing between consecutive Collapsible_Sections within a category SHALL be `--space-4`
6. ALL Collapsible_Sections SHALL default to expanded state on initial category load

### Requirement 9: Functional Preservation

**User Story:** As a SuperAdmin, I want all existing settings controls to work exactly as before after the UI polish, so that no functionality is lost.

#### Acceptance Criteria

1. THE Settings_Page SHALL preserve all existing Toggle_Item controls with identical switch behavior and API calls for feature toggles and admin permissions
2. THE Settings_Page SHALL preserve the Permissions_Matrix with identical role × permission toggle behavior and API calls
3. THE Settings_Page SHALL preserve all five email notification toggles with their "编辑模板" buttons that open the Email_Template_Modal
4. THE Settings_Page SHALL preserve the Email_Template_Modal with identical locale tab switching, subject/body editing, validation, save API call, and variable reference display
5. THE Settings_Page SHALL preserve the email template seed button with identical API call behavior
6. THE Settings_Page SHALL preserve the travel sponsorship toggle and threshold input fields with identical validation and blur-save behavior
7. THE Settings_Page SHALL preserve the invite expiry day selector (1/3/7 days) with identical selection behavior and API call
8. THE Settings_Page SHALL preserve the Transfer_Section with identical user selection, password input, validation, and transfer API call behavior
9. THE Settings_Page SHALL preserve the existing authentication and role-based access guards (redirect non-authenticated and non-SuperAdmin users)
10. THE Settings_Page SHALL preserve the existing category navigation state management (activeCategory, collapsedSections) with identical behavior

### Requirement 10: Design System Compliance

**User Story:** As a developer, I want the polished settings page to use the project's existing Design_System exclusively, so that the page is visually consistent and maintainable.

#### Acceptance Criteria

1. THE Settings_Page SHALL use only CSS variables from the Design_System for all colors, spacing, typography, border-radius, shadows, and transitions
2. THE Settings_Page SHALL not introduce any hardcoded color values, pixel-based spacing outside of responsive breakpoint media queries, or inline styles for design tokens
3. THE Settings_Page SHALL use `--font-display` (Outfit) for the toolbar title, category titles, section headers, and numeric display values
4. THE Settings_Page SHALL use `--font-body` (Noto Sans SC) for toggle labels, descriptions, form inputs, and body text
5. THE Settings_Page SHALL use `--font-mono` (JetBrains Mono) for email template variable tags and the template body textarea
6. THE Settings_Page SHALL use the global button styling patterns (`.btn-primary` pattern for primary actions, `.btn-danger` pattern for destructive actions) where applicable
7. THE Settings_Page SHALL support the `prefers-reduced-motion` media query by disabling all animations and transitions (chevron rotation, hover transitions, collapse animation, modal backdrop) when the user prefers reduced motion

### Requirement 11: Accessibility and Keyboard Navigation

**User Story:** As a SuperAdmin using keyboard navigation or assistive technology, I want the settings page to be accessible and respect my preferences, so that I can manage settings effectively.

#### Acceptance Criteria

1. ALL interactive elements (category nav items, collapsible section headers, toggle switches, buttons, form inputs) SHALL have visible focus states using the global `*:focus-visible` rule (`outline: 2px solid var(--accent-primary)` with `outline-offset: 2px`)
2. ALL hover animations and transitions SHALL be disabled when the user has `prefers-reduced-motion: reduce` enabled, inheriting from the global `app.scss` rule
3. THE Email_Template_Modal overlay SHALL be dismissible by clicking the overlay background area (existing behavior preserved)
4. ALL form inputs (threshold inputs, transfer password input, email template subject/body) SHALL have associated label text for screen reader accessibility
5. THE Permissions_Matrix header labels SHALL be visually associated with their corresponding data columns through consistent alignment
