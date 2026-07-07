import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  BatchGetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { CodeInfo } from '@points-mall/shared';

import { randomBytes } from 'crypto';

import { buildAllocationPlan, type RecipientAllocation } from './codes-distribution';

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

/** 单个兑换码可绑定的候选商品数量上限 */
export const MAX_CANDIDATE_PRODUCTS = 10;

export interface CandidateValidationResult {
  valid: boolean;
  /** 校验通过的候选商品（保持输入顺序，供邮件 productNames 使用） */
  products?: { productId: string; name: string }[];
  error?: { code: string; message: string };
}

export interface GenerateDistributionCodesInput {
  /** 候选商品集合（有序，1–10）。每个生成的码均绑定该集合作为 productIds */
  productIds: string[];
  /** 收件用户分配列表，每个用户独占分配 allocatedCount 个码 */
  recipients: RecipientAllocation[];
}

/** 分发批次中的单个兑换码记录：在 CodeInfo 基础上必带 allocatedUserId 与 batchId */
export interface DistributionCodeRecord extends CodeInfo {
  allocatedUserId: string;
  batchId: string;
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
 * Validate a candidate product set for a redemption code.
 *
 * Validation order and error codes:
 *  1. empty list                          -> INVALID_PRODUCT_SELECTION
 *  2. length > MAX_CANDIDATE_PRODUCTS (10) -> TOO_MANY_PRODUCTS
 *  3. duplicate identifiers                -> DUPLICATE_PRODUCT
 *  4. existing product not 'code_exclusive'-> INVALID_PRODUCT_TYPE
 *  5. missing or non-active (已下架)        -> INVALID_PRODUCT_SELECTION
 *
 * On success returns the candidate products (preserving input order) so callers
 * can use the names for email `productNames`.
 *
 * Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 8.2
 */
export async function validateCandidateProducts(
  productIds: string[],
  dynamoClient: DynamoDBDocumentClient,
  productsTable: string,
): Promise<CandidateValidationResult> {
  // 1. Empty list
  if (!productIds || productIds.length === 0) {
    return {
      valid: false,
      error: { code: 'INVALID_PRODUCT_SELECTION', message: '请至少选择一个商品' },
    };
  }

  // 2. Too many candidates
  if (productIds.length > MAX_CANDIDATE_PRODUCTS) {
    return {
      valid: false,
      error: {
        code: 'TOO_MANY_PRODUCTS',
        message: `候选商品最多为 ${MAX_CANDIDATE_PRODUCTS} 个`,
      },
    };
  }

  // 3. Duplicate identifiers
  if (new Set(productIds).size !== productIds.length) {
    return {
      valid: false,
      error: { code: 'DUPLICATE_PRODUCT', message: '候选商品列表存在重复商品' },
    };
  }

  // Fetch all candidate products (unique ids, max 10 -> single BatchGet)
  const batchResult = await dynamoClient.send(
    new BatchGetCommand({
      RequestItems: {
        [productsTable]: {
          Keys: productIds.map((productId) => ({ productId })),
        },
      },
    }),
  );

  const fetched = (batchResult.Responses?.[productsTable] ?? []) as Array<{
    productId: string;
    name: string;
    type?: string;
    status?: string;
  }>;
  const productMap = new Map(fetched.map((p) => [p.productId, p]));

  // 4. Existing products that are not code_exclusive
  for (const productId of productIds) {
    const product = productMap.get(productId);
    if (product && product.type !== 'code_exclusive') {
      return {
        valid: false,
        error: { code: 'INVALID_PRODUCT_TYPE', message: '候选商品包含非 Code 专属商品' },
      };
    }
  }

  // 5. Missing or non-active (已下架) products
  for (const productId of productIds) {
    const product = productMap.get(productId);
    if (!product || product.status !== 'active') {
      return {
        valid: false,
        error: { code: 'INVALID_PRODUCT_SELECTION', message: '候选商品不存在或已下架' },
      };
    }
  }

  // Valid: return products preserving input order
  return {
    valid: true,
    products: productIds.map((productId) => {
      const product = productMap.get(productId)!;
      return { productId, name: product.name };
    }),
  };
}

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
 * Generate a distribution batch of redemption codes.
 *
 * Based on `buildAllocationPlan`, generates exactly Σ allocatedCount codes — one per
 * allocation slot. Each code is:
 *   - type='product', maxUses=1, currentUses=0, status='active'
 *   - productIds = candidate set (the same ordered list for every code)
 *   - productId additionally written iff the candidate set has exactly 1 product
 *     (backward compatibility mirror)
 *   - allocatedUserId = the recipient owning this slot
 *   - batchId = a single ULID shared across the whole batch
 *   - createdAt = ISO timestamp
 *
 * Codes are persisted to the Codes table via BatchWriteCommand in batches of ≤25
 * (DynamoDB BatchWrite limit). usedBy is stored as an empty map (matching existing
 * code records).
 *
 * Note: candidate product validation (existence / active / type / duplicates / count)
 * is performed by the caller (`distributeCodes` via `validateCandidateProducts`) before
 * invoking this function — this function focuses on allocation + persistence.
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 5.5, 5.6, 5.8, 8.4
 */
export async function generateDistributionCodes(
  input: GenerateDistributionCodesInput,
  dynamoClient: DynamoDBDocumentClient,
  codesTable: string,
): Promise<CodeOperationResult<{ batchId: string; codes: DistributionCodeRecord[] }>> {
  if (!input.productIds || input.productIds.length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_PRODUCT_SELECTION', message: '请至少选择一个商品' },
    };
  }
  if (!input.recipients || input.recipients.length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: '请至少选择一个收件用户' },
    };
  }
  for (const recipient of input.recipients) {
    if (!Number.isInteger(recipient.allocatedCount) || recipient.allocatedCount < 1) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: '每个用户的分配数量必须为正整数' },
      };
    }
  }

  const now = new Date().toISOString();
  const batchId = ulid();
  // Single source of truth for candidate set; productId mirror only when length === 1
  const candidateIds = [...input.productIds];
  const singleProductId = candidateIds.length === 1 ? candidateIds[0] : undefined;

  // Expand recipients into a per-slot userId sequence (length = Σ allocatedCount)
  const plan = buildAllocationPlan(input.recipients);

  const codes: DistributionCodeRecord[] = plan.map((allocatedUserId) => ({
    codeId: ulid(),
    codeValue: generateCodeValue(),
    type: 'product',
    productIds: [...candidateIds],
    ...(singleProductId ? { productId: singleProductId } : {}),
    maxUses: 1,
    currentUses: 0,
    status: 'active',
    usedBy: [],
    allocatedUserId,
    batchId,
    createdAt: now,
  }));

  // Write in batches of 25 (DynamoDB BatchWrite limit)
  for (let i = 0; i < codes.length; i += 25) {
    const batch = codes.slice(i, i + 25);
    await dynamoClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [codesTable]: batch.map((code) => ({
            PutRequest: { Item: { ...code, usedBy: {} } },
          })),
        },
      }),
    );
  }

  return { success: true, data: { batchId, codes } };
}
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
