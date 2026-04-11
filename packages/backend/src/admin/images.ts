import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

const MAX_IMAGES = 5;
const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export interface GetUploadUrlInput {
  productId: string;
  fileName: string;
  contentType: string;
}

export interface GetUploadUrlResult {
  success: boolean;
  data?: {
    uploadUrl: string;
    key: string;
    url: string;
  };
  error?: { code: string; message: string };
}

/**
 * Extract file extension from a filename, normalized to lowercase.
 */
export function extractExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * Generate an S3 key for a product image.
 * Format: products/{productId}/{ulid}.{ext}
 */
export function generateS3Key(productId: string, ext: string): string {
  return `products/${productId}/${ulid()}.${ext}`;
}

/**
 * Generate a presigned PUT URL for uploading a product image to S3.
 * Validates image count limit and file type before generating the URL.
 */
export async function getUploadUrl(
  input: GetUploadUrlInput,
  currentImageCount: number,
  s3Client: S3Client,
  bucketName: string,
): Promise<GetUploadUrlResult> {
  if (currentImageCount >= MAX_IMAGES) {
    return {
      success: false,
      error: { code: ErrorCodes.IMAGE_LIMIT_EXCEEDED, message: ErrorMessages[ErrorCodes.IMAGE_LIMIT_EXCEEDED] },
    };
  }

  const ext = extractExtension(input.fileName);
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_FILE_TYPE, message: ErrorMessages[ErrorCodes.INVALID_FILE_TYPE] },
    };
  }

  const key = generateS3Key(input.productId, ext);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });

  return {
    success: true,
    data: {
      uploadUrl,
      key,
      url: `/${key}`,
    },
  };
}

/**
 * Generate a presigned PUT URL for uploading a product image without a productId.
 * Used during product creation before the product exists.
 * S3 key format: products/temp/{ulid}.{ext}
 */
export async function getTempUploadUrl(
  input: { fileName: string; contentType: string },
  s3Client: S3Client,
  bucketName: string,
): Promise<GetUploadUrlResult> {
  const ext = extractExtension(input.fileName);
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_FILE_TYPE, message: ErrorMessages[ErrorCodes.INVALID_FILE_TYPE] },
    };
  }

  const key = `products/temp/${ulid()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });

  return {
    success: true,
    data: {
      uploadUrl,
      key,
      url: `/${key}`,
    },
  };
}

/**
 * Delete an image from S3 by its key.
 */
export async function deleteImage(
  key: string,
  s3Client: S3Client,
  bucketName: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );

  return { success: true };
}
