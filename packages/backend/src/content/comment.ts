import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ContentComment, ContentItem } from '@points-mall/shared';

// ─── Add Comment ───────────────────────────────────────────

export interface AddCommentInput {
  contentId: string;
  userId: string;
  userNickname: string;
  userRole: string;
  content: string;
}

export interface AddCommentResult {
  success: boolean;
  comment?: ContentComment;
  error?: { code: string; message: string };
}

/**
 * Add a comment to an approved content item.
 * - Validates content is non-empty and ≤ 500 chars
 * - Validates contentId corresponds to existing content with status=approved
 * - Writes comment to Comments table
 * - Atomically increments commentCount on ContentItems table
 */
export async function addComment(
  input: AddCommentInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { commentsTable: string; contentItemsTable: string },
): Promise<AddCommentResult> {
  // Validate comment content: non-empty (after trim) and ≤ 500 chars
  if (!input.content || input.content.trim().length === 0 || input.content.length > 500) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_COMMENT_CONTENT, message: ErrorMessages[ErrorCodes.INVALID_COMMENT_CONTENT] },
    };
  }

  // Validate contentId exists and is approved
  const contentResult = await dynamoClient.send(
    new GetCommand({ TableName: tables.contentItemsTable, Key: { contentId: input.contentId } }),
  );
  const contentItem = contentResult.Item as ContentItem | undefined;

  if (!contentItem || contentItem.status !== 'approved') {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  const now = new Date().toISOString();
  const commentId = ulid();

  const comment: ContentComment = {
    commentId,
    contentId: input.contentId,
    userId: input.userId,
    userNickname: input.userNickname,
    userRole: input.userRole,
    content: input.content,
    createdAt: now,
  };

  // Write comment record
  await dynamoClient.send(
    new PutCommand({ TableName: tables.commentsTable, Item: comment }),
  );

  // Atomically increment commentCount on the content item
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId: input.contentId },
      UpdateExpression: 'SET commentCount = commentCount + :inc, updatedAt = :now',
      ExpressionAttributeValues: { ':inc': 1, ':now': now },
    }),
  );

  return { success: true, comment };
}

// ─── List Comments ─────────────────────────────────────────

export interface ListCommentsOptions {
  contentId: string;
  pageSize?: number;
  lastKey?: string;
}

export interface ListCommentsResult {
  success: boolean;
  comments?: ContentComment[];
  lastKey?: string;
}

/**
 * List comments for a content item.
 * - Uses GSI `contentId-createdAt-index`, ScanIndexForward=false (time descending)
 * - pageSize default 20, max 100
 * - Supports cursor-based pagination via lastKey
 */
export async function listComments(
  options: ListCommentsOptions,
  dynamoClient: DynamoDBDocumentClient,
  commentsTable: string,
): Promise<ListCommentsResult> {
  const { contentId, lastKey } = options;
  let pageSize = options.pageSize ?? 20;
  if (pageSize > 100) pageSize = 100;
  if (pageSize < 1) pageSize = 20;

  const exclusiveStartKey = lastKey ? JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8')) : undefined;

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: commentsTable,
      IndexName: 'contentId-createdAt-index',
      KeyConditionExpression: '#contentId = :contentId',
      ExpressionAttributeNames: { '#contentId': 'contentId' },
      ExpressionAttributeValues: { ':contentId': contentId },
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  );

  const comments = (result.Items ?? []) as ContentComment[];

  const responseLastKey = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { success: true, comments, lastKey: responseLastKey };
}
