/**
 * 员工活动参与度查询：导出格式/列定义/大小限制模块。
 *
 * 所有函数均为纯函数，不涉及任何 I/O，便于属性测试。
 * CSV/Excel 文件生成复用 `reports/formatters.ts` 中的既有实现（`generateCSV`/`generateExcel`），
 * 在 `export.ts`（任务 12.5）中直接引用，本文件不重复实现。
 */

import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

/** 五类查询视图 */
export type ParticipationView =
  | 'speaker-support'
  | 'volunteer-support'
  | 'total-count'
  | 'employee-activity-detail'
  | 'activity-detail';

/** 导出格式 */
export type ExportFormat = 'csv' | 'xlsx';

/** 导出列定义 */
export interface ParticipationColumnDef {
  key: string;
  label: string;
}

export interface ValidateExportFormatResult {
  valid: boolean;
  error?: { code: string; message: string };
}

/**
 * 校验导出格式：仅 `'csv'` | `'xlsx'` 合法。
 * Requirement 13.2。
 */
export function validateExportFormat(format: unknown): ValidateExportFormatResult {
  if (format === 'csv' || format === 'xlsx') {
    return { valid: true };
  }

  return {
    valid: false,
    error: {
      code: ErrorCodes.QUERY_INVALID_EXPORT_FORMAT,
      message: ErrorMessages[ErrorCodes.QUERY_INVALID_EXPORT_FORMAT],
    },
  };
}

// ============================================================
// 导出列定义（顺序即导出顺序，参照设计文档"导出列定义"表格）
// ============================================================

const SPEAKER_SUPPORT_COLUMNS: ParticipationColumnDef[] = [
  { key: 'nickname', label: '花名' },
  { key: 'email', label: '邮箱' },
  { key: 'supportCount', label: 'Speaker 支持次数' },
];

const VOLUNTEER_SUPPORT_COLUMNS: ParticipationColumnDef[] = [
  { key: 'nickname', label: '花名' },
  { key: 'email', label: '邮箱' },
  { key: 'supportCount', label: '志愿者支持次数' },
];

const TOTAL_COUNT_COLUMNS: ParticipationColumnDef[] = [
  { key: 'nickname', label: '花名' },
  { key: 'email', label: '邮箱' },
  { key: 'totalCount', label: '总次数' },
];

const EMPLOYEE_ACTIVITY_DETAIL_COLUMNS: ParticipationColumnDef[] = [
  { key: 'nickname', label: '花名' },
  { key: 'email', label: '邮箱' },
  { key: 'totalActivityCount', label: '支持活动总数' },
  { key: 'activitiesFormatted', label: '支持活动明细' },
];

const ACTIVITY_DETAIL_COLUMNS: ParticipationColumnDef[] = [
  { key: 'topic', label: '活动主题' },
  { key: 'ugName', label: '所属UG' },
  { key: 'activityDate', label: '活动日期' },
  { key: 'employeesFormatted', label: '参与员工' },
];

/**
 * 获取指定视图的固定导出列定义（顺序即导出顺序），与视图页面展示字段一致，
 * 不含导出时间戳、操作者身份等额外列。
 * Requirement 13.6。
 */
export function getColumnDefs(view: ParticipationView): ParticipationColumnDef[] {
  switch (view) {
    case 'speaker-support':
      return SPEAKER_SUPPORT_COLUMNS;
    case 'volunteer-support':
      return VOLUNTEER_SUPPORT_COLUMNS;
    case 'total-count':
      return TOTAL_COUNT_COLUMNS;
    case 'employee-activity-detail':
      return EMPLOYEE_ACTIVITY_DETAIL_COLUMNS;
    case 'activity-detail':
      return ACTIVITY_DETAIL_COLUMNS;
  }
}

export interface CheckExportSizeLimitResult {
  allowed: boolean;
  error?: { code: string; message: string };
}

/** 导出记录数上限 */
export const EXPORT_SIZE_LIMIT = 50_000;

/**
 * 校验待导出记录数是否超过上限（50,000）。超过则拒绝并返回大小提示错误。
 * Requirement 13.5。
 */
export function checkExportSizeLimit(count: number): CheckExportSizeLimitResult {
  if (count <= EXPORT_SIZE_LIMIT) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: {
      code: ErrorCodes.QUERY_EXPORT_LIMIT_EXCEEDED,
      message: ErrorMessages[ErrorCodes.QUERY_EXPORT_LIMIT_EXCEEDED],
    },
  };
}
