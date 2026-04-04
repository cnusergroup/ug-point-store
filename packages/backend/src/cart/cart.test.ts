import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addToCart, getCart, updateCartItem, deleteCartItem } from './cart';
import { ErrorCodes } from '@points-mall/shared';

// Mock getUserProductPurchaseCount from orders module
vi.mock('../orders/order', () => ({
  getUserProductPurchaseCount: vi.fn().mockResolvedValue(0),
}));

import { getUserProductPurchaseCount } from '../orders/order';

const CART_TABLE = 'Cart';
const PRODUCTS_TABLE = 'Products';
const ORDERS_TABLE = 'Orders';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    productId: 'prod-001',
    name: 'Test Product',
    imageUrl: 'https://example.com/img.png',
    type: 'points',
    status: 'active',
    stock: 10,
    pointsCost: 100,
    ...overrides,
  };
}

function makeCartRecord(items: any[] = [], overrides: Record<string, any> = {}) {
  return {
    userId: 'user-001',
    items,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('addToCart', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should reject when product does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PRODUCT_UNAVAILABLE);
  });

  it('should reject code_exclusive products', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ type: 'code_exclusive' }) });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_PRODUCT_NOT_CARTABLE);
  });

  it('should reject inactive products', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ status: 'inactive' }) });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PRODUCT_UNAVAILABLE);
  });

  it('should reject zero-stock products', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct({ stock: 0 }) });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PRODUCT_UNAVAILABLE);
  });

  it('should add new product with quantity=1 to empty cart', async () => {
    client.send.mockResolvedValueOnce({ Item: makeProduct() }); // product lookup
    client.send.mockResolvedValueOnce({ Item: undefined }); // empty cart
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0];
    const items = putCmd.input.Item.items;
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe('prod-001');
    expect(items[0].quantity).toBe(1);
  });

  it('should increment quantity when product already in cart', async () => {
    const existingItems = [{ productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' }];
    client.send.mockResolvedValueOnce({ Item: makeProduct() });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) });
    client.send.mockResolvedValueOnce({});

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0];
    const items = putCmd.input.Item.items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('should reject when cart has 20 distinct items', async () => {
    const existingItems = Array.from({ length: 20 }, (_, i) => ({
      productId: `prod-${i}`,
      quantity: 1,
      addedAt: '2024-01-01T00:00:00.000Z',
    }));
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-new' }) });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) });

    const result = await addToCart('user-001', 'prod-new', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CART_FULL);
  });

  it('should allow adding existing product even when cart has 20 items', async () => {
    const existingItems = Array.from({ length: 20 }, (_, i) => ({
      productId: `prod-${i}`,
      quantity: 1,
      addedAt: '2024-01-01T00:00:00.000Z',
    }));
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-5' }) });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) });
    client.send.mockResolvedValueOnce({});

    const result = await addToCart('user-001', 'prod-5', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0];
    expect(putCmd.input.Item.items[5].quantity).toBe(2);
  });

  // --- Size validation tests ---

  it('should reject when product has sizeOptions but no selectedSize provided', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 5 }, { name: 'L', stock: 3 }] });
    client.send.mockResolvedValueOnce({ Item: product });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_REQUIRED);
  });

  it('should reject when selectedSize does not exist in sizeOptions', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 5 }, { name: 'L', stock: 3 }] });
    client.send.mockResolvedValueOnce({ Item: product });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'XXL');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_NOT_FOUND);
  });

  it('should reject when selected size has zero stock', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 0 }, { name: 'L', stock: 3 }] });
    client.send.mockResolvedValueOnce({ Item: product });

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'M');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.SIZE_OUT_OF_STOCK);
  });

  it('should add product with valid selectedSize to cart', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 5 }, { name: 'L', stock: 3 }] });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: undefined }); // empty cart
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'M', ORDERS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0]; // product, cart, put (getUserProductPurchaseCount is mocked at module level)
    const items = putCmd.input.Item.items;
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe('prod-001');
    expect(items[0].selectedSize).toBe('M');
    expect(items[0].quantity).toBe(1);
  });

  it('should treat same product with different sizes as different cart items', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 5 }, { name: 'L', stock: 3 }] });
    const existingItems = [{ productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z', selectedSize: 'M' }];
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) }); // cart with M
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'L', ORDERS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0];
    const items = putCmd.input.Item.items;
    expect(items).toHaveLength(2);
    expect(items[0].selectedSize).toBe('M');
    expect(items[0].quantity).toBe(1);
    expect(items[1].selectedSize).toBe('L');
    expect(items[1].quantity).toBe(1);
  });

  it('should increment quantity when same product and same size already in cart', async () => {
    const product = makeProduct({ sizeOptions: [{ name: 'M', stock: 5 }] });
    const existingItems = [{ productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z', selectedSize: 'M' }];
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) });
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'M', ORDERS_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[2][0];
    const items = putCmd.input.Item.items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  // --- Purchase limit tests ---

  it('should reject when purchase limit is exceeded', async () => {
    const product = makeProduct({ purchaseLimitEnabled: true, purchaseLimitCount: 3 });
    const existingItems = [{ productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' }];
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) }); // cart
    vi.mocked(getUserProductPurchaseCount).mockResolvedValueOnce(2); // historical: 2

    // historical(2) + cart(1) + 1 = 4 > 3
    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, undefined, ORDERS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.PURCHASE_LIMIT_EXCEEDED);
  });

  it('should allow adding when within purchase limit', async () => {
    const product = makeProduct({ purchaseLimitEnabled: true, purchaseLimitCount: 5 });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord([]) }); // empty cart
    vi.mocked(getUserProductPurchaseCount).mockResolvedValueOnce(2); // historical: 2
    client.send.mockResolvedValueOnce({}); // PutCommand

    // historical(2) + cart(0) + 1 = 3 <= 5
    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, undefined, ORDERS_TABLE);

    expect(result.success).toBe(true);
  });

  it('should count all sizes of same product for purchase limit', async () => {
    const product = makeProduct({
      purchaseLimitEnabled: true,
      purchaseLimitCount: 3,
      sizeOptions: [{ name: 'M', stock: 5 }, { name: 'L', stock: 5 }],
    });
    const existingItems = [
      { productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z', selectedSize: 'M' },
      { productId: 'prod-001', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z', selectedSize: 'L' },
    ];
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingItems) });
    vi.mocked(getUserProductPurchaseCount).mockResolvedValueOnce(0); // historical: 0

    // historical(0) + cart(1+1=2) + 1 = 3 <= 3, should pass
    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE, 'M', ORDERS_TABLE);

    expect(result.success).toBe(true);
  });

  it('should skip purchase limit check when no ordersTable provided', async () => {
    const product = makeProduct({ purchaseLimitEnabled: true, purchaseLimitCount: 1 });
    client.send.mockResolvedValueOnce({ Item: product });
    client.send.mockResolvedValueOnce({ Item: makeCartRecord([]) }); // empty cart
    client.send.mockResolvedValueOnce({}); // PutCommand

    // No ordersTable, so purchase limit check is skipped
    const result = await addToCart('user-001', 'prod-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
  });
});

describe('getCart', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return empty cart when no cart record exists', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getCart('user-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
    expect(result.data?.items).toHaveLength(0);
    expect(result.data?.totalPoints).toBe(0);
  });

  it('should return cart with product details and correct totals', async () => {
    const items = [
      { productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' },
      { productId: 'prod-002', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' },
    ];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) }); // cart
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-001', pointsCost: 100, stock: 10 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-002', pointsCost: 50, stock: 5 }) });

    const result = await getCart('user-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.success).toBe(true);
    expect(result.data?.items).toHaveLength(2);
    expect(result.data?.items[0].subtotal).toBe(200);
    expect(result.data?.items[1].subtotal).toBe(50);
    expect(result.data?.totalPoints).toBe(250);
  });

  it('should mark unavailable items and exclude from totalPoints', async () => {
    const items = [
      { productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' },
      { productId: 'prod-002', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' },
    ];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-001', pointsCost: 100, stock: 10 }) });
    client.send.mockResolvedValueOnce({ Item: makeProduct({ productId: 'prod-002', status: 'inactive', pointsCost: 50 }) });

    const result = await getCart('user-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.data?.items[0].available).toBe(true);
    expect(result.data?.items[1].available).toBe(false);
    expect(result.data?.totalPoints).toBe(200); // only available items
  });

  it('should handle deleted products gracefully', async () => {
    const items = [{ productId: 'prod-deleted', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' }];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) });
    client.send.mockResolvedValueOnce({ Item: undefined }); // product deleted

    const result = await getCart('user-001', client, CART_TABLE, PRODUCTS_TABLE);

    expect(result.data?.items[0].available).toBe(false);
    expect(result.data?.items[0].productName).toBe('商品已删除');
    expect(result.data?.totalPoints).toBe(0);
  });
});

describe('updateCartItem', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return CART_ITEM_NOT_FOUND when item does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeCartRecord([]) });

    const result = await updateCartItem('user-001', 'prod-001', 5, client, CART_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CART_ITEM_NOT_FOUND);
  });

  it('should update quantity of existing item', async () => {
    const items = [{ productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' }];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) });
    client.send.mockResolvedValueOnce({});

    const result = await updateCartItem('user-001', 'prod-001', 5, client, CART_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[1][0];
    expect(putCmd.input.Item.items[0].quantity).toBe(5);
  });

  it('should remove item when quantity is 0', async () => {
    const items = [
      { productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' },
      { productId: 'prod-002', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' },
    ];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) });
    client.send.mockResolvedValueOnce({});

    const result = await updateCartItem('user-001', 'prod-001', 0, client, CART_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[1][0];
    expect(putCmd.input.Item.items).toHaveLength(1);
    expect(putCmd.input.Item.items[0].productId).toBe('prod-002');
  });
});

describe('deleteCartItem', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return CART_ITEM_NOT_FOUND when item does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: makeCartRecord([]) });

    const result = await deleteCartItem('user-001', 'prod-001', client, CART_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CART_ITEM_NOT_FOUND);
  });

  it('should remove item from cart', async () => {
    const items = [
      { productId: 'prod-001', quantity: 2, addedAt: '2024-01-01T00:00:00.000Z' },
      { productId: 'prod-002', quantity: 1, addedAt: '2024-01-01T00:00:00.000Z' },
    ];
    client.send.mockResolvedValueOnce({ Item: makeCartRecord(items) });
    client.send.mockResolvedValueOnce({});

    const result = await deleteCartItem('user-001', 'prod-001', client, CART_TABLE);

    expect(result.success).toBe(true);
    const putCmd = client.send.mock.calls[1][0];
    expect(putCmd.input.Item.items).toHaveLength(1);
    expect(putCmd.input.Item.items[0].productId).toBe('prod-002');
  });
});
