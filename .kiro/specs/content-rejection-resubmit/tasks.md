# Implementation Tasks

## Task 1: Add MyContentItemSummary type to shared package

- [x] 1.1 Add `MyContentItemSummary` interface to `packages/shared/src/types.ts` with fields: `contentId`, `title`, `categoryName`, `status`, `rejectReason?`, `likeCount`, `commentCount`, `reservationCount`, `createdAt`

## Task 2: Implement My Content API endpoint

- [x] 2.1 Create `packages/backend/src/content/mine.ts` with `listMyContent` function that queries `uploaderId-createdAt-index` GSI, supports optional `status` filter via FilterExpression, cursor-based pagination with `pageSize` (default 20) and `lastKey`, returns `MyContentItemSummary[]` ordered by `createdAt` descending
- [x] 2.2 Register `GET /api/content/mine` route in `packages/backend/src/content/handler.ts` — add it BEFORE the `CONTENT_ID_REGEX` match to avoid the `:id` catch-all intercepting it
- [x] 2.3 Create `packages/backend/src/content/mine.test.ts` with unit tests covering: returns user's items only, filters by status, pagination with lastKey, returns 401 for unauthenticated requests, empty result for user with no content

## Task 3: Add i18n keys for My Content page and status notices

- [x] 3.1 Add new keys to `packages/frontend/src/i18n/types.ts` under `contentHub.mine` (title, backButton, filterAll, filterPending, filterApproved, filterRejected, statusPending, statusApproved, statusRejected, empty, emptyIcon, loadingMore, noMore, loading) and `contentHub.upload` (statusRejectedNotice, statusRejectedGenericNotice, statusPendingNotice) and `profile` (quickActionMyContent)
- [x] 3.2 Add Chinese translations to `packages/frontend/src/i18n/zh.ts`
- [x] 3.3 Add English translations to `packages/frontend/src/i18n/en.ts`
- [x] 3.4 Add Japanese translations to `packages/frontend/src/i18n/ja.ts`

## Task 4: Create My Content list page

- [x] 4.1 Register `'pages/content/mine'` in `packages/frontend/src/app.config.ts`
- [x] 4.2 Create `packages/frontend/src/pages/content/mine.tsx` with: header (back button + title), filter tabs (All/Pending/Approved/Rejected), content card list with status badges (color-coded using `--warning`/`--success`/`--error`), stats row (likes/comments/reservations), infinite scroll pagination, empty state, tap-to-navigate to detail page
- [x] 4.3 Create `packages/frontend/src/pages/content/mine.scss` with styles following the project's design system (CSS variables for colors, spacing, radius, transitions)

## Task 5: Add My Content entry point to profile page

- [x] 5.1 Add a "My Content" quick action entry to the `QUICK_ACTIONS` array in `packages/frontend/src/pages/profile/index.tsx`, pointing to `/pages/content/mine`, using an appropriate icon component

## Task 6: Add status notice banner to upload/edit page

- [x] 6.1 Modify `packages/frontend/src/pages/content/upload.tsx` to store `status` and `rejectReason` from fetched content detail in component state, and render a status notice banner above the form fields: rejected with reason shows the reason, rejected without reason shows generic notice, pending shows awaiting review notice
- [x] 6.2 Add status notice styles to `packages/frontend/src/pages/content/upload.scss` using CSS variables (`--error`, `--warning`, `--info` for backgrounds, `--text-primary` for text)
