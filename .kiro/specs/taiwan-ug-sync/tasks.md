# Implementation Plan: Taiwan UG Sync

## Overview

Extend the activity sync system to scrape event data from Taiwan AWS User Group websites. Implementation follows the existing meetup-sync pattern: a local script for scraping (bypassing IP blocks), Admin API for config CRUD, and a Settings UI section for SuperAdmin management. Cheerio is used for HTML parsing, with a dedicated date parser for Chinese/mixed-format dates.

## Tasks

- [x] 1. Create Date Parser Module
  - [x] 1.1 Create `packages/backend/src/sync/taiwan-date-parser.ts` with `parseTaiwanDate(dateStr, referenceDate?)` function
    - Parse Chinese format: "3月12日(四)19:00-21:00" → extract month/day, infer year from context
    - Parse English format: "February 7, 2026 13:30~18:00" → extract full date with explicit year
    - Parse pipe-separated format: "1月29日(三) | 19:30~21:00" → ignore time after pipe, extract date
    - Parse ISO-like format: "2024-03-12" → pass through
    - Return `YYYY-MM-DD` string on success, `null` on failure with console warning
    - Year inference: use current year; if month-day is more than 2 months in the past, use next year
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 1.2 Write property tests in `packages/backend/src/sync/taiwan-date-parser.property.test.ts`
    - **Property 1: Date parsing round-trip** — For any valid YYYY-MM-DD date, converting to string and re-parsing produces the same YYYY-MM-DD
    - **Validates: Requirements 2.5**
    - **Property 2: Chinese and English date parsing correctness** — For any random valid date, formatting as Chinese "X月Y日" or English "Month D, YYYY" and parsing extracts correct month/day/year
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - **Property 3: Invalid date strings return null** — For any string not matching supported formats, `parseTaiwanDate` returns null
    - **Validates: Requirements 2.4**

  - [ ]* 1.3 Write unit tests in `packages/backend/src/sync/taiwan-date-parser.test.ts`
    - Test Chinese format "3月12日(四)19:00-21:00"
    - Test English format "February 7, 2026 13:30~18:00"
    - Test pipe-separated "1月29日(三) | 19:30~21:00"
    - Test edge cases: Dec 31 → Jan 1 year inference, empty string, random gibberish
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Create Website Scraper Module
  - [x] 2.1 Add cheerio as a dependency in `packages/backend/package.json`
    - Run `npm install cheerio` in `packages/backend`
    - _Requirements: 1.2_

  - [x] 2.2 Create `packages/backend/src/sync/taiwan-scraper.ts` with interfaces and scraper functions
    - Define `ScrapedEvent` interface: `{ title, date, location?, sourceUrl, isUpcoming }`
    - Define `ScrapeResult` interface: `{ success, events?, error? }`
    - Implement `scrapeAwsugNet(url)` for server-rendered HTML from `tw.events.awsug.net`
      - Use cheerio to parse event cards, extract title, date, location, status indicators ("已截止", "已結束")
      - Set browser-like User-Agent header on HTTP requests
      - 15-second fetch timeout
      - Return `ScrapeResult` with `success: false` on HTTP errors (4xx/5xx) or network failures
      - Return empty events list (not error) when HTML has no recognizable event elements
    - Implement `scrapeAwsugComTw(url)` for SPA site `awsug.com.tw`
      - Attempt to discover embedded data or JSON API endpoint first
      - Fall back to parsing available HTML with warning if no API found
      - Skip events marked "COMING SOON"
    - Implement `scrapeWebsite(url)` dispatcher that routes to the correct scraper based on URL pattern
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.1, 9.2, 9.3_

  - [x] 2.3 Implement event data mapping and filtering in `taiwan-scraper.ts`
    - Map scraped events to Activities table format: `activityType="线下活动"`, `ugName=displayName`, `topic=title`, `activityDate=YYYY-MM-DD`, `dedupeKey={topic}#{activityDate}#{ugName}`, `sourceUrl`
    - Filter out future events (date after today)
    - Filter out "COMING SOON" events from `awsug.com.tw`
    - Include events with "已截止" or "已結束" status from `tw.events.awsug.net`
    - Skip events missing required fields (title or date), log warning per skipped event
    - Log count of skipped future/upcoming events separately from synced past events
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 12.3_

  - [ ]* 2.4 Write property tests in `packages/backend/src/sync/taiwan-scraper.property.test.ts`
    - **Property 4: Event data mapping preserves all fields** — For any scraped event with valid title/date/sourceUrl and any displayName, mapped record has correct activityType, ugName, topic, activityDate, sourceUrl, dedupeKey
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    - **Property 5: Future event filtering** — For any list of events with mixed past/future dates, filter includes only past events
    - **Validates: Requirements 4.2**
    - **Property 6: Scraper handles arbitrary HTML gracefully** — For any arbitrary HTML string, parsing returns valid events or empty list without throwing
    - **Validates: Requirements 1.5, 12.2**
    - **Property 7: Events missing required fields are skipped** — For any list of raw events where some lack title or date, validation excludes incomplete events
    - **Validates: Requirements 12.3**

  - [ ]* 2.5 Write unit tests in `packages/backend/src/sync/taiwan-scraper.test.ts`
    - Test `scrapeAwsugNet` with mock HTML containing known event cards
    - Test `scrapeAwsugComTw` with mock HTML/JSON data
    - Test HTTP error handling (404, 500, timeout)
    - Test empty HTML and malformed HTML
    - Test "COMING SOON" filtering, "已截止"/"已結束" inclusion, future date filtering
    - Test events missing title or date are skipped
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 12.1, 12.2, 12.3_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create Local Sync Script
  - [x] 4.1 Create `scripts/taiwan-ug-sync-local.ts` following the pattern of `scripts/meetup-sync-local.ts`
    - Read `website-sync-config` from DynamoDB Users table, fall back to hardcoded defaults: `{ url: "https://tw.events.awsug.net/", displayName: "AWS UG Taiwan" }` and `{ url: "https://awsug.com.tw/ug/", displayName: "AWS UG DevSecOps TW" }`
    - For each source: call `scrapeWebsite(url)` → filter past events → generate dedupeKey → query `dedupeKey-index` GSI → write new activities with `activityId` (ULID), `pk: "ALL"`, `activityType`, `ugName`, `topic`, `activityDate`, `dedupeKey`, `syncedAt`, `sourceUrl`
    - Per-source error isolation: if one source fails, log error and continue to next
    - Log start time, end time, and summary (total found, synced count, skipped count per source)
    - Executable via `npx tsx scripts/taiwan-ug-sync-local.ts`
    - NOT registered with EventBridge or any scheduled trigger
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.1, 10.2, 12.1, 12.4_

- [x] 5. Add Admin API Routes for Website Sync Config
  - [x] 5.1 Add `WEBSITE_SYNC_CONFIG_KEY = 'website-sync-config'` constant and route handlers in `packages/backend/src/admin/handler.ts`
    - Implement `handleGetWebsiteSyncConfig()` — GET `/api/admin/settings/website-sync-config`, read from Users table, return config (SuperAdmin only)
    - Implement `handleUpdateWebsiteSyncConfig(event)` — PUT `/api/admin/settings/website-sync-config`, validate: URL starts with `https://`, displayName non-empty, max 20 sources, min 1 source; persist to Users table with `updatedAt` and `updatedBy` (SuperAdmin only)
    - Implement `handleWebsiteSync()` — POST `/api/admin/sync/website`, return placeholder message telling user to run the local script (SuperAdmin only)
    - Register all three routes in the handler's routing logic (GET/PUT/POST) with `isSuperAdmin` check
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 5.2 Write unit tests in `packages/backend/src/admin/website-sync-config.test.ts`
    - Test GET returns config when exists, returns default empty when not exists
    - Test PUT validates URL format, displayName non-empty, max 20 sources
    - Test POST returns placeholder message
    - Test 403 for non-SuperAdmin on all routes
    - Follow the pattern of `packages/backend/src/admin/meetup-config.test.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 6. Add i18n Keys for Taiwan UG Sync
  - [x] 6.1 Add new keys to `packages/frontend/src/i18n/types.ts` under the `activitySync` section
    - Keys: `websiteSyncSectionTitle`, `websiteSyncSectionDesc`, `websiteSourceUrlLabel`, `websiteSourceUrlPlaceholder`, `websiteSourceDisplayNameLabel`, `websiteSourceDisplayNamePlaceholder`, `websiteAddSource`, `websiteRemoveSource`, `websiteSyncButton`, `websiteSyncing`, `websiteSyncSuccess`, `websiteSyncFailed`, `websiteSyncLocalOnly`, `websiteLastSyncLabel`, `websiteNoSources`, `websiteUrlValidation`, `websiteMaxSources`
    - _Requirements: 11.1_

  - [x] 6.2 Add Chinese (zh) translations to `packages/frontend/src/i18n/zh.ts`
    - _Requirements: 11.2_

  - [x] 6.3 Add English (en) translations to `packages/frontend/src/i18n/en.ts`
    - _Requirements: 11.2_

  - [x] 6.4 Add Traditional Chinese (zh-TW) translations to `packages/frontend/src/i18n/zh-TW.ts`
    - _Requirements: 11.2_

  - [x] 6.5 Add Japanese (ja) translations to `packages/frontend/src/i18n/ja.ts`
    - _Requirements: 11.2_

  - [x] 6.6 Add Korean (ko) translations to `packages/frontend/src/i18n/ko.ts`
    - _Requirements: 11.2_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Build Settings UI for Taiwan UG Sync
  - [x] 8.1 Add Taiwan UG Sync section to `packages/frontend/src/pages/admin/settings.tsx`
    - Add `WebsiteSyncConfigState` interface and state variables (sources, loading states, last sync info)
    - Implement `fetchWebsiteSyncConfig()` to load config from `GET /api/admin/settings/website-sync-config`
    - Implement `handleSaveWebsiteConfig()` to persist config via `PUT /api/admin/settings/website-sync-config`
    - Implement `handleWebsiteSync()` to call `POST /api/admin/sync/website` — display the placeholder message about running the local script
    - Build UI as a new `CollapsibleSection` within the `activity-sync` category, below the Meetup sync section
      - Source list with add/remove buttons
      - URL + displayName fields per source
      - URL validation: must start with `https://`
      - Save button to persist config
      - "Sync Now" button that calls POST endpoint and shows placeholder message
      - Last sync timestamp display
    - Add `fetchWebsiteSyncConfig` to the `useEffect` that loads data when `activity-sync` category is active
    - Visible only to SuperAdmin users
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 9. Final Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The "Sync Now" button calls the Admin API POST endpoint which returns a placeholder message — actual sync runs via the local script
- cheerio must be added as a dependency before the scraper module is implemented
- Follow existing patterns from meetup-sync for admin routes, tests, and settings UI
