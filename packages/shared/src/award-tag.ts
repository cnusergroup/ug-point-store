// ============================================================
// 奖项标签（AwardTag）— 纯函数辅助
//
// 本文件提供 AwardTag 名的归一化与校验**纯函数**，前后端共用：
//   - 后端：`packages/backend/src/admin/award-tags.ts` 重导出 +
//           `executeSpecialActivityDistribution` 入参校验、handler 路由、PBT
//   - 前端：`packages/frontend/src/components/AwardTagPicker/` 实时校验
//
// 与 ContentTags（types.ts 中的 `normalizeTagName`）的差别：
//   - ContentTags：trim + toLowerCase（不折叠空白）
//   - AwardTag：   trim + 折叠中间连续空白为单个空格 + toLowerCase
// 因为差异显著且需要前后端一致，这里独立命名为 `normalizeAwardTagName`
// 以避免与已有 `normalizeTagName` 冲突（design.md / requirements 14.8）。
// ============================================================

import { AWARD_TAG_FORBIDDEN_CHARS, AWARD_TAG_MAX_LENGTH } from './types';

/** 归一化后允许的最小长度 */
const AWARD_TAG_MIN_LENGTH = 1;

/**
 * 用于快速判定单个字符是否属于禁止集合。
 * 共享常量 AWARD_TAG_FORBIDDEN_CHARS 来自 ./types。
 */
const FORBIDDEN_CHARS_SET: ReadonlySet<string> = new Set(
  AWARD_TAG_FORBIDDEN_CHARS.split(''),
);

/**
 * 允许字符的白名单：
 *  - 中文（CJK 统一表意文字 \u4e00-\u9fff）
 *  - 英文大小写
 *  - 数字
 *  - 半角空格
 * 注意：归一化后所有连续空白已折叠为单个半角空格，且全部小写。
 */
const ALLOWED_CHARS_REGEX = /^[\u4e00-\u9fffA-Za-z0-9 ]+$/;

/**
 * 归一化奖项标签名。
 *
 * 规则：
 *  1. 去除首尾空白（含全角空白经 `\s` 匹配的部分）
 *  2. 将中间一个或多个连续空白字符折叠为单个半角空格
 *  3. 转为小写
 *
 * 该规则用于 GSI `tagName-index` 的稳定查询键，前后端共用同一规则
 * 确保等价匹配（design.md 14.8）。
 *
 * @param s 任意输入字符串
 * @returns 归一化后的 tagName
 */
export function normalizeAwardTagName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** validateAwardTagName 返回结构 */
export interface AwardTagValidationResult {
  valid: boolean;
  /** 失败时的错误码（与 handler 错误码对齐，便于直接透传到 HTTP 响应） */
  code?: string;
  /** 失败时的人类可读消息 */
  message?: string;
}

/**
 * 校验奖项标签名是否合法。
 *
 * 完备性：返回 `valid: true` 当且仅当 `normalizeAwardTagName(s)` 同时满足
 *  (a) 长度落在 [1, 30]
 *  (b) 不包含禁止符号集合 `<>"'/\\|*?:&` 中的任何字符
 *  (c) 仅由中文 / 英文（含大小写）/ 数字 / 空格组成
 *
 * @param s 用户原始输入（未归一化）
 * @returns AwardTagValidationResult
 */
export function validateAwardTagName(s: string): AwardTagValidationResult {
  if (typeof s !== 'string') {
    return {
      valid: false,
      code: 'INVALID_REQUEST',
      message: 'awardTagName 必填',
    };
  }

  const normalized = normalizeAwardTagName(s);

  if (
    normalized.length < AWARD_TAG_MIN_LENGTH ||
    normalized.length > AWARD_TAG_MAX_LENGTH
  ) {
    return {
      valid: false,
      code: 'INVALID_REQUEST',
      message: '奖项标签长度必须为 1~30 个字符',
    };
  }

  for (const ch of normalized) {
    if (FORBIDDEN_CHARS_SET.has(ch)) {
      return {
        valid: false,
        code: 'INVALID_REQUEST',
        message: '奖项标签包含非法字符',
      };
    }
  }

  if (!ALLOWED_CHARS_REGEX.test(normalized)) {
    return {
      valid: false,
      code: 'INVALID_REQUEST',
      message: '奖项标签包含非法字符',
    };
  }

  return { valid: true };
}
