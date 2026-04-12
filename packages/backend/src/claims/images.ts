import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { generateUploadToken } from '../utils/upload-token';

const PRESIGNED_URL_EXPIRES_IN = 300; // 5 minutes
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const UPLOAD_VIA_CLOUDFRONT = process.env.UPLOAD_VIA_CLOUDFRONT === 'true';
const UPLOAD_TOKEN_SECRET = process.env.UPLOAD_TOKEN_SECRET || '';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'https://store.awscommunity.cn';

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

  let uploadUrl: string;
  if (UPLOAD_VIA_CLOUDFRONT) {
    if (!UPLOAD_TOKEN_SECRET) {
      throw new Error('UPLOAD_TOKEN_SECRET must be configured when UPLOAD_VIA_CLOUDFRONT is enabled');
    }
    const { token } = generateUploadToken({ key, expiresIn: PRESIGNED_URL_EXPIRES_IN }, UPLOAD_TOKEN_SECRET);
    uploadUrl = `${CLOUDFRONT_DOMAIN}/${key}?token=${token}`;
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
    data: { uploadUrl, key, url: `/${key}` },
  };
}
