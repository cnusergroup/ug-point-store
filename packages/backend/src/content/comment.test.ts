import { describe, it, expect, vi } from 'vitest';
import { addComment, listComments, type AddCommentInput } from './comment';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock helpers ──────────────────────────────────────────

function createMockDynamoClient(overrides?: {
  getResult?: any;
  queryResult?: any;
}) {
  const getResult = overrides?.getResult ?? {};
  const queryResult = overrides?.queryResult ?? { Items: [], LastEvaluatedKey: undefined };

  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'GetCommand') return Promise.resolve(getResult);
      if (name === 'QueryCommand') return Promise.resolve(queryResult);
      // PutCommand / UpdateCommand
      return Promise.resolve({});
    }),
  } as any;
}

const tables = {
  commentsTable: 'ContentComments',
  contentItemsTable: 'ContentItems',
};

const validInput: AddCommentInput = {
  contentId: 'content-1',
  userId: 'user-1',
  userNickname: 'Alice',
  userRole: 'Speaker',
  content: 'Great presentation!',
};

// ─── addComment ────────────────────────────────────────────

describe('addComment', () => {
  it('should create a comment for valid input on approved content', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    const result = await addComment(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.comment).toBeDefined();
    expect(result.comment!.contentId).toBe('content-1');
    expect(result.comment!.userId).toBe('user-1');
    expect(result.comment!.userNickname).toBe('Alice');
    expect(result.comment!.userRole).toBe('Speaker');
    expect(result.comment!.content).toBe('Great presentation!');
    expect(result.comment!.commentId).toBeDefined();
    expect(result.comment!.createdAt).toBeDefined();
  });

  it('should reject blank comment (empty string)', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    const result = await addComment({ ...validInput, content: '' }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_COMMENT_CONTENT);
  });

  it('should reject whitespace-only comment', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    const result = await addComment({ ...validInput, content: '   \t\n  ' }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_COMMENT_CONTENT);
  });

  it('should reject comment exceeding 500 characters', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    const longContent = 'A'.repeat(501);
    const result = await addComment({ ...validInput, content: longContent }, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.INVALID_COMMENT_CONTENT);
  });

  it('should accept comment with exactly 500 characters', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    const result = await addComment(
      { ...validInput, content: 'A'.repeat(500) },
      dynamo,
      tables,
    );

    expect(result.success).toBe(true);
    expect(result.comment).toBeDefined();
  });

  it('should return CONTENT_NOT_FOUND for non-existent content', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: undefined },
    });
    const result = await addComment(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should return CONTENT_NOT_FOUND for non-approved content (pending)', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'pending' } },
    });
    const result = await addComment(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should return CONTENT_NOT_FOUND for rejected content', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'rejected' } },
    });
    const result = await addComment(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should increment commentCount via UpdateCommand', async () => {
    const dynamo = createMockDynamoClient({
      getResult: { Item: { contentId: 'content-1', status: 'approved' } },
    });
    await addComment(validInput, dynamo, tables);

    // The third call should be UpdateCommand (1: GetCommand, 2: PutCommand, 3: UpdateCommand)
    const calls = dynamo.send.mock.calls;
    expect(calls.length).toBe(3);
    const updateCmd = calls[2][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
    expect(updateCmd.input.UpdateExpression).toContain('commentCount = commentCount + :inc');
  });
});

// ─── listComments ──────────────────────────────────────────

describe('listComments', () => {
  it('should return comments in time descending order', async () => {
    const comments = [
      { commentId: 'c3', contentId: 'content-1', createdAt: '2024-01-03T00:00:00Z' },
      { commentId: 'c2', contentId: 'content-1', createdAt: '2024-01-02T00:00:00Z' },
      { commentId: 'c1', contentId: 'content-1', createdAt: '2024-01-01T00:00:00Z' },
    ];
    const dynamo = createMockDynamoClient({
      queryResult: { Items: comments, LastEvaluatedKey: undefined },
    });

    const result = await listComments(
      { contentId: 'content-1' },
      dynamo,
      tables.commentsTable,
    );

    expect(result.success).toBe(true);
    expect(result.comments).toHaveLength(3);
    // Verify ScanIndexForward=false was used (time descending)
    const queryCmd = dynamo.send.mock.calls[0][0];
    expect(queryCmd.input.ScanIndexForward).toBe(false);
  });

  it('should default pageSize to 20', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: { Items: [], LastEvaluatedKey: undefined },
    });

    await listComments({ contentId: 'content-1' }, dynamo, tables.commentsTable);

    const queryCmd = dynamo.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: { Items: [], LastEvaluatedKey: undefined },
    });

    await listComments(
      { contentId: 'content-1', pageSize: 200 },
      dynamo,
      tables.commentsTable,
    );

    const queryCmd = dynamo.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(100);
  });

  it('should return lastKey when more results exist', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: {
        Items: [{ commentId: 'c1' }],
        LastEvaluatedKey: { commentId: 'c1', contentId: 'content-1', createdAt: '2024-01-01T00:00:00Z' },
      },
    });

    const result = await listComments(
      { contentId: 'content-1', pageSize: 1 },
      dynamo,
      tables.commentsTable,
    );

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
  });

  it('should not return lastKey when no more results', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: { Items: [{ commentId: 'c1' }], LastEvaluatedKey: undefined },
    });

    const result = await listComments(
      { contentId: 'content-1' },
      dynamo,
      tables.commentsTable,
    );

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return empty array when no comments exist', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: { Items: [], LastEvaluatedKey: undefined },
    });

    const result = await listComments(
      { contentId: 'content-1' },
      dynamo,
      tables.commentsTable,
    );

    expect(result.success).toBe(true);
    expect(result.comments).toHaveLength(0);
  });

  it('should use contentId-createdAt-index GSI', async () => {
    const dynamo = createMockDynamoClient({
      queryResult: { Items: [], LastEvaluatedKey: undefined },
    });

    await listComments({ contentId: 'content-1' }, dynamo, tables.commentsTable);

    const queryCmd = dynamo.send.mock.calls[0][0];
    expect(queryCmd.input.IndexName).toBe('contentId-createdAt-index');
  });
});
