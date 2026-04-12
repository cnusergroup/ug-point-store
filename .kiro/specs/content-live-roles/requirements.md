# Requirements Document

## Introduction

Content Hub currently stores a snapshot of the user's role at the time content or comments are created (uploaderRole / commenterRole fields in ContentItems / ContentComments tables). When a user's role changes later (e.g., from CommunityBuilder to Speaker), the stale snapshot continues to display. This feature changes the backend APIs to look up each user's current roles from the Users table at query time, so that role badges always reflect the user's present roles.

## Glossary

- **Content_Hub**: The content sharing module of the Points Mall system, including content list, content detail, and comment features.
- **Content_List_API**: The `GET /api/content` endpoint that returns a paginated list of approved content items.
- **Content_Detail_API**: The `GET /api/content/:id` endpoint that returns a single content item with user-interaction flags.
- **Comment_List_API**: The `GET /api/content/:id/comments` endpoint that returns paginated comments for a content item.
- **Users_Table**: The `PointsMall-Users` DynamoDB table, keyed by `userId`, containing the authoritative `roles` field (a string array such as `["Speaker", "Admin"]`).
- **ContentItems_Table**: The DynamoDB table storing content records, which includes the legacy `uploaderRole` snapshot field.
- **ContentComments_Table**: The DynamoDB table storing comment records, which includes the legacy `userRole` snapshot field.
- **Role_Badge**: A UI element displayed next to a user's nickname indicating their role (e.g., Speaker, Admin).
- **BatchGetItem**: A DynamoDB operation that retrieves multiple items by primary key in a single request, used to efficiently fetch roles for multiple distinct users.
- **CommunityBuilder_Role**: A legacy role that is filtered out and never displayed in role badges.
- **Live_Role**: The user's current role(s) as stored in the Users_Table, as opposed to the snapshot stored at content/comment creation time.

## Requirements

### Requirement 1: Resolve Live Roles for Content Detail

**User Story:** As a content viewer, I want to see the uploader's current role badge on the content detail page, so that I always know their present role in the community.

#### Acceptance Criteria

1. WHEN the Content_Detail_API returns a content item, THE Content_Detail_API SHALL include an `uploaderRoles` field containing the uploader's current roles fetched from the Users_Table.
2. WHEN the Content_Detail_API fetches the uploader's current roles, THE Content_Detail_API SHALL exclude the CommunityBuilder_Role from the `uploaderRoles` array.
3. IF the uploader's user record is not found in the Users_Table, THEN THE Content_Detail_API SHALL return an empty array for `uploaderRoles`.
4. THE Content_Detail_API SHALL continue to return the existing `uploaderRole` snapshot field unchanged for backward compatibility.

### Requirement 2: Resolve Live Roles for Content List

**User Story:** As a content browser, I want to see each uploader's current role badge on the content list page, so that role information stays accurate across all listed items.

#### Acceptance Criteria

1. WHEN the Content_List_API returns content items, THE Content_List_API SHALL include an `uploaderRoles` field on each item containing the uploader's current roles fetched from the Users_Table.
2. WHEN multiple content items share the same uploader, THE Content_List_API SHALL deduplicate user lookups so that each distinct uploader is fetched from the Users_Table at most once per request.
3. THE Content_List_API SHALL use BatchGetItem to fetch roles for all distinct uploaders in a single batch call.
4. WHEN the Content_List_API fetches uploader roles, THE Content_List_API SHALL exclude the CommunityBuilder_Role from each `uploaderRoles` array.
5. IF an uploader's user record is not found in the Users_Table, THEN THE Content_List_API SHALL return an empty array for that item's `uploaderRoles`.

### Requirement 3: Resolve Live Roles for Comment List

**User Story:** As a content viewer reading comments, I want to see each commenter's current role badge, so that I can identify their present community standing.

#### Acceptance Criteria

1. WHEN the Comment_List_API returns comments, THE Comment_List_API SHALL include a `userRoles` field on each comment containing the commenter's current roles fetched from the Users_Table.
2. WHEN multiple comments share the same commenter, THE Comment_List_API SHALL deduplicate user lookups so that each distinct commenter is fetched from the Users_Table at most once per request.
3. THE Comment_List_API SHALL use BatchGetItem to fetch roles for all distinct commenters in a single batch call.
4. WHEN the Comment_List_API fetches commenter roles, THE Comment_List_API SHALL exclude the CommunityBuilder_Role from each `userRoles` array.
5. IF a commenter's user record is not found in the Users_Table, THEN THE Comment_List_API SHALL return an empty array for that comment's `userRoles`.

### Requirement 4: Frontend Displays Live Roles

**User Story:** As a frontend user, I want the UI to render role badges from the live roles array instead of the snapshot field, so that badges always reflect current roles.

#### Acceptance Criteria

1. WHEN the content detail page renders the uploader's role badge, THE Content_Hub SHALL use the `uploaderRoles` array from the API response instead of the legacy `uploaderRole` string.
2. WHEN the content list page renders each item's uploader role badge, THE Content_Hub SHALL use the `uploaderRoles` array from the API response.
3. WHEN the comment list renders each commenter's role badge, THE Content_Hub SHALL use the `userRoles` array from the API response instead of the legacy `userRole` string.
4. WHEN a user has multiple roles, THE Content_Hub SHALL display one role badge per role.
5. WHEN a user has zero displayable roles (empty array), THE Content_Hub SHALL display no role badge for that user.

### Requirement 5: Shared Role-Lookup Utility

**User Story:** As a developer, I want a reusable utility function for batch-fetching user roles, so that the role-lookup logic is consistent and maintainable across all content APIs.

#### Acceptance Criteria

1. THE Content_Hub backend SHALL provide a utility function that accepts a list of user IDs and returns a map of userId to their current roles (excluding CommunityBuilder_Role).
2. WHEN the list of user IDs contains duplicates, THE utility function SHALL deduplicate them before querying the Users_Table.
3. WHEN the list of user IDs exceeds 100 entries, THE utility function SHALL split the request into multiple BatchGetItem calls of at most 100 keys each.
4. IF a userId is not found in the Users_Table, THEN THE utility function SHALL map that userId to an empty roles array.
5. THE utility function SHALL project only the `userId` and `roles` attributes from the Users_Table to minimize read capacity consumption.
