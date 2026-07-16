import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseRsvp } from './feishu-api';

/**
 * Feature: rsvp-impact, Property: RSVP 文本解析健壮性
 *
 * parseRsvp 将飞书 RSVP 文本列解析为非负整数：
 * - 纯数字字符串解析为对应整数
 * - 带前后缀的数字（如 "182人"）解析为其中第一段数字
 * - 空串 / 无数字的文本返回 undefined
 * - 结果永远是 undefined 或 >= 0 的整数
 */
describe('Feature: rsvp-impact, Property: parseRsvp 健壮性', () => {
  it('非负整数字符串往返一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => {
        expect(parseRsvp(String(n))).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('数字带任意非数字后缀时，提取首段数字', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.stringMatching(/^[^0-9]*$/),
        (n, suffix) => {
          expect(parseRsvp(`${n}${suffix}`)).toBe(n);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('空串或无数字文本返回 undefined', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[^0-9]*$/), (s) => {
        expect(parseRsvp(s)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('结果永远是 undefined 或非负整数', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseRsvp(s);
        if (r !== undefined) {
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
