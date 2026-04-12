import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ContentItem, ContentItemSummary } from '@points-mall/shared';

// ─── List Content Items ────────────────────────────────────

export interface ListContentItemsOptions {
  categoryId?: string;
  tag?: string;
  pageSize?: number;
  lastKey?: string;
}

export interface ListContentItemsResult {
  success: boolean;
  items?: ContentItemSummary[];
  lastKey?: string;
}

/**
 * List approved content items for user-facing queries.
 * - Without category filter: uses GSI `status-createdAt-index` (PK=status, SK=createdAt desc)
 * - With category filter: uses GSI `categoryId-createdAt-index` + FilterExpression status=approved
 * - Returns summary fields only
 * - Supports cursor-based pagination via lastKey
 */
export async function listContentItems(
  options: ListContentItemsOptions,
  dynamoClient: DynamoDBDocumentClient,
  contentItemsTable: string,
): Promise<ListContentItemsResult> {
  const { categoryId, tag, pageSize = 20, lastKey } = options;

  const exclusiveStartKey = lastKey ? JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8')) : undefined;

  let result;

  if (categoryId) {
    // Use categoryId-createdAt-index GSI + filter for approved status
    const filterParts = ['#status = :approved'];
    const exprNames: Record<string, string> = {
      '#categoryId': 'categoryId',
      '#status': 'status',
    };
    const exprValues: Record<string, string> = {
      ':categoryId': categoryId,
      ':approved': 'approved',
    };

    if (tag) {
      filterParts.push('contains(tags, :tag)');
      exprValues[':tag'] = tag;
    }

    result = await dynamoClient.send(
      new QueryCommand({
        TableName: contentItemsTable,
        IndexName: 'categoryId-createdAt-index',
        KeyConditionExpression: '#categoryId = :categoryId',
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ScanIndexForward: false,
        Limit: pageSize,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
  } else {
    // Use status-createdAt-index GSI, query status=approved directly
    const exprNames: Record<string, string> = { '#status': 'status' };
    const exprValues: Record<string, string> = { ':approved': 'approved' };
    let filterExpression: string | undefined;

    if (tag) {
      filterExpression = 'contains(tags, :tag)';
      exprValues[':tag'] = tag;
    }

    result = await dynamoClient.send(
      new QueryCommand({
        TableName: contentItemsTable,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#status = :approved',
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ScanIndexForward: false,
        Limit: pageSize,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
  }

  const rawItems = (result.Items ?? []) as ContentItem[];

  const items: ContentItemSummary[] = rawItems.map((item) => ({
    contentId: item.contentId,
    title: item.title,
    categoryName: item.categoryName,
    uploaderNickname: item.uploaderNickname,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    reservationCount: item.reservationCount,
    createdAt: item.createdAt,
    tags: item.tags ?? [],
  }));

  const responseLastKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { success: true, items, lastKey: responseLastKey };
}


// ─── Get Content Detail ────────────────────────────────────

export interface GetContentDetailResult {
  success: boolean;
  item?: ContentItem;
  hasReserved?: boolean;
  hasLiked?: boolean;
  error?: { code: string; message: string };
}

/**
 * Get content detail by contentId.
 * - Non-approved content returns CONTENT_NOT_FOUND
 * - If userId is provided, parallel-queries Reservations and Likes tables
 *   to determine hasReserved / hasLiked flags
 */
export async function getContentDetail(
  contentId: string,
  userId: string | null,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentItemsTable: string; reservationsTable: string; likesTable: string },
): Promise<GetContentDetailResult> {
  // Fetch the content item
  const contentResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId },
    }),
  );

  const item = contentResult.Item as ContentItem | undefined;

  if (!item) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // Non-approved content is only visible to the uploader themselves
  if (item.status !== 'approved' && userId !== item.uploaderId) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  // If no userId, return content without user-specific flags
  if (!userId) {
    return { success: true, item, hasReserved: false, hasLiked: false };
  }

  // Parallel query for reservation and like status
  const pk = `${userId}#${contentId}`;

  const [reservationResult, likeResult] = await Promise.all([
    dynamoClient.send(
      new GetCommand({
        TableName: tables.reservationsTable,
        Key: { pk },
      }),
    ),
    dynamoClient.send(
      new GetCommand({
        TableName: tables.likesTable,
        Key: { pk },
      }),
    ),
  ]);

  return {
    success: true,
    item,
    hasReserved: !!reservationResult.Item,
    hasLiked: !!likeResult.Item,
  };
}
