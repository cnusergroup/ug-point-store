import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveCandidateIds } from './code-redemption';

// Feature: code-user-email-distribution, Property 3: 候选集合解析向后兼容
// For any 兑换码记录，候选集合解析 `productIds ?? (productId ? [productId] : [])`
// SHALL 对仅含 `productId` 的旧记录返回 `[productId]`，对含 `productIds` 的新记录返回
// `productIds`，使旧单商品码与新多候选码在兑换与展示逻辑中行为一致。
// Validates: Requirements 1.10

const productIdArb = fc.string({ minLength: 1, maxLength: 30 });

describe('Property 3: 候选集合解析向后兼容', () => {
  it('旧记录（仅 productId）返回 [productId]', () => {
    fc.assert(
      fc.property(productIdArb, (productId) => {
        const result = resolveCandidateIds({ productId });
        expect(result).toEqual([productId]);
      }),
      { numRuns: 100 },
    );
  });

  it('新记录（含 productIds）返回 productIds 本身', () => {
    fc.assert(
      fc.property(
        fc.array(productIdArb, { minLength: 1, maxLength: 10 }),
        productIdArb,
        (productIds, legacyProductId) => {
          // Even when a legacy productId is also present, productIds takes precedence.
          const result = resolveCandidateIds({ productIds, productId: legacyProductId });
          expect(result).toEqual(productIds);
          // productIds resolves to itself when there is no legacy productId either.
          expect(resolveCandidateIds({ productIds })).toEqual(productIds);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('空记录（无 productId 且无 productIds）返回 []', () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        expect(resolveCandidateIds({})).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
