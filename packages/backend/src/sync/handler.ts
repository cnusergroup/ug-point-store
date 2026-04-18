/**
 * Sync Lambda handler — 活动数据同步（飞书 + Meetup）
 *
 * 由 EventBridge 定时触发或 Admin Lambda 手动调用。
 * 支持 source 参数路由：feishu / meetup / all（默认）。
 *
 * - feishu: 仅执行飞书同步
 * - meetup: 仅执行 Meetup 同步
 * - all: 先飞书，再 Meetup（仅当 autoSyncEnabled 为 true）
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
import { fetchMeetupGroupEvents } from './meetup-api';
import type { MeetupGroup, MeetupCookieAuth } from './meetup-api';

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

/** Meetup 同步配置（存储在 Users 表中，settingKey="meetup-sync-config"） */
export interface MeetupSyncConfig {
  settingKey: string;           // 'meetup-sync-config'
  groups: MeetupGroup[];
  meetupToken: string;
  meetupCsrf: string;
  meetupSession: string;
  autoSyncEnabled: boolean;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  updatedAt: string;
  updatedBy: string;
}

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  source?: 'feishu' | 'meetup' | 'all';
  syncedCount?: number;
  skippedCount?: number;
  warnings?: string[];
  error?: { code: string; message: string };
}

/** 同步事件载荷 */
interface SyncEvent {
  source?: 'feishu' | 'meetup' | 'all';
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
const MEETUP_SYNC_CONFIG_KEY = 'meetup-sync-config';

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
 * Supports `source` parameter: 'feishu' | 'meetup' | 'all' (default).
 */
export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  console.log('Sync Lambda invoked', JSON.stringify(event));

  // Parse source from event payload (default 'all')
  const source = parseSyncSource(event);
  console.log(`[sync-handler] Source: ${source}`);

  const warnings: string[] = [];
  let feishuResult: SyncResult | null = null;
  let meetupResult: SyncResult | null = null;

  try {
    // ── Feishu sync ──
    if (source === 'feishu' || source === 'all') {
      feishuResult = await runFeishuSync();
    }

    // ── Meetup sync ──
    if (source === 'meetup' || source === 'all') {
      meetupResult = await runMeetupSync(source, warnings);
    }

    // ── Combine results ──
    const result = combineResults(source, feishuResult, meetupResult, warnings);

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
        source,
        warnings,
        error: { code: 'SYNC_FAILED', message: `同步异常: ${message}` },
      } satisfies SyncResult),
    };
  }
}

/**
 * Parse the `source` field from the event payload.
 * Returns 'all' if not specified or invalid.
 */
function parseSyncSource(event: unknown): 'feishu' | 'meetup' | 'all' {
  if (event && typeof event === 'object' && 'source' in event) {
    const s = (event as SyncEvent).source;
    if (s === 'feishu' || s === 'meetup' || s === 'all') return s;
  }
  return 'all';
}

/**
 * Run Feishu sync. Returns the SyncResult.
 */
async function runFeishuSync(): Promise<SyncResult> {
  const config = await getSyncConfig(dynamoClient, USERS_TABLE);
  console.log('[sync-handler] Feishu config loaded:', {
    feishuTableUrl: config.feishuTableUrl ? '***configured***' : '(empty)',
    feishuAppId: config.feishuAppId ? '***configured***' : '(empty)',
    syncIntervalDays: config.syncIntervalDays,
  });

  if (!config.feishuTableUrl) {
    console.warn('[sync-handler] No feishuTableUrl configured, skipping Feishu sync');
    return {
      success: false,
      source: 'feishu',
      error: { code: 'SYNC_FAILED', message: '未配置飞书表格 URL' },
    };
  }

  const result = await syncActivities(config, dynamoClient, ACTIVITIES_TABLE);
  return { ...result, source: 'feishu' };
}

/**
 * Run Meetup sync. Reads config, checks autoSyncEnabled for 'all' source,
 * and delegates to syncMeetupActivities.
 */
async function runMeetupSync(
  source: 'feishu' | 'meetup' | 'all',
  warnings: string[],
): Promise<SyncResult> {
  const meetupConfig = await getMeetupSyncConfig(dynamoClient, USERS_TABLE);

  if (!meetupConfig) {
    const msg = 'No Meetup sync config found, skipping Meetup sync';
    console.warn(`[sync-handler] ${msg}`);
    if (source === 'meetup') {
      return {
        success: false,
        source: 'meetup',
        error: { code: 'SYNC_FAILED', message: msg },
      };
    }
    // For 'all', just skip silently
    return { success: true, source: 'meetup', syncedCount: 0, skippedCount: 0 };
  }

  // For 'all' source, check autoSyncEnabled
  if (source === 'all' && !meetupConfig.autoSyncEnabled) {
    console.log('[sync-handler] Meetup autoSyncEnabled is false, skipping Meetup sync for source=all');
    return { success: true, source: 'meetup', syncedCount: 0, skippedCount: 0 };
  }

  // Check if cookie credentials are present
  if (!meetupConfig.meetupToken || !meetupConfig.meetupCsrf || !meetupConfig.meetupSession) {
    const msg = 'Meetup cookie credentials are empty, skipping Meetup sync';
    console.warn(`[sync-handler] ${msg}`);
    warnings.push(msg);
    if (source === 'meetup') {
      return {
        success: false,
        source: 'meetup',
        warnings: [...warnings],
        error: { code: 'SYNC_FAILED', message: msg },
      };
    }
    return { success: true, source: 'meetup', syncedCount: 0, skippedCount: 0, warnings: [...warnings] };
  }

  const result = await syncMeetupActivities(meetupConfig, dynamoClient, ACTIVITIES_TABLE);
  // Merge warnings
  if (result.warnings) {
    warnings.push(...result.warnings);
  }
  return result;
}

/**
 * Combine Feishu and Meetup results into a single SyncResult.
 */
function combineResults(
  source: 'feishu' | 'meetup' | 'all',
  feishuResult: SyncResult | null,
  meetupResult: SyncResult | null,
  warnings: string[],
): SyncResult {
  if (source === 'feishu' && feishuResult) {
    return { ...feishuResult, warnings: warnings.length > 0 ? warnings : undefined };
  }

  if (source === 'meetup' && meetupResult) {
    return { ...meetupResult, warnings: warnings.length > 0 ? warnings : undefined };
  }

  // source === 'all': combine both
  const feishuSynced = feishuResult?.syncedCount ?? 0;
  const feishuSkipped = feishuResult?.skippedCount ?? 0;
  const meetupSynced = meetupResult?.syncedCount ?? 0;
  const meetupSkipped = meetupResult?.skippedCount ?? 0;

  const feishuSuccess = feishuResult?.success ?? true;
  const meetupSuccess = meetupResult?.success ?? true;

  // If Feishu failed but Meetup succeeded (or vice versa), partial success
  if (feishuResult?.error) {
    warnings.push(`Feishu sync error: ${feishuResult.error.message}`);
  }
  if (meetupResult?.error) {
    warnings.push(`Meetup sync error: ${meetupResult.error.message}`);
  }

  return {
    success: feishuSuccess || meetupSuccess,
    source: 'all',
    syncedCount: feishuSynced + meetupSynced,
    skippedCount: feishuSkipped + meetupSkipped,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
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
// Meetup Sync Logic
// ============================================================

/**
 * Execute Meetup activity sync.
 *
 * Iterates configured groups, fetches events via GraphQL,
 * deduplicates via dedupeKey-index GSI, writes new activities.
 * Per-group error isolation: if one group fails, log and continue.
 */
export async function syncMeetupActivities(
  config: MeetupSyncConfig,
  dynamo: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<SyncResult> {
  const startTime = new Date().toISOString();
  console.log(`[syncMeetupActivities] Starting Meetup sync at ${startTime}`);

  const auth: MeetupCookieAuth = {
    meetupToken: config.meetupToken,
    meetupCsrf: config.meetupCsrf,
    meetupSession: config.meetupSession,
  };

  if (!config.groups || config.groups.length === 0) {
    console.warn('[syncMeetupActivities] No Meetup groups configured');
    return { success: true, source: 'meetup', syncedCount: 0, skippedCount: 0 };
  }

  let totalSynced = 0;
  let totalSkipped = 0;
  const warnings: string[] = [];
  const now = new Date().toISOString();

  for (const group of config.groups) {
    try {
      console.log(`[syncMeetupActivities] Fetching events for group "${group.urlname}" (${group.displayName})`);
      const groupResult = await fetchMeetupGroupEvents(group, auth);

      if (!groupResult.success || !groupResult.events) {
        const errMsg = `Group "${group.urlname}" failed: ${groupResult.error?.message ?? 'Unknown error'}`;
        console.error(`[syncMeetupActivities] ${errMsg}`);
        warnings.push(errMsg);

        // Check for auth expired — propagate as error
        if (groupResult.error?.code === 'MEETUP_AUTH_EXPIRED') {
          return {
            success: false,
            source: 'meetup',
            syncedCount: totalSynced,
            skippedCount: totalSkipped,
            warnings,
            error: groupResult.error,
          };
        }

        // Per-group error isolation: continue with remaining groups
        continue;
      }

      const events = groupResult.events;
      console.log(`[syncMeetupActivities] Fetched ${events.length} events for group "${group.urlname}"`);

      // Deduplicate and write each event
      for (const event of events) {
        try {
          const exists = await checkDedupeKeyExists(event.dedupeKey, dynamo, activitiesTable);

          if (exists) {
            totalSkipped++;
            continue;
          }

          const activityId = ulid();
          await dynamo.send(
            new PutCommand({
              TableName: activitiesTable,
              Item: {
                activityId,
                pk: 'ALL',
                activityType: event.activityType,
                ugName: event.ugName,
                topic: event.topic,
                activityDate: event.activityDate,
                syncedAt: now,
                sourceUrl: event.meetupEventUrl,
                dedupeKey: event.dedupeKey,
                meetupEventId: event.meetupEventId,
                meetupGoingCount: event.meetupGoingCount,
                meetupVenueName: event.meetupVenueName,
                meetupVenueCity: event.meetupVenueCity,
              },
            }),
          );

          totalSynced++;
        } catch (err) {
          console.error(`[syncMeetupActivities] Failed to process event "${event.topic}":`, err);
          // Continue processing remaining events
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errMsg = `Group "${group.urlname}" unexpected error: ${message}`;
      console.error(`[syncMeetupActivities] ${errMsg}`);
      warnings.push(errMsg);
      // Per-group error isolation: continue with remaining groups
    }
  }

  const endTime = new Date().toISOString();
  console.log(`[syncMeetupActivities] Meetup sync complete at ${endTime}: synced=${totalSynced}, skipped=${totalSkipped}, warnings=${warnings.length}`);

  return {
    success: true,
    source: 'meetup',
    syncedCount: totalSynced,
    skippedCount: totalSkipped,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
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

/**
 * Read Meetup sync config from Users table.
 * Returns null if no record exists.
 */
export async function getMeetupSyncConfig(
  dynamo: DynamoDBDocumentClient,
  usersTable: string,
): Promise<MeetupSyncConfig | null> {
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userId: MEETUP_SYNC_CONFIG_KEY },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return {
      settingKey: MEETUP_SYNC_CONFIG_KEY,
      groups: (result.Item.groups as MeetupGroup[]) ?? [],
      meetupToken: (result.Item.meetupToken as string) ?? '',
      meetupCsrf: (result.Item.meetupCsrf as string) ?? '',
      meetupSession: (result.Item.meetupSession as string) ?? '',
      autoSyncEnabled: (result.Item.autoSyncEnabled as boolean) ?? false,
      clientId: result.Item.clientId as string | undefined,
      clientSecret: result.Item.clientSecret as string | undefined,
      refreshToken: result.Item.refreshToken as string | undefined,
      updatedAt: (result.Item.updatedAt as string) ?? '',
      updatedBy: (result.Item.updatedBy as string) ?? '',
    };
  } catch (err) {
    console.error('[getMeetupSyncConfig] Failed to read Meetup sync config:', err);
    return null;
  }
}
