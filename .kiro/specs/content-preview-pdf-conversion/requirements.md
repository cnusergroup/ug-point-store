# Requirements Document

## Introduction

上传 Office 文件（PPT/PPTX/DOC/DOCX）时自动转换为 PDF 用于安全预览，前端统一使用 pdf.js（CDN 加载）渲染预览，下载时仍提供原始文件。此功能解决当前 Microsoft Office Online Viewer 暴露下载按钮且在中国大陆无法使用 Google Docs Viewer 的问题，实现安全、统一的文档预览体验。

## Glossary

- **Content_Lambda**: 处理内容中心业务逻辑的 AWS Lambda 函数（PointsMall-Content）
- **Conversion_Lambda**: 专门负责将 Office 文件转换为 PDF 的 AWS Lambda 函数，内置 LibreOffice 运行时
- **PdfViewer**: 前端基于 pdf.js CDN 加载的 PDF 渲染组件（packages/frontend/src/components/PdfViewer/）
- **ContentItem**: DynamoDB 中存储的内容记录，包含 fileKey、fileName、fileType 等字段
- **Preview_PDF**: 由 Office 文件转换生成的 PDF 文件，仅用于预览，存储路径为 content/{uploaderId}/{fileId}_preview.pdf
- **Original_File**: 用户上传的原始 Office 文件（PPT/PPTX/DOC/DOCX），存储在 S3 中供下载使用
- **S3_Bucket**: 存储所有内容文件的 AWS S3 存储桶
- **CloudFront**: 用于分发静态文件的 AWS CDN 服务
- **Office_File**: 指 PPT、PPTX、DOC、DOCX 四种格式的 Microsoft Office 文档

## Requirements

### Requirement 1: Office 文件上传后自动触发 PDF 转换

**User Story:** As a 内容上传者, I want Office 文件在上传后自动转换为 PDF, so that 其他用户可以安全地预览文档内容而无法直接下载原始文件。

#### Acceptance Criteria

1. WHEN a ContentItem is created with an Office_File (PPT/PPTX/DOC/DOCX), THE Content_Lambda SHALL invoke the Conversion_Lambda asynchronously to convert the Original_File to Preview_PDF
2. THE Conversion_Lambda SHALL use LibreOffice to convert the Office_File to PDF format
3. WHEN the conversion completes successfully, THE Conversion_Lambda SHALL store the Preview_PDF at the path `content/{uploaderId}/{fileId}_preview.pdf` in the S3_Bucket
4. WHEN the conversion completes successfully, THE Conversion_Lambda SHALL update the ContentItem record in DynamoDB by setting the `previewFileKey` field to the Preview_PDF path
5. IF the conversion fails, THEN THE Conversion_Lambda SHALL log the error details and set the ContentItem `previewStatus` field to `failed`
6. WHEN a ContentItem is created with a PDF file, THE Content_Lambda SHALL skip the conversion process and leave `previewFileKey` empty (the original PDF is used directly for preview)

### Requirement 2: ContentItem 数据模型扩展

**User Story:** As a 开发者, I want ContentItem 类型包含预览相关字段, so that 前端可以判断使用哪个文件进行预览渲染。

#### Acceptance Criteria

1. THE ContentItem type SHALL include an optional `previewFileKey` field of type string to store the Preview_PDF S3 path
2. THE ContentItem type SHALL include an optional `previewStatus` field with values `pending`, `completed`, or `failed` to indicate the conversion state
3. WHEN a new Office_File ContentItem is created, THE Content_Lambda SHALL set `previewStatus` to `pending`
4. WHEN a new PDF ContentItem is created, THE Content_Lambda SHALL leave `previewStatus` undefined (no conversion needed)

### Requirement 3: Conversion Lambda 基础设施

**User Story:** As a 运维人员, I want 一个独立的 Lambda 函数负责 PDF 转换, so that 转换过程不会影响主业务 Lambda 的性能和超时限制。

#### Acceptance Criteria

1. THE CDK Stack SHALL define a new Conversion_Lambda with a Docker-based runtime that includes LibreOffice
2. THE Conversion_Lambda SHALL have a timeout of at least 120 seconds to accommodate large file conversions
3. THE Conversion_Lambda SHALL have at least 1024 MB memory to support LibreOffice execution
4. THE Conversion_Lambda SHALL have read access to the Original_File path and write access to the Preview_PDF path in the S3_Bucket
5. THE Conversion_Lambda SHALL have write access to the ContentItem DynamoDB table to update `previewFileKey` and `previewStatus`
6. THE Content_Lambda SHALL have permission to invoke the Conversion_Lambda asynchronously

### Requirement 4: 前端统一使用 PdfViewer 预览文档

**User Story:** As a 内容浏览者, I want 所有文档（PDF 和 Office 文件）都使用相同的预览组件渲染, so that 我获得一致的预览体验且无法通过预览界面下载原始文件。

#### Acceptance Criteria

1. WHEN a ContentItem has a non-empty `previewFileKey`, THE detail page SHALL use the PdfViewer component to render the Preview_PDF via CloudFront URL
2. WHEN a ContentItem is a PDF file (no `previewFileKey`), THE detail page SHALL use the PdfViewer component to render the original PDF via CloudFront URL
3. WHILE the `previewStatus` is `pending`, THE detail page SHALL display a loading indicator with the text informing the user that the preview is being generated
4. WHILE the `previewStatus` is `failed`, THE detail page SHALL display an error message indicating that the preview is unavailable
5. THE detail page SHALL remove the Microsoft Office Online Viewer iframe for Office documents
6. THE PdfViewer component SHALL load pdf.js from CDN (not via npm pdfjs-dist package) to avoid Taro webpack build conflicts

### Requirement 5: 下载提供原始文件

**User Story:** As a 已预约用户, I want 下载时获得原始 Office 文件而非 PDF 预览版, so that 我可以编辑和使用完整格式的文档。

#### Acceptance Criteria

1. WHEN a user requests to download a ContentItem, THE Content_Lambda SHALL generate a presigned URL for the Original_File (using `fileKey`), not the Preview_PDF
2. THE download response SHALL include the original `fileName` so the browser uses the correct file name and extension
3. WHEN a SuperAdmin user requests to download, THE Content_Lambda SHALL provide the Original_File directly without requiring a reservation

### Requirement 6: 内容编辑时重新触发转换

**User Story:** As a 内容上传者, I want 编辑内容并替换文件后重新生成 PDF 预览, so that 预览始终与最新上传的文件一致。

#### Acceptance Criteria

1. WHEN a ContentItem is edited and the `fileKey` is changed to a new Office_File, THE Content_Lambda SHALL invoke the Conversion_Lambda to generate a new Preview_PDF
2. WHEN a new Preview_PDF is generated, THE Conversion_Lambda SHALL delete the old Preview_PDF from the S3_Bucket
3. WHEN a ContentItem file is changed from an Office_File to a PDF, THE Content_Lambda SHALL delete the old Preview_PDF and clear the `previewFileKey` field
4. WHEN a ContentItem file is changed from a PDF to an Office_File, THE Content_Lambda SHALL invoke the Conversion_Lambda to generate a Preview_PDF

### Requirement 7: 管理员删除内容时清理预览文件

**User Story:** As a 管理员, I want 删除内容时同时清理 Preview_PDF 文件, so that S3 存储中不会残留无用的预览文件。

#### Acceptance Criteria

1. WHEN an admin deletes a ContentItem that has a non-empty `previewFileKey`, THE Admin_Lambda SHALL delete both the Original_File and the Preview_PDF from the S3_Bucket
2. IF the Preview_PDF deletion fails, THEN THE Admin_Lambda SHALL log the error but still proceed with the ContentItem deletion (non-blocking cleanup)
