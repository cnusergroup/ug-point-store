# Implementation Plan: Insight Reports Expansion

## Overview

Expand the existing SuperAdmin reports page with 6 new insight report tabs: popular products ranking, hot content ranking, content contributor ranking, inventory alert, travel application statistics, and invite conversion rate. Backend adds a new `insight-query.ts` module for all 6 query functions, extends `formatters.ts` with new column definitions and format functions, and extends `export.ts` to support new report types. Frontend extends `reports.tsx` with 6 new tabs, filter states, columns, conditional row highlighting, and a MetricCards component for invite conversion. Includes 6 new API routes in Admin Handler, i18n keys for 5 languages, and property-based tests for aggregation correctness.

## Tasks

- [x] 1. Create insight query module with interfaces and pure functions
  - [x] 1.1 Create `packages/backend/src/reports/insight-query.ts` with all TypeScript interfaces
    - Define `PopularProductsFilter`, `PopularProductRecord`, `PopularProductsResult`
    - Define `HotContentFilter`, `HotContentRecord`, `HotContentResult`
    - Define `ContentContributorFilter`, `ContentContributorRecord`, `ContentContributorResult`
    - Define `InventoryAlertFilter`, `InventoryAlertRecord`, `InventoryAlertResult`
    - Define `TravelStatisticsFilter`, `TravelStatisticsRecord`, `TravelStatisticsResult`
    - Define `InviteConversionFilter`, `InviteConversionRecord`, `InviteConversionResult`
    - _Requirements: 2.1, 4.1, 6.1, 8.1, 10.1, 12.1_
  - [x] 1.2 Implement pure aggregation functions in `insight-query.ts`
    - `aggregateRedemptionsByProduct(redemptions)` — group by productId, count and sum pointsSpent
    - `calculateStockConsumptionRate(stock, redemptionCount)` — returns percentage with 1 decimal, 0 when denominator is 0
    - `calculateEngagementScore(likeCount, commentCount, reservationCount)` — returns sum
    - `aggregateContentByUploader(items)` — group by uploaderId, count and sum likes/comments
    - `aggregateTravelByPeriod(applications, periodType)` — group by month/quarter, compute all stats
    - `aggregateInviteConversion(invites)` — compute totalInvites, usedCount, expiredCount, pendingCount, conversionRate
    - `calculateTotalStock(stock, sizeOptions)` — sum all size option stocks or return stock
    - `isLowStock(stock, sizeOptions, threshold)` — check if any size below threshold
    - _Requirements: 19.1, 19.2, 19.3, 20.1, 20.2, 20.3, 21.1, 21.2, 21.3, 22.1, 22.2, 22.3_

- [x] 2. Implement insight query functions (DynamoDB queries)
  - [x] 2.1 Implement `queryPopularProducts` function
    - Scan Redemptions table, optional FilterExpression for createdAt range
    - Aggregate in-memory by productId using `aggregateRedemptionsByProduct`
    - BatchGet Products table for name, type, stock
    - Optional filter by productType
    - Calculate stockConsumptionRate, sort by redemptionCount desc
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 2.2 Implement `queryHotContent` function
    - Query ContentItems table using `status-createdAt-index` GSI (PK=approved)
    - Optional FilterExpression for categoryId and createdAt range
    - Scan ContentCategories table for categoryId→name mapping
    - Calculate engagementScore, sort by engagementScore desc
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 2.3 Implement `queryContentContributors` function
    - Query ContentItems table using `status-createdAt-index` GSI (PK=approved)
    - Aggregate in-memory by uploaderId using `aggregateContentByUploader`
    - BatchGet Users table for nickname
    - Sort by approvedCount desc, assign rank starting from 1
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 2.4 Implement `queryInventoryAlert` function
    - Scan Products table
    - Filter in-memory by productType, productStatus, and stockThreshold (default 5)
    - Use `isLowStock` for size-option-aware threshold check
    - Calculate totalStock using `calculateTotalStock`
    - Sort by currentStock asc
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 2.5 Implement `queryTravelStatistics` function
    - Scan TravelApplications table, optional FilterExpression for createdAt range and category
    - Aggregate using `aggregateTravelByPeriod` (month or quarter)
    - Sort by period desc
    - Default to last 12 months when no date range provided
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 2.6 Implement `queryInviteConversion` function
    - Scan Invites table, optional FilterExpression for createdAt range
    - Aggregate using `aggregateInviteConversion`
    - Return single summary record
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 3. Write property tests for aggregation correctness
  - [x] 3.1 Write property test: Popular products aggregation (`packages/backend/src/reports/insight-query.property.test.ts`)
    - **Property 1: Redemption count equals occurrence count per productId**
    - **Property 2: totalPointsSpent equals sum of pointsSpent per productId**
    - **Property 3: Stock consumption rate formula correctness (0 when denominator is 0)**
    - **Validates: Requirements 19.1, 19.2, 19.3**
  - [x] 3.2 Write property test: Content ranking aggregation
    - **Property 4: Engagement score equals likeCount + commentCount + reservationCount**
    - **Property 5: approvedCount per uploaderId equals occurrence count**
    - **Property 6: totalLikes per uploaderId equals sum of likeCount**
    - **Validates: Requirements 20.1, 20.2, 20.3**
  - [x] 3.3 Write property test: Travel statistics aggregation
    - **Property 7: totalApplications equals approvedCount + rejectedCount + pendingCount per period**
    - **Property 8: approvalRate formula correctness (0 when totalApplications is 0)**
    - **Property 9: totalSponsoredAmount equals sum of totalCost for approved applications per period**
    - **Validates: Requirements 21.1, 21.2, 21.3**
  - [x] 3.4 Write property test: Invite conversion aggregation
    - **Property 10: totalInvites equals array length**
    - **Property 11: usedCount + expiredCount + pendingCount equals totalInvites**
    - **Property 12: conversionRate formula correctness (0 when totalInvites is 0)**
    - **Validates: Requirements 22.1, 22.2, 22.3**

- [x] 4. Checkpoint — Verify insight query module compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Extend formatters module with new report types
  - [x] 5.1 Extend `ReportType` union and add column definitions in `packages/backend/src/reports/formatters.ts`
    - Add 6 new report types to `ReportType`: `popular-products`, `hot-content`, `content-contributors`, `inventory-alert`, `travel-statistics`, `invite-conversion`
    - Define `ColumnDef[]` for each new report type with Chinese labels (per design export column tables)
    - Extend `getColumnDefs` switch to handle new types
    - _Requirements: 15.2, 15.4_
  - [x] 5.2 Implement 6 new format functions in `formatters.ts`
    - `formatPopularProductsForExport` — map productType to "积分商品"/"Code 专属商品", format stockConsumptionRate as "XX.X%"
    - `formatHotContentForExport`
    - `formatContentContributorsForExport`
    - `formatInventoryAlertForExport` — map productType and productStatus to Chinese labels
    - `formatTravelStatisticsForExport` — format approvalRate as "XX.X%"
    - `formatInviteConversionForExport` — format conversionRate as "XX.X%"
    - _Requirements: 15.2, 15.3, 15.4_
  - [x] 5.3 Write unit tests for new formatters (`packages/backend/src/reports/formatters.test.ts`)
    - Test getColumnDefs returns correct columns for each new report type
    - Test each format function maps fields correctly
    - Test percentage formatting for stockConsumptionRate, approvalRate, conversionRate
    - _Requirements: 15.2_

- [x] 6. Extend export module to support new report types
  - [x] 6.1 Update `VALID_REPORT_TYPES` and `executeExport` in `packages/backend/src/reports/export.ts`
    - Add 6 new report types to `VALID_REPORT_TYPES` array
    - Add 6 new branches in `executeExport` that call corresponding `insight-query.ts` functions
    - Each branch: query full dataset → format with new formatters → generate CSV/Excel → upload S3 → return presigned URL
    - Pass required table names from environment variables
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 6.2 Write unit tests for extended export (`packages/backend/src/reports/export.test.ts`)
    - Test validateExportInput accepts new report types
    - Test executeExport branches for new report types with mocked DynamoDB and S3 clients
    - _Requirements: 15.1_

- [x] 7. Register 6 new report routes in Admin Handler
  - [x] 7.1 Add imports and 6 new GET routes in `packages/backend/src/admin/handler.ts`
    - Import all 6 query functions from `../reports/insight-query`
    - Register GET `/api/admin/reports/popular-products` → parse query string → `queryPopularProducts`
    - Register GET `/api/admin/reports/hot-content` → parse query string → `queryHotContent`
    - Register GET `/api/admin/reports/content-contributors` → parse query string → `queryContentContributors`
    - Register GET `/api/admin/reports/inventory-alert` → parse query string → `queryInventoryAlert`
    - Register GET `/api/admin/reports/travel-statistics` → parse query string → `queryTravelStatistics`
    - Register GET `/api/admin/reports/invite-conversion` → parse query string → `queryInviteConversion`
    - All routes: check `isSuperAdmin(user.roles)`, return 403 if not
    - Pass table names from environment variables: PRODUCTS_TABLE, REDEMPTIONS_TABLE, CONTENT_ITEMS_TABLE, CONTENT_CATEGORIES_TABLE, USERS_TABLE, TRAVEL_APPLICATIONS_TABLE, INVITES_TABLE
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 7.2 Write unit tests for new handler routes (`packages/backend/src/admin/handler.test.ts`)
    - Test SuperAdmin access granted and non-SuperAdmin 403 for each new report route
    - Test query string parameter parsing for each route
    - _Requirements: 14.1, 14.2_

- [x] 8. Checkpoint — Verify backend compiles and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add i18n translations for new insight reports (5 languages + types)
  - [x] 9.1 Extend `packages/frontend/src/i18n/types.ts` with new translation keys
    - Add to `admin.reports`: 6 new tab label keys, filter keys for productType/categoryId/stockThreshold/productStatus/periodType/travelCategory, column keys for all 6 report tables, MetricCards keys for invite conversion, empty/loading/highlight states
    - _Requirements: 18.1, 18.4_
  - [x] 9.2 Add translation keys to `packages/frontend/src/i18n/zh.ts` (简体中文)
    - Tab labels: 人气商品排行、热门内容排行、内容贡献者排行、库存预警、差旅申请统计、邀请转化率
    - Filter labels, column names, MetricCards labels, status labels
    - _Requirements: 18.2_
  - [x] 9.3 Add translation keys to `packages/frontend/src/i18n/en.ts` (English)
    - _Requirements: 18.2_
  - [x] 9.4 Add translation keys to `packages/frontend/src/i18n/zh-TW.ts` (繁體中文)
    - _Requirements: 18.2_
  - [x] 9.5 Add translation keys to `packages/frontend/src/i18n/ja.ts` (日本語)
    - _Requirements: 18.2_
  - [x] 9.6 Add translation keys to `packages/frontend/src/i18n/ko.ts` (한국어)
    - _Requirements: 18.2_

- [x] 10. Extend frontend reports page with 6 new tabs
  - [x] 10.1 Extend `ReportTab` type, `TabFilterState`, and `REPORT_TABS` in `packages/frontend/src/pages/admin/reports.tsx`
    - Add 6 new tab keys to `ReportTab` union type
    - Add 6 new filter state entries to `TabFilterState` interface
    - Add 6 new entries to `REPORT_TABS` array with i18n label keys
    - Extend `getDefaultFilters` with defaults for new tabs (stockThreshold='5', productType='all', productStatus='all', periodType='month', category='all')
    - Extend `tabToReportType` and `tabToEndpoint` mappings
    - Extend `buildQueryString` to handle new filter fields
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 10.2 Extend FilterPanel component for new tabs
    - Add ProductTypeSelector for popular-products and inventory-alert tabs (积分商品/Code 专属商品/全部)
    - Add CategorySelector for hot-content tab (load from `/api/admin/content/categories`)
    - Add StockThresholdInput for inventory-alert tab (number input, default 5, range 1-999)
    - Add ProductStatusSelector for inventory-alert tab (上架中/已下架/全部)
    - Add PeriodTypeSelector for travel-statistics tab (按月/按季度)
    - Add TravelCategorySelector for travel-statistics tab (国内/国际/全部)
    - DateRangePicker for all new tabs except inventory-alert
    - Export buttons for all new tabs
    - _Requirements: 3.1, 5.1, 7.1, 9.1, 11.1, 13.1, 16.1_
  - [x] 10.3 Extend DataTable with columns for 6 new report types
    - Popular products columns: productName, productType, redemptionCount, totalPointsSpent, currentStock, stockConsumptionRate
    - Hot content columns: title, uploaderNickname, categoryName, likeCount, commentCount, reservationCount, engagementScore
    - Content contributors columns: rank, nickname, approvedCount, totalLikes, totalComments
    - Inventory alert columns: productName, productType, currentStock, totalStock, productStatus
    - Travel statistics columns: period, totalApplications, approvedCount, rejectedCount, pendingCount, approvalRate, totalSponsoredAmount
    - Add conditional row highlighting: stockConsumptionRate > 80% → `var(--warning)` background; currentStock === 0 → `var(--error)` background
    - _Requirements: 3.2, 3.4, 5.2, 7.2, 9.2, 9.4, 11.2_
  - [x] 10.4 Implement MetricCards component for invite conversion tab
    - Display 5 metric cards: totalInvites, usedCount, expiredCount, pendingCount, conversionRate
    - conversionRate card uses `var(--font-display)` font with bold weight and percentage display
    - Cards use `var(--bg-surface)` background + `var(--card-border)` border
    - Render MetricCards instead of DataTable when activeTab is 'invite-conversion'
    - _Requirements: 13.2_
  - [x] 10.5 Wire new tabs to API and handle export for new report types
    - Extend `fetchData` to handle invite-conversion single-record response shape
    - Extend `handleExport` to include new filter fields in export payload
    - Load content categories on mount for hot-content tab's CategorySelector
    - _Requirements: 3.3, 5.3, 7.3, 9.3, 11.3, 13.3, 16.2, 16.3, 16.4, 16.5_

- [x] 11. Update reports.scss for new tab styles
  - [x] 11.1 Add styles for new components in `packages/frontend/src/pages/admin/reports.scss`
    - MetricCards grid layout (responsive, 2-3 columns)
    - Metric card styles: `var(--bg-surface)` background, `var(--card-border)` border, `var(--radius-lg)` radius
    - Conversion rate display: `var(--font-display)` font, bold, `var(--accent-primary)` color
    - Warning row highlight: `var(--warning)` with low opacity background
    - Error row highlight: `var(--error)` with low opacity background
    - StockThreshold input styles
    - All colors via CSS variables, spacing via `--space-*`, radius via `--radius-*`
    - _Requirements: 3.4, 9.4, 13.2_

- [x] 12. Checkpoint — Verify frontend compiles and renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Ensure CDK permissions cover new tables
  - [x] 13.1 Verify Admin Lambda has read permissions for all required DynamoDB tables in CDK stack
    - Confirm Products, Redemptions, ContentItems, ContentCategories, Users, TravelApplications, Invites tables all grant read access to Admin Lambda
    - Add REDEMPTIONS_TABLE environment variable to Admin Lambda if not already present
    - Confirm all new routes work through existing `{proxy+}` proxy pattern (no API Gateway changes needed)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate 12 universal correctness properties from requirements 19-22
- The project uses vitest for testing and fast-check for property-based testing
- All frontend text uses i18n translation keys via `useTranslation` hook — no hardcoded strings
- All frontend styles use CSS variables from the design system (colors, spacing, radius, transitions)
- Backend insight query routes are registered in the existing Admin Handler, reusing the `{proxy+}` proxy pattern
- The new `insight-query.ts` module is separate from existing `query.ts` to maintain clean separation of concerns
- Export files reuse existing S3 upload and presigned URL logic in `export.ts`
- Invite conversion tab uses MetricCards instead of DataTable since it returns a single summary record
