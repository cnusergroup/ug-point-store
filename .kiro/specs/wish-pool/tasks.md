# Implementation Plan: 许愿池（Wish Pool）

## Overview

实现社区驱动的周边商品许愿池功能。按层级从底向上实现：CDK 基础设施（WishesTable + WishVotesTable）→ shared types & error codes → feature toggles → backend validators → backend wish-service → backend handler（路由分发）→ email notifications → frontend 页面（列表、提交、我的许愿、管理员管理）→ i18n。使用 DynamoDB TransactWriteItems 保证投票原子性和积分发放原子性。

## Tasks

- [x] 1. CDK infrastructure — Create DynamoDB tables
  - [x] 1.1 Add WishesTable and WishVotesTable to CDK stack in `packages/cdk/`
    - Create `WishesTable` with partition key `wishId` (String)
    - Add GSI `StatusVoteIndex`: partition key `status`, sort key `voteCount` (Number)
    - Add GSI `UserWishIndex`: partition key `userId`, sort key `createdAt` (String)
    - Create `WishVotesTable` with partition key `wishId` (String), sort key `voterId` (String)
    - Add environment variables `WISHES_TABLE` and `WISH_VOTES_TABLE` to Lambda function
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 2. Shared types and error codes
  - [x] 2.1 Add wish pool types to `packages/shared/src/types.ts`
    - Add `WishStatus` type: `'pending' | 'approved' | 'adopted' | 'fulfilled' | 'closed'`
    - Add `WishRecord` interface with all fields (wishId, userId, title, description, imageUrl?, status, voteCount, productId?, closeReason?, priorityPurchase?, createdAt, updatedAt)
    - Add `WishListItem` interface extending `WishRecord` with `hasVoted?: boolean`
    - Add `MyWishListItem` interface extending `WishRecord` with `remainingWishes: number`
    - _Requirements: 9.1, 4.4, 4.5, 5.2, 5.4_

  - [x] 2.2 Add wish pool error codes to `packages/shared/src/errors.ts`
    - Add error codes: `MONTHLY_LIMIT_EXCEEDED`, `ALREADY_VOTED`, `WISH_NOT_VOTABLE`, `CANNOT_VOTE_OWN_WISH`, `WISH_NOT_EDITABLE`, `WISH_NOT_DELETABLE`, `WISH_NOT_FOUND`, `INVALID_WISH_TITLE`, `INVALID_WISH_DESCRIPTION`, `INVALID_CLOSE_REASON`
    - Add corresponding HTTP status codes to `ErrorHttpStatus` map (400 for validation, 404 for not found)
    - Add corresponding Chinese error messages to `ErrorMessages` map
    - _Requirements: 1.4, 3.2, 3.3, 3.4, 3.5, 11.2, 11.4_

- [x] 3. Feature toggles update
  - [x] 3.1 Add wish pool toggles to `packages/backend/src/settings/feature-toggles.ts`
    - Add `wishPoolEnabled: boolean` (default `false`) to FeatureToggles interface and DEFAULT_TOGGLES
    - Add `wishFulfilledRewardPoints: number` (default `50`) to FeatureToggles interface and DEFAULT_TOGGLES
    - _Requirements: 8.1, 8.5_

- [x] 4. Backend validators — `packages/backend/src/wishes/wish-validators.ts`
  - [x] 4.1 Implement input validation functions and status transition logic
    - Implement `validateWishTitle(title: string): boolean` — returns true iff `title.trim().length` is 1-50
    - Implement `validateWishDescription(desc: string): boolean` — returns true iff `desc.trim().length` is 1-500
    - Implement `validateCloseReason(reason: string): boolean` — returns true iff `reason.trim().length` is 1-200
    - Define `VALID_STATUS_TRANSITIONS` map with the 6 allowed transitions
    - Implement `isValidStatusTransition(current: WishStatus, target: WishStatus): boolean`
    - _Requirements: 1.2, 2.3, 6.3, 6.4, 6.5_

  - [ ]* 4.2 Write property test for input validation boundaries
    - **Property 2: Input validation boundaries**
    - Generate random strings (0-200 chars), verify validation functions accept only strings within valid length ranges after trimming
    - Test file: `packages/backend/src/wishes/wish-validators.property.test.ts`
    - **Validates: Requirements 1.2, 2.3, 6.3**

  - [ ]* 4.3 Write property test for status transition validation
    - **Property 4: Status transition validation**
    - Generate all pairs of WishStatus values, verify `isValidStatusTransition` returns true only for the 6 allowed transitions
    - Test file: `packages/backend/src/wishes/wish-validators.property.test.ts`
    - **Validates: Requirements 2.2, 2.5, 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 5. Checkpoint - Ensure shared types, error codes, and validators compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Backend wish service — `packages/backend/src/wishes/wish-service.ts`
  - [x] 6.1 Implement `createWish` and `getMonthlyWishCount`
    - Implement `getMonthlyWishCount(userId, dynamoClient, tables)` — query UserWishIndex GSI, filter by current UTC month
    - Implement `createWish(input, dynamoClient, tables, featureToggles)` — check wishPoolEnabled, validate inputs, check monthly limit, PutCommand to WishesTable with status=pending, voteCount=0
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 8.2_

  - [ ]* 6.2 Write property test for wish creation initial state
    - **Property 1: Wish creation initial state**
    - Generate random valid titles (1-50 chars) and descriptions (1-500 chars), verify created wish has status=pending and voteCount=0
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 1.1, 1.6**

  - [ ]* 6.3 Write property test for monthly limit enforcement
    - **Property 3: Monthly limit enforcement**
    - Generate random existing wish counts (0-5) with random dates across month boundaries, verify limit is enforced correctly based on current month count
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 1.4, 1.5, 5.4, 11.6**

  - [x] 6.4 Implement `voteWish`
    - Implement `voteWish(wishId, voterId, dynamoClient, tables, featureToggles)`:
      - Check wishPoolEnabled; return FEATURE_DISABLED if false
      - Fetch wish; return WISH_NOT_FOUND if missing
      - Check wish.userId !== voterId; return CANNOT_VOTE_OWN_WISH if same
      - Check wish.status === 'approved'; return WISH_NOT_VOTABLE if not
      - Execute TransactWriteItems: PutItem to WishVotesTable (condition: attribute_not_exists) + UpdateItem WishesTable (voteCount + 1, condition: status = approved)
      - Catch TransactionCanceledException for duplicate vote → return ALREADY_VOTED
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.5_

  - [ ]* 6.5 Write property test for voting preconditions
    - **Property 8: Voting preconditions**
    - Generate random combinations of wish status, voter identity (author vs non-author), and prior vote existence, verify correct error code for each failure case
    - Test file: `packages/backend/src/wishes/wish-vote.property.test.ts`
    - **Validates: Requirements 3.4, 3.5, 3.2**

  - [ ]* 6.6 Write property test for duplicate vote prevention
    - **Property 7: Duplicate vote prevention**
    - Generate random (wishId, voterId) pairs, vote once, attempt again, verify second attempt fails with ALREADY_VOTED and count unchanged
    - Test file: `packages/backend/src/wishes/wish-vote.property.test.ts`
    - **Validates: Requirements 3.2, 3.3**

  - [x] 6.7 Implement `reviewWish` and `updateWishStatus`
    - Implement `reviewWish(wishId, action, closeReason, operatorId, dynamoClient, tables)`:
      - Fetch wish; validate status is pending
      - If action=approve: update status to approved
      - If action=reject: validate closeReason, update status to closed with closeReason, send rejection email
    - Implement `updateWishStatus(input, dynamoClient, tables, featureToggles)`:
      - Validate status transition using isValidStatusTransition
      - For fulfilled: require productId, use TransactWriteItems (update wish status + update user points + put PointsRecord), set priorityPurchase=true, send fulfilled email
      - For adopted: update status, send adopted email
      - For closed: require closeReason, update status with closeReason
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.8 Write property test for admin authorization gate
    - **Property 5: Admin authorization gate**
    - Generate random user roles from ALL_ROLES, verify admin operations succeed only for Admin/SuperAdmin
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 2.4**

  - [ ]* 6.9 Write property test for points award on fulfillment
    - **Property 11: Points award on fulfillment**
    - Generate random initial points balances and reward amounts, fulfill a wish, verify exact points increase and record creation
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 7.3, 7.4**

  - [x] 6.10 Implement `listWishes`, `getMyWishes`, `updateWish`, `deleteWish`
    - Implement `listWishes(input, dynamoClient, tables)`:
      - Query StatusVoteIndex for status in [approved, adopted, fulfilled]
      - Support sortBy 'votes' (descending voteCount) and 'time' (descending createdAt)
      - Support pagination (page, pageSize)
      - If currentUserId provided, batch-check WishVotesTable to mark hasVoted
    - Implement `getMyWishes(userId, page, pageSize, dynamoClient, tables)`:
      - Query UserWishIndex by userId, sort by createdAt descending
      - Calculate remainingWishes = 3 - monthly count
    - Implement `updateWish(wishId, userId, updates, dynamoClient, tables)`:
      - Fetch wish; check userId matches (FORBIDDEN if not)
      - Check status is pending (WISH_NOT_EDITABLE if not)
      - Validate updated fields; UpdateCommand
    - Implement `deleteWish(wishId, userId, dynamoClient, tables)`:
      - Fetch wish; check userId matches (FORBIDDEN if not)
      - Check status is pending (WISH_NOT_DELETABLE if not)
      - DeleteCommand (physical delete)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 6.11 Write property test for public list filtering and sorting
    - **Property 9: Public list filtering and sorting**
    - Generate random sets of wishes with all statuses and random voteCount/createdAt, verify list returns only visible statuses in correct order
    - Test file: `packages/backend/src/wishes/wish-list.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.5**

  - [ ]* 6.12 Write property test for my wishes ownership isolation
    - **Property 10: My wishes ownership isolation**
    - Generate wishes from multiple random users, query as one user, verify only that user's wishes returned in descending time order
    - Test file: `packages/backend/src/wishes/wish-list.property.test.ts`
    - **Validates: Requirements 5.1, 5.3, 5.4**

  - [ ]* 6.13 Write property test for edit/delete authorization
    - **Property 13: Edit/delete authorization**
    - Generate random combinations of wish status and user identity (author vs non-author), verify edit/delete succeeds only for pending + author
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

  - [ ]* 6.14 Write property test for feature toggle gate
    - **Property 12: Feature toggle gate**
    - Generate random valid inputs with wishPoolEnabled=false, verify submissions and votes rejected, reads still work
    - Test file: `packages/backend/src/wishes/wish-service.property.test.ts`
    - **Validates: Requirements 8.2, 4.6, 5.5, 6.7**

  - [ ]* 6.15 Write property test for vote count consistency
    - **Property 6: Vote count consistency**
    - Generate random sequences of vote operations (valid and invalid), verify voteCount always equals the number of successful votes
    - Test file: `packages/backend/src/wishes/wish-vote.property.test.ts`
    - **Validates: Requirements 3.1, 9.5, 9.6**

- [x] 7. Backend handler — `packages/backend/src/wishes/handler.ts`
  - [x] 7.1 Implement Lambda handler with route dispatching
    - Define route regex patterns for all 9 API paths
    - Implement route matching for POST/GET/PUT/DELETE/PATCH methods
    - Wire each route to corresponding wish-service function
    - Add admin role check (Admin/SuperAdmin) for admin routes
    - Add feature toggle check for user-facing write operations
    - Add authentication middleware (extract userId from JWT)
    - _Requirements: 2.4, 8.2, 8.3_

- [x] 8. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Email notifications
  - [x] 9.1 Add wish notification email templates and functions in `packages/backend/src/email/`
    - Implement `sendWishAdoptedEmail(ctx, userId, wishTitle)` — notify author wish was adopted
    - Implement `sendWishFulfilledEmail(ctx, userId, wishTitle, productId)` — notify author wish fulfilled with product link
    - Implement `sendWishRejectedEmail(ctx, userId, wishTitle, closeReason)` — notify author wish rejected with reason
    - Add email templates for `wishAdopted`, `wishFulfilled`, `wishRejected` types
    - Support user locale preference for email language (zh, en, ja, ko, zh-TW)
    - _Requirements: 7.1, 7.2, 7.5, 7.6_

- [x] 10. Frontend — Wish pool list page
  - [x] 10.1 Create wish pool list page at `packages/frontend/src/pages/wishes/index.tsx`
    - Display approved/adopted/fulfilled wishes with title, description, image, vote count, status
    - Implement sort toggle: by votes (热度) / by time (最新)
    - Implement pagination (load more or infinite scroll)
    - Show vote button with current vote count; mark already-voted state
    - Handle vote action (POST /api/wishes/:wishId/vote)
    - Hide vote button and submit entry when wishPoolEnabled=false
    - Add page config file `index.config.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 10.2 Create wish pool list page styles at `packages/frontend/src/pages/wishes/index.scss`
    - Style wish cards with image thumbnail, title, description preview, vote count badge
    - Style sort toggle tabs
    - Style vote button (normal, voted, disabled states)
    - _Requirements: 4.4_

- [x] 11. Frontend — Create wish page
  - [x] 11.1 Create submit wish page at `packages/frontend/src/pages/wishes/create.tsx`
    - Form with title input (max 50 chars), description textarea (max 500 chars), optional image upload
    - Show remaining monthly wish count
    - Validate inputs client-side before submission
    - Handle POST /api/wishes submission
    - Show success feedback and navigate back to list
    - Handle error responses (MONTHLY_LIMIT_EXCEEDED, FEATURE_DISABLED, validation errors)
    - Add page config file `create.config.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.3_

  - [x] 11.2 Create submit wish page styles at `packages/frontend/src/pages/wishes/create.scss`
    - Style form layout, input fields, image upload area, submit button
    - Style remaining count indicator
    - _Requirements: 1.2, 1.3_

- [x] 12. Frontend — My wishes page
  - [x] 12.1 Create my wishes page at `packages/frontend/src/pages/wishes/mine.tsx`
    - Display all user's wishes with all statuses
    - Show status badge, vote count, close reason (if closed)
    - Show remaining monthly wish count
    - Add edit/delete buttons for pending wishes
    - Handle edit (PUT /api/wishes/:wishId) and delete (DELETE /api/wishes/:wishId) actions
    - Sort by createdAt descending
    - Add page config file `mine.config.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 11.1, 11.3, 11.5_

  - [x] 12.2 Create my wishes page styles at `packages/frontend/src/pages/wishes/mine.scss`
    - Style wish cards with status badges (pending/approved/adopted/fulfilled/closed)
    - Style edit/delete action buttons
    - Style remaining count display
    - _Requirements: 5.2_

- [x] 13. Frontend — Admin wishes management page
  - [x] 13.1 Create admin wishes management page at `packages/frontend/src/pages/admin/wishes.tsx`
    - Display all wishes with status filter tabs (all/pending/approved/adopted/fulfilled/closed)
    - Sort by vote count descending
    - Support pagination
    - Review actions: approve/reject (with closeReason input) for pending wishes
    - Status management: adopt for approved, fulfill (with productId input) for adopted, close (with closeReason input) for any closeable status
    - Add page config file `wishes.config.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.6, 6.7_

  - [x] 13.2 Create admin wishes management page styles at `packages/frontend/src/pages/admin/wishes.scss`
    - Style status filter tabs
    - Style action buttons (approve, reject, adopt, fulfill, close)
    - Style confirmation dialogs for reject/close (closeReason input)
    - Style fulfill dialog (productId input)
    - _Requirements: 6.6_

- [x] 14. Frontend — Register pages in app config
  - [x] 14.1 Add wish pool pages to `packages/frontend/src/app.config.ts`
    - Register `/pages/wishes/index`, `/pages/wishes/create`, `/pages/wishes/mine`, `/pages/admin/wishes`
    - Add navigation entry for wish pool (conditionally hidden when wishPoolEnabled=false)
    - _Requirements: 8.3_

- [x] 15. i18n translations
  - [x] 15.1 Add wish pool translation keys to `packages/frontend/src/i18n/zh.ts`
    - Add keys under `wishPool.*` prefix: page titles, form labels, status labels (pending/approved/adopted/fulfilled/closed), vote button text, error messages, action button labels, confirmation dialogs, remaining count text
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 15.2 Add wish pool translation keys to `packages/frontend/src/i18n/en.ts`
    - Same keys as 15.1 with English translations
    - _Requirements: 10.1, 10.3_

  - [x] 15.3 Add wish pool translation keys to `packages/frontend/src/i18n/ja.ts`
    - Same keys as 15.1 with Japanese translations
    - _Requirements: 10.1, 10.3_

  - [x] 15.4 Add wish pool translation keys to `packages/frontend/src/i18n/ko.ts`
    - Same keys as 15.1 with Korean translations
    - _Requirements: 10.1, 10.3_

  - [x] 15.5 Add wish pool translation keys to `packages/frontend/src/i18n/zh-TW.ts`
    - Same keys as 15.1 with Traditional Chinese translations
    - _Requirements: 10.1, 10.3_

- [x] 16. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to verify no TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (13 properties total)
- Unit tests validate specific examples and edge cases
- TransactWriteItems ensures atomicity for vote operations (WishVotesTable + WishesTable.voteCount)
- TransactWriteItems ensures atomicity for fulfillment (wish status + user points + PointsRecord)
- Physical delete on wish removal ensures monthly quota is correctly released
- Feature toggle gate: submissions and votes blocked when disabled, reads and admin operations still work
- Email notifications are best-effort (failure doesn't block main operation)
- GSI StatusVoteIndex supports efficient hot-sorting queries
- GSI UserWishIndex supports efficient "my wishes" and monthly quota calculation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["3.1", "4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "6.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["6.5", "6.6", "6.7"] },
    { "id": 5, "tasks": ["6.8", "6.9", "6.10"] },
    { "id": 6, "tasks": ["6.11", "6.12", "6.13", "6.14", "6.15"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1", "11.1", "12.1", "13.1", "14.1"] },
    { "id": 10, "tasks": ["10.2", "11.2", "12.2", "13.2"] },
    { "id": 11, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5"] }
  ]
}
```
