import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { OrderItem, OrderListItem, OrderResponse, ShippingEvent, CartItem, SizeOption } from '@points-mall/shared';

export interface OrderTableNames {
  usersTable: string;
  productsTable: string;
  ordersTable: string;
  cartTable: string;
  pointsRecordsTable: string;
  addressesTable: string;
}

export interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  error?: { code: string; message: string };
}

/**
 * Query user's historical purchase total for a specific product.
 * Queries the Orders table using userId-createdAt-index GSI to get all orders for the user,
 * then iterates through each order's items array, accumulating quantity where productId matches.
 *
 * Requirements: 6.2, 6.3
 */
export async function getUserProductPurchaseCount(
  userId: string,
  productId: string,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<number> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: ordersTable,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const orders = result.Items ?? [];
  let count = 0;
  for (const order of orders) {
    const items: { productId: string; quantity: number }[] = order.items ?? [];
    for (const item of items) {
      if (item.productId === productId) {
        count += item.quantity;
      }
    }
  }
  return count;
}

/**
 * Create an order from a list of items (batch checkout from cart).
 *
 * Validates:
 * - Address exists (ADDRESS_NOT_FOUND)
 * - All products: status active, stock sufficient, user has redemption permission
 * - User points balance >= total
 *
 * Uses DynamoDB TransactWriteItems atomically:
 * - Deduct points
 * - Reduce stock for each product
 * - Create order record
 * - Write points record
 *
 * After success, removes redeemed items from cart.
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10, 4.11, 6.2, 8.2, 8.4
 */
export async function createOrder(
  userId: string,
  items: { productId: string; quantity: number; selectedSize?: string }[],
  addressId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: OrderTableNames,
): Promise<CreateOrderResult> {
  // 1. Validate addressId is provided
  if (!addressId) {
    return {
      success: false,
      error: { code: ErrorCodes.NO_ADDRESS_SELECTED, message: ErrorMessages.NO_ADDRESS_SELECTED },
    };
  }

  // 2. Validate address exists and belongs to user
  const addressResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.addressesTable,
      Key: { addressId },
    }),
  );
  const address = addressResult.Item;

  if (!address || address.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_NOT_FOUND, message: ErrorMessages.ADDRESS_NOT_FOUND },
    };
  }

  // 3. Fetch user info
  const userResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId },
    }),
  );
  const user = userResult.Item;

  if (!user) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_POINTS, message: '用户不存在' },
    };
  }

  // 4. Fetch and validate all products
  const orderItems: OrderItem[] = [];
  let totalPoints = 0;
  // Track products with size options for size-specific stock deduction in transaction
  const sizeDeductions: { productId: string; sizeIndex: number; quantity: number }[] = [];

  for (const item of items) {
    const productResult = await dynamoClient.send(
      new GetCommand({
        TableName: tables.productsTable,
        Key: { productId: item.productId },
      }),
    );
    const product = productResult.Item;

    if (!product || product.status !== 'active') {
      return {
        success: false,
        error: { code: ErrorCodes.OUT_OF_STOCK, message: `商品 ${item.productId} 不存在或已下架` },
      };
    }

    if (product.stock < item.quantity) {
      return {
        success: false,
        error: { code: ErrorCodes.OUT_OF_STOCK, message: `商品 ${product.name} 库存不足` },
      };
    }

    // Check redemption permission
    const allowedRoles = product.allowedRoles;
    if (allowedRoles !== 'all') {
      const userRoles: string[] = user.roles instanceof Set
        ? Array.from(user.roles)
        : (user.roles ?? []);
      const allowed: string[] = allowedRoles instanceof Set
        ? Array.from(allowedRoles as Set<string>)
        : Array.isArray(allowedRoles) ? allowedRoles : [];
      const hasMatchingRole = userRoles.some((role: string) => allowed.includes(role));
      if (!hasMatchingRole) {
        return {
          success: false,
          error: {
            code: ErrorCodes.NO_REDEMPTION_PERMISSION,
            message: `商品 ${product.name} ${ErrorMessages.NO_REDEMPTION_PERMISSION}`,
          },
        };
      }
    }

    // Purchase limit validation
    if (product.purchaseLimitEnabled) {
      const purchaseLimitCount = product.purchaseLimitCount as number;
      const historicalCount = await getUserProductPurchaseCount(
        userId,
        item.productId,
        dynamoClient,
        tables.ordersTable,
      );
      if (historicalCount + item.quantity > purchaseLimitCount) {
        const remaining = Math.max(0, purchaseLimitCount - historicalCount);
        return {
          success: false,
          error: {
            code: ErrorCodes.PURCHASE_LIMIT_EXCEEDED,
            message: `超出限购数量，您已购买 ${historicalCount} 件，最多还可购买 ${remaining} 件`,
          },
        };
      }
    }

    // Size validation
    const sizeOptions: SizeOption[] | undefined = product.sizeOptions;
    if (sizeOptions && sizeOptions.length > 0) {
      if (!item.selectedSize) {
        return {
          success: false,
          error: { code: ErrorCodes.SIZE_REQUIRED, message: ErrorMessages.SIZE_REQUIRED },
        };
      }
      const sizeIndex = sizeOptions.findIndex((s: SizeOption) => s.name === item.selectedSize);
      if (sizeIndex < 0) {
        return {
          success: false,
          error: { code: ErrorCodes.SIZE_NOT_FOUND, message: ErrorMessages.SIZE_NOT_FOUND },
        };
      }
      if (sizeOptions[sizeIndex].stock < item.quantity) {
        return {
          success: false,
          error: { code: ErrorCodes.SIZE_OUT_OF_STOCK, message: ErrorMessages.SIZE_OUT_OF_STOCK },
        };
      }
      sizeDeductions.push({ productId: item.productId, sizeIndex, quantity: item.quantity });
    }

    const pointsCost = product.pointsCost as number;
    const subtotal = pointsCost * item.quantity;
    totalPoints += subtotal;

    orderItems.push({
      productId: item.productId,
      productName: product.name as string,
      imageUrl: (product.imageUrl as string) ?? '',
      pointsCost,
      quantity: item.quantity,
      subtotal,
      selectedSize: item.selectedSize,
    });
  }

  // 5. Validate user points balance
  const userPoints = user.points ?? 0;
  if (userPoints < totalPoints) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_POINTS, message: ErrorMessages.INSUFFICIENT_POINTS },
    };
  }

  // 6. Build atomic transaction
  const now = new Date().toISOString();
  const orderId = ulid();
  const recordId = ulid();
  const balanceAfter = userPoints - totalPoints;

  const initialEvent: ShippingEvent = {
    status: 'pending',
    timestamp: now,
    remark: '订单已创建',
  };

  const orderRecord = {
    orderId,
    userId,
    items: orderItems,
    totalPoints,
    shippingAddress: {
      recipientName: address.recipientName as string,
      phone: address.phone as string,
      detailAddress: address.detailAddress as string,
    },
    shippingStatus: 'pending',
    shippingEvents: [initialEvent],
    createdAt: now,
    updatedAt: now,
  };

  const pointsRecord = {
    recordId,
    userId,
    type: 'spend',
    amount: -totalPoints,
    source: `订单 ${orderId}`,
    balanceAfter,
    createdAt: now,
  };

  const transactItems: any[] = [
    // a. Deduct user points
    {
      Update: {
        TableName: tables.usersTable,
        Key: { userId },
        UpdateExpression: 'SET points = points - :total, updatedAt = :now',
        ConditionExpression: 'points >= :total',
        ExpressionAttributeValues: {
          ':total': totalPoints,
          ':now': now,
        },
      },
    },
    // b. Reduce stock for each product (with size-specific deduction if applicable)
    ...orderItems.map((item) => {
      const sizeDeduction = sizeDeductions.find((sd) => sd.productId === item.productId);
      if (sizeDeduction) {
        // Size-enabled product: deduct both size stock and total stock
        return {
          Update: {
            TableName: tables.productsTable,
            Key: { productId: item.productId },
            UpdateExpression:
              `SET stock = stock - :qty, sizeOptions[${sizeDeduction.sizeIndex}].stock = sizeOptions[${sizeDeduction.sizeIndex}].stock - :qty, redemptionCount = redemptionCount + :qty, updatedAt = :now`,
            ConditionExpression: `stock >= :qty AND sizeOptions[${sizeDeduction.sizeIndex}].stock >= :qty AND #s = :active`,
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':qty': item.quantity,
              ':active': 'active',
              ':now': now,
            },
          },
        };
      }
      return {
        Update: {
          TableName: tables.productsTable,
          Key: { productId: item.productId },
          UpdateExpression:
            'SET stock = stock - :qty, redemptionCount = redemptionCount + :qty, updatedAt = :now',
          ConditionExpression: 'stock >= :qty AND #s = :active',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':qty': item.quantity,
            ':active': 'active',
            ':now': now,
          },
        },
      };
    }),
    // c. Create order record
    {
      Put: {
        TableName: tables.ordersTable,
        Item: orderRecord,
      },
    },
    // d. Write points record
    {
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: pointsRecord,
      },
    },
  ];

  await dynamoClient.send(
    new TransactWriteCommand({ TransactItems: transactItems }),
  );

  // 7. Remove redeemed items from cart (best-effort, after successful transaction)
  try {
    const cartResult = await dynamoClient.send(
      new GetCommand({
        TableName: tables.cartTable,
        Key: { userId },
      }),
    );
    const cart = cartResult.Item;
    if (cart) {
      const cartItems: CartItem[] = cart.items ?? [];
      const redeemedProductIds = new Set(items.map((i) => i.productId));
      const remainingItems = cartItems.filter((ci) => !redeemedProductIds.has(ci.productId));

      await dynamoClient.send(
        new PutCommand({
          TableName: tables.cartTable,
          Item: {
            userId,
            items: remainingItems,
            updatedAt: now,
          },
        }),
      );
    }
  } catch {
    // Cart cleanup is best-effort; order was already created successfully
  }

  return { success: true, orderId };
}

/**
 * Create a direct order for a single product (from product detail page).
 * Delegates to createOrder internally with a single-item array.
 *
 * Requirements: 8.2, 8.4
 */
export async function createDirectOrder(
  userId: string,
  productId: string,
  quantity: number,
  addressId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: OrderTableNames,
  selectedSize?: string,
): Promise<CreateOrderResult> {
  return createOrder(userId, [{ productId, quantity, selectedSize }], addressId, dynamoClient, tables);
}


export interface GetOrdersResult {
  success: boolean;
  orders?: OrderListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: { code: string; message: string };
}

export interface GetOrderDetailResult {
  success: boolean;
  order?: OrderResponse;
  error?: { code: string; message: string };
}

/**
 * Query user orders via GSI userId-createdAt-index, sorted by createdAt descending.
 * Supports page-based pagination (page number and pageSize).
 * Returns OrderListItem[] with orderId, itemCount, totalPoints, shippingStatus, createdAt.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export async function getOrders(
  userId: string,
  page: number,
  pageSize: number,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<GetOrdersResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(pageSize, 100));

  // Query all user orders via GSI, sorted by createdAt descending
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: ordersTable,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,
    }),
  );

  const allItems = result.Items ?? [];
  const total = allItems.length;

  // Apply page-based pagination
  const start = (safePage - 1) * safePageSize;
  const pagedItems = allItems.slice(start, start + safePageSize);

  const orders: OrderListItem[] = pagedItems.map((item) => ({
    orderId: item.orderId as string,
    itemCount: Array.isArray(item.items) ? item.items.length : 0,
    totalPoints: (item.totalPoints as number) ?? 0,
    shippingStatus: item.shippingStatus as OrderListItem['shippingStatus'],
    createdAt: item.createdAt as string,
  }));

  return {
    success: true,
    orders,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * Get order detail by orderId. Verifies the order belongs to the user.
 * Returns ORDER_NOT_FOUND if order does not exist or belongs to another user.
 *
 * Requirements: 5.4, 5.5
 */
export async function getOrderDetail(
  orderId: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  ordersTable: string,
): Promise<GetOrderDetailResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: ordersTable,
      Key: { orderId },
    }),
  );

  const item = result.Item;

  if (!item || item.userId !== userId) {
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
