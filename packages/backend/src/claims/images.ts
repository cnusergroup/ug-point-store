import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export interface GetClaimUploadUrlInput {
  userId: string;
  fileName: string;
  contentType: string;
}

export interface GetClaimUploadUrlResult {
  success: boolean;
  data?: { uploadUrl: string; key: string; url: string };
  error?: { code: string; message: string };
}

function extractExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * Generate a presigned PUT URL for uploading a claim image to S3.
 * Key format: claims/{userId}/{ulid}.{ext}
 */
export async function getClaimUploadUrl(
  input: GetClaimUploadUrlInput,
  s3Client: S3Client,
  bucketName: string,
): Promise<GetClaimUploadUrlResult> {
  const ext = extractExtension(input.fileName);
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_FILE_TYPE, message: ErrorMessages[ErrorCodes.INVALID_FILE_TYPE] },
    };
  }

  const key = `claims/${input.userId}/${ulid()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRES_IN });

  return {
    success: true,
    data: { uploadUrl, key, url: `/${key}` },
  };
}
