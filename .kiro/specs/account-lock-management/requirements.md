# Requirements Document

## Introduction

The account lock management feature addresses several issues with the current login lock mechanism and admin tooling. The current `loginFailCount` accumulates indefinitely without a time window, meaning sporadic failures over days can lock a user out. The frontend shows a generic error message when an account is locked instead of using the `lockRemainingMs` data already returned by the backend. Additionally, SuperAdmin lacks the ability to manually unlock locked accounts or see which accounts are currently locked in the user management page.

This feature covers four areas:
1. Sliding-window login failure counting with automatic reset after lock expiry
2. Dynamic lock remaining time display on the login page
3. SuperAdmin manual unlock capability
4. Locked status visibility in the admin user management list

## Glossary

- **Login_Service**: The backend authentication module responsible for processing login requests, validating credentials, and managing account lock state (`packages/backend/src/auth/login.ts`).
- **Login_Page**: The frontend login page that collects credentials and displays login errors (`packages/frontend/src/pages/login/index.tsx`).
- **User_Management_API**: The backend admin API for listing users and managing user status (`packages/backend/src/admin/users.ts`).
- **User_Management_Page**: The frontend admin page for viewing and managing user accounts (`packages/frontend/src/pages/admin/users.tsx`).
- **Sliding_Window**: A time-based failure counting mechanism where only failures within a recent configurable period (e.g., 15 minutes) count toward the lock threshold.
- **Lock_Threshold**: The maximum number of login failures within the Sliding_Window before the account is locked. Currently set to 5 (`MAX_LOGIN_FAILURES`).
- **Lock_Duration**: The period an account remains locked after reaching the Lock_Threshold. Currently set to 15 minutes (`LOCK_DURATION_MS`).
- **SuperAdmin**: The highest-privilege administrator role in the system, the only role authorized to manually unlock accounts.
- **lockRemainingMs**: A numeric field in the backend error response indicating the remaining lock time in milliseconds when an account is locked.
- **loginFailCount**: A counter on the user record tracking consecutive failed login attempts.
- **lockUntil**: A timestamp on the user record indicating when the current lock period expires.
- **firstFailAt**: A new timestamp field on the user record marking when the first failure in the current Sliding_Window occurred.

## Requirements

### Requirement 1: Sliding-Window Failure Counting

**User Story:** As a user, I want my failed login attempts to only count within a recent time window, so that sporadic mistakes over days do not lock me out.

#### Acceptance Criteria

1. WHEN a login attempt fails and no prior failure exists within the Sliding_Window, THE Login_Service SHALL record the current timestamp as `firstFailAt` and set `loginFailCount` to 1.
2. WHEN a login attempt fails and `firstFailAt` is older than 15 minutes, THE Login_Service SHALL reset `firstFailAt` to the current timestamp and set `loginFailCount` to 1.
3. WHEN a login attempt fails and `firstFailAt` is within the last 15 minutes, THE Login_Service SHALL increment `loginFailCount` by 1.
4. WHEN `loginFailCount` reaches the Lock_Threshold (5) within the Sliding_Window, THE Login_Service SHALL set `lockUntil` to the current time plus Lock_Duration (15 minutes), set `status` to `locked`, and return an `ACCOUNT_LOCKED` error with `lockRemainingMs`.
5. WHEN a login attempt succeeds, THE Login_Service SHALL reset `loginFailCount` to 0, remove `lockUntil`, remove `firstFailAt`, and set `status` to `active`.

### Requirement 2: Automatic Reset After Lock Expiry

**User Story:** As a user, I want my failure count and lock state to reset automatically after the lock period expires, so that I can log in again without admin intervention.

#### Acceptance Criteria

1. WHEN a login attempt is made and `lockUntil` exists but is in the past, THE Login_Service SHALL reset `loginFailCount` to 0, remove `lockUntil`, remove `firstFailAt`, and set `status` to `active` before proceeding with credential validation.
2. WHEN a login attempt is made and `lockUntil` exists and is in the future, THE Login_Service SHALL reject the attempt with an `ACCOUNT_LOCKED` error and include `lockRemainingMs` in the response.

### Requirement 3: Dynamic Lock Message on Login Page

**User Story:** As a user, I want to see how many minutes remain before I can try again when my account is locked, so that I know when to retry.

#### Acceptance Criteria

1. WHEN the Login_Page receives an `ACCOUNT_LOCKED` error response, THE Login_Page SHALL extract `lockRemainingMs` from the response data.
2. WHEN `lockRemainingMs` is available, THE Login_Page SHALL display a localized message showing the remaining lock time in minutes (rounded up), such as "账号已锁定，请 X 分钟后重试".
3. IF `lockRemainingMs` is not available in the response, THEN THE Login_Page SHALL fall back to a generic lock message without a specific time.
4. THE Login_Page SHALL support the dynamic lock message in all 5 system languages: zh, en, ja, ko, zh-TW.

### Requirement 4: Pass lockRemainingMs Through RequestError

**User Story:** As a frontend developer, I want the request utility to carry extra error data from the backend response, so that the login page can access `lockRemainingMs`.

#### Acceptance Criteria

1. WHEN the backend returns an error response containing additional fields beyond `code` and `message`, THE RequestError class SHALL preserve those extra fields in an accessible `data` property.
2. WHEN the Login_Page catches a RequestError with code `ACCOUNT_LOCKED`, THE Login_Page SHALL read `lockRemainingMs` from the error's `data` property.

### Requirement 5: SuperAdmin Manual Unlock API

**User Story:** As a SuperAdmin, I want to manually unlock a locked user account via the admin API, so that I can help users who are locked out.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends an unlock request for a locked user, THE User_Management_API SHALL set `loginFailCount` to 0, remove `lockUntil`, remove `firstFailAt`, and set `status` to `active`.
2. WHEN a non-SuperAdmin sends an unlock request, THE User_Management_API SHALL reject the request with a `FORBIDDEN` error.
3. WHEN an unlock request targets a user that is not currently locked, THE User_Management_API SHALL return a success response without modifying the user record.
4. WHEN an unlock request targets a non-existent user, THE User_Management_API SHALL return a `USER_NOT_FOUND` error.

### Requirement 6: Unlock Button in Admin User Management Page

**User Story:** As a SuperAdmin, I want an unlock button on locked user accounts in the user management page, so that I can quickly unlock accounts without using the API directly.

#### Acceptance Criteria

1. WHILE the current admin is a SuperAdmin and a user's status is `locked`, THE User_Management_Page SHALL display an unlock button in the user's action area.
2. WHEN the SuperAdmin clicks the unlock button, THE User_Management_Page SHALL send an unlock request to the User_Management_API and refresh the user list upon success.
3. WHEN the unlock request succeeds, THE User_Management_Page SHALL display a localized success toast message.
4. IF the unlock request fails, THEN THE User_Management_Page SHALL display a localized error toast message.
5. WHILE the current admin is not a SuperAdmin, THE User_Management_Page SHALL NOT display the unlock button for any user.

### Requirement 7: Locked Status Visibility in Admin User List

**User Story:** As a SuperAdmin, I want to see which accounts are currently locked in the user management list, so that I can identify and help affected users.

#### Acceptance Criteria

1. THE User_Management_API SHALL include `locked` as a valid value in the `status` field of user list responses.
2. WHEN a user's status is `locked`, THE User_Management_Page SHALL display a distinct visual indicator (badge/tag) styled differently from `active` and `disabled` statuses.
3. THE User_Management_Page SHALL display the locked status badge in a warning color to distinguish it from the green `active` badge and red `disabled` badge.
4. THE User_Management_Page SHALL support the locked status label in all 5 system languages: zh, en, ja, ko, zh-TW.

### Requirement 8: Internationalization for All New UI Text

**User Story:** As a user of any supported language, I want all new lock-related messages and labels to be displayed in my language, so that I can understand the system status.

#### Acceptance Criteria

1. THE Login_Page SHALL use a parameterized i18n key for the lock message that accepts a `minutes` parameter for dynamic time display.
2. THE User_Management_Page SHALL use i18n keys for the unlock button label, unlock success message, unlock failure message, and locked status label.
3. FOR ALL new i18n keys, THE system SHALL provide translations in zh, en, ja, ko, and zh-TW.
