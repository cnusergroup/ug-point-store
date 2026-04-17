# Requirements Document

## Introduction

The travel sponsorship system currently uses a shared `travelEarnUsed` counter to track quota consumption across both domestic and international travel categories. This causes domestic and international quotas to interfere with each other — using a domestic trip reduces international availability and vice versa. This feature decouples the two categories so that each has an independent quota calculated solely from the user's Speaker earn total and the per-category threshold, with used counts derived from actual application records (pending + approved) rather than a mutable counter.

## Glossary

- **Quota_Calculator**: The backend module (`packages/backend/src/travel/apply.ts`) responsible for computing available travel sponsorship counts per category.
- **Travel_Application_Store**: The DynamoDB TravelApplications table that persists travel sponsorship application records.
- **User_Store**: The DynamoDB Users table that persists user records including the legacy `travelEarnUsed` field.
- **Review_Handler**: The backend module (`packages/backend/src/travel/review.ts`) responsible for approving or rejecting travel applications.
- **Submit_Handler**: The logic within the Quota_Calculator module that creates new travel applications and enforces quota limits.
- **Resubmit_Handler**: The logic within the Quota_Calculator module that allows editing and resubmitting rejected travel applications.
- **Frontend_Quota_Display**: The frontend page (`packages/frontend/src/pages/my-travel/index.tsx`) that renders the user's travel quota information.
- **TravelQuota**: The shared TypeScript interface representing a user's travel quota state returned by the API.
- **earnTotal**: The sum of all Speaker-role earn points for a user, queried from PointsRecords.
- **domesticThreshold**: The number of Speaker earn points required per domestic travel sponsorship, configured in travel settings.
- **internationalThreshold**: The number of Speaker earn points required per international travel sponsorship, configured in travel settings.
- **domesticUsedCount**: The number of domestic travel applications with status pending or approved for a user.
- **internationalUsedCount**: The number of international travel applications with status pending or approved for a user.

## Requirements

### Requirement 1: Independent Domestic Quota Calculation

**User Story:** As a Speaker, I want my domestic travel quota to be calculated independently from international usage, so that using international sponsorships does not reduce my domestic availability.

#### Acceptance Criteria

1. THE Quota_Calculator SHALL compute domestic available count as `floor(earnTotal / domesticThreshold) - domesticUsedCount`.
2. WHEN domesticThreshold is zero, THE Quota_Calculator SHALL return zero for domestic available count.
3. WHEN the computed domestic available count is negative, THE Quota_Calculator SHALL return zero for domestic available count.
4. THE Quota_Calculator SHALL derive domesticUsedCount by counting travel applications with status "pending" or "approved" and category "domestic" for the requesting user from the Travel_Application_Store.

### Requirement 2: Independent International Quota Calculation

**User Story:** As a Speaker, I want my international travel quota to be calculated independently from domestic usage, so that using domestic sponsorships does not reduce my international availability.

#### Acceptance Criteria

1. THE Quota_Calculator SHALL compute international available count as `floor(earnTotal / internationalThreshold) - internationalUsedCount`.
2. WHEN internationalThreshold is zero, THE Quota_Calculator SHALL return zero for international available count.
3. WHEN the computed international available count is negative, THE Quota_Calculator SHALL return zero for international available count.
4. THE Quota_Calculator SHALL derive internationalUsedCount by counting travel applications with status "pending" or "approved" and category "international" for the requesting user from the Travel_Application_Store.

### Requirement 3: Remove travelEarnUsed from Quota Reads

**User Story:** As a system maintainer, I want the quota calculation to stop reading the `travelEarnUsed` field, so that the system relies solely on application records for accuracy.

#### Acceptance Criteria

1. THE Quota_Calculator SHALL compute quota without reading the `travelEarnUsed` field from the User_Store.
2. THE TravelQuota interface SHALL remove the `travelEarnUsed` property.
3. THE Frontend_Quota_Display SHALL not reference or display the `travelEarnUsed` value.

### Requirement 4: Submit Checks Category-Specific Availability

**User Story:** As a Speaker, I want the submit flow to only check availability for the specific category I am applying for, so that my domestic and international quotas are enforced independently.

#### Acceptance Criteria

1. WHEN a user submits a domestic travel application, THE Submit_Handler SHALL verify that `domesticUsedCount < floor(earnTotal / domesticThreshold)` before creating the application.
2. WHEN a user submits an international travel application, THE Submit_Handler SHALL verify that `internationalUsedCount < floor(earnTotal / internationalThreshold)` before creating the application.
3. IF the category-specific used count is not less than the category-specific total quota, THEN THE Submit_Handler SHALL return an INSUFFICIENT_EARN_QUOTA error.
4. THE Submit_Handler SHALL NOT read or write the `travelEarnUsed` field on the User_Store when creating an application.
5. THE Submit_Handler SHALL create the travel application record in the Travel_Application_Store without a `travelEarnUsed` update transaction item.

### Requirement 5: Resubmit Checks Category-Specific Availability

**User Story:** As a Speaker, I want the resubmit flow to check availability for the new category I am resubmitting under, so that changing categories on resubmission is correctly validated.

#### Acceptance Criteria

1. WHEN a user resubmits a rejected application with a new category, THE Resubmit_Handler SHALL verify that the new category's used count is less than `floor(earnTotal / newCategoryThreshold)`.
2. IF the new category's used count is not less than the new category's total quota, THEN THE Resubmit_Handler SHALL return an INSUFFICIENT_EARN_QUOTA error.
3. THE Resubmit_Handler SHALL NOT read or write the `travelEarnUsed` field on the User_Store when resubmitting an application.
4. THE Resubmit_Handler SHALL update the travel application record status to "pending" without a `travelEarnUsed` update transaction item.

### Requirement 6: Reject Does Not Refund travelEarnUsed

**User Story:** As an admin, I want the reject flow to simply update the application status without manipulating any shared counter, so that the system is simpler and less error-prone.

#### Acceptance Criteria

1. WHEN an admin rejects a travel application, THE Review_Handler SHALL update the application status to "rejected" with the reject reason, reviewer info, and timestamp.
2. THE Review_Handler SHALL NOT modify the `travelEarnUsed` field on the User_Store when rejecting an application.
3. THE Review_Handler SHALL use a single UpdateCommand instead of a TransactWriteCommand for the reject operation, since no cross-table atomicity is required.

### Requirement 7: Approve Does Not Modify travelEarnUsed

**User Story:** As an admin, I want the approve flow to remain unchanged in its non-interaction with `travelEarnUsed`, confirming that approval does not write to the shared counter.

#### Acceptance Criteria

1. WHEN an admin approves a travel application, THE Review_Handler SHALL update the application status to "approved" with reviewer info and timestamp.
2. THE Review_Handler SHALL NOT modify the `travelEarnUsed` field on the User_Store when approving an application.

### Requirement 8: Independent Quota Correctness Property (Round-Trip)

**User Story:** As a developer, I want property-based tests to verify that domestic and international quotas are truly independent, so that regressions are caught automatically.

#### Acceptance Criteria

1. FOR ALL valid earnTotal, domesticThreshold, and internationalThreshold values, THE Quota_Calculator SHALL produce a domestic available count that does not change when internationalUsedCount changes.
2. FOR ALL valid earnTotal, domesticThreshold, and internationalThreshold values, THE Quota_Calculator SHALL produce an international available count that does not change when domesticUsedCount changes.
3. FOR ALL valid inputs, THE Quota_Calculator SHALL satisfy: `domesticAvailable + domesticUsedCount <= floor(earnTotal / domesticThreshold)` when domesticThreshold is greater than zero.
4. FOR ALL valid inputs, THE Quota_Calculator SHALL satisfy: `internationalAvailable + internationalUsedCount <= floor(earnTotal / internationalThreshold)` when internationalThreshold is greater than zero.
5. FOR ALL valid inputs where a user submits one domestic application, THE Quota_Calculator SHALL produce the same international available count before and after the domestic submission.
