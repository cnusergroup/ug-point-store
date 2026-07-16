import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

export interface NicknameValidationResult {
  valid: boolean;
  trimmed: string;
  error?: { code: string; message: string };
}

/**
 * 验证昵称格式（固定顺序）：
 * 1. Trim → 空值检查 → NICKNAME_EMPTY
 * 2. Unicode 码点长度 > 20 → NICKNAME_TOO_LONG
 * 3. 包含控制字符 → NICKNAME_INVALID_CHARS
 *
 * 返回第一个失败的验证错误；全部通过则返回 { valid: true, trimmed }
 */
export function validateNickname(nickname: string): NicknameValidationResult {
  const trimmed = nickname.trim();

  // Step 1: Empty check
  if (trimmed.length === 0) {
    return {
      valid: false,
      trimmed,
      error: { code: ErrorCodes.NICKNAME_EMPTY, message: ErrorMessages[ErrorCodes.NICKNAME_EMPTY] },
    };
  }

  // Step 2: Length check (Unicode codepoints)
  if ([...trimmed].length > 20) {
    return {
      valid: false,
      trimmed,
      error: { code: ErrorCodes.NICKNAME_TOO_LONG, message: ErrorMessages[ErrorCodes.NICKNAME_TOO_LONG] },
    };
  }

  // Step 3: Control characters check
  if (/[\x00-\x1F\x7F\u0080-\u009F]/.test(trimmed)) {
    return {
      valid: false,
      trimmed,
      error: { code: ErrorCodes.NICKNAME_INVALID_CHARS, message: ErrorMessages[ErrorCodes.NICKNAME_INVALID_CHARS] },
    };
  }

  return { valid: true, trimmed };
}
