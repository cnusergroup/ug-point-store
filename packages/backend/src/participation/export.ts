/**
 * 员工活动参与度查询：导出执行模块。
 *
 * 复用 `query.ts` 中与视图查询相同的查询/聚合/过滤管道（不分页，取全部匹配数据），
 * 使用 `formatters.ts` 中的 `checkExportSizeLimit` 校验记录数，生成 CSV/Excel 后
 * 上传 S3 `exports/participation-query/*` 前缀，返回 30 分钟有效预签名下载 URL。
 * 模式参考 `reports/export.ts`。
 *
 * See design.md "7. 导出模块" for full interface definitions.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { generateCSV, generateExcel } from '../reports/formatters';
import {
  validateExportFormat,
  getColumnDefs,
  checkExportSizeLimit,
  ParticipationView,
  ExportFormat,
} from './formatters';
import {
  querySpeakerSupport,
  queryVolunteerSupport,
  queryTotalCount,
  queryEmployeeActivityDetail,
  queryActivityDetailAll,
  ViewFilter,
  ActivityViewFilter,
  QueryContext,
} from './query';
import { SupportCountRow, TotalCountRow, EmployeeActivityDetailRow, ActivityDetailRow, SupportRole } from './aggregate';

// ============================================================
// Constants
// ============================================================

/** 预签名下载 URL 有效期：30 分钟 */
const PRESIGNED_URL_EXPIRY = 30 * 60;

const INTERNAL_EXPORT_ERROR = {
  code: ErrorCodes.QUERY_EXPORT_FAILED,
  message: ErrorMessages[ErrorCodes.QUERY_EXPORT_FAILED],
};

/** 角色在导出文件中的展示标签，与各视图导出列标签的中英混用习惯保持一致
 *  （speaker-support 列标签为 "Speaker 支持次数"，volunteer-support 列标签为 "志愿者支持次数"）。 */
const ROLE_DISPLAY_LABELS: Record<SupportRole, string> = {
  Speaker: 'Speaker',
  Volunteer: '志愿者',
};

// ============================================================
// Interfaces
// ============================================================

/** 导出执行输入 */
export interface ExecuteParticipationExportInput {
  view: ParticipationView;
  format: ExportFormat;
  filter: ViewFilter | ActivityViewFilter;
}

/** 导出执行结果 */
export interface ExecuteParticipationExportResult {
  success: boolean;
  downloadUrl?: string;
  error?: { code: string; message: string };
}

/** 导出执行上下文：查询上下文 + S3 客户端/桶名 */
export type ExportContext = QueryContext & { s3Client: S3Client; bucket: string };

// ============================================================
// Row formatting helpers
// ============================================================

/** 将单个活动的参与员工格式化为 "花名(身份1、身份2)" 字符串数组，按 nickname 字母顺序（employees 已排序） */
function formatEmployeesForActivity(row: ActivityDetailRow): string {
  return row.employees
    .map(emp => {
      const roleLabels = emp.roles.map(role => ROLE_DISPLAY_LABELS[role]).join('、');
      return `${emp.nickname}(${roleLabels})`;
    })
    .join(';');
}

/** 将单个员工支持过的活动列表格式化为 "活动主题(身份1、身份2)@活动日期" 字符串数组，按 activityDate 降序（activities 已排序） */
function formatActivitiesForEmployee(row: EmployeeActivityDetailRow): string {
  return row.activities
    .map(activity => {
      const roleLabels = activity.roles.map(role => ROLE_DISPLAY_LABELS[role]).join('、');
      return `${activity.topic}(${roleLabels})@${activity.activityDate}`;
    })
    .join(';');
}

/** 将 SupportCountRow[]（Speaker/志愿者支持次数视图）格式化为导出行，字段与 getColumnDefs 列 key 一致 */
function formatSupportCountRowsForExport(rows: SupportCountRow[]): Record<string, unknown>[] {
  return rows.map(r => ({
    nickname: r.nickname,
    email: r.email,
    supportCount: r.supportCount,
  }));
}

/** 将 TotalCountRow[]（员工总次数视图）格式化为导出行 */
function formatTotalCountRowsForExport(rows: TotalCountRow[]): Record<string, unknown>[] {
  return rows.map(r => ({
    nickname: r.nickname,
    email: r.email,
    totalCount: r.totalCount,
  }));
}

/** 将 EmployeeActivityDetailRow[]（员工支持活动明细视图）格式化为导出行 */
function formatEmployeeActivityDetailRowsForExport(rows: EmployeeActivityDetailRow[]): Record<string, unknown>[] {
  return rows.map(r => ({
    nickname: r.nickname,
    email: r.email,
    totalActivityCount: r.activities.length,
    activitiesFormatted: formatActivitiesForEmployee(r),
  }));
}

/** 将 ActivityDetailRow[]（活动支持记录明细视图）格式化为导出行 */
function formatActivityDetailRowsForExport(rows: ActivityDetailRow[]): Record<string, unknown>[] {
  return rows.map(r => ({
    topic: r.topic,
    ugName: r.ugName,
    activityDate: r.activityDate,
    employeesFormatted: formatEmployeesForActivity(r),
  }));
}

// ============================================================
// Export execution
// ============================================================

/**
 * 执行员工活动参与度导出：
 * 1. 校验导出格式
 * 2. 复用 query.ts 中对应视图的查询/聚合/过滤管道，取得全部匹配数据（不分页）
 * 3. 使用 checkExportSizeLimit 校验记录数，超限则拒绝且不生成任何文件
 * 4. 生成 CSV/Excel 文件后上传 S3 `exports/participation-query/{view}/*`
 * 5. 返回 30 分钟有效预签名下载 URL
 *
 * 空结果集（rows.length === 0）不视为失败，仍生成仅含表头的文件（Requirement 13.4）。
 * 导出过程中任何系统错误（文件生成/S3 上传失败）返回失败且不产生部分或损坏文件
 * （S3 PutObject 是原子操作，失败时不会创建对象）。
 *
 * Requirements: 13.1, 13.3, 13.4, 13.7。
 */
export async function executeParticipationExport(
  input: ExecuteParticipationExportInput,
  ctx: ExportContext,
): Promise<ExecuteParticipationExportResult> {
  const formatValidation = validateExportFormat(input.format);
  if (!formatValidation.valid) {
    return { success: false, error: formatValidation.error };
  }

  let records: Record<string, unknown>[];

  try {
    switch (input.view) {
      case 'speaker-support': {
        const result = await querySpeakerSupport(input.filter as ViewFilter, ctx);
        if (!result.success || !result.rows) {
          return { success: false, error: result.error ?? INTERNAL_EXPORT_ERROR };
        }
        const sizeCheck = checkExportSizeLimit(result.rows.length);
        if (!sizeCheck.allowed) {
          return { success: false, error: sizeCheck.error };
        }
        records = formatSupportCountRowsForExport(result.rows);
        break;
      }
      case 'volunteer-support': {
        const result = await queryVolunteerSupport(input.filter as ViewFilter, ctx);
        if (!result.success || !result.rows) {
          return { success: false, error: result.error ?? INTERNAL_EXPORT_ERROR };
        }
        const sizeCheck = checkExportSizeLimit(result.rows.length);
        if (!sizeCheck.allowed) {
          return { success: false, error: sizeCheck.error };
        }
        records = formatSupportCountRowsForExport(result.rows);
        break;
      }
      case 'total-count': {
        const result = await queryTotalCount(input.filter as ViewFilter, ctx);
        if (!result.success || !result.rows) {
          return { success: false, error: result.error ?? INTERNAL_EXPORT_ERROR };
        }
        const sizeCheck = checkExportSizeLimit(result.rows.length);
        if (!sizeCheck.allowed) {
          return { success: false, error: sizeCheck.error };
        }
        records = formatTotalCountRowsForExport(result.rows);
        break;
      }
      case 'employee-activity-detail': {
        const result = await queryEmployeeActivityDetail(input.filter as ViewFilter, ctx);
        if (!result.success || !result.rows) {
          return { success: false, error: result.error ?? INTERNAL_EXPORT_ERROR };
        }
        const sizeCheck = checkExportSizeLimit(result.rows.length);
        if (!sizeCheck.allowed) {
          return { success: false, error: sizeCheck.error };
        }
        records = formatEmployeeActivityDetailRowsForExport(result.rows);
        break;
      }
      case 'activity-detail': {
        const result = await queryActivityDetailAll(input.filter as ActivityViewFilter, ctx);
        if (!result.success || !result.rows) {
          return { success: false, error: result.error ?? INTERNAL_EXPORT_ERROR };
        }
        const sizeCheck = checkExportSizeLimit(result.rows.length);
        if (!sizeCheck.allowed) {
          return { success: false, error: sizeCheck.error };
        }
        records = formatActivityDetailRowsForExport(result.rows);
        break;
      }
      default:
        return { success: false, error: INTERNAL_EXPORT_ERROR };
    }
  } catch (err) {
    console.error('executeParticipationExport query error:', err);
    return { success: false, error: INTERNAL_EXPORT_ERROR };
  }

  const columns = getColumnDefs(input.view);

  try {
    const fileBuffer =
      input.format === 'csv' ? generateCSV(records, columns) : generateExcel(records, columns);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const randomId = ulid();
    const extension = input.format === 'csv' ? 'csv' : 'xlsx';
    const s3Key = `exports/participation-query/${input.view}/${timestamp}_${randomId}.${extension}`;
    const contentType =
      input.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    await ctx.s3Client.send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
      }),
    );

    const downloadUrl = await getSignedUrl(
      ctx.s3Client,
      new GetObjectCommand({ Bucket: ctx.bucket, Key: s3Key }),
      { expiresIn: PRESIGNED_URL_EXPIRY },
    );

    return { success: true, downloadUrl };
  } catch (err) {
    console.error('executeParticipationExport file/S3 error:', err);
    return { success: false, error: INTERNAL_EXPORT_ERROR };
  }
}
