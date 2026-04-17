import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { UGRecord } from '@points-mall/shared';

// ============================================================
// Interfaces
// ============================================================

/** 创建 UG 输入 */
export interface CreateUGInput {
  name: string;
}

/** UG 操作结果 */
export interface UGOperationResult {
  success: boolean;
  ug?: UGRecord;
  error?: { code: string; message: string };
}

/** UG 列表查询选项 */
export interface ListUGsOptions {
  status?: 'active' | 'inactive' | 'all';
}

/** UG 列表查询结果 */
export interface ListUGsResult {
  success: boolean;
  ugs?: UGRecord[];
  error?: { code: string; message: string };
}

/** 名称验证结果 */
export type UGNameValidationResult =
  | { valid: true }
  | { valid: false; error: { code: string; message: string } };

/** 分配负责人输入 */
export interface AssignLeaderInput {
  ugId: string;
  leaderId: string;
}

/** 分配负责人结果 */
export interface AssignLeaderResult {
  success: boolean;
  error?: { code: string; message: string };
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate UG name: must be a non-empty string of 1~50 characters (after trimming).
 */
export function validateUGName(name: unknown): UGNameValidationResult {
  if (typeof name !== 'string') {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'UG 名称必须为字符串' } };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'UG 名称不能为空' } };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'UG 名称不能超过 50 个字符' } };
  }
  return { valid: true };
}

// ============================================================
// CRUD Operations
// ============================================================

/**
 * Create a new UG.
 * - Validates name
 * - Checks uniqueness via name-index GSI (case-insensitive)
 * - Generates ULID as ugId, default status=active
 * - PutCommand to UGs table
 */
export async function createUG(
  input: CreateUGInput,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<UGOperationResult> {
  // Validate name
  const nameValidation = validateUGName(input.name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const trimmedName = input.name.trim();

  // Check uniqueness via name-index GSI (case-insensitive)
  try {
    // Case-insensitive uniqueness check
    // DynamoDB GSI is case-sensitive, so we scan all names and compare in application layer
    const scanResult = await dynamoClient.send(
      new ScanCommand({
        TableName: ugsTable,
        ProjectionExpression: '#name',
        ExpressionAttributeNames: { '#name': 'name' },
      }),
    );

    const existingNames = (scanResult.Items ?? []).map((item: any) => item.name as string);
    const isDuplicate = existingNames.some(
      (existing: string) => existing.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (isDuplicate) {
      return {
        success: false,
        error: { code: 'DUPLICATE_UG_NAME', message: 'UG 名称已存在' },
      };
    }
  } catch (err) {
    console.error('Error checking UG name uniqueness:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }

  // Create UG record
  const now = new Date().toISOString();
  const ugRecord: UGRecord = {
    ugId: ulid(),
    name: trimmedName,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: ugsTable,
        Item: ugRecord,
      }),
    );
  } catch (err) {
    console.error('Error creating UG:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }

  return { success: true, ug: ugRecord };
}

/**
 * Delete a UG by ugId.
 * - Checks UG exists via GetCommand
 * - DeleteCommand to physically delete
 */
export async function deleteUG(
  ugId: string,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    // Check existence
    const getResult = await dynamoClient.send(
      new GetCommand({
        TableName: ugsTable,
        Key: { ugId },
      }),
    );

    if (!getResult.Item) {
      return {
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      };
    }

    // Physical delete
    await dynamoClient.send(
      new DeleteCommand({
        TableName: ugsTable,
        Key: { ugId },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error('Error deleting UG:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

/**
 * Update a UG's name.
 * - Validates new name
 * - Checks uniqueness (case-insensitive), excluding current UG
 * - UpdateCommand to set name and updatedAt
 */
export async function updateUGName(
  ugId: string,
  name: string,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  const nameValidation = validateUGName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  const trimmedName = name.trim();

  try {
    // Check existence
    const getResult = await dynamoClient.send(
      new GetCommand({
        TableName: ugsTable,
        Key: { ugId },
      }),
    );

    if (!getResult.Item) {
      return { success: false, error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' } };
    }

    // Check uniqueness (exclude current UG)
    const scanResult = await dynamoClient.send(
      new ScanCommand({
        TableName: ugsTable,
        ProjectionExpression: 'ugId, #name',
        ExpressionAttributeNames: { '#name': 'name' },
      }),
    );

    const isDuplicate = (scanResult.Items ?? []).some(
      (item: any) =>
        item.ugId !== ugId &&
        (item.name as string).toLowerCase() === trimmedName.toLowerCase(),
    );

    if (isDuplicate) {
      return { success: false, error: { code: 'DUPLICATE_UG_NAME', message: 'UG 名称已存在' } };
    }

    const now = new Date().toISOString();
    await dynamoClient.send(
      new UpdateCommand({
        TableName: ugsTable,
        Key: { ugId },
        UpdateExpression: 'SET #name = :name, updatedAt = :now',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: { ':name': trimmedName, ':now': now },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error('Error updating UG name:', err);
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
  }
}

/**
 * Update UG status (active/inactive).
 * - Checks UG exists via GetCommand
 * - UpdateCommand to update status and updatedAt
 */
export async function updateUGStatus(
  ugId: string,
  status: 'active' | 'inactive',
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    // Check existence
    const getResult = await dynamoClient.send(
      new GetCommand({
        TableName: ugsTable,
        Key: { ugId },
      }),
    );

    if (!getResult.Item) {
      return {
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      };
    }

    const now = new Date().toISOString();

    await dynamoClient.send(
      new UpdateCommand({
        TableName: ugsTable,
        Key: { ugId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':now': now,
        },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error('Error updating UG status:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

/**
 * List UGs with optional status filter.
 * - status='active' or 'inactive': use status-index GSI
 * - status='all' or undefined: Scan all records
 * - Sort by createdAt descending
 */
export async function listUGs(
  options: ListUGsOptions,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<ListUGsResult> {
  try {
    let items: UGRecord[];

    const statusFilter = options.status ?? 'all';

    if (statusFilter === 'active' || statusFilter === 'inactive') {
      // Use status-index GSI (PK=status, SK=createdAt)
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: ugsTable,
          IndexName: 'status-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': statusFilter },
          ScanIndexForward: false, // descending by createdAt
        }),
      );
      items = (result.Items ?? []) as UGRecord[];
    } else {
      // Scan all
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: ugsTable,
        }),
      );
      items = (result.Items ?? []) as UGRecord[];
      // Sort by createdAt descending (Scan doesn't guarantee order)
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    return { success: true, ugs: items };
  } catch (err) {
    console.error('Error listing UGs:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}


// ============================================================
// Leader Assignment Operations
// ============================================================

/**
 * Assign or replace a UG leader.
 * 1. GetCommand to check UG exists
 * 2. GetCommand to check leaderId user exists
 * 3. Validate user roles includes 'Admin'
 * 4. UpdateCommand to update leaderId, leaderNickname, updatedAt
 * If UG already has a leader, directly overwrite (replace).
 */
export async function assignLeader(
  input: AssignLeaderInput,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
  usersTable: string,
): Promise<AssignLeaderResult> {
  try {
    // 1. Check UG exists
    const ugResult = await dynamoClient.send(
      new GetCommand({
        TableName: ugsTable,
        Key: { ugId: input.ugId },
      }),
    );

    if (!ugResult.Item) {
      return {
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      };
    }

    // 2. Check user exists
    const userResult = await dynamoClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userId: input.leaderId },
      }),
    );

    if (!userResult.Item) {
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      };
    }

    // 3. Validate user has Admin role
    const userRoles: string[] = userResult.Item.roles ?? [];
    if (!userRoles.includes('Admin')) {
      return {
        success: false,
        error: { code: 'INVALID_LEADER_ROLE', message: '负责人必须拥有 Admin 角色' },
      };
    }

    // 4. Update UG record with leader info
    const now = new Date().toISOString();
    const leaderNickname = userResult.Item.nickname ?? '';

    await dynamoClient.send(
      new UpdateCommand({
        TableName: ugsTable,
        Key: { ugId: input.ugId },
        UpdateExpression: 'SET leaderId = :leaderId, leaderNickname = :leaderNickname, updatedAt = :now',
        ExpressionAttributeValues: {
          ':leaderId': input.leaderId,
          ':leaderNickname': leaderNickname,
          ':now': now,
        },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error('Error assigning leader:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

/**
 * Remove a UG leader.
 * 1. GetCommand to check UG exists
 * 2. UpdateCommand using REMOVE expression to clear leaderId and leaderNickname, update updatedAt
 * 3. Idempotent: if UG has no leader assigned, still return success
 */
export async function removeLeader(
  ugId: string,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  try {
    // 1. Check UG exists
    const getResult = await dynamoClient.send(
      new GetCommand({
        TableName: ugsTable,
        Key: { ugId },
      }),
    );

    if (!getResult.Item) {
      return {
        success: false,
        error: { code: 'UG_NOT_FOUND', message: 'UG 不存在' },
      };
    }

    // 2. Remove leader fields and update updatedAt
    const now = new Date().toISOString();

    await dynamoClient.send(
      new UpdateCommand({
        TableName: ugsTable,
        Key: { ugId },
        UpdateExpression: 'REMOVE leaderId, leaderNickname SET updatedAt = :now',
        ExpressionAttributeValues: {
          ':now': now,
        },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error('Error removing leader:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}

/**
 * Get UGs where the given user is the leader (active status only).
 * 1. ScanCommand to scan UGs table with FilterExpression: leaderId = :userId AND #status = :active
 * 2. Uses ExpressionAttributeNames for #status since 'status' is a DynamoDB reserved word
 * 3. Returns matching UG records list
 * 4. Returns empty array when no matches
 */
export async function getMyUGs(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  ugsTable: string,
): Promise<{ success: boolean; ugs?: UGRecord[]; error?: { code: string; message: string } }> {
  try {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: ugsTable,
        FilterExpression: 'leaderId = :userId AND #status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':active': 'active',
        },
      }),
    );

    const ugs = (result.Items ?? []) as UGRecord[];
    return { success: true, ugs };
  } catch (err) {
    console.error('Error getting my UGs:', err);
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
  }
}
