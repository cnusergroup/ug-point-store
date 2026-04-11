import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import {
  validateStatusTransition,
  type ShippingStatus,
  type ShippingEvent,
  type OrderItem,
  type OrderListItem,
  type OrderResponse,
  type OrderStats,
} from '@points-mall/shared';

export interface AdminOrdersResult {
  success: boolean;
  orders?: OrderListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: { code: string; message: string };
}

export interface AdminOrderDetailResult {
  success: boolean;
  order?: OrderResponse;
  error?: { code: string; message: string };
}

export interface UpdateShippingResult {
  success: boolean;
  error?: { code: string; message: string };
}

export interface OrderStatsResult {
  success: boolean;
  stats?: OrderStats;
  error?: { code: string; message: string };
}

/**
 * Get admin orders list with optional status filter and pagination.
 * If status provided, query GSI `shippingStatus-createdAt-index` filtered by status.
 * If no status (all), scan the table.
 *
 * Requirements: 7.1
 */
export async function getAdminOrders(
  status: ShippingStatus | undefined,
  page: number,
  pageSize: number,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<AdminOrdersResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(pageSize, 100));

  let allItems: Record<string, any>[] = [];

  if (status) {
    // Query GSI by shippingStatus
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: ordersTable,
        IndexName: 'shippingStatus-createdAt-index',
        KeyConditionExpression: 'shippingStatus = :status',
        ExpressionAttributeValues: { ':status': status },
        ScanIndexForward: false,
      }),
    );
    allItems = result.Items ?? [];
  } else {
    // Scan all orders
    const result = await dynamoClient.send(
      new ScanCommand({ TableName: ordersTable }),
    );
    allItems = result.Items ?? [];
    // Sort by createdAt descending
    allItems.sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));
  }

  const total = allItems.length;
  const start = (safePage - 1) * safePageSize;
  const pagedItems = allItems.slice(start, start + safePageSize);

  const orders: OrderListItem[] = pagedItems.map((item) => ({
    orderId: item.orderId as string,
    itemCount: Array.isArray(item.items) ? item.items.length : 0,
    totalPoints: (item.totalPoints as number) ?? 0,
    shippingStatus: item.shippingStatus as OrderListItem['shippingStatus'],
    createdAt: item.createdAt as string,
    productNames: Array.isArray(item.items)
      ? item.items.map((i: any) => i.productName as string).filter(Boolean)
      : [],
  }));

  return { success: true, orders, total, page: safePage, pageSize: safePageSize };
}

/**
 * Get order detail by orderId for admin (no user ownership check).
 * Returns ORDER_NOT_FOUND if not found.
 *
 * Requirements: 7.2
 */
export async function getAdminOrderDetail(
  orderId: string,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<AdminOrderDetailResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: ordersTable,
      Key: { orderId },
    }),
  );

  const item = result.Item;
  if (!item) {
    return {
      success: false,
      error: { code: ErrorCodes.ORDER_NOT_FOUND, message: ErrorMessages.ORDER_NOT_FOUND },
    };
  }

  const order: OrderResponse = {
    orderId: item.orderId as string,
    userId: item.userId as string,
    items: (item.items as OrderItem[]) ?? [],
    totalPoints: (item.totalPoints as number) ?? 0,
    shippingAddress: item.shippingAddress as OrderResponse['shippingAddress'],
    shippingStatus: item.shippingStatus as OrderResponse['shippingStatus'],
    trackingNumber: item.trackingNumber as string | undefined,
    shippingEvents: (item.shippingEvents as ShippingEvent[]) ?? [],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };

  return { success: true, order };
}

/**
 * Update shipping status for an order.
 * Validates status transition, requires trackingNumber when shipping.
 * Appends a new ShippingEvent to the shippingEvents array.
 *
 * Requirements: 7.3, 7.4, 7.5, 7.6
 */
export async function updateShipping(
  orderId: string,
  status: ShippingStatus,
  trackingNumber: string | undefined,
  remark: string | undefined,
  operatorId: string,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<UpdateShippingResult> {
  // 1. Get current order
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: ordersTable,
      Key: { orderId },
    }),
  );

  const item = result.Item;
  if (!item) {
    return {
      success: false,
      error: { code: ErrorCodes.ORDER_NOT_FOUND, message: ErrorMessages.ORDER_NOT_FOUND },
    };
  }

  // 2. Validate status transition
  const currentStatus = item.shippingStatus as ShippingStatus;
  const transition = validateStatusTransition(currentStatus, status);
  if (!transition.valid) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages.INVALID_STATUS_TRANSITION },
    };
  }

  // 3. If target status is 'shipped', require trackingNumber
  if (status === 'shipped' && (!trackingNumber || trackingNumber.trim() === '')) {
    return {
      success: false,
      error: { code: ErrorCodes.TRACKING_NUMBER_REQUIRED, message: ErrorMessages.TRACKING_NUMBER_REQUIRED },
    };
  }

  // 4. Build new shipping event
  const now = new Date().toISOString();
  const newEvent: ShippingEvent = {
    status,
    timestamp: now,
    remark,
    operatorId,
  };

  // 5. Update order
  const updateExprParts = [
    'shippingStatus = :newStatus',
    'shippingEvents = list_append(shippingEvents, :newEvent)',
    'updatedAt = :now',
  ];
  const exprValues: Record<string, any> = {
    ':newStatus': status,
    ':newEvent': [newEvent],
    ':now': now,
  };

  if (trackingNumber) {
    updateExprParts.push('trackingNumber = :tn');
    exprValues[':tn'] = trackingNumber;
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: ordersTable,
      Key: { orderId },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeValues: exprValues,
    }),
  );

  return { success: true };
}

/**
 * Get order statistics by shipping status.
 * Scans all orders and counts by shippingStatus.
 *
 * Requirements: 7.7
 */
export async function getOrderStats(
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<OrderStatsResult> {
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: ordersTable,
      ProjectionExpression: 'shippingStatus',
    }),
  );

  const items = result.Items ?? [];

  const stats: OrderStats = {
    pending: 0,
    shipped: 0,
    total: items.length,
  };

  for (const item of items) {
    const s = item.shippingStatus as string;
    if (s === 'pending') stats.pending++;
    else if (s === 'shipped') stats.shipped++;
  }

  return { success: true, stats };
}
