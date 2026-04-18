# Requirements Document

## Introduction

Extend the existing activity sync system to scrape event data from two Taiwan AWS User Group websites and sync them into the Activities DynamoDB table. Unlike the Meetup sync (which uses a GraphQL API), these sources are regular websites requiring HTML scraping. Since website scraping from AWS Lambda IPs may be blocked (similar to Meetup's 503 blocking), the sync runs as a local script (`scripts/taiwan-ug-sync-local.ts`) following the same pattern as `scripts/meetup-sync-local.ts`. The frontend Settings page gains a new "Taiwan UG Sync" section in the activity-sync category where SuperAdmins can configure website sync sources and trigger manual syncs. Only past/completed events are synced; future and "COMING SOON" events are skipped.

**Data Sources:**
1. AWS UG Taiwan (`https://tw.events.awsug.net/`) — server-rendered HTML with event cards showing title, date, location, and status indicators like "已截止" (closed) or "已結束" (ended)
2. AWS UG DevSecOps Taiwan (`https://awsug.com.tw/ug/`) — SPA (Vue/React) rendering event cards with date, speakers, topics, and accupass links; events marked "COMING SOON" are future events

## Glossary

- **Website_Scraper**: A local TypeScript module responsible for fetching HTML from a configured website URL and extracting event data (title, date, location) using HTML parsing (cheerio).
- **Taiwan_Sync_Script**: A local script (`scripts/taiwan-ug-sync-local.ts`) that orchestrates scraping configured Taiwan UG websites and writing extracted events to the Activities table via DynamoDB SDK.
- **Activities_Table**: The existing DynamoDB table (`PointsMall-Activities`) storing all synced activity records with `dedupeKey-index` GSI for deduplication.
- **Settings_Page**: The existing SuperAdmin settings page (`/pages/admin/settings`) where system configuration is managed.
- **DedupeKey**: A composite key `{topic}#{activityDate}#{ugName}` used to prevent duplicate activity records across sync runs.
- **Website_Sync_Config**: A configuration record stored in the DynamoDB Users table (key: `website-sync-config`) containing a list of website sync sources with URL and display name.
- **Sync_Source**: A single website sync source entry containing a URL and a display name (e.g., URL: `https://tw.events.awsug.net/`, displayName: `AWS UG Taiwan`).
- **Date_Parser**: A module responsible for parsing Chinese/mixed-format date strings (e.g., "3月12日(四)19:00-21:00", "February 7, 2026 13:30~18:00") into ISO `YYYY-MM-DD` format.
- **Admin_API**: The existing Admin Lambda handler that provides API endpoints for managing settings and triggering sync operations.

## Requirements

### Requirement 1: Website HTML Scraper

**User Story:** As a system operator, I want to scrape event data from Taiwan UG websites, so that Taiwan UG events are available in the Activities table alongside Meetup and Feishu events.

#### Acceptance Criteria

1. WHEN a valid website URL is provided, THE Website_Scraper SHALL fetch the HTML content of the page and return parsed event data including event title, event date, and event location.
2. THE Website_Scraper SHALL use cheerio (HTML parsing library) to extract structured event data from the raw HTML response.
3. WHEN the target website returns an HTTP error (4xx or 5xx), THE Website_Scraper SHALL return a failure result containing the HTTP status code and error message.
4. WHEN the target website is unreachable (network timeout or DNS failure), THE Website_Scraper SHALL return a failure result after a 15-second timeout.
5. WHEN the HTML structure does not contain recognizable event elements, THE Website_Scraper SHALL return an empty event list without error.
6. THE Website_Scraper SHALL set a browser-like User-Agent header on HTTP requests to reduce the likelihood of being blocked by website firewalls.

### Requirement 2: Chinese/Mixed Date Parsing

**User Story:** As a system operator, I want date strings in Chinese and mixed formats parsed correctly, so that event dates are stored in a consistent YYYY-MM-DD format.

#### Acceptance Criteria

1. WHEN a Chinese-format date string is provided (e.g., "3月12日(四)19:00-21:00"), THE Date_Parser SHALL extract the month and day and return a date in YYYY-MM-DD format, inferring the year from context (current year, or next year if the month-day has already passed).
2. WHEN an English-format date string is provided (e.g., "February 7, 2026 13:30~18:00"), THE Date_Parser SHALL parse the full date including the explicit year and return YYYY-MM-DD format.
3. WHEN a mixed-format date string contains a pipe separator (e.g., "1月29日(三) | 19:30~21:00"), THE Date_Parser SHALL ignore the time portion after the pipe and extract only the date portion.
4. IF a date string cannot be parsed by any supported format, THEN THE Date_Parser SHALL return null and log a warning with the unparseable string.
5. FOR ALL valid date strings, parsing to YYYY-MM-DD then re-parsing SHALL produce an equivalent date (round-trip property).

### Requirement 3: Event Data Mapping

**User Story:** As a system operator, I want scraped website events mapped to the existing Activities table format, so that Taiwan UG events are consistent with Meetup and Feishu-sourced activities.

#### Acceptance Criteria

1. THE Website_Scraper SHALL map each scraped event to the Activities_Table format with `activityType` set to the fixed value "线下活动".
2. THE Website_Scraper SHALL map the configured display name of the Sync_Source to the `ugName` field (e.g., "AWS UG Taiwan" for `https://tw.events.awsug.net/`).
3. THE Website_Scraper SHALL map the scraped event title to the `topic` field.
4. THE Website_Scraper SHALL map the parsed date (YYYY-MM-DD) to the `activityDate` field.
5. THE Website_Scraper SHALL generate the DedupeKey as `{topic}#{activityDate}#{ugName}`, consistent with the existing deduplication format used by Feishu and Meetup syncs.
6. THE Website_Scraper SHALL store the source website URL in the `sourceUrl` field of the activity record.

### Requirement 4: Past Event Filtering

**User Story:** As a system operator, I want only past/completed events synced, so that the Activities table contains only events that have already occurred.

#### Acceptance Criteria

1. WHEN an event on `awsug.com.tw` is marked "COMING SOON", THE Website_Scraper SHALL skip that event and exclude it from the sync results.
2. WHEN an event has a parsed date that is in the future (after today), THE Website_Scraper SHALL skip that event and exclude it from the sync results.
3. WHEN an event on `tw.events.awsug.net` has a status indicator of "已截止" (closed) or "已結束" (ended), THE Website_Scraper SHALL include that event in the sync results as a past event.
4. THE Website_Scraper SHALL log the count of skipped future/upcoming events separately from the count of synced past events.

### Requirement 5: Local Sync Script

**User Story:** As a system operator, I want a local sync script that scrapes Taiwan UG websites and writes events to DynamoDB, so that I can run the sync from my local machine to bypass potential IP blocking.

#### Acceptance Criteria

1. THE Taiwan_Sync_Script SHALL be located at `scripts/taiwan-ug-sync-local.ts` and executable via `npx tsx scripts/taiwan-ug-sync-local.ts`.
2. THE Taiwan_Sync_Script SHALL read the list of website sync sources from the Website_Sync_Config in DynamoDB, falling back to a hardcoded default list if no config exists.
3. THE Taiwan_Sync_Script SHALL iterate over each configured Sync_Source, invoke the Website_Scraper for each URL, and collect all extracted events.
4. FOR each extracted event, THE Taiwan_Sync_Script SHALL generate a DedupeKey, query the `dedupeKey-index` GSI to check for existing records, and write to the Activities_Table only if the DedupeKey does not exist.
5. THE Taiwan_Sync_Script SHALL log a summary at completion including total events found, synced count, and skipped count per source.
6. IF scraping fails for a specific source, THEN THE Taiwan_Sync_Script SHALL log the error for that source and continue processing remaining sources.
7. THE Taiwan_Sync_Script SHALL write each activity record with fields: `activityId` (ULID), `pk` ("ALL"), `activityType`, `ugName`, `topic`, `activityDate`, `dedupeKey`, `syncedAt` (ISO timestamp), and `sourceUrl`.

### Requirement 6: Website Sync Config Storage

**User Story:** As a SuperAdmin, I want website sync source configuration stored in DynamoDB, so that sources can be managed from the Settings page without code changes.

#### Acceptance Criteria

1. THE Admin_API SHALL store Website_Sync_Config in the Users table using the key `website-sync-config`.
2. THE Website_Sync_Config record SHALL contain: a list of Sync_Source entries (each with `url` and `displayName`), `updatedAt` (ISO timestamp), and `updatedBy` (user ID).
3. WHEN no Website_Sync_Config record exists in the Users table, THE Taiwan_Sync_Script SHALL use a hardcoded default list containing the two known Taiwan UG sources: `{ url: "https://tw.events.awsug.net/", displayName: "AWS UG Taiwan" }` and `{ url: "https://awsug.com.tw/ug/", displayName: "AWS UG DevSecOps TW" }`.
4. THE Website_Sync_Config SHALL support a minimum of 1 and a maximum of 20 Sync_Source entries.

### Requirement 7: Taiwan UG Sync Settings UI

**User Story:** As a SuperAdmin, I want a "Taiwan UG Sync" section in the Settings page, so that I can manage website sync sources and trigger manual syncs.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a "Taiwan UG Sync" section within the existing `activity-sync` category, below the Meetup sync section, visible only to SuperAdmin users.
2. THE Settings_Page SHALL display a list of configured Sync_Source entries showing each source's `displayName` and `url`.
3. THE Settings_Page SHALL provide an "Add Source" form with fields for `url` and `displayName`, and a remove button for each existing source.
4. THE Settings_Page SHALL provide a "Save" button that persists the Website_Sync_Config to the Users table via the Admin API.
5. THE Settings_Page SHALL provide a "Sync Now" button that triggers the Admin API to invoke the sync for all configured sources and displays the result (synced count, skipped count).
6. THE Settings_Page SHALL validate that each source URL starts with `https://` before saving.
7. THE Settings_Page SHALL display the last sync timestamp and result status when available.

### Requirement 8: Admin API for Website Sync Config

**User Story:** As a SuperAdmin, I want API endpoints to read and update website sync configuration and trigger syncs, so that the Settings page can manage website sync sources.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends a GET request to the website sync config endpoint, THE Admin_API SHALL return the current Website_Sync_Config.
2. WHEN a SuperAdmin sends a PUT request with updated Website_Sync_Config data, THE Admin_API SHALL validate the input (URL format starting with `https://`, displayName non-empty, max 20 sources) and persist the configuration to the Users table.
3. WHEN a non-SuperAdmin user sends a request to the website sync config endpoint, THE Admin_API SHALL return a 403 Forbidden response.
4. WHEN a SuperAdmin sends a POST request to the website sync trigger endpoint, THE Admin_API SHALL invoke the sync function and return the sync result including synced count and skipped count.

### Requirement 9: SPA Website Handling

**User Story:** As a system operator, I want the scraper to handle SPA (Single Page Application) websites that render content via JavaScript, so that events from `awsug.com.tw` are also captured.

#### Acceptance Criteria

1. WHEN the target website is a known SPA (e.g., `awsug.com.tw`), THE Website_Scraper SHALL attempt to discover and fetch the underlying API endpoint or pre-rendered data source instead of parsing the initial HTML shell.
2. IF the SPA website provides a JSON API endpoint, THEN THE Website_Scraper SHALL fetch and parse the JSON response directly.
3. IF no API endpoint is discoverable, THEN THE Website_Scraper SHALL fall back to parsing whatever HTML content is available from the initial page load and log a warning about potentially incomplete data.

### Requirement 10: No Scheduled Sync

**User Story:** As a system operator, I want the Taiwan UG sync to be manual-trigger only, so that there is no automated scheduled execution that could fail silently.

#### Acceptance Criteria

1. THE Taiwan_Sync_Script SHALL NOT be registered with EventBridge or any other scheduled trigger mechanism.
2. THE Taiwan_Sync_Script SHALL only execute when manually triggered by a SuperAdmin via the Settings page "Sync Now" button or by running the local script directly from the command line.

### Requirement 11: Website Sync i18n Support

**User Story:** As a user of any supported language, I want all website sync UI text translated, so that the interface is consistent with the rest of the application.

#### Acceptance Criteria

1. THE Settings_Page SHALL use i18n translation keys for all Taiwan UG sync UI text including labels, placeholders, button text, success messages, and error messages.
2. THE i18n system SHALL provide translations for Taiwan UG sync text in all 5 supported languages: zh (Simplified Chinese), en (English), zh-TW (Traditional Chinese), ja (Japanese), and ko (Korean).

### Requirement 12: Error Handling and Resilience

**User Story:** As a system operator, I want the website sync to handle errors gracefully, so that failures in one source do not affect other sources or system stability.

#### Acceptance Criteria

1. IF a specific website source returns an error during scraping, THEN THE Taiwan_Sync_Script SHALL log the error with the source URL and display name, and continue processing remaining sources.
2. IF the HTML structure of a website changes and events cannot be parsed, THEN THE Website_Scraper SHALL return an empty event list and log a warning indicating the parsing yielded no results.
3. IF a scraped event is missing required fields (title or date), THEN THE Website_Scraper SHALL skip that event and log a warning for each skipped event.
4. THE Taiwan_Sync_Script SHALL log the start time, end time, and result summary for each sync execution to enable operational monitoring.
