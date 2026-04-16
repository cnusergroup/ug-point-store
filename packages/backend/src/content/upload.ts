import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages, isValidContentFileType, isValidVideoUrl, validateTagsArray, normalizeTagName } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';
import { generateUploadToken } from '../utils/upload-token';
import { syncTagsOnCreate } from './tags';

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024; // 50MB

const UPLOAD_VIA_CLOUDFRONT = process.env.UPLOAD_VIA_CLOUDFRONT === 'true';
const UPLOAD_TOKEN_SECRET = process.env.UPLOAD_TOKEN_SECRET || '';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'https://store.awscommunity.cn';

// ─── Upload URL ────────────────────────────────────────────

export interface GetContentUploadUrlInput {
  userId: string;
  fileName: string;
  contentType: string;
}

export interface GetContentUploadUrlResult {
  success: boolean;
  data?: { uploadUrl: string; fileKey: string };
  error?: { code: string; message: string };
}

/**
 * Generate a CloudFront upload URL with an HMAC token for the given S3 key.
 * Throws if UPLOAD_TOKEN_SECRET is not configured.
 */
function generateCloudFrontUploadUrl(key: string): string {
  if (!UPLOAD_TOKEN_SECRET) {
    throw new Error('UPLOAD_TOKEN_SECRET must be configured when UPLOAD_VIA_CLOUDFRONT is enabled');
  }
  const { token } = generateUploadToken({ key, expiresIn: PRESIGNED_URL_EXPIRES_IN }, UPLOAD_TOKEN_SECRET);
  return `${CLOUDFRONT_DOMAIN}/${key}?token=${token}`;
}

/**
 * Extract file extension from a filename, normalized to lowercase.
 */
function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * Generate a presigned PUT URL for uploading a content document to S3.
 * Key format: content/{userId}/{ulid}.{ext} (original filename stored in DynamoDB only)
 * When UPLOAD_VIA_CLOUDFRONT is enabled, generates a CloudFront URL with an HMAC token.
 */
export async function getContentUploadUrl(
  input: GetContentUploadUrlInput,
  s3Client: S3Client,
  bucket: string,
): Promise<GetContentUploadUrlResult> {
  if (!isValidContentFileType(input.contentType)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CONTENT_FILE_TYPE, message: ErrorMessages[ErrorCodes.INVALID_CONTENT_FILE_TYPE] },
    };
  }

  const ext = getFileExtension(input.fileName) || 'bin';
  const fileKey = `content/temp/${input.userId}/${ulid()}.${ext}`;

  let uploadUrl: string;
  if (UPLOAD_VIA_CLOUDFRONT) {
    uploadUrl = generateCloudFrontUploadUrl(fileKey);
  } else {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: input.contentType,
    });
    uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });
  }

  return { success: true, data: { uploadUrl, fileKey } };
}


// ─── Create Content Item ───────────────────────────────────

export interface CreateContentItemInput {
  userId: string;
  userNickname: string;
  userRole: string;
  title: string;
  description: string;
  categoryId: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  videoUrl?: string;
  tags?: string[];
}

export interface CreateContentItemResult {
  success: boolean;
  item?: ContentItem;
  error?: { code: string; message: string };
}

/**
 * Create a new content item after validating inputs.
 * - title: 1~100 chars
 * - description: 1~2000 chars
 * - categoryId must exist in ContentCategories table
 * - videoUrl (optional) must be a valid URL
 * - status is set to 'pending', counters initialised to 0
 */
export async function createContentItem(
  input: CreateContentItemInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentItemsTable: string; categoriesTable: string; contentTagsTable?: string },
  s3Options?: { s3Client: S3Client; bucket: string },
): Promise<CreateContentItemResult> {
  // Validate title
  if (!input.title || input.title.length > 100) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CONTENT_TITLE, message: ErrorMessages[ErrorCodes.INVALID_CONTENT_TITLE] },
    };
  }

  // Validate description
  if (!input.description || input.description.length > 2000) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CONTENT_DESCRIPTION, message: ErrorMessages[ErrorCodes.INVALID_CONTENT_DESCRIPTION] },
    };
  }

  // Validate categoryId exists
  const categoryResult = await dynamoClient.send(
    new GetCommand({ TableName: tables.categoriesTable, Key: { categoryId: input.categoryId } }),
  );
  if (!categoryResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.CATEGORY_NOT_FOUND, message: ErrorMessages[ErrorCodes.CATEGORY_NOT_FOUND] },
    };
  }

  // Validate videoUrl (optional)
  if (input.videoUrl !== undefined && input.videoUrl !== '' && !isValidVideoUrl(input.videoUrl)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_VIDEO_URL, message: ErrorMessages[ErrorCodes.INVALID_VIDEO_URL] },
    };
  }

  // Validate and normalize tags (optional)
  let normalizedTags: string[] = [];
  if (input.tags && input.tags.length > 0) {
    const tagValidation = validateTagsArray(input.tags);
    if (!tagValidation.valid) {
      const errorCode = tagValidation.error as string;
      return {
        success: false,
        error: { code: errorCode, message: ErrorMessages[errorCode as keyof typeof ErrorMessages] },
      };
    }
    normalizedTags = tagValidation.normalizedTags;
  }

  const now = new Date().toISOString();
  const contentId = ulid();
  const categoryName = (categoryResult.Item as { name: string }).name;

  // Move file from temp path to permanent path if it's in content/temp/
  let finalFileKey = input.fileKey;
  if (input.fileKey.startsWith('content/temp/') && s3Options) {
    const permanentKey = input.fileKey.replace('content/temp/', 'content/');
    try {
      await s3Options.s3Client.send(new CopyObjectCommand({
        Bucket: s3Options.bucket,
        CopySource: `${s3Options.bucket}/${input.fileKey}`,
        Key: permanentKey,
      }));
      await s3Options.s3Client.send(new DeleteObjectCommand({
        Bucket: s3Options.bucket,
        Key: input.fileKey,
      }));
      finalFileKey = permanentKey;
    } catch (err) {
      console.error('Failed to move content file from temp:', err);
      // Fall back to using the temp key — file will be cleaned up by lifecycle rule
      finalFileKey = input.fileKey;
    }
  }

  const item: ContentItem = {
    contentId,
    title: input.title,
    description: input.description,
    categoryId: input.categoryId,
    categoryName,
    uploaderId: input.userId,
    uploaderNickname: input.userNickname,
    uploaderRole: input.userRole,
    fileKey: finalFileKey,
    fileName: input.fileName,
    fileSize: input.fileSize,
    ...(input.videoUrl ? { videoUrl: input.videoUrl } : {}),
    status: 'pending',
    tags: normalizedTags,
    likeCount: 0,
    commentCount: 0,
    reservationCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({ TableName: tables.contentItemsTable, Item: item }),
  );

  // Sync tag usage counts in ContentTags table
  if (normalizedTags.length > 0 && tables.contentTagsTable) {
    await syncTagsOnCreate(normalizedTags, dynamoClient, tables.contentTagsTable);
  }

  return { success: true, item };
}
