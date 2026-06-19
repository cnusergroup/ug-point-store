import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  redeemWithCode,
  lookupCodeCandidates,
  resolveCandidateIds,
  CodeRedemptionTableNames,
} from './code-redemption';
import { ErrorCodes } from '@points-mall/shared';

/**
 * Property tests for the multi-candidate "pick one" code redemption flow.
 *
 * Covers design Correctness Properties 4–7 for feature
 * `code-user-email-distribution`. Each property runs >= 100 iterations with
 * fast-check (v4).
 *
 * The DynamoDBDocumentClient `send` is mocked with a dispatcher that routes by
 * command type (constructor name) and command input, returning the appropriate
 * Items and capturing every TransactWriteCommand so we can assert the atomic
 * transaction contents and the absence of side effects.
 */

const tables: CodeRedemptionTableNames = {
  codesTable: 'Codes',
  productsTable: 'Products',
  redemptionsTable: 'Redemptions',
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const alphaNumChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const codeValueArb = fc.string({
  minLength: 4,
  maxLength: 20,
  unit: fc.constantFrom(...alphaNumChars),
});

/** Candidate set: 1–10 distinct product ids (ordered, no duplicates). */
const candidateIdsArb = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 });

interface ProductOverrides {
  status?: string;
  stock?: number;
  name?: string;
}

function makeProduct(productId: string, overrides: ProductOverrides = {}) {
  return {
    productId,
    name: overrides.name ?? `product-${productId}`,
    type: 'code_exclusive',
    status: overrides.status ?? 'active',
    stock: overrides.stock ?? 5,
    redemptionCount: 0,
    eventInfo: 'Event',
    imageUrl: 'https://example.com/img.png',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

interface MockConfig {
  /** Items returned by the codeValue-index query. */
  codeItems: Record<string, unknown>[];
  /** Product table contents keyed by productId. */
  products?: Record<string, Record<string, unknown>>;
  /** Address returned by the Addresses GetCommand. */
  address?: Record<string, unknown>;
  /** Count returned by the redemptions purchase-limit COUNT query. */
  redemptionCount?: number;
}

/**
 * Build a mocked DynamoDBDocumentClient whose `send` dispatches by command
 * type. Captures all TransactWriteCommand TransactItems for inspection.
 */
function makeClient(config: MockConfig) {
  const transactCalls: any[][] = [];
  const productUpdates: any[] = [];
  const send = vi.fn(async (command: any) => {
    const name = command.constructor?.name;
    const input = command.input ?? {};
    if (name === 'QueryCommand') {
      if (input.IndexName === 'codeValue-index') {
        return { Items: config.codeItems };
      }
      // redemptions purchase-limit COUNT query
      return { Count: config.redemptionCount ?? 0 };
    }
    if (name === 'GetCommand') {
      if (input.TableName === tables.productsTable) {
        const pid = input.Key?.productId;
        return { Item: config.products?.[pid] };
      }
      if (input.TableName === tables.addressesTable) {
        return { Item: config.address };
      }
      return { Item: undefined };
    }
    if (name === 'BatchGetCommand') {
      const keys: { productId: string }[] =
        input.RequestItems?.[tables.productsTable]?.Keys ?? [];
      const items = keys
        .map((k) => config.products?.[k.productId])
        .filter((p): p is Record<string, unknown> => Boolean(p));
      return { Responses: { [tables.productsTable]: items } };
    }
    if (name === 'TransactWriteCommand') {
      transactCalls.push(input.TransactItems);
      return {};
    }
    return {};
  });
  return { client: { send } as any, transactCalls, productUpdates };
}

// Feature: code-user-email-distribution, Property 4: 兑换返回候选集合
// For any valid `product` code, lookupCodeCandidates returns a candidate set
// whose identifiers exactly equal the code's candidate set (productIds ?? [productId]).
// Validates: Requirements 2.1
describe('Property 4: 兑换返回候选集合 (lookupCodeCandidates)', () => {
  it('返回的候选标识集合恰好等于 productIds ?? [productId]（保序）', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidateIdsArb,
        codeValueArb,
        // For single-candidate codes, randomly use legacy (productId only) shape.
        fc.boolean(),
        async (candidateIds, codeValue, useLegacyForSingle) => {
          const isSingleLegacy = candidateIds.length === 1 && useLegacyForSingle;
          const code: Record<string, unknown> = {
            codeId: 'code-1',
            codeValue,
            type: 'product',
            maxUses: 1,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };
          if (isSingleLegacy) {
            code.productId = candidateIds[0];
          } else {
            code.productIds = candidateIds;
            if (candidateIds.length === 1) {
              code.productId = candidateIds[0];
            }
          }

          const products: Record<string, Record<string, unknown>> = {};
          for (const pid of candidateIds) {
            products[pid] = makeProduct(pid);
          }

          const { client } = makeClient({ codeItems: [code], products });

          const result = await lookupCodeCandidates(codeValue, client, {
            codesTable: tables.codesTable,
            productsTable: tables.productsTable,
          });

          const expected = resolveCandidateIds(
            code as { productId?: string; productIds?: string[] },
          );

          expect(result.success).toBe(true);
          expect(result.candidates?.map((c) => c.productId)).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: code-user-email-distribution, Property 5: 择一校验
// For any code and any product NOT in its candidate set, redeemWithCode rejects
// with INVALID_PRODUCT_SELECTION, consuming no code and deducting no stock
// (no TransactWriteCommand is issued).
// Validates: Requirements 2.3
describe('Property 5: 择一校验 (redeemWithCode rejects out-of-set product)', () => {
  it('集合外商品被拒绝并返回 INVALID_PRODUCT_SELECTION，且无事务/无库存扣减', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidateIdsArb,
        fc.uuid(),
        codeValueArb,
        fc.uuid(),
        async (candidateIds, outsideProductId, codeValue, userId) => {
          // The selected product must not belong to the candidate set.
          fc.pre(!candidateIds.includes(outsideProductId));

          const code = {
            codeId: 'code-1',
            codeValue,
            type: 'product',
            productIds: candidateIds,
            maxUses: 1,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          const { client, transactCalls } = makeClient({ codeItems: [code] });

          const result = await redeemWithCode(
            { productId: outsideProductId, code: codeValue, userId, addressId: 'addr-1' },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.INVALID_PRODUCT_SELECTION);
          // No atomic transaction => no code consumed, no stock deducted.
          expect(transactCalls).toHaveLength(0);
          // Only the code lookup query was issued (no product/address/transact).
          expect(client.send).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: code-user-email-distribution, Property 6: 兑换成功的原子事务不变量
// For any successful pick-one redemption, within a single atomic transaction:
// the code currentUses +1 and becomes exhausted (maxUses=1); only the
// Selected_Product stock is decremented by 1 (other candidates untouched);
// exactly 1 redemption record is written; exactly 1 order with exactly 1 item
// (the Selected_Product) is written.
// Validates: Requirements 2.5, 2.6, 2.8, 2.11
describe('Property 6: 兑换成功的原子事务不变量', () => {
  it('单事务内：码耗尽、仅所选商品扣库存、写1兑换记录、写1单1项', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidateIdsArb,
        codeValueArb,
        fc.uuid(),
        fc.nat(),
        async (candidateIds, codeValue, userId, selSeed) => {
          const selectedProductId = candidateIds[selSeed % candidateIds.length];

          const code = {
            codeId: 'code-1',
            codeValue,
            type: 'product',
            productIds: candidateIds,
            maxUses: 1,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          // Only the selected product needs to be fetched (GetCommand by id).
          const products: Record<string, Record<string, unknown>> = {};
          for (const pid of candidateIds) {
            products[pid] = makeProduct(pid, { stock: 5 });
          }

          const address = {
            addressId: 'addr-1',
            userId,
            recipientName: 'Test',
            phone: '13800138000',
            detailAddress: '测试地址',
          };

          const { client, transactCalls } = makeClient({
            codeItems: [code],
            products,
            address,
          });

          const result = await redeemWithCode(
            { productId: selectedProductId, code: codeValue, userId, addressId: 'addr-1' },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // Exactly one atomic transaction.
          expect(transactCalls).toHaveLength(1);
          const items = transactCalls[0];

          // Code update: +1 use and exhausted.
          const codeUpdate = items.find(
            (i: any) => i.Update?.TableName === tables.codesTable,
          );
          expect(codeUpdate).toBeDefined();
          expect(codeUpdate.Update.Key.codeId).toBe(code.codeId);
          expect(codeUpdate.Update.UpdateExpression).toContain('currentUses = currentUses + :one');
          expect(codeUpdate.Update.ExpressionAttributeValues[':one']).toBe(1);
          expect(codeUpdate.Update.ExpressionAttributeValues[':newStatus']).toBe('exhausted');

          // Product stock decrement: exactly one product Update, for the
          // Selected_Product only (other candidates untouched).
          const productUpdates = items.filter(
            (i: any) => i.Update?.TableName === tables.productsTable,
          );
          expect(productUpdates).toHaveLength(1);
          expect(productUpdates[0].Update.Key.productId).toBe(selectedProductId);
          expect(productUpdates[0].Update.UpdateExpression).toContain('stock = stock - :one');
          expect(productUpdates[0].Update.ExpressionAttributeValues[':one']).toBe(1);
          // No other candidate product is referenced in any transaction item.
          for (const other of candidateIds.filter((p) => p !== selectedProductId)) {
            const touched = items.some(
              (i: any) =>
                i.Update?.TableName === tables.productsTable &&
                i.Update.Key.productId === other,
            );
            expect(touched).toBe(false);
          }

          // Exactly one redemption record.
          const redemptionPuts = items.filter(
            (i: any) => i.Put?.TableName === tables.redemptionsTable,
          );
          expect(redemptionPuts).toHaveLength(1);
          expect(redemptionPuts[0].Put.Item.productId).toBe(selectedProductId);

          // Exactly one order with exactly one item (the Selected_Product).
          const orderPuts = items.filter(
            (i: any) => i.Put?.TableName === tables.ordersTable,
          );
          expect(orderPuts).toHaveLength(1);
          expect(orderPuts[0].Put.Item.items).toHaveLength(1);
          expect(orderPuts[0].Put.Item.items[0].productId).toBe(selectedProductId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: code-user-email-distribution, Property 7: 缺货/下架的无副作用拒绝
// For any redemption whose Selected_Product is inactive (下架) or out of stock,
// redeemWithCode returns OUT_OF_STOCK and produces no side effects: no code
// consumed, no stock deducted, no order or redemption record written
// (no TransactWriteCommand is issued).
// Validates: Requirements 2.10
describe('Property 7: 缺货/下架的无副作用拒绝', () => {
  it('所选商品下架或缺货时返回 OUT_OF_STOCK，且无任何事务副作用', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidateIdsArb,
        codeValueArb,
        fc.uuid(),
        fc.nat(),
        // false => inactive (下架); true => zero stock (缺货)
        fc.boolean(),
        async (candidateIds, codeValue, userId, selSeed, zeroStock) => {
          const selectedProductId = candidateIds[selSeed % candidateIds.length];

          const code = {
            codeId: 'code-1',
            codeValue,
            type: 'product',
            productIds: candidateIds,
            maxUses: 1,
            currentUses: 0,
            status: 'active',
            usedBy: {},
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          const products: Record<string, Record<string, unknown>> = {};
          for (const pid of candidateIds) {
            products[pid] = makeProduct(pid);
          }
          // Make the selected product unavailable.
          products[selectedProductId] = makeProduct(selectedProductId, {
            status: zeroStock ? 'active' : 'inactive',
            stock: zeroStock ? 0 : 5,
          });

          const { client, transactCalls } = makeClient({
            codeItems: [code],
            products,
            address: {
              addressId: 'addr-1',
              userId,
              recipientName: 'Test',
              phone: '13800138000',
              detailAddress: '测试地址',
            },
          });

          const result = await redeemWithCode(
            { productId: selectedProductId, code: codeValue, userId, addressId: 'addr-1' },
            client,
            tables,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.OUT_OF_STOCK);
          // No atomic transaction => no code consumed, no stock deducted,
          // no order or redemption record written.
          expect(transactCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
