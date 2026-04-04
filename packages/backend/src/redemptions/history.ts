import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import type { RedemptionRecord } from '@points-mall/shared';

export interface GetRedemptionHistoryOptions {
  page?: number;
  pageSize?: number;
}

export interface GetRedemptionHistoryResult {
  success: boolean;
  items?: (RedemptionRecord & { shippingStatus?: string })[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: { code: string; message: string };
}

/**
 * Query redemption history for a user, sorted by createdAt descending.
 * Uses page-based pagination and enriches records with shippingStatus from Orders table.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2
 */
export async function getRedemptionHistory(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  redemptionsTable: string,
  ordersTable: string,
  options: GetRedemptionHistoryOptions = {},
): Promise<GetRedemptionHistoryResult> {
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.max(options.pageSize ?? 20, 1);

  // Query all redemption records for the user (sorted by createdAt descending)
  const allRecords: RedemptionRecord[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: redemptionsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    allRecords.push(...((result.Items ?? []) as RedemptionRecord[]));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const total = allRecords.length;

  // In-memory pagination
  const startIndex = (page - 1) * pageSize;
  const paginatedRecords = allRecords.slice(startIndex, startIndex + pageSize);

  // Enrich records that have orderId with shippingStatus from Orders table
  const orderIds = paginatedRecords
    .filter((r) => r.orderId)
    .map((r) => r.orderId!);

  let shippingStatusMap: Record<string, string> = {};

  if (orderIds.length > 0 && ordersTable) {
    // BatchGetCommand supports up to 100 keys per request
    const batchSize = 100;
    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batch = orderIds.slice(i, i + batchSize);
      try {
        const batchResult = await dynamoClient.send(
          new BatchGetCommand({
            RequestItems: {
              [ordersTable]: {
                Keys: batch.map((orderId) => ({ orderId })),
                ProjectionExpression: 'orderId, shippingStatus',
              },
            },
          }),
        );

        const orderItems = batchResult.Responses?.[ordersTable] ?? [];
        for (const item of orderItems) {
          shippingStatusMap[item.orderId as string] = item.shippingStatus as string;
        }
      } catch {
        // If batch get fails, continue without shippingStatus
      }
    }
  }

  // Merge shippingStatus into records
  const items = paginatedRecords.map((record) => {
    if (record.orderId && shippingStatusMap[record.orderId]) {
      return { ...record, shippingStatus: shippingStatusMap[record.orderId] };
    }
    return record;
  });

  return { success: true, items, total, page, pageSize };
}
