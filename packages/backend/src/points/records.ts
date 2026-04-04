import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { PointsRecord } from '@points-mall/shared';

export interface GetPointsRecordsOptions {
  page?: number;
  pageSize?: number;
}

export interface GetPointsRecordsResult {
  success: boolean;
  items?: PointsRecord[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: { code: string; message: string };
}

/**
 * Query points change history for a user, sorted by createdAt descending.
 * Uses page-based pagination (consistent with redemption history API).
 *
 * Requirements: front-end expects { items, total, page, pageSize }
 */
export async function getPointsRecords(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  options: GetPointsRecordsOptions = {},
): Promise<GetPointsRecordsResult> {
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.max(options.pageSize ?? 20, 1);

  // Query all records for the user (sorted by createdAt descending via GSI)
  const allRecords: PointsRecord[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    allRecords.push(...((result.Items ?? []) as PointsRecord[]));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const total = allRecords.length;

  // In-memory pagination
  const startIndex = (page - 1) * pageSize;
  const items = allRecords.slice(startIndex, startIndex + pageSize);

  return { success: true, items, total, page, pageSize };
}
