# Requirements Document

## Introduction

Extend the existing activity sync system to fetch events from Meetup.com groups via Meetup's GraphQL API, adding Meetup as a second data source alongside the existing Feishu Bitable sync. The system syncs both PAST and UPCOMING events from configured Meetup groups, maps them to the existing Activities table format, and provides SuperAdmin UI for managing Meetup sync configuration (group URLs, cookie-based authentication, manual sync triggers).

## Glossary

- **Sync_Lambda**: The existing Lambda function (`PointsMall-Sync`) that orchestrates activity data synchronization from external sources into the Activities table.
- **Meetup_Client**: A new module responsible for sending GraphQL queries to the Meetup API endpoint (`https://www.meetup.com/gql2`) and returning parsed event data.
- **Meetup_Sync_Config**: A configuration record stored in the DynamoDB Users table (key: `meetup-sync-config`) containing Meetup group URLs and authentication cookies.
- **Activities_Table**: The existing DynamoDB table (`PointsMall-Activities`) storing all synced activity records with `dedupeKey-index` GSI for deduplication.
- **Settings_Page**: The existing SuperAdmin settings page (`/pages/admin/settings`) where system configuration is managed.
- **Cookie_Auth**: Authentication mechanism using three cookie values (token, csrf, session) sent as HTTP headers to the Meetup GraphQL API.
- **DedupeKey**: A composite key `{topic}#{activityDate}#{ugName}` used to prevent duplicate activity records across sync runs.
- **GraphQL_Pagination**: Meetup's cursor-based pagination using `pageInfo.hasNextPage` and `endCursor` fields to retrieve all events across multiple pages.

## Requirements

### Requirement 1: Meetup GraphQL Client

**User Story:** As a system operator, I want the sync system to fetch event data from Meetup.com groups via GraphQL API, so that Meetup events are available in the Activities table.

#### Acceptance Criteria

1. WHEN a valid urlname and Cookie_Auth credentials are provided, THE Meetup_Client SHALL send a GraphQL query to `https://www.meetup.com/gql2` and return parsed event data including id, title, dateTime, eventUrl, going.totalCount, and venue information.
2. THE Meetup_Client SHALL query both PAST and UPCOMING event statuses for each group, combining results into a single event list.
3. WHEN the GraphQL response contains `pageInfo.hasNextPage` equal to true, THE Meetup_Client SHALL send subsequent requests using the `endCursor` value until all pages are retrieved.
4. THE Meetup_Client SHALL request 20 events per page (matching Meetup's default page size).
5. WHEN the Meetup GraphQL API returns an HTTP error or GraphQL errors array, THE Meetup_Client SHALL return a failure result containing the error code and message.
6. WHEN Cookie_Auth credentials are expired or invalid (HTTP 401 or 403), THE Meetup_Client SHALL return a failure result with error code `MEETUP_AUTH_EXPIRED`.

### Requirement 2: Meetup Event Data Mapping

**User Story:** As a system operator, I want Meetup events mapped to the existing Activities table format, so that Meetup events are consistent with Feishu-sourced activities.

#### Acceptance Criteria

1. THE Meetup_Client SHALL map each Meetup event to the Activities_Table format with `activityType` set to the fixed value "线下活动".
2. THE Meetup_Client SHALL map the Meetup group name to the `ugName` field using a configurable display name (e.g., "AWS UGHK" for urlname `hong-kong-amazon-aws-user-group`).
3. THE Meetup_Client SHALL map the Meetup event `title` field to the `topic` field.
4. THE Meetup_Client SHALL extract the date portion (YYYY-MM-DD) from the Meetup event `dateTime` field and map it to the `activityDate` field.
5. THE Meetup_Client SHALL generate the DedupeKey as `{topic}#{activityDate}#{ugName}`, consistent with the existing Feishu sync deduplication format.
6. THE Meetup_Client SHALL preserve additional Meetup-specific fields (`going.totalCount`, `venue.name`, `venue.city`, `eventUrl`) in the activity record for reference.

### Requirement 3: Meetup Sync Config Storage

**User Story:** As a SuperAdmin, I want Meetup sync configuration stored securely in DynamoDB, so that credentials are not hardcoded and can be updated at runtime.

#### Acceptance Criteria

1. THE Sync_Lambda SHALL read Meetup_Sync_Config from the Users table using the key `meetup-sync-config`.
2. THE Meetup_Sync_Config record SHALL contain: a list of Meetup group entries (each with `urlname` and `displayName`), cookie authentication fields (`meetupToken`, `meetupCsrf`, `meetupSession`), an `autoSyncEnabled` boolean toggle (default `false`), and reserved OAuth2 fields (`clientId`, `clientSecret`, `refreshToken`).
3. WHEN no Meetup_Sync_Config record exists in the Users table, THE Sync_Lambda SHALL skip Meetup sync without error and proceed with Feishu sync only.
4. WHEN the Meetup_Sync_Config record exists but cookie fields are empty, THE Sync_Lambda SHALL skip Meetup sync and log a warning message.

### Requirement 4: Independent Sync Execution

**User Story:** As a SuperAdmin, I want Feishu sync and Meetup sync to be independent operations with separate trigger buttons, so that I can run each sync source independently.

#### Acceptance Criteria

1. THE Sync_Lambda SHALL accept a `source` parameter in the invocation payload, with values `feishu`, `meetup`, or `all` (default `all` for EventBridge scheduled triggers).
2. WHEN `source` is `feishu`, THE Sync_Lambda SHALL execute only Feishu sync and skip Meetup sync.
3. WHEN `source` is `meetup`, THE Sync_Lambda SHALL execute only Meetup sync and skip Feishu sync.
4. WHEN `source` is `all` (EventBridge scheduled trigger), THE Sync_Lambda SHALL execute Feishu sync first, then execute Meetup sync only if `autoSyncEnabled` is `true` in the Meetup_Sync_Config.
5. IF Meetup sync fails for a specific group, THEN THE Sync_Lambda SHALL log the error for that group and continue syncing remaining groups.
6. IF Meetup Cookie_Auth credentials are expired, THEN THE Sync_Lambda SHALL return a failure result with error code `MEETUP_AUTH_EXPIRED` and a descriptive warning message.
7. FOR each Meetup event, THE Sync_Lambda SHALL generate a DedupeKey, query the `dedupeKey-index` GSI to check for existing records, and write to the Activities_Table only if the DedupeKey does not exist.
8. THE Sync_Lambda SHALL return a sync result including `syncedCount`, `skippedCount`, `source`, and any warning messages.

### Requirement 5: Meetup Settings UI

**User Story:** As a SuperAdmin, I want a Meetup configuration section in the Settings page with an independent sync button, so that I can manage Meetup sync separately from Feishu sync.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a "Meetup Sync" section as a separate card/block below the existing "Feishu Activity Sync" section, visible only to SuperAdmin users.
2. THE Settings_Page SHALL display a list of configured Meetup groups showing each group's `displayName` and `urlname`.
3. THE Settings_Page SHALL provide an "Add Group" form with fields for `urlname` and `displayName`, and a remove button for each existing group.
4. THE Settings_Page SHALL display three password-masked input fields for Cookie_Auth values: token, csrf, and session.
5. THE Settings_Page SHALL provide a "Save" button that persists the Meetup_Sync_Config to the Users table via the Admin API.
6. THE Settings_Page SHALL provide a "Test Connection" button that sends a lightweight GraphQL query to verify Cookie_Auth credentials are valid, displaying success or failure feedback.
7. THE Settings_Page SHALL provide a "Sync Meetup" button (independent from the existing "Sync Feishu" button) that triggers a manual Meetup-only sync and displays the result (synced count, skipped count, warnings).
8. THE existing Feishu sync section SHALL have its own "Sync Feishu" button that triggers Feishu-only sync (refactored from the current combined sync button).
9. THE Settings_Page SHALL display the last Meetup sync timestamp and result status independently from Feishu sync status.

### Requirement 6: Meetup Settings i18n Support

**User Story:** As a user of any supported language, I want all Meetup sync UI text translated, so that the interface is consistent with the rest of the application.

#### Acceptance Criteria

1. THE Settings_Page SHALL use i18n translation keys for all Meetup sync UI text including labels, placeholders, button text, success messages, and error messages.
2. THE i18n system SHALL provide translations for Meetup sync text in all 5 supported languages: zh (Simplified Chinese), en (English), zh-TW (Traditional Chinese), ja (Japanese), and ko (Korean).

### Requirement 7: Admin API for Meetup Config

**User Story:** As a SuperAdmin, I want API endpoints to read and update Meetup sync configuration, so that the Settings page can manage Meetup settings.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends a GET request to the Meetup config endpoint, THE Admin_Lambda SHALL return the current Meetup_Sync_Config with cookie values masked (showing only the last 4 characters).
2. WHEN a SuperAdmin sends a PUT request with updated Meetup_Sync_Config data, THE Admin_Lambda SHALL validate the input and persist the configuration to the Users table.
3. WHEN a non-SuperAdmin user sends a request to the Meetup config endpoint, THE Admin_Lambda SHALL return a 403 Forbidden response.
4. WHEN a SuperAdmin sends a POST request to the test-connection endpoint with Cookie_Auth values, THE Admin_Lambda SHALL invoke the Meetup_Client to verify the credentials and return the validation result.

### Requirement 8: Security and Credential Protection

**User Story:** As a repository maintainer, I want Meetup credentials protected from exposure, so that the public GitHub repository does not contain secrets.

#### Acceptance Criteria

1. THE source code SHALL NOT contain any hardcoded Meetup cookie values, API keys, or authentication tokens.
2. THE Sync_Lambda SHALL read all Meetup credentials from DynamoDB at runtime.
3. THE Settings_Page SHALL render cookie input fields with password masking (type="password") to prevent shoulder-surfing.
4. THE Admin API SHALL mask cookie values in GET responses, returning only the last 4 characters of each cookie value prefixed with asterisks.
5. IF a PUT request to the Meetup config endpoint contains a masked cookie value (asterisks prefix), THEN THE Admin_Lambda SHALL retain the existing stored value for that field instead of overwriting it.

### Requirement 9: Error Handling and Resilience

**User Story:** As a system operator, I want the Meetup sync to handle errors gracefully, so that failures in Meetup sync do not affect Feishu sync or system stability.

#### Acceptance Criteria

1. IF the Meetup GraphQL API is unreachable (network timeout or DNS failure), THEN THE Meetup_Client SHALL return a failure result after a 10-second timeout.
2. IF a specific Meetup group returns an error (e.g., group not found, private group), THEN THE Sync_Lambda SHALL log the error with the group urlname and continue processing remaining groups.
3. IF the Meetup GraphQL response contains partial data (some events missing fields), THEN THE Meetup_Client SHALL skip malformed events and log a warning for each skipped event.
4. THE Sync_Lambda SHALL log the start time, end time, and result summary for each Meetup sync execution to enable operational monitoring.
