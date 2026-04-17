/**
 * Sync Lambda handler — 飞书活动数据同步
 *
 * 由 EventBridge 定时触发或 Admin Lambda 手动调用。
 * 从 Users 表读取同步配置，优先使用 Web Scraping，
 * 如配置了 API 凭证则使用 Feishu Open API。
 * 对每条活动生成 dedupeKey 去重后写入 Activities 表。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { scrapeFeishuBitable } from './feishu-scraper';
import { fetchFeishuBitableApi } from './feishu-api';

// ============================================================
// Interfaces
// ============================================================

/** 同步配置（存储在 Users 表中，settingKey="activity-sync-config"） */
export interface SyncConfig {
  settingKey: string;
  syncIntervalDays: number;
  feishuTableUrl: string;
  feishuAppId: string;
  feishuAppSecret: string;
  updatedAt: string;
  updatedBy: string;
}

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  syncedCount?: number;
  skippedCount?: number;
  error?: { code: string; message: string };
}

/** 从飞书获取的原始活动数据 */
interface RawActivity {
  activityType: string;
  ugName: string;
  topic: string;
  activityDate: string;
}

// ============================================================
// Constants
// ============================================================

const SYNC_CONFIG_KEY = 'activity-sync-config';

/** Default sync config when no config record exists */
const DEFAULT_SYNC_CONFIG: SyncConfig = {
  settingKey: SYNC_CONFIG_KEY,
  syncIntervalDays: 1,
  feishuTableUrl: '',
  feishuAppId: '',
  feishuAppSecret: '',
  updatedAt: '',
  updatedBy: '',
};

// ============================================================
// Lambda clients (created outside handler for container reuse)
// ============================================================

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE ?? '';
const USERS_TABLE = process.env.USERS_TABLE ?? '';

// ============================================================
// Lambda Handler
// ============================================================

/**
 * Sync Lambda entry point.
 * Triggered by EventBridge schedule or Admin Lambda invoke.
 */
export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  console.log('Sync Lambda invoked', JSON.stringify(event));

  try {
    // 1. Read sync config from Users table
    const config = await getSyncConfig(dynamoClient, USERS_TABLE);
    console.log('[sync-handler] Sync config loaded:', {
      feishuTableUrl: config.feishuTableUrl ? '***configured***' : '(empty)',
      feishuAppId: config.feishuAppId ? '***configured***' : '(empty)',
      syncIntervalDays: config.syncIntervalDays,
    });

    if (!config.feishuTableUrl) {
      console.warn('[sync-handler] No feishuTableUrl configured, skipping sync');
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          error: { code: 'SYNC_FAILED', message: '未配置飞书表格 URL' },
        } satisfies SyncResult),
      };
    }

    // 2. Execute sync
    const result = await syncActivities(config, dynamoClient, ACTIVITIES_TABLE);

    console.log('[sync-handler] Sync completed:', result);
    return {
      statusCode: result.success ? 200 : 500,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('[sync-handler] Unhandled error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: { code: 'SYNC_FAILED', message: `同步异常: ${message}` },
      } satisfies SyncResult),
    };
  }
}

// ============================================================
// Core Sync Logic
// ============================================================

/**
 * Execute activity data sync from Feishu Bitable.
 *
 * Strategy:
 * - If feishuAppId and feishuAppSecret are configured → use Feishu Open API
 * - Otherwise → use Web Scraping on the public share link
 *
 * For each activity:
 * 1. Generate dedupeKey = `{topic}#{activityDate}#{ugName}`
 * 2. Query dedupeKey-index GSI to check if already exists
 * 3. If not exists, PutCommand to Activities table with pk='ALL'
 */
export async function syncActivities(
  config: SyncConfig,
  dynamo: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<SyncResult> {
  // 1. Fetch activities from Feishu
  const rawActivities = await fetchActivities(config);
  if (!rawActivities.success || !rawActivities.activities) {
    return {
      success: false,
      error: rawActivities.error ?? { code: 'SYNC_FAILED', message: '获取飞书数据失败' },
    };
  }

  const activities = rawActivities.activities;
  console.log(`[syncActivities] Fetched ${activities.length} activities from Feishu`);

  if (activities.length === 0) {
    return { success: true, syncedCount: 0, skippedCount: 0 };
  }

  // 2. Deduplicate and write to DynamoDB
  let syncedCount = 0;
  let skippedCount = 0;
  const now = new Date().toISOString();

  for (const activity of activities) {
    const dedupeKey = `${activity.topic}#${activity.activityDate}#${activity.ugName}`;

    try {
      // Check if already exists via dedupeKey-index GSI
      const exists = await checkDedupeKeyExists(dedupeKey, dynamo, activitiesTable);

      if (exists) {
        skippedCount++;
        continue;
      }

      // Write new activity record
      const activityId = ulid();
      await dynamo.send(
        new PutCommand({
          TableName: activitiesTable,
          Item: {
            activityId,
            pk: 'ALL', // Required for activityDate-index GSI
            activityType: activity.activityType,
            ugName: activity.ugName,
            topic: activity.topic,
            activityDate: activity.activityDate,
            syncedAt: now,
            sourceUrl: config.feishuTableUrl,
            dedupeKey,
          },
        }),
      );

      syncedCount++;
    } catch (err) {
      console.error(`[syncActivities] Failed to process activity "${activity.topic}":`, err);
      // Continue processing remaining activities
    }
  }

  console.log(`[syncActivities] Sync complete: synced=${syncedCount}, skipped=${skippedCount}`);
  return { success: true, syncedCount, skippedCount };
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Fetch activities from Feishu using the appropriate method.
 * Prefers Web Scraping; uses Feishu API if API credentials are configured.
 */
async function fetchActivities(
  config: SyncConfig,
): Promise<{ success: boolean; activities?: RawActivity[]; error?: { code: string; message: string } }> {
  const hasApiCredentials = config.feishuAppId && config.feishuAppSecret;

  if (hasApiCredentials) {
    console.log('[syncActivities] Using Feishu Open API (API credentials configured)');
    return fetchFeishuBitableApi(config.feishuAppId, config.feishuAppSecret, config.feishuTableUrl);
  }

  console.log('[syncActivities] Using Web Scraping (no API credentials)');
  return scrapeFeishuBitable(config.feishuTableUrl);
}

/**
 * Check if a dedupeKey already exists in the Activities table.
 * Uses the dedupeKey-index GSI.
 */
async function checkDedupeKeyExists(
  dedupeKey: string,
  dynamo: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<boolean> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: activitiesTable,
      IndexName: 'dedupeKey-index',
      KeyConditionExpression: '#dk = :dk',
      ExpressionAttributeNames: { '#dk': 'dedupeKey' },
      ExpressionAttributeValues: { ':dk': dedupeKey },
      Limit: 1,
      Select: 'COUNT',
    }),
  );

  return (result.Count ?? 0) > 0;
}

/**
 * Read sync config from Users table.
 * Returns default config if no record exists.
 */
export async function getSyncConfig(
  dynamo: DynamoDBDocumentClient,
  usersTable: string,
): Promise<SyncConfig> {
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userId: SYNC_CONFIG_KEY },
      }),
    );

    if (!result.Item) {
      return { ...DEFAULT_SYNC_CONFIG };
    }

    return {
      settingKey: SYNC_CONFIG_KEY,
      syncIntervalDays: (result.Item.syncIntervalDays as number) ?? 1,
      feishuTableUrl: (result.Item.feishuTableUrl as string) ?? '',
      feishuAppId: (result.Item.feishuAppId as string) ?? '',
      feishuAppSecret: (result.Item.feishuAppSecret as string) ?? '',
      updatedAt: (result.Item.updatedAt as string) ?? '',
      updatedBy: (result.Item.updatedBy as string) ?? '',
    };
  } catch (err) {
    console.error('[getSyncConfig] Failed to read sync config:', err);
    return { ...DEFAULT_SYNC_CONFIG };
  }
}
