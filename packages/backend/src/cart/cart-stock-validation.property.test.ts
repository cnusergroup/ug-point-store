import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { addToCart } from './cart';
import { ErrorCodes } from '@points-mall/shared';

// Feature: cart-quantity-stock-validation, Property 1: 加购库存校验不变量
// 对于任意商品（有效库存为 S）、任意购物车已有数量 E（0 ≤ E ≤ S）、任意请求加购数量 N（N ≥ 1），
// addToCart 应当在 E + N ≤ S 时成功，在 E + N > S 时返回 QUANTITY_EXCEEDS_STOCK 错误码。
// **Validates: Requirements 3.1, 3.2**

vi.mock('../orders/order', () => ({
  getUserProductPurchaseCount: vi.fn().mockResolvedValue(0),
}));

const CART_TABLE = 'Cart';
const PRODUCTS_TABLE = 'Products';

function makeProduct(stock: number) {
  return {
    productId: 'prod-001',
    name: 'Test Product',
    imageUrl: 'https://example.com/img.png',
    type: 'points',
    status: 'active',
    stock,
    pointsCost: 100,
  };
}

function makeCartRecord(existingQty: number) {
  if (existingQty === 0) return undefined;
  return {
    userId: 'user-001',
    items: [
      {
        productId: 'prod-001',
        quantity: existingQty,
        addedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function createMockClient(stock: number, existingQty: number) {
  const client = { send: vi.fn() } as any;
  // 1st call: GetCommand for product
  client.send.mockResolvedValueOnce({ Item: makeProduct(stock) });
  // 2nd call: GetCommand for cart
  client.send.mockResolvedValueOnce({ Item: makeCartRecord(existingQty) });
  // 3rd call: PutCommand (only reached on success)
  client.send.mockResolvedValueOnce({});
  return client;
}

// Generator: stock S (1~100), then existing qty E (0~S), then request qty N (1~200)
const stockAndCartArb = fc
  .integer({ min: 1, max: 100 })
  .chain((stock) =>
    fc.tuple(
      fc.constant(stock),
      fc.integer({ min: 0, max: stock }),
      fc.integer({ min: 1, max: 200 }),
    ),
  );

describe('Property 1: 加购库存校验不变量', () => {
  it('E + N ≤ S 时 addToCart 成功；E + N > S 时返回 QUANTITY_EXCEEDS_STOCK', async () => {
    await fc.assert(
      fc.asyncProperty(stockAndCartArb, async ([stock, existingQty, quantity]) => {
        const client = createMockClient(stock, existingQty);

        const result = await addToCart(
          'user-001',
          'prod-001',
          quantity,
          client,
          CART_TABLE,
          PRODUCTS_TABLE,
        );

        if (existingQty + quantity <= stock) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.QUANTITY_EXCEEDS_STOCK);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cart-quantity-stock-validation, Property 2: 加购后数量正确累加
// 对于任意商品和任意正整数 N，若加购成功：
// - 当购物车中已有该商品（相同 productId + selectedSize）且已有数量为 E 时，加购后数量应为 E + N
// - 当购物车中无该商品时，加购后应新增一项且数量为 N
// **Validates: Requirements 3.3, 3.4**

// Generator: stock S (1~100), existing qty E (0~S), request qty N (1~S-E) ensuring E+N <= S
const accumulationArb = fc
  .integer({ min: 1, max: 100 })
  .chain((stock) =>
    fc.integer({ min: 0, max: stock }).chain((existingQty) => {
      const maxN = stock - existingQty;
      if (maxN < 1) {
        // E == S, no room to add — force E = stock-1 so maxN >= 1
        return fc.tuple(
          fc.constant(stock),
          fc.constant(stock - 1),
          fc.constant(1),
        );
      }
      return fc.tuple(
        fc.constant(stock),
        fc.constant(existingQty),
        fc.integer({ min: 1, max: maxN }),
      );
    }),
  );

describe('Property 2: 加购后数量正确累加', () => {
  it('已有商品时加购后数量为 E + N', async () => {
    await fc.assert(
      fc.asyncProperty(accumulationArb, async ([stock, existingQty, quantity]) => {
        // Only test the case where cart already has the item (E >= 1)
        const effectiveExisting = Math.max(existingQty, 1);
        const effectiveMaxN = stock - effectiveExisting;
        if (effectiveMaxN < 1) return; // skip if no room

        const effectiveN = Math.min(quantity, effectiveMaxN);
        if (effectiveN < 1) return;

        const client = createMockClient(stock, effectiveExisting);

        const result = await addToCart(
          'user-001',
          'prod-001',
          effectiveN,
          client,
          CART_TABLE,
          PRODUCTS_TABLE,
        );

        expect(result.success).toBe(true);

        // Inspect the PutCommand call (3rd send call) to verify accumulated quantity
        const putCall = client.send.mock.calls[2];
        const putItem = putCall[0].input.Item;
        const cartItem = putItem.items.find((i: any) => i.productId === 'prod-001');
        expect(cartItem).toBeDefined();
        expect(cartItem.quantity).toBe(effectiveExisting + effectiveN);
      }),
      { numRuns: 100 },
    );
  });

  it('无该商品时加购后数量为 N', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }).chain((stock) =>
          fc.tuple(
            fc.constant(stock),
            fc.integer({ min: 1, max: stock }),
          ),
        ),
        async ([stock, quantity]) => {
          // Cart has no items (existingQty = 0)
          const client = createMockClient(stock, 0);

          const result = await addToCart(
            'user-001',
            'prod-001',
            quantity,
            client,
            CART_TABLE,
            PRODUCTS_TABLE,
          );

          expect(result.success).toBe(true);

          // Inspect the PutCommand call (3rd send call) to verify new item quantity
          const putCall = client.send.mock.calls[2];
          const putItem = putCall[0].input.Item;
          const cartItem = putItem.items.find((i: any) => i.productId === 'prod-001');
          expect(cartItem).toBeDefined();
          expect(cartItem.quantity).toBe(quantity);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: cart-quantity-stock-validation, Property 3: 非正整数数量被拒绝
// 对于任意非正整数值（0、负数、小数、NaN），addToCart 应返回 INVALID_QUANTITY 错误码，购物车状态不变。
// **Validates: Requirements 2.3**

// Generator: non-positive-integer values — zero, negative integers, and non-integer decimals
const nonPositiveIntegerArb = fc.oneof(
  // Zero
  fc.constant(0),
  // Negative integers
  fc.integer({ min: -1000, max: -1 }),
  // Positive decimals (non-integer): e.g. 1.5, 2.3, 0.1
  fc.double({ min: 0.01, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
  // Negative decimals (non-integer): e.g. -1.5, -0.3
  fc.double({ min: -100, max: -0.01, noNaN: true }).filter((n) => !Number.isInteger(n)),
);

describe('Property 3: 非正整数数量被拒绝', () => {
  it('非正整数数量应返回 INVALID_QUANTITY', async () => {
    await fc.assert(
      fc.asyncProperty(nonPositiveIntegerArb, async (invalidQuantity) => {
        const stock = 50;
        const client = createMockClient(stock, 0);

        const result = await addToCart(
          'user-001',
          'prod-001',
          invalidQuantity,
          client,
          CART_TABLE,
          PRODUCTS_TABLE,
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCodes.INVALID_QUANTITY);

        // Verify cart was NOT written — only 1 send call (GetCommand for product),
        // because addToCart returns early before fetching cart or writing
        expect(client.send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cart-quantity-stock-validation, Property 4: 更新购物车数量时的库存校验
// 对于任意购物车中已有的商品项（有效库存为 S），当调用 updateCartItem 设置新数量 Q 时：
// 若 Q > S 则应返回 QUANTITY_EXCEEDS_STOCK 错误码且购物车不变；
// 若 1 ≤ Q ≤ S 则应成功且数量更新为 Q。
// **Validates: Requirements 6.1, 6.2**

import { updateCartItem } from './cart';

function makeCartRecordForUpdate(productId: string, existingQty: number) {
  return {
    userId: 'user-001',
    items: [
      {
        productId,
        quantity: existingQty,
        addedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function createMockClientForUpdate(stock: number, existingQty: number) {
  const client = { send: vi.fn() } as any;
  // 1st call: GetCommand for cart
  client.send.mockResolvedValueOnce({
    Item: makeCartRecordForUpdate('prod-001', existingQty),
  });
  // 2nd call: GetCommand for product (stock validation)
  client.send.mockResolvedValueOnce({ Item: makeProduct(stock) });
  // 3rd call: PutCommand (only reached on success)
  client.send.mockResolvedValueOnce({});
  return client;
}

// Generator: stock S (1~100), new quantity Q (1~200)
const updateStockArb = fc
  .integer({ min: 1, max: 100 })
  .chain((stock) =>
    fc.tuple(
      fc.constant(stock),
      fc.integer({ min: 1, max: 200 }),
    ),
  );

describe('Property 4: 更新购物车数量时的库存校验', () => {
  it('Q ≤ S 时 updateCartItem 成功；Q > S 时返回 QUANTITY_EXCEEDS_STOCK', async () => {
    await fc.assert(
      fc.asyncProperty(updateStockArb, async ([stock, quantity]) => {
        const existingQty = Math.min(stock, 5); // cart has some existing quantity
        const client = createMockClientForUpdate(stock, existingQty);

        const result = await updateCartItem(
          'user-001',
          'prod-001',
          quantity,
          client,
          CART_TABLE,
          PRODUCTS_TABLE,
        );

        if (quantity <= stock) {
          expect(result.success).toBe(true);
          // Verify the PutCommand wrote the correct quantity
          const putCall = client.send.mock.calls[2];
          const putItem = putCall[0].input.Item;
          const cartItem = putItem.items.find((i: any) => i.productId === 'prod-001');
          expect(cartItem).toBeDefined();
          expect(cartItem.quantity).toBe(quantity);
        } else {
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.QUANTITY_EXCEEDS_STOCK);
          // Verify cart was NOT written — only 2 send calls (GetCommand for cart + GetCommand for product)
          expect(client.send).toHaveBeenCalledTimes(2);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: cart-quantity-stock-validation, Property 6: 购物车详情包含当前库存
// 对于任意用户购物车中的商品项，getCart 返回的 CartItemDetail 中的 stock 字段
// 应等于该商品在 Products 表中的当前库存值。
// **Validates: Requirements 6.3**

import { getCart } from './cart';

function createMockClientForGetCart(stock: number) {
  const client = { send: vi.fn() } as any;
  // 1st call: GetCommand for cart — returns cart with one item
  client.send.mockResolvedValueOnce({
    Item: {
      userId: 'user-001',
      items: [
        {
          productId: 'prod-001',
          quantity: 1,
          addedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  });
  // 2nd call: GetCommand for product — returns product with the given stock
  client.send.mockResolvedValueOnce({
    Item: {
      productId: 'prod-001',
      name: 'Test Product',
      imageUrl: 'https://example.com/img.png',
      pointsCost: 100,
      stock,
      status: 'active',
    },
  });
  return client;
}

describe('Property 6: 购物车详情包含当前库存', () => {
  it('getCart 返回的 CartItemDetail.stock 等于 Products 表中的当前库存', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1000 }),
        async (stock) => {
          const client = createMockClientForGetCart(stock);

          const result = await getCart('user-001', client, CART_TABLE, PRODUCTS_TABLE);

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();
          expect(result.data!.items).toHaveLength(1);
          expect(result.data!.items[0].stock).toBe(stock);
        },
      ),
      { numRuns: 100 },
    );
  });
});
