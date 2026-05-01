/**
 * Export credentials to Feishu Bitable — 导出凭证到飞书多维表格
 *
 * Uses the Feishu Open API to:
 * 1. Get tenant_access_token using stored app_id + app_secret
 * 2. Create a new Bitable app with a table
 * 3. Add fields (columns) based on user selection
 * 4. Batch insert credential records
 * 5. Return the shareable URL of the new table
 */

import type { Credential } from './types';

// ============================================================
// Interfaces
// ============================================================

export interface FeishuExportOptions {
  /** Feishu app_id from sync config */
  appId: string;
  /** Feishu app_secret from sync config */
  appSecret: string;
  /** Credentials to export */
  credentials: Credential[];
  /** Fields to include in the export */
  fields: FeishuExportField[];
  /** Title for the Bitable app */
  title?: string;
  /** Base URL for credential verification links */
  baseUrl: string;
}

export type FeishuExportField =
  | 'recipientName'
  | 'role'
  | 'credentialId'
  | 'eventName'
  | 'issueDate'
  | 'eventDate'
  | 'eventLocation'
  | 'status'
  | 'verifyUrl';

export interface FeishuExportResult {
  success: boolean;
  /** URL to the created Bitable */
  tableUrl?: string;
  /** Number of records written */
  recordCount?: number;
  error?: { code: string; message: string };
}

// ============================================================
// Constants
// ============================================================

const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_BITABLE_API = 'https://open.feishu.cn/open-apis/bitable/v1/apps';

/** Field display names (Chinese) */
const FIELD_LABELS: Record<FeishuExportField, string> = {
  recipientName: '姓名',
  role: '身份',
  credentialId: '凭证 ID',
  eventName: '活动名称',
  issueDate: '签发日期',
  eventDate: '活动日期',
  eventLocation: '活动地点',
  status: '状态',
  verifyUrl: '验证链接',
};

/** Role display names */
const ROLE_LABELS: Record<string, string> = {
  Volunteer: '志愿者',
  Speaker: '讲师',
  Workshop: '工作坊参与者',
  Organizer: '组织者',
};

// ============================================================
// Main export function
// ============================================================

export async function exportCredentialsToFeishu(options: FeishuExportOptions): Promise<FeishuExportResult> {
  const { appId, appSecret, credentials, fields, title, baseUrl } = options;

  if (!appId || !appSecret) {
    return {
      success: false,
      error: { code: 'MISSING_CONFIG', message: '飞书 API 凭证未配置（请在同步设置中配置 App ID 和 App Secret）' },
    };
  }

  if (credentials.length === 0) {
    return {
      success: false,
      error: { code: 'NO_DATA', message: '没有可导出的凭证数据' },
    };
  }

  if (fields.length === 0) {
    return {
      success: false,
      error: { code: 'NO_FIELDS', message: '请至少选择一个导出字段' },
    };
  }

  try {
    // 1. Get tenant_access_token
    console.log('[feishu-export] Getting tenant_access_token...');
    const token = await getTenantAccessToken(appId, appSecret);

    // 2. Create a new Bitable app
    const appTitle = title || `凭证导出 ${new Date().toISOString().split('T')[0]}`;
    console.log(`[feishu-export] Creating Bitable app: ${appTitle}`);
    const { appToken, defaultTableId } = await createBitableApp(token, appTitle);

    // 3. Delete default empty records from the new table
    console.log('[feishu-export] Cleaning up default records...');
    await deleteAllRecords(token, appToken, defaultTableId);

    // 4. Configure table fields (add ours, delete defaults)
    console.log('[feishu-export] Configuring table fields...');
    await configureTableFields(token, appToken, defaultTableId, fields);

    // 5. Batch insert records
    console.log(`[feishu-export] Inserting ${credentials.length} records...`);
    await batchInsertRecords(token, appToken, defaultTableId, credentials, fields, baseUrl);

    // 6. Set permission: anyone with link can view
    console.log('[feishu-export] Setting public link permission...');
    await setPublicPermission(token, appToken);

    // 7. Build the table URL
    const tableUrl = `https://feishu.cn/base/${appToken}?table=${defaultTableId}`;
    console.log(`[feishu-export] Export complete. URL: ${tableUrl}`);

    return {
      success: true,
      tableUrl,
      recordCount: credentials.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[feishu-export] Export failed:', message);
    return {
      success: false,
      error: { code: 'EXPORT_FAILED', message: `导出失败: ${message}` },
    };
  }
}

// ============================================================
// Internal helpers
// ============================================================

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const response = await fetch(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!response.ok) {
    throw new Error(`获取 tenant_access_token 失败: HTTP ${response.status}`);
  }

  const data = await response.json() as { code: number; msg: string; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${data.msg} (code: ${data.code})`);
  }

  return data.tenant_access_token;
}

/**
 * Create a new Bitable app. Returns appToken and the default table ID.
 */
async function createBitableApp(token: string, name: string): Promise<{ appToken: string; defaultTableId: string }> {
  const response = await fetch(FEISHU_BITABLE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(`创建飞书多维表格失败: HTTP ${response.status}`);
  }

  const data = await response.json() as {
    code: number;
    msg: string;
    data?: { app: { app_token: string; default_table_id: string; url: string } };
  };

  if (data.code !== 0 || !data.data?.app) {
    throw new Error(`创建飞书多维表格失败: ${data.msg} (code: ${data.code})`);
  }

  return {
    appToken: data.data.app.app_token,
    defaultTableId: data.data.app.default_table_id,
  };
}

/**
 * Configure table fields. The default table comes with a "多行文本" field.
 * We add our custom fields first, then delete the default field.
 */
async function configureTableFields(
  token: string,
  appToken: string,
  tableId: string,
  fields: FeishuExportField[],
): Promise<void> {
  // First, list existing fields to find the default one
  const listResp = await fetch(`${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/fields`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

  const listData = await listResp.json() as {
    code: number;
    data?: { items: { field_id: string; field_name: string }[] };
  };

  // Add our fields first (must have at least one field before deleting default)
  for (const field of fields) {
    const fieldType = field === 'verifyUrl' ? 15 : 1; // 15 = URL, 1 = Text
    await fetch(`${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/fields`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        field_name: FIELD_LABELS[field],
        type: fieldType,
      }),
    });
  }

  // Now delete default fields (the ones that existed before we added ours)
  if (listData.code === 0 && listData.data?.items) {
    const ourFieldNames = new Set(fields.map(f => FIELD_LABELS[f]));
    for (const existingField of listData.data.items) {
      if (!ourFieldNames.has(existingField.field_name)) {
        const delResp = await fetch(`${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/fields/${existingField.field_id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
        });
        const delData = await delResp.json() as { code: number; msg: string };
        if (delData.code !== 0) {
          console.warn(`[feishu-export] Failed to delete default field "${existingField.field_name}": ${delData.msg}`);
        }
      }
    }
  }
}

/**
 * Delete all existing records from a table (to remove default empty rows).
 */
async function deleteAllRecords(
  token: string,
  appToken: string,
  tableId: string,
): Promise<void> {
  // List all records
  const listResp = await fetch(
    `${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/records?page_size=500`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );

  const listData = await listResp.json() as {
    code: number;
    data?: { items?: { record_id: string }[] };
  };

  if (listData.code !== 0 || !listData.data?.items?.length) {
    return; // No records to delete
  }

  const recordIds = listData.data.items.map(r => r.record_id);

  // Batch delete
  const delResp = await fetch(
    `${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/records/batch_delete`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ records: recordIds }),
    },
  );

  const delData = await delResp.json() as { code: number; msg: string };
  if (delData.code !== 0) {
    console.warn(`[feishu-export] Failed to delete default records: ${delData.msg}`);
  }
}

/**
 * Set the Bitable permission to "anyone with link can view".
 * Uses the Drive permission API v1.
 * Requires the app to have "修改云文档权限设置" scope.
 */
async function setPublicPermission(token: string, appToken: string): Promise<void> {
  const url = `https://open.feishu.cn/open-apis/drive/v1/permissions/${appToken}/public?type=bitable`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      external_access: true,
      security_entity: 'anyone_can_view',
      comment_entity: 'anyone_can_view',
      share_entity: 'anyone',
      link_share_entity: 'anyone_readable',
      invite_external: true,
    }),
  });

  const data = await response.json() as { code: number; msg: string; data?: unknown };
  if (data.code !== 0) {
    console.warn(`[feishu-export] Failed to set public permission: code=${data.code}, msg=${data.msg}, response=${JSON.stringify(data)}`);
    console.warn('[feishu-export] The app may need the "修改云文档权限设置" (drive:drive.permission.public:write) scope enabled in Feishu developer console.');
  } else {
    console.log('[feishu-export] Public permission set successfully');
  }
}

/**
 * Batch insert credential records into the Bitable table.
 * Feishu API supports up to 500 records per batch.
 */
async function batchInsertRecords(
  token: string,
  appToken: string,
  tableId: string,
  credentials: Credential[],
  fields: FeishuExportField[],
  baseUrl: string,
): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < credentials.length; i += BATCH_SIZE) {
    const batch = credentials.slice(i, i + BATCH_SIZE);
    const records = batch.map(cred => ({
      fields: buildRecordFields(cred, fields, baseUrl),
    }));

    const response = await fetch(
      `${FEISHU_BITABLE_API}/${appToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ records }),
      },
    );

    if (!response.ok) {
      throw new Error(`批量写入记录失败: HTTP ${response.status}`);
    }

    const data = await response.json() as { code: number; msg: string };
    if (data.code !== 0) {
      throw new Error(`批量写入记录失败: ${data.msg} (code: ${data.code})`);
    }
  }
}

/**
 * Build the fields object for a single record based on selected export fields.
 */
function buildRecordFields(
  cred: Credential,
  fields: FeishuExportField[],
  baseUrl: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const label = FIELD_LABELS[field];
    switch (field) {
      case 'recipientName':
        result[label] = cred.recipientName;
        break;
      case 'role':
        result[label] = ROLE_LABELS[cred.role] || cred.role;
        break;
      case 'credentialId':
        result[label] = cred.credentialId;
        break;
      case 'eventName':
        result[label] = cred.eventName;
        break;
      case 'issueDate':
        result[label] = cred.issueDate;
        break;
      case 'eventDate':
        result[label] = cred.eventDate || '';
        break;
      case 'eventLocation':
        result[label] = cred.eventLocation || '';
        break;
      case 'status':
        result[label] = cred.status === 'active' ? '有效' : '已撤销';
        break;
      case 'verifyUrl': {
        const url = `${baseUrl}/c/${cred.credentialId}`;
        result[label] = { text: url, link: url };
        break;
      }
    }
  }

  return result;
}
