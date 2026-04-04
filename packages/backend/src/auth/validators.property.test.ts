import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePassword } from './validators';

// Feature: points-mall, Property 1: 密码验证规则
// 对于任何密码字符串，如果其长度少于 8 位或不同时包含字母和数字，则注册请求应被拒绝；
// 反之，如果密码满足规则（≥8 位且包含字母和数字），则密码验证应通过。
// Validates: Requirements 1.7

const letterArb = fc.mapToConstant(
  { num: 26, build: (v) => String.fromCharCode(97 + v) },  // a-z
  { num: 26, build: (v) => String.fromCharCode(65 + v) }   // A-Z
);

const digitArb = fc.mapToConstant(
  { num: 10, build: (v) => String.fromCharCode(48 + v) }   // 0-9
);

/** Reference implementation: returns true if password meets all rules */
function shouldBeValid(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

describe('Property 1: 密码验证规则', () => {
  it('长度少于 8 位的密码应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 7 }),
        (password) => {
          expect(validatePassword(password).valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('纯字母密码（≥8 位）应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64, unit: letterArb }),
        (password) => {
          expect(validatePassword(password).valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('纯数字密码（≥8 位）应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64, unit: digitArb }),
        (password) => {
          expect(validatePassword(password).valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('符合规则的密码（≥8 位，含字母和数字）应通过验证', () => {
    const validPasswordArb = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 30, unit: letterArb }),
        fc.string({ minLength: 1, maxLength: 30, unit: digitArb }),
        fc.string({ minLength: 0, maxLength: 30 })
      )
      .map(([letters, digits, extra]) => letters + digits + extra)
      .filter((pw) => pw.length >= 8);

    fc.assert(
      fc.property(validPasswordArb, (password) => {
        expect(validatePassword(password).valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('validatePassword 的结果应与参考实现一致（对任意字符串）', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 128 }),
        (password) => {
          expect(validatePassword(password).valid).toBe(shouldBeValid(password));
        }
      ),
      { numRuns: 200 }
    );
  });
});
