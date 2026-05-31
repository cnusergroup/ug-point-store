# Requirements Document

## Introduction

The Inactive UGL Report feature provides SuperAdmin users with a quarterly report identifying User Group Leaders (UGLs) who have not earned any points in their UGL or SpecialActivity capacity during a given quarter. The report helps administrators identify disengaged community leaders for follow-up. It integrates into the existing reports page as a new tab, supports quarter-based filtering, and allows CSV/Excel export via the existing export mechanism.

## Glossary

- **Inactive_UGL_Service**: The backend module responsible for querying active UGL users, determining which ones have no qualifying points records in the selected quarter, and returning the inactive UGL list with enrichment data.
- **Inactive_UGL_Tab**: The frontend tab within the reports page that displays the inactive UGL report with quarter selection and export functionality.
- **Quarter**: A three-month calendar period defined as Q1 (January–March), Q2 (April–June), Q3 (July–September), Q4 (October–December) of a given year.
- **Quarter_Start**: The first millisecond of the first day of a quarter (e.g., 2026-04-01T00:00:00.000Z for Q2 2026).
- **Quarter_End**: The last millisecond of the last day of a quarter (e.g., 2026-06-30T23:59:59.999Z for Q2 2026).
- **Active_UGL**: A user whose `roles` array contains `UserGroupLeader`, whose `status` is `active`, and whose `createdAt` is strictly before the Quarter_Start of the selected quarter.
- **Qualifying_Record**: A PointsRecord with `type='earn'` and `targetRole` equal to `UserGroupLeader` or `SpecialActivity`, with `createdAt` falling within the selected quarter date range.
- **Inactive_UGL**: An Active_UGL who has zero Qualifying_Records in the selected quarter.
- **Last_Active_Date**: The `createdAt` timestamp of the most recent Qualifying_Record for a given user across all time, used as enrichment data in the report.
- **SuperAdmin**: A user with the `SuperAdmin` role, the only role authorized to access the inactive UGL report.
- **Export_Service**: The existing backend module that generates CSV/Excel files, uploads to S3, and returns a presigned download URL.

## Requirements

### Requirement 1: SuperAdmin Authorization

**User Story:** As a SuperAdmin, I want only SuperAdmin users to access the inactive UGL report, so that sensitive personnel data is protected from unauthorized access.

#### Acceptance Criteria

1. WHEN a non-SuperAdmin user requests the inactive UGL report API endpoint, THE Inactive_UGL_Service SHALL return a 403 Forbidden error with code `FORBIDDEN`.
2. WHEN a non-SuperAdmin user navigates to the reports page, THE Inactive_UGL_Tab SHALL not be visible in the tab list.

### Requirement 2: Quarter Parameter Validation

**User Story:** As a SuperAdmin, I want the system to validate the quarter parameter, so that only valid quarter values are accepted.

#### Acceptance Criteria

1. THE Inactive_UGL_Service SHALL accept a `quarter` query parameter in the format `YYYY-QN` where YYYY is a four-digit year and N is 1, 2, 3, or 4.
2. WHEN the `quarter` parameter is missing, THE Inactive_UGL_Service SHALL default to the current calendar quarter.
3. WHEN the `quarter` parameter does not match the `YYYY-QN` format, THE Inactive_UGL_Service SHALL return a 400 error with code `INVALID_QUARTER_FORMAT`.
4. WHEN the `quarter` parameter references a future quarter that has not yet started, THE Inactive_UGL_Service SHALL return a 400 error with code `FUTURE_QUARTER`.

### Requirement 3: Identify Eligible UGL Users

**User Story:** As a SuperAdmin, I want the report to only include UGLs who were registered before the quarter started, so that newly joined UGLs are not unfairly flagged as inactive.

#### Acceptance Criteria

1. THE Inactive_UGL_Service SHALL retrieve all users whose `roles` array contains `UserGroupLeader` and whose `status` is `active`.
2. THE Inactive_UGL_Service SHALL exclude users whose `createdAt` timestamp is greater than or equal to the Quarter_Start of the selected quarter.
3. THE Inactive_UGL_Service SHALL use the user's account `createdAt` field from the Users table to determine eligibility.

### Requirement 4: Determine Inactive UGLs

**User Story:** As a SuperAdmin, I want the system to identify UGLs with no qualifying activity in the quarter, so that I can follow up with disengaged leaders.

#### Acceptance Criteria

1. THE Inactive_UGL_Service SHALL query PointsRecords with `type='earn'` and `createdAt` between Quarter_Start and Quarter_End (inclusive).
2. THE Inactive_UGL_Service SHALL filter queried records to include only those with `targetRole` equal to `UserGroupLeader` or `SpecialActivity`.
3. THE Inactive_UGL_Service SHALL collect the set of unique `userId` values from the filtered records as the active user set.
4. THE Inactive_UGL_Service SHALL compute the inactive UGL list as eligible UGL users whose `userId` is not in the active user set.

### Requirement 5: Enrich Inactive UGL Records

**User Story:** As a SuperAdmin, I want to see each inactive UGL's profile details and last activity date, so that I have context for follow-up decisions.

#### Acceptance Criteria

1. FOR each Inactive_UGL, THE Inactive_UGL_Service SHALL return the following fields: nickname, email, UG name (from the user's UG assignment), and account createdAt timestamp.
2. FOR each Inactive_UGL, THE Inactive_UGL_Service SHALL query the most recent PointsRecord with `type='earn'` and `targetRole` in (`UserGroupLeader`, `SpecialActivity`) to determine the Last_Active_Date.
3. WHEN an Inactive_UGL has no historical Qualifying_Record, THE Inactive_UGL_Service SHALL return the Last_Active_Date as null.

### Requirement 6: Quarter Selector UI

**User Story:** As a SuperAdmin, I want a quarter selector that defaults to the current quarter and allows switching to past quarters, so that I can review historical inactivity data.

#### Acceptance Criteria

1. THE Inactive_UGL_Tab SHALL display a quarter selector control defaulting to the current calendar quarter.
2. THE Inactive_UGL_Tab SHALL allow the SuperAdmin to select any past quarter from a dropdown list.
3. WHEN the SuperAdmin selects a different quarter, THE Inactive_UGL_Tab SHALL re-fetch the report data for the newly selected quarter.
4. THE Inactive_UGL_Tab SHALL display the selected quarter in the format `YYYY-QN` (e.g., `2026-Q2`).

### Requirement 7: Report Data Display

**User Story:** As a SuperAdmin, I want the inactive UGL list displayed in a table with relevant columns, so that I can quickly scan the data.

#### Acceptance Criteria

1. THE Inactive_UGL_Tab SHALL display a table with columns: nickname, email, UG name, account registration date, and last UGL/SpecialActivity points date.
2. WHEN the report returns zero inactive UGLs, THE Inactive_UGL_Tab SHALL display an empty state message indicating all UGLs were active in the selected quarter.
3. THE Inactive_UGL_Tab SHALL display the total count of inactive UGLs above the table.

### Requirement 8: CSV and Excel Export

**User Story:** As a SuperAdmin, I want to export the inactive UGL report as CSV or Excel, so that I can share the data with other stakeholders or process it externally.

#### Acceptance Criteria

1. THE Inactive_UGL_Tab SHALL provide export buttons for CSV and Excel formats.
2. WHEN the SuperAdmin clicks an export button, THE Inactive_UGL_Tab SHALL send a POST request to the export API with `reportType='inactive-ugl'` and the current quarter filter.
3. THE Export_Service SHALL generate the export file containing all inactive UGL records for the selected quarter with the same columns as the table display.
4. THE Export_Service SHALL upload the generated file to S3 and return a presigned download URL.
5. WHEN the export completes, THE Inactive_UGL_Tab SHALL trigger a file download using the presigned URL.

### Requirement 9: Reports Page Tab Integration

**User Story:** As a SuperAdmin, I want the inactive UGL report accessible as a new tab on the existing reports page, so that it is discoverable alongside other reports.

#### Acceptance Criteria

1. THE reports page SHALL include a new tab labeled with the i18n key `admin.reports.tabInactiveUGL` positioned after the existing tabs.
2. WHEN the SuperAdmin selects the inactive UGL tab, THE reports page SHALL render the Inactive_UGL_Tab content with its quarter selector and data table.
3. THE Inactive_UGL_Tab SHALL follow the same layout patterns (filter panel, data table, export buttons) as existing report tabs.

### Requirement 10: Internationalization

**User Story:** As a SuperAdmin using the system in different languages, I want all UI text in the inactive UGL report to be localized, so that the interface is usable in all supported languages.

#### Acceptance Criteria

1. THE Inactive_UGL_Tab SHALL provide i18n translations for all user-visible text including tab label, column headers, empty state message, quarter selector label, and export button labels.
2. THE Inactive_UGL_Tab SHALL support all 5 existing locale files used by the application.
3. THE Export_Service SHALL use localized column headers in the exported CSV/Excel file matching the user's current locale.

### Requirement 11: API Endpoint Design

**User Story:** As a SuperAdmin, I want a dedicated API endpoint for the inactive UGL report, so that the frontend can fetch report data efficiently.

#### Acceptance Criteria

1. THE Inactive_UGL_Service SHALL expose a GET endpoint at `/api/admin/reports/inactive-ugl` accepting a `quarter` query parameter.
2. THE Inactive_UGL_Service SHALL return a JSON response with `success: true` and a `records` array containing the inactive UGL data.
3. IF an internal error occurs during query execution, THEN THE Inactive_UGL_Service SHALL return a JSON response with `success: false` and an error object containing `code` and `message` fields.
4. THE Inactive_UGL_Service SHALL complete the query within 10 seconds for up to 500 eligible UGL users.
