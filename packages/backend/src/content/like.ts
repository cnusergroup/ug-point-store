import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ContentItem } from '@points-mall/shared';

// ─── Toggle Like ───────────────────────────────────────────

export interface ToggleLikeInput {
  contentId: string;
  userId: string;
}

export interface ToggleLikeResult {
  success: boolean;
  liked: boolean;
  likeCount: number;
  error?: { code: string; message: string };
}

/**
 * Toggle like status for a content item.
 * - PK = `{userId}#{contentId}`, first GetCommand to check existence
 * - If exists: DeleteCommand + UpdateCommand to atomically decrement likeCount
 * - If not exists: PutCommand + UpdateCommand to atomically increment likeCount
 * - Returns post-operation liked status and latest likeCount
 */
export async function toggleLike(
  input: ToggleLikeInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { likesTable: string; contentItemsTable: string },
): Promise<ToggleLikeResult> {
  const pk = `${input.userId}#${input.contentId}`;
  const now = new Date().toISOString();

  // Check if like record already exists
  const existing = await dynamoClient.send(
    new GetCommand({ TableName: tables.likesTable, Key: { pk } }),
  );

  if (existing.Item) {
    // Already liked → unlike: delete record + decrement likeCount
    await dynamoClient.send(
      new DeleteCommand({ TableName: tables.likesTable, Key: { pk } }),
    );

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.contentItemsTable,
        Key: { contentId: input.contentId },
        UpdateExpression: 'SET likeCount = if_not_exists(likeCount, :zero) - :dec, updatedAt = :now',
        ConditionExpression: 'likeCount > :zero',
        ExpressionAttributeValues: { ':dec': 1, ':now': now, ':zero': 0 },
      }),
    );
  } else {
    // Not liked → like: create record + increment likeCount
    await dynamoClient.send(
      new PutCommand({
        TableName: tables.likesTable,
        Item: {
          pk,
          userId: input.userId,
          contentId: input.contentId,
          createdAt: now,
        },
      }),
    );

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.contentItemsTable,
        Key: { contentId: input.contentId },
        UpdateExpression: 'SET likeCount = if_not_exists(likeCount, :zero) + :inc, updatedAt = :now',
        ExpressionAttributeValues: { ':inc': 1, ':now': now, ':zero': 0 },
      }),
    );
  }

  // Get the updated content item to return the latest likeCount
  const updatedContent = await dynamoClient.send(
    new GetCommand({ TableName: tables.contentItemsTable, Key: { contentId: input.contentId } }),
  );
  const contentItem = updatedContent.Item as ContentItem | undefined;
  const likeCount = contentItem?.likeCount ?? 0;

  return {
    success: true,
    liked: !existing.Item,
    likeCount,
  };
}
