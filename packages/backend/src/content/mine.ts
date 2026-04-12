import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ContentItem, MyContentItemSummary } from '@points-mall/shared';

// ─── List My Content Items ─────────────────────────────────

export interface ListMyContentOptions {
  userId: string;
  status?: string;
  pageSize?: number;
  lastKey?: string;
}

export interface ListMyContentResult {
  success: boolean;
  items?: MyContentItemSummary[];
  lastKey?: string;
}

/**
 * List content items belonging to the authenticated user.
 * - Uses GSI `uploaderId-createdAt-index` (PK=uploaderId, SK=createdAt desc)
 * - Optional status filter via FilterExpression
 * - Returns summary fields including status and rejectReason
 * - Supports cursor-based pagination via lastKey
 */
export async function listMyContent(
  options: ListMyContentOptions,
  dynamoClient: DynamoDBDocumentClient,
  contentItemsTable: string,
): Promise<ListMyContentResult> {
  const { userId, status, pageSize = 20, lastKey } = options;

  const exclusiveStartKey = lastKey ? JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8')) : undefined;

  const expressionAttributeNames: Record<string, string> = {
    '#uploaderId': 'uploaderId',
  };
  const expressionAttributeValues: Record<string, string> = {
    ':uploaderId': userId,
  };

  let filterExpression: string | undefined;

  if (status) {
    filterExpression = '#status = :status';
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = status;
  }

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: contentItemsTable,
      IndexName: 'uploaderId-createdAt-index',
      KeyConditionExpression: '#uploaderId = :uploaderId',
      ...(filterExpression ? { FilterExpression: filterExpression } : {}),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  );

  const rawItems = (result.Items ?? []) as ContentItem[];

  const items: MyContentItemSummary[] = rawItems.map((item) => ({
    contentId: item.contentId,
    title: item.title,
    categoryName: item.categoryName,
    status: item.status,
    ...(item.rejectReason ? { rejectReason: item.rejectReason } : {}),
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    reservationCount: item.reservationCount,
    createdAt: item.createdAt,
  }));

  const responseLastKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { success: true, items, lastKey: responseLastKey };
}
