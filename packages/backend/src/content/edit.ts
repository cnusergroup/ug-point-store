import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages, isValidVideoUrl } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';

// ─── Edit Content Item ─────────────────────────────────────

export interface EditContentItemInput {
  contentId: string;
  userId: string;
  title?: string;
  description?: string;
  categoryId?: string;
  videoUrl?: string;       // empty string clears the field
  fileKey?: string;        // new S3 key
  fileName?: string;
  fileSize?: number;
}

export interface EditContentItemResult {
  success: boolean;
  item?: ContentItem;
  error?: { code: string; message: string };
}

/**
 * Edit an existing content item.
 * - Only the original uploader may edit (uploaderId === userId)
 * - Only pending or rejected items are editable
 * - Validates provided fields: title 1~100, description 1~2000, categoryId exists, videoUrl valid
 * - Replaces file if new fileKey differs from original; deletes old S3 object (best-effort)
 * - Resets status to pending, clears rejectReason/reviewerId/reviewedAt, updates updatedAt
 * - Does NOT modify likeCount, commentCount, reservationCount
 */
export async function editContentItem(
  input: EditContentItemInput,
  dynamoClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  tables: { contentItemsTable: string; categoriesTable: string },
  bucket: string,
): Promise<EditContentItemResult> {
  // 1. Fetch the content item
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId: input.contentId },
    }),
  );

  const item = getResult.Item as ContentItem | undefined;
  if (!item) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // 2. Permission check: uploaderId === userId
  if (item.uploaderId !== input.userId) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: ErrorMessages[ErrorCodes.FORBIDDEN] },
    };
  }

  // 3. Reservation check: content with reservations cannot be edited
  if (item.reservationCount > 0) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_EDITABLE, message: ErrorMessages[ErrorCodes.CONTENT_NOT_EDITABLE] },
    };
  }

  // 4. Field validation (only for provided fields)
  if (input.title !== undefined) {
    if (!input.title || input.title.length > 100) {
      return {
        success: false,
        error: { code: ErrorCodes.INVALID_CONTENT_TITLE, message: ErrorMessages[ErrorCodes.INVALID_CONTENT_TITLE] },
      };
    }
  }

  if (input.description !== undefined) {
    if (!input.description || input.description.length > 2000) {
      return {
        success: false,
        error: { code: ErrorCodes.INVALID_CONTENT_DESCRIPTION, message: ErrorMessages[ErrorCodes.INVALID_CONTENT_DESCRIPTION] },
      };
    }
  }

  let categoryName: string | undefined;
  if (input.categoryId !== undefined) {
    const categoryResult = await dynamoClient.send(
      new GetCommand({ TableName: tables.categoriesTable, Key: { categoryId: input.categoryId } }),
    );
    if (!categoryResult.Item) {
      return {
        success: false,
        error: { code: ErrorCodes.CATEGORY_NOT_FOUND, message: ErrorMessages[ErrorCodes.CATEGORY_NOT_FOUND] },
      };
    }
    categoryName = (categoryResult.Item as { name: string }).name;
  }

  if (input.videoUrl !== undefined && input.videoUrl !== '' && !isValidVideoUrl(input.videoUrl)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_VIDEO_URL, message: ErrorMessages[ErrorCodes.INVALID_VIDEO_URL] },
    };
  }

  // 5. File replacement: detect old fileKey if changed
  let oldFileKey: string | undefined;
  if (input.fileKey !== undefined && input.fileKey !== item.fileKey) {
    oldFileKey = item.fileKey;
  }

  // 6. Build DynamoDB UpdateCommand
  const now = new Date().toISOString();
  const expressionParts: string[] = [];
  const removeNames: string[] = [];
  const attrNames: Record<string, string> = {};
  const attrValues: Record<string, unknown> = {};

  // Always set status=pending and updatedAt
  expressionParts.push('#status = :pending');
  attrNames['#status'] = 'status';
  attrValues[':pending'] = 'pending';

  expressionParts.push('#updatedAt = :now');
  attrNames['#updatedAt'] = 'updatedAt';
  attrValues[':now'] = now;

  // Always remove rejectReason, reviewerId, reviewedAt
  removeNames.push('rejectReason', 'reviewerId', 'reviewedAt');

  // Optional field updates
  if (input.title !== undefined) {
    expressionParts.push('#title = :title');
    attrNames['#title'] = 'title';
    attrValues[':title'] = input.title;
  }

  if (input.description !== undefined) {
    expressionParts.push('#description = :description');
    attrNames['#description'] = 'description';
    attrValues[':description'] = input.description;
  }

  if (input.categoryId !== undefined) {
    expressionParts.push('#categoryId = :categoryId');
    attrNames['#categoryId'] = 'categoryId';
    attrValues[':categoryId'] = input.categoryId;

    expressionParts.push('#categoryName = :categoryName');
    attrNames['#categoryName'] = 'categoryName';
    attrValues[':categoryName'] = categoryName!;
  }

  if (input.videoUrl !== undefined) {
    if (input.videoUrl === '') {
      // Clear videoUrl
      removeNames.push('videoUrl');
    } else {
      expressionParts.push('#videoUrl = :videoUrl');
      attrNames['#videoUrl'] = 'videoUrl';
      attrValues[':videoUrl'] = input.videoUrl;
    }
  }

  if (input.fileKey !== undefined) {
    expressionParts.push('#fileKey = :fileKey');
    attrNames['#fileKey'] = 'fileKey';
    attrValues[':fileKey'] = input.fileKey;
  }

  if (input.fileName !== undefined) {
    expressionParts.push('#fileName = :fileName');
    attrNames['#fileName'] = 'fileName';
    attrValues[':fileName'] = input.fileName;
  }

  if (input.fileSize !== undefined) {
    expressionParts.push('#fileSize = :fileSize');
    attrNames['#fileSize'] = 'fileSize';
    attrValues[':fileSize'] = input.fileSize;
  }

  let updateExpression = 'SET ' + expressionParts.join(', ');
  if (removeNames.length > 0) {
    updateExpression += ' REMOVE ' + removeNames.join(', ');
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId: input.contentId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }),
  );

  // Build the updated item for the response
  const updatedItem: ContentItem = {
    ...item,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId, categoryName: categoryName! } : {}),
    ...(input.fileKey !== undefined ? { fileKey: input.fileKey } : {}),
    ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
    ...(input.fileSize !== undefined ? { fileSize: input.fileSize } : {}),
    status: 'pending',
    updatedAt: now,
  };

  // Handle videoUrl in the response
  if (input.videoUrl !== undefined) {
    if (input.videoUrl === '') {
      delete updatedItem.videoUrl;
    } else {
      updatedItem.videoUrl = input.videoUrl;
    }
  }

  // Clear review fields
  delete updatedItem.rejectReason;
  delete updatedItem.reviewerId;
  delete updatedItem.reviewedAt;

  // 7. Old file cleanup (best-effort)
  if (oldFileKey) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: oldFileKey }),
      );
    } catch (err) {
      console.error('Failed to delete old S3 file:', oldFileKey, err);
    }
  }

  return { success: true, item: updatedItem };
}
