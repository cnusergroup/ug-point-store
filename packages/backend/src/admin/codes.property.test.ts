import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  batchGeneratePointsCodes,
  generateProductCodes,
  validateCandidateProducts,
  MAX_CANDIDATE_PRODUCTS,
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

// Feature: code-user-email-distribution, Property 2: 候选集合校验
// validateCandidateProducts 通过当且仅当候选列表全部存在且 active 的 code_exclusive 商品，
// 且数量为 1–10 且无重复。否则按以下顺序返回对应错误码：
//   1. 空列表                              -> INVALID_PRODUCT_SELECTION
//   2. 长度 > 10                           -> TOO_MANY_PRODUCTS
//   3. 含重复标识符                         -> DUPLICATE_PRODUCT
//   4. 含已存在但非 code_exclusive 的商品    -> INVALID_PRODUCT_TYPE
//   5. 含不存在或非 active(已下架) 的商品     -> INVALID_PRODUCT_SELECTION
// Validates: Requirements 1.6, 1.7, 1.8, 1.9, 8.2

const productsTable = 'Products';

type ProductRecord = {
  productId: string;
  name: string;
  type: string;
  status: string;
};

/**
 * Build a mock DynamoDBDocumentClient whose `send` resolves BatchGetCommand
 * against the provided product catalog (only existing products are returned).
 */
function createMockClientWithCatalog(catalog: Map<string, ProductRecord>) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const keys: Array<{ productId: string }> =
        cmd.input.RequestItems[productsTable].Keys;
      // DynamoDB dedupes keys; emulate by returning each existing product once.
      const seen = new Set<string>();
      const items: ProductRecord[] = [];
      for (const { productId } of keys) {
        if (seen.has(productId)) continue;
        seen.add(productId);
        const product = catalog.get(productId);
        if (product) items.push(product);
      }
      return Promise.resolve({ Responses: { [productsTable]: items } });
    }),
  } as any;
}

/** Reference implementation of the expected validation outcome. */
function predictErrorCode(
  productIds: string[],
  catalog: Map<string, ProductRecord>,
): string | null {
  if (productIds.length === 0) return 'INVALID_PRODUCT_SELECTION';
  if (productIds.length > MAX_CANDIDATE_PRODUCTS) return 'TOO_MANY_PRODUCTS';
  if (new Set(productIds).size !== productIds.length) return 'DUPLICATE_PRODUCT';
  for (const id of productIds) {
    const product = catalog.get(id);
    if (product && product.type !== 'code_exclusive') return 'INVALID_PRODUCT_TYPE';
  }
  for (const id of productIds) {
    const product = catalog.get(id);
    if (!product || product.status !== 'active') return 'INVALID_PRODUCT_SELECTION';
  }
  return null; // valid
}

const kindArb = fc.constantFrom('valid', 'wrongType', 'inactive', 'missing');

/**
 * Generate a candidate scenario: an ordered productIds list (optionally with an
 * injected duplicate) plus the product catalog that backs the mocked table read.
 * kinds length up to 12 so the >10 (TOO_MANY_PRODUCTS) branch is exercised.
 */
const scenarioArb = fc
  .record({
    kinds: fc.array(kindArb, { minLength: 1, maxLength: 12 }),
    addDuplicate: fc.boolean(),
  })
  .map(({ kinds, addDuplicate }) => {
    const baseIds = kinds.map((_, i) => `p${i}`);
    const catalog = new Map<string, ProductRecord>();
    kinds.forEach((kind, i) => {
      const productId = baseIds[i];
      const name = `Product ${i}`;
      if (kind === 'valid') {
        catalog.set(productId, { productId, name, type: 'code_exclusive', status: 'active' });
      } else if (kind === 'wrongType') {
        catalog.set(productId, { productId, name, type: 'physical', status: 'active' });
      } else if (kind === 'inactive') {
        catalog.set(productId, { productId, name, type: 'code_exclusive', status: 'inactive' });
      }
      // 'missing' -> intentionally not added to the catalog
    });
    const productIds = addDuplicate ? [...baseIds, baseIds[0]] : baseIds;
    return { productIds, catalog };
  });

describe('Property 2: 候选集合校验', () => {
  it('通过当且仅当全部存在且 active 的 code_exclusive 且 1–10 无重复，否则返回对应错误码', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ productIds, catalog }) => {
        const client = createMockClientWithCatalog(catalog);
        const result = await validateCandidateProducts(productIds, client, productsTable);

        const expectedCode = predictErrorCode(productIds, catalog);
        if (expectedCode === null) {
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
          // products preserve input order with correct names
          expect(result.products).toHaveLength(productIds.length);
          result.products!.forEach((p, idx) => {
            expect(p.productId).toBe(productIds[idx]);
            expect(p.name).toBe(catalog.get(productIds[idx])!.name);
          });
        } else {
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe(expectedCode);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('空候选列表返回 INVALID_PRODUCT_SELECTION 且不读取商品表', async () => {
    const client = createMockClientWithCatalog(new Map());
    const result = await validateCandidateProducts([], client, productsTable);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_PRODUCT_SELECTION');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('超过 10 个候选返回 TOO_MANY_PRODUCTS 且不读取商品表', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_CANDIDATE_PRODUCTS + 1, max: 30 }),
        async (n) => {
          const productIds = Array.from({ length: n }, (_, i) => `p${i}`);
          const client = createMockClientWithCatalog(new Map());
          const result = await validateCandidateProducts(productIds, client, productsTable);
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe('TOO_MANY_PRODUCTS');
          expect(client.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('含重复标识符返回 DUPLICATE_PRODUCT 且不读取商品表', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.integer({ min: 0, max: 8 }), { minLength: 2, maxLength: 9 })
          .map((nums) => nums.map((x) => `p${x}`))
          .filter((ids) => new Set(ids).size !== ids.length),
        async (productIds) => {
          const catalog = new Map<string, ProductRecord>();
          for (const id of productIds) {
            catalog.set(id, { productId: id, name: id, type: 'code_exclusive', status: 'active' });
          }
          const client = createMockClientWithCatalog(catalog);
          const result = await validateCandidateProducts(productIds, client, productsTable);
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe('DUPLICATE_PRODUCT');
          expect(client.send).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
