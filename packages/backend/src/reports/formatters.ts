// Report formatters module - CSV/Excel generation and column definitions for all report types
// See design.md for column definitions and format specifications

import * as XLSX from 'xlsx';
import type {
  PointsDetailRecord,
  UGActivitySummaryRecord,
  UserRankingRecord,
  ActivitySummaryRecord,
} from './query';
import type {
  PopularProductRecord,
  HotContentRecord,
  ContentContributorRecord,
  InventoryAlertRecord,
  TravelStatisticsRecord,
  InviteConversionRecord,
  EmployeeEngagementRecord,
} from './insight-query';

// ============================================================
// Types
// ============================================================

/** 导出格式 */
export type ExportFormat = 'csv' | 'xlsx';

/** 报表类型 */
export type ReportType =
  | 'points-detail'
  | 'ug-activity-summary'
  | 'user-points-ranking'
  | 'activity-points-summary'
  | 'popular-products'
  | 'hot-content'
  | 'content-contributors'
  | 'inventory-alert'
  | 'travel-statistics'
  | 'invite-conversion'
  | 'employee-engagement';

/** 列定义 */
export interface ColumnDef {
  key: string;
  label: string; // 中文列名
}

// ============================================================
// Column definitions
// ============================================================

const POINTS_DETAIL_COLUMNS: ColumnDef[] = [
  { key: 'createdAt', label: '时间' },
  { key: 'nickname', label: '用户昵称' },
  { key: 'amount', label: '积分数额' },
  { key: 'type', label: '类型' },
  { key: 'source', label: '来源' },
  { key: 'activityUG', label: '所属UG' },
  { key: 'activityTopic', label: '活动主题' },
  { key: 'targetRole', label: '目标身份' },
  { key: 'distributorNickname', label: '发放者昵称' },
  { key: 'isEmployee', label: '是否AWS员工' },
];

const UG_SUMMARY_COLUMNS: ColumnDef[] = [
  { key: 'ugName', label: 'UG名称' },
  { key: 'activityCount', label: '活动数量' },
  { key: 'totalPoints', label: '发放积分总额' },
  { key: 'participantCount', label: '参与人数' },
];

const USER_RANKING_COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '排名' },
  { key: 'nickname', label: '用户昵称' },
  { key: 'userId', label: '用户ID' },
  { key: 'totalEarnPoints', label: '获取积分总额' },
  { key: 'targetRole', label: '身份' },
  { key: 'isEmployee', label: '是否AWS员工' },
];

const ACTIVITY_SUMMARY_COLUMNS: ColumnDef[] = [
  { key: 'activityTopic', label: '活动主题' },
  { key: 'activityDate', label: '活动日期' },
  { key: 'activityUG', label: '所属UG' },
  { key: 'totalPoints', label: '发放积分总额' },
  { key: 'participantCount', label: '涉及人数' },
  { key: 'uglCount', label: 'UGL人数' },
  { key: 'speakerCount', label: 'Speaker人数' },
  { key: 'volunteerCount', label: 'Volunteer人数' },
];

const POPULAR_PRODUCTS_COLUMNS: ColumnDef[] = [
  { key: 'productName', label: '商品名称' },
  { key: 'productType', label: '商品类型' },
  { key: 'redemptionCount', label: '兑换次数' },
  { key: 'totalPointsSpent', label: '消耗积分总额' },
  { key: 'currentStock', label: '当前库存' },
  { key: 'stockConsumptionRate', label: '库存消耗率' },
];

const HOT_CONTENT_COLUMNS: ColumnDef[] = [
  { key: 'title', label: '标题' },
  { key: 'uploaderNickname', label: '作者昵称' },
  { key: 'categoryName', label: '分类名称' },
  { key: 'likeCount', label: '点赞数' },
  { key: 'commentCount', label: '评论数' },
  { key: 'reservationCount', label: '预约数' },
  { key: 'engagementScore', label: '互动总分' },
];

const CONTENT_CONTRIBUTORS_COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '排名' },
  { key: 'nickname', label: '用户昵称' },
  { key: 'approvedCount', label: '已审核通过内容数量' },
  { key: 'totalLikes', label: '获得总点赞数' },
  { key: 'totalComments', label: '获得总评论数' },
];

const INVENTORY_ALERT_COLUMNS: ColumnDef[] = [
  { key: 'productName', label: '商品名称' },
  { key: 'productType', label: '商品类型' },
  { key: 'currentStock', label: '当前库存' },
  { key: 'totalStock', label: '总库存' },
  { key: 'productStatus', label: '商品状态' },
];

const TRAVEL_STATISTICS_COLUMNS: ColumnDef[] = [
  { key: 'period', label: '时间周期' },
  { key: 'totalApplications', label: '申请总数' },
  { key: 'approvedCount', label: '已批准数' },
  { key: 'rejectedCount', label: '已拒绝数' },
  { key: 'pendingCount', label: '待审核数' },
  { key: 'approvalRate', label: '审批通过率' },
  { key: 'totalSponsoredAmount', label: '赞助总金额' },
];

const INVITE_CONVERSION_COLUMNS: ColumnDef[] = [
  { key: 'totalInvites', label: '邀请总数' },
  { key: 'usedCount', label: '已使用数' },
  { key: 'expiredCount', label: '已过期数' },
  { key: 'pendingCount', label: '待使用数' },
  { key: 'conversionRate', label: '转化率' },
];

const EMPLOYEE_ENGAGEMENT_COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '排名' },
  { key: 'nickname', label: '用户昵称' },
  { key: 'totalPoints', label: '积分总额' },
  { key: 'activityCount', label: '参与活动数' },
  { key: 'lastActiveTime', label: '最后活跃时间' },
  { key: 'primaryRoles', label: '主要角色' },
  { key: 'ugList', label: '参与UG列表' },
];

/** 获取报表列定义 */
export function getColumnDefs(reportType: ReportType): ColumnDef[] {
  switch (reportType) {
    case 'points-detail':
      return POINTS_DETAIL_COLUMNS;
    case 'ug-activity-summary':
      return UG_SUMMARY_COLUMNS;
    case 'user-points-ranking':
      return USER_RANKING_COLUMNS;
    case 'activity-points-summary':
      return ACTIVITY_SUMMARY_COLUMNS;
    case 'popular-products':
      return POPULAR_PRODUCTS_COLUMNS;
    case 'hot-content':
      return HOT_CONTENT_COLUMNS;
    case 'content-contributors':
      return CONTENT_CONTRIBUTORS_COLUMNS;
    case 'inventory-alert':
      return INVENTORY_ALERT_COLUMNS;
    case 'travel-statistics':
      return TRAVEL_STATISTICS_COLUMNS;
    case 'invite-conversion':
      return INVITE_CONVERSION_COLUMNS;
    case 'employee-engagement':
      return EMPLOYEE_ENGAGEMENT_COLUMNS;
  }
}

// ============================================================
// Format helpers
// ============================================================

/**
 * Format an ISO 8601 date string to YYYY-MM-DD HH:mm:ss.
 * Returns the original string if parsing fails.
 */
function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  // Convert to China time (UTC+8) for export
  const chinaTime = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${chinaTime.getUTCFullYear()}-${pad(chinaTime.getUTCMonth() + 1)}-${pad(chinaTime.getUTCDate())} ${pad(chinaTime.getUTCHours())}:${pad(chinaTime.getUTCMinutes())}:${pad(chinaTime.getUTCSeconds())}`;
}

/**
 * Map points type to Chinese label.
 */
function formatType(type: 'earn' | 'spend'): string {
  return type === 'earn' ? '获取' : '消费';
}

// ============================================================
// Format functions for each report type
// ============================================================

/** 将积分明细记录格式化为导出行 */
export function formatPointsDetailForExport(records: (PointsDetailRecord & { isEmployee?: boolean })[]): Record<string, unknown>[] {
  return records.map(r => ({
    createdAt: formatDateTime(r.createdAt),
    nickname: r.nickname,
    amount: r.amount,
    type: formatType(r.type),
    source: r.source,
    activityUG: r.activityUG,
    activityTopic: r.activityTopic,
    targetRole: r.targetRole,
    distributorNickname: r.distributorNickname,
    isEmployee: r.isEmployee === true ? '是' : '否',
  }));
}

/** 将 UG 汇总记录格式化为导出行 */
export function formatUGSummaryForExport(records: UGActivitySummaryRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    ugName: r.ugName,
    activityCount: r.activityCount,
    totalPoints: r.totalPoints,
    participantCount: r.participantCount,
  }));
}

/** 将用户排行记录格式化为导出行 */
export function formatUserRankingForExport(records: (UserRankingRecord & { isEmployee?: boolean })[]): Record<string, unknown>[] {
  return records.map(r => ({
    rank: r.rank,
    nickname: r.nickname,
    userId: r.userId,
    totalEarnPoints: r.totalEarnPoints,
    targetRole: r.targetRole,
    isEmployee: r.isEmployee === true ? '是' : '否',
  }));
}

/** 将活动汇总记录格式化为导出行 */
export function formatActivitySummaryForExport(records: ActivitySummaryRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    activityTopic: r.activityTopic,
    activityDate: r.activityDate,
    activityUG: r.activityUG,
    totalPoints: r.totalPoints,
    participantCount: r.participantCount,
    uglCount: r.uglCount,
    speakerCount: r.speakerCount,
    volunteerCount: r.volunteerCount,
  }));
}

// ============================================================
// Format functions for new insight report types
// ============================================================

/**
 * Map productType to Chinese label.
 */
function formatProductType(type: 'points' | 'code_exclusive'): string {
  return type === 'points' ? '积分商品' : 'Code 专属商品';
}

/**
 * Format a number as a percentage string with one decimal place: "XX.X%"
 */
function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** 将人气商品排行记录格式化为导出行 */
export function formatPopularProductsForExport(records: PopularProductRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    productName: r.productName,
    productType: formatProductType(r.productType),
    redemptionCount: r.redemptionCount,
    totalPointsSpent: r.totalPointsSpent,
    currentStock: r.currentStock,
    stockConsumptionRate: formatPercentage(r.stockConsumptionRate),
  }));
}

/** 将热门内容排行记录格式化为导出行 */
export function formatHotContentForExport(records: HotContentRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    title: r.title,
    uploaderNickname: r.uploaderNickname,
    categoryName: r.categoryName,
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    reservationCount: r.reservationCount,
    engagementScore: r.engagementScore,
  }));
}

/** 将内容贡献者排行记录格式化为导出行 */
export function formatContentContributorsForExport(records: ContentContributorRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    rank: r.rank,
    nickname: r.nickname,
    approvedCount: r.approvedCount,
    totalLikes: r.totalLikes,
    totalComments: r.totalComments,
  }));
}

/** 将库存预警记录格式化为导出行 */
export function formatInventoryAlertForExport(records: InventoryAlertRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    productName: r.productName,
    productType: formatProductType(r.productType),
    currentStock: r.sizeOptions && r.sizeOptions.length > 0
      ? r.sizeOptions.map(opt => `${opt.name}:${opt.stock}`).join(' / ')
      : r.currentStock,
    totalStock: r.totalStock,
    productStatus: r.productStatus === 'active' ? '上架中' : '已下架',
  }));
}

/** 将差旅申请统计记录格式化为导出行 */
export function formatTravelStatisticsForExport(records: TravelStatisticsRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    period: r.period,
    totalApplications: r.totalApplications,
    approvedCount: r.approvedCount,
    rejectedCount: r.rejectedCount,
    pendingCount: r.pendingCount,
    approvalRate: formatPercentage(r.approvalRate),
    totalSponsoredAmount: r.totalSponsoredAmount,
  }));
}

/** 将邀请转化率记录格式化为导出行 */
export function formatInviteConversionForExport(records: InviteConversionRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    totalInvites: r.totalInvites,
    usedCount: r.usedCount,
    expiredCount: r.expiredCount,
    pendingCount: r.pendingCount,
    conversionRate: formatPercentage(r.conversionRate),
  }));
}

/** 将活跃员工记录格式化为导出行 */
export function formatEmployeeEngagementForExport(records: EmployeeEngagementRecord[]): Record<string, unknown>[] {
  return records.map(r => ({
    rank: r.rank,
    nickname: r.nickname,
    totalPoints: r.totalPoints,
    activityCount: r.activityCount,
    lastActiveTime: formatDateTime(r.lastActiveTime),
    primaryRoles: r.primaryRoles,
    ugList: r.ugList,
  }));
}

// ============================================================
// CSV generation
// ============================================================

/**
 * Escape a CSV field value.
 * If the value contains commas, double quotes, or newlines, wrap it in double quotes
 * and escape any internal double quotes by doubling them.
 */
function escapeCSVField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 生成 CSV Buffer（UTF-8 BOM + 逗号分隔） */
export function generateCSV(records: Record<string, unknown>[], columns: ColumnDef[]): Buffer {
  const BOM = '\uFEFF';

  // Header row with Chinese column names
  const header = columns.map(c => escapeCSVField(c.label)).join(',');

  // Data rows
  const rows = records.map(record =>
    columns.map(c => escapeCSVField(record[c.key])).join(','),
  );

  const csvContent = BOM + [header, ...rows].join('\r\n');
  return Buffer.from(csvContent, 'utf-8');
}

// ============================================================
// Excel generation
// ============================================================

/** 生成 Excel Buffer（使用 SheetJS xlsx 库） */
export function generateExcel(
  records: Record<string, unknown>[],
  columns: ColumnDef[],
  sheetName: string = '报表数据',
): Buffer {
  // Build array-of-arrays: header + data rows
  const headerRow = columns.map(c => c.label);
  const dataRows = records.map(record =>
    columns.map(c => {
      const val = record[c.key];
      return val === undefined || val === null ? '' : val;
    }),
  );

  const aoa = [headerRow, ...dataRows];

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Bold header row styling
  const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col });
    if (ws[cellAddr]) {
      if (!ws[cellAddr].s) ws[cellAddr].s = {};
      ws[cellAddr].s = { font: { bold: true } };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Write to buffer
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(xlsxBuffer);
}
