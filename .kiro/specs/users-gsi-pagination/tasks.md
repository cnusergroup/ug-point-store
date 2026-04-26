# Implementation Plan: Users GSI Pagination

## Overview

Replace the full-table `Scan` in `listUsers` with a DynamoDB `Query` on a new `entityType-createdAt-index` GSI, enabling correct cursor-based pagination. Add `invitedBy` field to user records for frontend priority sorting. Implementation order: CDK GSI definition → backend registration changes → migration script → backend listUsers rewrite → frontend pagination and sorting. The migration script runs after CDK deploy (so the GSI exists) but before switching listUsers to use the GSI.

## Tasks

- [x] 1. Add entityType-createdAt GSI to Users table in CDK
  - [x] 1.1 Add the GSI definition in `packages/cdk/lib/database-stack.ts`
    - Call `this.usersTable.addGlobalSecondaryIndex()` with `indexName: 'entityType-createdAt-index'`, partition key `entityType` (String), sort key `createdAt` (String), and `projectionType: dynamodb.ProjectionType.ALL`
    - Place it after the existing `earnTotalVolunteer-index` GSI block
    - NOTE: DynamoDB only allows one GSI creation per CloudFormation update — deploy this GSI alone before proceeding
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Update backend registration to write entityType and invitedBy
  - [x] 2.1 Add `entityType: 'user'` to the user record in `packages/backend/src/auth/register.ts`
    - Add `entityType: 'user'` to the `user` object in the `PutCommand` item, alongside existing fields
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 Fetch invite's `createdBy` and write as `invitedBy` in `packages/backend/src/auth/register.ts`
    - After `validateInviteToken` succeeds, do a separate `GetCommand` on the Invites table with `ProjectionExpression: 'createdBy'` to fetch the invite record's `createdBy` field
    - Add `...(invitedBy ? { invitedBy } : {})` to the user object in the `PutCommand`
    - If the invite has no `createdBy`, omit `invitedBy` from the user record
    - _Requirements: 3.1, 3.2_

  - [ ]* 2.3 Write property test for registration record invariants
    - **Property 1: Registration record invariants**
    - Test file: `packages/backend/src/auth/register.property.test.ts` (extend existing)
    - Generate random valid emails, nicknames, passwords, and invite records with/without `createdBy`
    - Assert: resulting user record always has `entityType === 'user'`; `invitedBy` equals invite's `createdBy` when present, absent when invite has no `createdBy`
    - **Validates: Requirements 2.1, 3.1, 3.2**

- [x] 3. Checkpoint - Ensure registration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create migration script for existing user records
  - [x] 4.1 Create `scripts/migrate-users-entity-type.ts`
    - Scan the Invites table for all records with `status = "used"` to build a `Map<userId, createdBy>` from `usedBy → createdBy`
    - Scan the Users table; for each record with `email` attribute:
      - Set `entityType = "user"` using `UpdateCommand` with condition `attribute_exists(email)`
      - If the user's `userId` exists in the invite map and the user doesn't already have `invitedBy`, set `invitedBy` from the map
      - Use `attribute_not_exists(invitedBy)` condition to avoid overwriting existing `invitedBy` values
    - Skip records without `email` attribute (system config records)
    - Log counts: updated, skipped (no email), already had invitedBy
    - Make the script idempotent — safe to re-run multiple times
    - Executable via `npx tsx scripts/migrate-users-entity-type.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 4.2 Write property test for migration correctness
    - **Property 2: Migration correctness**
    - Test file: `scripts/migrate-users.property.test.ts` (new)
    - Generate random sets of user records (with/without email) and invite records (with/without usedBy/createdBy)
    - Assert: every record with `email` gets `entityType: "user"`; records without `email` remain unmodified; `invitedBy` matches the invite's `createdBy` via `usedBy → userId` mapping; users without matching invite don't get `invitedBy`
    - **Validates: Requirements 4.1, 4.2, 4.6, 4.7**

  - [ ]* 4.3 Write property test for migration idempotency
    - **Property 3: Migration idempotency**
    - Test file: `scripts/migrate-users.property.test.ts` (same file as 4.2)
    - Generate random table state, run migration logic twice
    - Assert: result after second run is identical to result after first run; no attributes overwritten or duplicated; pre-existing `invitedBy` values preserved
    - **Validates: Requirements 4.3, 4.8**

- [x] 5. Rewrite listUsers to Query the GSI
  - [x] 5.1 Rewrite `listUsers` function in `packages/backend/src/admin/users.ts`
    - Replace `ScanCommand` import with `QueryCommand` (keep other imports)
    - Add `invitedBy?: string` to the `UserListItem` interface
    - Replace the Scan-based implementation with a `QueryCommand` on `entityType-createdAt-index`:
      - `KeyConditionExpression: 'entityType = :et'` with `:et = 'user'`
      - `ScanIndexForward: false` for descending `createdAt` order
      - `Limit: pageSize` (clamped between 1 and 100, default 20)
      - Pass `ExclusiveStartKey` from `options.lastKey` when provided
    - Build `FilterExpression` for `role` (`contains(#roles, :role)`) and `excludeRoles` (`NOT contains(#roles, :exRoleN)`) when provided
    - Add `#invitedBy` / `invitedBy` to `ProjectionExpression` and `ExpressionAttributeNames`
    - Map results to `UserListItem` including `invitedBy`
    - Return `LastEvaluatedKey` directly as `lastKey` (remove the full-table scan loop)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 3.3_

  - [x] 5.2 Update `packages/backend/src/admin/users.test.ts` unit tests
    - Update existing tests to verify `QueryCommand` is used instead of `ScanCommand`
    - Verify correct `IndexName: 'entityType-createdAt-index'`
    - Verify `ScanIndexForward: false`
    - Verify `ProjectionExpression` includes `invitedBy`
    - Verify `ExclusiveStartKey` passthrough and `LastEvaluatedKey` returned as `lastKey`
    - Verify role filtering and excludeRoles filtering in `FilterExpression`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 5.3 Write property test for query filter construction
    - **Property 4: Query filter construction**
    - Test file: `packages/backend/src/admin/users.property.test.ts` (new)
    - Generate random `role` (string or undefined) and `excludeRoles` (array of strings or undefined)
    - Assert: FilterExpression contains `contains(#roles, :role)` iff `role` is provided; contains `NOT contains(#roles, :exRoleN)` for each role in `excludeRoles`
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 5.4 Write property test for page size clamping
    - **Property 5: Page size clamping**
    - Test file: `packages/backend/src/admin/users.property.test.ts` (same file as 5.3)
    - Generate random integers (negative, zero, small, large, undefined)
    - Assert: DynamoDB Query `Limit` equals `max(1, min(pageSize, 100))`; defaults to 20 when not provided
    - **Validates: Requirements 5.5**

- [x] 6. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update frontend for pagination and invitedBy priority sorting
  - [x] 7.1 Add `invitedBy` to `UserListItem` interface in `packages/frontend/src/pages/admin/batch-points.tsx`
    - Add `invitedBy?: string` to the `UserListItem` interface
    - _Requirements: 3.3, 7.1_

  - [x] 7.2 Add `invitedBy` to `UserListItem` interface in `packages/frontend/src/pages/admin/batch-adjust.tsx`
    - Add `invitedBy?: string` to the `UserListItem` interface
    - _Requirements: 3.3, 7.1_

  - [x] 7.3 Create `sortUsersWithInvitePriority` utility function
    - Create a utility function (can be in a shared utils file or inline in both pages)
    - Partition users into two groups: `invitedBy === currentUserId` and all others
    - Sort each group by `createdAt` descending
    - Return invited-by-current-admin group first, then others
    - Users without `invitedBy` go in the "others" group
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [ ]* 7.4 Write property test for frontend sort utility
    - **Property 6: Frontend sort — invited-user priority with createdAt ordering**
    - Test file: `packages/frontend/src/utils/sort-users.property.test.ts` (new) or co-located with the utility
    - Generate random user lists with varying `invitedBy` and `createdAt` fields, random `currentUserId`
    - Assert: all users with `invitedBy === currentUserId` appear before all others; within each group, users are sorted by `createdAt` descending; users without `invitedBy` are in the "others" group
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.6**

  - [x] 7.5 Update `fetchUsers` in `packages/frontend/src/pages/admin/batch-points.tsx`
    - Change `pageSize=200` to `pageSize=20` in the fetch URL
    - After each fetch (initial and append), apply `sortUsersWithInvitePriority` to the accumulated user list using the current admin's `userId` from the store
    - Ensure "Load more" button shows when `lastKey` is present and hides when absent
    - _Requirements: 6.1, 6.3, 6.5, 6.6, 7.4_

  - [x] 7.6 Update `fetchUsers` in `packages/frontend/src/pages/admin/batch-adjust.tsx`
    - Change `pageSize=200` to `pageSize=20` in the fetch URL
    - After each fetch (initial and append), apply `sortUsersWithInvitePriority` to the accumulated user list using the current admin's `userId` from the store
    - Ensure "Load more" button shows when `lastKey` is present and hides when absent
    - _Requirements: 6.2, 6.4, 6.5, 6.6, 7.5_

- [x] 8. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The migration script (task 4) should be run AFTER CDK deploy (task 1) so the GSI exists, but BEFORE switching listUsers to use the GSI (task 5)
- The `scripts/` directory is in `.gitignore` — the migration script is a one-time operational tool, not shipped code
- DynamoDB Query with FilterExpression on non-key attributes (role, excludeRoles) may return fewer than `pageSize` items per page — this is expected and handled by the frontend's "Load more" pagination
