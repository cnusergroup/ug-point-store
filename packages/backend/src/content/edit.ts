import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESClient } from '@aws-sdk/client-ses';
import { ErrorCodes, ErrorMessages, isValidVideoUrl, validateTagsArray, normalizeTagName, isOfficeFile } from '@points-mall/shared';
import type { ContentItem } from '@points-mall/shared';
import { syncTagsOnEdit } from './tags';
import { getFeatureToggles } from '../settings/feature-toggles';
import { sendContentUpdatedEmail } from '../email/notifications';

const CONVERSION_FUNCTION_NAME = process.env.CONVERSION_FUNCTION_NAME || '';

const lambdaClient = new LambdaClient({});

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
  tags?: string[];
}

export interface EditContentItemResult {
  success: boolean;
  item?: ContentItem;
  error?: { code: string; message: string };
}

export interface EditNotificationContext {
  dynamoClient: DynamoDBDocumentClient;
  sesClient: SESClient;
  reservationsTable: string;
  usersTable: string;
  emailTemplatesTable: string;
  senderEmail: string;
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
  tables: { contentItemsTable: string; categoriesTable: string; contentTagsTable?: string },
  bucket: string,
  notificationCtx?: EditNotificationContext,
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

  // 3. Field validation (only for provided fields)
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

  // 4b. Validate and normalize tags (optional)
  let normalizedTags: string[] | undefined;
  if (input.tags !== undefined) {
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

  // Read old tags for sync
  const oldTags = item.tags ?? [];

  // 5. File replacement: detect old fileKey if changed
  let oldFileKey: string | undefined;
  if (input.fileKey !== undefined && input.fileKey !== item.fileKey) {
    oldFileKey = item.fileKey;
  }

  // 5b. Determine file type transition for preview conversion
  //     Only relevant when fileKey actually changes
  const fileChanged = oldFileKey !== undefined;
  const oldFileName = item.fileName;
  const newFileName = input.fileName ?? item.fileName;
  const oldIsOffice = isOfficeFile(oldFileName);
  const newIsOffice = fileChanged ? isOfficeFile(newFileName) : false;
  // Transition types: 'office-to-office' | 'pdf-to-office' | 'office-to-pdf' | 'none'
  let conversionAction: 'trigger' | 'clear' | 'none' = 'none';
  if (fileChanged) {
    if (newIsOffice) {
      // Office → Office or PDF → Office: trigger conversion
      conversionAction = 'trigger';
    } else if (oldIsOffice && !newIsOffice) {
      // Office → PDF (or other non-Office): clear preview fields
      conversionAction = 'clear';
    }
    // PDF → PDF: no conversion action needed
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

  if (normalizedTags !== undefined) {
    expressionParts.push('#tags = :tags');
    attrNames['#tags'] = 'tags';
    attrValues[':tags'] = normalizedTags;
  }

  // Preview conversion fields based on file type transition
  if (conversionAction === 'trigger') {
    // Office → Office or PDF → Office: set previewStatus to pending
    expressionParts.push('#previewStatus = :previewStatusPending');
    attrNames['#previewStatus'] = 'previewStatus';
    attrValues[':previewStatusPending'] = 'pending';
  } else if (conversionAction === 'clear') {
    // Office → PDF: remove previewFileKey and previewStatus
    removeNames.push('previewFileKey', 'previewStatus');
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
    ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
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

  // Update preview fields in response based on conversion action
  if (conversionAction === 'trigger') {
    updatedItem.previewStatus = 'pending';
  } else if (conversionAction === 'clear') {
    delete updatedItem.previewFileKey;
    delete updatedItem.previewStatus;
  }

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

  // 8. Sync tag usage counts in ContentTags table
  if (normalizedTags !== undefined && tables.contentTagsTable) {
    await syncTagsOnEdit(oldTags, normalizedTags, dynamoClient, tables.contentTagsTable);
  }

  // 9. Preview conversion: handle S3 cleanup and Lambda invocation
  if (conversionAction === 'clear' && item.previewFileKey) {
    // Office → PDF: delete old preview PDF from S3 (best-effort)
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: item.previewFileKey }),
      );
    } catch (err) {
      console.error('Failed to delete old preview PDF:', item.previewFileKey, err);
    }
  }

  if (conversionAction === 'trigger') {
    // Office → Office or PDF → Office: invoke Conversion Lambda
    if (!CONVERSION_FUNCTION_NAME) {
      console.warn('[Content] CONVERSION_FUNCTION_NAME not configured, skipping conversion invocation');
    } else {
      try {
        const payload: Record<string, string> = {
          contentId: input.contentId,
          fileKey: input.fileKey!,
          uploaderId: item.uploaderId,
          bucket,
          contentItemsTable: tables.contentItemsTable,
        };
        // Pass old preview key for cleanup when re-converting (Office → Office)
        if (oldIsOffice && item.previewFileKey) {
          payload.oldPreviewFileKey = item.previewFileKey;
        }
        await lambdaClient.send(
          new InvokeCommand({
            FunctionName: CONVERSION_FUNCTION_NAME,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify(payload)),
          }),
        );
      } catch (err) {
        console.error('[Content] Failed to invoke Conversion Lambda (non-blocking):', err);
      }
    }
  }

  // 10. Fire-and-forget: send content updated notifications to active reservation users
  if (item.reservationCount > 0 && notificationCtx) {
    sendContentUpdatedNotifications(
      notificationCtx,
      input.contentId,
      updatedItem.title,
    ).catch((err) => {
      console.error('[Content] Failed to send content updated notifications:', err);
    });
  }

  return { success: true, item: updatedItem };
}


// ─── Content Updated Notifications (stub — implemented in Task 1.3) ───

/**
 * Query active reservations for the given contentId and send
 * a "contentUpdated" email to each reservation user.
 *
 * This function checks the emailContentUpdatedEnabled toggle,
 * queries the contentId-index GSI, filters for future activityDate,
 * and sends emails via SES. Errors are logged but never thrown.
 */
export async function sendContentUpdatedNotifications(
  ctx: EditNotificationContext,
  contentId: string,
  contentTitle: string,
): Promise<void> {
  try {
    // 1. Check emailContentUpdatedEnabled toggle — return early if disabled
    const toggles = await getFeatureToggles(ctx.dynamoClient, ctx.usersTable);
    if (!toggles.emailContentUpdatedEnabled) {
      return;
    }

    // 2. Query contentId-index GSI for all reservations matching contentId
    let reservations: Record<string, unknown>[] = [];
    try {
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const queryResult = await ctx.dynamoClient.send(
          new QueryCommand({
            TableName: ctx.reservationsTable,
            IndexName: 'contentId-index',
            KeyConditionExpression: '#pk = :pkVal',
            ExpressionAttributeNames: { '#pk': 'contentId' },
            ExpressionAttributeValues: { ':pkVal': contentId },
            ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
          }),
        );
        reservations.push(...(queryResult.Items ?? []));
        lastEvaluatedKey = queryResult.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);
    } catch (err) {
      console.error('[Content] Failed to query reservations for contentId:', contentId, err);
      return;
    }

    // 3. Filter for active reservations (activityDate > now)
    const now = new Date().toISOString();
    const activeReservations = reservations.filter(
      (r) => typeof r.activityDate === 'string' && r.activityDate > now,
    );

    if (activeReservations.length === 0) {
      return;
    }

    // 4. For each active reservation, send contentUpdated email
    const notificationCtx = {
      dynamoClient: ctx.dynamoClient,
      sesClient: ctx.sesClient,
      usersTable: ctx.usersTable,
      emailTemplatesTable: ctx.emailTemplatesTable,
      senderEmail: ctx.senderEmail,
    };

    for (const reservation of activeReservations) {
      const userId = reservation.userId as string;
      const activityTopic = (reservation.activityTopic as string) ?? '';
      const activityDate = (reservation.activityDate as string) ?? '';

      try {
        await sendContentUpdatedEmail(
          notificationCtx,
          userId,
          contentTitle,
          activityTopic,
          activityDate,
        );
      } catch (err) {
        console.error(`[Content] Failed to send contentUpdated email to user ${userId}:`, err);
      }
    }
  } catch (err) {
    console.error('[Content] Unexpected error in sendContentUpdatedNotifications:', err);
  }
}
