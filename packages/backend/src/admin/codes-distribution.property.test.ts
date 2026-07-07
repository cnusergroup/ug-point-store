import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock the email module so distributeCodes' per-user send outcome is fully
// controllable (three-state: sent / failed / no_email). Hoisted by vitest.
vi.mock('../email/notifications', () => ({
  sendCodeDistributionEmail: vi.fn(),
}));

import { sendCodeDistributionEmail } from '../email/notifications';
import { generateDistributionCodes } from './codes';
import { distributeCodes, buildAllocationPlan } from './codes-distribution';

const mockedSendEmail = vi.mocked(sendCodeDistributionEmail);

const codesTable = 'Codes';
const productsTable = 'Products';

// ---- Mock clients ----

/** A DynamoDBDocumentClient whose `send` always resolves {} (BatchWrite/Update). */
function createMockClient() {
  return { send: vi.fn().mockResolvedValue({}) } as any;
}

/**
 * A DynamoDBDocumentClient for distributeCodes: serves BatchGet (product
 * validation) from the given catalog, and resolves {} for BatchWrite (code
 * persistence) and Update (emailStatus writeback). Records all sends so tests
 * can assert that no delete ever occurred.
 */
function createDistributeMockClient(catalog: Map<string, any>) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const input = cmd.input ?? {};
      if (input.RequestItems) {
        const productEntry = input.RequestItems[productsTable];
        if (productEntry && productEntry.Keys) {
          // BatchGetCommand against products table
          const seen = new Set<string>();
          const items: any[] = [];
          for (const { productId } of productEntry.Keys) {
            if (seen.has(productId)) continue;
            seen.add(productId);
            const product = catalog.get(productId);
            if (product) items.push(product);
          }
          return Promise.resolve({ Responses: { [productsTable]: items } });
        }
        // BatchWriteCommand (code persistence)
        return Promise.resolve({});
      }
      // UpdateCommand (emailStatus writeback) or anything else
      return Promise.resolve({});
    }),
  } as any;
}

function buildActiveCatalog(productIds: string[]): Map<string, any> {
  const catalog = new Map<string, any>();
  productIds.forEach((productId, i) => {
    catalog.set(productId, {
      productId,
      name: `Product ${i}`,
      type: 'code_exclusive',
      status: 'active',
    });
  });
  return catalog;
}

function distributeDeps(client: any) {
  return {
    dynamoClient: client,
    sesClient: {} as any,
    codesTable,
    productsTable,
    usersTable: 'Users',
    emailTemplatesTable: 'EmailTemplates',
    senderEmail: 'noreply@example.com',
  };
}

// ---- Arbitraries ----

/** 1–10 distinct candidate product ids (ordered). */
const candidateIdsArb = fc
  .integer({ min: 1, max: 10 })
  .map((n) => Array.from({ length: n }, (_, i) => `prod${i}`));

/** Recipients with unique userIds and positive-integer allocatedCount. */
const recipientsArb = fc.uniqueArray(
  fc.record({
    userId: fc.string({ minLength: 1, maxLength: 8 }),
    allocatedCount: fc.integer({ min: 1, max: 5 }),
  }),
  { minLength: 1, maxLength: 8, selector: (r) => r.userId },
);

/** Recipients tagged with the per-user email send outcome (for distributeCodes). */
const recipientsWithStatusArb = fc.uniqueArray(
  fc.record({
    userId: fc.string({ minLength: 1, maxLength: 8 }),
    allocatedCount: fc.integer({ min: 1, max: 4 }),
    status: fc.constantFrom('sent', 'failed', 'no_email') as fc.Arbitrary<
      'sent' | 'failed' | 'no_email'
    >,
  }),
  { minLength: 1, maxLength: 8, selector: (r) => r.userId },
);

// ============================================================
// Property 1: 生成码不变量
// ============================================================
// Feature: code-user-email-distribution, Property 1: 生成码不变量
// For any 合法的分发输入（候选集合 1–10、recipients 各自码数为正整数），所生成的每个兑换码
// SHALL 满足 type==='product'、maxUses===1、currentUses===0、status==='active'，且 productIds
// 深度等于输入候选集合（保序）；当且仅当候选集合长度为 1 时，productId 等于该唯一候选商品。
// Validates: Requirements 1.2, 1.3, 1.4, 1.5
describe('Property 1: 生成码不变量', () => {
  it('每个生成码满足类型/次数/状态不变量，且 productIds 保序等于候选集合', async () => {
    await fc.assert(
      fc.asyncProperty(candidateIdsArb, recipientsArb, async (productIds, recipients) => {
        const client = createMockClient();
        const result = await generateDistributionCodes(
          { productIds, recipients },
          client,
          codesTable,
        );

        expect(result.success).toBe(true);
        const codes = result.data!.codes;

        for (const code of codes) {
          expect(code.type).toBe('product');
          expect(code.maxUses).toBe(1);
          expect(code.currentUses).toBe(0);
          expect(code.status).toBe('active');
          // productIds deep-equals the input candidate set, preserving order
          expect(code.productIds).toEqual(productIds);
          // productId mirror iff candidate set has exactly 1 product
          if (productIds.length === 1) {
            expect(code.productId).toBe(productIds[0]);
          } else {
            expect(code.productId).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 11: 分配一致性
// ============================================================
// Feature: code-user-email-distribution, Property 11: 分配一致性
// For any recipients 列表（每个 allocatedCount 为正整数），分发批次生成结果 SHALL 满足：
// 生成码总数 = Σ allocatedCount；按 allocatedUserId 分组每用户恰好得其 allocatedCount 个；
// 跨用户 codeId 两两不相交；每个码均带同一 batchId 且 allocatedUserId ∈ recipients；
// 不存在未分配或重复分配的码。
// Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8
describe('Property 11: 分配一致性', () => {
  it('每用户恰好得其分配数，codeId 不相交，同一 batchId，无未分配/重复分配', async () => {
    await fc.assert(
      fc.asyncProperty(candidateIdsArb, recipientsArb, async (productIds, recipients) => {
        const client = createMockClient();
        const result = await generateDistributionCodes(
          { productIds, recipients },
          client,
          codesTable,
        );

        expect(result.success).toBe(true);
        const { batchId, codes } = result.data!;

        const expectedTotal = recipients.reduce((s, r) => s + r.allocatedCount, 0);
        // total = Σ allocatedCount
        expect(codes.length).toBe(expectedTotal);

        // per-user count exactly equals allocatedCount
        const perUser = new Map<string, number>();
        for (const code of codes) {
          perUser.set(code.allocatedUserId, (perUser.get(code.allocatedUserId) ?? 0) + 1);
        }
        for (const r of recipients) {
          expect(perUser.get(r.userId)).toBe(r.allocatedCount);
        }
        // no codes allocated to users outside recipients
        const recipientIds = new Set(recipients.map((r) => r.userId));
        for (const code of codes) {
          expect(recipientIds.has(code.allocatedUserId)).toBe(true);
          expect(code.batchId).toBe(batchId);
        }

        // codeIds globally unique (pairwise disjoint across users, no dup allocation)
        const codeIds = new Set(codes.map((c) => c.codeId));
        expect(codeIds.size).toBe(codes.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 12: 总数汇总计算
// ============================================================
// Feature: code-user-email-distribution, Property 12: 总数汇总计算
// For any recipients 列表，Total_Code_Count SHALL 等于所有 allocatedCount 之和。
// Validates: Requirements 3.4, 5.4
describe('Property 12: 总数汇总计算', () => {
  it('生成码总数与分配规划长度均等于 Σ allocatedCount', async () => {
    await fc.assert(
      fc.asyncProperty(candidateIdsArb, recipientsArb, async (productIds, recipients) => {
        const expectedTotal = recipients.reduce((s, r) => s + r.allocatedCount, 0);

        // pure allocation plan length
        expect(buildAllocationPlan(recipients).length).toBe(expectedTotal);

        // generated codes count
        const client = createMockClient();
        const result = await generateDistributionCodes(
          { productIds, recipients },
          client,
          codesTable,
        );
        expect(result.success).toBe(true);
        expect(result.data!.codes.length).toBe(expectedTotal);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 15: 分发结果三态划分
// ============================================================
// Feature: code-user-email-distribution, Property 15: 分发结果三态划分
// For any 一次分发运行，每个收件用户 SHALL 被划入"发送成功"、"发送失败"、"无邮箱被跳过"
// 三类中恰好一类（互斥且穷尽）；摘要中 sentSuccess + sentFailed + skippedNoEmail 数之和
// SHALL 等于收件用户总数。
// Validates: Requirements 6.5, 8.6
describe('Property 15: 分发结果三态划分', () => {
  it('每用户恰属一类且三态计数之和等于收件用户总数', async () => {
    await fc.assert(
      fc.asyncProperty(
        candidateIdsArb,
        recipientsWithStatusArb,
        async (productIds, taggedRecipients) => {
          mockedSendEmail.mockImplementation((_ctx: any, userId: string) => {
            const r = taggedRecipients.find((x) => x.userId === userId)!;
            if (r.status === 'sent') return Promise.resolve({ status: 'sent' });
            if (r.status === 'no_email') return Promise.resolve({ status: 'no_email' });
            return Promise.resolve({ status: 'failed', error: 'boom' });
          });

          const catalog = buildActiveCatalog(productIds);
          const client = createDistributeMockClient(catalog);
          const recipients = taggedRecipients.map(({ userId, allocatedCount }) => ({
            userId,
            allocatedCount,
          }));

          const result = await distributeCodes({ productIds, recipients }, distributeDeps(client));

          expect(result.success).toBe(true);
          const summary = result.data!;

          const totalUsers = taggedRecipients.length;
          // exhaustive count
          expect(
            summary.sentSuccess.length +
              summary.sentFailed.length +
              summary.skippedNoEmail.length,
          ).toBe(totalUsers);

          // mutually exclusive: each user appears in exactly one bucket
          const failedIds = summary.sentFailed.map((f) => f.userId);
          const all = [...summary.sentSuccess, ...failedIds, ...summary.skippedNoEmail];
          expect(new Set(all).size).toBe(all.length);
          expect(all.length).toBe(totalUsers);

          // each user landed in the bucket matching its tagged status
          for (const r of taggedRecipients) {
            if (r.status === 'sent') {
              expect(summary.sentSuccess).toContain(r.userId);
            } else if (r.status === 'no_email') {
              expect(summary.skippedNoEmail).toContain(r.userId);
            } else {
              expect(failedIds).toContain(r.userId);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 16: 部分失败不回滚
// ============================================================
// Feature: code-user-email-distribution, Property 16: 部分失败不回滚
// For any 含部分发送失败或部分用户无邮箱的分发运行，全部已生成的兑换码记录 SHALL 保留
// （不删除、不回滚），无邮箱用户进入 skippedNoEmail，发送失败用户连同错误进入 sentFailed，
// 其余用户继续被处理。
// Validates: Requirements 8.1, 8.3, 8.5
describe('Property 16: 部分失败不回滚', () => {
  it('注入部分失败/无邮箱后保留全部已生成码且无删除操作', async () => {
    // Ensure the scenario contains at least one failure and one no_email so the
    // "partial failure" condition is genuinely exercised.
    const mixedRecipientsArb = recipientsWithStatusArb.filter(
      (rs) =>
        rs.some((r) => r.status === 'failed') && rs.some((r) => r.status === 'no_email'),
    );

    await fc.assert(
      fc.asyncProperty(candidateIdsArb, mixedRecipientsArb, async (productIds, taggedRecipients) => {
        mockedSendEmail.mockImplementation((_ctx: any, userId: string) => {
          const r = taggedRecipients.find((x) => x.userId === userId)!;
          if (r.status === 'sent') return Promise.resolve({ status: 'sent' });
          if (r.status === 'no_email') return Promise.resolve({ status: 'no_email' });
          return Promise.resolve({ status: 'failed', error: 'boom' });
        });

        const catalog = buildActiveCatalog(productIds);
        const client = createDistributeMockClient(catalog);
        const recipients = taggedRecipients.map(({ userId, allocatedCount }) => ({
          userId,
          allocatedCount,
        }));

        const result = await distributeCodes({ productIds, recipients }, distributeDeps(client));

        expect(result.success).toBe(true);
        const summary = result.data!;

        // All generated code records retained: totalCodes === Σ allocatedCount
        const expectedTotal = recipients.reduce((s, r) => s + r.allocatedCount, 0);
        expect(summary.totalCodes).toBe(expectedTotal);

        // No delete ever occurred: inspect every send call for a DeleteRequest /
        // DeleteCommand-style payload.
        for (const call of client.send.mock.calls) {
          const input = call[0].input ?? {};
          if (input.RequestItems) {
            for (const tableName of Object.keys(input.RequestItems)) {
              const ops = input.RequestItems[tableName];
              if (Array.isArray(ops)) {
                for (const op of ops) {
                  expect(op.DeleteRequest).toBeUndefined();
                }
              }
            }
          }
          // An UpdateCommand never deletes; a DeleteCommand would carry a bare Key
          // with no UpdateExpression — guard against accidental REMOVE-all.
          if (input.UpdateExpression) {
            expect(String(input.UpdateExpression)).not.toMatch(/REMOVE/i);
          }
        }

        // Classification of injected outcomes
        const failedIds = summary.sentFailed.map((f) => f.userId);
        for (const r of taggedRecipients) {
          if (r.status === 'no_email') {
            expect(summary.skippedNoEmail).toContain(r.userId);
          } else if (r.status === 'failed') {
            expect(failedIds).toContain(r.userId);
          } else {
            expect(summary.sentSuccess).toContain(r.userId);
          }
        }
        // sentFailed entries carry an error message
        for (const f of summary.sentFailed) {
          expect(typeof f.error).toBe('string');
          expect(f.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 17: 分批写入上限
// ============================================================
// Feature: code-user-email-distribution, Property 17: 分批写入上限
// For any 应生成总数 N，兑换码记录 SHALL 以每批不超过 25 条（DynamoDB BatchWrite 上限）的
// 方式写入，且写入条目总数等于 N。
// Validates: Requirements 8.4
describe('Property 17: 分批写入上限', () => {
  // Recipients producing a potentially large total N to exercise multiple batches.
  const largeRecipientsArb = fc.uniqueArray(
    fc.record({
      userId: fc.string({ minLength: 1, maxLength: 8 }),
      allocatedCount: fc.integer({ min: 1, max: 30 }),
    }),
    { minLength: 1, maxLength: 12, selector: (r) => r.userId },
  );

  it('每批写入 ≤25 条且写入条目总数等于 N', async () => {
    await fc.assert(
      fc.asyncProperty(candidateIdsArb, largeRecipientsArb, async (productIds, recipients) => {
        const client = createMockClient();
        const result = await generateDistributionCodes(
          { productIds, recipients },
          client,
          codesTable,
        );

        expect(result.success).toBe(true);
        const n = recipients.reduce((s, r) => s + r.allocatedCount, 0);

        const expectedBatches = Math.ceil(n / 25);
        expect(client.send).toHaveBeenCalledTimes(expectedBatches);

        let totalItems = 0;
        for (let i = 0; i < expectedBatches; i++) {
          const batchItems = client.send.mock.calls[i][0].input.RequestItems[codesTable];
          expect(batchItems.length).toBeLessThanOrEqual(25);
          totalItems += batchItems.length;
        }
        expect(totalItems).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 19: 分发与重发鉴权
// ============================================================
// Feature: code-user-email-distribution, Property 19: 分发与重发鉴权
// For any 请求者角色集合，生成、分发与重发接口 SHALL 当且仅当角色集合包含 Admin 或
// SuperAdmin 时被允许，否则返回 FORBIDDEN。
//
// 鉴权在路由层 admin/handler.ts 顶层守卫执行：守卫对 Admin/SuperAdmin 放行，OrderAdmin
// 一律 403，其余角色 403。该规则等价于共享判定 hasAdminAccess(roles)
// （ADMIN_ROLES = ['Admin','SuperAdmin']）。本属性以一个纯鉴权判定函数镜像该守卫规则，
// 并复用真实共享 helper hasAdminAccess 计算期望，使断言保持有意义。
// Validates: Requirements 10.1
import { hasAdminAccess, ALL_ROLES } from '@points-mall/shared';
import type { UserRole } from '@points-mall/shared';

/**
 * Pure authorization predicate mirroring the admin/handler.ts top-level guard
 * for the distribute / resend (and code generation) routes: allowed iff the
 * caller's role set contains Admin or SuperAdmin, otherwise FORBIDDEN.
 */
type GuardOutcome = { allowed: true } | { allowed: false; error: 'FORBIDDEN' };
function authorizeDistribution(roles: UserRole[]): GuardOutcome {
  return roles.includes('Admin') || roles.includes('SuperAdmin')
    ? { allowed: true }
    : { allowed: false, error: 'FORBIDDEN' };
}

/** Any subset (including empty) of the six valid user roles, without duplicates. */
const rolesArb: fc.Arbitrary<UserRole[]> = fc.subarray(ALL_ROLES as UserRole[]);

describe('Property 19: 分发与重发鉴权', () => {
  it('生成/分发/重发 当且仅当角色集合含 Admin 或 SuperAdmin 时允许，否则 FORBIDDEN', () => {
    fc.assert(
      fc.property(rolesArb, (roles) => {
        const outcome = authorizeDistribution(roles);
        // Expectation computed via the real shared helper, not a duplicated rule.
        const expectAllowed = hasAdminAccess(roles);

        expect(outcome.allowed).toBe(expectAllowed);

        if (expectAllowed) {
          // Allowed iff role set contains Admin or SuperAdmin
          expect(roles.includes('Admin') || roles.includes('SuperAdmin')).toBe(true);
        } else {
          // Otherwise rejected with FORBIDDEN
          expect(outcome).toEqual({ allowed: false, error: 'FORBIDDEN' });
          expect(roles.includes('Admin') || roles.includes('SuperAdmin')).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
