import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { toggleLike, type ToggleLikeInput } from './like';

// ─── Stateful Mock DynamoDB ────────────────────────────────
// Tracks likes and likeCount in-memory across operations.

interface MockState {
  likes: Map<string, { pk: string; userId: string; contentId: string; createdAt: string }>;
  likeCountByContent: Map<string, number>;
}

function createStatefulMockDynamoClient(state: MockState) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;

      if (name === 'GetCommand') {
        const tableName = cmd.input.TableName;
        if (tableName === 'ContentLikes') {
          const pk = cmd.input.Key.pk as string;
          const item = state.likes.get(pk);
          return Promise.resolve({ Item: item ?? undefined });
        }
        if (tableName === 'ContentItems') {
          const contentId = cmd.input.Key.contentId as string;
          const count = state.likeCountByContent.get(contentId) ?? 0;
          return Promise.resolve({ Item: { contentId, likeCount: count } });
        }
      }

      if (name === 'PutCommand') {
        const item = cmd.input.Item;
        state.likes.set(item.pk, { ...item });
        return Promise.resolve({});
      }

      if (name === 'DeleteCommand') {
        const pk = cmd.input.Key.pk as string;
        state.likes.delete(pk);
        return Promise.resolve({});
      }

      if (name === 'UpdateCommand') {
        const contentId = cmd.input.Key.contentId as string;
        const expr = cmd.input.UpdateExpression as string;
        const current = state.likeCountByContent.get(contentId) ?? 0;
        if (expr.includes('+ :inc')) {
          state.likeCountByContent.set(contentId, current + 1);
        } else if (expr.includes('- :dec')) {
          state.likeCountByContent.set(contentId, Math.max(0, current - 1));
        }
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;
}

const tables = {
  likesTable: 'ContentLikes',
  contentItemsTable: 'ContentItems',
};

// ─── Arbitraries ───────────────────────────────────────────

const userIdArb = fc.uuid();
const contentIdArb = fc.uuid();

// ─── Property 15 ───────────────────────────────────────────

// Feature: content-hub, Property 15: 点赞切换 Round-Trip
// 对于任何用户和 ContentItem 的组合，执行点赞后再执行取消点赞，
// likeCount 应恢复到初始值，且 Like 记录应被删除。
// **Validates: Requirements 8.1, 8.2**

describe('Property 15: 点赞切换 Round-Trip', () => {
  it('点赞后再取消点赞，likeCount 恢复初始值且 Like 记录被删除', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, contentIdArb, async (userId, contentId) => {
        const state: MockState = {
          likes: new Map(),
          likeCountByContent: new Map([[contentId, 0]]),
        };
        const client = createStatefulMockDynamoClient(state);
        const input: ToggleLikeInput = { contentId, userId };

        const initialCount = state.likeCountByContent.get(contentId)!;

        // Like
        const likeResult = await toggleLike(input, client, tables);
        expect(likeResult.success).toBe(true);
        expect(likeResult.liked).toBe(true);

        // Verify like record exists
        const pk = `${userId}#${contentId}`;
        expect(state.likes.has(pk)).toBe(true);

        // Unlike
        const unlikeResult = await toggleLike(input, client, tables);
        expect(unlikeResult.success).toBe(true);
        expect(unlikeResult.liked).toBe(false);

        // Verify like record is deleted
        expect(state.likes.has(pk)).toBe(false);

        // Verify likeCount restored to initial value
        expect(state.likeCountByContent.get(contentId)).toBe(initialCount);
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 16 ───────────────────────────────────────────

// Feature: content-hub, Property 16: 点赞计数非负不变量
// 对于任何点赞/取消点赞操作序列，ContentItem 的 likeCount 在任何时刻都应大于等于 0。
// **Validates: Requirement 8.5**

describe('Property 16: 点赞计数非负不变量', () => {
  it('随机点赞/取消序列中 likeCount 始终 ≥ 0', async () => {
    // Generate a sequence of (userId, contentId) toggle operations
    const operationArb = fc.record({
      userId: fc.constantFrom('user-a', 'user-b', 'user-c', 'user-d', 'user-e'),
      contentId: fc.constant('content-fixed'),
    });
    const operationsArb = fc.array(operationArb, { minLength: 1, maxLength: 20 });

    await fc.assert(
      fc.asyncProperty(operationsArb, async (operations) => {
        const state: MockState = {
          likes: new Map(),
          likeCountByContent: new Map([['content-fixed', 0]]),
        };
        const client = createStatefulMockDynamoClient(state);

        for (const op of operations) {
          const input: ToggleLikeInput = { contentId: op.contentId, userId: op.userId };
          await toggleLike(input, client, tables);

          // Check invariant after every operation
          const count = state.likeCountByContent.get(op.contentId) ?? 0;
          expect(count).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 17 ───────────────────────────────────────────

// Feature: content-hub, Property 17: 点赞幂等性
// 对于任何用户和 ContentItem 的组合，无论执行多少次点赞操作，
// ContentLikes 表中该组合的记录最多存在一条。
// **Validates: Requirement 8.6**

describe('Property 17: 点赞幂等性', () => {
  it('多次操作后 ContentLikes 表中每个 user/content 组合最多一条记录', async () => {
    const pairArb = fc.record({
      userId: fc.constantFrom('user-x', 'user-y', 'user-z'),
      contentId: fc.constantFrom('content-1', 'content-2'),
    });
    const operationsArb = fc.array(pairArb, { minLength: 1, maxLength: 30 });

    await fc.assert(
      fc.asyncProperty(operationsArb, async (operations) => {
        const contentIds = [...new Set(operations.map((o) => o.contentId))];
        const state: MockState = {
          likes: new Map(),
          likeCountByContent: new Map(contentIds.map((id) => [id, 0])),
        };
        const client = createStatefulMockDynamoClient(state);

        for (const op of operations) {
          const input: ToggleLikeInput = { contentId: op.contentId, userId: op.userId };
          await toggleLike(input, client, tables);
        }

        // After all operations, verify each user/content pair has at most 1 record
        const seenPks = new Set<string>();
        for (const [pk] of state.likes) {
          expect(seenPks.has(pk)).toBe(false);
          seenPks.add(pk);
        }

        // Also verify likeCount matches actual number of like records per content
        for (const cId of contentIds) {
          const actualLikes = [...state.likes.values()].filter((l) => l.contentId === cId).length;
          expect(state.likeCountByContent.get(cId)).toBe(actualLikes);
        }
      }),
      { numRuns: 100 },
    );
  });
});
