// Self-applied credential application module
//
// Task 5.1: types + pure recipient name validation.
// Task 5.3: `applyForCredential` main orchestration.
//
// Concurrency & data-isolation design (design.md「并发去重策略」, Requirements
// 5.5, 5.6, 6.3, 11.1):
//  - The "at most one credential per (userId, activityId, sourceRole) triple"
//    guarantee is provided by a strongly-consistent conditional write (a single
//    "apply lock" item) on the `PointsMall-CredentialSequences` table keyed by
//    `appliedDedupeKey = {userId}#{activityId}#{sourceRole}`.
//  - Credential-ID sequence uniqueness is provided by the existing atomic
//    counter (`getNextSequence`) on the same table, keyed by
//    `{eventPrefix}-{year}-{season}-{roleCode}` (a disjoint key namespace).
//  - NO points-mall core table (points records, balances, products, orders) is
//    ever written — points records are READ-ONLY here, used only for the
//    eligibility re-check.

import {
  type DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAssociationByActivityId } from './association';
import { formatCredentialId } from './credential-id';
import { getNextSequence } from './sequence';
import type { AllowedRoleConfig, Credential, SourceRole } from './types';

/** 自助申请提交输入（用户提交的请求体） */
export interface ApplyInput {
  activityId: string;
  sourceRole: SourceRole;
  recipientName: string;
}

/** 自助申请结果：成功返回凭证 ID 与公开页面 URL，失败返回结构化错误 */
export type ApplyResult =
  | { success: true; credentialId: string; url: string }
  | { success: false; code: string; message: string; statusCode: number };

/**
 * Table names required by `applyForCredential`.
 *
 * Shape is consistent with `EligibilityTables` (eligibility.ts) and
 * `MyCredentialsTables` (my-credentials.ts): every field is a DynamoDB table
 * name. `credentialSequencesTable` is the existing `PointsMall-CredentialSequences`
 * table that hosts BOTH the per-triple apply-lock item and the credential-ID
 * atomic counter.
 */
export interface SelfApplyTables {
  /** `PointsMall-Credentials`（写入新证书 + 经 appliedDedupeKey-index 复核去重）。 */
  credentialsTable: string;
  /** `PointsMall-ActivityTemplateAssociations`（只读，经 activityId-index 查关联）。 */
  associationsTable: string;
  /** `PointsMall-PointsRecords`（只读，经 userId-createdAt-index 复核身份积分）。 */
  pointsRecordsTable: string;
  /** `PointsMall-CredentialSequences`（申请锁条件写入 + 凭证序号原子递增）。 */
  credentialSequencesTable: string;
}

/** 收件人姓名长度上下限（去除首尾空白后） */
const RECIPIENT_NAME_MIN_LENGTH = 1;
const RECIPIENT_NAME_MAX_LENGTH = 100;

/**
 * 纯函数：校验收件人姓名。
 *
 * 去除首尾空白后，当且仅当长度在 1–100 之间时判定为合法，
 * 合法时返回去空白后的姓名值；否则返回描述性错误。
 *
 * - 非字符串输入 → 非法
 * - 空字符串 / 纯空白字符串（去空白后长度 0）→ 非法
 * - 去空白后超过 100 个字符 → 非法
 */
export function validateRecipientName(
  name: unknown,
): { valid: true; value: string } | { valid: false; message: string } {
  if (typeof name !== 'string') {
    return { valid: false, message: '收件人姓名必须为字符串' };
  }

  const trimmed = name.trim();

  if (trimmed.length < RECIPIENT_NAME_MIN_LENGTH) {
    return { valid: false, message: '姓名不能为空' };
  }

  if (trimmed.length > RECIPIENT_NAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `姓名长度不能超过 ${RECIPIENT_NAME_MAX_LENGTH} 个字符`,
    };
  }

  return { valid: true, value: trimmed };
}

// ============================================================
// applyForCredential — main orchestration (Task 5.3)
// ============================================================

/** GSI on PointsMall-PointsRecords: PK=userId, SK=createdAt. */
const POINTS_RECORDS_USER_INDEX = 'userId-createdAt-index';

/** Valid Source_Role values — used to filter identity points records. */
const VALID_SOURCE_ROLES = new Set<SourceRole>([
  'Speaker',
  'UserGroupLeader',
  'Volunteer',
]);

/**
 * Main orchestration for self-applying a credential.
 *
 * Flow (design.md component 4 + 「并发去重策略」, Requirements 5.x / 6.x / 7.x):
 *  1. Validate `recipientName` (trim → 1–100) → `INVALID_REQUEST` (400) on fail.
 *  2. Eligibility re-check (defends against a bypassed frontend):
 *     a. Load the activity's `Activity_Template_Association`; missing → 403
 *        `NOT_ELIGIBLE`.
 *     b. Confirm `sourceRole` is in the association's `allowedRoles`.
 *     c. Confirm the user has ≥1 identity points record for
 *        `(activityId, sourceRole)` → otherwise 403 `NOT_ELIGIBLE`.
 *     d. If a self-applied credential already exists for this triple → 409
 *        `ALREADY_APPLIED`「该证书已申请」.
 *  3. Select the `allowedRoles` entry whose `role === sourceRole` to obtain
 *     `identityText` + `roleCode`; missing → abort with 500 `INTERNAL_ERROR`
 *     writing nothing (Requirement 6.5).
 *  4. Acquire the apply-lock: conditional `PutItem` on the CredentialSequences
 *     table with `sequenceKey = appliedDedupeKey` and
 *     `attribute_not_exists(sequenceKey)`. A `ConditionalCheckFailedException`
 *     → 409 `ALREADY_APPLIED` (strong-consistency mutex; Requirements 5.5, 5.6).
 *  5. Allocate an atomic sequence (`getNextSequence`, count 1) → build the
 *     credential ID via `formatCredentialId`.
 *  6. Assemble & write the `Credential` into `PointsMall-Credentials`
 *     (`status='active'`, `locale='en'`, `issueDate=今日 YYYY-MM-DD`, the source
 *     identity fields, etc.).
 *  7. Return `{ credentialId, url }` where `url = {baseUrl}/c/{credentialId}`.
 *
 * NO points-mall core table is written; points records are read-only here.
 *
 * @param userId - Authenticated user's id (the ONLY identity source; Req 9.5).
 * @param input - `{ activityId, sourceRole, recipientName }` request body.
 * @param dynamoClient - DynamoDB Document Client instance.
 * @param tables - Table names (see `SelfApplyTables`).
 * @param baseUrl - Public base URL used to build the `/c/{credentialId}` link.
 */
export async function applyForCredential(
  userId: string,
  input: ApplyInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: SelfApplyTables,
  baseUrl: string,
): Promise<ApplyResult> {
  // --- 1. Validate recipient name. ---
  const nameResult = validateRecipientName(input?.recipientName);
  if (!nameResult.valid) {
    return {
      success: false,
      code: 'INVALID_REQUEST',
      message: nameResult.message,
      statusCode: 400,
    };
  }
  const recipientName = nameResult.value;

  const activityId = typeof input?.activityId === 'string' ? input.activityId : '';
  const sourceRole = input?.sourceRole;

  if (!activityId || !sourceRole || !VALID_SOURCE_ROLES.has(sourceRole)) {
    return {
      success: false,
      code: 'NOT_ELIGIBLE',
      message: '不满足证书申请资格',
      statusCode: 403,
    };
  }

  // --- 2a/2b. Load association + confirm sourceRole is allowed. ---
  const association = await getAssociationByActivityId(
    activityId,
    dynamoClient,
    tables.associationsTable,
  );
  if (!association) {
    return {
      success: false,
      code: 'NOT_ELIGIBLE',
      message: '不满足证书申请资格',
      statusCode: 403,
    };
  }

  const allowed: AllowedRoleConfig | undefined = association.allowedRoles.find(
    (r) => r.role === sourceRole,
  );
  if (!allowed) {
    return {
      success: false,
      code: 'NOT_ELIGIBLE',
      message: '不满足证书申请资格',
      statusCode: 403,
    };
  }

  // --- 2c. Confirm the user has identity points for (activityId, sourceRole). ---
  const hasIdentityPoints = await userHasIdentityPoints(
    userId,
    activityId,
    sourceRole,
    dynamoClient,
    tables.pointsRecordsTable,
  );
  if (!hasIdentityPoints) {
    return {
      success: false,
      code: 'NOT_ELIGIBLE',
      message: '不满足证书申请资格',
      statusCode: 403,
    };
  }

  // --- 2d. Reject if a credential already exists for this triple. ---
  const appliedDedupeKey = `${userId}#${activityId}#${sourceRole}`;
  const alreadyApplied = await dedupeKeyExists(
    appliedDedupeKey,
    dynamoClient,
    tables.credentialsTable,
  );
  if (alreadyApplied) {
    return {
      success: false,
      code: 'ALREADY_APPLIED',
      message: '该证书已申请',
      statusCode: 409,
    };
  }

  // --- 3. (Re-)select identity text + role code. ---
  // `allowed` is already the matching config; guard defensively per Req 6.5.
  if (!allowed.identityText || !allowed.roleCode) {
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      message: '证书模版关联缺少匹配身份配置',
      statusCode: 500,
    };
  }
  const { identityText, roleCode } = allowed;

  // --- 4. Acquire the apply-lock (strong-consistency mutex). ---
  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: tables.credentialSequencesTable,
        Item: { sequenceKey: appliedDedupeKey, claimedAt: new Date().toISOString() },
        ConditionExpression: 'attribute_not_exists(sequenceKey)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      return {
        success: false,
        code: 'ALREADY_APPLIED',
        message: '该证书已申请',
        statusCode: 409,
      };
    }
    throw err;
  }

  // --- 5. Allocate atomic sequence → build credential ID. ---
  const startSequence = await getNextSequence(
    dynamoClient,
    tables.credentialSequencesTable,
    association.eventPrefix,
    association.year,
    association.season,
    roleCode,
    1,
  );

  const credentialId = formatCredentialId({
    eventPrefix: association.eventPrefix,
    year: association.year,
    season: association.season,
    roleCode,
    sequence: startSequence,
  });

  // --- 6. Assemble & write the credential. ---
  const now = new Date().toISOString();
  const issueDate = now.slice(0, 10); // 今日 YYYY-MM-DD

  const credential: Credential = {
    credentialId,
    recipientName,
    eventName: association.eventName,
    role: sourceRole,
    issueDate,
    issuingOrganization: association.issuingOrganization,
    status: 'active',
    locale: 'en',
    createdAt: now,
    identityText,
    appliedByUserId: userId,
    sourceActivityId: activityId,
    sourceRole,
    appliedDedupeKey,
    ...(association.eventDate ? { eventDate: association.eventDate } : {}),
    ...(association.eventLocation ? { eventLocation: association.eventLocation } : {}),
    // "Hosted by" line: if showHostUg is set, include "User Group China - {UG名}"
    ...(association.showHostUg && association.hostUgName
      ? { hostByLine: `Amazon Web Services User Group China - ${association.hostUgName}` }
      : {}),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.credentialsTable,
      Item: credential,
    }),
  );

  // --- 7. Return result. ---
  return {
    success: true,
    credentialId,
    url: `${baseUrl}/c/${credentialId}`,
  };
}

// ============================================================
// Internal helpers (read-only DynamoDB access)
// ============================================================

/**
 * Check whether the user has at least one identity points record for the given
 * `(activityId, sourceRole)`: a `PointsRecord` with `targetRole === sourceRole`
 * and the matching `activityId`. Reads via the `userId-createdAt-index` GSI;
 * never writes. (Requirements 3.1, 5.7, 11.1.)
 */
async function userHasIdentityPoints(
  userId: string,
  activityId: string,
  sourceRole: SourceRole,
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
): Promise<boolean> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: POINTS_RECORDS_USER_INDEX,
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: 'activityId = :aid AND targetRole = :role',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':aid': activityId,
          ':role': sourceRole,
        },
        ProjectionExpression: 'activityId, targetRole',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    if ((result.Items ?? []).length > 0) {
      return true;
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return false;
}

/**
 * Check whether a self-applied credential already exists for the given
 * `appliedDedupeKey` via the `appliedDedupeKey-index` GSI (eventually
 * consistent; the strong-consistency guarantee is the apply-lock in step 4).
 * Read-only.
 */
async function dedupeKeyExists(
  appliedDedupeKey: string,
  dynamoClient: DynamoDBDocumentClient,
  credentialsTable: string,
): Promise<boolean> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: credentialsTable,
      IndexName: 'appliedDedupeKey-index',
      KeyConditionExpression: 'appliedDedupeKey = :key',
      ExpressionAttributeValues: { ':key': appliedDedupeKey },
      Limit: 1,
    }),
  );
  return (result.Items ?? []).length > 0;
}

/** Detect a DynamoDB conditional-write failure across SDK error shapes. */
function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}
