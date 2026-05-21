import type { WishStatus } from '@points-mall/shared';

/**
 * 许愿标题校验：trim 后长度 1-50
 */
export function validateWishTitle(title: string): boolean {
  const len = title.trim().length;
  return len >= 1 && len <= 50;
}

/**
 * 许愿描述校验：trim 后长度 1-500
 */
export function validateWishDescription(desc: string): boolean {
  const len = desc.trim().length;
  return len >= 1 && len <= 500;
}

/**
 * 关闭原因校验：trim 后长度 1-200
 */
export function validateCloseReason(reason: string): boolean {
  const len = reason.trim().length;
  return len >= 1 && len <= 200;
}

/**
 * 许愿状态合法转换映射
 * - pending → approved | closed
 * - approved → adopted | closed
 * - adopted → fulfilled | closed
 * - fulfilled → (终态，无后续转换)
 * - closed → (终态，无后续转换)
 */
export const VALID_STATUS_TRANSITIONS: Record<WishStatus, WishStatus[]> = {
  pending: ['approved', 'closed'],
  approved: ['adopted', 'closed'],
  adopted: ['fulfilled', 'closed'],
  fulfilled: [],
  closed: [],
};

/**
 * 判断状态转换是否合法
 */
export function isValidStatusTransition(current: WishStatus, target: WishStatus): boolean {
  return VALID_STATUS_TRANSITIONS[current]?.includes(target) ?? false;
}
