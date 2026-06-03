// Activity-credential template association: validation, role-code derivation,
// authorization and DynamoDB-backed CRUD.
//
// This module hosts the Activity_Template_Association logic for the credential
// self-application feature. Task 2.1 implemented the *pure* functions
// (`deriveRoleCode`, `validateAssociationInput`) — these never touch DynamoDB so
// they can be exhaustively property-tested. Task 2.4 adds the SuperAdmin
// authorization helper (`assertSuperAdmin`) and the DynamoDB-backed CRUD
// functions (createAssociation / updateAssociation / deleteAssociation /
// listAssociations / getAssociationByActivityId), which reuse the
// validation/normalization produced by the pure functions.
//
// Data isolation (Requirements 11.2, 11.3): associations live in their own
// `PointsMall-ActivityTemplateAssociations` table; the only points-mall core
// table touched is `PointsMall-Activities`, and that is READ-ONLY (to validate
// that the referenced activity exists). No products / orders / points records /
// user balances are ever created, modified or deleted here.

import {
  type DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type {
  ActivityTemplateAssociation,
  AllowedRoleConfig,
  Season,
  SourceRole,
} from './types';
import { SOURCE_ROLE_CODES } from './types';

// ============================================================
// Constants
// ============================================================

const DEFAULT_ISSUING_ORGANIZATION = 'AWS User Group China';

/** GSI on PointsMall-ActivityTemplateAssociations: PK=activityId (unique per activity). */
const ACTIVITY_ID_INDEX = 'activityId-index';

/** Valid Source_Role values (Speaker / UserGroupLeader / Volunteer). */
const VALID_SOURCE_ROLES: readonly SourceRole[] = [
  'Speaker',
  'UserGroupLeader',
  'Volunteer',
];

/** Valid season values used in credential IDs. */
const VALID_SEASONS: readonly Season[] = ['Spring', 'Summer', 'Fall', 'Winter'];

/** Event prefix: 1–20 chars consisting solely of uppercase letters A–Z and hyphens. */
const EVENT_PREFIX_REGEX = /^[A-Z-]{1,20}$/;

/** Year: exactly four digits. */
const YEAR_REGEX = /^\d{4}$/;

const MIN_YEAR = 2000;
const MAX_YEAR = 2100; // inclusive — matches design.md & Requirement 2.3

// ============================================================
// Types
// ============================================================

/** Create/edit association input (submitted by an admin). */
export interface AssociationInput {
  activityId: string;
  eventName: string;
  eventPrefix: string;
  year: string;
  season: string;
  allowedRoles: Array<{ role: string; identityText: string }>;
  eventDate?: string;
  eventLocation?: string;
  issuingOrganization?: string;
}

/**
 * Validated + normalized association payload.
 *
 * This is the persistence-ready shape minus the server-assigned audit fields
 * (`associationId`, `createdAt`, `createdBy`, ...). `roleCode` is backfilled for
 * every allowed role and `issuingOrganization` is defaulted.
 */
export interface NormalizedAssociation {
  activityId: string;
  eventName: string;
  eventPrefix: string;
  year: string;
  season: Season;
  allowedRoles: AllowedRoleConfig[];
  locale: 'en';
  issuingOrganization: string;
  eventDate?: string;
  eventLocation?: string;
}

export type AssociationValidationResult =
  | { valid: true; normalized: NormalizedAssociation }
  | { valid: false; error: { code: string; message: string } };

// ============================================================
// Role-code derivation (pure)
// ============================================================

/**
 * Derive the Role_Code for a Source_Role using the fixed mapping
 * (`Speaker → SPK`, `Volunteer → VOL`, `UserGroupLeader → UGL`).
 *
 * Throws when given a value outside the Source_Role set so that callers and
 * property tests can detect invalid input rather than silently producing an
 * undefined code.
 */
export function deriveRoleCode(role: SourceRole): string {
  const code = SOURCE_ROLE_CODES[role];
  if (!code) {
    throw new Error(`未知的来源身份 (role)：${String(role)}`);
  }
  return code;
}

// ============================================================
// Input validation (pure — no DynamoDB access)
// ============================================================

/**
 * Validate and normalize an Activity_Template_Association input.
 *
 * Validation rules (Requirements 1.1–1.4, 1.7, 2.3, 2.4, 2.5, 2.7):
 *  - `activityId`     : required, non-empty string.
 *  - `eventName`      : required, 1–200 chars after trimming.
 *  - `eventPrefix`    : required, matches /^[A-Z-]{1,20}$/ (A–Z and '-' only).
 *  - `year`           : required, four digits, value in [2000, 2100].
 *  - `season`         : required, one of Spring/Summer/Fall/Winter.
 *  - `allowedRoles`   : required, 1–3 items; each `role` is a valid Source_Role,
 *                       roles are mutually distinct, `identityText` is 1–100 chars.
 *  - `eventLocation`  : optional; when provided, 1–200 chars after trimming.
 *  - `issuingOrganization`: optional; when provided, 1–200 chars after trimming;
 *                       defaults to 'AWS User Group China' when absent.
 *
 * On success returns `{ valid: true, normalized }` with each allowed role's
 * `roleCode` backfilled and `issuingOrganization`/`locale` defaulted. On failure
 * returns `{ valid: false, error }` whose `message` names the offending field;
 * `code` is `MISSING_REQUIRED_FIELD` for absent required fields and
 * `INVALID_REQUEST` for constraint violations / illegal or duplicate roles.
 */
export function validateAssociationInput(
  input: unknown,
): AssociationValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('请求体必须为对象');
  }
  const data = input as Record<string, unknown>;

  // --- activityId (required) ---
  if (isAbsent(data.activityId)) {
    return missing('关联活动 (activityId)');
  }
  if (typeof data.activityId !== 'string') {
    return invalid('关联活动 (activityId) 必须为字符串');
  }
  const activityId = data.activityId.trim();
  if (activityId.length === 0) {
    return missing('关联活动 (activityId)');
  }

  // --- eventName (required, 1–200 after trim) ---
  if (isAbsent(data.eventName)) {
    return missing('活动名称 (eventName)');
  }
  if (typeof data.eventName !== 'string') {
    return invalid('活动名称 (eventName) 必须为字符串');
  }
  const eventName = data.eventName.trim();
  if (eventName.length < 1 || eventName.length > 200) {
    return invalid('活动名称 (eventName) 长度必须为 1 到 200 个字符');
  }

  // --- eventPrefix (required, /^[A-Z-]{1,20}$/) ---
  if (isAbsent(data.eventPrefix)) {
    return missing('凭证 ID 前缀 (eventPrefix)');
  }
  if (typeof data.eventPrefix !== 'string') {
    return invalid('凭证 ID 前缀 (eventPrefix) 必须为字符串');
  }
  const eventPrefix = data.eventPrefix;
  if (!EVENT_PREFIX_REGEX.test(eventPrefix)) {
    return invalid(
      '凭证 ID 前缀 (eventPrefix) 必须由 1 到 20 个大写字母 A–Z 与连字符 "-" 组成',
    );
  }

  // --- year (required, four digits, 2000–2100) ---
  if (isAbsent(data.year)) {
    return missing('凭证 ID 年份 (year)');
  }
  const year =
    typeof data.year === 'number' ? String(data.year) : data.year;
  if (typeof year !== 'string' || !YEAR_REGEX.test(year)) {
    return invalid('凭证 ID 年份 (year) 必须为四位数字');
  }
  const yearNum = parseInt(year, 10);
  if (yearNum < MIN_YEAR || yearNum > MAX_YEAR) {
    return invalid(
      `凭证 ID 年份 (year) 取值必须在 ${MIN_YEAR} 到 ${MAX_YEAR} 之间`,
    );
  }

  // --- season (required, enum) ---
  if (isAbsent(data.season)) {
    return missing('凭证 ID 季节 (season)');
  }
  if (
    typeof data.season !== 'string' ||
    !VALID_SEASONS.includes(data.season as Season)
  ) {
    return invalid(
      '凭证 ID 季节 (season) 必须为 Spring、Summer、Fall 或 Winter 之一',
    );
  }
  const season = data.season as Season;

  // --- allowedRoles (required, 1–3 items, distinct valid roles) ---
  if (
    data.allowedRoles === undefined ||
    data.allowedRoles === null ||
    !Array.isArray(data.allowedRoles) ||
    data.allowedRoles.length === 0
  ) {
    return missing('允许申请的身份 (allowedRoles)');
  }
  if (data.allowedRoles.length > 3) {
    return invalid('允许申请的身份 (allowedRoles) 至多包含 3 项');
  }

  const seenRoles = new Set<string>();
  const allowedRoles: AllowedRoleConfig[] = [];

  for (const rawItem of data.allowedRoles) {
    if (typeof rawItem !== 'object' || rawItem === null) {
      return invalid('允许申请的身份 (allowedRoles) 中存在非法项');
    }
    const item = rawItem as Record<string, unknown>;

    // role: must be a valid Source_Role
    const role = item.role;
    if (typeof role !== 'string' || !isValidSourceRole(role)) {
      return invalid(`允许申请的身份中存在非法身份 (role)：${String(role)}`);
    }
    // role: must be unique within the set
    if (seenRoles.has(role)) {
      return invalid(`允许申请的身份中存在重复身份 (role)：${role}`);
    }
    seenRoles.add(role);

    // identityText: required, 1–100 after trim
    if (isAbsent(item.identityText)) {
      return missing(`身份 ${role} 的证书身份文案 (identityText)`);
    }
    if (typeof item.identityText !== 'string') {
      return invalid(`身份 ${role} 的证书身份文案 (identityText) 必须为字符串`);
    }
    const identityText = item.identityText.trim();
    if (identityText.length < 1 || identityText.length > 100) {
      return invalid(
        `身份 ${role} 的证书身份文案 (identityText) 长度必须为 1 到 100 个字符`,
      );
    }

    allowedRoles.push({
      role,
      roleCode: deriveRoleCode(role),
      identityText,
    });
  }

  // --- eventLocation (optional, 1–200 after trim when provided) ---
  let eventLocation: string | undefined;
  if (!isAbsent(data.eventLocation)) {
    if (typeof data.eventLocation !== 'string') {
      return invalid('活动地点 (eventLocation) 必须为字符串');
    }
    const trimmed = data.eventLocation.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      return invalid('活动地点 (eventLocation) 长度必须为 1 到 200 个字符');
    }
    eventLocation = trimmed;
  }

  // --- issuingOrganization (optional, defaulted) ---
  let issuingOrganization = DEFAULT_ISSUING_ORGANIZATION;
  if (!isAbsent(data.issuingOrganization)) {
    if (typeof data.issuingOrganization !== 'string') {
      return invalid('签发组织 (issuingOrganization) 必须为字符串');
    }
    const trimmed = data.issuingOrganization.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      return invalid('签发组织 (issuingOrganization) 长度必须为 1 到 200 个字符');
    }
    issuingOrganization = trimmed;
  }

  // --- eventDate (optional, pass-through string) ---
  let eventDate: string | undefined;
  if (!isAbsent(data.eventDate)) {
    if (typeof data.eventDate !== 'string') {
      return invalid('活动日期 (eventDate) 必须为字符串');
    }
    eventDate = data.eventDate.trim();
  }

  const normalized: NormalizedAssociation = {
    activityId,
    eventName,
    eventPrefix,
    year,
    season,
    allowedRoles,
    locale: 'en',
    issuingOrganization,
    ...(eventDate ? { eventDate } : {}),
    ...(eventLocation ? { eventLocation } : {}),
  };

  return { valid: true, normalized };
}

// ============================================================
// Internal helpers
// ============================================================

/** A value is "absent" when it is undefined, null, or an empty string. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function isValidSourceRole(value: string): value is SourceRole {
  return (VALID_SOURCE_ROLES as readonly string[]).includes(value);
}

function missing(field: string): AssociationValidationResult {
  return {
    valid: false,
    error: { code: 'MISSING_REQUIRED_FIELD', message: `缺少必填字段：${field}` },
  };
}

function invalid(message: string): AssociationValidationResult {
  return { valid: false, error: { code: 'INVALID_REQUEST', message } };
}

// ============================================================
// Authorization (pure)
// ============================================================

export type AuthorizationResult =
  | { authorized: true }
  | { authorized: false; code: string; message: string; statusCode: number };

/**
 * Authorize an Activity_Template_Association mutating operation.
 *
 * Returns `{ authorized: true }` only when the caller's role set contains
 * `SuperAdmin`. For any role set lacking `SuperAdmin` (including `undefined` /
 * empty), returns a 403 result so the caller can reject the request WITHOUT
 * creating, modifying or deleting any association (Requirements 2.8, 2.9, 9.7).
 *
 * Pure & side-effect free so it can be exhaustively property-tested.
 */
export function assertSuperAdmin(roles: readonly string[] | undefined): AuthorizationResult {
  if (Array.isArray(roles) && roles.includes('SuperAdmin')) {
    return { authorized: true };
  }
  return {
    authorized: false,
    code: 'FORBIDDEN',
    message: '权限不足：仅 SuperAdmin 可管理活动-证书模版关联',
    statusCode: 403,
  };
}

// ============================================================
// CRUD result types
// ============================================================

export type AssociationResult =
  | { success: true; association: ActivityTemplateAssociation }
  | { success: false; code: string; message: string; statusCode: number };

export type ListAssociationsResult =
  | { success: true; associations: ActivityTemplateAssociation[] }
  | { success: false; code: string; message: string; statusCode: number };

export type DeleteAssociationResult =
  | { success: true; associationId: string }
  | { success: false; code: string; message: string; statusCode: number };

// ============================================================
// CRUD params
// ============================================================

export interface CreateAssociationParams {
  /** Raw admin-submitted input (validated internally). */
  input: unknown;
  /** Authenticated SuperAdmin userId, stored as `createdBy`. */
  createdBy: string;
  dynamoClient: DynamoDBDocumentClient;
  associationsTable: string;
  /** Read-only `PointsMall-Activities` table — used only to verify activityId exists. */
  activitiesTable: string;
}

export interface UpdateAssociationParams {
  associationId: string;
  input: unknown;
  /** Authenticated SuperAdmin userId, stored as `updatedBy`. */
  updatedBy: string;
  dynamoClient: DynamoDBDocumentClient;
  associationsTable: string;
  activitiesTable: string;
}

export interface DeleteAssociationParams {
  associationId: string;
  dynamoClient: DynamoDBDocumentClient;
  associationsTable: string;
}

export interface ListAssociationsParams {
  dynamoClient: DynamoDBDocumentClient;
  associationsTable: string;
}

// ============================================================
// CRUD operations (DynamoDB-backed)
// ============================================================

/**
 * Create an Activity_Template_Association.
 *
 * 1. Validate + normalize the input (pure).
 * 2. Verify the referenced `activityId` exists in the read-only
 *    `PointsMall-Activities` table (no write).
 * 3. De-duplicate by activityId via the `activityId-index` GSI — if an
 *    association already exists for the activity, reject with
 *    `DUPLICATE_ASSOCIATION` and leave the existing record untouched
 *    (Requirements 1.6, 2.6).
 * 4. Conditionally write the new item (`attribute_not_exists(associationId)`)
 *    as a defensive fallback against an `associationId` collision.
 *
 * No points-mall core data is created or modified (Requirements 11.2, 11.3).
 */
export async function createAssociation(
  params: CreateAssociationParams,
): Promise<AssociationResult> {
  const { input, createdBy, dynamoClient, associationsTable, activitiesTable } = params;

  // 1. Validate + normalize.
  const validation = validateAssociationInput(input);
  if (!validation.valid) {
    return {
      success: false,
      code: validation.error.code,
      message: validation.error.message,
      statusCode: 400,
    };
  }
  const normalized = validation.normalized;

  // 2. Verify the referenced activity exists (read-only).
  const activityExists = await activityExistsById(
    normalized.activityId,
    dynamoClient,
    activitiesTable,
  );
  if (!activityExists) {
    return {
      success: false,
      code: 'ACTIVITY_NOT_FOUND',
      message: `关联活动不存在 (activityId)：${normalized.activityId}`,
      statusCode: 404,
    };
  }

  // 3. De-duplicate by activityId via GSI.
  const existing = await getAssociationByActivityId(
    normalized.activityId,
    dynamoClient,
    associationsTable,
  );
  if (existing) {
    return {
      success: false,
      code: 'DUPLICATE_ASSOCIATION',
      message: '该活动已存在证书模版关联',
      statusCode: 409,
    };
  }

  // 4. Conditionally write the new item.
  const now = new Date().toISOString();
  const association: ActivityTemplateAssociation = {
    associationId: ulid(),
    ...normalized,
    createdAt: now,
    createdBy,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: associationsTable,
        Item: association,
        ConditionExpression: 'attribute_not_exists(associationId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      // Extremely unlikely (fresh ulid) — treat as duplicate fallback.
      return {
        success: false,
        code: 'DUPLICATE_ASSOCIATION',
        message: '该活动已存在证书模版关联',
        statusCode: 409,
      };
    }
    throw err;
  }

  return { success: true, association };
}

/**
 * Update an existing Activity_Template_Association.
 *
 * Loads the record by `associationId` (→ `ASSOCIATION_NOT_FOUND` when missing),
 * re-validates the input, verifies the referenced activity exists, preserves the
 * original `createdAt`/`createdBy`, and writes fresh `updatedAt`/`updatedBy`.
 * If the activityId is being changed, the new activityId must not already belong
 * to a different association (Requirements 1.6, 2.6).
 */
export async function updateAssociation(
  params: UpdateAssociationParams,
): Promise<AssociationResult> {
  const { associationId, input, updatedBy, dynamoClient, associationsTable, activitiesTable } =
    params;

  // 1. Validate + normalize.
  const validation = validateAssociationInput(input);
  if (!validation.valid) {
    return {
      success: false,
      code: validation.error.code,
      message: validation.error.message,
      statusCode: 400,
    };
  }
  const normalized = validation.normalized;

  // 2. Load existing record.
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: associationsTable,
      Key: { associationId },
    }),
  );
  if (!getResult.Item) {
    return {
      success: false,
      code: 'ASSOCIATION_NOT_FOUND',
      message: '证书模版关联不存在',
      statusCode: 404,
    };
  }
  const existing = getResult.Item as ActivityTemplateAssociation;

  // 3. Verify the referenced activity exists (read-only).
  const activityExists = await activityExistsById(
    normalized.activityId,
    dynamoClient,
    activitiesTable,
  );
  if (!activityExists) {
    return {
      success: false,
      code: 'ACTIVITY_NOT_FOUND',
      message: `关联活动不存在 (activityId)：${normalized.activityId}`,
      statusCode: 404,
    };
  }

  // 4. When the activityId changes, ensure it is not already taken by another
  //    association (one activity → at most one association).
  if (normalized.activityId !== existing.activityId) {
    const other = await getAssociationByActivityId(
      normalized.activityId,
      dynamoClient,
      associationsTable,
    );
    if (other && other.associationId !== associationId) {
      return {
        success: false,
        code: 'DUPLICATE_ASSOCIATION',
        message: '该活动已存在证书模版关联',
        statusCode: 409,
      };
    }
  }

  // 5. Build the updated item, preserving creation audit fields.
  const updated: ActivityTemplateAssociation = {
    associationId,
    ...normalized,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: associationsTable,
      Item: updated,
      ConditionExpression: 'attribute_exists(associationId)',
    }),
  );

  return { success: true, association: updated };
}

/**
 * Delete an Activity_Template_Association by `associationId`.
 *
 * Uses a conditional delete (`attribute_exists(associationId)`) so a missing
 * record is reported as `ASSOCIATION_NOT_FOUND` rather than silently succeeding.
 */
export async function deleteAssociation(
  params: DeleteAssociationParams,
): Promise<DeleteAssociationResult> {
  const { associationId, dynamoClient, associationsTable } = params;

  try {
    await dynamoClient.send(
      new DeleteCommand({
        TableName: associationsTable,
        Key: { associationId },
        ConditionExpression: 'attribute_exists(associationId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      return {
        success: false,
        code: 'ASSOCIATION_NOT_FOUND',
        message: '证书模版关联不存在',
        statusCode: 404,
      };
    }
    throw err;
  }

  return { success: true, associationId };
}

/**
 * List all Activity_Template_Associations (full scan with pagination).
 */
export async function listAssociations(
  params: ListAssociationsParams,
): Promise<ListAssociationsResult> {
  const { dynamoClient, associationsTable } = params;

  const associations: ActivityTemplateAssociation[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: associationsTable,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of result.Items ?? []) {
      associations.push(item as ActivityTemplateAssociation);
    }
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  // Newest first for a stable admin listing.
  associations.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { success: true, associations };
}

/**
 * Look up the single Activity_Template_Association for an activity via the
 * `activityId-index` GSI. Returns `null` when no association exists.
 *
 * Used for de-duplication, the "one activity → at most one association"
 * invariant, and eligibility computation.
 */
export async function getAssociationByActivityId(
  activityId: string,
  dynamoClient: DynamoDBDocumentClient,
  associationsTable: string,
): Promise<ActivityTemplateAssociation | null> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: associationsTable,
      IndexName: ACTIVITY_ID_INDEX,
      KeyConditionExpression: 'activityId = :aid',
      ExpressionAttributeValues: { ':aid': activityId },
      Limit: 1,
    }),
  );

  const item = result.Items?.[0];
  return item ? (item as ActivityTemplateAssociation) : null;
}

// ============================================================
// DynamoDB internal helpers
// ============================================================

/**
 * Check whether an activity exists in the read-only `PointsMall-Activities`
 * table. Performs a key-only `GetCommand`; never writes.
 */
async function activityExistsById(
  activityId: string,
  dynamoClient: DynamoDBDocumentClient,
  activitiesTable: string,
): Promise<boolean> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: activitiesTable,
      Key: { activityId },
      ProjectionExpression: 'activityId',
    }),
  );
  return Boolean(result.Item);
}

/** Detect a DynamoDB conditional-write failure across SDK error shapes. */
function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}
