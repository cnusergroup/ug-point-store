import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { reviewContent, listAllContent } from './admin';
import { isSuperAdmin, ErrorCodes } from '@points-mall/shared';
import type { UserRole, ContentStatus } from '@points-mall/shared';

// ─── Helpers ───────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'];

function makeContentItem(overrides?: Partial<Record<string, any>>) {
  return {
    contentId: 'content-1',
    title: 'Test Content',
    description: 'A test content item',
    categoryId: 'cat-1',
    categoryName: 'Category 1',
    uploaderId: 'uploader-1',
    uploaderNickname: 'Uploader',
    uploaderRole: 'Speaker',
    fileKey: 'content/uploader-1/abc/test.pdf',
    fileName: 'test.pdf',
    fileSize: 1024,
    status: 'pending' as ContentStatus,
    likeCount: 0,
    commentCount: 0,
    reservationCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Property 4: 内容审核权限校验 ─────────────────────────

// Feature: content-hub, Property 4: 内容审核权限校验
// 对于任何用户角色集合，如果该集合不包含 SuperAdmin，则审核内容操作应被拒绝（CONTENT_REVIEW_FORBIDDEN）；
// 如果包含 SuperAdmin，则权限校验应通过。
// **Validates: Requirements 2.1**

/** Arbitrary: random non-empty subset of roles */
const roleSubsetArb: fc.Arbitrary<UserRole[]> = fc
  .subarray(ALL_ROLES, { minLength: 1 })
  .filter((arr) => arr.length > 0);

describe('Property 4: 内容审核权限校验', { tags: ['Feature: content-hub, Property 4: 内容审核权限校验'] }, () => {
  it('不含 SuperAdmin 的角色集合被拒绝，含 SuperAdmin 的角色集合通过', () => {
    fc.assert(
      fc.property(roleSubsetArb, (roles) => {
        const result = isSuperAdmin(roles);
        const hasSuperAdmin = roles.includes('SuperAdmin');

        if (hasSuperAdmin) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('空角色集合被拒绝', () => {
    expect(isSuperAdmin([])).toBe(false);
  });
});


// ─── Property 5: 管理端状态筛选正确性 ─────────────────────

// Feature: content-hub, Property 5: 管理端状态筛选正确性
// 对于任何有效的 ContentStatus 筛选值，管理端列表查询使用该状态筛选后返回的每条 ContentItem 的 status
// 都应等于指定的筛选值。
// **Validates: Requirements 2.2**

const contentStatusArb: fc.Arbitrary<ContentStatus> = fc.constantFrom('pending', 'approved', 'rejected');

/** Generate a random content item with a random status */
const contentItemArb = fc.record({
  contentId: fc.uuid(),
  status: contentStatusArb,
  createdAt: fc.integer({ min: 1672531200000, max: 1735689600000 }).map((ts) => new Date(ts).toISOString()),
}).map((r) => makeContentItem({ contentId: r.contentId, status: r.status, createdAt: r.createdAt }));

describe('Property 5: 管理端状态筛选正确性', { tags: ['Feature: content-hub, Property 5: 管理端状态筛选正确性'] }, () => {
  it('筛选后每条记录 status 等于指定值', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(contentItemArb, { minLength: 1, maxLength: 20 }),
        contentStatusArb,
        async (items, filterStatus) => {
          // Mock DynamoDB: QueryCommand returns only items matching the status
          const matchingItems = items.filter((i) => i.status === filterStatus);
          const dynamo = {
            send: vi.fn().mockImplementation((cmd: any) => {
              if (cmd.constructor.name === 'QueryCommand') {
                return Promise.resolve({ Items: matchingItems, LastEvaluatedKey: undefined });
              }
              return Promise.resolve({ Items: items, LastEvaluatedKey: undefined });
            }),
          } as any;

          const result = await listAllContent({ status: filterStatus }, dynamo, 'ContentItems');

          expect(result.success).toBe(true);
          for (const item of result.items ?? []) {
            expect(item.status).toBe(filterStatus);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 6: 内容审核状态流转正确性 ───────────────────

// Feature: content-hub, Property 6: 内容审核状态流转正确性
// 对于任何处于 pending 状态的 ContentItem，审核通过操作成功后 status 应变为 approved；
// 审核拒绝操作成功后 status 应变为 rejected 且 rejectReason 非空。
// 对于任何状态为 approved 或 rejected 的 ContentItem，再次审核应被拒绝并返回 CONTENT_ALREADY_REVIEWED。
// **Validates: Requirements 2.3, 2.4**

function createMockDynamoForReview(item: ReturnType<typeof makeContentItem>) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      if (cmd.constructor.name === 'GetCommand') {
        return Promise.resolve({ Item: { ...item } });
      }
      // UpdateCommand — just resolve
      return Promise.resolve({});
    }),
  } as any;
}

const rejectReasonArb = fc.string({ minLength: 1, maxLength: 200 });

describe('Property 6: 内容审核状态流转正确性', { tags: ['Feature: content-hub, Property 6: 内容审核状态流转正确性'] }, () => {
  it('pending→approve→approved', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (contentId, reviewerId) => {
        const item = makeContentItem({ contentId, status: 'pending' });
        const dynamo = createMockDynamoForReview(item);

        const result = await reviewContent(
          { contentId, reviewerId, action: 'approve' },
          dynamo,
          'ContentItems',
        );

        expect(result.success).toBe(true);
        expect(result.item?.status).toBe('approved');
        expect(result.item?.reviewerId).toBe(reviewerId);
        expect(result.item?.reviewedAt).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('pending→reject→rejected with rejectReason non-empty', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), rejectReasonArb, async (contentId, reviewerId, reason) => {
        const item = makeContentItem({ contentId, status: 'pending' });
        const dynamo = createMockDynamoForReview(item);

        const result = await reviewContent(
          { contentId, reviewerId, action: 'reject', rejectReason: reason },
          dynamo,
          'ContentItems',
        );

        expect(result.success).toBe(true);
        expect(result.item?.status).toBe('rejected');
        expect(result.item?.rejectReason).toBeDefined();
        expect(result.item!.rejectReason!.length).toBeGreaterThan(0);
        expect(result.item?.reviewerId).toBe(reviewerId);
        expect(result.item?.reviewedAt).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('approved/rejected→review→CONTENT_ALREADY_REVIEWED', async () => {
    const nonPendingStatusArb: fc.Arbitrary<ContentStatus> = fc.constantFrom('approved', 'rejected');

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        nonPendingStatusArb,
        fc.constantFrom('approve', 'reject') as fc.Arbitrary<'approve' | 'reject'>,
        async (contentId, reviewerId, currentStatus, action) => {
          const item = makeContentItem({ contentId, status: currentStatus });
          const dynamo = createMockDynamoForReview(item);

          const result = await reviewContent(
            { contentId, reviewerId, action, rejectReason: action === 'reject' ? 'reason' : undefined },
            dynamo,
            'ContentItems',
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.CONTENT_ALREADY_REVIEWED);
        },
      ),
      { numRuns: 100 },
    );
  });
});
