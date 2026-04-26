# Requirements Document

## Introduction

The Users table (`PointsMall-Users`) in DynamoDB stores both user records and system configuration records (feature-toggles, travel-settings, invite-settings, sync-config, etc.) in the same table. The current `listUsers` function uses DynamoDB Scan with `FilterExpression` to exclude system records, which causes pagination issues: DynamoDB Scan's `Limit` applies before filtering, so pages may return fewer results than expected; `LastEvaluatedKey` from Scan points to positions that include system records, causing data loss between pages. The current workaround scans the entire table without a `Limit`, which will not scale as the user base grows.

This feature adds a Global Secondary Index (GSI) with `entityType` as partition key and `createdAt` as sort key to the Users table. All user records will have `entityType: "user"`, while system config records will not have this field. The `listUsers` function will Query the GSI instead of Scanning the table, enabling correct DynamoDB-native pagination. Additionally, user records created via invite will store the `invitedBy` field (the admin userId who created the invite), enabling frontend priority sorting where invited users appear first in the list.

## Glossary

- **Users_Table**: The DynamoDB table `PointsMall-Users` that stores both user records and system configuration records, with `userId` as the partition key.
- **GSI**: A DynamoDB Global Secondary Index that provides an alternative query pattern on a table.
- **entityType_createdAt_GSI**: The new Global Secondary Index named `entityType-createdAt-index` with partition key `entityType` (String) and sort key `createdAt` (String).
- **entityType**: A string attribute on user records with the value `"user"`, used to distinguish user records from system configuration records in the Users_Table.
- **System_Config_Record**: A record in the Users_Table that stores system configuration (feature-toggles, travel-settings, invite-settings, sync-config, etc.) and does NOT have the `entityType` attribute.
- **User_Record**: A record in the Users_Table that represents a registered user, identified by having an `email` attribute and the `entityType` attribute set to `"user"`.
- **ListUsers_API**: The backend API endpoint `GET /api/admin/users` that returns a paginated list of users with optional role filtering.
- **Migration_Script**: A one-time script that adds `entityType: "user"` to all existing User_Records in the Users_Table.
- **invitedBy**: A string attribute on User_Records that stores the `userId` of the admin who created the invite token used during registration.
- **Batch_Points_Page**: The frontend page (`batch-points.tsx`) used by admins to distribute points to users by role.
- **Batch_Adjust_Page**: The frontend page (`batch-adjust.tsx`) used by SuperAdmins to adjust a previous batch distribution.
- **Frontend_Sorter**: The client-side sorting logic that reorders the user list so that users invited by the current admin appear first, followed by remaining users sorted by `createdAt` descending.

## Requirements

### Requirement 1: Add entityType-createdAt GSI to Users Table

**User Story:** As a backend developer, I want a GSI on the Users table indexed by `entityType` and `createdAt`, so that I can efficiently query only user records with correct pagination.

#### Acceptance Criteria

1. THE CDK_Stack SHALL define a Global Secondary Index named `entityType-createdAt-index` on the Users_Table with partition key `entityType` (String) and sort key `createdAt` (String).
2. THE entityType_createdAt_GSI SHALL project all attributes from the base table so that the ListUsers_API can retrieve all needed user fields from the GSI without a separate table lookup.
3. THE entityType_createdAt_GSI SHALL use the same billing mode (PAY_PER_REQUEST) as the Users_Table.

### Requirement 2: Write entityType on User Registration

**User Story:** As a system operator, I want all newly registered users to have `entityType: "user"` set on their record, so that they appear in the entityType-createdAt GSI.

#### Acceptance Criteria

1. WHEN a user registers via invite token, THE Registration_Handler SHALL set the `entityType` attribute to `"user"` on the new User_Record in the Users_Table.
2. THE Registration_Handler SHALL include `entityType: "user"` in the same PutCommand that creates the User_Record, not as a separate update.
3. WHEN a System_Config_Record is created or updated in the Users_Table, THE System SHALL NOT set the `entityType` attribute on that record.

### Requirement 3: Write invitedBy on User Registration

**User Story:** As an admin, I want to know which users I invited, so that I can see my invited users prioritized in the batch points user list.

#### Acceptance Criteria

1. WHEN a user registers via invite token, THE Registration_Handler SHALL look up the `createdBy` field from the consumed invite record and store it as the `invitedBy` attribute on the new User_Record.
2. IF the invite record does not have a `createdBy` field, THEN THE Registration_Handler SHALL omit the `invitedBy` attribute from the User_Record.
3. THE ListUsers_API SHALL include the `invitedBy` field in the projected attributes returned for each user.

### Requirement 4: Migrate Existing User Records

**User Story:** As a system operator, I want all existing user records to have `entityType: "user"` and `invitedBy` populated from invite history, so that the GSI contains all users and invited-user priority sorting works for existing users.

#### Acceptance Criteria

1. THE Migration_Script SHALL scan the Users_Table and add `entityType: "user"` to every record that has an `email` attribute.
2. THE Migration_Script SHALL NOT modify records that do not have an `email` attribute (System_Config_Records).
3. THE Migration_Script SHALL be idempotent: running the script multiple times SHALL produce the same result as running it once.
4. THE Migration_Script SHALL use conditional updates or check-before-write to avoid overwriting any other attributes on the User_Record.
5. THE Migration_Script SHALL log the count of records updated and records skipped upon completion.
6. THE Migration_Script SHALL scan the Invites_Table to find invite records that match each user's email, and write the invite's `createdBy` value as the `invitedBy` attribute on the corresponding User_Record.
7. IF no matching invite record is found for a user, THEN THE Migration_Script SHALL leave the `invitedBy` attribute unset on that User_Record.
8. IF a user already has an `invitedBy` attribute, THEN THE Migration_Script SHALL NOT overwrite it.

### Requirement 5: Rewrite listUsers to Query the GSI

**User Story:** As an admin, I want the user list API to return correctly paginated results, so that I can browse all users without data loss between pages.

#### Acceptance Criteria

1. THE ListUsers_API SHALL use a DynamoDB Query on the entityType_createdAt_GSI with `entityType = "user"` instead of a Scan on the base table.
2. THE ListUsers_API SHALL sort results by `createdAt` in descending order (newest users first).
3. WHEN a `role` query parameter is provided, THE ListUsers_API SHALL apply a FilterExpression with `contains(roles, :role)` to the GSI Query.
4. WHEN `excludeRoles` are specified, THE ListUsers_API SHALL apply FilterExpression conditions `NOT contains(roles, :exRoleN)` for each excluded role.
5. THE ListUsers_API SHALL use the `pageSize` parameter as the DynamoDB Query `Limit` value, clamped between 1 and 100.
6. WHEN a `lastKey` query parameter is provided, THE ListUsers_API SHALL pass it as `ExclusiveStartKey` to the DynamoDB Query.
7. THE ListUsers_API SHALL return the `LastEvaluatedKey` from the DynamoDB Query response as the `lastKey` field in the API response.
8. WHEN the DynamoDB Query returns no `LastEvaluatedKey`, THE ListUsers_API SHALL return `lastKey` as `undefined` to indicate no more pages.
9. THE ListUsers_API SHALL return exactly the number of matching records up to `pageSize` per page, with no data loss between consecutive paginated requests.

### Requirement 6: Frontend Pagination Restoration

**User Story:** As an admin, I want the batch points and batch adjust pages to use normal pagination with a page size of 20, so that the pages load quickly and I can browse users incrementally.

#### Acceptance Criteria

1. THE Batch_Points_Page SHALL request users from the ListUsers_API with `pageSize=20` instead of `pageSize=200`.
2. THE Batch_Adjust_Page SHALL request users from the ListUsers_API with `pageSize=20` instead of `pageSize=200`.
3. WHEN the ListUsers_API returns a `lastKey` value, THE Batch_Points_Page SHALL display a "Load more" button that fetches the next page using that `lastKey`.
4. WHEN the ListUsers_API returns a `lastKey` value, THE Batch_Adjust_Page SHALL display a "Load more" button that fetches the next page using that `lastKey`.
5. WHEN the "Load more" button is clicked, THE Frontend SHALL append the newly fetched users to the existing list without replacing previous results.
6. WHEN the ListUsers_API returns no `lastKey`, THE Frontend SHALL hide the "Load more" button to indicate all users have been loaded.

### Requirement 7: Invited User Priority Sorting

**User Story:** As an admin, I want users that I invited to appear first in the batch points and batch adjust user lists, so that I can quickly find and select my invited users.

#### Acceptance Criteria

1. THE Frontend_Sorter SHALL partition the fetched user list into two groups: users whose `invitedBy` field matches the current admin's `userId`, and all other users.
2. THE Frontend_Sorter SHALL place the invited-by-current-admin group before the other-users group in the displayed list.
3. WITHIN each group, THE Frontend_Sorter SHALL sort users by `createdAt` in descending order (newest first).
4. THE Frontend_Sorter SHALL apply this sorting on the Batch_Points_Page after each fetch (initial load and "Load more" appends).
5. THE Frontend_Sorter SHALL apply this sorting on the Batch_Adjust_Page after each fetch (initial load and "Load more" appends).
6. IF a user does not have an `invitedBy` field, THEN THE Frontend_Sorter SHALL place that user in the other-users group.
