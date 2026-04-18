# Tasks

## Task 1: Create Meetup GraphQL Client Module

Create `packages/backend/src/sync/meetup-api.ts` with the Meetup GraphQL client.

- [x] 1.1 Define TypeScript interfaces: `MeetupGroup`, `MeetupCookieAuth`, `MeetupEvent`, `MeetupGroupResult`, `MeetupGraphQLEventNode`
- [x] 1.2 Implement `mapMeetupEvent(node, group)` function that maps a GraphQL event node to `MeetupEvent` with: `activityType="线下活动"`, `ugName=group.displayName`, `topic=node.title`, `activityDate=YYYY-MM-DD from node.dateTime`, `dedupeKey={topic}#{activityDate}#{ugName}`, and Meetup-specific fields (eventId, eventUrl, goingCount, venue)
- [x] 1.3 Implement `fetchMeetupGroupEvents(group, auth)` that sends GraphQL queries to `https://www.meetup.com/gql2` with Cookie/CSRF/Bearer headers, queries both PAST and UPCOMING statuses, paginates with `first:20` and cursor-based `after`, returns all mapped events
- [x] 1.4 Implement `testMeetupConnection(auth)` that sends a lightweight GraphQL query (e.g., `{ self { id name } }`) to verify cookie auth credentials are valid
- [x] 1.5 Implement `maskCookie(value)` utility function that returns asterisks + last 4 characters for strings > 4 chars, or `"****"` for shorter strings
- [x] 1.6 Add error handling: 10-second fetch timeout, `MEETUP_AUTH_EXPIRED` for 401/403, `MEETUP_API_ERROR` for GraphQL errors, skip malformed events missing required fields (id, title, dateTime)

## Task 2: Update Sync Handler with Source Routing

Update `packages/backend/src/sync/handler.ts` to support the `source` parameter and Meetup sync.

- [x] 2.1 Add `MeetupSyncConfig` interface (including `autoSyncEnabled` boolean) and `getMeetupSyncConfig(dynamo, usersTable)` function to read `meetup-sync-config` from Users table, returning null if not found
- [x] 2.2 Parse `source` parameter from event payload (default `'all'`), add source routing logic: `feishu` → Feishu only, `meetup` → Meetup only, `all` → Feishu first, then Meetup only if `autoSyncEnabled` is true
- [x] 2.3 Implement `syncMeetupActivities(config, dynamo, activitiesTable)` that iterates configured groups, calls `fetchMeetupGroupEvents` for each, deduplicates via `dedupeKey-index` GSI, writes new activities to Activities table with Meetup-specific fields
- [x] 2.4 Add per-group error isolation: if one group fails, log error and continue with remaining groups, collect warnings
- [x] 2.5 Update `SyncResult` to include `source` and `warnings` fields, return combined result for `source=all`

## Task 3: Add Admin API Routes for Meetup Config

Add new routes to `packages/backend/src/admin/handler.ts` for Meetup config CRUD and sync triggers.

- [x] 3.1 Add `MEETUP_SYNC_CONFIG_KEY = 'meetup-sync-config'` constant and route regex patterns
- [x] 3.2 Implement `handleGetMeetupSyncConfig()` — read from Users table, mask cookie values using `maskCookie()`, return config with masked cookies
- [x] 3.3 Implement `handleUpdateMeetupSyncConfig(event)` — validate input (groups array, cookie strings), detect masked values (starting with `*`) and retain existing DB values for those fields, persist to Users table
- [x] 3.4 Implement `handleTestMeetupConnection(event)` — extract cookie values from request body, call `testMeetupConnection()`, return success/failure
- [x] 3.5 Implement `handleMeetupSync()` — invoke Sync Lambda with `{ source: 'meetup' }` payload, return sync result
- [x] 3.6 Refactor existing `handleManualSync()` to `handleFeishuSync()` — invoke Sync Lambda with `{ source: 'feishu' }` payload; keep `handleManualSync()` as alias with `{ source: 'all' }` for backward compatibility
- [x] 3.7 Register all new routes in the handler's routing logic (GET/PUT/POST), all SuperAdmin-only with `isSuperAdmin` check

## Task 4: Add i18n Keys for Meetup Sync

Add Meetup-related translation keys to all 5 language files and the types file.

- [x] 4.1 Add new keys to `packages/frontend/src/i18n/types.ts` under the `activitySync` section: `meetupSectionTitle`, `meetupSectionDesc`, `meetupGroupsLabel`, `meetupGroupUrlnamePlaceholder`, `meetupGroupDisplayNamePlaceholder`, `meetupAddGroup`, `meetupRemoveGroup`, `meetupTokenLabel`, `meetupTokenPlaceholder`, `meetupCsrfLabel`, `meetupCsrfPlaceholder`, `meetupSessionLabel`, `meetupSessionPlaceholder`, `meetupTestButton`, `meetupTesting`, `meetupTestSuccess`, `meetupTestFailed`, `meetupSyncButton`, `meetupSyncing`, `meetupSyncSuccess`, `meetupSyncFailed`, `meetupLastSyncLabel`, `meetupAuthExpired`, `meetupAutoSyncLabel`, `meetupAutoSyncDesc`, `meetupNoGroups`, `feishuSyncButton`, `feishuSyncing`
- [x] 4.2 Add Chinese (zh) translations to `packages/frontend/src/i18n/zh.ts`
- [x] 4.3 Add English (en) translations to `packages/frontend/src/i18n/en.ts`
- [x] 4.4 Add Traditional Chinese (zh-TW) translations to `packages/frontend/src/i18n/zh-TW.ts`
- [x] 4.5 Add Japanese (ja) translations to `packages/frontend/src/i18n/ja.ts`
- [x] 4.6 Add Korean (ko) translations to `packages/frontend/src/i18n/ko.ts`

## Task 5: Extend Settings Page with Meetup Sync UI

Update `packages/frontend/src/pages/admin/settings.tsx` to add the Meetup sync configuration section.

- [x] 5.1 Add `MeetupSyncConfigState` interface and state variables for Meetup config (groups, cookies, loading states, last sync info)
- [x] 5.2 Implement `fetchMeetupSyncConfig()` callback to load config from `GET /api/admin/settings/meetup-sync-config`
- [x] 5.3 Implement `handleSaveMeetupConfig()` to persist config via `PUT /api/admin/settings/meetup-sync-config`
- [x] 5.4 Implement `handleTestMeetupConnection()` to test cookies via `POST /api/admin/settings/meetup-sync-config/test`
- [x] 5.5 Implement `handleMeetupSync()` to trigger sync via `POST /api/admin/sync/meetup`
- [x] 5.6 Build Meetup sync card UI within the `activity-sync` category: group list with add/remove, three password inputs for cookies, auto-sync toggle switch, Save/Test/Sync buttons, last sync status display
- [x] 5.7 Refactor existing Feishu sync button from `POST /api/admin/sync/activities` to `POST /api/admin/sync/feishu`, add `feishuSyncButton` label
- [x] 5.8 Add `fetchMeetupSyncConfig` to the `useEffect` that loads data when `activity-sync` category is active

## Task 6: Write Property-Based Tests

Create property-based tests for the Meetup sync module using `fast-check`.

- [x] 6.1 Create `packages/backend/src/sync/meetup-api.property.test.ts` with Property 1 (event data mapping), Property 2 (pagination), Property 3 (cookie masking), Property 7 (malformed event filtering)
- [x] 6.2 Create `packages/backend/src/sync/meetup-sync.property.test.ts` with Property 4 (masked PUT retains values), Property 5 (group failure isolation), Property 6 (deduplication)

## Task 7: Write Unit Tests

Create example-based unit tests for the Meetup sync module.

- [x] 7.1 Create `packages/backend/src/sync/meetup-api.test.ts` with tests for: GraphQL query construction, response parsing, error handling (401/403/500/timeout), PAST+UPCOMING query execution, test connection
- [x] 7.2 Add sync handler tests to `packages/backend/src/sync/handler.test.ts` (or create new) for: source routing (feishu/meetup/all), config not found behavior, empty cookies behavior, combined result structure
- [x] 7.3 Add admin handler tests for: GET/PUT meetup config routes, masked cookie handling, test connection route, meetup sync trigger route, SuperAdmin auth checks
