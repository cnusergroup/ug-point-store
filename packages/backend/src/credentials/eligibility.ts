// Credential self-application eligibility computation module.
//
// 资格判定：基于用户的身份积分记录、活动-证书模版关联映射与已申请证书集合，
// 计算用户的「可申请项（Eligible_Application）」与「已申请项」。
//
// 本文件中的核心计算为纯函数（不访问 DynamoDB），便于单元/属性测试。
// I/O 编排（getMyApplications）在文件末尾实现：查询积分记录 / 关联 / 已申请证书
// 三类数据后调用纯函数归约（只读，零副作用）。

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  ActivityTemplateAssociation,
  Credential,
  CredentialStatus,
  SourceRole,
} from './types';
import { SOURCE_ROLE_CODES } from './types';

/** 可申请项 / 已申请项（Eligible_Application 的展示形态） */
export interface EligibleItem {
  activityId: string;
  sourceRole: SourceRole;
  eventName: string;
  identityText: string;
  applied: boolean; // 是否已申请
  credentialId?: string; // 已申请时的凭证 ID
  status?: CredentialStatus; // 已申请时的证书状态（active / revoked）
}

/** 合法的来源身份集合，用于排除 SpecialActivity 等非身份积分 targetRole */
const VALID_SOURCE_ROLES = new Set<string>(Object.keys(SOURCE_ROLE_CODES));

/**
 * 纯函数：给定用户的身份积分记录、活动-关联映射、已申请证书集合，
 * 计算可申请项与已申请项的合并列表。不访问 DynamoDB。
 *
 * 判定规则（需求 3.1–3.6）：
 *  1. 仅取 targetRole ∈ {Speaker, UserGroupLeader, Volunteer} 且 activityId 非空的记录，
 *     显式排除 targetRole = SpecialActivity 与无 activityId 的记录。
 *  2. 按 (activityId, sourceRole) 去重，同一三元组的多条记录只产生一个候选。
 *  3. 候选活动必须存在 Activity_Template_Association，否则丢弃。
 *  4. sourceRole 必须在该关联的 allowedRoles 中，否则丢弃。
 *  5. 若已存在该三元组对应的自助证书（无论 active 或 revoked），标记 applied = true
 *     并附带 credentialId/status；否则为可申请项（applied = false）。
 */
export function computeEligibleApplications(args: {
  identityPointsRecords: Array<{ activityId: string; targetRole: SourceRole }>;
  associationsByActivityId: Map<string, ActivityTemplateAssociation>;
  appliedCredentials: Array<{
    sourceActivityId: string;
    sourceRole: SourceRole;
    credentialId: string;
    status: CredentialStatus;
  }>;
}): EligibleItem[] {
  const { identityPointsRecords, associationsByActivityId, appliedCredentials } =
    args;

  // 以 (activityId, sourceRole) 为键索引已申请证书；同一三元组多条记录保留首个遇到的。
  const appliedByTriple = new Map<
    string,
    { credentialId: string; status: CredentialStatus }
  >();
  for (const cred of appliedCredentials) {
    const key = tripleKey(cred.sourceActivityId, cred.sourceRole);
    if (!appliedByTriple.has(key)) {
      appliedByTriple.set(key, {
        credentialId: cred.credentialId,
        status: cred.status,
      });
    }
  }

  // 按 (activityId, sourceRole) 去重，逐条产出 EligibleItem。
  const seen = new Set<string>();
  const items: EligibleItem[] = [];

  for (const record of identityPointsRecords) {
    const { activityId, targetRole } = record;

    // 排除无 activityId 以及非身份积分（如 SpecialActivity）的记录。
    if (!activityId) continue;
    if (!VALID_SOURCE_ROLES.has(targetRole)) continue;

    const sourceRole = targetRole;
    const key = tripleKey(activityId, sourceRole);
    if (seen.has(key)) continue;
    seen.add(key);

    // 活动必须存在关联。
    const association = associationsByActivityId.get(activityId);
    if (!association) continue;

    // sourceRole 必须在关联的允许身份集合中。
    const allowed = association.allowedRoles.find((r) => r.role === sourceRole);
    if (!allowed) continue;

    const applied = appliedByTriple.get(key);
    if (applied) {
      items.push({
        activityId,
        sourceRole,
        eventName: association.eventName,
        identityText: allowed.identityText,
        applied: true,
        credentialId: applied.credentialId,
        status: applied.status,
      });
    } else {
      items.push({
        activityId,
        sourceRole,
        eventName: association.eventName,
        identityText: allowed.identityText,
        applied: false,
      });
    }
  }

  return items;
}

/** 拼装 (activityId, sourceRole) 去重键 */
function tripleKey(activityId: string, sourceRole: SourceRole | string): string {
  return `${activityId}#${sourceRole}`;
}

// ============================================================
// I/O orchestration: getMyApplications
// ============================================================

/** GSI names used by the eligibility orchestration. */
const POINTS_RECORDS_USER_INDEX = 'userId-createdAt-index';
const ASSOCIATIONS_ACTIVITY_INDEX = 'activityId-index';
const CREDENTIALS_APPLIED_BY_USER_INDEX = 'appliedByUserId-index';

/** Table names required by `getMyApplications`. */
export interface EligibilityTables {
  /** `PointsMall-PointsRecords`（只读，经 userId-createdAt-index GSI 查询）。 */
  pointsRecordsTable: string;
  /** `PointsMall-ActivityTemplateAssociations`（只读，经 activityId-index GSI 查询）。 */
  associationsTable: string;
  /** `PointsMall-Credentials`（只读，经 appliedByUserId-index GSI 查询本人已申请证书）。 */
  credentialsTable: string;
}

export interface MyApplicationsResult {
  items: EligibleItem[];
}

/**
 * I/O 编排：查询数据 → 调用纯函数 `computeEligibleApplications` 返回合并列表。
 *
 * 数据源（全部只读，零副作用，需求 11.1）：
 *  1. 经 `userId-createdAt-index` GSI 查询该用户的全部积分记录，归约为带 `activityId`
 *     且 `targetRole ∈ {Speaker, UserGroupLeader, Volunteer}` 的身份积分记录
 *     `{ activityId, targetRole }`（纯函数会再次过滤，这里先收窄形态）。
 *  2. 对出现过的每个 distinct `activityId`，经关联表 `activityId-index` GSI 查询其
 *     Activity_Template_Association，构建 `Map<activityId, association>`。
 *  3. 经 Credentials 表 `appliedByUserId-index` GSI 查询本人已申请的自助证书，
 *     归约为 `{ sourceActivityId, sourceRole, credentialId, status }`。
 *
 * 仅使用入参 `userId` 作为查询主键，忽略任何客户端提交的标识（需求 9.5）。
 * 读数据失败时让底层错误向上抛出，由 handler 返回描述性错误而非空列表（需求 3.7）。
 *
 * @param userId - 认证身份确定的 userId（唯一身份来源；需求 9.5）
 * @param dynamoClient - DynamoDB Document Client 实例
 * @param tables - 表名（需 pointsRecordsTable / associationsTable / credentialsTable）
 */
export async function getMyApplications(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: EligibilityTables,
): Promise<MyApplicationsResult> {
  // 1. 查询用户身份积分记录，收窄为 { activityId, targetRole }。
  const identityPointsRecords = await queryIdentityPointsRecords(
    userId,
    dynamoClient,
    tables.pointsRecordsTable,
  );

  // 2. 对出现过的每个 distinct activityId 查询关联，构建映射。
  const distinctActivityIds = new Set<string>();
  for (const record of identityPointsRecords) {
    if (record.activityId) distinctActivityIds.add(record.activityId);
  }
  const associationsByActivityId = await queryAssociationsByActivityIds(
    distinctActivityIds,
    dynamoClient,
    tables.associationsTable,
  );

  // 3. 查询本人已申请的自助证书。
  const appliedCredentials = await queryAppliedCredentials(
    userId,
    dynamoClient,
    tables.credentialsTable,
  );

  // 4. 调用纯函数归约。
  const items = computeEligibleApplications({
    identityPointsRecords,
    associationsByActivityId,
    appliedCredentials,
  });

  return { items };
}

/**
 * 经 `userId-createdAt-index` GSI 查询用户全部积分记录，分页拉全，
 * 收窄为 `{ activityId, targetRole }`（仅保留带 activityId 的记录；
 * 身份/特殊活动的进一步过滤交由纯函数完成）。
 */
async function queryIdentityPointsRecords(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
): Promise<Array<{ activityId: string; targetRole: SourceRole }>> {
  const records: Array<{ activityId: string; targetRole: SourceRole }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: POINTS_RECORDS_USER_INDEX,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ProjectionExpression: 'activityId, targetRole',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const activityId = (item.activityId as string) ?? '';
      const targetRole = (item.targetRole as string) ?? '';
      if (!activityId) continue;
      records.push({ activityId, targetRole: targetRole as SourceRole });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}

/**
 * 对给定的 distinct activityId 集合，逐个经关联表 `activityId-index` GSI
 * 查询其 Activity_Template_Association，构建 `Map<activityId, association>`。
 * 未命中的 activityId 不进入映射。
 */
async function queryAssociationsByActivityIds(
  activityIds: Set<string>,
  dynamoClient: DynamoDBDocumentClient,
  associationsTable: string,
): Promise<Map<string, ActivityTemplateAssociation>> {
  const map = new Map<string, ActivityTemplateAssociation>();

  await Promise.all(
    [...activityIds].map(async (activityId) => {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: associationsTable,
          IndexName: ASSOCIATIONS_ACTIVITY_INDEX,
          KeyConditionExpression: 'activityId = :aid',
          ExpressionAttributeValues: { ':aid': activityId },
          Limit: 1,
        }),
      );

      const item = (result.Items ?? [])[0];
      if (item) {
        map.set(activityId, item as ActivityTemplateAssociation);
      }
    }),
  );

  return map;
}

/**
 * 经 Credentials 表 `appliedByUserId-index` GSI 查询本人全部已申请的自助证书
 * （含 active 与 revoked），分页拉全，归约为纯函数所需的形态。
 */
async function queryAppliedCredentials(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  credentialsTable: string,
): Promise<
  Array<{
    sourceActivityId: string;
    sourceRole: SourceRole;
    credentialId: string;
    status: CredentialStatus;
  }>
> {
  const applied: Array<{
    sourceActivityId: string;
    sourceRole: SourceRole;
    credentialId: string;
    status: CredentialStatus;
  }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: credentialsTable,
        IndexName: CREDENTIALS_APPLIED_BY_USER_INDEX,
        KeyConditionExpression: 'appliedByUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const cred = item as Credential;
      // 仅纳入带来源标识的自助证书（sourceActivityId + sourceRole 非空）。
      if (!cred.sourceActivityId || !cred.sourceRole) continue;
      applied.push({
        sourceActivityId: cred.sourceActivityId,
        sourceRole: cred.sourceRole,
        credentialId: cred.credentialId,
        status: cred.status,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return applied;
}
