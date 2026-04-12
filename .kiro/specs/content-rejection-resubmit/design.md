# Design Document

## Overview

This design implements four capabilities: a My Content API endpoint, a My Content list page, corrected edit button visibility on the detail page, and rejection/status context on the edit page. The backend already has the `uploaderId-createdAt-index` GSI on the ContentItems table, so the My Content API can efficiently query by uploader. The edit API already resets status to pending on edit (including approved content), which is the desired behavior.

## Architecture

### Backend Changes

#### 1. My Content API (`GET /api/content/mine`)

**New file:** `packages/backend/src/content/mine.ts`

Implements `listMyContent(options, dynamoClient, contentItemsTable)` function:
- Queries `uploaderId-createdAt-index` GSI with `PK = userId`, `ScanIndexForward = false` (newest first)
- When `status` query param is provided, applies a `FilterExpression` for status matching
- Returns `MyContentItemSummary[]` including: `contentId`, `title`, `categoryName`, `uploaderNickname`, `status`, `rejectReason`, `likeCount`, `commentCount`, `reservationCount`, `createdAt`
- Supports cursor-based pagination with `pageSize` (default 20) and `lastKey` (base64-encoded ExclusiveStartKey)

**Interface:**
```typescript
interface MyContentItemSummary {
  contentId: string;
  title: string;
  categoryName: string;
  status: ContentStatus;
  rejectReason?: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  createdAt: string;
}
```

**Route registration:** Add `GET /api/content/mine` to `packages/backend/src/content/handler.ts` — must be registered BEFORE the `GET /api/content/:id` catch-all pattern.

#### 2. Shared Types Update

Add `MyContentItemSummary` to `packages/shared/src/types.ts` alongside the existing `ContentItemSummary`.

#### 3. No Backend Edit API Changes

The existing edit API already:
- Allows edits on pending, approved, and rejected content (when reservationCount === 0)
- Resets status to `pending` and clears `rejectReason`/`reviewerId`/`reviewedAt` on any edit
- Blocks edits when `reservationCount > 0`

No changes needed.

### Frontend Changes

#### 4. My Content Page (`/pages/content/mine`)

**New files:**
- `packages/frontend/src/pages/content/mine.tsx`
- `packages/frontend/src/pages/content/mine.scss`

**Layout:**
- Header with back button and title
- Filter tabs: All / Pending / Approved / Rejected
- Scrollable list of content cards, each showing:
  - Title
  - Category name
  - Status badge (color-coded: `--warning` for pending, `--success` for approved, `--error` for rejected)
  - Stats row (likes, comments, reservations)
  - Created time
- Infinite scroll pagination (loads more on scroll to bottom)
- Empty state when no content exists

**Data flow:**
- Calls `GET /api/content/mine?status={filter}&pageSize=20&lastKey={cursor}`
- Tapping a card navigates to `/pages/content/detail?id={contentId}`

**Page registration:**
- Add `'pages/content/mine'` to `packages/frontend/src/app.config.ts`

#### 5. Profile Page Entry Point

Add a "My Content" quick action to the profile page's quick actions grid:
- Add a new entry in the `QUICK_ACTIONS` array pointing to `/pages/content/mine`
- Uses an appropriate icon (e.g., a document/content icon)

#### 6. Detail Page Edit Button Fix

**File:** `packages/frontend/src/pages/content/detail.tsx`

Current code already shows the edit button when `reservationCount === 0` for the owner, which is the correct behavior per the updated requirements. The current code in the `detail-owner` section:

```tsx
{item.reservationCount === 0 && (
  <View className='detail-owner__edit-btn btn-secondary' onClick={handleEdit}>
    <Text>{t('contentHub.detail.editButton')}</Text>
  </View>
)}
```

This already matches the updated requirement (show for all statuses when reservationCount === 0). **No change needed** — the existing code is correct.

#### 7. Upload Page Status Context

**File:** `packages/frontend/src/pages/content/upload.tsx`

Add a status notice banner above the form fields in edit mode:
- When `status === 'rejected'` and `rejectReason` is non-empty: show rejection reason in an error-styled notice
- When `status === 'rejected'` and `rejectReason` is empty: show generic "content was rejected" notice
- When `status === 'pending'`: show info-styled notice that content is awaiting review
- When `status === 'approved'`: no special notice (editing will reset to pending, which is expected)

**Implementation:**
- Store `status` and `rejectReason` from the fetched content detail in component state
- Render a `<View className='upload-status-notice'>` block between the header and form fields
- Add corresponding SCSS styles using existing CSS variables (`--error`, `--warning`, `--info`)

#### 8. i18n Keys

Add new translation keys to all language files (zh, en, ja):

```
contentHub.mine.title
contentHub.mine.backButton
contentHub.mine.filterAll
contentHub.mine.filterPending
contentHub.mine.filterApproved
contentHub.mine.filterRejected
contentHub.mine.statusPending
contentHub.mine.statusApproved
contentHub.mine.statusRejected
contentHub.mine.empty
contentHub.mine.emptyIcon
contentHub.mine.loadingMore
contentHub.mine.noMore
contentHub.mine.loading
contentHub.upload.statusRejectedNotice
contentHub.upload.statusRejectedGenericNotice
contentHub.upload.statusPendingNotice
profile.quickActionMyContent
```

## Correctness Properties

### Property 1: My Content API returns only the requesting user's items (Req 1, AC 1)

For any authenticated user U, all items returned by `GET /api/content/mine` have `uploaderId === U.userId`.

### Property 2: My Content API results are ordered by createdAt descending (Req 1, AC 1)

For any response from `GET /api/content/mine`, the `createdAt` values in the returned items array are in non-increasing order.

### Property 3: My Content API status filter is consistent (Req 1, AC 3)

When `status` query parameter is provided, all returned items have `status` matching the filter value. The filtered result count is less than or equal to the unfiltered result count.

### Property 4: My Content API pagination completeness (Req 1, AC 4)

Paginating through all pages of `GET /api/content/mine` (following `lastKey` cursors until none is returned) yields the complete set of the user's content items with no duplicates and no missing items.

### Property 5: Edit button visibility is determined solely by reservationCount and ownership (Req 3)

The edit button is visible if and only if: the current user is the uploader AND `reservationCount === 0`. Status does not affect edit button visibility.

### Property 6: Status notice on edit page matches content status (Req 4)

When editing a content item:
- If `status === 'rejected'` and `rejectReason` is non-empty, the rejection reason notice is displayed
- If `status === 'rejected'` and `rejectReason` is empty, a generic rejected notice is displayed
- If `status === 'pending'`, a pending notice is displayed

## Data Model

No new DynamoDB tables required. The existing `uploaderId-createdAt-index` GSI on the ContentItems table supports the My Content API query pattern.

### New Shared Type

```typescript
export interface MyContentItemSummary {
  contentId: string;
  title: string;
  categoryName: string;
  status: ContentStatus;
  rejectReason?: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  createdAt: string;
}
```

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/backend/src/content/mine.ts` | New | My Content API logic |
| `packages/backend/src/content/handler.ts` | Modify | Register `GET /api/content/mine` route |
| `packages/shared/src/types.ts` | Modify | Add `MyContentItemSummary` interface |
| `packages/frontend/src/pages/content/mine.tsx` | New | My Content list page |
| `packages/frontend/src/pages/content/mine.scss` | New | My Content page styles |
| `packages/frontend/src/pages/content/upload.tsx` | Modify | Add status notice banner in edit mode |
| `packages/frontend/src/pages/content/upload.scss` | Modify | Add status notice styles |
| `packages/frontend/src/pages/profile/index.tsx` | Modify | Add My Content quick action |
| `packages/frontend/src/app.config.ts` | Modify | Register mine page route |
| `packages/frontend/src/i18n/zh.ts` | Modify | Add Chinese translations |
| `packages/frontend/src/i18n/en.ts` | Modify | Add English translations |
| `packages/frontend/src/i18n/ja.ts` | Modify | Add Japanese translations |
| `packages/frontend/src/i18n/types.ts` | Modify | Add new i18n key types |
