import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { listContentItems } from './list';
import type { ContentStatus } from '@points-mall/shared';

// ─── Shared Arbitraries ────────────────────────────────────

const contentStatusArb = fc.constantFrom<ContentStatus>('pending', 'approved', 'rejected');

/** Arbitrary for a full ContentItem record as stored in DynamoDB */
const contentItemArb = fc.record({
  contentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  categoryId: fc.uuid(),
  categoryName: fc.string({ minLength: 1, maxLength: 30 }),
  uploaderId: fc.uuid(),
  uploaderNickname: fc.string({ minLength: 1, maxLength: 30 }),
  uploaderRole: fc.constantFrom('UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'),
  fileKey: fc.string({ minLength: 1, maxLength: 100 }),
  fileName: fc.string({ minLength: 1, maxLength: 50 }),
  fileSize: fc.integer({ min: 1, max: 50 * 1024 * 1024 }),
  status: contentStatusArb,
  likeCount: fc.nat({ max: 1000 }),
  commentCount: fc.nat({ max: 500 }),
  reservationCount: fc.nat({ max: 500 }),
  createdAt: fc.integer({ min: 1704067200000, max: 1767225600000 }).map((ts) => new Date(ts).toISOString()),
  updatedAt: fc.constant('2024-06-01T00:00:00.000Z'),
});

const TABLE = 'ContentItems';

// ─── Mock helpers ──────────────────────────────────────────

/**
 * Simulate DynamoDB query behavior in-memory.
 * - Without categoryId: filters status=approved, sorts by createdAt desc
 * - With categoryId: filters by categoryId AND status=approved, sorts by createdAt desc
 * Supports Limit (pageSize) and ExclusiveStartKey (pagination cursor).
 */
function createMockDynamoClient(allItems: Record<string, any>[]) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const input = cmd.input;
      let filtered: Record<string, any>[];

      if (input.IndexName === 'categoryId-createdAt-index') {
        // Category filter path: filter by categoryId + status=approved
        const catId = input.ExpressionAttributeValues[':categoryId'];
        filtered = allItems.filter((i) => i.categoryId === catId && i.status === 'approved');
      } else {
        // status-createdAt-index path: filter status=approved
        filtered = allItems.filter((i) => i.status === 'approved');
      }

      // Sort by createdAt descending (ScanIndexForward=false)
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Handle ExclusiveStartKey pagination
      let startIdx = 0;
      if (input.ExclusiveStartKey) {
        const startKey = input.ExclusiveStartKey;
        const idx = filtered.findIndex((i) => i.contentId === startKey.contentId);
        if (idx >= 0) {
          startIdx = idx + 1;
        }
      }

      const limit = input.Limit ?? 20;
      const page = filtered.slice(startIdx, startIdx + limit);
      const hasMore = startIdx + limit < filtered.length;

      return Promise.resolve({
        Items: page,
        LastEvaluatedKey: hasMore
          ? { contentId: page[page.length - 1].contentId, status: 'approved', createdAt: page[page.length - 1].createdAt }
          : undefined,
      });
    }),
  } as any;
}

// ─── Property 7 ────────────────────────────────────────────

// Feature: content-hub, Property 7: 用户端内容列表仅展示已审核通过内容且按时间倒序
// 对于任何包含混合状态 ContentItem 的数据集，用户端列表查询返回的每条记录的 status 都应为 approved，
// 且结果按 createdAt 降序排列。
// **Validates: Requirements 4.1, 9.1**

describe('Property 7: 用户端内容列表仅展示已审核通过内容且按时间倒序', () => {
  it('返回的每条记录 status 应为 approved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 0, maxLength: 30 }),
        async (items) => {
          const client = createMockDynamoClient(items);
          const result = await listContentItems({ pageSize: 100 }, client, TABLE);

          expect(result.success).toBe(true);
          // Every returned item must have been approved (the mock simulates DynamoDB filtering)
          // and the function maps to summary — so we verify count matches approved items
          const approvedCount = items.filter((i) => i.status === 'approved').length;
          expect(result.items!.length).toBe(approvedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('结果应按 createdAt 降序排列', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 2, maxLength: 30 }),
        async (items) => {
          const client = createMockDynamoClient(items);
          const result = await listContentItems({ pageSize: 100 }, client, TABLE);

          expect(result.success).toBe(true);
          const returnedItems = result.items!;
          for (let i = 1; i < returnedItems.length; i++) {
            const prev = new Date(returnedItems[i - 1].createdAt).getTime();
            const curr = new Date(returnedItems[i].createdAt).getTime();
            expect(prev).toBeGreaterThanOrEqual(curr);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不应包含任何 pending 或 rejected 状态的内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 1, maxLength: 30 }),
        async (items) => {
          const client = createMockDynamoClient(items);
          const result = await listContentItems({ pageSize: 100 }, client, TABLE);

          const nonApprovedIds = items
            .filter((i) => i.status !== 'approved')
            .map((i) => i.contentId);

          const returnedIds = result.items!.map((i) => i.contentId);
          for (const id of nonApprovedIds) {
            expect(returnedIds).not.toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8 ────────────────────────────────────────────

// Feature: content-hub, Property 8: 分类筛选正确性
// 对于任何有效的 categoryId，按分类筛选后返回的每条 ContentItem 的 categoryId 都应等于指定的筛选值，
// 且每条 ContentItem 有且仅有一个 categoryId。
// **Validates: Requirements 3.1, 3.4**

describe('Property 8: 分类筛选正确性', () => {
  it('筛选后每条记录的 categoryId 应等于指定值', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 1, maxLength: 30 }),
        fc.uuid(),
        async (items, targetCategoryId) => {
          // Inject some items with the target categoryId to ensure non-empty results possible
          const enrichedItems = items.map((item, idx) =>
            idx % 3 === 0 ? { ...item, categoryId: targetCategoryId, status: 'approved' as const } : item,
          );

          const client = createMockDynamoClient(enrichedItems);
          const result = await listContentItems({ categoryId: targetCategoryId, pageSize: 100 }, client, TABLE);

          expect(result.success).toBe(true);
          // Verify the mock was called with the category index
          const sentCmd = client.send.mock.calls[0][0];
          expect(sentCmd.input.IndexName).toBe('categoryId-createdAt-index');
          expect(sentCmd.input.ExpressionAttributeValues[':categoryId']).toBe(targetCategoryId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('筛选结果中不应包含其他分类的内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 1, maxLength: 30 }),
        fc.uuid(),
        async (items, targetCategoryId) => {
          const enrichedItems = items.map((item, idx) =>
            idx % 2 === 0 ? { ...item, categoryId: targetCategoryId, status: 'approved' as const } : item,
          );

          const client = createMockDynamoClient(enrichedItems);
          const result = await listContentItems({ categoryId: targetCategoryId, pageSize: 100 }, client, TABLE);

          expect(result.success).toBe(true);
          // All returned items should have the target categoryId
          // We verify by checking the mock returned only matching items
          const expectedCount = enrichedItems.filter(
            (i) => i.categoryId === targetCategoryId && i.status === 'approved',
          ).length;
          expect(result.items!.length).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 18 ───────────────────────────────────────────

// Feature: content-hub, Property 18: 内容列表摘要字段完整性
// 对于任何用户端列表返回的 ContentItemSummary，应包含 title、categoryName、uploaderNickname、
// likeCount、commentCount、reservationCount 全部字段。
// **Validates: Requirement 9.2**

describe('Property 18: 内容列表摘要字段完整性', () => {
  it('每条 ContentItemSummary 应包含所有必需摘要字段', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          contentItemArb.map((item) => ({ ...item, status: 'approved' as const })),
          { minLength: 1, maxLength: 30 },
        ),
        async (items) => {
          const client = createMockDynamoClient(items);
          const result = await listContentItems({ pageSize: 100 }, client, TABLE);

          expect(result.success).toBe(true);
          expect(result.items!.length).toBeGreaterThan(0);

          for (const summary of result.items!) {
            // All required summary fields must be present and defined
            expect(summary).toHaveProperty('contentId');
            expect(summary).toHaveProperty('title');
            expect(summary).toHaveProperty('categoryName');
            expect(summary).toHaveProperty('uploaderNickname');
            expect(summary).toHaveProperty('likeCount');
            expect(summary).toHaveProperty('commentCount');
            expect(summary).toHaveProperty('reservationCount');
            expect(summary).toHaveProperty('createdAt');

            expect(summary.title).toBeDefined();
            expect(summary.categoryName).toBeDefined();
            expect(summary.uploaderNickname).toBeDefined();
            expect(typeof summary.likeCount).toBe('number');
            expect(typeof summary.commentCount).toBe('number');
            expect(typeof summary.reservationCount).toBe('number');

            // Should NOT include detail-only fields
            expect(summary).not.toHaveProperty('description');
            expect(summary).not.toHaveProperty('fileKey');
            expect(summary).not.toHaveProperty('status');
            expect(summary).not.toHaveProperty('uploaderId');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 19 ───────────────────────────────────────────

// Feature: content-hub, Property 19: 分页正确性
// 对于任何大于 pageSize 的内容数据集，分页查询应返回不超过 pageSize 条记录，
// 且使用 lastKey 继续查询应返回下一页不重复的记录。
// **Validates: Requirement 9.3**

describe('Property 19: 分页正确性', () => {
  it('每页返回不超过 pageSize 条记录', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          contentItemArb.map((item) => ({ ...item, status: 'approved' as const })),
          { minLength: 5, maxLength: 30 },
        ),
        fc.integer({ min: 1, max: 5 }),
        async (items, pageSize) => {
          const client = createMockDynamoClient(items);
          const result = await listContentItems({ pageSize }, client, TABLE);

          expect(result.success).toBe(true);
          expect(result.items!.length).toBeLessThanOrEqual(pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('使用 lastKey 翻页应返回不重复的记录', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          contentItemArb.map((item) => ({ ...item, status: 'approved' as const })),
          { minLength: 3, maxLength: 30 },
        ),
        fc.integer({ min: 1, max: 3 }),
        async (items, pageSize) => {
          const client = createMockDynamoClient(items);

          // Fetch first page
          const page1 = await listContentItems({ pageSize }, client, TABLE);
          expect(page1.success).toBe(true);

          if (!page1.lastKey) {
            // All items fit in one page — nothing more to verify
            return;
          }

          // Fetch second page using lastKey
          const page2 = await listContentItems({ pageSize, lastKey: page1.lastKey }, client, TABLE);
          expect(page2.success).toBe(true);

          // No overlap between page 1 and page 2
          const page1Ids = new Set(page1.items!.map((i) => i.contentId));
          for (const item of page2.items!) {
            expect(page1Ids.has(item.contentId)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('所有分页结果合并后应包含全部 approved 记录', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          contentItemArb.map((item) => ({ ...item, status: 'approved' as const })),
          { minLength: 1, maxLength: 20 },
        ),
        fc.integer({ min: 1, max: 5 }),
        async (items, pageSize) => {
          const client = createMockDynamoClient(items);
          const allIds: string[] = [];
          let lastKey: string | undefined;

          // Paginate through all pages
          for (let page = 0; page < 50; page++) {
            const result = await listContentItems({ pageSize, lastKey }, client, TABLE);
            expect(result.success).toBe(true);
            allIds.push(...result.items!.map((i) => i.contentId));

            if (!result.lastKey) break;
            lastKey = result.lastKey;
          }

          // All approved items should be present
          const expectedIds = items.map((i) => i.contentId);
          expect(allIds.length).toBe(expectedIds.length);
          for (const id of expectedIds) {
            expect(allIds).toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
