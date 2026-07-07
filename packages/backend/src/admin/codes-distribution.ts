/**
 * Code 兑换码分发服务（Code_Distribution_Service）。
 *
 * 本模块负责按用户列表生成并邮件分发兑换码：分配规划纯函数 `buildAllocationPlan`
 * 与编排函数 `distributeCodes`。单码重发 `resendCodeEmail` 由后续任务补充。
 */
import { SESClient } from '@aws-sdk/client-ses';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CodeEmailStatus, CodeInfo } from '@points-mall/shared';

import {
  validateCandidateProducts,
  generateDistributionCodes,
  type CodeOperationResult,
} from './codes';
import { sendCodeDistributionEmail } from '../email/notifications';

/** 商城默认地址（用于邮件 CTA 按钮的 storeUrl，可由 deps 覆盖）。 */
export const DEFAULT_STORE_URL = 'https://store.awscommunity.cn';

/**
 * 单个收件用户的兑换码分配。
 */
export interface RecipientAllocation {
  /** 收件用户 ID */
  userId: string;
  /** 分配给该用户的兑换码数量（必须为正整数） */
  allocatedCount: number;
}

/**
 * 将 recipients 展开为待生成的 `userId` 序列：每个 recipient 重复 `allocatedCount` 次，
 * 结果长度 = Σ allocatedCount，顺序稳定（与输入 recipients 顺序及其内部重复次序一致）。
 *
 * @param recipients 收件用户分配列表
 * @returns 展开后的 userId 序列
 */
export function buildAllocationPlan(recipients: RecipientAllocation[]): string[] {
  const plan: string[] = [];
  for (const recipient of recipients) {
    for (let i = 0; i < recipient.allocatedCount; i++) {
      plan.push(recipient.userId);
    }
  }
  return plan;
}

/**
 * 分发请求输入：候选商品集合（1–10）与收件用户分配列表。
 */
export interface DistributeCodesInput {
  /** 候选商品集合（有序，1–10），每个生成的码均绑定该集合 */
  productIds: string[];
  /** 收件用户分配列表，每个用户独占分配 allocatedCount 个码 */
  recipients: RecipientAllocation[];
}

/**
 * 分发结果摘要：三态划分互斥且穷尽，
 * `sentSuccess.length + sentFailed.length + skippedNoEmail.length` === 收件用户总数。
 */
export interface DistributionResultSummary {
  /** 分发批次标识 */
  batchId: string;
  /** 生成的兑换码总数（= Σ allocatedCount） */
  totalCodes: number;
  /** 生成成功且邮件发送成功的 userId */
  sentSuccess: string[];
  /** 生成成功但邮件发送失败的 userId 及错误信息 */
  sentFailed: { userId: string; error: string }[];
  /** 生成成功但用户无有效邮箱被跳过的 userId */
  skippedNoEmail: string[];
}

/**
 * 分发服务依赖。`storeUrl` 可选，缺省取 {@link DEFAULT_STORE_URL}。
 */
export interface DistributeCodesDeps {
  dynamoClient: DynamoDBDocumentClient;
  sesClient: SESClient;
  codesTable: string;
  productsTable: string;
  usersTable: string;
  emailTemplatesTable: string;
  senderEmail: string;
  /** 商城地址，覆盖默认值；用于邮件 CTA 按钮的 storeUrl */
  storeUrl?: string;
}

/**
 * 编排一次分发批次：二次校验 → 候选商品校验 → 生成分发码 → 逐用户邮件发送 → 汇总。
 *
 * 流程：
 * 1. 二次校验 recipients（非空、各 allocatedCount 为正整数），否则 `INVALID_REQUEST`。
 * 2. 校验候选商品（{@link validateCandidateProducts}）。失败整体拒绝（含商品不存在/下架 →
 *    `INVALID_PRODUCT_SELECTION`），在生成前拒绝，不写入任何码。
 * 3. 生成分发码（{@link generateDistributionCodes}）。
 * 4. 按 allocatedUserId 聚合每个用户的全部码值，逐用户发送邮件
 *    （{@link sendCodeDistributionEmail}）；生成后不因邮件失败回滚。
 * 5. 据发送结果回写每个码的 emailStatus（sent/failed/no_email），并汇总三态结果。
 *
 * @param input 候选商品与收件用户分配
 * @param deps 注入依赖
 * @returns 分发结果摘要
 */
export async function distributeCodes(
  input: DistributeCodesInput,
  deps: DistributeCodesDeps,
): Promise<CodeOperationResult<DistributionResultSummary>> {
  const { recipients } = input;

  // 1. 二次校验 recipients（前端已先行拦截，后端二次校验）
  if (!recipients || recipients.length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: '请至少选择一个收件用户' },
    };
  }
  for (const recipient of recipients) {
    if (!Number.isInteger(recipient.allocatedCount) || recipient.allocatedCount < 1) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: '每个用户的分配数量必须为正整数' },
      };
    }
  }

  // 2. 候选商品校验（失败在生成前整体拒绝）
  const validation = await validateCandidateProducts(
    input.productIds,
    deps.dynamoClient,
    deps.productsTable,
  );
  if (!validation.valid || !validation.products) {
    return {
      success: false,
      error: validation.error ?? {
        code: 'INVALID_PRODUCT_SELECTION',
        message: '候选商品校验失败',
      },
    };
  }
  const productNames = validation.products.map((p) => p.name);

  // 3. 生成分发码
  const generated = await generateDistributionCodes(
    { productIds: input.productIds, recipients },
    deps.dynamoClient,
    deps.codesTable,
  );
  if (!generated.success || !generated.data) {
    return {
      success: false,
      error: generated.error ?? { code: 'GENERATION_FAILED', message: '兑换码生成失败' },
    };
  }

  const { batchId, codes } = generated.data;
  const storeUrl = deps.storeUrl ?? DEFAULT_STORE_URL;

  // 4. 按 allocatedUserId 聚合每个用户的全部码（保持首次出现顺序）
  const groups = new Map<string, { codeIds: string[]; codeValues: string[] }>();
  const order: string[] = [];
  for (const code of codes) {
    let group = groups.get(code.allocatedUserId);
    if (!group) {
      group = { codeIds: [], codeValues: [] };
      groups.set(code.allocatedUserId, group);
      order.push(code.allocatedUserId);
    }
    group.codeIds.push(code.codeId);
    group.codeValues.push(code.codeValue);
  }

  const emailCtx = {
    sesClient: deps.sesClient,
    dynamoClient: deps.dynamoClient,
    emailTemplatesTable: deps.emailTemplatesTable,
    usersTable: deps.usersTable,
    senderEmail: deps.senderEmail,
  };

  const summary: DistributionResultSummary = {
    batchId,
    totalCodes: codes.length,
    sentSuccess: [],
    sentFailed: [],
    skippedNoEmail: [],
  };

  // 5. 逐用户发送（聚合其全部码值），据结果回写 emailStatus 并汇总
  for (const userId of order) {
    const group = groups.get(userId)!;
    const result = await sendCodeDistributionEmail(
      emailCtx,
      userId,
      group.codeValues,
      productNames,
      storeUrl,
    );

    let emailStatus: CodeEmailStatus;
    if (result.status === 'sent') {
      summary.sentSuccess.push(userId);
      emailStatus = 'sent';
    } else if (result.status === 'no_email') {
      summary.skippedNoEmail.push(userId);
      emailStatus = 'no_email';
    } else {
      summary.sentFailed.push({ userId, error: result.error ?? '邮件发送失败' });
      emailStatus = 'failed';
    }

    // 回写该用户全部码的 emailStatus（生成后不回滚）
    await updateCodesEmailStatus(deps, group.codeIds, emailStatus);
  }

  return { success: true, data: summary };
}

/**
 * 将一组兑换码记录的 emailStatus 回写到 Codes 表。失败不抛出（不影响已生成码与摘要）。
 */
async function updateCodesEmailStatus(
  deps: DistributeCodesDeps,
  codeIds: string[],
  emailStatus: CodeEmailStatus,
): Promise<void> {
  for (const codeId of codeIds) {
    try {
      await deps.dynamoClient.send(
        new UpdateCommand({
          TableName: deps.codesTable,
          Key: { codeId },
          UpdateExpression: 'SET emailStatus = :s',
          ExpressionAttributeValues: { ':s': emailStatus },
        }),
      );
    } catch (err) {
      console.error(`[Distribution] Failed to update emailStatus for code ${codeId}:`, err);
    }
  }
}

/**
 * Resolve the candidate product set of a code record, with backward compatibility
 * for legacy single-product codes (only `productId`, no `productIds`).
 */
function resolveCandidateIds(code: Pick<CodeInfo, 'productId' | 'productIds'>): string[] {
  return code.productIds ?? (code.productId ? [code.productId] : []);
}

/**
 * Fetch product names for a set of product ids, preserving the input order.
 * Missing products are skipped (their names simply won't appear). Returns an
 * empty list on read failure (the email can still be sent without product names).
 */
async function fetchProductNames(
  deps: DistributeCodesDeps,
  productIds: string[],
): Promise<string[]> {
  if (productIds.length === 0) {
    return [];
  }
  // Deduplicate keys for the BatchGet request while preserving lookup by id.
  const uniqueIds = [...new Set(productIds)];
  try {
    const result = await deps.dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [deps.productsTable]: {
            Keys: uniqueIds.map((productId) => ({ productId })),
          },
        },
      }),
    );
    const fetched = (result.Responses?.[deps.productsTable] ?? []) as Array<{
      productId: string;
      name: string;
    }>;
    const nameMap = new Map(fetched.map((p) => [p.productId, p.name]));
    return productIds
      .map((productId) => nameMap.get(productId))
      .filter((name): name is string => typeof name === 'string');
  } catch (err) {
    console.error('[Distribution] Failed to fetch product names for resend:', err);
    return [];
  }
}

/**
 * Resend the distribution email for a single code to its persisted recipient.
 *
 * Flow (Req 9.3, 9.4, 9.5, 9.6):
 * 1. Read the code record by `codeId` (GetCommand on codesTable).
 * 2. Take its persisted `allocatedUserId` — the email is sent ONLY to this user,
 *    never to anyone else (recipient isolation, Req 9.6). A code without an
 *    `allocatedUserId` is not a distribution code and cannot be resent.
 * 3. Resolve the candidate set (`productIds ?? [productId]`) and batch-fetch the
 *    candidate product names for the email `productNames`.
 * 4. Resend an email containing this single code's value via
 *    {@link sendCodeDistributionEmail}. If the recipient has no valid email, the
 *    send returns 'no_email' → this function returns error code `NO_EMAIL`
 *    (Req 9.4) and records `emailStatus='no_email'`.
 * 5. Update the code's `emailStatus` according to the send result (Req 9.5).
 *
 * @param codeId Target code id
 * @param deps Injected dependencies
 * @returns The code id and its updated email status, or an error
 */
export async function resendCodeEmail(
  codeId: string,
  deps: DistributeCodesDeps,
): Promise<CodeOperationResult<{ codeId: string; emailStatus: CodeEmailStatus }>> {
  if (!codeId) {
    return { success: false, error: { code: 'INVALID_CODE_ID', message: 'Code ID 不能为空' } };
  }

  // 1. Load the code record
  const codeResult = await deps.dynamoClient.send(
    new GetCommand({
      TableName: deps.codesTable,
      Key: { codeId },
    }),
  );
  const code = codeResult.Item as (CodeInfo & { allocatedUserId?: string }) | undefined;
  if (!code) {
    return { success: false, error: { code: 'INVALID_CODE', message: '兑换码不存在' } };
  }

  // 2. The recipient is the persisted allocatedUserId (recipient isolation)
  const allocatedUserId = code.allocatedUserId;
  if (!allocatedUserId) {
    return {
      success: false,
      error: { code: 'INVALID_CODE', message: '该兑换码没有关联的收件用户，无法重发' },
    };
  }

  // 3. Resolve candidate set and fetch product names for the email
  const candidateIds = resolveCandidateIds(code);
  const productNames = await fetchProductNames(deps, candidateIds);

  const storeUrl = deps.storeUrl ?? DEFAULT_STORE_URL;
  const emailCtx = {
    sesClient: deps.sesClient,
    dynamoClient: deps.dynamoClient,
    emailTemplatesTable: deps.emailTemplatesTable,
    usersTable: deps.usersTable,
    senderEmail: deps.senderEmail,
  };

  // 4. Resend an email containing only this single code value
  const result = await sendCodeDistributionEmail(
    emailCtx,
    allocatedUserId,
    [code.codeValue],
    productNames,
    storeUrl,
  );

  // No valid email → reject with NO_EMAIL (Req 9.4), still persist status
  if (result.status === 'no_email') {
    await updateCodesEmailStatus(deps, [codeId], 'no_email');
    return { success: false, error: { code: 'NO_EMAIL', message: '该用户没有有效邮箱地址' } };
  }

  // 5. Update emailStatus per send result (Req 9.5)
  const emailStatus: CodeEmailStatus = result.status === 'sent' ? 'sent' : 'failed';
  await updateCodesEmailStatus(deps, [codeId], emailStatus);

  if (result.status === 'failed') {
    return {
      success: false,
      error: { code: 'EMAIL_SEND_FAILED', message: result.error ?? '邮件发送失败' },
    };
  }

  return { success: true, data: { codeId, emailStatus } };
}
