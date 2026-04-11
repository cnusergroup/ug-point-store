import { describe, it, expect, vi } from 'vitest';
import { toggleLike, type ToggleLikeInput } from './like';

// ─── Mock helpers ──────────────────────────────────────────

function createMockDynamoClient(overrides?: {
  likeExists?: boolean;
  likeCount?: number;
}) {
  const likeExists = overrides?.likeExists ?? false;
  const likeCount = overrides?.likeCount ?? 0;

  // Track state so we can simulate toggle behavior
  let currentLikeExists = likeExists;
  let currentLikeCount = likeCount;

  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;

      if (name === 'GetCommand') {
        const tableName = cmd.input.TableName;
        if (tableName === 'ContentLikes') {
          // Return like record if it exists
          return Promise.resolve({
            Item: currentLikeExists
              ? { pk: 'user-1#content-1', userId: 'user-1', contentId: 'content-1', createdAt: '2024-01-01T00:00:00Z' }
              : undefined,
          });
        }
        if (tableName === 'ContentItems') {
          // Return content item with current likeCount
          return Promise.resolve({
            Item: { contentId: 'content-1', likeCount: currentLikeCount },
          });
        }
      }

      if (name === 'PutCommand') {
        currentLikeExists = true;
        return Promise.resolve({});
      }

      if (name === 'DeleteCommand') {
        currentLikeExists = false;
        return Promise.resolve({});
      }

      if (name === 'UpdateCommand') {
        // Simulate likeCount increment/decrement
        const expr = cmd.input.UpdateExpression as string;
        if (expr.includes('+ :inc')) {
          currentLikeCount += 1;
        } else if (expr.includes('- :dec')) {
          currentLikeCount = Math.max(0, currentLikeCount - 1);
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

const validInput: ToggleLikeInput = {
  contentId: 'content-1',
  userId: 'user-1',
};

// ─── toggleLike: first like creates a record ───────────────

describe('toggleLike', () => {
  it('should create a like record on first like (liked=true)', async () => {
    const dynamo = createMockDynamoClient({ likeExists: false, likeCount: 0 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(true);
  });

  it('should remove like record on second like (liked=false)', async () => {
    const dynamo = createMockDynamoClient({ likeExists: true, likeCount: 1 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(false);
  });

  it('should increment likeCount on like', async () => {
    const dynamo = createMockDynamoClient({ likeExists: false, likeCount: 5 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(6);
  });

  it('should decrement likeCount on unlike', async () => {
    const dynamo = createMockDynamoClient({ likeExists: true, likeCount: 3 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(false);
    expect(result.likeCount).toBe(2);
  });

  it('should return correct liked status and likeCount after like', async () => {
    const dynamo = createMockDynamoClient({ likeExists: false, likeCount: 10 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(11);
  });

  it('should return correct liked status and likeCount after unlike', async () => {
    const dynamo = createMockDynamoClient({ likeExists: true, likeCount: 10 });
    const result = await toggleLike(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.liked).toBe(false);
    expect(result.likeCount).toBe(9);
  });

  it('should use PutCommand when creating a like', async () => {
    const dynamo = createMockDynamoClient({ likeExists: false, likeCount: 0 });
    await toggleLike(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    // Call sequence: GetCommand (check like), PutCommand (create like), UpdateCommand (increment), GetCommand (get updated content)
    const putCall = calls.find((c: any) => c[0].constructor.name === 'PutCommand');
    expect(putCall).toBeDefined();
    expect(putCall![0].input.Item.pk).toBe('user-1#content-1');
    expect(putCall![0].input.Item.userId).toBe('user-1');
    expect(putCall![0].input.Item.contentId).toBe('content-1');
  });

  it('should use DeleteCommand when removing a like', async () => {
    const dynamo = createMockDynamoClient({ likeExists: true, likeCount: 1 });
    await toggleLike(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    const deleteCall = calls.find((c: any) => c[0].constructor.name === 'DeleteCommand');
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key.pk).toBe('user-1#content-1');
  });

  it('should use UpdateCommand to atomically increment likeCount', async () => {
    const dynamo = createMockDynamoClient({ likeExists: false, likeCount: 0 });
    await toggleLike(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    const updateCall = calls.find((c: any) => c[0].constructor.name === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.UpdateExpression).toContain('+ :inc');
  });

  it('should use UpdateCommand to atomically decrement likeCount', async () => {
    const dynamo = createMockDynamoClient({ likeExists: true, likeCount: 5 });
    await toggleLike(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    const updateCall = calls.find((c: any) => c[0].constructor.name === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.UpdateExpression).toContain('- :dec');
  });
});
