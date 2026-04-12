import { describe, it, expect, vi } from 'vitest';
import { listContentItems, getContentDetail } from './list';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock helpers ──────────────────────────────────────────

const contentItemsTable = 'ContentItems';
const reservationsTable = 'ContentReservations';
const likesTable = 'ContentLikes';
const tables = { contentItemsTable, reservationsTable, likesTable };

function makeApprovedItem(overrides: Record<string, any> = {}) {
  return {
    contentId: 'c-1',
    title: 'Test Content',
    description: 'A test description',
    categoryId: 'cat-1',
    categoryName: 'Tech',
    uploaderId: 'user-uploader',
    uploaderNickname: 'Uploader',
    uploaderRole: 'Speaker',
    fileKey: 'content/user-uploader/ABC/slides.pptx',
    fileName: 'slides.pptx',
    fileSize: 1024,
    status: 'approved',
    likeCount: 5,
    commentCount: 3,
    reservationCount: 2,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ─── listContentItems ──────────────────────────────────────

describe('listContentItems', () => {
  it('should return only approved content items', async () => {
    const approvedItem = makeApprovedItem();
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [approvedItem],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({}, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].contentId).toBe('c-1');
    expect(result.items![0].title).toBe('Test Content');

    // Verify the query used status-createdAt-index with status=approved
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.IndexName).toBe('status-createdAt-index');
    expect(sentCmd.input.ExpressionAttributeValues[':approved']).toBe('approved');
    expect(sentCmd.input.ScanIndexForward).toBe(false);
  });

  it('should filter by categoryId when provided', async () => {
    const item = makeApprovedItem({ categoryId: 'cat-2', categoryName: 'Design' });
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({ categoryId: 'cat-2' }, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);

    // Verify the query used categoryId-createdAt-index
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.IndexName).toBe('categoryId-createdAt-index');
    expect(sentCmd.input.ExpressionAttributeValues[':categoryId']).toBe('cat-2');
    expect(sentCmd.input.FilterExpression).toBe('#status = :approved');
  });

  it('should support pagination with pageSize', async () => {
    const items = [makeApprovedItem({ contentId: 'c-1' }), makeApprovedItem({ contentId: 'c-2' })];
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: items,
        LastEvaluatedKey: { contentId: 'c-2', status: 'approved', createdAt: '2024-01-15T10:00:00.000Z' },
      }),
    } as any;

    const result = await listContentItems({ pageSize: 2 }, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.lastKey).toBeDefined();

    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.Limit).toBe(2);
  });

  it('should pass lastKey as ExclusiveStartKey for pagination', async () => {
    const lastKeyObj = { contentId: 'c-2', status: 'approved', createdAt: '2024-01-15T10:00:00.000Z' };
    const encodedLastKey = Buffer.from(JSON.stringify(lastKeyObj)).toString('base64');

    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [makeApprovedItem({ contentId: 'c-3' })],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({ lastKey: encodedLastKey }, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.lastKey).toBeUndefined();

    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.ExclusiveStartKey).toEqual(lastKeyObj);
  });

  it('should return empty array when no items exist', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({}, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return summary fields only', async () => {
    const item = makeApprovedItem();
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({}, dynamo, contentItemsTable);
    const summary = result.items![0];

    expect(summary).toHaveProperty('contentId');
    expect(summary).toHaveProperty('title');
    expect(summary).toHaveProperty('categoryName');
    expect(summary).toHaveProperty('uploaderNickname');
    expect(summary).toHaveProperty('likeCount');
    expect(summary).toHaveProperty('commentCount');
    expect(summary).toHaveProperty('reservationCount');
    expect(summary).toHaveProperty('createdAt');
    // Should NOT include full detail fields
    expect(summary).not.toHaveProperty('description');
    expect(summary).not.toHaveProperty('fileKey');
    expect(summary).not.toHaveProperty('status');
  });

  // ── Tag filtering tests ──────────────────────────────────

  it('should filter by tag when tag option is provided', async () => {
    const item = makeApprovedItem({ tags: ['react', 'typescript'] });
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({ tag: 'react' }, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);

    // Verify the query includes tag filter expression
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.FilterExpression).toContain('contains(tags, :tag)');
    expect(sentCmd.input.ExpressionAttributeValues[':tag']).toBe('react');
  });

  it('should support combined tag and categoryId filtering', async () => {
    const item = makeApprovedItem({ categoryId: 'cat-2', categoryName: 'Design', tags: ['figma'] });
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({ categoryId: 'cat-2', tag: 'figma' }, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);

    // Verify the query uses categoryId GSI with both status and tag filters
    const sentCmd = dynamo.send.mock.calls[0][0];
    expect(sentCmd.input.IndexName).toBe('categoryId-createdAt-index');
    expect(sentCmd.input.FilterExpression).toContain('#status = :approved');
    expect(sentCmd.input.FilterExpression).toContain('contains(tags, :tag)');
    expect(sentCmd.input.ExpressionAttributeValues[':tag']).toBe('figma');
  });

  it('should return tags as empty array for old content without tags field', async () => {
    // Simulate old content item that has no tags field
    const oldItem = makeApprovedItem();
    delete (oldItem as any).tags;

    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [oldItem],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({}, dynamo, contentItemsTable);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].tags).toEqual([]);
  });

  it('should include tags in summary fields', async () => {
    const item = makeApprovedItem({ tags: ['react', 'aws'] });
    const dynamo = {
      send: vi.fn().mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      }),
    } as any;

    const result = await listContentItems({}, dynamo, contentItemsTable);
    const summary = result.items![0];

    expect(summary).toHaveProperty('tags');
    expect(summary.tags).toEqual(['react', 'aws']);
  });
});

// ─── getContentDetail ──────────────────────────────────────

describe('getContentDetail', () => {
  it('should return content detail with hasReserved and hasLiked flags', async () => {
    const item = makeApprovedItem();
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const tableName = cmd.input.TableName;
        if (tableName === contentItemsTable) {
          return Promise.resolve({ Item: item });
        }
        if (tableName === reservationsTable) {
          return Promise.resolve({ Item: { pk: 'user-1#c-1' } });
        }
        if (tableName === likesTable) {
          return Promise.resolve({ Item: { pk: 'user-1#c-1' } });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await getContentDetail('c-1', 'user-1', dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.contentId).toBe('c-1');
    expect(result.hasReserved).toBe(true);
    expect(result.hasLiked).toBe(true);
  });

  it('should return hasReserved=false and hasLiked=false when user has not interacted', async () => {
    const item = makeApprovedItem();
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const tableName = cmd.input.TableName;
        if (tableName === contentItemsTable) {
          return Promise.resolve({ Item: item });
        }
        // No reservation or like records
        return Promise.resolve({ Item: undefined });
      }),
    } as any;

    const result = await getContentDetail('c-1', 'user-1', dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.hasReserved).toBe(false);
    expect(result.hasLiked).toBe(false);
  });

  it('should return hasReserved=false and hasLiked=false when userId is null', async () => {
    const item = makeApprovedItem();
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        return Promise.resolve({ Item: item });
      }),
    } as any;

    const result = await getContentDetail('c-1', null, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.hasReserved).toBe(false);
    expect(result.hasLiked).toBe(false);

    // Should only call once (GetCommand for content item), no reservation/like queries
    expect(dynamo.send).toHaveBeenCalledTimes(1);
  });

  it('should return CONTENT_NOT_FOUND for non-approved content', async () => {
    const pendingItem = makeApprovedItem({ status: 'pending' });
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Item: pendingItem }),
    } as any;

    const result = await getContentDetail('c-1', 'user-1', dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should return CONTENT_NOT_FOUND for rejected content', async () => {
    const rejectedItem = makeApprovedItem({ status: 'rejected' });
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Item: rejectedItem }),
    } as any;

    const result = await getContentDetail('c-1', 'user-1', dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Item: undefined }),
    } as any;

    const result = await getContentDetail('nonexistent', 'user-1', dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  it('should allow uploader to view their own pending content', async () => {
    const pendingItem = makeApprovedItem({ status: 'pending' });
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const tableName = cmd.input.TableName;
        if (tableName === contentItemsTable) {
          return Promise.resolve({ Item: pendingItem });
        }
        return Promise.resolve({ Item: undefined });
      }),
    } as any;

    const result = await getContentDetail('c-1', 'user-uploader', dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.contentId).toBe('c-1');
    expect(result.item!.status).toBe('pending');
  });

  it('should allow uploader to view their own rejected content', async () => {
    const rejectedItem = makeApprovedItem({ status: 'rejected', rejectReason: 'Low quality' });
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const tableName = cmd.input.TableName;
        if (tableName === contentItemsTable) {
          return Promise.resolve({ Item: rejectedItem });
        }
        return Promise.resolve({ Item: undefined });
      }),
    } as any;

    const result = await getContentDetail('c-1', 'user-uploader', dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.contentId).toBe('c-1');
    expect(result.item!.status).toBe('rejected');
  });

  it('should return CONTENT_NOT_FOUND when non-uploader views non-approved content', async () => {
    const pendingItem = makeApprovedItem({ status: 'pending' });
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Item: pendingItem }),
    } as any;

    const result = await getContentDetail('c-1', 'other-user', dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });
});
