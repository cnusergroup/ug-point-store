import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { updateShipping } from './admin-order';

// ============================================================
// Feature: simplified-shipping — Property-Based Tests
// ============================================================

// ============================================================
// Helpers
// ============================================================

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeFullOrder(overrides: Record<string, any> = {}) {
  return {
    orderId: 'order-001',
    userId: 'user-001',
    items: [
      { productId: 'prod-001', productName: 'Product 1', imageUrl: 'img.png', pointsCost: 100, quantity: 1, subtotal: 100 },
    ],
    totalPoints: 100,
    shippingAddress: {
      recipientName: '张三',
      phone: '13800138000',
      detailAddress: '北京市朝阳区某某路1号',
    },
    shippingStatus: 'pending',
    trackingNumber: undefined,
    shippingEvents: [{ status: 'pending', timestamp: '2024-01-01T00:00:00.000Z', remark: '订单已创建' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================
// Arbitraries
// ============================================================

/** Generate a random orderId */
const orderIdArb = fc.stringMatching(/^order-[a-z0-9]{4,12}$/);

/** Generate a random operatorId */
const operatorIdArb = fc.stringMatching(/^admin-[a-z0-9]{3,8}$/);

/** Generate a random remark or undefined */
const remarkArb = fc.option(
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  { nil: undefined },
);

/**
 * Generate trackingNumber values that should NOT trigger storage:
 * undefined, empty string, or whitespace-only strings.
 */
const emptyTrackingNumberArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 }).map((chars) => chars.join('')),
);

/**
 * Generate non-empty tracking number strings (at least one non-whitespace character).
 */
const nonEmptyTrackingNumberArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

// ============================================================
// Property 1: Shipping without tracking number always succeeds
// Feature: simplified-shipping, Property 1: Shipping without tracking number always succeeds
// **Validates: Requirements 1.1, 1.2, 1.4**
// ============================================================

describe('Feature: simplified-shipping, Property 1: Shipping without tracking number always succeeds', () => {
  it('for any pending order, updateShipping with status "shipped" and any empty/undefined/whitespace trackingNumber returns { success: true }', async () => {
    await fc.assert(
      fc.asyncProperty(
        orderIdArb,
        emptyTrackingNumberArb,
        remarkArb,
        operatorIdArb,
        async (orderId, trackingNumber, remark, operatorId) => {
          const client = createMockDynamoClient();

          // Mock GetCommand: return a pending order
          client.send.mockResolvedValueOnce({
            Item: makeFullOrder({ orderId, shippingStatus: 'pending' }),
          });
          // Mock UpdateCommand: succeed
          client.send.mockResolvedValueOnce({});

          const result = await updateShipping(
            orderId,
            'shipped',
            trackingNumber,
            remark,
            operatorId,
            client,
            'Orders',
          );

          // Must always succeed
          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();

          // Verify the UpdateCommand was sent (second call)
          expect(client.send).toHaveBeenCalledTimes(2);
          const updateCmd = client.send.mock.calls[1][0];
          expect(updateCmd.input.ExpressionAttributeValues[':newStatus']).toBe('shipped');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Provided tracking number is stored on the order
// Feature: simplified-shipping, Property 2: Provided tracking number is stored on the order
// **Validates: Requirements 1.3**
// ============================================================

describe('Feature: simplified-shipping, Property 2: Provided tracking number is stored on the order', () => {
  it('for any pending order and any non-empty tracking number, the tracking number is stored via the DynamoDB UpdateCommand', async () => {
    await fc.assert(
      fc.asyncProperty(
        orderIdArb,
        nonEmptyTrackingNumberArb,
        remarkArb,
        operatorIdArb,
        async (orderId, trackingNumber, remark, operatorId) => {
          const client = createMockDynamoClient();

          // Mock GetCommand: return a pending order
          client.send.mockResolvedValueOnce({
            Item: makeFullOrder({ orderId, shippingStatus: 'pending' }),
          });
          // Mock UpdateCommand: succeed
          client.send.mockResolvedValueOnce({});

          const result = await updateShipping(
            orderId,
            'shipped',
            trackingNumber,
            remark,
            operatorId,
            client,
            'Orders',
          );

          expect(result.success).toBe(true);

          // Verify the UpdateCommand stores the tracking number
          const updateCmd = client.send.mock.calls[1][0];
          expect(updateCmd.input.UpdateExpression).toContain('trackingNumber = :tn');
          expect(updateCmd.input.ExpressionAttributeValues[':tn']).toBe(trackingNumber);
        },
      ),
      { numRuns: 100 },
    );
  });
});
