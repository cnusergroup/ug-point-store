import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  batchGeneratePointsCodes,
  generateProductCodes,
} from './codes';

// Feature: points-mall, Property 15: 批量生成 Code 正确性
// 对于任何批量生成请求（指定数量 N、积分值 V、最大使用次数 M），生成的 Code 数量应等于 N，
// 且每个 Code 的积分值应为 V，最大使用次数应为 M，状态应为 active。
// 对于商品专属码，每个生成的 Code 应正确绑定到指定商品。
// Validates: Requirements 9.1, 9.2

const tableName = 'Codes';

function createMockClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

/** Arbitrary for batch generate points codes input */
const batchInputArb = fc.record({
  count: fc.integer({ min: 1, max: 60 }),
  pointsValue: fc.integer({ min: 1, max: 10000 }),
  maxUses: fc.integer({ min: 1, max: 100 }),
});

/** Arbitrary for product code generation input */
const productInputArb = fc.record({
  productId: fc.uuid(),
  count: fc.integer({ min: 1, max: 60 }),
});

describe('Property 15: 批量生成 Code 正确性', () => {
  it('生成的积分码数量应等于请求数量 N', async () => {
    await fc.assert(
      fc.asyncProperty(batchInputArb, async (input) => {
        const client = createMockClient();
        const result = await batchGeneratePointsCodes(input, client, tableName);

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(input.count);
      }),
      { numRuns: 100 },
    );
  });

  it('每个积分码的积分值应为 V，最大使用次数应为 M，状态应为 active', async () => {
    await fc.assert(
      fc.asyncProperty(batchInputArb, async (input) => {
        const client = createMockClient();
        const result = await batchGeneratePointsCodes(input, client, tableName);

        for (const code of result.data!) {
          expect(code.type).toBe('points');
          expect(code.pointsValue).toBe(input.pointsValue);
          expect(code.maxUses).toBe(input.maxUses);
          expect(code.currentUses).toBe(0);
          expect(code.status).toBe('active');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('每个积分码应有唯一的 codeId 和 codeValue', async () => {
    await fc.assert(
      fc.asyncProperty(batchInputArb, async (input) => {
        const client = createMockClient();
        const result = await batchGeneratePointsCodes(input, client, tableName);

        const ids = new Set(result.data!.map((c) => c.codeId));
        const values = new Set(result.data!.map((c) => c.codeValue));
        expect(ids.size).toBe(input.count);
        expect(values.size).toBe(input.count);
      }),
      { numRuns: 100 },
    );
  });

  it('生成的商品专属码数量应等于请求数量', async () => {
    await fc.assert(
      fc.asyncProperty(productInputArb, async (input) => {
        const client = createMockClient();
        const result = await generateProductCodes(input, client, tableName);

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(input.count);
      }),
      { numRuns: 100 },
    );
  });

  it('每个商品专属码应正确绑定到指定商品，maxUses=1，状态为 active', async () => {
    await fc.assert(
      fc.asyncProperty(productInputArb, async (input) => {
        const client = createMockClient();
        const result = await generateProductCodes(input, client, tableName);

        for (const code of result.data!) {
          expect(code.type).toBe('product');
          expect(code.productId).toBe(input.productId);
          expect(code.maxUses).toBe(1);
          expect(code.currentUses).toBe(0);
          expect(code.status).toBe('active');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('DynamoDB 写入批次应正确分组（每批最多 25 条）', async () => {
    await fc.assert(
      fc.asyncProperty(batchInputArb, async (input) => {
        const client = createMockClient();
        await batchGeneratePointsCodes(input, client, tableName);

        const expectedBatches = Math.ceil(input.count / 25);
        expect(client.send).toHaveBeenCalledTimes(expectedBatches);

        let totalItems = 0;
        for (let i = 0; i < expectedBatches; i++) {
          const batchItems = client.send.mock.calls[i][0].input.RequestItems[tableName];
          expect(batchItems.length).toBeLessThanOrEqual(25);
          totalItems += batchItems.length;
        }
        expect(totalItems).toBe(input.count);
      }),
      { numRuns: 100 },
    );
  });
});
