import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * 验证密码是否符合规则：
 * - 至少 8 位
 * - 包含至少一个字母 (a-z 或 A-Z)
 * - 包含至少一个数字 (0-9)
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return {
      valid: false,
      message: '密码长度至少为8位',
    };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return {
      valid: false,
      message: '密码必须包含至少一个字母',
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: '密码必须包含至少一个数字',
    };
  }

  return { valid: true };
}
