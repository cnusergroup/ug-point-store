import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import {
  validateStatusTransition,
  type ShippingStatus,
  type ShippingEvent,
  type OrderItem,
  type OrderListItem,
  type OrderResponse,
  type OrderStats,
  type SizeOption,
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

export interface CancelOrderResult {
  success: boolean;
  error?: { code: string; message: string };
  userDeleted?: boolean;
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
 * Cancel a pending order and process refund.
 * - If user exists: atomic TransactWriteItems (update order, refund points, create points record)
 * - If user deleted: simple UpdateCommand on order only
 * - Best-effort stock restoration per item (separate from main transaction)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 8.1, 8.2
 */
export async function cancelOrder(
  orderId: string,
  operatorId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    ordersTable: string;
    usersTable: string;
    productsTable: string;
    pointsRecordsTable: string;
  },
): Promise<CancelOrderResult> {
  // 1. Fetch order
  const orderResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.ordersTable,
      Key: { orderId },
    }),
  );

  const orderItem = orderResult.Item;
  if (!orderItem) {
    return {
      success: false,
      error: { code: ErrorCodes.ORDER_NOT_FOUND, message: ErrorMessages.ORDER_NOT_FOUND },
    };
  }

  // 2. Validate shippingStatus === 'pending'
  const currentStatus = orderItem.shippingStatus as ShippingStatus;
  if (currentStatus !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages.INVALID_STATUS_TRANSITION },
    };
  }

  const userId = orderItem.userId as string;
  const totalPoints = (orderItem.totalPoints as number) ?? 0;
  const items: OrderItem[] = (orderItem.items as OrderItem[]) ?? [];
  const now = new Date().toISOString();

  // 3. Check if user exists
  const userResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId },
    }),
  );

  const user = userResult.Item;

  if (user) {
    // User exists: atomic transaction — update order + refund points + create points record
    const userPoints = (user.points as number) ?? 0;
    const balanceAfter = userPoints + totalPoints;
    const recordId = ulid();

    const cancelEvent: ShippingEvent = {
      status: 'cancelled',
      timestamp: now,
      remark: '无法完成发货，订单已取消并退还积分',
      operatorId,
    };

    const pointsRecord = {
      recordId,
      userId,
      type: 'refund',
      amount: totalPoints,
      source: `订单取消退还 ${orderId}`,
      balanceAfter,
      createdAt: now,
    };

    const transactItems: any[] = [
      // (1) Update order status to cancelled + append ShippingEvent
      {
        Update: {
          TableName: tables.ordersTable,
          Key: { orderId },
          UpdateExpression: 'SET shippingStatus = :cancelled, shippingEvents = list_append(shippingEvents, :newEvent), updatedAt = :now',
          ConditionExpression: 'shippingStatus = :pending',
          ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':newEvent': [cancelEvent],
            ':now': now,
            ':pending': 'pending',
          },
        },
      },
      // (2) Increment user points by totalPoints
      {
        Update: {
          TableName: tables.usersTable,
          Key: { userId },
          UpdateExpression: 'SET points = points + :refund, updatedAt = :now',
          ExpressionAttributeValues: {
            ':refund': totalPoints,
            ':now': now,
          },
        },
      },
      // (3) Put PointsRecord with type: 'refund'
      {
        Put: {
          TableName: tables.pointsRecordsTable,
          Item: pointsRecord,
        },
      },
    ];

    try {
      await dynamoClient.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (txErr: any) {
      if (txErr.name === 'TransactionCanceledException') {
        return {
          success: false,
          error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages.INVALID_STATUS_TRANSITION },
        };
      }
      throw txErr;
    }
  } else {
    // User deleted: simple UpdateCommand on order only
    const cancelEvent: ShippingEvent = {
      status: 'cancelled',
      timestamp: now,
      remark: '无法完成发货，订单已取消（用户已删除，积分未退还）',
      operatorId,
    };

    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tables.ordersTable,
          Key: { orderId },
          UpdateExpression: 'SET shippingStatus = :cancelled, shippingEvents = list_append(shippingEvents, :newEvent), updatedAt = :now',
          ConditionExpression: 'shippingStatus = :pending',
          ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':newEvent': [cancelEvent],
            ':now': now,
            ':pending': 'pending',
          },
        }),
      );
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        return {
          success: false,
          error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages.INVALID_STATUS_TRANSITION },
        };
      }
      throw err;
    }
  }

  // 4. Best-effort stock restoration per item
  for (const item of items) {
    try {
      // Check if product exists
      const productResult = await dynamoClient.send(
        new GetCommand({
          TableName: tables.productsTable,
          Key: { productId: item.productId },
        }),
      );

      const product = productResult.Item;
      if (!product) continue; // Product deleted, skip silently (Req 5.4)

      // Build stock restoration update
      const updateParts = [
        'stock = stock + :qty',
        'redemptionCount = redemptionCount - :qty',
        'updatedAt = :now',
      ];
      const exprValues: Record<string, any> = {
        ':qty': item.quantity,
        ':now': now,
      };

      // Restore size-specific stock if selectedSize is present
      if (item.selectedSize) {
        const sizeOptions: SizeOption[] | undefined = product.sizeOptions;
        if (sizeOptions) {
          const sizeIndex = sizeOptions.findIndex((s: SizeOption) => s.name === item.selectedSize);
          if (sizeIndex >= 0) {
            updateParts.push(`sizeOptions[${sizeIndex}].stock = sizeOptions[${sizeIndex}].stock + :qty`);
          }
        }
      }

      await dynamoClient.send(
        new UpdateCommand({
          TableName: tables.productsTable,
          Key: { productId: item.productId },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeValues: exprValues,
        }),
      );
    } catch (err) {
      // Stock restoration is best-effort; log and continue
      console.error(`[CancelOrder] Failed to restore stock for product ${item.productId}:`, err);
    }
  }

  return { success: true, userDeleted: !user };
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
    cancelled: 0,
    total: items.length,
  };

  for (const item of items) {
    const s = item.shippingStatus as string;
    if (s === 'pending') stats.pending++;
    else if (s === 'shipped') stats.shipped++;
    else if (s === 'cancelled') stats.cancelled++;
  }

  return { success: true, stats };
}
