# Implementation Plan: Content Live Roles

## Overview

Replace stale role snapshots with live role lookups from the Users table at API query time. A new shared utility `fetchUserRolesMap` performs batch role lookups with deduplication, chunking, and CommunityBuilder filtering. The Content List, Content Detail, and Comment List APIs are updated to attach live role arrays, and the frontend renders from these arrays instead of the legacy snapshot fields.

## Tasks

- [x] 1. Create the fetchUserRolesMap utility function
  - [x] 1.1 Create `packages/backend/src/content/roles.ts` with the `fetchUserRolesMap` function
    - Accept `userIds: string[]`, `dynamoClient`, and `usersTable` parameters
    - Deduplicate input userIds using `new Set()`
    - Return empty Map immediately for empty input
    - Split into batches of 100 for BatchGetItem calls
    - Use ProjectionExpression to fetch only `userId` and `roles`
    - Handle `UnprocessedKeys` with retry logic
    - Convert DynamoDB Set to Array for the `roles` field
    - Filter out `CommunityBuilder` from each user's roles
    - Map missing users to empty arrays
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.2 Create unit tests in `packages/backend/src/content/roles.test.ts`
    - Test empty userId list returns empty Map
    - Test single userId returns correct roles
    - Test multiple userIds returns correct mapping
    - Test missing userId maps to empty array
    - Test CommunityBuilder is filtered out
    - Test roles as DynamoDB Set type converts to Array
    - Test UnprocessedKeys retry logic
    - Test deduplication of input userIds
    - Test batching when >100 userIds
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.3 Write property test: Role Mapping Correctness (Property 1)
    - **Property 1: Role Mapping Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.4, 2.5, 3.1, 3.4, 3.5, 5.1, 5.4**
    - Create `packages/backend/src/content/roles.property.test.ts`
    - Generate random userId lists and random role data (with/without CommunityBuilder)
    - Assert each existing userId maps to roles minus CommunityBuilder; missing userIds map to `[]`
    - Minimum 100 iterations
    - Label: `Feature: content-live-roles, Property 1: Role Mapping Correctness`

  - [x] 1.4 Write property test: CommunityBuilder Exclusion Invariant (Property 2)
    - **Property 2: CommunityBuilder Exclusion Invariant**
    - **Validates: Requirements 1.2, 2.4, 3.4**
    - In `packages/backend/src/content/roles.property.test.ts`
    - Generate random role arrays guaranteed to include CommunityBuilder in some entries
    - Assert output never contains CommunityBuilder and all other roles are preserved
    - Minimum 100 iterations
    - Label: `Feature: content-live-roles, Property 2: CommunityBuilder Exclusion Invariant`

  - [x] 1.5 Write property test: User ID Deduplication (Property 3)
    - **Property 3: User ID Deduplication**
    - **Validates: Requirements 2.2, 3.2, 5.2**
    - In `packages/backend/src/content/roles.property.test.ts`
    - Generate random userId lists with duplicates
    - Mock DynamoDB and capture BatchGetItem keys
    - Assert no duplicate keys in requests and key count equals unique userId count
    - Minimum 100 iterations
    - Label: `Feature: content-live-roles, Property 3: User ID Deduplication`

  - [x] 1.6 Write property test: Batch Chunking (Property 4)
    - **Property 4: Batch Chunking**
    - **Validates: Requirements 5.3**
    - In `packages/backend/src/content/roles.property.test.ts`
    - Generate 1–300 unique userIds
    - Mock DynamoDB and capture all BatchGetItem calls
    - Assert each call has ≤100 keys and the union of all keys equals the full unique set
    - Minimum 100 iterations
    - Label: `Feature: content-live-roles, Property 4: Batch Chunking`

- [ ] 2. Update shared types to include live role fields
  - [-] 2.1 Add `uploaderRoles` to `ContentItemSummary` and `ContentItem` in `packages/shared/src/types.ts`
    - Add `uploaderRoles?: string[]` to `ContentItemSummary`
    - Add `uploaderRoles?: string[]` to `ContentItem`
    - Keep existing `uploaderRole` field unchanged
    - _Requirements: 1.1, 1.4, 2.1, 4.1, 4.2_

  - [ ] 2.2 Add `userRoles` to `ContentComment` in `packages/shared/src/types.ts`
    - Add `userRoles?: string[]` to `ContentComment`
    - Keep existing `userRole` field unchanged
    - _Requirements: 3.1, 3.4, 4.3_

- [ ] 3. Integrate live roles into Content List and Detail APIs
  - [ ] 3.1 Modify `listContentItems` in `packages/backend/src/content/list.ts`
    - Add `usersTable: string` parameter to function signature
    - After querying content items, collect all `uploaderId` values
    - Call `fetchUserRolesMap` with the collected uploaderIds
    - Attach `uploaderRoles` to each `ContentItemSummary` in the mapping step
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.2 Modify `getContentDetail` in `packages/backend/src/content/list.ts`
    - Add `usersTable: string` to the `tables` parameter object
    - After fetching the content item, call `fetchUserRolesMap([item.uploaderId], ...)`
    - Merge the role lookup into the existing `Promise.all` with reservation/like queries
    - Attach `uploaderRoles` to the returned `ContentItem`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 3.3 Update unit tests in `packages/backend/src/content/list.test.ts`
    - Update mock DynamoDB client to handle BatchGetCommand for roles
    - Update `listContentItems` calls to pass `usersTable` parameter
    - Update `getContentDetail` calls to include `usersTable` in tables object
    - Add assertions that `uploaderRoles` is present on returned items
    - Verify `uploaderRole` snapshot field remains unchanged
    - _Requirements: 1.1, 1.4, 2.1_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Integrate live roles into Comment List API
  - [ ] 5.1 Modify `listComments` in `packages/backend/src/content/comment.ts`
    - Add `usersTable: string` parameter to function signature
    - After querying comments, collect all `userId` values
    - Call `fetchUserRolesMap` with the collected userIds
    - Attach `userRoles` to each `ContentComment` in the result
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 5.2 Update unit tests in `packages/backend/src/content/comment.test.ts`
    - Update mock DynamoDB client to handle BatchGetCommand for roles
    - Update `listComments` calls to pass `usersTable` parameter
    - Add assertions that `userRoles` is present on returned comments
    - Verify `userRole` snapshot field remains unchanged
    - _Requirements: 3.1, 3.4_

- [ ] 6. Wire handler to pass USERS_TABLE to updated functions
  - [ ] 6.1 Modify `packages/backend/src/content/handler.ts` to pass `USERS_TABLE`
    - In `handleListContentItems`: pass `USERS_TABLE` as the 4th argument to `listContentItems`
    - In `handleGetContentDetail`: add `usersTable: USERS_TABLE` to the tables object passed to `getContentDetail`
    - In `handleListComments`: pass `USERS_TABLE` as the 4th argument to `listComments`
    - `USERS_TABLE` is already defined in handler.ts, no new env var needed
    - _Requirements: 1.1, 2.1, 3.1_

  - [ ] 6.2 Update handler tests in `packages/backend/src/content/handler.test.ts`
    - Verify `USERS_TABLE` is passed to `listContentItems`, `getContentDetail`, and `listComments`
    - _Requirements: 1.1, 2.1, 3.1_

- [ ] 7. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Update frontend to render from live role arrays
  - [ ] 8.1 Update content detail page `packages/frontend/src/pages/content/detail.tsx`
    - For uploader role badge: replace `ROLE_CONFIG[item.uploaderRole]` rendering with iteration over `item.uploaderRoles` array
    - For comment role badges: replace `c.userRole` rendering with iteration over `c.userRoles` array
    - When array is empty or undefined, display no role badge
    - When array has multiple roles, render one `.role-badge` per role
    - Use existing `ROLE_CONFIG`, `getRoleBadgeClass`, and `getRoleBadgeLabel` helpers
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [ ] 8.2 Update content list page `packages/frontend/src/pages/content/index.tsx`
    - Render `uploaderRoles` badges on each content card using the global `.role-badge` classes
    - When array is empty or undefined, display no role badge
    - _Requirements: 4.2, 4.4, 4.5_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `uploaderRole` / `userRole` snapshot fields are preserved for backward compatibility
- `USERS_TABLE` environment variable is already available in handler.ts
