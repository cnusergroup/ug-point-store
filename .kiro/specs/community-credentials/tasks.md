# Implementation Plan: Community Credentials (社区凭证系统)

## Overview

实现社区凭证系统，为 AWS User Group China 社区活动参与者签发可验证的数字凭证。采用自底向上的实现顺序：数据层（i18n、Credential ID、CSV）→ 业务逻辑（序号生成器、HTML 渲染器）→ API Handler → CDK 基础设施 → 前端管理页面。每个模块独立可测试，逐步集成。

## Tasks

- [x] 1. Create i18n module and credential data types
  - [x] 1.1 Create i18n strings module at `packages/backend/src/credentials/i18n.ts`
    - Define `Locale` type (`'zh' | 'en'`) and `I18nStrings` interface
    - Implement `getStrings(locale: Locale): I18nStrings` with zh/en string maps
    - Include role translations: Volunteer→志愿者, Speaker→讲师, Workshop→工作坊参与者, Organizer→组织者
    - Include all UI labels: verified, revoked, issueDate, issuingOrganization, credentialId, addToLinkedIn, verificationTitle, verificationDescription, revokedNotice, eventDate, eventLocation, contribution, pageTitle
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6_

  - [x] 1.2 Create credential types at `packages/backend/src/credentials/types.ts`
    - Define `Credential` interface with all required fields (credentialId, recipientName, eventName, role, issueDate, issuingOrganization, status, locale, createdAt) and optional fields (eventLocation, eventDate, contribution, revokedAt, revokedBy, revokeReason, batchId)
    - Define `CredentialStatus` type (`'active' | 'revoked'`)
    - Define `CredentialRole` type (`'Volunteer' | 'Speaker' | 'Workshop' | 'Organizer'`)
    - Define `ROLE_CODES` mapping (Volunteer→VOL, Speaker→SPK, Workshop→WKS, Organizer→ORG)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Implement Credential ID module
  - [x] 2.1 Create credential ID module at `packages/backend/src/credentials/credential-id.ts`
    - Define `CredentialIdComponents` interface (eventPrefix, year, season, roleCode, sequence)
    - Implement `formatCredentialId(components): string` — format components into `{PREFIX}-{YEAR}-{SEASON}-{ROLE}-{SEQ}` with 4-digit zero-padded sequence
    - Implement `parseCredentialId(id: string): CredentialIdComponents` — parse ID string back to components using regex `/^([A-Z](?:[A-Z-]*[A-Z])?)-(\d{4})-(Spring|Summer|Fall|Winter)-(VOL|SPK|WKS|ORG)-(\d{4})$/`
    - Implement `validateCredentialId(id: string): { valid: boolean; error?: string }` — validate format and return descriptive error for invalid IDs
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.2 Write property test: Credential ID Round-Trip
    - **Property 1: Credential ID Round-Trip**
    - Test file: `packages/backend/src/credentials/credential-id.property.test.ts`
    - For any valid CredentialIdComponents, `parseCredentialId(formatCredentialId(components))` should return identical components
    - Use fast-check arbitraries for eventPrefix (uppercase + hyphens), year (4 digits), season (Spring|Summer|Fall|Winter), roleCode (VOL|SPK|WKS|ORG), sequence (1-9999)
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 2.3 Write property test: Invalid Credential ID Rejection
    - **Property 2: Invalid Credential ID Rejection**
    - Test file: `packages/backend/src/credentials/credential-id.property.test.ts`
    - For any string not matching the credential ID regex, `parseCredentialId` should return a descriptive error
    - Generate random strings, strings with wrong season/role codes, missing segments
    - **Validates: Requirements 2.5**

  - [ ]* 2.4 Write unit tests for credential ID module
    - Test file: `packages/backend/src/credentials/credential-id.test.ts`
    - Test known ID parsing: `ACD-BASE-2026-Summer-VOL-0002` → correct components
    - Test formatting: components → expected ID string
    - Test edge cases: sequence 1 → `0001`, sequence 9999 → `9999`
    - Test invalid IDs: empty string, wrong format, invalid season, invalid role code
    - _Requirements: 2.3, 2.4, 2.5_

- [x] 3. Implement CSV parser/formatter
  - [x] 3.1 Create CSV module at `packages/backend/src/credentials/csv.ts`
    - Define `CsvCredentialRow` interface (recipientName, role, eventName, locale?, eventDate?, eventLocation?, contribution?, issuingOrganization?)
    - Define `CsvParseResult` interface ({ rows, errors })
    - Implement `parseCsv(csvContent: string): CsvParseResult` — RFC 4180 compliant, handle quoted fields with commas/newlines/quotes, UTF-8 BOM stripping
    - Implement `formatCsv(rows: CsvCredentialRow[]): string` — format rows back to CSV string with proper quoting
    - Implement `validateRow(row, lineNumber)` — validate required fields (recipientName, role, eventName), validate role values, validate locale values
    - Handle empty CSV (return empty array), header-only CSV (return empty array)
    - _Requirements: 7.2, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 3.2 Write property test: CSV Round-Trip
    - **Property 9: CSV Round-Trip**
    - Test file: `packages/backend/src/credentials/csv.property.test.ts`
    - For any valid array of CsvCredentialRow (including fields with commas, quotes, newlines), `parseCsv(formatCsv(rows))` should produce semantically equivalent rows
    - Use fast-check to generate rows with special characters
    - **Validates: Requirements 8.2, 8.4, 8.5**

  - [ ]* 3.3 Write unit tests for CSV module
    - Test file: `packages/backend/src/credentials/csv.test.ts`
    - Test UTF-8 BOM handling, empty file, header-only file
    - Test fields with commas, quotes, newlines
    - Test row validation: missing required fields, invalid role, invalid locale
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement sequence generator
  - [x] 5.1 Create sequence generator at `packages/backend/src/credentials/sequence.ts`
    - Implement `getNextSequence(dynamoClient, tableName, eventPrefix, year, season, roleCode, count): Promise<number>`
    - Use DynamoDB `UpdateCommand` with `ADD currentValue :inc` for atomic increment
    - Partition key format: `{eventPrefix}-{year}-{season}-{roleCode}`
    - Return the starting sequence number (endSequence - count + 1)
    - _Requirements: 2.1, 2.2_

  - [ ]* 5.2 Write property test: Credential ID Sequence Uniqueness
    - **Property 3: Credential ID Sequence Uniqueness**
    - Test file: `packages/backend/src/credentials/credential-id.property.test.ts`
    - For any batch of N rows with same prefix/year/season/role, generated sequences should be unique and form a contiguous ascending range
    - Mock DynamoDB atomic counter behavior, verify no gaps or duplicates
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 5.3 Write unit tests for sequence generator
    - Test file: `packages/backend/src/credentials/sequence.test.ts`
    - Test single sequence generation, batch sequence generation
    - Test that start sequence is correctly calculated from end sequence
    - Mock DynamoDB client
    - _Requirements: 2.1, 2.2_

- [x] 6. Implement HTML renderer and QR code generation
  - [x] 6.1 Create HTML renderer at `packages/backend/src/credentials/render.ts`
    - Implement `renderCredentialPage(options: RenderOptions): string` — generate complete HTML with inline CSS, OG meta tags, QR code SVG, i18n text, responsive layout
    - Implement `render404Page(locale: 'zh' | 'en'): string` — friendly 404 page with back-to-home link
    - Implement `buildLinkedInUrl(credential, baseUrl): string` — LinkedIn Add Certification URL with encoded parameters (name, organizationName, issueYear, issueMonth, certUrl, certId)
    - Implement `generateQrSvg(url: string): string` — use `qrcode` library to generate inline SVG
    - HTML must be self-contained: inline CSS via `<style>`, no external stylesheets or scripts
    - Include gradient background, professional card layout, verification panel, responsive media queries
    - For revoked credentials: show revocation marker, hide LinkedIn button, update OG description
    - Target HTML size < 50KB
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 12.1, 12.4, 14.2, 14.3, 14.5, 14.6_

  - [ ]* 6.2 Write property test: HTML Contains All Credential Fields
    - **Property 4: HTML Rendering Contains All Credential Fields**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For any valid credential, rendered HTML contains recipientName, eventName, role name, issueDate, credentialId, issuingOrganization; optional fields appear when provided
    - **Validates: Requirements 3.1, 3.3, 3.4, 1.1, 1.2**

  - [ ]* 6.3 Write property test: Revoked Credential Rendering
    - **Property 5: Revoked Credential Rendering**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For any revoked credential, HTML contains revocation marker, OG description includes revocation text, LinkedIn button is absent
    - **Validates: Requirements 3.7, 4.4, 5.4**

  - [ ]* 6.4 Write property test: OG and Social Meta Tags Correctness
    - **Property 6: OG and Social Meta Tags Correctness**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For any valid credential, HTML contains og:title, og:description, og:url, og:type, og:image, twitter:card, twitter:title, twitter:description, twitter:image
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 6.5 Write property test: LinkedIn URL Parameter Correctness
    - **Property 7: LinkedIn URL Parameter Correctness**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For any active credential, LinkedIn URL contains correct certification name, organization, year/month, credential URL, credential ID as encoded params
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 6.6 Write property test: Locale-Aware Rendering
    - **Property 8: Locale-Aware Rendering**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For locale `zh`, all UI text is Chinese; for locale `en`, all UI text is English; OG meta uses corresponding language
    - **Validates: Requirements 14.2, 14.3, 14.5, 14.6**

  - [ ]* 6.7 Write property test: Self-Contained HTML
    - **Property 13: Self-Contained HTML**
    - Test file: `packages/backend/src/credentials/render.property.test.ts`
    - For any rendered page, HTML has no external stylesheet links, no external script tags, all CSS inlined in `<style>` tags
    - **Validates: Requirements 12.1**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement credential Lambda handler and business logic
  - [x] 8.1 Create batch credential creation logic at `packages/backend/src/credentials/batch.ts`
    - Implement `batchCreateCredentials(params)` — parse CSV, validate rows, generate sequences, create credentials in DynamoDB
    - Generate unique batchId (UUID) for each batch operation
    - For each valid row: generate credential ID using sequence generator, write to Credentials table
    - Collect errors for invalid rows without affecting valid rows
    - Return summary: total, success, failed, credentials list, errors list
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [ ]* 8.2 Write property test: Batch Generation Correctness
    - **Property 10: Batch Generation Correctness**
    - Test file: `packages/backend/src/credentials/batch.property.test.ts`
    - For any CSV with mix of valid/invalid rows, batch creates exactly one credential per valid row with unique ID and correct batchId, reports error per invalid row
    - **Validates: Requirements 7.3, 7.4, 7.6**

  - [x] 8.3 Create revocation logic at `packages/backend/src/credentials/revoke.ts`
    - Implement `revokeCredential(params)` — update credential status to `revoked`, record revokedAt, revokedBy, revokeReason
    - Validate credential exists and is currently `active`
    - Return error if already revoked (`ALREADY_REVOKED`)
    - Validate caller has SuperAdmin role
    - _Requirements: 10.3, 10.4, 10.5_

  - [ ]* 8.4 Write property test: Revocation State Transition
    - **Property 11: Revocation State Transition**
    - Test file: `packages/backend/src/credentials/revoke.property.test.ts`
    - For any active credential, revoking changes status to revoked with revokedAt/revokedBy/revokeReason; revoking an already-revoked credential returns error
    - **Validates: Requirements 10.3, 10.4**

  - [ ]* 8.5 Write property test: Revocation Authorization
    - **Property 12: Revocation Authorization**
    - Test file: `packages/backend/src/credentials/revoke.property.test.ts`
    - For any non-SuperAdmin user, revocation is rejected with 403; only SuperAdmin can revoke
    - **Validates: Requirements 10.5**

  - [x] 8.6 Create Lambda handler at `packages/backend/src/credentials/handler.ts`
    - Route `GET /c/{credentialId}` → fetch credential from DynamoDB, render HTML page (or 404)
    - Route `GET /api/admin/credentials` → list credentials with search, status filter, pagination
    - Route `GET /api/admin/credentials/{credentialId}` → get credential detail (JSON)
    - Route `POST /api/admin/credentials/batch` → batch create credentials from CSV
    - Route `PATCH /api/admin/credentials/{credentialId}/revoke` → revoke credential
    - Admin routes: verify JWT token, check Admin/SuperAdmin role (reuse existing auth middleware)
    - Revoke route: verify SuperAdmin role specifically
    - Set `Cache-Control: public, max-age=3600` on public credential pages
    - Return proper error responses (JSON for API, HTML for public pages)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 12.2_

  - [ ]* 8.7 Write unit tests for Lambda handler
    - Test file: `packages/backend/src/credentials/handler.test.ts`
    - Test route dispatching for all 5 routes
    - Test authentication checks on admin routes
    - Test SuperAdmin-only check on revoke route
    - Test 404 handling for non-existent credentials
    - Test Cache-Control header on public pages
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Add CDK infrastructure
  - [x] 10.1 Update database stack at `packages/cdk/lib/database-stack.ts`
    - Add `PointsMall-Credentials` DynamoDB table with `credentialId` as partition key
    - Add GSI `status-createdAt-index` (PK: status, SK: createdAt) for status filtering and pagination
    - Add GSI `batchId-index` (PK: batchId) for batch queries
    - Add `PointsMall-CredentialSequences` DynamoDB table with `sequenceKey` as partition key
    - _Requirements: 1.1, 1.2, 13.1_

  - [x] 10.2 Update API stack at `packages/cdk/lib/api-stack.ts`
    - Create `PointsMall-Credential` Lambda function pointing to `packages/backend/src/credentials/handler.ts`
    - Grant Lambda read/write access to Credentials and CredentialSequences tables
    - Grant Lambda read access to existing Users table (for auth verification)
    - Add API Gateway routes:
      - `GET /c/{credentialId}` → Credential Lambda
      - `GET /api/admin/credentials` → Credential Lambda
      - `GET /api/admin/credentials/{credentialId}` → Credential Lambda
      - `POST /api/admin/credentials/batch` → Credential Lambda
      - `PATCH /api/admin/credentials/{credentialId}/revoke` → Credential Lambda
    - Pass table names as environment variables to Lambda
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 13.2, 13.3_

  - [x] 10.3 Update frontend stack at `packages/cdk/lib/frontend-stack.ts`
    - Add CloudFront behavior for `/c/*` path pattern routing to API Gateway origin
    - Ensure `/c/*` behavior does not require authentication
    - _Requirements: 12.2, 13.4_

- [x] 11. Implement frontend admin credential management page
  - [x] 11.1 Create admin credentials page at `packages/frontend/src/pages/admin/credentials.tsx`
    - Implement credential list view with columns: credentialId, recipientName, eventName, role, issueDate, status
    - Implement search input for filtering by credentialId, recipientName, eventName
    - Implement status filter dropdown (all / active / revoked)
    - Implement pagination (default 20 per page)
    - Implement click-to-view detail with "查看公开页面" link opening `/c/{credentialId}` in new tab
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 11.2 Add batch import UI to admin credentials page
    - Add CSV file upload area with drag-and-drop support
    - Add form fields for eventPrefix, year, season selection
    - Display import results: success count, failure count, generated credential IDs, error details per failed row
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 11.3 Add revocation UI to admin credentials page
    - Add "撤销" button for each active credential row (visible only to SuperAdmin)
    - Implement confirmation dialog requiring revocation reason input
    - Update credential status in list after successful revocation
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 11.4 Create styles at `packages/frontend/src/pages/admin/credentials.scss`
    - Style credential list table, search/filter controls, pagination
    - Style CSV upload area, import result summary
    - Style revocation dialog and status badges (green for active, red for revoked)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 11.5 Register admin credentials page route
    - Add page config at `packages/frontend/src/pages/admin/credentials.config.ts`
    - Add navigation entry to admin index page at `packages/frontend/src/pages/admin/index.tsx`
    - _Requirements: 9.1_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 13 correctness properties defined in the design document
- The design uses TypeScript throughout — all code in `packages/backend/src/credentials/`
- The credential module is fully isolated: independent Lambda, independent DynamoDB tables, no shared code entry with existing Admin Lambda
- All HTML rendering is self-contained (inline CSS, no external dependencies) for social crawler compatibility
- The `qrcode` npm package is needed for QR SVG generation — add to backend dependencies
