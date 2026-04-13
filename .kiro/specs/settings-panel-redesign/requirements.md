# Requirements Document

## Introduction

The SuperAdmin settings page (`packages/frontend/src/pages/admin/settings.tsx`) currently renders all configuration items — feature toggles, admin permissions, content role permissions, email notifications, travel sponsorship, invite expiry, and SuperAdmin transfer — in a single long scrolling page. This makes it difficult to locate and manage specific settings. This feature redesigns the settings page UI/UX by reorganizing controls into logical, visually distinct groups with clear hierarchy, while preserving all existing functionality. No backend changes are required.

## Glossary

- **Settings_Page**: The SuperAdmin control panel page at `packages/frontend/src/pages/admin/settings.tsx`
- **Settings_Category**: A top-level logical group of related settings (e.g., "Feature Toggles", "Admin Permissions", "Email Notifications")
- **Category_Navigation**: A sidebar or tab-based navigation component that allows switching between Settings_Categories
- **Settings_Section**: A visually distinct card or panel within a Settings_Category that contains one or more related controls
- **Collapsible_Section**: A Settings_Section that can be expanded or collapsed by the user to show or hide its contents
- **Toggle_Item**: A single switch control with label and description text
- **Permissions_Matrix**: The grid of role × permission switches for content role permissions
- **Email_Template_Modal**: The existing modal dialog for editing email notification templates
- **Transfer_Section**: The SuperAdmin transfer form with user selector, password input, and confirmation button
- **Design_System**: The project's CSS variable system defined in `app.scss` (colors, spacing, typography, radius, transitions)

## Requirements

### Requirement 1: Category-Based Navigation

**User Story:** As a SuperAdmin, I want settings organized into navigable categories, so that I can quickly find and access the specific group of settings I need.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a Category_Navigation component that lists all available Settings_Categories
2. WHEN a SuperAdmin clicks a category in the Category_Navigation, THE Settings_Page SHALL display only the settings belonging to that selected Settings_Category
3. THE Category_Navigation SHALL visually indicate the currently active Settings_Category using the Design_System accent color (`--accent-primary`)
4. THE Settings_Page SHALL default to displaying the first Settings_Category on initial load
5. THE Category_Navigation SHALL remain visible and accessible while viewing any Settings_Category
6. THE Category_Navigation SHALL use icons alongside text labels to improve scannability

### Requirement 2: Settings Category Organization

**User Story:** As a SuperAdmin, I want related settings grouped into logical categories, so that the page is easier to understand and navigate.

#### Acceptance Criteria

1. THE Settings_Page SHALL organize settings into the following Settings_Categories:
   - "功能开关" (Feature Toggles): code redemption toggle, points claim toggle
   - "管理员权限" (Admin Permissions): products, orders, content review, categories, email products, email content permission toggles
   - "内容角色权限" (Content Role Permissions): the Permissions_Matrix for Speaker/UserGroupLeader/Volunteer roles
   - "邮件通知" (Email Notifications): five email notification toggles with template editor buttons, and the seed templates button
   - "差旅赞助" (Travel Sponsorship): travel sponsorship toggle and threshold inputs
   - "邀请设置" (Invite Settings): invite expiry day selector
   - "超级管理员" (SuperAdmin): SuperAdmin transfer section
2. EACH Settings_Category SHALL display a category title using the Design_System display font (`--font-display`) with appropriate heading size
3. EACH Settings_Category SHALL contain one or more Settings_Sections that group closely related controls

### Requirement 3: Visual Hierarchy and Section Design

**User Story:** As a SuperAdmin, I want clear visual separation between different settings groups, so that I can scan the page quickly and understand the structure at a glance.

#### Acceptance Criteria

1. EACH Settings_Section SHALL be rendered as a card with the Design_System surface background (`--bg-surface`), border (`--card-border`), and border-radius (`--radius-md`)
2. EACH Settings_Section SHALL include a section header with a title and optional description text
3. THE Settings_Page SHALL use consistent spacing between Settings_Sections using the Design_System spacing variables (`--space-4` or `--space-5`)
4. THE Settings_Page SHALL use the Design_System color variables for all text hierarchy: primary labels in `--text-primary`, descriptions in `--text-secondary`, and hints in `--text-tertiary`
5. WHEN a Settings_Section contains multiple Toggle_Items, THE Settings_Section SHALL render them as a grouped list within a single card rather than as separate cards

### Requirement 4: Collapsible Sections Within Categories

**User Story:** As a SuperAdmin, I want to collapse settings sections I am not currently editing, so that I can reduce visual clutter within a category.

#### Acceptance Criteria

1. EACH Settings_Section within a Settings_Category SHALL support expand and collapse behavior
2. WHEN a user clicks the Collapsible_Section header, THE Collapsible_Section SHALL toggle between expanded and collapsed states
3. WHILE a Collapsible_Section is collapsed, THE Collapsible_Section SHALL display only the section header with a visual indicator (chevron icon) pointing right
4. WHILE a Collapsible_Section is expanded, THE Collapsible_Section SHALL display the full section content with a visual indicator (chevron icon) pointing down
5. THE Collapsible_Section expand/collapse animation SHALL use the Design_System transition timing (`--transition-fast`)
6. ALL Collapsible_Sections SHALL default to expanded state on initial category load

### Requirement 5: Functional Preservation

**User Story:** As a SuperAdmin, I want all existing settings controls to work exactly as before after the redesign, so that no functionality is lost.

#### Acceptance Criteria

1. THE Settings_Page SHALL preserve all existing Toggle_Item controls with identical switch behavior and API calls
2. THE Settings_Page SHALL preserve the Permissions_Matrix with identical role × permission toggle behavior
3. THE Settings_Page SHALL preserve all five email notification toggles with their "编辑模板" (Edit Template) buttons that open the Email_Template_Modal
4. THE Settings_Page SHALL preserve the email template seed button with identical behavior
5. THE Settings_Page SHALL preserve the travel sponsorship toggle and threshold input fields with identical validation and blur-save behavior
6. THE Settings_Page SHALL preserve the invite expiry day selector (1/3/7 days) with identical selection behavior
7. THE Settings_Page SHALL preserve the Transfer_Section with identical user selection, password input, validation, and transfer API call behavior
8. THE Settings_Page SHALL preserve the existing authentication and role-based access guards (redirect non-authenticated and non-SuperAdmin users)

### Requirement 6: Design System Compliance

**User Story:** As a developer, I want the redesigned settings page to use the project's existing Design_System exclusively, so that the page is visually consistent with the rest of the application.

#### Acceptance Criteria

1. THE Settings_Page SHALL use only CSS variables from the Design_System for all colors, spacing, typography, border-radius, shadows, and transitions
2. THE Settings_Page SHALL not introduce any hardcoded color values, pixel-based spacing, or inline styles for design tokens
3. THE Settings_Page SHALL use `--font-display` for category titles and section headers, and `--font-body` for labels, descriptions, and body text
4. THE Settings_Page SHALL use the global button classes (`.btn-primary`, `.btn-secondary`, `.btn-danger`) defined in `app.scss` where applicable
5. THE Settings_Page SHALL support the `prefers-reduced-motion` media query by inheriting the global reduced-motion rule from `app.scss`

### Requirement 7: Responsive Layout

**User Story:** As a SuperAdmin, I want the settings page to be usable on different screen sizes, so that I can manage settings from various devices.

#### Acceptance Criteria

1. WHILE the viewport width is 768px or wider, THE Category_Navigation SHALL be displayed as a vertical sidebar on the left side of the Settings_Page
2. WHILE the viewport width is below 768px, THE Category_Navigation SHALL be displayed as a horizontal scrollable tab bar at the top of the Settings_Page
3. THE Settings_Page content area SHALL fill the remaining width beside the sidebar on wider viewports
4. THE Settings_Page SHALL maintain readable line lengths and appropriate padding on all supported viewport sizes
