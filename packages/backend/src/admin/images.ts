import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { generateUploadToken } from '../utils/upload-token';

const MAX_IMAGES = 5;
const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const UPLOAD_VIA_CLOUDFRONT = process.env.UPLOAD_VIA_CLOUDFRONT === 'true';
const UPLOAD_TOKEN_SECRET = process.env.UPLOAD_TOKEN_SECRET || '';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'https://store.awscommunity.cn';

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
 * Generate a presigned PUT URL for uploading a product image to S3.
 * Validates image count limit and file type before generating the URL.
 * When UPLOAD_VIA_CLOUDFRONT is enabled, generates a CloudFront URL with an HMAC token.
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

  let uploadUrl: string;
  if (UPLOAD_VIA_CLOUDFRONT) {
    uploadUrl = generateCloudFrontUploadUrl(key);
  } else {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: input.contentType,
    });
    uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });
  }

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
 * When UPLOAD_VIA_CLOUDFRONT is enabled, generates a CloudFront URL with an HMAC token.
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

  let uploadUrl: string;
  if (UPLOAD_VIA_CLOUDFRONT) {
    uploadUrl = generateCloudFrontUploadUrl(key);
  } else {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: input.contentType,
    });
    uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });
  }

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
