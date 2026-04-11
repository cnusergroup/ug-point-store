import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ContentItem, ContentCategory, ContentStatus } from '@points-mall/shared';

// ─── Review Content ────────────────────────────────────────

export interface ReviewContentInput {
  contentId: string;
  reviewerId: string;
  action: 'approve' | 'reject';
  rejectReason?: string;
}

export interface ReviewContentResult {
  success: boolean;
  item?: ContentItem;
  error?: { code: string; message: string };
}

/**
 * Review a content item: approve or reject.
 * - Fetches the content record; returns CONTENT_NOT_FOUND if missing
 * - Returns CONTENT_ALREADY_REVIEWED if status is not pending
 * - approve: sets status=approved, records reviewerId and reviewedAt
 * - reject: sets status=rejected, records rejectReason, reviewerId and reviewedAt
 */
export async function reviewContent(
  input: ReviewContentInput,
  dynamoClient: DynamoDBDocumentClient,
  contentItemsTable: string,
): Promise<ReviewContentResult> {
  // 1. Get the content record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: contentItemsTable,
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

  // 2. Check status is pending
  if (item.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_ALREADY_REVIEWED, message: ErrorMessages[ErrorCodes.CONTENT_ALREADY_REVIEWED] },
    };
  }

  const now = new Date().toISOString();

  if (input.action === 'approve') {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: contentItemsTable,
        Key: { contentId: input.contentId },
        UpdateExpression: 'SET #status = :approved, reviewerId = :rid, reviewedAt = :rat, updatedAt = :now',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'approved',
          ':pending': 'pending',
          ':rid': input.reviewerId,
          ':rat': now,
          ':now': now,
        },
      }),
    );

    const updatedItem: ContentItem = {
      ...item,
      status: 'approved',
      reviewerId: input.reviewerId,
      reviewedAt: now,
      updatedAt: now,
    };

    return { success: true, item: updatedItem };
  }

  // reject
  await dynamoClient.send(
    new UpdateCommand({
      TableName: contentItemsTable,
      Key: { contentId: input.contentId },
      UpdateExpression: 'SET #status = :rejected, rejectReason = :reason, reviewerId = :rid, reviewedAt = :rat, updatedAt = :now',
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':rejected': 'rejected',
        ':pending': 'pending',
        ':reason': input.rejectReason ?? '',
        ':rid': input.reviewerId,
        ':rat': now,
        ':now': now,
      },
    }),
  );

  const updatedItem: ContentItem = {
    ...item,
    status: 'rejected',
    rejectReason: input.rejectReason ?? '',
    reviewerId: input.reviewerId,
    reviewedAt: now,
    updatedAt: now,
  };

  return { success: true, item: updatedItem };
}

// ─── List All Content (Admin) ──────────────────────────────

export interface ListAllContentOptions {
  status?: ContentStatus;
  pageSize?: number;
  lastKey?: string;
}

export interface ListAllContentResult {
  success: boolean;
  items?: ContentItem[];
  lastKey?: string;
}

/**
 * List all content items for admin view.
 * - With status filter: uses GSI `status-createdAt-index` for efficient query
 * - Without filter: Scan + client-side sort by createdAt descending
 * - Supports cursor-based pagination via lastKey
 */
export async function listAllContent(
  options: ListAllContentOptions,
  dynamoClient: DynamoDBDocumentClient,
  contentItemsTable: string,
): Promise<ListAllContentResult> {
  const pageSize = Math.min(options.pageSize ?? 20, 100);

  let exclusiveStartKey: Record<string, any> | undefined;
  if (options.lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'));
    } catch {
      exclusiveStartKey = undefined;
    }
  }

  if (options.status) {
    // Use GSI status-createdAt-index for efficient query by status
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: contentItemsTable,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': options.status },
        ScanIndexForward: false,
        Limit: pageSize,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );

    const items = (result.Items ?? []) as ContentItem[];
    const responseLastKey = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined;

    return { success: true, items, lastKey: responseLastKey };
  }

  // No status filter: Scan + sort by createdAt descending
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: contentItemsTable,
      Limit: pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  );

  const items = ((result.Items ?? []) as ContentItem[]).sort(
    (a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0),
  );

  const responseLastKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { success: true, items, lastKey: responseLastKey };
}

// ─── Delete Content ────────────────────────────────────────

/**
 * Delete a content item and all associated records.
 * - Deletes the S3 document file
 * - Batch deletes associated Comments, Likes, Reservations records
 * - Deletes the ContentItem record
 */
export async function deleteContent(
  contentId: string,
  dynamoClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  tables: {
    contentItemsTable: string;
    commentsTable: string;
    likesTable: string;
    reservationsTable: string;
  },
  bucket: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  // 1. Get the content item to find the fileKey
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId },
    }),
  );

  const item = getResult.Item as ContentItem | undefined;
  if (!item) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // 2. Delete S3 document file
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: item.fileKey }),
    );
  } catch {
    // Log but don't block deletion
  }

  // 3. Batch delete associated Comments (query by contentId-createdAt-index)
  await batchDeleteByGSI(
    dynamoClient,
    tables.commentsTable,
    'contentId-createdAt-index',
    'contentId',
    contentId,
    'commentId',
  );

  // 4. Batch delete associated Likes (query by contentId-index)
  await batchDeleteByGSI(
    dynamoClient,
    tables.likesTable,
    'contentId-index',
    'contentId',
    contentId,
    'pk',
  );

  // 5. Batch delete associated Reservations (query by contentId-index)
  await batchDeleteByGSI(
    dynamoClient,
    tables.reservationsTable,
    'contentId-index',
    'contentId',
    contentId,
    'pk',
  );

  // 6. Delete the ContentItem record
  await dynamoClient.send(
    new DeleteCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId },
    }),
  );

  return { success: true };
}

/**
 * Helper: query all records from a GSI by partition key, then batch delete them.
 * Handles pagination for large result sets and BatchWriteCommand 25-item limit.
 */
async function batchDeleteByGSI(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  indexName: string,
  partitionKeyName: string,
  partitionKeyValue: string,
  tableKeyName: string,
): Promise<void> {
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: '#pk = :pkVal',
        ExpressionAttributeNames: { '#pk': partitionKeyName },
        ExpressionAttributeValues: { ':pkVal': partitionKeyValue },
        ProjectionExpression: tableKeyName,
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      }),
    );

    const items = queryResult.Items ?? [];
    lastEvaluatedKey = queryResult.LastEvaluatedKey;

    // BatchWriteCommand supports max 25 items per request
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await dynamoClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: batch.map((item) => ({
              DeleteRequest: {
                Key: { [tableKeyName]: item[tableKeyName] },
              },
            })),
          },
        }),
      );
    }
  } while (lastEvaluatedKey);
}

// ─── Category CRUD ─────────────────────────────────────────

export interface CategoryResult {
  success: boolean;
  category?: ContentCategory;
  error?: { code: string; message: string };
}

/**
 * Create a new content category.
 * Uses ULID for categoryId.
 */
export async function createCategory(
  name: string,
  dynamoClient: DynamoDBDocumentClient,
  categoriesTable: string,
): Promise<CategoryResult> {
  const now = new Date().toISOString();
  const category: ContentCategory = {
    categoryId: ulid(),
    name,
    createdAt: now,
  };

  await dynamoClient.send(
    new PutCommand({ TableName: categoriesTable, Item: category }),
  );

  return { success: true, category };
}

/**
 * Update a content category name.
 * Returns CATEGORY_NOT_FOUND if the category does not exist.
 */
export async function updateCategory(
  categoryId: string,
  name: string,
  dynamoClient: DynamoDBDocumentClient,
  categoriesTable: string,
): Promise<CategoryResult> {
  // Check existence
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: categoriesTable, Key: { categoryId } }),
  );

  if (!getResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.CATEGORY_NOT_FOUND, message: ErrorMessages[ErrorCodes.CATEGORY_NOT_FOUND] },
    };
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: categoriesTable,
      Key: { categoryId },
      UpdateExpression: 'SET #name = :name',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ':name': name },
    }),
  );

  const updated: ContentCategory = {
    ...(getResult.Item as ContentCategory),
    name,
  };

  return { success: true, category: updated };
}

/**
 * Delete a content category.
 * Returns CATEGORY_NOT_FOUND if the category does not exist.
 */
export async function deleteCategory(
  categoryId: string,
  dynamoClient: DynamoDBDocumentClient,
  categoriesTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  // Check existence
  const getResult = await dynamoClient.send(
    new GetCommand({ TableName: categoriesTable, Key: { categoryId } }),
  );

  if (!getResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.CATEGORY_NOT_FOUND, message: ErrorMessages[ErrorCodes.CATEGORY_NOT_FOUND] },
    };
  }

  await dynamoClient.send(
    new DeleteCommand({ TableName: categoriesTable, Key: { categoryId } }),
  );

  return { success: true };
}

/**
 * List all content categories.
 * Small table, uses Scan. Sorted by createdAt ascending.
 */
export async function listCategories(
  dynamoClient: DynamoDBDocumentClient,
  categoriesTable: string,
): Promise<{ success: boolean; categories: ContentCategory[] }> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: categoriesTable }),
  );

  const categories = ((result.Items ?? []) as ContentCategory[]).sort(
    (a, b) => (a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0),
  );

  return { success: true, categories };
}
