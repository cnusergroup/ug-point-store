import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { CodeInfo } from '@points-mall/shared';

import { randomBytes } from 'crypto';

// ---- Interfaces ----

export interface BatchGeneratePointsCodesInput {
  count: number;
  pointsValue: number;
  maxUses: number;
  name?: string;
}

export interface GenerateProductCodesInput {
  productId: string;
  count: number;
}

export interface ListCodesOptions {
  pageSize?: number;
  lastKey?: Record<string, unknown>;
}

export interface ListCodesResult {
  codes: CodeInfo[];
  lastKey?: Record<string, unknown>;
}

export interface CodeOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ---- Helpers ----

const ALPHANUMERIC = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Generate a cryptographically secure random code value.
 * Uses crypto.randomBytes for unpredictability.
 * Format: 4 groups of 4 chars separated by dashes (e.g. "Xk9m-Hp3Q-Tn7w-Bv2R")
 */
export function generateCodeValue(): string {
  const bytes = randomBytes(16);
  const chars: string[] = [];
  for (let i = 0; i < 16; i++) {
    chars.push(ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`;
}

// ---- Core Functions ----

/**
 * Batch generate points codes with specified quantity, points value, and max uses.
 * Uses BatchWriteItem to write codes in batches of 25 (DynamoDB limit).
 */
export async function batchGeneratePointsCodes(
  input: BatchGeneratePointsCodesInput,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<CodeOperationResult<CodeInfo[]>> {
  if (input.count <= 0) {
    return { success: false, error: { code: 'INVALID_COUNT', message: '生成数量必须大于 0' } };
  }
  if (input.pointsValue <= 0) {
    return { success: false, error: { code: 'INVALID_POINTS_VALUE', message: '积分值必须大于 0' } };
  }
  if (input.maxUses <= 0) {
    return { success: false, error: { code: 'INVALID_MAX_USES', message: '最大使用次数必须大于 0' } };
  }

  const now = new Date().toISOString();
  const codes: CodeInfo[] = [];

  for (let i = 0; i < input.count; i++) {
    codes.push({
      codeId: ulid(),
      codeValue: generateCodeValue(),
      type: 'points',
      pointsValue: input.pointsValue,
      maxUses: input.maxUses,
      currentUses: 0,
      status: 'active',
      usedBy: [],
      createdAt: now,
      ...(input.name ? { name: input.name } : {}),
    });
  }

  // Write in batches of 25
  for (let i = 0; i < codes.length; i += 25) {
    const batch = codes.slice(i, i + 25);
    await dynamoClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((code) => ({
            PutRequest: { Item: { ...code, usedBy: {} } },
          })),
        },
      }),
    );
  }

  return { success: true, data: codes };
}

/**
 * Generate product-exclusive codes bound to a specific product.
 * Each code has maxUses=1 and is bound to the given productId.
 */
export async function generateProductCodes(
  input: GenerateProductCodesInput,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<CodeOperationResult<CodeInfo[]>> {
  if (input.count <= 0) {
    return { success: false, error: { code: 'INVALID_COUNT', message: '生成数量必须大于 0' } };
  }
  if (!input.productId) {
    return { success: false, error: { code: 'INVALID_PRODUCT_ID', message: '商品 ID 不能为空' } };
  }

  const now = new Date().toISOString();
  const codes: CodeInfo[] = [];

  for (let i = 0; i < input.count; i++) {
    codes.push({
      codeId: ulid(),
      codeValue: generateCodeValue(),
      type: 'product',
      productId: input.productId,
      maxUses: 1,
      currentUses: 0,
      status: 'active',
      usedBy: [],
      createdAt: now,
    });
  }

  // Write in batches of 25
  for (let i = 0; i < codes.length; i += 25) {
    const batch = codes.slice(i, i + 25);
    await dynamoClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((code) => ({
            PutRequest: { Item: { ...code, usedBy: {} } },
          })),
        },
      }),
    );
  }

  return { success: true, data: codes };
}

/**
 * List all codes with their status, supporting pagination.
 */
export async function listCodes(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  options?: ListCodesOptions,
): Promise<ListCodesResult> {
  const params: Record<string, unknown> = {
    TableName: tableName,
  };

  if (options?.pageSize) {
    params.Limit = options.pageSize;
  }
  if (options?.lastKey) {
    params.ExclusiveStartKey = options.lastKey;
  }

  const result = await dynamoClient.send(new ScanCommand(params as any));

  const codes = (result.Items ?? []) as CodeInfo[];

  return {
    codes,
    lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
  };
}

/**
 * Disable a code by setting its status to 'disabled'.
 */
export async function disableCode(
  codeId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<CodeOperationResult> {
  if (!codeId) {
    return { success: false, error: { code: 'INVALID_CODE_ID', message: 'Code ID 不能为空' } };
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { codeId },
      UpdateExpression: 'SET #s = :disabled',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':disabled': 'disabled' },
    }),
  );

  return { success: true };
}


/**
 * Delete a code by its codeId.
 */
export async function deleteCode(
  codeId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<CodeOperationResult> {
  if (!codeId) {
    return { success: false, error: { code: 'INVALID_CODE_ID', message: 'Code ID 不能为空' } };
  }

  await dynamoClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { codeId },
    }),
  );

  return { success: true };
}
