# Requirements Document

## Introduction

This feature addresses two gaps in the content management workflow: uploaders currently have no way to discover that their content was rejected (unless they have the direct link), and the "my content" list showing all statuses is missing. The feature adds a dedicated "my content" API and page showing all statuses with visual indicators, ensures the edit button visibility rules are correct on the detail page, and shows rejection context on the edit page so uploaders know what to fix.

### Existing Behavior (already implemented)

- The Content_Detail_Page already displays status badges (pending/approved/rejected) and rejection reason for the owner
- The Content_Edit_API already resets status to `pending` and clears `rejectReason`/`reviewerId`/`reviewedAt` on edit
- The Content_Edit_API already blocks edits when `reservationCount > 0`
- The Content_Upload_Page already pre-fills form fields when editing
- Editing approved content resets it to `pending` status — this is the desired behavior

### Gaps to Address

- No dedicated API endpoint to list the user's own content across all statuses
- No "my content" page in the frontend
- The Content_Upload_Page does not show rejection reason context when editing rejected content
- The Content_Upload_Page does not show status context (pending notice) when editing pending content

## Glossary

- **Content_List_API**: The backend endpoint `GET /api/content` that returns approved content items for the public feed
- **My_Content_API**: A new backend endpoint `GET /api/content/mine` that returns the authenticated user's own content items across all statuses (pending, approved, rejected)
- **Content_Detail_API**: The backend endpoint `GET /api/content/:id` that returns a single content item's full details
- **Content_Edit_API**: The backend endpoint `PUT /api/content/:id` that allows the uploader to modify their content
- **Content_Detail_Page**: The frontend page at `/pages/content/detail` that displays a single content item
- **Content_Upload_Page**: The frontend page at `/pages/content/upload` that handles both creating and editing content
- **My_Content_Page**: A new frontend page at `/pages/content/mine` that displays the authenticated user's own content across all statuses
- **Uploader**: The authenticated user who originally created a content item
- **ContentItem**: The data record representing a piece of uploaded content, containing fields such as `status`, `rejectReason`, `uploaderId`, `title`, `description`, `categoryId`, `fileKey`, `fileName`, `videoUrl`
- **ContentStatus**: One of three values: `pending`, `approved`, `rejected`

## Requirements

### Requirement 1: My Content API Endpoint

**User Story:** As an uploader, I want a dedicated API to retrieve all my content items regardless of status, so that I can see pending, approved, and rejected content in one place.

#### Acceptance Criteria

1. WHEN an authenticated user sends a GET request to `/api/content/mine`, THE My_Content_API SHALL return all ContentItem records where `uploaderId` matches the authenticated user's ID, ordered by `createdAt` descending
2. THE My_Content_API SHALL include the `status` and `rejectReason` fields in each returned ContentItem summary
3. WHEN the `status` query parameter is provided, THE My_Content_API SHALL filter results to only include ContentItem records matching the specified ContentStatus value
4. THE My_Content_API SHALL support cursor-based pagination with `pageSize` and `lastKey` parameters, defaulting to 20 items per page
5. IF an unauthenticated request is sent to `/api/content/mine`, THEN THE My_Content_API SHALL return a 401 Unauthorized error

### Requirement 2: My Content List Page

**User Story:** As an uploader, I want to see a list of all my uploaded content with status indicators, so that I can track which items are pending, approved, or rejected.

#### Acceptance Criteria

1. THE My_Content_Page SHALL display all ContentItem records belonging to the authenticated Uploader, ordered by `createdAt` descending
2. THE My_Content_Page SHALL display a visual status badge for each ContentItem showing its current ContentStatus (pending, approved, rejected)
3. THE My_Content_Page SHALL use distinct visual styling for each ContentStatus: pending uses a warning color (`--warning`), approved uses a success color (`--success`), rejected uses an error color (`--error`)
4. WHEN the Uploader taps a ContentItem in the My_Content_Page, THE My_Content_Page SHALL navigate to the Content_Detail_Page for that ContentItem
5. THE My_Content_Page SHALL provide filter tabs to view all content, or filter by a specific ContentStatus
6. THE My_Content_Page SHALL support infinite scroll pagination, loading more items as the Uploader scrolls down
7. THE My_Content_Page SHALL be accessible from the profile page via a quick action entry point

### Requirement 3: Edit Button Visibility on Detail Page

**User Story:** As an uploader, I want the edit button to appear only when editing is allowed, so that I am not confused by actions that should not be taken.

#### Acceptance Criteria

1. WHEN the ContentItem has `reservationCount` equals 0, THE Content_Detail_Page SHALL display an enabled edit button to the Uploader who owns the ContentItem
2. WHEN the ContentItem has `reservationCount` greater than 0, THE Content_Detail_Page SHALL hide the edit button regardless of ContentStatus
3. THE Content_Detail_Page SHALL only display the edit button to the Uploader who owns the ContentItem

### Requirement 4: Show Rejection Context on Edit Page

**User Story:** As an uploader, I want to see the rejection reason when editing my rejected content, so that I know what to fix before resubmitting.

#### Acceptance Criteria

1. WHEN the Uploader navigates to the Content_Upload_Page for a ContentItem with status `rejected`, THE Content_Upload_Page SHALL display the rejection reason in a visible notice area above the form fields
2. WHEN the ContentItem has status `rejected` but `rejectReason` is empty, THE Content_Upload_Page SHALL display a generic "content was rejected" notice without a specific reason
3. WHEN the ContentItem has status `pending`, THE Content_Upload_Page SHALL display a notice indicating the content is awaiting review
