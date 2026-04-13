# Requirements Document

## Introduction

This feature adds two SuperAdmin-exclusive management capabilities to the existing admin settings page (`/pages/admin/settings`): **SuperAdmin Transfer** and **Invite Link Expiry Configuration**. SuperAdmin Transfer allows the current SuperAdmin to securely hand off the SuperAdmin role to another Admin user, ensuring there is always exactly one SuperAdmin. Invite Link Expiry Configuration allows the SuperAdmin to set a global default expiry duration for invite links (1, 3, or 7 days), stored as a system-wide setting. All Admin users who generate invites will automatically use the SuperAdmin-configured expiry — no per-form selection is needed.

## Glossary

- **SuperAdmin**: The single user holding the `SuperAdmin` role. Has the highest privilege level in the system.
- **Admin**: A user holding the `Admin` role. Can perform most administrative operations but cannot access SuperAdmin-exclusive features.
- **Transfer_API**: The backend API endpoint (`POST /api/admin/superadmin/transfer`) that executes the SuperAdmin role transfer atomically.
- **Settings_Page**: The existing frontend page (`/pages/admin/settings`) where SuperAdmin manages system configuration. This feature adds two new sections to this page.
- **Invite_Settings**: A global configuration record stored in DynamoDB (key: `invite-settings` in the Users table) containing `inviteExpiryDays` (1, 3, or 7).
- **Password_Confirmation**: The step requiring the caller to provide their current password to authorize a high-security operation.
- **Invite_Record**: A DynamoDB record in the Invites table representing a single invite token, including its `expiresAt` timestamp.

## Requirements

### Requirement 1: SuperAdmin Transfer — Settings Page Section

**User Story:** As a SuperAdmin, I want a dedicated transfer section in the settings page, so that I can hand off the SuperAdmin role when needed.

#### Acceptance Criteria

1. WHEN a user with the SuperAdmin role opens the settings page, THE Settings_Page SHALL display a SuperAdmin Transfer section below the existing settings.
2. WHILE a user does not hold the SuperAdmin role, THE Settings_Page SHALL hide the SuperAdmin Transfer section from that user.
3. THE SuperAdmin Transfer section SHALL display a list of users who currently hold the Admin role as eligible transfer targets.
4. IF no users with the Admin role exist, THEN THE SuperAdmin Transfer section SHALL display a message indicating no eligible transfer targets are available and disable the transfer action.

### Requirement 2: SuperAdmin Transfer — Target Selection and Password Confirmation

**User Story:** As a SuperAdmin, I want to select a target Admin user and confirm my password before transferring, so that unauthorized transfers are prevented.

#### Acceptance Criteria

1. WHEN the SuperAdmin selects a transfer target, THE Settings_Page SHALL display the selected user's nickname and email for confirmation.
2. THE Settings_Page SHALL exclude the current SuperAdmin from the list of eligible transfer targets.
3. WHEN the SuperAdmin initiates a transfer, THE Settings_Page SHALL prompt the SuperAdmin to enter their current password.
4. WHEN the SuperAdmin submits the transfer with a correct password, THE Transfer_API SHALL proceed with the transfer operation.
5. IF the SuperAdmin submits an incorrect password, THEN THE Transfer_API SHALL reject the request and return a password verification failure error.
6. THE Transfer_API SHALL use the same bcrypt comparison mechanism used by the login flow to verify the password.

### Requirement 3: SuperAdmin Transfer — Atomic Role Swap

**User Story:** As a SuperAdmin, I want the transfer to atomically swap roles between me and the target, so that there is always exactly one SuperAdmin in the system.

#### Acceptance Criteria

1. WHEN a valid transfer request is received, THE Transfer_API SHALL remove the SuperAdmin role from the caller and add it to the target user.
2. WHEN a valid transfer request is received, THE Transfer_API SHALL demote the caller to Admin role (preserving any other existing roles the caller holds).
3. THE Transfer_API SHALL ensure that at no point during the transfer do zero or two users hold the SuperAdmin role simultaneously.
4. WHEN the transfer completes, THE Transfer_API SHALL update the `rolesVersion` timestamp on both the caller and the target user records to invalidate cached auth tokens.
5. IF the target user does not exist or does not hold the Admin role at the time of execution, THEN THE Transfer_API SHALL reject the request and return an appropriate error.
6. IF the caller does not hold the SuperAdmin role, THEN THE Transfer_API SHALL reject the request with a forbidden error.

### Requirement 4: SuperAdmin Transfer — Post-Transfer Behavior

**User Story:** As a former SuperAdmin, I want to be redirected appropriately after the transfer, so that I understand my role has changed.

#### Acceptance Criteria

1. WHEN the transfer succeeds, THE Settings_Page SHALL display a success message indicating the SuperAdmin role has been transferred.
2. WHEN the transfer succeeds, THE Settings_Page SHALL update the local user state (store) to reflect the caller's new Admin role.
3. WHEN the transfer succeeds, THE Settings_Page SHALL redirect the former SuperAdmin to the admin dashboard after a brief delay.

### Requirement 5: Invite Link Expiry — Global Configuration

**User Story:** As a SuperAdmin, I want to set a global default expiry duration for invite links, so that all Admin users generate invites with the same controlled expiry.

#### Acceptance Criteria

1. WHEN a user with the SuperAdmin role opens the settings page, THE Settings_Page SHALL display an Invite Expiry section with three selectable options: 1 day, 3 days, and 7 days.
2. THE Settings_Page SHALL show the currently active expiry option as selected.
3. IF no expiry setting has been configured, THE Settings_Page SHALL default to displaying 1 day as the active option.
4. WHILE a user does not hold the SuperAdmin role, THE Settings_Page SHALL hide the Invite Expiry section from that user.
5. WHEN the SuperAdmin selects a new expiry option, THE Settings_Page SHALL immediately save the selection to the backend and show a success confirmation.

### Requirement 6: Invite Link Expiry — Backend Application

**User Story:** As an Admin user, I want the invites I generate to automatically use the SuperAdmin-configured expiry, so that I don't need to manually select it each time.

#### Acceptance Criteria

1. WHEN the batch invite generation API is called, THE API SHALL read the current `inviteExpiryDays` from the Invite_Settings record and use it to compute `expiresAt` for each Invite_Record.
2. IF the Invite_Settings record does not exist, THEN THE API SHALL default to 1 day (86400000 ms) for backward compatibility.
3. THE invite generation form SHALL NOT display an expiry selector — the expiry is determined entirely by the global setting.

### Requirement 7: Internationalization

**User Story:** As a user of any supported language, I want all new UI text to be translated, so that the interface is consistent in my language.

#### Acceptance Criteria

1. THE SuperAdmin Transfer section SHALL provide i18n keys for all displayed text in all supported languages (zh, zh-TW, en, ja, ko).
2. THE Invite Expiry section SHALL provide i18n keys for all option labels and related text in all supported languages.
