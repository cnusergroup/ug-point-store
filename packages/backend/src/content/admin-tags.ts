import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { TagRecord, ContentItem } from '@points-mall/shared';

// ─── List All Tags (Admin) ────────────────────────────────

export interface ListAllTagsResult {
  success: boolean;
  tags?: TagRecord[];
}

/**
 * List all tags for admin management.
 * - Scan all data from ContentTags table
 * - Sort by tagName ascending
 */
export async function listAllTags(
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<ListAllTagsResult> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: contentTagsTable }),
  );

  const tags = ((result.Items ?? []) as TagRecord[]).sort(
    (a, b) => (a.tagName > b.tagName ? 1 : a.tagName < b.tagName ? -1 : 0),
  );

  return { success: true, tags };
}

// ─── Merge Tags ────────────────────────────────────────────

export interface MergeTagsInput {
  sourceTagId: string;
  targetTagId: string;
}

export interface MergeTagsResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Merge source tag into target tag.
 * - Validate sourceTagId !== targetTagId
 * - Get source and target TagRecord, return TAG_NOT_FOUND if missing
 * - Scan ContentItems for items containing source tag name
 * - For each matching item: replace source tag with target tag, deduplicate
 * - Update target usageCount (add source count minus dedup count)
 * - Delete source TagRecord
 */
export async function mergeTags(
  input: MergeTagsInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentTagsTable: string; contentItemsTable: string },
): Promise<MergeTagsResult> {
  const { sourceTagId, targetTagId } = input;

  // 1. Validate not merging into self
  if (sourceTagId === targetTagId) {
    return {
      success: false,
      error: { code: ErrorCodes.TAG_MERGE_SELF_ERROR, message: ErrorMessages[ErrorCodes.TAG_MERGE_SELF_ERROR] },
    };
  }

  // 2. Get source TagRecord
  const sourceResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentTagsTable,
      Key: { tagId: sourceTagId },
    }),
  );

  const sourceTag = sourceResult.Item as TagRecord | undefined;
  if (!sourceTag) {
    return {
      success: false,
      error: { code: ErrorCodes.TAG_NOT_FOUND, message: ErrorMessages[ErrorCodes.TAG_NOT_FOUND] },
    };
  }

  // 3. Get target TagRecord
  const targetResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentTagsTable,
      Key: { tagId: targetTagId },
    }),
  );

  const targetTag = targetResult.Item as TagRecord | undefined;
  if (!targetTag) {
    return {
      success: false,
      error: { code: ErrorCodes.TAG_NOT_FOUND, message: ErrorMessages[ErrorCodes.TAG_NOT_FOUND] },
    };
  }

  // 4. Scan ContentItems containing source tag name
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: tables.contentItemsTable,
      FilterExpression: 'contains(tags, :sourceTagName)',
      ExpressionAttributeValues: { ':sourceTagName': sourceTag.tagName },
    }),
  );

  const matchingItems = (scanResult.Items ?? []) as ContentItem[];

  // 5. Update each matching ContentItem: replace source with target, deduplicate
  let dedupCount = 0;

  for (const item of matchingItems) {
    const oldTags = item.tags ?? [];
    // Replace sourceTagName with targetTagName
    let newTags = oldTags.map(t => (t === sourceTag.tagName ? targetTag.tagName : t));
    // Deduplicate: if targetTagName already existed, we now have duplicates
    const uniqueTags = [...new Set(newTags)];
    if (uniqueTags.length < newTags.length) {
      dedupCount++;
    }
    newTags = uniqueTags;

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.contentItemsTable,
        Key: { contentId: item.contentId },
        UpdateExpression: 'SET tags = :tags',
        ExpressionAttributeValues: { ':tags': newTags },
      }),
    );
  }

  // 6. Update target usageCount: add source count minus dedup count
  const usageIncrement = sourceTag.usageCount - dedupCount;
  if (usageIncrement !== 0) {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.contentTagsTable,
        Key: { tagId: targetTagId },
        UpdateExpression: 'ADD usageCount :inc',
        ExpressionAttributeValues: { ':inc': usageIncrement },
      }),
    );
  }

  // 7. Delete source TagRecord
  await dynamoClient.send(
    new DeleteCommand({
      TableName: tables.contentTagsTable,
      Key: { tagId: sourceTagId },
    }),
  );

  return { success: true };
}

// ─── Delete Tag ────────────────────────────────────────────

export interface DeleteTagResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Delete a tag and remove it from all content items.
 * - Get TagRecord, return TAG_NOT_FOUND if missing
 * - Scan ContentItems containing the tag name
 * - For each matching item: remove tag from tags array, update
 * - Delete TagRecord
 */
export async function deleteTag(
  tagId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: { contentTagsTable: string; contentItemsTable: string },
): Promise<DeleteTagResult> {
  // 1. Get TagRecord
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentTagsTable,
      Key: { tagId },
    }),
  );

  const tag = getResult.Item as TagRecord | undefined;
  if (!tag) {
    return {
      success: false,
      error: { code: ErrorCodes.TAG_NOT_FOUND, message: ErrorMessages[ErrorCodes.TAG_NOT_FOUND] },
    };
  }

  // 2. Scan ContentItems containing this tag name
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: tables.contentItemsTable,
      FilterExpression: 'contains(tags, :tagName)',
      ExpressionAttributeValues: { ':tagName': tag.tagName },
    }),
  );

  const matchingItems = (scanResult.Items ?? []) as ContentItem[];

  // 3. Remove tag from each matching ContentItem
  for (const item of matchingItems) {
    const oldTags = item.tags ?? [];
    const newTags = oldTags.filter(t => t !== tag.tagName);

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.contentItemsTable,
        Key: { contentId: item.contentId },
        UpdateExpression: 'SET tags = :tags',
        ExpressionAttributeValues: { ':tags': newTags },
      }),
    );
  }

  // 4. Delete TagRecord
  await dynamoClient.send(
    new DeleteCommand({
      TableName: tables.contentTagsTable,
      Key: { tagId },
    }),
  );

  return { success: true };
}
