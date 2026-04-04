import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ShippingEvent } from '@points-mall/shared';

export interface RedeemWithPointsInput {
  productId: string;
  userId: string;
  addressId: string;
}

export interface RedeemWithPointsResult {
  success: boolean;
  redemptionId?: string;
  orderId?: string;
  error?: { code: string; message: string };
}

export interface RedemptionTableNames {
  usersTable: string;
  productsTable: string;
  redemptionsTable: string;
  pointsRecordsTable: string;
  addressesTable: string;
  ordersTable: string;
}

/**
 * Redeem a product using points: validate user identity/permissions,
 * points balance, product stock, and shipping address, then atomically
 * deduct points, reduce stock, create redemption + points + order records.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.4
 */
export async function redeemWithPoints(
  input: RedeemWithPointsInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: RedemptionTableNames,
): Promise<RedeemWithPointsResult> {
  // 1. Get product from Products table
  const productResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.productsTable,
      Key: { productId: input.productId },
    }),
  );

  const product = productResult.Item;

  // 2. Validate product exists and is active
  if (!product || product.status !== 'active') {
    return {
      success: false,
      error: { code: ErrorCodes.OUT_OF_STOCK, message: '商品不存在或已下架' },
    };
  }

  // 3. Validate product type is 'points' (not 'code_exclusive')
  if (product.type === 'code_exclusive') {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_ONLY_PRODUCT, message: ErrorMessages.CODE_ONLY_PRODUCT },
    };
  }

  // 4. Validate product stock > 0
  if (product.stock <= 0) {
    return {
      success: false,
      error: { code: ErrorCodes.OUT_OF_STOCK, message: ErrorMessages.OUT_OF_STOCK },
    };
  }

  // 4b. Validate purchase limit
  if (product.purchaseLimitEnabled && product.purchaseLimitCount) {
    const limitCount = product.purchaseLimitCount as number;
    const redemptionQuery = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.redemptionsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: 'productId = :pid',
        ExpressionAttributeValues: { ':uid': input.userId, ':pid': input.productId },
        Select: 'COUNT',
      }),
    );
    if ((redemptionQuery.Count ?? 0) >= limitCount) {
      return {
        success: false,
        error: { code: ErrorCodes.PURCHASE_LIMIT_EXCEEDED, message: ErrorMessages.PURCHASE_LIMIT_EXCEEDED },
      };
    }
  }

  // 5. Get user from Users table
  const userResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId: input.userId },
    }),
  );

  const user = userResult.Item;
  if (!user) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_POINTS, message: '用户不存在' },
    };
  }

  const userPoints = user.points ?? 0;
  const pointsCost = product.pointsCost as number;

  // 6. Validate user has sufficient points
  if (userPoints < pointsCost) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_POINTS, message: ErrorMessages.INSUFFICIENT_POINTS },
    };
  }

  // 7. Validate user has matching role
  const allowedRoles = product.allowedRoles;
  if (allowedRoles !== 'all') {
    const userRoles: string[] = user.roles instanceof Set ? Array.from(user.roles) : (user.roles ?? []);
    const allowed: string[] = allowedRoles instanceof Set
      ? Array.from(allowedRoles as Set<string>)
      : Array.isArray(allowedRoles) ? allowedRoles : [];
    const hasMatchingRole = userRoles.some((role: string) => allowed.includes(role));
    if (!hasMatchingRole) {
      return {
        success: false,
        error: {
          code: ErrorCodes.NO_REDEMPTION_PERMISSION,
          message: ErrorMessages.NO_REDEMPTION_PERMISSION,
        },
      };
    }
  }

  // 8. Validate addressId is non-empty
  if (!input.addressId) {
    return {
      success: false,
      error: { code: ErrorCodes.NO_ADDRESS_SELECTED, message: ErrorMessages.NO_ADDRESS_SELECTED },
    };
  }

  // 9. Read address from Addresses table and validate ownership
  const addressResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.addressesTable,
      Key: { addressId: input.addressId },
    }),
  );

  const address = addressResult.Item;
  if (!address || address.userId !== input.userId) {
    return {
      success: false,
      error: { code: ErrorCodes.ADDRESS_NOT_FOUND, message: ErrorMessages.ADDRESS_NOT_FOUND },
    };
  }

  // 10. Atomic transaction
  const now = new Date().toISOString();
  const redemptionId = ulid();
  const recordId = ulid();
  const orderId = ulid();
  const balanceAfter = userPoints - pointsCost;

  const initialEvent: ShippingEvent = {
    status: 'pending',
    timestamp: now,
    remark: '兑换订单已创建',
  };

  await dynamoClient.send(
    new TransactWriteCommand({
      TransactItems: [
        // a. Update Users: deduct points
        {
          Update: {
            TableName: tables.usersTable,
            Key: { userId: input.userId },
            UpdateExpression: 'SET points = points - :cost, updatedAt = :now',
            ConditionExpression: 'points >= :cost',
            ExpressionAttributeValues: {
              ':cost': pointsCost,
              ':now': now,
            },
          },
        },
        // b. Update Products: decrement stock, increment redemptionCount
        {
          Update: {
            TableName: tables.productsTable,
            Key: { productId: input.productId },
            UpdateExpression:
              'SET stock = stock - :one, redemptionCount = redemptionCount + :one, updatedAt = :now',
            ConditionExpression: 'stock > :zero AND #s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':zero': 0,
              ':active': 'active',
              ':now': now,
            },
          },
        },
        // c. Put Redemptions record
        {
          Put: {
            TableName: tables.redemptionsTable,
            Item: {
              redemptionId,
              userId: input.userId,
              productId: input.productId,
              productName: product.name,
              method: 'points',
              pointsSpent: pointsCost,
              status: 'success',
              orderId,
              createdAt: now,
            },
          },
        },
        // d. Put PointsRecords record
        {
          Put: {
            TableName: tables.pointsRecordsTable,
            Item: {
              recordId,
              userId: input.userId,
              type: 'spend',
              amount: -pointsCost,
              source: product.name,
              balanceAfter,
              createdAt: now,
            },
          },
        },
        // e. Put Orders record
        {
          Put: {
            TableName: tables.ordersTable,
            Item: {
              orderId,
              userId: input.userId,
              items: [
                {
                  productId: input.productId,
                  productName: product.name,
                  imageUrl: (product.imageUrl as string) ?? '',
                  pointsCost,
                  quantity: 1,
                  subtotal: pointsCost,
                },
              ],
              totalPoints: pointsCost,
              shippingAddress: {
                recipientName: address.recipientName as string,
                phone: address.phone as string,
                detailAddress: address.detailAddress as string,
              },
              shippingStatus: 'pending',
              shippingEvents: [initialEvent],
              source: 'points_redemption',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
      ],
    }),
  );

  return { success: true, redemptionId, orderId };
}
