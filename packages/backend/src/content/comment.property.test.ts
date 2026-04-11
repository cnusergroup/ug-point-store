import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { addComment, listComments, type AddCommentInput } from './comment';
import { ErrorCodes } from '@points-mall/shared';

// ─── Shared helpers ────────────────────────────────────────

const tables = {
  commentsTable: 'ContentComments',
  contentItemsTable: 'ContentItems',
};

/** Mock DynamoDB client for addComment — content exists and is approved */
function createAddCommentMockClient() {
  let updateCalled = false;
  return {
    client: {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: { contentId: 'content-1', status: 'approved' } });
        }
        if (name === 'UpdateCommand') {
          updateCalled = true;
        }
        return Promise.resolve({});
      }),
    } as any,
    wasUpdateCalled: () => updateCalled,
  };
}

/** Mock DynamoDB client for listComments — returns pre-sorted items */
function createListCommentsMockClient(comments: Record<string, any>[]) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const input = cmd.input;
      const contentId = input.ExpressionAttributeValues[':contentId'];

      let filtered = comments.filter((c) => c.contentId === contentId);

      // Simulate ScanIndexForward=false (descending by createdAt)
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const limit = input.Limit ?? 20;
      const page = filtered.slice(0, limit);

      return Promise.resolve({
        Items: page,
        LastEvaluatedKey: page.length < filtered.length
          ? { commentId: page[page.length - 1].commentId, contentId, createdAt: page[page.length - 1].createdAt }
          : undefined,
      });
    }),
  } as any;
}

// ─── Arbitraries ───────────────────────────────────────────

const validCommentContentArb = fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0);

const commentInputArb: fc.Arbitrary<AddCommentInput> = fc.record({
  contentId: fc.constant('content-1'),
  userId: fc.uuid(),
  userNickname: fc.string({ minLength: 1, maxLength: 30 }),
  userRole: fc.constantFrom('UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'),
  content: validCommentContentArb,
});


// ─── Property 12 ───────────────────────────────────────────

// Feature: content-hub, Property 12: 评论内容校验正确性
// 对于任何字符串，如果该字符串为空（含纯空白字符）或长度超过 500 字符，则提交评论应被拒绝；
// 如果长度在 1~500 字符范围内且非纯空白，则校验应通过。
// **Validates: Requirements 7.3, 7.4**

describe('Property 12: 评论内容校验正确性', () => {
  it('空白字符串应被拒绝', async () => {
    const whitespaceArb = fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 50 }).map((chars) => chars.join(''));

    await fc.assert(
      fc.asyncProperty(whitespaceArb, async (blankContent) => {
        const mock = createAddCommentMockClient();
        const input: AddCommentInput = {
          contentId: 'content-1',
          userId: 'user-1',
          userNickname: 'Alice',
          userRole: 'Speaker',
          content: blankContent,
        };
        const result = await addComment(input, mock.client, tables);

        expect(result.success).toBe(false);
        expect(result.error!.code).toBe(ErrorCodes.INVALID_COMMENT_CONTENT);
      }),
      { numRuns: 100 },
    );
  });

  it('超过 500 字符的字符串应被拒绝', async () => {
    const longContentArb = fc.string({ minLength: 501, maxLength: 1000 });

    await fc.assert(
      fc.asyncProperty(longContentArb, async (longContent) => {
        const mock = createAddCommentMockClient();
        const input: AddCommentInput = {
          contentId: 'content-1',
          userId: 'user-1',
          userNickname: 'Alice',
          userRole: 'Speaker',
          content: longContent,
        };
        const result = await addComment(input, mock.client, tables);

        expect(result.success).toBe(false);
        expect(result.error!.code).toBe(ErrorCodes.INVALID_COMMENT_CONTENT);
      }),
      { numRuns: 100 },
    );
  });

  it('1~500 字符的非空白字符串应通过校验', async () => {
    await fc.assert(
      fc.asyncProperty(validCommentContentArb, async (validContent) => {
        const mock = createAddCommentMockClient();
        const input: AddCommentInput = {
          contentId: 'content-1',
          userId: 'user-1',
          userNickname: 'Alice',
          userRole: 'Speaker',
          content: validContent,
        };
        const result = await addComment(input, mock.client, tables);

        expect(result.success).toBe(true);
        expect(result.comment).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13 ───────────────────────────────────────────

// Feature: content-hub, Property 13: 评论列表时间倒序
// 对于任何包含多条评论的 ContentItem，查询评论列表返回的结果应按 createdAt 降序排列。
// **Validates: Requirement 7.2**

describe('Property 13: 评论列表时间倒序', () => {
  it('查询结果应按 createdAt 降序排列', async () => {
    const commentArb = fc.record({
      commentId: fc.uuid(),
      contentId: fc.constant('content-1'),
      userId: fc.uuid(),
      userNickname: fc.string({ minLength: 1, maxLength: 20 }),
      userRole: fc.constantFrom('Speaker', 'Volunteer', 'Admin'),
      content: fc.string({ minLength: 1, maxLength: 100 }),
      createdAt: fc.integer({ min: 1704067200000, max: 1767225600000 }).map((ts) => new Date(ts).toISOString()),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(commentArb, { minLength: 2, maxLength: 30 }),
        async (comments) => {
          const client = createListCommentsMockClient(comments);
          const result = await listComments({ contentId: 'content-1', pageSize: 100 }, client, tables.commentsTable);

          expect(result.success).toBe(true);
          const returned = result.comments!;
          for (let i = 1; i < returned.length; i++) {
            const prev = new Date(returned[i - 1].createdAt).getTime();
            const curr = new Date(returned[i].createdAt).getTime();
            expect(prev).toBeGreaterThanOrEqual(curr);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14 ───────────────────────────────────────────

// Feature: content-hub, Property 14: 评论记录完整性
// 对于任何成功创建的评论，返回的 Comment 记录应包含 userNickname、userRole 和 createdAt 字段，
// 且 commentCount 应递增 1。
// **Validates: Requirements 7.5, 7.6**

describe('Property 14: 评论记录完整性', () => {
  it('返回的 Comment 应包含 userNickname、userRole、createdAt 且 commentCount 递增', async () => {
    await fc.assert(
      fc.asyncProperty(commentInputArb, async (input) => {
        const mock = createAddCommentMockClient();
        const result = await addComment(input, mock.client, tables);

        expect(result.success).toBe(true);
        const comment = result.comment!;

        // Verify required fields are present
        expect(comment.userNickname).toBe(input.userNickname);
        expect(comment.userRole).toBe(input.userRole);
        expect(comment.createdAt).toBeDefined();
        expect(typeof comment.createdAt).toBe('string');
        expect(comment.commentId).toBeDefined();
        expect(comment.contentId).toBe(input.contentId);
        expect(comment.userId).toBe(input.userId);
        expect(comment.content).toBe(input.content);

        // Verify UpdateCommand was called (commentCount increment)
        expect(mock.wasUpdateCalled()).toBe(true);

        // Verify the UpdateCommand had the correct increment expression
        const calls = mock.client.send.mock.calls;
        const updateCall = calls.find((c: any) => c[0].constructor.name === 'UpdateCommand');
        expect(updateCall).toBeDefined();
        expect(updateCall![0].input.UpdateExpression).toContain('commentCount = commentCount + :inc');
        expect(updateCall![0].input.ExpressionAttributeValues[':inc']).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
