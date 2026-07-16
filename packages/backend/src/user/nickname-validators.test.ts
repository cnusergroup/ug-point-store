import { describe, it, expect } from 'vitest';
import { validateNickname } from './nickname-validators';

describe('validateNickname', () => {
  it('should reject empty string with NICKNAME_EMPTY', () => {
    const result = validateNickname('');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('NICKNAME_EMPTY');
  });

  it('should reject whitespace-only string with NICKNAME_EMPTY', () => {
    const result = validateNickname('   ');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('NICKNAME_EMPTY');
  });

  it('should accept exactly 20 characters as valid', () => {
    const result = validateNickname('A'.repeat(20));
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject 21 characters with NICKNAME_TOO_LONG', () => {
    const result = validateNickname('A'.repeat(21));
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('NICKNAME_TOO_LONG');
  });

  it('should accept emoji characters as valid', () => {
    const result = validateNickname('😀🎉👍');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.trimmed).toBe('😀🎉👍');
  });

  it('should reject control character \\n with NICKNAME_INVALID_CHARS', () => {
    const result = validateNickname('hello\nworld');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('NICKNAME_INVALID_CHARS');
  });

  it('should return NICKNAME_EMPTY for tab-only input (first rule wins after trim)', () => {
    // \t is a control char, but trim removes it first → empty → NICKNAME_EMPTY
    const result = validateNickname('\t');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('NICKNAME_EMPTY');
  });
});
