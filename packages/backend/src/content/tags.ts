import { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { TagRecord } from '@points-mall/shared';
import { normalizeTagName } from '@points-mall/shared';
import { ulid } from 'ulid';

// ─── Search Tags (Autocomplete) ───────────────────────────

export interface SearchTagsOptions {
  prefix: string;
  limit?: number;
}

export interface SearchTagsResult {
  success: boolean;
  tags?: TagRecord[];
}

/**
 * Search tags by prefix for autocomplete.
 * - prefix length < 1: return empty array
 * - Normalizes prefix, then Scan + FilterExpression begins_with(tagName, :prefix)
 * - Sort by usageCount descending, take top limit (default 10)
 */
export async function searchTags(
  options: SearchTagsOptions,
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<SearchTagsResult> {
  const { prefix, limit = 10 } = options;

  if (prefix.length < 1) {
    return { success: true, tags: [] };
  }

  const normalizedPrefix = normalizeTagName(prefix);

  if (normalizedPrefix.length < 1) {
    return { success: true, tags: [] };
  }

  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: contentTagsTable,
      FilterExpression: 'begins_with(tagName, :prefix)',
      ExpressionAttributeValues: { ':prefix': normalizedPrefix },
    }),
  );

  const tags = (result.Items ?? []) as TagRecord[];

  tags.sort((a, b) => b.usageCount - a.usageCount);

  return { success: true, tags: tags.slice(0, limit) };
}

// ─── Get Hot Tags ──────────────────────────────────────────

export interface GetHotTagsResult {
  success: boolean;
  tags?: TagRecord[];
}

/**
 * Get the top 10 most-used tags.
 * - Scan all data, sort by usageCount descending, take top 10
 */
export async function getHotTags(
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<GetHotTagsResult> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: contentTagsTable }),
  );

  const tags = (result.Items ?? []) as TagRecord[];

  tags.sort((a, b) => b.usageCount - a.usageCount);

  return { success: true, tags: tags.slice(0, 10) };
}

// ─── Get Tag Cloud Tags ───────────────────────────────────

export interface GetTagCloudResult {
  success: boolean;
  tags?: TagRecord[];
}

/**
 * Get the top 20 tags for the tag cloud display.
 * - Scan all data, sort by usageCount descending, take top 20
 */
export async function getTagCloudTags(
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<GetTagCloudResult> {
  const result = await dynamoClient.send(
    new ScanCommand({ TableName: contentTagsTable }),
  );

  const tags = (result.Items ?? []) as TagRecord[];

  tags.sort((a, b) => b.usageCount - a.usageCount);

  return { success: true, tags: tags.slice(0, 20) };
}


// ─── Sync Tags On Create ──────────────────────────────────

/**
 * Sync tag usage counts when content is created.
 * For each tag:
 * - Normalize the tag name
 * - Query tagName-index GSI to check if tag exists
 * - Not exists: PutCommand to create new TagRecord (usageCount=1)
 * - Exists: UpdateCommand ADD usageCount :one (atomic increment)
 */
export async function syncTagsOnCreate(
  tags: string[],
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<void> {
  for (const tag of tags) {
    const normalized = normalizeTagName(tag);

    // Query tagName-index GSI to check if tag already exists
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: contentTagsTable,
        IndexName: 'tagName-index',
        KeyConditionExpression: 'tagName = :tagName',
        ExpressionAttributeValues: { ':tagName': normalized },
      }),
    );

    const existing = queryResult.Items && queryResult.Items.length > 0 ? queryResult.Items[0] : null;

    if (!existing) {
      // Create new TagRecord with usageCount=1
      await dynamoClient.send(
        new PutCommand({
          TableName: contentTagsTable,
          Item: {
            tagId: ulid(),
            tagName: normalized,
            usageCount: 1,
            createdAt: new Date().toISOString(),
          },
        }),
      );
    } else {
      // Atomic increment usageCount
      await dynamoClient.send(
        new UpdateCommand({
          TableName: contentTagsTable,
          Key: { tagId: existing.tagId },
          UpdateExpression: 'ADD usageCount :one',
          ExpressionAttributeValues: { ':one': 1 },
        }),
      );
    }
  }
}

// ─── Sync Tags On Edit ────────────────────────────────────

/**
 * Sync tag usage counts when content is edited.
 * - Compute removedTags (in oldTags but not in newTags) and addedTags (in newTags but not in oldTags)
 * - removedTags: decrement usageCount (minimum 0)
 * - addedTags: same logic as syncTagsOnCreate
 */
export async function syncTagsOnEdit(
  oldTags: string[],
  newTags: string[],
  dynamoClient: DynamoDBDocumentClient,
  contentTagsTable: string,
): Promise<void> {
  const normalizedOld = oldTags.map(normalizeTagName);
  const normalizedNew = newTags.map(normalizeTagName);

  const oldSet = new Set(normalizedOld);
  const newSet = new Set(normalizedNew);

  const removedTags = normalizedOld.filter(t => !newSet.has(t));
  const addedTags = normalizedNew.filter(t => !oldSet.has(t));

  // Decrement usageCount for removed tags (minimum 0)
  for (const tagName of removedTags) {
    // Query tagName-index GSI to find the tag record
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: contentTagsTable,
        IndexName: 'tagName-index',
        KeyConditionExpression: 'tagName = :tagName',
        ExpressionAttributeValues: { ':tagName': tagName },
      }),
    );

    const existing = queryResult.Items && queryResult.Items.length > 0 ? queryResult.Items[0] : null;

    if (existing) {
      try {
        await dynamoClient.send(
          new UpdateCommand({
            TableName: contentTagsTable,
            Key: { tagId: existing.tagId },
            UpdateExpression: 'SET usageCount = usageCount - :one',
            ConditionExpression: 'usageCount > :zero',
            ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
          }),
        );
      } catch (err: any) {
        // ConditionalCheckFailedException means usageCount is already 0, safe to ignore
        if (err.name !== 'ConditionalCheckFailedException') {
          throw err;
        }
      }
    }
  }

  // Increment usageCount for added tags (same logic as syncTagsOnCreate)
  await syncTagsOnCreate(addedTags, dynamoClient, contentTagsTable);
}
