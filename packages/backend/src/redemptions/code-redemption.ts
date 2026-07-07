import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ShippingEvent } from '@points-mall/shared';

export interface RedeemWithCodeInput {
  productId: string;
  code: string;
  userId: string;
  addressId: string;
}

export interface RedeemWithCodeResult {
  success: boolean;
  redemptionId?: string;
  orderId?: string;
  error?: { code: string; message: string };
}

export interface CodeRedemptionTableNames {
  codesTable: string;
  productsTable: string;
  redemptionsTable: string;
  addressesTable: string;
  ordersTable: string;
}

/**
 * Redeem a code-exclusive product using a product code.
 * Validates code-product binding, code validity and usage status,
 * then completes redemption WITHOUT deducting points.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5
 */
export async function redeemWithCode(
  input: RedeemWithCodeInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: CodeRedemptionTableNames,
): Promise<RedeemWithCodeResult> {
  // 1. Query Codes table by codeValue GSI to find the code
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tables.codesTable,
      IndexName: 'codeValue-index',
      KeyConditionExpression: 'codeValue = :cv',
      ExpressionAttributeValues: { ':cv': input.code },
    }),
  );

  const codeItem = queryResult.Items?.[0];

  // 2a. Code exists and status is 'active'
  if (!codeItem || codeItem.status !== 'active') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 2b. Code type is 'product'
  if (codeItem.type !== 'product') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 2c. input.productId must be in the code's candidate set
  //     (productIds ?? [productId]); single-candidate codes are covered by this
  //     includes check since the only valid selection equals the sole candidate.
  const candidateIds = resolveCandidateIds(
    codeItem as { productId?: string; productIds?: string[] },
  );
  if (!candidateIds.includes(input.productId)) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_PRODUCT_SELECTION,
        message: ErrorMessages.INVALID_PRODUCT_SELECTION,
      },
    };
  }

  // 2d. currentUses < maxUses
  if (codeItem.currentUses >= codeItem.maxUses) {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_EXHAUSTED, message: ErrorMessages.CODE_EXHAUSTED },
    };
  }

  // 2e. userId not in usedBy
  const usedByMap: Record<string, string> = codeItem.usedBy ?? {};
  if (usedByMap[input.userId]) {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_ALREADY_USED, message: ErrorMessages.CODE_ALREADY_USED },
    };
  }

  // 3. Get product from Products table
  const productResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.productsTable,
      Key: { productId: input.productId },
    }),
  );

  const product = productResult.Item;

  // 4. Validate product exists and is active
  if (!product || product.status !== 'active') {
    return {
      success: false,
      error: { code: ErrorCodes.OUT_OF_STOCK, message: '商品不存在或已下架' },
    };
  }

  if (product.stock <= 0) {
    return {
      success: false,
      error: { code: ErrorCodes.OUT_OF_STOCK, message: ErrorMessages.OUT_OF_STOCK },
    };
  }

  // 4b. Validate purchase limit
  if (product.purchaseLimitEnabled && product.purchaseLimitCount) {
    const limitCount = product.purchaseLimitCount as number;
    // Query redemptions for this user + product
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

  // 5. Validate addressId is non-empty
  if (!input.addressId) {
    return {
      success: false,
      error: { code: ErrorCodes.NO_ADDRESS_SELECTED, message: ErrorMessages.NO_ADDRESS_SELECTED },
    };
  }

  // 6. Read address from Addresses table and validate ownership
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

  // 7. Atomic transaction
  const now = new Date().toISOString();
  const redemptionId = ulid();
  const orderId = ulid();
  const newUses = codeItem.currentUses + 1;
  const newStatus = newUses >= codeItem.maxUses ? 'exhausted' : 'active';

  const initialEvent: ShippingEvent = {
    status: 'pending',
    timestamp: now,
    remark: '兑换订单已创建',
  };

  await dynamoClient.send(
    new TransactWriteCommand({
      TransactItems: [
        // a. Update Codes: increment currentUses, add userId to usedBy, set status if exhausted
        {
          Update: {
            TableName: tables.codesTable,
            Key: { codeId: codeItem.codeId },
            UpdateExpression:
              'SET currentUses = currentUses + :one, #s = :newStatus, usedBy.#uid = :ts',
            ConditionExpression: 'currentUses < maxUses AND NOT contains(usedBy, :uid)',
            ExpressionAttributeNames: {
              '#s': 'status',
              '#uid': input.userId,
            },
            ExpressionAttributeValues: {
              ':one': 1,
              ':newStatus': newStatus,
              ':ts': now,
              ':uid': input.userId,
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
        // c. Put Redemptions record: method='code', codeUsed=codeValue, NO pointsSpent
        {
          Put: {
            TableName: tables.redemptionsTable,
            Item: {
              redemptionId,
              userId: input.userId,
              productId: input.productId,
              productName: product.name,
              method: 'code',
              codeUsed: input.code,
              status: 'success',
              orderId,
              createdAt: now,
            },
          },
        },
        // d. Put Orders record
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
                  pointsCost: 0,
                  quantity: 1,
                  subtotal: 0,
                },
              ],
              totalPoints: 0,
              shippingAddress: {
                recipientName: address.recipientName as string,
                phone: address.phone as string,
                detailAddress: address.detailAddress as string,
              },
              shippingStatus: 'pending',
              shippingEvents: [initialEvent],
              source: 'code_redemption',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        // e. Do NOT create a PointsRecords entry (no points deducted)
      ],
    }),
  );

  return { success: true, redemptionId, orderId };
}

/**
 * A candidate product bound to a redemption code, presented to the user
 * so they can pick exactly one to redeem.
 */
export interface CodeCandidate {
  productId: string;
  name: string;
  imageUrl?: string;
  stock: number;
  status: string;
}

export interface LookupCodeCandidatesResult {
  success: boolean;
  candidates?: CodeCandidate[];
  error?: { code: string; message: string };
}

/**
 * Resolve the candidate product set of a redemption code in a backward
 * compatible way.
 *
 * Legacy single-product codes only have `productId`; new multi-candidate codes
 * have `productIds`. The candidate set is `productIds ?? (productId ? [productId] : [])`,
 * so legacy codes resolve to `[productId]` and new codes resolve to `productIds`,
 * keeping redemption and display logic identical for both.
 *
 * Requirements: 1.10
 */
export function resolveCandidateIds(code: {
  productId?: string;
  productIds?: string[];
}): string[] {
  return code.productIds ?? (code.productId ? [code.productId] : []);
}

/**
 * Look up the candidate products bound to a redemption code.
 *
 * Resolves the candidate set as `productIds ?? (productId ? [productId] : [])`
 * (backward compatible with legacy single-product codes), then batch-fetches the
 * product details for the frontend "pick one" flow.
 *
 * Returns INVALID_CODE when the code does not exist, is not active, or is not a
 * `product` code; returns CODE_EXHAUSTED when the code has already been used up.
 *
 * Requirements: 2.1
 */
export async function lookupCodeCandidates(
  code: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: { codesTable: string; productsTable: string },
): Promise<LookupCodeCandidatesResult> {
  // 1. Query Codes table by codeValue GSI to find the code
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tables.codesTable,
      IndexName: 'codeValue-index',
      KeyConditionExpression: 'codeValue = :cv',
      ExpressionAttributeValues: { ':cv': code },
    }),
  );

  const codeItem = queryResult.Items?.[0];

  // 2a. Code exists and status is 'active'
  if (!codeItem || codeItem.status !== 'active') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 2b. Code type is 'product'
  if (codeItem.type !== 'product') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 2c. Code not exhausted
  if (codeItem.currentUses >= codeItem.maxUses) {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_EXHAUSTED, message: ErrorMessages.CODE_EXHAUSTED },
    };
  }

  // 3. Resolve candidate set (backward compatible with legacy single-product codes)
  const candidateIds: string[] = resolveCandidateIds(
    codeItem as { productId?: string; productIds?: string[] },
  );

  if (candidateIds.length === 0) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 4. Batch-fetch product details for the candidate set
  const batchResult = await dynamoClient.send(
    new BatchGetCommand({
      RequestItems: {
        [tables.productsTable]: {
          Keys: candidateIds.map((productId) => ({ productId })),
        },
      },
    }),
  );

  const fetched = batchResult.Responses?.[tables.productsTable] ?? [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const product of fetched) {
    byId.set(product.productId as string, product);
  }

  // 5. Preserve candidate ordering; include only products that still exist
  const candidates: CodeCandidate[] = [];
  for (const productId of candidateIds) {
    const product = byId.get(productId);
    if (!product) {
      continue;
    }
    candidates.push({
      productId,
      name: (product.name as string) ?? '',
      imageUrl: product.imageUrl as string | undefined,
      stock: (product.stock as number) ?? 0,
      status: (product.status as string) ?? '',
    });
  }

  return { success: true, candidates };
}
