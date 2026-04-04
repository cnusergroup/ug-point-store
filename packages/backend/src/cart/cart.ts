import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { CartItem, CartItemDetail, CartResponse, SizeOption } from '@points-mall/shared';
import { getUserProductPurchaseCount } from '../orders/order';

export interface CartResult {
  success: boolean;
  data?: CartResponse;
  error?: { code: string; message: string };
}

export interface CartMutationResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Add a product to the user's cart.
 * - Rejects code_exclusive products (CODE_PRODUCT_NOT_CARTABLE)
 * - Rejects inactive or zero-stock products (PRODUCT_UNAVAILABLE)
 * - Rejects if cart already has 20 distinct items (CART_FULL)
 * - If product already in cart (same productId + selectedSize), increments quantity; otherwise adds with quantity=1
 * - Validates selectedSize for products with sizeOptions
 * - Validates purchase limit: historical + cart quantity + 1 <= purchaseLimitCount
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.4, 4.6, 6.5, 6.6
 */
export async function addToCart(
  userId: string,
  productId: string,
  dynamoClient: DynamoDBDocumentClient,
  cartTable: string,
  productsTable: string,
  selectedSize?: string,
  ordersTable?: string,
): Promise<CartMutationResult> {
  // 1. Fetch product to validate
  const productResult = await dynamoClient.send(
    new GetCommand({
      TableName: productsTable,
      Key: { productId },
    }),
  );
  const product = productResult.Item;

  if (!product) {
    return {
      success: false,
      error: { code: ErrorCodes.PRODUCT_UNAVAILABLE, message: ErrorMessages.PRODUCT_UNAVAILABLE },
    };
  }

  // 2. Reject code_exclusive products
  if (product.type === 'code_exclusive') {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_PRODUCT_NOT_CARTABLE, message: ErrorMessages.CODE_PRODUCT_NOT_CARTABLE },
    };
  }

  // 3. Reject inactive or zero-stock products
  if (product.status !== 'active' || product.stock <= 0) {
    return {
      success: false,
      error: { code: ErrorCodes.PRODUCT_UNAVAILABLE, message: ErrorMessages.PRODUCT_UNAVAILABLE },
    };
  }

  // 4. Size validation for products with sizeOptions
  const sizeOptions: SizeOption[] | undefined = product.sizeOptions;
  if (sizeOptions && sizeOptions.length > 0) {
    if (!selectedSize) {
      return {
        success: false,
        error: { code: ErrorCodes.SIZE_REQUIRED, message: ErrorMessages.SIZE_REQUIRED },
      };
    }
    const sizeOption = sizeOptions.find((s: SizeOption) => s.name === selectedSize);
    if (!sizeOption) {
      return {
        success: false,
        error: { code: ErrorCodes.SIZE_NOT_FOUND, message: ErrorMessages.SIZE_NOT_FOUND },
      };
    }
    if (sizeOption.stock <= 0) {
      return {
        success: false,
        error: { code: ErrorCodes.SIZE_OUT_OF_STOCK, message: ErrorMessages.SIZE_OUT_OF_STOCK },
      };
    }
  }

  // 5. Get current cart
  const cartResult = await dynamoClient.send(
    new GetCommand({
      TableName: cartTable,
      Key: { userId },
    }),
  );
  const cart = cartResult.Item;
  const items: CartItem[] = cart?.items ?? [];

  // 6. Purchase limit validation
  if (product.purchaseLimitEnabled && ordersTable) {
    const purchaseLimitCount = product.purchaseLimitCount as number;
    const historicalCount = await getUserProductPurchaseCount(
      userId,
      productId,
      dynamoClient,
      ordersTable,
    );
    // Sum all cart items for this product (across all sizes)
    const cartQuantity = items
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
    if (historicalCount + cartQuantity + 1 > purchaseLimitCount) {
      return {
        success: false,
        error: { code: ErrorCodes.PURCHASE_LIMIT_EXCEEDED, message: ErrorMessages.PURCHASE_LIMIT_EXCEEDED },
      };
    }
  }

  // 7. Check if product already in cart (composite key: productId + selectedSize)
  const existingIndex = items.findIndex(
    (item) => item.productId === productId && item.selectedSize === selectedSize,
  );

  if (existingIndex >= 0) {
    // Increment quantity
    items[existingIndex].quantity += 1;
  } else {
    // Check cart limit (max 20 distinct items)
    if (items.length >= 20) {
      return {
        success: false,
        error: { code: ErrorCodes.CART_FULL, message: ErrorMessages.CART_FULL },
      };
    }
    // Add new item
    items.push({
      productId,
      quantity: 1,
      addedAt: new Date().toISOString(),
      selectedSize,
    });
  }

  const now = new Date().toISOString();

  // 8. Write updated cart
  await dynamoClient.send(
    new PutCommand({
      TableName: cartTable,
      Item: {
        userId,
        items,
        updatedAt: now,
      },
    }),
  );

  return { success: true };
}

/**
 * Get the user's cart with product details.
 * - Joins cart items with product info
 * - Calculates subtotal, available flag, and totalPoints
 *
 * Requirements: 2.1, 2.2, 2.3, 2.5
 */
export async function getCart(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  cartTable: string,
  productsTable: string,
): Promise<CartResult> {
  // 1. Get cart record
  const cartResult = await dynamoClient.send(
    new GetCommand({
      TableName: cartTable,
      Key: { userId },
    }),
  );
  const cart = cartResult.Item;
  const items: CartItem[] = cart?.items ?? [];

  if (items.length === 0) {
    return {
      success: true,
      data: {
        userId,
        items: [],
        totalPoints: 0,
        updatedAt: cart?.updatedAt ?? new Date().toISOString(),
      },
    };
  }

  // 2. Fetch product details for each cart item
  const detailItems: CartItemDetail[] = [];
  let totalPoints = 0;

  for (const cartItem of items) {
    const productResult = await dynamoClient.send(
      new GetCommand({
        TableName: productsTable,
        Key: { productId: cartItem.productId },
      }),
    );
    const product = productResult.Item;

    if (product) {
      const pointsCost = product.pointsCost ?? 0;
      const subtotal = pointsCost * cartItem.quantity;
      const available = product.status === 'active' && product.stock >= cartItem.quantity;

      detailItems.push({
        productId: cartItem.productId,
        productName: product.name ?? '',
        imageUrl: product.imageUrl ?? '',
        pointsCost,
        quantity: cartItem.quantity,
        subtotal,
        stock: product.stock ?? 0,
        status: product.status as 'active' | 'inactive',
        available,
        selectedSize: cartItem.selectedSize,
      });

      if (available) {
        totalPoints += subtotal;
      }
    } else {
      // Product no longer exists — mark as unavailable
      detailItems.push({
        productId: cartItem.productId,
        productName: '商品已删除',
        imageUrl: '',
        pointsCost: 0,
        quantity: cartItem.quantity,
        subtotal: 0,
        stock: 0,
        status: 'inactive',
        available: false,
      });
    }
  }

  return {
    success: true,
    data: {
      userId,
      items: detailItems,
      totalPoints,
      updatedAt: cart?.updatedAt ?? new Date().toISOString(),
    },
  };
}

/**
 * Update the quantity of a cart item.
 * - If quantity=0, deletes the item
 * - Returns CART_ITEM_NOT_FOUND if item doesn't exist
 *
 * Requirements: 2.3, 2.4
 */
export async function updateCartItem(
  userId: string,
  productId: string,
  quantity: number,
  dynamoClient: DynamoDBDocumentClient,
  cartTable: string,
): Promise<CartMutationResult> {
  // 1. Get current cart
  const cartResult = await dynamoClient.send(
    new GetCommand({
      TableName: cartTable,
      Key: { userId },
    }),
  );
  const cart = cartResult.Item;
  const items: CartItem[] = cart?.items ?? [];

  // 2. Find the item
  const existingIndex = items.findIndex((item) => item.productId === productId);
  if (existingIndex < 0) {
    return {
      success: false,
      error: { code: ErrorCodes.CART_ITEM_NOT_FOUND, message: ErrorMessages.CART_ITEM_NOT_FOUND },
    };
  }

  // 3. Update or remove
  if (quantity <= 0) {
    items.splice(existingIndex, 1);
  } else {
    items[existingIndex].quantity = quantity;
  }

  const now = new Date().toISOString();

  // 4. Write updated cart
  await dynamoClient.send(
    new PutCommand({
      TableName: cartTable,
      Item: {
        userId,
        items,
        updatedAt: now,
      },
    }),
  );

  return { success: true };
}

/**
 * Delete a cart item.
 * - Returns CART_ITEM_NOT_FOUND if item doesn't exist
 *
 * Requirements: 2.4
 */
export async function deleteCartItem(
  userId: string,
  productId: string,
  dynamoClient: DynamoDBDocumentClient,
  cartTable: string,
): Promise<CartMutationResult> {
  // 1. Get current cart
  const cartResult = await dynamoClient.send(
    new GetCommand({
      TableName: cartTable,
      Key: { userId },
    }),
  );
  const cart = cartResult.Item;
  const items: CartItem[] = cart?.items ?? [];

  // 2. Find the item
  const existingIndex = items.findIndex((item) => item.productId === productId);
  if (existingIndex < 0) {
    return {
      success: false,
      error: { code: ErrorCodes.CART_ITEM_NOT_FOUND, message: ErrorMessages.CART_ITEM_NOT_FOUND },
    };
  }

  // 3. Remove the item
  items.splice(existingIndex, 1);

  const now = new Date().toISOString();

  // 4. Write updated cart
  await dynamoClient.send(
    new PutCommand({
      TableName: cartTable,
      Item: {
        userId,
        items,
        updatedAt: now,
      },
    }),
  );

  return { success: true };
}
