import { describe, it, expect } from 'vitest';
import { validatePassword } from './validators';

describe('validatePassword', () => {
  it('should accept a valid password with letters and digits (≥8 chars)', () => {
    const result = validatePassword('abcdef12');
    expect(result.valid).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('should reject passwords shorter than 8 characters', () => {
    const result = validatePassword('abc1');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('8');
  });

  it('should reject passwords with only letters (no digits)', () => {
    const result = validatePassword('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('数字');
  });

  it('should reject passwords with only digits (no letters)', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('字母');
  });

  it('should accept passwords with mixed case and digits', () => {
    expect(validatePassword('Password1').valid).toBe(true);
  });

  it('should accept passwords with special characters if letters and digits present', () => {
    expect(validatePassword('p@ssw0rd!').valid).toBe(true);
  });

  it('should reject empty string', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
  });
});
