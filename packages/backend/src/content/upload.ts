import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages, isValidContentFileType, isValidVideoUrl } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024; // 50MB

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
 * Generate a presigned PUT URL for uploading a content document to S3.
 * Key format: content/{userId}/{ulid}/{fileName}
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

  const fileKey = `content/${input.userId}/${ulid()}/${input.fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileKey,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });

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
  tables: { contentItemsTable: string; categoriesTable: string },
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

  const now = new Date().toISOString();
  const contentId = ulid();
  const categoryName = (categoryResult.Item as { name: string }).name;

  const item: ContentItem = {
    contentId,
    title: input.title,
    description: input.description,
    categoryId: input.categoryId,
    categoryName,
    uploaderId: input.userId,
    uploaderNickname: input.userNickname,
    uploaderRole: input.userRole,
    fileKey: input.fileKey,
    fileName: input.fileName,
    fileSize: input.fileSize,
    ...(input.videoUrl ? { videoUrl: input.videoUrl } : {}),
    status: 'pending',
    likeCount: 0,
    commentCount: 0,
    reservationCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({ TableName: tables.contentItemsTable, Item: item }),
  );

  return { success: true, item };
}
