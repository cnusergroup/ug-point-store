import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ActivityRecord } from '@points-mall/shared';

// ============================================================
// Interfaces
// ============================================================

/** 活动列表查询选项 */
export interface ListActivitiesOptions {
  ugName?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
  pageSize?: number;
  lastKey?: string;
}

/** 活动列表查询结果 */
export interface ListActivitiesResult {
  success: boolean;
  activities?: ActivityRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/** 活动单条查询结果 */
export interface GetActivityResult {
  success: boolean;
  activity?: ActivityRecord;
  error?: { code: string; message: string };
}

// ============================================================
// Query Operations
// ============================================================

/**
 * List activities with optional filters.
 * - Uses activityDate-index GSI (PK='ALL', ScanIndexForward=false for descending date order)
 * - Supports ugName filter (FilterExpression)
 * - Supports startDate/endDate date range (KeyConditionExpression on activityDate SK)
 * - Supports keyword fuzzy search (FilterExpression contains on topic)
 * - pageSize clamped to [1, 100], default 20
 * - Supports base64 encoded lastKey pagination cursor
 */
export async function listActivities(
  options: ListActivitiesOptions,
  dynamoClient: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<ListActivitiesResult> {
  try {
    // Clamp pageSize to [1, 100], default 20
    const rawPageSize = options.pageSize ?? 20;
    const pageSize = Math.max(1, Math.min(100, Math.floor(rawPageSize)));

    // Build KeyConditionExpression
    const expressionAttributeNames: Record<string, string> = {
      '#pk': 'pk',
    };
    const expressionAttributeValues: Record<string, any> = {
      ':pk': 'ALL',
    };

    let keyConditionExpression = '#pk = :pk';

    // Date range on sort key (activityDate)
    if (options.startDate && options.endDate) {
      keyConditionExpression += ' AND #activityDate BETWEEN :startDate AND :endDate';
      expressionAttributeNames['#activityDate'] = 'activityDate';
      expressionAttributeValues[':startDate'] = options.startDate;
      expressionAttributeValues[':endDate'] = options.endDate;
    } else if (options.startDate) {
      keyConditionExpression += ' AND #activityDate >= :startDate';
      expressionAttributeNames['#activityDate'] = 'activityDate';
      expressionAttributeValues[':startDate'] = options.startDate;
    } else if (options.endDate) {
      keyConditionExpression += ' AND #activityDate <= :endDate';
      expressionAttributeNames['#activityDate'] = 'activityDate';
      expressionAttributeValues[':endDate'] = options.endDate;
    }

    // Build FilterExpression parts
    const filterParts: string[] = [];

    if (options.ugName) {
      filterParts.push('#ugName = :ugName');
      expressionAttributeNames['#ugName'] = 'ugName';
      expressionAttributeValues[':ugName'] = options.ugName;
    }

    if (options.keyword) {
      filterParts.push('contains(#topic, :keyword)');
      expressionAttributeNames['#topic'] = 'topic';
      expressionAttributeValues[':keyword'] = options.keyword;
    }

    const filterExpression = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

    // Decode lastKey pagination cursor
    let exclusiveStartKey: Record<string, any> | undefined;
    if (options.lastKey) {
      try {
        const decoded = Buffer.from(options.lastKey, 'base64').toString('utf-8');
        exclusiveStartKey = JSON.parse(decoded);
      } catch {
        return {
          success: false,
          error: { code: 'INVALID_REQUEST', message: '无效的分页游标' },
        };
      }
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: activitiesTable,
        IndexName: 'activityDate-index',
        KeyConditionExpression: keyConditionExpression,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false, // descending by activityDate
        Limit: pageSize,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );

    const activities = (result.Items ?? []) as ActivityRecord[];

    // Encode lastKey for next page
    let lastKey: string | undefined;
    if (result.LastEvaluatedKey) {
      lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return { success: true, activities, lastKey };
  } catch (err) {
    console.error('Error listing activities:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

/**
 * Get a single activity by activityId.
 * - GetCommand to fetch single record
 * - Returns ACTIVITY_NOT_FOUND if not exists
 */
export async function getActivity(
  activityId: string,
  dynamoClient: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<GetActivityResult> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: activitiesTable,
        Key: { activityId },
      }),
    );

    if (!result.Item) {
      return {
        success: false,
        error: { code: 'ACTIVITY_NOT_FOUND', message: '活动不存在' },
      };
    }

    return { success: true, activity: result.Item as ActivityRecord };
  } catch (err) {
    console.error('Error getting activity:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}
