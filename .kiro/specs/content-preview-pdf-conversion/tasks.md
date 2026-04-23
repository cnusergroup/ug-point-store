# Implementation Plan: Content Preview PDF Conversion

## Overview

Implement automatic Office-to-PDF conversion for secure document preview. When users upload Office files (PPT/PPTX/DOC/DOCX), a dedicated Conversion Lambda (Docker-based with LibreOffice) converts them to PDF. The frontend uses the existing PdfViewer component (CDN-loaded pdf.js) to render all documents uniformly, replacing the Microsoft Office Online Viewer iframe. Downloads still provide the original file.

## Tasks

- [x] 1. Extend shared types and ContentItem data model
  - [x] 1.1 Add `previewFileKey` and `previewStatus` fields to ContentItem type
    - Add optional `previewFileKey?: string` field to `ContentItem` interface in `packages/shared/src/types.ts`
    - Add optional `previewStatus?: 'pending' | 'completed' | 'failed'` field to `ContentItem` interface
    - Add a `PreviewStatus` type alias for `'pending' | 'completed' | 'failed'`
    - Add helper function `isOfficeFile(fileName: string): boolean` that checks for `.ppt`, `.pptx`, `.doc`, `.docx` extensions
    - _Requirements: 2.1, 2.2_

  - [ ]* 1.2 Write unit tests for isOfficeFile helper
    - Test all four Office extensions (ppt, pptx, doc, docx) return true
    - Test PDF and other extensions return false
    - Test case-insensitive matching
    - _Requirements: 2.1_

- [x] 2. Create the Conversion Lambda
  - [x] 2.1 Create Dockerfile for LibreOffice-based Lambda
    - Create `packages/backend/src/conversion/Dockerfile` using AWS Lambda Node.js 20 base image
    - Install LibreOffice in the Docker image (headless mode)
    - Copy the handler source code into the image
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.2 Implement the conversion handler
    - Create `packages/backend/src/conversion/handler.ts`
    - Accept event payload: `{ contentId, fileKey, uploaderId, bucket, contentItemsTable }`
    - Download the original file from S3 to `/tmp`
    - Execute LibreOffice headless conversion to PDF: `libreoffice --headless --convert-to pdf`
    - Upload the resulting PDF to S3 at path `content/{uploaderId}/{fileId}_preview.pdf`
    - Update the ContentItem in DynamoDB: set `previewFileKey` to the PDF path and `previewStatus` to `completed`
    - On failure: set `previewStatus` to `failed` and log the error details
    - Clean up `/tmp` files after conversion
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.3 Write unit tests for conversion handler
    - Test successful conversion flow (mock S3 download, LibreOffice exec, S3 upload, DynamoDB update)
    - Test failure scenario sets `previewStatus` to `failed`
    - Test `/tmp` cleanup happens in both success and failure paths
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 3. Add CDK infrastructure for Conversion Lambda
  - [x] 3.1 Define the Conversion Lambda in CDK
    - Add a new Docker-based Lambda function `PointsMall-Conversion` in `packages/cdk/lib/api-stack.ts`
    - Use `DockerImageFunction` with the Dockerfile from `packages/backend/src/conversion/`
    - Set timeout to 120 seconds and memory to 1024 MB
    - Pass environment variables: `IMAGES_BUCKET`, `CONTENT_ITEMS_TABLE`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Configure IAM permissions for Conversion Lambda
    - Grant S3 read access to `content/*` path (read original files)
    - Grant S3 write access to `content/*` path (write preview PDFs)
    - Grant S3 delete access to `content/*` path (delete old preview PDFs on re-conversion)
    - Grant DynamoDB read/write access to ContentItems table (update `previewFileKey` and `previewStatus`)
    - _Requirements: 3.4, 3.5_

  - [x] 3.3 Grant Content Lambda permission to invoke Conversion Lambda
    - Add `CONVERSION_FUNCTION_NAME` environment variable to Content Lambda
    - Grant `lambda:InvokeFunction` permission from Content Lambda to Conversion Lambda
    - _Requirements: 3.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate conversion trigger into Content Lambda
  - [x] 5.1 Trigger conversion on content creation
    - Modify `createContentItem` in `packages/backend/src/content/upload.ts`
    - After creating the ContentItem, check if the file is an Office file using `isOfficeFile(fileName)`
    - If Office file: set `previewStatus: 'pending'` on the item, then invoke Conversion Lambda asynchronously (`InvocationType: 'Event'`)
    - If PDF file: skip conversion, leave `previewStatus` and `previewFileKey` undefined
    - Pass `{ contentId, fileKey, uploaderId, bucket, contentItemsTable }` as the Lambda payload
    - _Requirements: 1.1, 1.6, 2.3, 2.4_

  - [x] 5.2 Trigger re-conversion on content edit
    - Modify `editContentItem` in `packages/backend/src/content/edit.ts`
    - When `fileKey` changes and the new file is an Office file: set `previewStatus: 'pending'`, invoke Conversion Lambda (which will delete old preview PDF and generate new one)
    - When file changes from Office to PDF: delete old preview PDF from S3 (best-effort), clear `previewFileKey` and `previewStatus` fields
    - When file changes from PDF to Office: set `previewStatus: 'pending'`, invoke Conversion Lambda
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.3 Write unit tests for conversion trigger logic
    - Test that creating an Office file content item invokes Conversion Lambda
    - Test that creating a PDF content item does NOT invoke Conversion Lambda
    - Test that editing file from Office to Office triggers re-conversion
    - Test that editing file from Office to PDF clears preview fields and deletes old preview
    - Test that editing file from PDF to Office triggers conversion
    - _Requirements: 1.1, 1.6, 6.1, 6.2, 6.3, 6.4_

- [x] 6. Update admin content deletion to clean up preview files
  - [x] 6.1 Delete preview PDF on admin content deletion
    - Modify `deleteContent` in `packages/backend/src/content/admin.ts`
    - After fetching the ContentItem, check if `previewFileKey` is non-empty
    - If so, delete the preview PDF from S3 (best-effort, log error but don't block deletion)
    - _Requirements: 7.1, 7.2_

  - [ ]* 6.2 Write unit tests for preview file cleanup on deletion
    - Test that deletion of a content item with `previewFileKey` deletes both original and preview files
    - Test that preview PDF deletion failure does not block content deletion
    - Test that deletion of a content item without `previewFileKey` only deletes the original file
    - _Requirements: 7.1, 7.2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update frontend content detail page for unified PDF preview
  - [x] 8.1 Update ContentDetailPage to use PdfViewer for all documents
    - Modify `packages/frontend/src/pages/content/detail.tsx`
    - Remove the Microsoft Office Online Viewer iframe (`view.officeapps.live.com`) for Office documents
    - When `previewFileKey` is present: render PdfViewer with CloudFront URL of the preview PDF
    - When file is PDF (no `previewFileKey`): render PdfViewer with CloudFront URL of the original PDF
    - When `previewStatus` is `pending`: show a loading indicator with text "预览正在生成中，请稍候..."
    - When `previewStatus` is `failed`: show an error message "预览生成失败，暂时无法预览此文档"
    - Import and use the existing PdfViewer component from `packages/frontend/src/components/PdfViewer/`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 8.2 Add i18n keys for preview status messages
    - Add translation keys for preview pending and failed states in `packages/frontend/src/i18n/zh.ts`, `en.ts`, `zh-TW.ts`, `ja.ts`, `ko.ts`
    - Keys: `contentHub.detail.previewPending`, `contentHub.detail.previewFailed`
    - _Requirements: 4.3, 4.4_

- [x] 9. Ensure download returns original file
  - [x] 9.1 Verify download logic uses original fileKey
    - Review `getDownloadUrl` in `packages/backend/src/content/reservation.ts`
    - Confirm it uses `contentItem.fileKey` (original file), NOT `previewFileKey`
    - Ensure the presigned URL includes `ResponseContentDisposition` header with the original `fileName` for correct browser download naming
    - _Requirements: 5.1, 5.2_

  - [x] 9.2 Verify SuperAdmin download bypass
    - Review the download handler in `packages/backend/src/content/handler.ts`
    - Confirm SuperAdmin users can download without a reservation (existing behavior)
    - _Requirements: 5.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The Conversion Lambda uses a Docker image with LibreOffice — this is necessary because LibreOffice is too large for a standard Lambda layer
- The PdfViewer component already exists and loads pdf.js from CDN — do NOT install pdfjs-dist via npm (breaks Taro webpack)
- The Conversion Lambda is invoked asynchronously (`InvocationType: 'Event'`) so it does not block the content creation/edit response
- Download always uses the original `fileKey`, never the `previewFileKey`
