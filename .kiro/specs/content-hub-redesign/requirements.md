# Requirements Document: Content Hub UI Redesign

## Introduction

The content hub (内容中心) consists of three user-facing pages: content list (`packages/frontend/src/pages/content/index.tsx`), content detail (`packages/frontend/src/pages/content/detail.tsx`), and content upload/edit (`packages/frontend/src/pages/content/upload.tsx`). While functionally complete, the current UI lacks visual polish, consistent hierarchy, and modern interaction patterns compared to the recently redesigned admin dashboard and settings panel. This feature redesigns all three content hub pages to improve visual hierarchy, card design, responsive layout, interaction patterns, and design system compliance — following the same approach applied in the admin-dashboard-redesign and settings-panel-redesign. This is a pure frontend UI/UX redesign: no backend changes, no new API endpoints, no data model changes. All existing functionality (upload, preview, comments, likes, reservations, permissions, i18n, role-based visibility) is preserved identically.

## Glossary

- **Content_List_Page**: The content listing page at `packages/frontend/src/pages/content/index.tsx` that displays approved content items with category tabs, tag cloud filter, and infinite scroll
- **Content_Detail_Page**: The content detail page at `packages/frontend/src/pages/content/detail.tsx` that displays full content information, document preview, actions (like/reserve/download), and comments
- **Content_Upload_Page**: The content upload/edit page at `packages/frontend/src/pages/content/upload.tsx` that provides a form for creating or editing content items
- **Content_Card**: A clickable card element in the Content_List_Page that displays a content item's title, category, tags, uploader, date, and stats
- **Category_Tab_Bar**: The horizontal scrollable tab bar that filters content by category
- **Tag_Cloud**: The tag-based filter component that allows filtering content by tags
- **Stats_Bar**: A horizontal bar displaying like count, comment count, and reservation count
- **Action_Bar**: The section containing reserve/download and like buttons on the Content_Detail_Page
- **Comment_Section**: The area on the Content_Detail_Page for viewing and submitting comments
- **Document_Preview**: The iframe-based preview area for PDF and Office documents
- **Upload_Form**: The form on the Content_Upload_Page containing title, description, category, file, video URL, and tags fields
- **Design_System**: The project's CSS variable system defined in `app.scss` (colors, spacing, typography, radius, transitions, shadows)
- **NEW_Badge**: A visual indicator on Content_Cards for content items created within the last 7 days
- **FAB**: Floating Action Button for quick access to the upload page

## Requirements

### Requirement 1: Content List Page — Header and Navigation Redesign

**User Story:** As a user, I want a polished and well-structured header on the content list page, so that navigation and primary actions are clear and accessible.

#### Acceptance Criteria

1. THE Content_List_Page header SHALL display a home/back button, a centered page title using `--font-display`, and an upload button (when permitted) in a sticky top bar with `--bg-void` background
2. WHEN the user has upload permission, THE Content_List_Page SHALL display the upload button with `--accent-primary` background, smooth hover state using `--accent-hover`, and active press feedback
3. THE Content_List_Page header SHALL use consistent padding from the Design_System spacing variables and align with the content container width at each breakpoint
4. THE Category_Tab_Bar SHALL display category tabs with clear active/inactive states, using `--text-primary` and `--accent-primary` underline indicator for the active tab and `--text-tertiary` for inactive tabs
5. THE Category_Tab_Bar SHALL support horizontal touch scrolling with hidden scrollbar styling on mobile viewports
6. THE Tag_Cloud component SHALL maintain its current filtering functionality with visual styling consistent with the Design_System

### Requirement 2: Content Card Redesign

**User Story:** As a user, I want content cards that are visually appealing and easy to scan, so that I can quickly identify interesting content.

#### Acceptance Criteria

1. EACH Content_Card SHALL be rendered with `--bg-surface` background, `--card-border` border, and `--radius-md` border-radius
2. EACH Content_Card SHALL display the content title in `--text-primary` with `--font-body` at appropriate weight, truncated with ellipsis for overflow
3. EACH Content_Card SHALL display the category as a pill-shaped tag using `--accent-primary` color with a subtle background tint
4. EACH Content_Card SHALL display uploader nickname, date, and stats (likes, comments, reservations) in `--text-secondary` or `--text-tertiary` with clear visual hierarchy
5. WHEN a user hovers over a Content_Card, THE Content_Card SHALL provide visual feedback using border color transition to `--card-border-hover` and elevated shadow within 150–300ms
6. EACH Content_Card SHALL use `cursor: pointer` to indicate interactivity
7. THE NEW_Badge SHALL be displayed on Content_Cards for items created within the last 7 days, using a contrasting accent color with subtle pulse animation
8. EACH Content_Card SHALL use SVG-based or text-based stat icons instead of emoji characters for likes, comments, and reservations
9. WHEN tags are present on a Content_Card, THE Content_Card SHALL display up to 3 tags as compact pill elements with `--bg-elevated` background

### Requirement 3: Content List Page — Responsive Layout

**User Story:** As a user, I want the content list to adapt well to different screen sizes, so that I can browse content comfortably on any device.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Content_List_Page SHALL display Content_Cards in a single-column layout with compact spacing
2. WHILE the viewport width is 768px or wider, THE Content_List_Page SHALL center the content container with a maximum width of 720px
3. WHILE the viewport width is 1024px or wider, THE Content_List_Page SHALL display Content_Cards in a two-column grid layout with a maximum container width of 960px
4. THE Content_List_Page SHALL maintain readable card layouts and appropriate padding at viewport widths of 375px, 768px, and 1024px
5. THE FAB SHALL be positioned at the bottom-right with safe area inset support, using `--accent-primary` background with glow shadow and scale feedback on hover/active

### Requirement 4: Content Detail Page — Information Hierarchy Redesign

**User Story:** As a user, I want the content detail page to present information in a clear, well-organized hierarchy, so that I can quickly understand the content and take actions.

#### Acceptance Criteria

1. THE Content_Detail_Page SHALL display the content title using `--font-display` or `--font-body` at `--text-h2` size with `--text-primary` color
2. THE Content_Detail_Page SHALL display uploader information (nickname, role badge, category, date) in a meta row with consistent spacing and visual hierarchy
3. THE Content_Detail_Page SHALL display the content description in `--text-secondary` with comfortable line-height (1.6–1.7) and proper word-break handling
4. WHEN tags are present, THE Content_Detail_Page SHALL display them as pill-shaped chips using `--accent-primary` tint with `--radius-full` border-radius
5. THE Content_Detail_Page SHALL use the global `.role-badge` classes from `app.scss` for uploader and commenter role badges without redefining badge styles
6. WHEN the current user is the content owner, THE Content_Detail_Page SHALL display the content status (pending/approved/rejected) with appropriate color coding using `--warning`, `--success`, and `--error` variables

### Requirement 5: Content Detail Page — Stats, Actions, and Preview Redesign

**User Story:** As a user, I want the stats bar, action buttons, and document preview to be visually polished and easy to interact with, so that I can engage with content smoothly.

#### Acceptance Criteria

1. THE Stats_Bar SHALL display like count, comment count, and reservation count with SVG-based or text-based icons instead of emoji characters, using `--font-display` for numeric values
2. THE Stats_Bar SHALL use consistent spacing and alignment with clear visual separation between stat items
3. THE Action_Bar SHALL display the reserve/download button using the global `.btn-primary` class and the like button with clear liked/unliked visual states
4. WHEN the user clicks the like button, THE like icon SHALL provide visual feedback using a scale transition with `--transition-spring` timing
5. THE Document_Preview iframe SHALL be rendered with `--card-border` border, `--radius-md` border-radius, and `--bg-elevated` background
6. WHEN a video URL is present, THE Content_Detail_Page SHALL display the video link section with `--accent-primary` colored link text and hover state using `--accent-hover`

### Requirement 6: Content Detail Page — Comments Section Redesign

**User Story:** As a user, I want the comments section to be clean and easy to read, so that I can follow discussions about the content.

#### Acceptance Criteria

1. THE Comment_Section title SHALL use `--font-body` at `--text-body-lg` size with bold weight, displaying the total comment count
2. THE comment input area SHALL use `--bg-elevated` background with `--card-border` border, transitioning to `--accent-primary` border on focus
3. THE comment submit button SHALL use the global `.btn-primary` class with disabled state when the input is empty or submission is in progress
4. EACH comment item SHALL display the commenter nickname in `--text-primary`, role badge using global `.role-badge` classes, timestamp in `--text-tertiary`, and comment content in `--text-secondary`
5. EACH comment item SHALL be separated by a subtle `--card-border` divider with the last item having no bottom border
6. THE "load more" button SHALL use `--accent-primary` color with hover transition, and the "no more comments" text SHALL use `--text-tertiary`

### Requirement 7: Content Detail Page — Responsive Layout

**User Story:** As a user, I want the content detail page to be readable and well-structured on different screen sizes.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Content_Detail_Page sections SHALL use full-width layout with compact padding
2. WHILE the viewport width is 768px or wider, THE Content_Detail_Page content sections SHALL be centered with a maximum width of 800px
3. WHILE the viewport width is 1024px or wider, THE Content_Detail_Page content sections SHALL use a maximum width of 960px
4. THE Document_Preview iframe SHALL maintain a minimum height of 500px and scale appropriately across breakpoints

### Requirement 8: Content Upload Page — Form Design Redesign

**User Story:** As a user, I want the upload form to be clean, well-organized, and easy to fill out, so that I can submit content efficiently.

#### Acceptance Criteria

1. THE Upload_Form SHALL display a sticky header with back button, centered title using `--font-display`, and balanced spacing
2. EACH form field label SHALL use `--font-body` with `--text-primary` color and bold weight, with required indicators in `--error` color
3. EACH text input and textarea SHALL use `--bg-elevated` background, `--card-border` border, and `--radius-md` border-radius, transitioning to `--accent-primary` border on focus
4. THE file upload area SHALL use a dashed `--card-border` border with `--bg-elevated` background, transitioning to `--accent-primary` border and `--bg-hover` background on hover
5. THE file upload area SHALL display a clear visual distinction between empty state (upload icon + hint text), selected file state (filename + size), and edit mode replacement state
6. THE submit button SHALL use the global `.btn-primary` class with full width on mobile and centered with minimum width on desktop
7. WHEN in edit mode with a rejected status, THE Upload_Form SHALL display a status notice banner with `--error` left border and tinted background

### Requirement 9: Content Upload Page — Responsive Layout

**User Story:** As a user, I want the upload form to be comfortable to use on different screen sizes.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Upload_Form SHALL use full-width layout with compact padding
2. WHILE the viewport width is 768px or wider, THE Upload_Form body SHALL be centered with a maximum width of 720px and increased padding
3. WHILE the viewport width is 1024px or wider, THE Upload_Form body SHALL be rendered as a card with `--bg-surface` background, `--card-border` border, `--radius-xl` border-radius, and `--shadow-md` shadow, centered with a maximum width of 1100px
4. WHILE the viewport width is 1024px or wider, THE submit button SHALL be centered with a minimum width of 360px and `--radius-full` border-radius

### Requirement 10: Design System Compliance

**User Story:** As a developer, I want all three content hub pages to use the project's existing Design_System exclusively, so that the pages are visually consistent with the rest of the application.

#### Acceptance Criteria

1. ALL three content hub pages SHALL use only CSS variables from the Design_System for all colors, spacing, typography, border-radius, shadows, and transitions
2. ALL three content hub pages SHALL not introduce any hardcoded color values, pixel-based spacing outside of responsive breakpoint media queries, or inline styles for design tokens
3. ALL three content hub pages SHALL use `--font-display` (Outfit) for page titles and numeric display values, and `--font-body` (Noto Sans SC) for labels, descriptions, and body text
4. ALL three content hub pages SHALL use the global button classes (`.btn-primary`, `.btn-secondary`) and role badge classes (`.role-badge`) defined in `app.scss`
5. ALL three content hub pages SHALL support the `prefers-reduced-motion` media query by inheriting the global reduced-motion rule from `app.scss` that disables animations and transitions

### Requirement 11: Functional Preservation

**User Story:** As a user, I want all existing content hub functionality to work exactly as before after the redesign, so that no features are lost or broken.

#### Acceptance Criteria

1. THE Content_List_Page SHALL preserve all existing functionality: category filtering, tag cloud filtering, infinite scroll pagination, content card navigation to detail page, upload button visibility based on role permissions, access control redirect for unauthorized users, and home/back navigation
2. THE Content_Detail_Page SHALL preserve all existing functionality: content detail loading, document preview (PDF.js for PDF, Office Online Viewer for PPT/DOC), video link display, like toggle, reserve action, download action (after reservation), owner status display with edit button, comment submission, comment list with pagination, and back navigation
3. THE Content_Upload_Page SHALL preserve all existing functionality: create mode form submission with file upload to S3, edit mode with pre-filled fields and changed-field-only submission, file format validation (PPT/PPTX/PDF/DOC/DOCX), file size validation (50MB limit), video URL format validation, category selection, tag input, status notice banners in edit mode, and back navigation
4. THE Content_List_Page SHALL preserve the existing authentication guard that redirects non-authenticated users to the login page
5. THE Content_Detail_Page SHALL preserve the existing role-based permission checks for download and reserve actions using `contentRolePermissions` from feature toggles
6. ALL three content hub pages SHALL preserve all existing i18n translation key usage for multi-language support

### Requirement 12: Accessibility and Motion

**User Story:** As a user with accessibility needs, I want the content hub pages to respect my motion preferences and provide proper keyboard navigation support.

#### Acceptance Criteria

1. ALL interactive elements (Content_Cards, buttons, links, tabs) SHALL have visible focus states using `outline: 2px solid var(--accent-primary)` with `outline-offset: 2px` as defined in the global `*:focus-visible` rule
2. ALL hover animations (card hover, button hover, like animation) SHALL be disabled when the user has `prefers-reduced-motion: reduce` enabled, inheriting from the global `app.scss` rule
3. THE Content_List_Page Category_Tab_Bar SHALL be navigable via keyboard
4. ALL form inputs on the Content_Upload_Page SHALL have associated label elements for screen reader accessibility
