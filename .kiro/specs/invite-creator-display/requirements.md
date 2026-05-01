# Requirements Document

## Introduction

This feature adds visibility into which administrator created/generated each invite code in the admin invite management interface. Currently, the `InviteRecord` already stores a `createdBy` field (userId) in DynamoDB when invites are generated, but this information is neither resolved to a human-readable nickname nor displayed in the frontend. This feature closes that gap by enriching the invite list API response with the creator's nickname and displaying it in the admin invite list UI. Additionally, a one-time data migration script is provided to backfill the `createdByNickname` field for all existing invite records that have a `createdBy` value but no stored nickname.

## Glossary

- **Invite_List_API**: The backend endpoint `GET /api/admin/invites` that returns invite records for the admin panel
- **Invite_Record**: A DynamoDB item representing a single invite, containing token, roles, status, timestamps, and optionally `createdBy` (userId)
- **Creator_Nickname**: The human-readable nickname of the admin who generated an invite, resolved from the `createdBy` userId via the Users table
- **Admin_Invite_Page**: The frontend page at `packages/frontend/src/pages/admin/invites.tsx` that renders the invite management interface
- **Batch_Generate_API**: The backend endpoint `POST /api/admin/invites/batch` that creates new invite records
- **Backfill_Script**: A standalone, manually-run TypeScript script that scans all Invite_Records in DynamoDB and backfills the `createdByNickname` field for legacy records
- **Users_Table**: The DynamoDB table storing user profiles, used to look up nicknames by userId

## Requirements

### Requirement 1: Store Creator Identity on Invite Generation

**User Story:** As a system operator, I want every newly generated invite to record the creator's userId, so that the creator can be identified later.

#### Acceptance Criteria

1. WHEN an admin generates invites via the Batch_Generate_API, THE Batch_Generate_API SHALL store the authenticated user's userId in the `createdBy` field of each created Invite_Record
2. THE Batch_Generate_API SHALL store the authenticated user's nickname in the `createdByNickname` field of each created Invite_Record at creation time

### Requirement 2: Return Creator Nickname in Invite List Response

**User Story:** As an admin, I want the invite list API to include the creator's nickname for each invite, so that the frontend can display who generated each invite.

#### Acceptance Criteria

1. WHEN the Invite_List_API returns invite records, THE Invite_List_API SHALL include the `createdByNickname` field for each Invite_Record that has a `createdBy` value
2. WHEN an Invite_Record has no `createdBy` value (legacy data), THE Invite_List_API SHALL omit the `createdByNickname` field for that record
3. WHEN an Invite_Record has a `createdBy` value but the corresponding user no longer exists, THE Invite_List_API SHALL return the `createdByNickname` as an empty string for that record

### Requirement 3: Display Creator in Admin Invite List UI

**User Story:** As an admin, I want to see who created each invite code in the invite list, so that I can track which admin generated which invites.

#### Acceptance Criteria

1. WHEN the Admin_Invite_Page renders an invite row, THE Admin_Invite_Page SHALL display the Creator_Nickname in the metadata section of each invite row
2. WHEN an invite record has no Creator_Nickname, THE Admin_Invite_Page SHALL omit the creator display for that invite row
3. THE Admin_Invite_Page SHALL display the Creator_Nickname using a consistent visual style with other metadata items (created time, expires time, used by)

### Requirement 4: Update Shared Type Definition

**User Story:** As a developer, I want the shared `InviteRecord` type to include the creator nickname field, so that both backend and frontend have a consistent type contract.

#### Acceptance Criteria

1. THE InviteRecord type in the shared types package SHALL include an optional `createdByNickname` field of type string
2. THE frontend InviteRecord interface in the Admin_Invite_Page SHALL include the optional `createdByNickname` field

### Requirement 5: Backward Compatibility with Legacy Invite Data

**User Story:** As a system operator, I want the feature to handle legacy invite records that were created before the `createdBy` field was introduced, so that the system remains stable.

#### Acceptance Criteria

1. WHEN the Invite_List_API encounters an Invite_Record without a `createdBy` field, THE Invite_List_API SHALL return the record without a `createdByNickname` field
2. WHEN the Admin_Invite_Page receives an invite record without a `createdByNickname` field, THE Admin_Invite_Page SHALL render the invite row without a creator label
3. THE Invite_List_API SHALL process legacy records and new records in the same query without errors

### Requirement 6: Backfill Creator Nickname for Legacy Invite Records

**User Story:** As a system operator, I want to run a one-time migration script that backfills the `createdByNickname` field for all existing invite records, so that legacy invites also display the creator's nickname without relying on runtime lookups.

#### Acceptance Criteria

1. WHEN the Backfill_Script is executed, THE Backfill_Script SHALL scan all Invite_Records in the invites DynamoDB table
2. WHEN an Invite_Record has a `createdBy` value but no `createdByNickname` value, THE Backfill_Script SHALL look up the corresponding user's nickname from the Users_Table and write the `createdByNickname` field back to that Invite_Record
3. WHEN an Invite_Record already has a `createdByNickname` value, THE Backfill_Script SHALL skip that record without modification
4. WHEN an Invite_Record has no `createdBy` value, THE Backfill_Script SHALL skip that record without modification
5. IF the user referenced by `createdBy` no longer exists in the Users_Table, THEN THE Backfill_Script SHALL set the `createdByNickname` field to an empty string for that Invite_Record
6. THE Backfill_Script SHALL be idempotent so that running the script multiple times produces the same result without duplicating writes
7. THE Backfill_Script SHALL log the total number of records scanned, records updated, records skipped, and records where the user was not found
8. THE Backfill_Script SHALL be a standalone script that can be executed manually from the command line
