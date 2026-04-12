# Requirements Document - Content Tags

## Introduction

The Content Hub currently organizes content exclusively through SuperAdmin-managed categories (one category per content item, used for navigation structure). This feature adds a complementary user-created tag system alongside the existing categories. Tags enable flexible, multi-dimensional content discovery through search and filtering. Users can attach 0–5 tags per content item during upload or edit, selecting from existing tags or creating new ones. An autocomplete mechanism encourages tag reuse. SuperAdmin can merge duplicate tags and delete unused tags to maintain tag quality.

## Glossary

- **Tag**: A short user-created label (2–20 characters) attached to a Content_Item for search and filtering purposes. Tags are distinct from categories: categories are SuperAdmin-managed and structural; tags are user-created and discovery-oriented.
- **Tag_Record**: A record in the ContentTags DynamoDB table representing a unique tag, including its name and usage count.
- **Content_Item**: An existing content record in the PointsMall-ContentItems table. Each Content_Item has a `categoryId` (existing) and a `tags` array (new, defaults to empty).
- **Tag_Input_Component**: The frontend autocomplete component that allows users to search existing tags and create new tags when uploading or editing content.
- **Tag_Cloud**: A horizontal scrollable list of tags displayed on the content list page for filtering.
- **Hot_Tags**: The top 10 most-used tags, shown as quick-select suggestions on the upload/edit form.
- **Tag_Management_Panel**: The SuperAdmin admin page for merging duplicate tags and deleting unused tags.
- **Content_Hub**: The existing content sharing and knowledge management module.
- **Content_Uploader**: A logged-in user who uploads or edits content.
- **SuperAdmin**: An administrator with the SuperAdmin role who manages tags.

---

## Requirements

### Requirement 1: Tag Data Model and Storage

**User Story:** As a developer, I want tags stored as a dedicated DynamoDB table with usage counts, so that the system can efficiently support autocomplete, hot tags, and tag management.

#### Acceptance Criteria

1. THE Content_Hub SHALL store each unique tag as a Tag_Record in a ContentTags DynamoDB table with fields: tagId (ULID), tagName (string), usageCount (number), and createdAt (ISO 8601 string).
2. THE Content_Hub SHALL store a `tags` array field on each Content_Item, containing 0 to 5 tag name strings.
3. WHEN a Content_Item is created or edited without a `tags` field, THE Content_Hub SHALL default the `tags` field to an empty array.
4. FOR ALL Content_Item records, the `tags` array length SHALL be between 0 and 5 inclusive (invariant property).
5. FOR ALL Tag_Record entries, the `tagName` length SHALL be between 2 and 20 characters inclusive (invariant property).
6. FOR ALL Tag_Record entries, the `usageCount` SHALL be greater than or equal to 0 (invariant property).

---

### Requirement 2: Tag Creation During Content Upload

**User Story:** As a content uploader, I want to add tags when uploading content, so that other users can discover my content through tag-based filtering.

#### Acceptance Criteria

1. WHEN Content_Uploader submits the upload form with a `tags` array, THE Content_Hub SHALL validate that each tag name is between 2 and 20 characters.
2. WHEN Content_Uploader submits the upload form with more than 5 tags, THE Content_Hub SHALL reject the request and return an error indicating the maximum tag count is exceeded.
3. WHEN Content_Uploader submits a tag name that does not exist in the ContentTags table, THE Content_Hub SHALL create a new Tag_Record with usageCount set to 1.
4. WHEN Content_Uploader submits a tag name that already exists in the ContentTags table, THE Content_Hub SHALL increment the existing Tag_Record usageCount by 1.
5. WHEN Content_Uploader submits the upload form without a `tags` field, THE Content_Hub SHALL accept the request and set `tags` to an empty array.
6. WHEN Content_Uploader submits a tag name containing only whitespace characters, THE Content_Hub SHALL reject the request and return an invalid tag name error.
7. THE Content_Hub SHALL trim leading and trailing whitespace from each tag name before validation and storage.
8. THE Content_Hub SHALL perform case-insensitive duplicate detection within the submitted tags array, rejecting requests that contain duplicate tag names after case normalization.

---

### Requirement 3: Tag Editing During Content Edit

**User Story:** As a content uploader, I want to modify tags when editing my content, so that I can improve content discoverability after initial upload.

#### Acceptance Criteria

1. WHEN Content_Uploader edits a Content_Item and provides a new `tags` array, THE Content_Hub SHALL validate the new tags using the same rules as upload (2–20 characters per tag, max 5 tags).
2. WHEN Content_Uploader edits tags, THE Content_Hub SHALL decrement usageCount for each removed tag and increment usageCount for each added tag.
3. WHEN a Tag_Record usageCount reaches 0 after a tag is removed from a Content_Item, THE Content_Hub SHALL retain the Tag_Record in the ContentTags table (deletion is handled by SuperAdmin only).
4. FOR ALL tag edit operations, the resulting Content_Item `tags` array SHALL reflect exactly the new tags provided in the edit request (round-trip property: edit then read returns the edited tags).

---

### Requirement 4: Tag Autocomplete and Search

**User Story:** As a content uploader, I want to search existing tags with autocomplete when adding tags, so that I can reuse existing tags and maintain consistency.

#### Acceptance Criteria

1. WHEN Content_Uploader types a search prefix in the Tag_Input_Component, THE Content_Hub SHALL return matching Tag_Record entries where tagName starts with the given prefix (case-insensitive).
2. THE Content_Hub SHALL return autocomplete results sorted by usageCount descending, with a maximum of 10 results.
3. WHEN the search prefix is shorter than 1 character, THE Content_Hub SHALL return an empty result set.
4. THE Content_Hub SHALL respond to autocomplete requests within a reasonable time to support interactive typing.

---

### Requirement 5: Hot Tags Display

**User Story:** As a content uploader, I want to see the most popular tags as quick-select suggestions, so that I can quickly add commonly used tags without typing.

#### Acceptance Criteria

1. THE Content_Hub SHALL provide an API endpoint that returns the top 10 Tag_Record entries sorted by usageCount descending.
2. WHEN fewer than 10 Tag_Record entries exist, THE Content_Hub SHALL return all available Tag_Record entries.
3. THE Tag_Input_Component SHALL display Hot_Tags as clickable chips above the tag input field on the upload and edit forms.
4. WHEN Content_Uploader clicks a Hot_Tag chip, THE Tag_Input_Component SHALL add that tag to the selected tags list, provided the 5-tag maximum is not exceeded.
5. WHEN the selected tags list already contains 5 tags, THE Tag_Input_Component SHALL disable further Hot_Tag chip selection and display a visual indicator that the maximum is reached.

---

### Requirement 6: Tag-Based Content Filtering

**User Story:** As a content viewer, I want to filter the content list by tags, so that I can find content related to specific topics.

#### Acceptance Criteria

1. THE Content_Hub SHALL display a Tag_Cloud on the content list page showing available tags as a horizontal scrollable list.
2. WHEN a user selects a tag from the Tag_Cloud, THE Content_Hub SHALL filter the content list to show only Content_Item records whose `tags` array contains the selected tag name.
3. WHEN a user deselects the tag filter, THE Content_Hub SHALL restore the full content list (respecting any active category filter).
4. THE Content_Hub SHALL support simultaneous category and tag filtering: the result set SHALL contain only Content_Item records matching both the selected categoryId and the selected tag.
5. FOR ALL tag filter queries, every returned Content_Item SHALL have status equal to "approved" (invariant property, consistent with existing behavior).
6. THE Tag_Cloud SHALL display tags sorted by usageCount descending, limited to the top 20 tags.

---

### Requirement 7: SuperAdmin Tag Management

**User Story:** As a SuperAdmin, I want to merge duplicate tags and delete unused tags, so that the tag system remains clean and useful.

#### Acceptance Criteria

1. THE Tag_Management_Panel SHALL be accessible only to users with the SuperAdmin role.
2. THE Tag_Management_Panel SHALL display all Tag_Record entries with their tagName and usageCount, sorted by tagName ascending.
3. WHEN SuperAdmin initiates a tag merge (source tag into target tag), THE Content_Hub SHALL update all Content_Item records that contain the source tag name, replacing the source tag with the target tag in the `tags` array.
4. WHEN SuperAdmin initiates a tag merge, THE Content_Hub SHALL add the source Tag_Record usageCount to the target Tag_Record usageCount, then delete the source Tag_Record.
5. WHEN SuperAdmin deletes a tag, THE Content_Hub SHALL remove the tag name from all Content_Item records that contain the tag in their `tags` array, then delete the Tag_Record.
6. WHEN SuperAdmin deletes a tag, THE Content_Hub SHALL decrement the affected Content_Item `tags` array length accordingly.
7. IF SuperAdmin attempts to merge a tag into itself, THEN THE Content_Hub SHALL reject the operation and return an error indicating the source and target tags are identical.
8. IF SuperAdmin attempts to merge or delete a tag that does not exist, THEN THE Content_Hub SHALL return a tag-not-found error.
9. WHEN a tag merge would cause a Content_Item to have duplicate tags (target tag already exists in the item), THE Content_Hub SHALL deduplicate the `tags` array, keeping only one instance of the target tag, and adjust usageCount accordingly.

---

### Requirement 8: Backward Compatibility

**User Story:** As a system operator, I want existing content without tags to continue working normally, so that the tag feature does not break existing functionality.

#### Acceptance Criteria

1. WHEN the content list API encounters a Content_Item without a `tags` field, THE Content_Hub SHALL treat the item as having an empty tags array.
2. WHEN the content detail API encounters a Content_Item without a `tags` field, THE Content_Hub SHALL return an empty `tags` array in the response.
3. THE Content_Hub SHALL not require migration of existing Content_Item records; the `tags` field is optional and defaults to an empty array at read time.
4. FOR ALL existing API endpoints (upload, edit, list, detail, admin list), the addition of the `tags` field SHALL not change the behavior of requests that do not include tags (idempotence property).

---

### Requirement 9: Tag Validation and Normalization

**User Story:** As a developer, I want consistent tag validation and normalization logic, so that tag data remains clean and predictable across all operations.

#### Acceptance Criteria

1. THE Content_Hub SHALL provide a shared tag validation function that checks: tag name length is between 2 and 20 characters after trimming, and tag name is not empty or whitespace-only.
2. THE Content_Hub SHALL provide a shared tag normalization function that trims whitespace and converts tag names to a consistent case for storage.
3. FOR ALL tag names submitted through any API (upload, edit, autocomplete), THE Content_Hub SHALL apply the same validation and normalization function (consistency property).
4. FOR ALL valid tag name inputs, normalizing then validating SHALL produce the same result as validating then normalizing (commutativity property).
5. FOR ALL tag names, applying normalization twice SHALL produce the same result as applying it once (idempotence property).

---

### Requirement 10: Multi-Language Support for Tags UI

**User Story:** As a user, I want the tag-related UI labels and messages to be available in all 5 supported languages, so that I can use the tag feature in my preferred language.

#### Acceptance Criteria

1. THE Content_Hub SHALL provide translations for all tag-related UI labels (tag input placeholder, hot tags section title, tag cloud section title, tag management page labels, error messages) in 5 languages: zh, en, ja, ko, zh-TW.
2. THE Content_Hub SHALL reuse the existing i18n framework and TranslationDict type structure.
3. FOR ALL tag-related UI labels, each label SHALL have a corresponding entry in all 5 language translation files (completeness property).
