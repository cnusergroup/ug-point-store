import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';

const DOWNLOAD_URL_EXPIRES_IN = 3600; // 1 hour

// ─── Create Reservation ────────────────────────────────────

export interface CreateReservationInput {
  contentId: string;
  userId: string;
}

export interface CreateReservationResult {
  success: boolean;
  alreadyReserved?: boolean;
  error?: { code: string; message: string };
}

/**
 * Create a reservation for a content item.
 * - PK = `{userId}#{contentId}`, ConditionExpression `attribute_not_exists(pk)` prevents duplicates
 * - If already reserved (ConditionalCheckFailedException), return success with alreadyReserved flag
 * - For new reservations, use TransactWriteItems atomic operation:
 *   1. PutCommand to write Reservations table (with ConditionExpression)
 *   2. UpdateCommand to increment ContentItems table's reservationCount
 *   3. UpdateCommand to increment uploader's Users table points
 *   4. PutCommand to write PointsRecords table, source="content_hub_reservation"
 */
export async function createReservation(
  input: CreateReservationInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    reservationsTable: string;
    contentItemsTable: string;
    usersTable: string;
    pointsRecordsTable: string;
  },
  rewardPoints: number,
): Promise<CreateReservationResult> {
  const pk = `${input.userId}#${input.contentId}`;
  const now = new Date().toISOString();

  // 1. Get the content item to find the uploaderId
  const contentResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId: input.contentId },
    }),
  );

  const contentItem = contentResult.Item as ContentItem | undefined;
  if (!contentItem) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // 2. Get uploader's current points for balanceAfter calculation
  const uploaderResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId: contentItem.uploaderId },
      ProjectionExpression: 'points',
    }),
  );
  const currentPoints = uploaderResult.Item?.points ?? 0;
  const newBalance = currentPoints + rewardPoints;

  const recordId = ulid();

  // 3. Atomic transaction: create reservation + increment reservationCount + award points + create points record
  try {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // a. Put reservation record (with condition to prevent duplicates)
          {
            Put: {
              TableName: tables.reservationsTable,
              Item: {
                pk,
                userId: input.userId,
                contentId: input.contentId,
                createdAt: now,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          // b. Increment ContentItems reservationCount
          {
            Update: {
              TableName: tables.contentItemsTable,
              Key: { contentId: input.contentId },
              UpdateExpression: 'SET reservationCount = if_not_exists(reservationCount, :zero) + :inc, updatedAt = :now',
              ExpressionAttributeValues: {
                ':inc': 1,
                ':now': now,
                ':zero': 0,
              },
            },
          },
          // c. Increment uploader's points
          {
            Update: {
              TableName: tables.usersTable,
              Key: { userId: contentItem.uploaderId },
              UpdateExpression: 'SET points = points + :pv, updatedAt = :now',
              ExpressionAttributeValues: {
                ':pv': rewardPoints,
                ':now': now,
              },
            },
          },
          // d. Create points record
          {
            Put: {
              TableName: tables.pointsRecordsTable,
              Item: {
                recordId,
                userId: contentItem.uploaderId,
                type: 'earn',
                amount: rewardPoints,
                source: 'content_hub_reservation',
                balanceAfter: newBalance,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );
  } catch (err: any) {
    // ConditionalCheckFailedException means the reservation already exists
    if (err.name === 'TransactionCanceledException') {
      // Check if the first reason is ConditionalCheckFailed (reservation already exists)
      const reasons = err.CancellationReasons ?? [];
      if (reasons.length > 0 && reasons[0]?.Code === 'ConditionalCheckFailed') {
        return { success: true, alreadyReserved: true };
      }
    }
    throw err;
  }

  return { success: true };
}

// ─── Get Download URL ──────────────────────────────────────

export interface GetDownloadUrlResult {
  success: boolean;
  downloadUrl?: string;
  error?: { code: string; message: string };
}

/**
 * Get a presigned download URL for a content item's document.
 * - Confirms user has a reservation for this content
 * - Generates S3 GetObject presigned URL with 1 hour expiry
 */
export async function getDownloadUrl(
  contentId: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  tables: { contentItemsTable: string; reservationsTable: string },
  bucket: string,
): Promise<GetDownloadUrlResult> {
  const pk = `${userId}#${contentId}`;

  // 1. Check reservation exists
  const reservationResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.reservationsTable,
      Key: { pk },
    }),
  );

  if (!reservationResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.RESERVATION_REQUIRED, message: ErrorMessages[ErrorCodes.RESERVATION_REQUIRED] },
    };
  }

  // 2. Get content item's fileKey
  const contentResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId },
    }),
  );

  const contentItem = contentResult.Item as ContentItem | undefined;
  if (!contentItem) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // 3. Generate presigned download URL
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: contentItem.fileKey,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: DOWNLOAD_URL_EXPIRES_IN });

  return { success: true, downloadUrl };
}

// ─── Get Preview URL ───────────────────────────────────────

export interface GetPreviewUrlResult {
  success: boolean;
  previewUrl?: string;
  error?: { code: string; message: string };
}

/**
 * Get a presigned URL for previewing a content item's document.
 * No reservation required — any authenticated user can preview.
 * Short expiry (15 minutes) for security.
 */
export async function getPreviewUrl(
  contentId: string,
  dynamoClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  contentItemsTable: string,
  bucket: string,
): Promise<GetPreviewUrlResult> {
  const contentResult = await dynamoClient.send(
    new GetCommand({
      TableName: contentItemsTable,
      Key: { contentId },
    }),
  );

  const contentItem = contentResult.Item as ContentItem | undefined;
  if (!contentItem || contentItem.status !== 'approved') {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: contentItem.fileKey,
  });

  const previewUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes

  return { success: true, previewUrl };
}
