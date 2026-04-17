# Requirements Document

## Introduction

The admin dashboard page (`packages/frontend/src/pages/admin/index.tsx`) currently renders all 15 navigation cards in a single flat scrolling list. This makes it difficult to locate specific admin functions quickly, especially as the number of admin modules has grown. This feature redesigns the admin dashboard UI by reorganizing the 15 navigation cards into 6 logical category groups with sidebar/tab-based navigation, collapsible sections, and clear visual hierarchy — following the same approach successfully applied in the settings-panel-redesign. All existing navigation behavior, feature toggle gating, and role-based visibility are preserved. No backend changes are required.

## Glossary

- **Admin_Dashboard**: The admin landing page at `packages/frontend/src/pages/admin/index.tsx` that displays navigation cards for all admin functions
- **Admin_Category**: A top-level logical group of related admin navigation cards (e.g., "商品管理", "用户管理")
- **Category_Navigation**: A sidebar or tab-based navigation component that allows switching between Admin_Categories
- **Navigation_Card**: A clickable card element that navigates to a specific admin sub-page, displaying an icon, title, and description
- **Collapsible_Section**: A visual container within an Admin_Category that can be expanded or collapsed to show or hide its Navigation_Cards
- **Feature_Toggle**: A server-side boolean flag that controls whether a specific admin function is visible (fetched from `/api/settings/feature-toggles`)
- **Admin_Permission_Key**: A feature toggle key that gates admin-level access to a specific function (e.g., `adminProductsEnabled`, `adminOrdersEnabled`)
- **SuperAdmin_Only**: A visibility constraint that restricts a Navigation_Card to users with the `SuperAdmin` role
- **ADMIN_LINKS**: The existing array of 15 navigation link configurations defined in `index.tsx`
- **Design_System**: The project's CSS variable system defined in `app.scss` (colors, spacing, typography, radius, transitions)

## Requirements

### Requirement 1: Category-Based Navigation

**User Story:** As an admin, I want the dashboard organized into navigable categories, so that I can quickly find the specific admin function I need without scrolling through a long flat list.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL display a Category_Navigation component that lists all available Admin_Categories
2. WHEN an admin clicks a category in the Category_Navigation, THE Admin_Dashboard SHALL display only the Navigation_Cards belonging to that selected Admin_Category
3. THE Category_Navigation SHALL visually indicate the currently active Admin_Category using the Design_System accent color (`--accent-primary`)
4. THE Admin_Dashboard SHALL default to displaying the first Admin_Category ("商品管理") on initial load
5. THE Category_Navigation SHALL remain visible and accessible while viewing any Admin_Category
6. THE Category_Navigation SHALL use SVG icons alongside text labels to improve scannability

### Requirement 2: Admin Category Organization

**User Story:** As an admin, I want related admin functions grouped into logical categories, so that the dashboard is easier to understand and navigate.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL organize Navigation_Cards into the following Admin_Categories:
   - "商品管理" (Product Management): products, codes, email-products
   - "订单管理" (Order Management): orders, claims
   - "用户管理" (User Management): users, invites
   - "内容管理" (Content Management): content, categories, tags, email-content
   - "运营工具" (Operations): batch-points, batch-history, travel
   - "系统设置" (System Settings): settings
2. EACH Admin_Category SHALL display a category title using the Design_System display font (`--font-display`) with appropriate heading size
3. EACH Admin_Category SHALL contain one or more Collapsible_Sections that group closely related Navigation_Cards

### Requirement 3: Visual Hierarchy and Card Design

**User Story:** As an admin, I want clear visual separation between different admin function groups, so that I can scan the dashboard quickly and understand the structure at a glance.

#### Acceptance Criteria

1. EACH Navigation_Card SHALL be rendered with the Design_System surface background (`--bg-surface`), border (`--card-border`), and border-radius (`--radius-md`)
2. EACH Navigation_Card SHALL display an SVG icon, a title in `--text-primary`, and a description in `--text-secondary`
3. THE Admin_Dashboard SHALL use consistent spacing between Navigation_Cards using the Design_System spacing variables (`--space-3` or `--space-4`)
4. WHEN an admin hovers over a Navigation_Card, THE Navigation_Card SHALL provide visual feedback using border color transition and subtle horizontal translation within 150–300ms
5. EACH Navigation_Card SHALL use `cursor: pointer` to indicate interactivity
6. EACH Navigation_Card SHALL display a directional arrow indicator to signal navigability

### Requirement 4: Collapsible Sections Within Categories

**User Story:** As an admin, I want to collapse sections within a category that I am not currently interested in, so that I can reduce visual clutter.

#### Acceptance Criteria

1. EACH Collapsible_Section within an Admin_Category SHALL support expand and collapse behavior
2. WHEN an admin clicks the Collapsible_Section header, THE Collapsible_Section SHALL toggle between expanded and collapsed states
3. WHILE a Collapsible_Section is collapsed, THE Collapsible_Section SHALL display only the section header with a chevron icon pointing right
4. WHILE a Collapsible_Section is expanded, THE Collapsible_Section SHALL display the full section content with a chevron icon pointing down
5. THE Collapsible_Section expand/collapse animation SHALL use the Design_System transition timing (`--transition-fast`)
6. ALL Collapsible_Sections SHALL default to expanded state on initial category load

### Requirement 5: Functional Preservation — Navigation and Routing

**User Story:** As an admin, I want all existing navigation cards to work exactly as before after the redesign, so that no admin functionality is lost or broken.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL preserve all 15 Navigation_Cards from the existing ADMIN_LINKS array with identical `navigateTo` URL routing
2. EACH Navigation_Card SHALL use the same icon component, title i18n key, and description i18n key as defined in the existing ADMIN_LINKS configuration
3. THE Admin_Dashboard SHALL preserve the existing authentication guard that redirects non-authenticated users to the login page
4. THE Admin_Dashboard SHALL preserve the existing role-based access guard that redirects non-Admin/non-SuperAdmin users to the home page
5. THE Admin_Dashboard SHALL preserve the existing OrderAdmin redirect behavior that sends OrderAdmin users directly to the orders page

### Requirement 6: Functional Preservation — Feature Toggle Gating

**User Story:** As an admin, I want feature-toggle-gated and role-restricted navigation cards to remain correctly hidden or shown based on server configuration and user roles, so that access control is maintained.

#### Acceptance Criteria

1. WHEN a Feature_Toggle is disabled, THE Admin_Dashboard SHALL hide the corresponding Navigation_Card for non-SuperAdmin users
2. WHEN a Navigation_Card has a `featureToggleKey` and that toggle is `false`, THE Admin_Dashboard SHALL hide that Navigation_Card for all users
3. WHEN a Navigation_Card has a `superAdminOnly` flag, THE Admin_Dashboard SHALL display that card only to users with the `SuperAdmin` role
4. THE Admin_Dashboard SHALL fetch feature toggles from `/api/settings/feature-toggles` on page load
5. IF the feature toggle API request fails, THEN THE Admin_Dashboard SHALL default to showing all Navigation_Cards as a safe degradation strategy
6. WHEN all Navigation_Cards within an Admin_Category are hidden due to feature toggles or role restrictions, THE Admin_Dashboard SHALL hide that entire Admin_Category from the Category_Navigation

### Requirement 7: Design System Compliance

**User Story:** As a developer, I want the redesigned admin dashboard to use the project's existing Design_System exclusively, so that the page is visually consistent with the rest of the application.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL use only CSS variables from the Design_System for all colors, spacing, typography, border-radius, and transitions
2. THE Admin_Dashboard SHALL not introduce any hardcoded color values, pixel-based spacing, or inline styles for design tokens
3. THE Admin_Dashboard SHALL use `--font-display` (Outfit) for category titles and section headers, and `--font-body` (Noto Sans SC) for card labels, descriptions, and body text
4. THE Admin_Dashboard SHALL use the existing icon components (`PackageIcon`, `TicketIcon`, `ProfileIcon`, etc.) from `../../components/icons` rather than emoji characters
5. THE Admin_Dashboard SHALL support the `prefers-reduced-motion` media query by disabling animations and transitions when the user prefers reduced motion

### Requirement 8: Responsive Layout

**User Story:** As an admin, I want the dashboard to be usable on different screen sizes, so that I can manage admin functions from various devices.

#### Acceptance Criteria

1. WHILE the viewport width is 768px or wider, THE Category_Navigation SHALL be displayed as a vertical sidebar on the left side of the Admin_Dashboard
2. WHILE the viewport width is below 768px, THE Category_Navigation SHALL be displayed as a horizontal scrollable tab bar at the top of the Admin_Dashboard
3. THE Admin_Dashboard content area SHALL fill the remaining width beside the sidebar on wider viewports
4. THE horizontal tab bar SHALL support touch-based horizontal scrolling with hidden scrollbar styling
5. THE Admin_Dashboard SHALL maintain readable card layouts and appropriate padding at viewport widths of 375px, 768px, and 1024px
