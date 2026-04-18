import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ActivityRecord, UGRecord } from '@points-mall/shared';

// ─── Interfaces ────────────────────────────────────────────

export interface ListReservationActivitiesOptions {
  pageSize?: number;
  lastKey?: string;
}

export interface ListReservationActivitiesResult {
  success: boolean;
  activities: ActivityRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

// ─── Implementation ────────────────────────────────────────

/**
 * List activities available for reservation.
 *
 * 1. Query UGs table for active UGs to get their names
 * 2. Query Activities table via activityDate-index (descending)
 * 3. Filter activities whose ugName is in the active UG names set
 * 4. Apply pagination (pageSize + offset via lastKey)
 */
export async function listReservationActivities(
  options: ListReservationActivitiesOptions,
  dynamoClient: DynamoDBDocumentClient,
  tables: { activitiesTable: string; ugsTable: string },
): Promise<ListReservationActivitiesResult> {
  try {
    const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 50)));

    // Step 1: Get all active UG names
    const ugResult = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.ugsTable,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'active' },
      }),
    );

    const activeUGs = (ugResult.Items ?? []) as UGRecord[];
    const activeUGNames = new Set(activeUGs.map((ug) => ug.name));

    // If no active UGs, return empty
    if (activeUGNames.size === 0) {
      return { success: true, activities: [] };
    }

    // Step 2: Query future activities via activityDate-index, ascending
    // Only return activities with activityDate >= today (YYYY-MM-DD)
    // The activityDate-index has PK='ALL', SK=activityDate.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const exclusiveStartKey = options.lastKey
      ? JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'))
      : undefined;

    // We over-fetch to account for filtering, then slice to pageSize
    const fetchLimit = pageSize * 3; // fetch more to compensate for filtering

    let allActivities: ActivityRecord[] = [];
    let dynamoLastKey = exclusiveStartKey;
    let hasMore = true;

    while (allActivities.length < pageSize && hasMore) {
      const actResult = await dynamoClient.send(
        new QueryCommand({
          TableName: tables.activitiesTable,
          IndexName: 'activityDate-index',
          KeyConditionExpression: '#pk = :pk AND #activityDate >= :today',
          ExpressionAttributeNames: { '#pk': 'pk', '#activityDate': 'activityDate' },
          ExpressionAttributeValues: { ':pk': 'ALL', ':today': today },
          ScanIndexForward: true, // ascending — nearest future activities first
          Limit: fetchLimit,
          ...(dynamoLastKey ? { ExclusiveStartKey: dynamoLastKey } : {}),
        }),
      );

      const items = (actResult.Items ?? []) as ActivityRecord[];

      // Filter by active UG names
      const filtered = items.filter((act) => activeUGNames.has(act.ugName));
      allActivities = allActivities.concat(filtered);

      dynamoLastKey = actResult.LastEvaluatedKey;
      hasMore = !!dynamoLastKey;
    }

    // Slice to pageSize
    const activities = allActivities.slice(0, pageSize);
    const hasMoreResults = allActivities.length > pageSize || hasMore;

    // Build lastKey for next page
    let responseLastKey: string | undefined;
    if (hasMoreResults && dynamoLastKey) {
      responseLastKey = Buffer.from(JSON.stringify(dynamoLastKey)).toString('base64');
    }

    return { success: true, activities, lastKey: responseLastKey };
  } catch (err) {
    console.error('Error listing reservation activities:', err);
    return {
      success: false,
      activities: [],
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}
