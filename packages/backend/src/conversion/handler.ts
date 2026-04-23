import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

// ─── Types ─────────────────────────────────────────────────

export interface ConversionEvent {
  contentId: string;
  fileKey: string;           // S3 key of original file
  uploaderId: string;        // For constructing preview path
  bucket: string;            // S3 bucket name
  contentItemsTable: string; // DynamoDB table name
  oldPreviewFileKey?: string; // Previous preview PDF to delete (on re-conversion)
}

// ─── AWS Clients ───────────────────────────────────────────

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Helpers ───────────────────────────────────────────────

/**
 * Extract the base file name (without extension) from an S3 key.
 * e.g. "content/user123/abc123.pptx" → "abc123"
 */
function extractFileId(fileKey: string): string {
  const baseName = path.basename(fileKey);
  const dotIndex = baseName.lastIndexOf('.');
  return dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
}

/**
 * Build the preview PDF S3 key.
 * Format: content/{uploaderId}/{fileId}_preview.pdf
 */
export function buildPreviewKey(uploaderId: string, fileKey: string): string {
  const fileId = extractFileId(fileKey);
  return `content/${uploaderId}/${fileId}_preview.pdf`;
}

/**
 * Stream an S3 object body to a local file.
 */
async function streamToFile(body: Readable, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    body.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

/**
 * Update the ContentItem previewStatus (and optionally previewFileKey) in DynamoDB.
 */
async function updatePreviewStatus(
  contentId: string,
  table: string,
  status: 'completed' | 'failed',
  previewFileKey?: string,
): Promise<void> {
  if (status === 'completed' && previewFileKey) {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { contentId },
        UpdateExpression: 'SET #previewFileKey = :pfk, #previewStatus = :ps, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#previewFileKey': 'previewFileKey',
          '#previewStatus': 'previewStatus',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':pfk': previewFileKey,
          ':ps': status,
          ':now': new Date().toISOString(),
        },
      }),
    );
  } else {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { contentId },
        UpdateExpression: 'SET #previewStatus = :ps, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#previewStatus': 'previewStatus',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':ps': status,
          ':now': new Date().toISOString(),
        },
      }),
    );
  }
}

// ─── Handler ───────────────────────────────────────────────

export const handler = async (event: ConversionEvent): Promise<void> => {
  const { contentId, fileKey, uploaderId, bucket, contentItemsTable, oldPreviewFileKey } = event;
  const tmpDir = `/tmp/${contentId}`;
  const originalFileName = path.basename(fileKey);
  const localFilePath = path.join(tmpDir, originalFileName);

  console.log(`[Conversion] Starting conversion for contentId=${contentId}, fileKey=${fileKey}`);

  try {
    // 1. Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true });

    // 2. Download original file from S3
    console.log(`[Conversion] Downloading ${fileKey} from S3 bucket ${bucket}`);
    const getResult = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
    );

    if (!getResult.Body) {
      throw new Error(`S3 GetObject returned empty body for key: ${fileKey}`);
    }

    await streamToFile(getResult.Body as Readable, localFilePath);
    console.log(`[Conversion] Downloaded to ${localFilePath}`);

    // 3. Execute LibreOffice headless conversion to PDF
    //    shelf's lambda-libreoffice-base image has 'libreoffice' in PATH
    //    Must cd to /tmp first per shelf's documentation
    console.log(`[Conversion] Converting ${originalFileName} to PDF`);
    const libreOfficeCmd = `cd /tmp && libreoffice --headless --invisible --nodefault --view --nolockcheck --nologo --norestore --convert-to pdf --outdir "${tmpDir}" "${localFilePath}"`;
    execSync(libreOfficeCmd, { timeout: 90_000, stdio: 'pipe' });

    // 4. Find the resulting PDF file
    //    LibreOffice replaces the original extension with .pdf
    const files = fs.readdirSync(tmpDir);
    const pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'));
    if (!pdfFile) {
      throw new Error(`LibreOffice conversion produced no PDF file. Files in tmpDir: ${files.join(', ')}`);
    }

    const localPdfPath = path.join(tmpDir, pdfFile);
    console.log(`[Conversion] PDF generated: ${pdfFile}`);

    // 5. Upload the resulting PDF to S3
    const previewKey = buildPreviewKey(uploaderId, fileKey);
    const pdfBuffer = fs.readFileSync(localPdfPath);

    console.log(`[Conversion] Uploading preview PDF to ${previewKey}`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: previewKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }),
    );

    // 6. Update DynamoDB: set previewFileKey and previewStatus = 'completed'
    console.log(`[Conversion] Updating DynamoDB: previewFileKey=${previewKey}, previewStatus=completed`);
    await updatePreviewStatus(contentId, contentItemsTable, 'completed', previewKey);

    // 7. Delete old preview PDF if provided and different from new key
    if (oldPreviewFileKey && oldPreviewFileKey !== previewKey) {
      console.log(`[Conversion] Deleting old preview PDF: ${oldPreviewFileKey}`);
      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: oldPreviewFileKey }),
        );
      } catch (deleteErr) {
        console.error(`[Conversion] Failed to delete old preview PDF (non-blocking):`, deleteErr);
      }
    }

    console.log(`[Conversion] Conversion completed successfully for contentId=${contentId}`);
  } catch (error) {
    // On failure: set previewStatus to 'failed' and log the error
    console.error(`[Conversion] Conversion failed for contentId=${contentId}:`, error);

    try {
      await updatePreviewStatus(contentId, contentItemsTable, 'failed');
    } catch (updateErr) {
      console.error(`[Conversion] Failed to update previewStatus to 'failed':`, updateErr);
    }
  } finally {
    // Clean up /tmp files
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`[Conversion] Cleaned up ${tmpDir}`);
      }
    } catch (cleanupErr) {
      console.error(`[Conversion] Failed to clean up ${tmpDir}:`, cleanupErr);
    }
  }
};
