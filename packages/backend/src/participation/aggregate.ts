/**
 * 员工活动参与度查询：聚合模块。
 *
 * 所有函数均为纯函数，输入是已从 DynamoDB 取出并与 Users/Activities 表关联好的
 * 内存数据结构，不涉及任何 I/O，便于属性测试。
 */

import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

/** Speaker/志愿者支持角色 */
export type SupportRole = 'Speaker' | 'Volunteer';

/** 从 PointsRecords / BatchDistributions 归一化出的支持记录 */
export interface SupportRecord {
  userId: string;
  activityId: string;
  targetRole: SupportRole;
}

/** Users 表当前状态的最小投影（查询时刻的当前值） */
export interface EmployeeDirectoryEntry {
  nickname: string;
  email: string;
  isEmployee: boolean;
}

/** Activities 表的最小投影 */
export interface ActivityMeta {
  topic: string;
  ugName: string;
  activityDate: string; // YYYY-MM-DD
}

export interface SupportCountRow {
  userId: string;
  nickname: string;
  email: string;
  supportCount: number;
}

/** 员工总次数视图的一行：某位员工 Speaker 与志愿者身份合并去重（按 activityId）后的活动总数 */
export interface TotalCountRow {
  userId: string;
  nickname: string;
  email: string;
  totalCount: number;
}

/** 单条员工支持活动明细中的一个活动项 */
export interface EmployeeActivityDetailItem {
  activityId: string;
  topic: string;
  ugName: string;
  activityDate: string;
  roles: SupportRole[]; // 1 或 2 个元素，无重复
}

/** 员工支持活动明细视图的一行：某位员工及其支持过的全部活动列表 */
export interface EmployeeActivityDetailRow {
  userId: string;
  nickname: string;
  email: string;
  activities: EmployeeActivityDetailItem[]; // 按 activityDate 降序排列
}

/**
 * 仅保留关联用户当前 isEmployee===true 且账号仍存在于 directory 中的记录。
 *
 * Requirement 12.1, 12.2。
 */
export function filterCurrentEmployeeRecords(
  records: SupportRecord[],
  directory: Map<string, EmployeeDirectoryEntry>,
): SupportRecord[] {
  return records.filter((record) => {
    const entry = directory.get(record.userId);
    return entry !== undefined && entry.isEmployee === true;
  });
}

export interface ActivityDetailEmployee {
  userId: string;
  nickname: string;
  email: string;
  roles: SupportRole[]; // 1 或 2 个元素，无重复
}

export interface ActivityDetailRow {
  activityId: string;
  topic: string;
  ugName: string;
  activityDate: string;
  employees: ActivityDetailEmployee[]; // 按 nickname 字母顺序排列
}

export interface PaginatedActivities {
  items: ActivityDetailRow[];
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
}

const DEFAULT_ACTIVITY_PAGE_SIZE = 50;
const MAX_ACTIVITY_PAGE_SIZE = 50;

/**
 * 按角色聚合支持次数：按 userId 分组，按 activityId 去重计数。
 * 仅返回 count >= 1 的员工。Requirement 6, 7 通用实现（role 参数化）。
 *
 * 注意：调用方应先经过 filterCurrentEmployeeRecords 过滤，但本函数本身也会
 * 再次校验 directory 中的 isEmployee 状态，防止误用时统计到非员工数据。
 */
export function aggregateSupportCount(
  records: SupportRecord[],
  role: SupportRole,
  directory: Map<string, EmployeeDirectoryEntry>,
): SupportCountRow[] {
  const activityIdsByUser = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.targetRole !== role) continue;

    const entry = directory.get(record.userId);
    if (!entry || entry.isEmployee !== true) continue;

    let activityIds = activityIdsByUser.get(record.userId);
    if (!activityIds) {
      activityIds = new Set<string>();
      activityIdsByUser.set(record.userId, activityIds);
    }
    activityIds.add(record.activityId);
  }

  const rows: SupportCountRow[] = [];
  for (const [userId, activityIds] of activityIdsByUser) {
    const supportCount = activityIds.size;
    if (supportCount < 1) continue;

    const entry = directory.get(userId);
    if (!entry) continue;

    rows.push({
      userId,
      nickname: entry.nickname,
      email: entry.email,
      supportCount,
    });
  }

  // 按支持次数降序排列，次数相同时按花名升序排列（保证结果顺序稳定）
  rows.sort((a, b) => b.supportCount - a.supportCount || a.nickname.localeCompare(b.nickname));

  return rows;
}

/**
 * 按用户合并 Speaker 与 Volunteer 的 activityId 集合后去重计数（同一活动下
 * 两种身份都参与只计 1 次）。仅返回 totalCount >= 1 的员工。
 *
 * 注意：调用方应先经过 filterCurrentEmployeeRecords 过滤，但本函数本身也会
 * 再次校验 directory 中的 isEmployee 状态，防止误用时统计到非员工数据。
 */
export function aggregateTotalCount(
  records: SupportRecord[],
  directory: Map<string, EmployeeDirectoryEntry>,
): TotalCountRow[] {
  const activityIdsByUser = new Map<string, Set<string>>();

  for (const record of records) {
    const entry = directory.get(record.userId);
    if (!entry || entry.isEmployee !== true) continue;

    let activityIds = activityIdsByUser.get(record.userId);
    if (!activityIds) {
      activityIds = new Set<string>();
      activityIdsByUser.set(record.userId, activityIds);
    }
    activityIds.add(record.activityId);
  }

  const rows: TotalCountRow[] = [];
  for (const [userId, activityIds] of activityIdsByUser) {
    const totalCount = activityIds.size;
    if (totalCount < 1) continue;

    const entry = directory.get(userId);
    if (!entry) continue;

    rows.push({
      userId,
      nickname: entry.nickname,
      email: entry.email,
      totalCount,
    });
  }

  // 按总次数降序排列，次数相同时按花名升序排列（保证结果顺序稳定）
  rows.sort((a, b) => b.totalCount - a.totalCount || a.nickname.localeCompare(b.nickname));

  return rows;
}

/**
 * 按用户聚合其支持过的全部活动明细（Speaker 与 Volunteer 身份合并，同一活动下
 * 两种身份都参与时该活动的 roles 包含两者）。仅返回至少支持过 1 个活动的员工，
 * 每位员工的 activities 按 activityDate 降序排列。
 *
 * 记录的 activityId 若在 activityMeta 中找不到对应元数据，该活动会被跳过
 * （无法在没有主题/UG/日期信息的情况下构造一个有效的活动项）。
 *
 * Requirement 8。
 */
export function aggregateEmployeeActivityDetail(
  records: SupportRecord[],
  directory: Map<string, EmployeeDirectoryEntry>,
  activityMeta: Map<string, ActivityMeta>,
): EmployeeActivityDetailRow[] {
  // userId -> activityId -> Set<SupportRole>
  const rolesByUserAndActivity = new Map<string, Map<string, Set<SupportRole>>>();

  for (const record of records) {
    const entry = directory.get(record.userId);
    if (!entry || entry.isEmployee !== true) continue;

    const meta = activityMeta.get(record.activityId);
    if (!meta) continue;

    let activityRolesMap = rolesByUserAndActivity.get(record.userId);
    if (!activityRolesMap) {
      activityRolesMap = new Map<string, Set<SupportRole>>();
      rolesByUserAndActivity.set(record.userId, activityRolesMap);
    }

    let roleSet = activityRolesMap.get(record.activityId);
    if (!roleSet) {
      roleSet = new Set<SupportRole>();
      activityRolesMap.set(record.activityId, roleSet);
    }
    roleSet.add(record.targetRole);
  }

  const rows: EmployeeActivityDetailRow[] = [];

  for (const [userId, activityRolesMap] of rolesByUserAndActivity) {
    if (activityRolesMap.size === 0) continue;

    const entry = directory.get(userId);
    if (!entry) continue;

    const activities: EmployeeActivityDetailItem[] = [];
    for (const [activityId, roleSet] of activityRolesMap) {
      const meta = activityMeta.get(activityId);
      if (!meta) continue;

      activities.push({
        activityId,
        topic: meta.topic,
        ugName: meta.ugName,
        activityDate: meta.activityDate,
        roles: Array.from(roleSet),
      });
    }

    if (activities.length === 0) continue;

    activities.sort((a, b) => b.activityDate.localeCompare(a.activityDate));

    rows.push({
      userId,
      nickname: entry.nickname,
      email: entry.email,
      activities,
    });
  }

  // 按支持活动总数（去重后）降序排列，次数相同时按花名升序排列（保证结果顺序稳定）
  rows.sort((a, b) => b.activities.length - a.activities.length || a.nickname.localeCompare(b.nickname));

  return rows;
}

/**
 * 按活动聚合参与员工及身份。仅返回员工列表非空的活动，
 * 活动按 activityDate 降序排列，每个活动的员工按 nickname 升序排列。
 *
 * Requirement 9.1, 9.2, 9.3, 9.4。
 *
 * 注意：records 中的 activityId 若在 activityMeta 中找不到对应的元数据，
 * 该记录会被跳过（无法在没有主题/UG/日期信息的情况下构造一个有效的活动行）。
 */
export function aggregateActivityDetail(
  records: SupportRecord[],
  directory: Map<string, EmployeeDirectoryEntry>,
  activityMeta: Map<string, ActivityMeta>,
): ActivityDetailRow[] {
  // activityId -> userId -> Set<SupportRole>
  const rolesByActivityAndUser = new Map<string, Map<string, Set<SupportRole>>>();

  for (const record of records) {
    const entry = directory.get(record.userId);
    if (!entry || entry.isEmployee !== true) continue;

    const meta = activityMeta.get(record.activityId);
    if (!meta) continue;

    let userRolesMap = rolesByActivityAndUser.get(record.activityId);
    if (!userRolesMap) {
      userRolesMap = new Map<string, Set<SupportRole>>();
      rolesByActivityAndUser.set(record.activityId, userRolesMap);
    }

    let roleSet = userRolesMap.get(record.userId);
    if (!roleSet) {
      roleSet = new Set<SupportRole>();
      userRolesMap.set(record.userId, roleSet);
    }
    roleSet.add(record.targetRole);
  }

  const rows: ActivityDetailRow[] = [];

  for (const [activityId, userRolesMap] of rolesByActivityAndUser) {
    if (userRolesMap.size === 0) continue;

    const meta = activityMeta.get(activityId);
    if (!meta) continue;

    const employees: ActivityDetailEmployee[] = [];
    for (const [userId, roleSet] of userRolesMap) {
      const entry = directory.get(userId);
      if (!entry) continue;

      employees.push({
        userId,
        nickname: entry.nickname,
        email: entry.email,
        roles: Array.from(roleSet),
      });
    }

    if (employees.length === 0) continue;

    employees.sort((a, b) => a.nickname.localeCompare(b.nickname));

    rows.push({
      activityId,
      topic: meta.topic,
      ugName: meta.ugName,
      activityDate: meta.activityDate,
      employees,
    });
  }

  rows.sort((a, b) => b.activityDate.localeCompare(a.activityDate));

  return rows;
}

/**
 * 活动查询过滤：按 activityId 精确匹配 / topic 关键字子串匹配（不区分大小写）/
 * activityDate 范围过滤，多条件同时生效（AND）。无匹配时返回空数组。
 *
 * Requirement 9.5, 9.6。
 */
export function filterActivities(
  activities: ActivityDetailRow[],
  query: { activityId?: string; topicKeyword?: string; startDate?: string; endDate?: string },
): ActivityDetailRow[] {
  const { activityId, topicKeyword, startDate, endDate } = query;

  const normalizedKeyword = topicKeyword?.trim().toLowerCase();

  return activities.filter((activity) => {
    if (activityId !== undefined && activityId !== '' && activity.activityId !== activityId) {
      return false;
    }

    if (normalizedKeyword) {
      if (!activity.topic.toLowerCase().includes(normalizedKeyword)) {
        return false;
      }
    }

    if (startDate !== undefined && activity.activityDate < startDate) {
      return false;
    }

    if (endDate !== undefined && activity.activityDate > endDate) {
      return false;
    }

    return true;
  });
}

/**
 * 按最多 50/页 分页；page 从 1 开始。Requirement 9.7。
 *
 * pageSize 默认 50，且始终被限制在 [1, 50] 范围内（超出上限时钳制为 50，
 * 小于 1 时钳制为 1）。
 */
export function paginateActivities(
  activities: ActivityDetailRow[],
  page: number,
  pageSize?: number,
): PaginatedActivities {
  const requestedPageSize =
    pageSize === undefined || Number.isNaN(pageSize) ? DEFAULT_ACTIVITY_PAGE_SIZE : Math.floor(pageSize);
  const effectivePageSize = Math.min(Math.max(1, requestedPageSize), MAX_ACTIVITY_PAGE_SIZE);

  const total = activities.length;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));

  const requestedPage = Number.isNaN(page) ? 1 : Math.floor(page);
  const effectivePage = Math.min(Math.max(1, requestedPage), totalPages);

  const startIndex = (effectivePage - 1) * effectivePageSize;
  const items = activities.slice(startIndex, startIndex + effectivePageSize);

  return {
    items,
    page: effectivePage,
    pageSize: effectivePageSize,
    totalPages,
    total,
  };
}

export interface KeywordValidationResult {
  valid: boolean;
  error?: { code: string; message: string };
}

const MAX_KEYWORD_LENGTH = 100;

/**
 * 关键字过滤：nickname 或 email 经 trim + 小写后包含 trim + 小写关键字。
 * 关键字为空/未提供时原样返回。Requirement 10.1, 10.3, 10.4。
 */
export function filterByKeyword<T extends { nickname: string; email: string }>(
  rows: T[],
  keyword?: string,
): T[] {
  const normalized = keyword?.trim().toLowerCase();

  if (!normalized) {
    return rows;
  }

  return rows.filter(
    (row) =>
      row.nickname.trim().toLowerCase().includes(normalized) ||
      row.email.trim().toLowerCase().includes(normalized),
  );
}

/**
 * 关键字长度校验（1-100），超长返回校验错误。Requirement 10.2。
 *
 * 注意：空/未提供关键字视为合法（不做关键字过滤，Requirement 10.3），
 * 仅当关键字长度超过 100 字符时才拒绝。
 */
export function validateKeyword(keyword?: string): KeywordValidationResult {
  if (keyword === undefined || keyword.length === 0) {
    return { valid: true };
  }

  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return {
      valid: false,
      error: {
        code: ErrorCodes.QUERY_KEYWORD_TOO_LONG,
        message: ErrorMessages[ErrorCodes.QUERY_KEYWORD_TOO_LONG],
      },
    };
  }

  return { valid: true };
}

export interface DateRangeValidationResult {
  valid: boolean;
  error?: { code: string; message: string };
}

const DATE_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 校验字符串是否为符合 YYYY-MM-DD 格式的有效日历日期（拒绝 2024-02-30、2024-13-01 等）。
 */
function isValidCalendarDateString(value: string): boolean {
  if (!DATE_FORMAT_PATTERN.test(value)) {
    return false;
  }

  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  // Use UTC to avoid local-timezone off-by-one issues, then verify the
  // constructed date's components match the input (catches e.g. Feb 30 or
  // day 31 in a 30-day month rolling over to the next month).
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * 日期范围校验：
 * - 都不提供 → valid（不做范围限制）
 * - 仅提供开始日期或仅提供结束日期（单边范围，"不限"另一边）→ valid，格式仍须合法
 * - 都提供且均为合法 YYYY-MM-DD 日期且 startDate<=endDate → valid
 * - 格式非法 / 非有效日期 / start>end → invalid
 */
export function validateDateRange(startDate?: string, endDate?: string): DateRangeValidationResult {
  const invalid: DateRangeValidationResult = {
    valid: false,
    error: {
      code: ErrorCodes.QUERY_INVALID_DATE_RANGE,
      message: ErrorMessages[ErrorCodes.QUERY_INVALID_DATE_RANGE],
    },
  };

  const hasStart = startDate !== undefined && startDate !== '';
  const hasEnd = endDate !== undefined && endDate !== '';

  if (!hasStart && !hasEnd) {
    return { valid: true };
  }

  if (hasStart && !isValidCalendarDateString(startDate as string)) {
    return invalid;
  }

  if (hasEnd && !isValidCalendarDateString(endDate as string)) {
    return invalid;
  }

  if (hasStart && hasEnd && (startDate as string) > (endDate as string)) {
    return invalid;
  }

  return { valid: true };
}

/**
 * 按 activityDate 过滤支持记录（通过 activityMeta 关联到对应活动的日期）。
 * 未提供范围时返回全部记录。Requirement 11.1, 11.2。
 *
 * 记录的 activityId 若在 activityMeta 中找不到对应元数据，则无法确定其是否
 * 落在范围内，该记录会被排除。
 */
export function filterRecordsByDateRange(
  records: SupportRecord[],
  activityMeta: Map<string, ActivityMeta>,
  startDate?: string,
  endDate?: string,
): SupportRecord[] {
  const hasStart = startDate !== undefined && startDate !== '';
  const hasEnd = endDate !== undefined && endDate !== '';

  if (!hasStart && !hasEnd) {
    return records;
  }

  return records.filter((record) => {
    const meta = activityMeta.get(record.activityId);
    if (!meta) return false;

    if (hasStart && meta.activityDate < (startDate as string)) {
      return false;
    }

    if (hasEnd && meta.activityDate > (endDate as string)) {
      return false;
    }

    return true;
  });
}
