import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getRedemptionHistory } from './history';

// Feature: redemption-order-unification, Property 1: 兑换历史分页响应格式正确
// For any 用户的兑换记录集合和任意合法的 page/pageSize 参数，
// getRedemptionHistory 返回的响应必须包含 items、total、page、pageSize 四个字段，
// 且 items 的长度不超过 pageSize，items 按 createdAt 降序排列。
// **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

/** Arbitrary for a single redemption record */
const redemptionRecordArb = fc.record({
  redemptionId: fc.uuid(),
  userId: fc.constant('user-test'),
  productId: fc.uuid(),
  productName: fc.string({ minLength: 1, maxLength: 50 }),
  method: fc.oneof(fc.constant('points' as const), fc.constant('code' as const)),
  pointsSpent: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
  status: fc.oneof(
    fc.constant('success' as const),
    fc.constant('pending' as const),
    fc.constant('failed' as const),
  ),
  createdAt: fc.integer({
    min: new Date('2024-01-01T00:00:00.000Z').getTime(),
    max: new Date('2025-12-31T23:59:59.999Z').getTime(),
  }).map((ts) => new Date(ts).toISOString()),
});

/** Arbitrary for a list of redemption records sorted descending by createdAt (as GSI would return) */
const sortedRecordsArb = fc
  .array(redemptionRecordArb, { minLength: 0, maxLength: 50 })
  .map((records) =>
    [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

/** Arbitrary for valid page/pageSize parameters */
const paginationArb = fc.record({
  page: fc.integer({ min: 1, max: 20 }),
  pageSize: fc.integer({ min: 1, max: 50 }),
});

function createMockDynamoClient(records: Record<string, any>[]) {
  const client = { send: vi.fn() } as any;
  // Mock the QueryCommand to return all records in one page (already sorted by GSI)
  client.send.mockResolvedValue({ Items: records });
  return client;
}

describe('Property 1: 兑换历史分页响应格式正确', () => {
  it('响应应包含 items、total、page、pageSize 四个字段', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          const client = createMockDynamoClient(records);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.success).toBe(true);
          expect(result).toHaveProperty('items');
          expect(result).toHaveProperty('total');
          expect(result).toHaveProperty('page');
          expect(result).toHaveProperty('pageSize');
          expect(Array.isArray(result.items)).toBe(true);
          expect(typeof result.total).toBe('number');
          expect(typeof result.page).toBe('number');
          expect(typeof result.pageSize).toBe('number');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('items 长度不应超过 pageSize', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          const client = createMockDynamoClient(records);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.items!.length).toBeLessThanOrEqual(pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('items 应按 createdAt 降序排列', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          const client = createMockDynamoClient(records);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          const items = result.items!;
          for (let i = 1; i < items.length; i++) {
            expect(items[i - 1].createdAt >= items[i].createdAt).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('total 应等于全部记录数', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          const client = createMockDynamoClient(records);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.total).toBe(records.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('page 和 pageSize 应与请求参数一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          const client = createMockDynamoClient(records);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.page).toBe(page);
          expect(result.pageSize).toBe(pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: redemption-order-unification, Property 6: 兑换历史包含订单关联信息
// For any 兑换历史 API 返回的记录，若该记录有关联的 orderId，
// 则响应中必须同时包含该订单的 shippingStatus 字段，且其值与 Orders 表中对应订单的 shippingStatus 一致。
// Records without orderId should not have shippingStatus.
// **Validates: Requirements 6.1, 6.2**

const shippingStatusArb = fc.oneof(
  fc.constant('pending' as const),
  fc.constant('shipped' as const),
  fc.constant('in_transit' as const),
  fc.constant('delivered' as const),
);

/** Arbitrary for a redemption record that may or may not have an orderId */
const redemptionRecordWithOptionalOrderArb = fc.record({
  redemptionId: fc.uuid(),
  userId: fc.constant('user-test'),
  productId: fc.uuid(),
  productName: fc.string({ minLength: 1, maxLength: 50 }),
  method: fc.oneof(fc.constant('points' as const), fc.constant('code' as const)),
  pointsSpent: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
  status: fc.oneof(
    fc.constant('success' as const),
    fc.constant('pending' as const),
    fc.constant('failed' as const),
  ),
  orderId: fc.option(fc.uuid(), { nil: undefined }),
  createdAt: fc.integer({
    min: new Date('2024-01-01T00:00:00.000Z').getTime(),
    max: new Date('2025-12-31T23:59:59.999Z').getTime(),
  }).map((ts) => new Date(ts).toISOString()),
});

/** Sorted records with optional orderId */
const sortedRecordsWithOrderArb = fc
  .array(redemptionRecordWithOptionalOrderArb, { minLength: 1, maxLength: 30 })
  .map((records) =>
    [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

/**
 * Creates a mock DynamoDB client that handles both QueryCommand (redemption records)
 * and BatchGetCommand (order shippingStatus lookup).
 */
function createMockDynamoClientWithOrders(
  records: Record<string, any>[],
  orderStatusMap: Record<string, string>,
) {
  const client = { send: vi.fn() } as any;
  client.send.mockImplementation((command: any) => {
    const commandName = command.constructor.name;
    if (commandName === 'QueryCommand') {
      return Promise.resolve({ Items: records });
    }
    if (commandName === 'BatchGetCommand') {
      // Extract requested orderIds from the BatchGetCommand input
      const requestItems = command.input?.RequestItems ?? {};
      const ordersTableKey = Object.keys(requestItems)[0];
      const keys: { orderId: string }[] = requestItems[ordersTableKey]?.Keys ?? [];
      const responseItems = keys
        .filter((k) => orderStatusMap[k.orderId] !== undefined)
        .map((k) => ({
          orderId: k.orderId,
          shippingStatus: orderStatusMap[k.orderId],
        }));
      return Promise.resolve({
        Responses: { [ordersTableKey]: responseItems },
      });
    }
    return Promise.resolve({});
  });
  return client;
}

describe('Property 6: 兑换历史包含订单关联信息', () => {
  it('有 orderId 的记录应包含正确的 shippingStatus，无 orderId 的记录不应有 shippingStatus', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsWithOrderArb,
        shippingStatusArb,
        paginationArb,
        async (records, defaultStatus, { page, pageSize }) => {
          // Build an order status map: for each record with orderId, assign a shippingStatus
          const orderStatusMap: Record<string, string> = {};
          for (const r of records) {
            if (r.orderId) {
              orderStatusMap[r.orderId] = defaultStatus;
            }
          }

          const client = createMockDynamoClientWithOrders(records, orderStatusMap);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.success).toBe(true);

          for (const item of result.items!) {
            if (item.orderId && orderStatusMap[item.orderId]) {
              // Records with orderId should have shippingStatus matching Orders table
              expect(item.shippingStatus).toBe(orderStatusMap[item.orderId]);
            } else {
              // Records without orderId should not have shippingStatus
              expect(item.shippingStatus).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('每条有 orderId 的记录的 shippingStatus 应与 Orders 表中对应订单一致（不同状态）', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortedRecordsWithOrderArb,
        paginationArb,
        async (records, { page, pageSize }) => {
          // Assign varying shippingStatus per orderId
          const statuses: Array<'pending' | 'shipped' | 'in_transit' | 'delivered'> = [
            'pending', 'shipped', 'in_transit', 'delivered',
          ];
          const orderStatusMap: Record<string, string> = {};
          let idx = 0;
          for (const r of records) {
            if (r.orderId) {
              orderStatusMap[r.orderId] = statuses[idx % statuses.length];
              idx++;
            }
          }

          const client = createMockDynamoClientWithOrders(records, orderStatusMap);

          const result = await getRedemptionHistory(
            'user-test',
            client,
            'Redemptions',
            'Orders',
            { page, pageSize },
          );

          expect(result.success).toBe(true);

          for (const item of result.items!) {
            if (item.orderId && orderStatusMap[item.orderId]) {
              expect(item.shippingStatus).toBe(orderStatusMap[item.orderId]);
            } else {
              expect(item.shippingStatus).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
