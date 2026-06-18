/**
 * 历史数据迁移：将历史合并发放的「技能认领分」从发放身份分类拆分/改归类为「志愿者（Volunteer）」。
 *
 * 背景：
 *   旧版批量发放把活动基础分与技能认领分合并写入同一条 PointsRecords（targetRole=发放身份），
 *   导致技能分被错误计入 UGL/Speaker 分类。本脚本依据精确的技能认领表 PointsMall-Claims，
 *   定位历史合并记录并执行拆分/改分类，同时调整用户表分类累计字段。
 *
 * 守恒保证（需求 4）：
 *   - users.points 不变
 *   - users.earnTotal 不变
 *   - earnTotalLeader + earnTotalSpeaker + earnTotalVolunteer 之和不变
 *
 * 幂等（需求 3.6）：
 *   - 合并记录拆分/改分类后写入 skillSplit=true 标记
 *   - 每次写操作带 ConditionExpression: attribute_not_exists(skillSplit)，重复执行不会重复拆分
 *
 * 用法（从仓库根目录执行）：
 *   # dry-run（默认，只扫描输出，不写任何数据）
 *   npx ts-node --project packages/backend/tsconfig.json \
 *     packages/backend/src/admin/migrate-skill-points-to-volunteer.ts --dry-run
 *
 *   # apply（人工确认 dry-run 结果后执行）
 *   npx ts-node --project packages/backend/tsconfig.json \
 *     packages/backend/src/admin/migrate-skill-points-to-volunteer.ts --apply
 *
 * 环境变量：
 *   AWS_REGION              默认 ap-northeast-1
 *   USERS_TABLE             默认 PointsMall-Users
 *   POINTS_RECORDS_TABLE    默认 PointsMall-PointsRecords
 *   CLAIMS_TABLE / ACTIVITY_SKILL_CLAIMS_TABLE  默认 PointsMall-ActivitySkillClaims
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { SkillType } from './skill-claims';
import { buildSkillSource } from './batch-points';

// ============================================================
// Types
// ============================================================

/** 一条技能认领记录（PointsMall-Claims 表 item，仅取迁移所需字段） */
export interface ClaimRow {
  activityId: string;
  skill: SkillType;
  userId: string;
  pointsAwarded: number;
  distributionId: string;
}

/** 按 (userId, activityId, distributionId) 聚合后的技能分组 */
export interface SkillGroup {
  userId: string;
  activityId: string;
  distributionId: string;
  skillSum: number;
  skills: SkillType[];
}

/** 一条 PointsRecords item（迁移所需字段） */
export interface PointsRecordRow {
  recordId: string;
  userId: string;
  type?: string;
  amount: number;
  source?: string;
  balanceAfter?: number;
  createdAt?: string;
  activityId?: string;
  activityType?: string;
  activityUG?: string;
  activityTopic?: string;
  activityDate?: string;
  targetRole?: string;
  skillSplit?: boolean;
}

type OperationKind = 'split' | 'reclassify';

/** 计划执行的一个迁移操作 */
export interface PlannedOperation {
  kind: OperationKind;
  group: SkillGroup;
  /** 命中的历史合并记录 */
  mergedRecord: PointsRecordRow;
  /** 发放身份对应的用户表 earn 字段 */
  roleField: 'earnTotalLeader' | 'earnTotalSpeaker';
}

// ============================================================
// Pure helpers (exported for testing)
// ============================================================

/**
 * 把 targetRole（发放身份）映射到用户表 earn 累计字段。
 * 仅 UGL / Speaker 需要迁移（技能分从该身份字段移到 Volunteer）。
 * Volunteer 身份的合并记录无需迁移（技能分已在 Volunteer 分类下）。
 */
export function roleFieldFor(targetRole: string | undefined): 'earnTotalLeader' | 'earnTotalSpeaker' | null {
  if (targetRole === 'UserGroupLeader') return 'earnTotalLeader';
  if (targetRole === 'Speaker') return 'earnTotalSpeaker';
  return null;
}

/**
 * 按 (userId, activityId, distributionId) 聚合技能认领，得到每组的技能分合计与技能列表。
 */
export function aggregateClaims(claims: ClaimRow[]): SkillGroup[] {
  const map = new Map<string, SkillGroup>();
  for (const c of claims) {
    if (!c.userId || !c.activityId) continue;
    const distributionId = c.distributionId ?? '';
    const key = `${c.userId}|${c.activityId}|${distributionId}`;
    const existing = map.get(key);
    const awarded = typeof c.pointsAwarded === 'number' ? c.pointsAwarded : 0;
    if (existing) {
      existing.skillSum += awarded;
      existing.skills.push(c.skill);
    } else {
      map.set(key, {
        userId: c.userId,
        activityId: c.activityId,
        distributionId,
        skillSum: awarded,
        skills: [c.skill],
      });
    }
  }
  return [...map.values()];
}

/**
 * 判断一条 earn 记录是否为「含技能分的历史合并记录」候选。
 *
 * 旧版合并记录特征：
 *   - type === 'earn'
 *   - activityId 匹配
 *   - targetRole 为发放身份（非 Volunteer）
 *   - source 含「技能」标记（buildMergedSource 在含技能时写入「技能:」）
 *   - 尚未被迁移（skillSplit !== true）
 *   - amount >= skillSum（合并金额至少包含技能分）
 *
 * 注意：新版代码已拆分写入，基础分记录 source 不含「技能」，技能分记录 targetRole=Volunteer，
 *       因此都不会被本检测命中，避免误迁移。
 */
export function isMergedSkillRecord(record: PointsRecordRow, activityId: string, skillSum: number): boolean {
  if (record.type && record.type !== 'earn') return false;
  if (record.activityId !== activityId) return false;
  if (record.targetRole === 'Volunteer' || !record.targetRole) return false;
  if (record.skillSplit === true) return false;
  if (!record.source || !record.source.includes('技能')) return false;
  if (typeof record.amount !== 'number') return false;
  return record.amount >= skillSum;
}

/**
 * 根据合并记录金额与技能分决定操作类型：
 *   - amount > skillSum → split（含基础分，需拆分）
 *   - amount === skillSum → reclassify（纯技能，直接改分类）
 */
export function classifyOperation(amount: number, skillSum: number): OperationKind | null {
  if (amount > skillSum) return 'split';
  if (amount === skillSum) return 'reclassify';
  return null;
}

// ============================================================
// DynamoDB access
// ============================================================

/** 全表扫描 PointsMall-Claims，返回所有技能认领记录。 */
async function scanAllClaims(doc: DynamoDBDocumentClient, claimsTable: string): Promise<ClaimRow[]> {
  const rows: ClaimRow[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: claimsTable,
        ProjectionExpression: 'activityId, skill, userId, pointsAwarded, distributionId',
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );
    for (const item of result.Items ?? []) {
      rows.push(item as ClaimRow);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}

/** 查询某用户在某 activityId 的全部 earn 记录（经 userId-createdAt-index GSI）。 */
async function queryUserEarnRecords(
  doc: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  userId: string,
  activityId: string,
): Promise<PointsRecordRow[]> {
  const rows: PointsRecordRow[] = [];
  let exclusiveStartKey: Record<string, any> | undefined;
  do {
    const result = await doc.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#t = :earn AND activityId = :aid',
        ExpressionAttributeNames: { '#t': 'type' },
        ExpressionAttributeValues: { ':uid': userId, ':earn': 'earn', ':aid': activityId },
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );
    for (const item of result.Items ?? []) {
      rows.push(item as PointsRecordRow);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}

// ============================================================
// Planning (scan phase — no writes)
// ============================================================

export interface MigrationPlan {
  operations: PlannedOperation[];
  /** 受影响记录数：split 计 2（改 1 + 增 1），reclassify 计 1 */
  affectedRecordCount: number;
  affectedUserIds: Set<string>;
  totalSkillPoints: number;
  /** 扫描中遇到的、未能定位合并记录的分组（供人工排查） */
  unmatchedGroups: SkillGroup[];
  /** 已迁移（幂等命中）跳过的分组数 */
  skippedAlreadyMigrated: number;
}

/**
 * 扫描并构建迁移计划，不写任何数据。
 * 同一 (userId, activityId) 可能存在多次发放的多条合并记录，处理一组后将其标记为已消费，
 * 避免在同一次运行中被另一组重复命中。
 */
export async function buildPlan(
  doc: DynamoDBDocumentClient,
  tables: { pointsRecordsTable: string; claimsTable: string },
): Promise<MigrationPlan> {
  const claims = await scanAllClaims(doc, tables.claimsTable);
  const groups = aggregateClaims(claims);

  const operations: PlannedOperation[] = [];
  const affectedUserIds = new Set<string>();
  const unmatchedGroups: SkillGroup[] = [];
  let affectedRecordCount = 0;
  let totalSkillPoints = 0;
  let skippedAlreadyMigrated = 0;

  // 缓存每个 (userId, activityId) 的 earn 记录，并跟踪本次运行已消费的 recordId。
  const recordCache = new Map<string, PointsRecordRow[]>();
  const consumedRecordIds = new Set<string>();

  for (const group of groups) {
    if (group.skillSum <= 0) continue;

    const cacheKey = `${group.userId}|${group.activityId}`;
    let records = recordCache.get(cacheKey);
    if (!records) {
      records = await queryUserEarnRecords(doc, tables.pointsRecordsTable, group.userId, group.activityId);
      recordCache.set(cacheKey, records);
    }

    // 幂等：若该 (userId, activityId) 已存在被迁移过的记录（skillSplit=true），视为已处理。
    const alreadyMigrated = records.some(r => r.skillSplit === true);

    // 在候选合并记录中选第一条未被消费的。
    const candidate = records.find(
      r => !consumedRecordIds.has(r.recordId) && isMergedSkillRecord(r, group.activityId, group.skillSum),
    );

    if (!candidate) {
      if (alreadyMigrated) {
        skippedAlreadyMigrated++;
      } else {
        unmatchedGroups.push(group);
      }
      continue;
    }

    const roleField = roleFieldFor(candidate.targetRole);
    if (!roleField) {
      // 发放身份为 Volunteer 等无需迁移的情况。
      continue;
    }

    const kind = classifyOperation(candidate.amount, group.skillSum);
    if (!kind) {
      unmatchedGroups.push(group);
      continue;
    }

    consumedRecordIds.add(candidate.recordId);
    operations.push({ kind, group, mergedRecord: candidate, roleField });
    affectedUserIds.add(group.userId);
    totalSkillPoints += group.skillSum;
    affectedRecordCount += kind === 'split' ? 2 : 1;
  }

  return {
    operations,
    affectedRecordCount,
    affectedUserIds,
    totalSkillPoints,
    unmatchedGroups,
    skippedAlreadyMigrated,
  };
}

// ============================================================
// Apply phase
// ============================================================

/**
 * 对一个计划操作执行原子事务：
 *   - split：更新 R（amount -= skillSum，skillSplit=true）+ 新增 Volunteer 记录 V + 调整用户表
 *   - reclassify：更新 R（targetRole=Volunteer，skillSplit=true）+ 调整用户表
 * 全部带 ConditionExpression: attribute_not_exists(skillSplit) 保证幂等。
 */
export async function applyOperation(
  doc: DynamoDBDocumentClient,
  tables: { usersTable: string; pointsRecordsTable: string },
  op: PlannedOperation,
): Promise<void> {
  const { group, mergedRecord, roleField, kind } = op;
  const now = new Date().toISOString();
  const transactItems: any[] = [];

  if (kind === 'split') {
    // 1) 还原原记录为纯基础分
    transactItems.push({
      Update: {
        TableName: tables.pointsRecordsTable,
        Key: { recordId: mergedRecord.recordId },
        UpdateExpression: 'SET amount = amount - :sv, skillSplit = :true',
        ConditionExpression: 'attribute_not_exists(skillSplit)',
        ExpressionAttributeValues: { ':sv': group.skillSum, ':true': true },
      },
    });
    // 2) 新增 Volunteer 技能记录（保留活动信息）
    transactItems.push({
      Put: {
        TableName: tables.pointsRecordsTable,
        Item: {
          recordId: ulid(),
          userId: group.userId,
          type: 'earn',
          amount: group.skillSum,
          source: buildSkillSource(
            group.skills,
            mergedRecord.activityUG ?? '',
            mergedRecord.activityTopic ?? '',
            mergedRecord.activityDate ?? '',
          ),
          balanceAfter: mergedRecord.balanceAfter ?? null,
          createdAt: mergedRecord.createdAt ?? now,
          activityId: mergedRecord.activityId,
          activityType: mergedRecord.activityType,
          activityUG: mergedRecord.activityUG,
          activityTopic: mergedRecord.activityTopic,
          activityDate: mergedRecord.activityDate,
          targetRole: 'Volunteer',
          skillSplit: true,
        },
      },
    });
  } else {
    // reclassify：纯技能记录，直接改分类
    transactItems.push({
      Update: {
        TableName: tables.pointsRecordsTable,
        Key: { recordId: mergedRecord.recordId },
        UpdateExpression: 'SET targetRole = :vol, skillSplit = :true',
        ConditionExpression: 'attribute_not_exists(skillSplit)',
        ExpressionAttributeValues: { ':vol': 'Volunteer', ':true': true },
      },
    });
  }

  // 3) 调整用户表：发放身份字段 -= skillSum，earnTotalVolunteer += skillSum。points/earnTotal 不变。
  transactItems.push({
    Update: {
      TableName: tables.usersTable,
      Key: { userId: group.userId },
      UpdateExpression:
        'SET #rf = if_not_exists(#rf, :zero) - :sv, earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) + :sv, updatedAt = :now',
      ExpressionAttributeNames: { '#rf': roleField },
      ExpressionAttributeValues: { ':sv': group.skillSum, ':zero': 0, ':now': now },
    },
  });

  await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
}

// ============================================================
// CLI
// ============================================================

function printPlan(plan: MigrationPlan): void {
  console.log('');
  console.log('========== 迁移影响清单 ==========');
  console.log(`将影响 ${plan.affectedRecordCount} 条记录、${plan.affectedUserIds.size} 个用户、技能分合计 ${plan.totalSkillPoints}`);
  console.log(`  - 拆分（含基础分）: ${plan.operations.filter(o => o.kind === 'split').length} 组`);
  console.log(`  - 改分类（纯技能）: ${plan.operations.filter(o => o.kind === 'reclassify').length} 组`);
  console.log(`  - 已迁移跳过（幂等）: ${plan.skippedAlreadyMigrated} 组`);
  if (plan.unmatchedGroups.length > 0) {
    console.log(`  ⚠ 未能定位历史合并记录: ${plan.unmatchedGroups.length} 组（需人工排查）`);
    for (const g of plan.unmatchedGroups) {
      console.log(`      userId=${g.userId} activityId=${g.activityId} distributionId=${g.distributionId} skillSum=${g.skillSum}`);
    }
  }
  console.log('==================================');
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || !isApply; // 缺省即 dry-run（安全）

  const region = process.env.AWS_REGION || 'ap-northeast-1';
  const usersTable = process.env.USERS_TABLE || 'PointsMall-Users';
  const pointsRecordsTable = process.env.POINTS_RECORDS_TABLE || 'PointsMall-PointsRecords';
  const claimsTable = process.env.CLAIMS_TABLE || process.env.ACTIVITY_SKILL_CLAIMS_TABLE || 'PointsMall-ActivitySkillClaims';

  const raw = new DynamoDBClient({ region });
  const doc = DynamoDBDocumentClient.from(raw);

  console.log(`[migrate-skill-points] region=${region}`);
  console.log(`[migrate-skill-points] usersTable=${usersTable}`);
  console.log(`[migrate-skill-points] pointsRecordsTable=${pointsRecordsTable}`);
  console.log(`[migrate-skill-points] claimsTable=${claimsTable}`);
  console.log(`[migrate-skill-points] mode=${isApply ? 'APPLY' : 'DRY-RUN'}`);

  console.log('[migrate-skill-points] 扫描技能认领并构建迁移计划...');
  const plan = await buildPlan(doc, { pointsRecordsTable, claimsTable });
  printPlan(plan);

  if (!isApply) {
    console.log('[migrate-skill-points] DRY-RUN 完成，未写入任何数据。确认无误后追加 --apply 执行。');
    return;
  }

  if (isDryRun && isApply) {
    // 同时传入两个标记时以 apply 为准，但提示。
    console.log('[migrate-skill-points] 同时检测到 --dry-run 与 --apply，将按 APPLY 执行。');
  }

  console.log(`[migrate-skill-points] 开始执行 ${plan.operations.length} 个迁移操作...`);
  const loggedUsers = new Set<string>();
  let done = 0;
  for (const op of plan.operations) {
    // 写操作前记录用户迁移前快照（便于核对/回滚），每个用户仅记录一次。
    if (!loggedUsers.has(op.group.userId)) {
      loggedUsers.add(op.group.userId);
      try {
        const snap = await doc.send(
          new GetCommand({
            TableName: usersTable,
            Key: { userId: op.group.userId },
            ProjectionExpression: 'earnTotalLeader, earnTotalSpeaker, earnTotalVolunteer, points, earnTotal',
          }),
        );
        const u = snap.Item ?? {};
        console.log(
          `[snapshot] userId=${op.group.userId} ` +
            `points=${u.points ?? 0} earnTotal=${u.earnTotal ?? 0} ` +
            `earnTotalLeader=${u.earnTotalLeader ?? 0} earnTotalSpeaker=${u.earnTotalSpeaker ?? 0} earnTotalVolunteer=${u.earnTotalVolunteer ?? 0}`,
        );
      } catch (err) {
        console.warn(`[snapshot] 读取用户 ${op.group.userId} 失败:`, err);
      }
    }

    try {
      await applyOperation(doc, { usersTable, pointsRecordsTable }, op);
      done++;
    } catch (err: any) {
      if (err?.name === 'TransactionCanceledException' || err?.name === 'ConditionalCheckFailedException') {
        // 幂等：记录已被迁移（skillSplit 已存在），跳过。
        console.log(
          `[skip] 记录 ${op.mergedRecord.recordId}（userId=${op.group.userId} activityId=${op.group.activityId}）已迁移，跳过。`,
        );
      } else {
        console.error(
          `[error] 迁移失败 recordId=${op.mergedRecord.recordId} userId=${op.group.userId}:`,
          err,
        );
        throw err;
      }
    }
  }

  console.log(`[migrate-skill-points] APPLY 完成：成功 ${done}/${plan.operations.length} 个操作。`);
}

// Only run the migration when executed directly as a script (e.g. via ts-node),
// not when imported for testing.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
