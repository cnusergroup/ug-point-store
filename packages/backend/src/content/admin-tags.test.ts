import { describe, it, expect, vi } from 'vitest';
import { listAllTags, mergeTags, deleteTag } from './admin-tags';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock helpers ──────────────────────────────────────────

function makeTagRecord(overrides?: Partial<Record<string, any>>) {
  return {
    tagId: 'tag-1',
    tagName: 'react',
    usageCount: 5,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContentItem(overrides?: Partial<Record<string, any>>) {
  return {
    contentId: 'content-1',
    title: 'Test Content',
    tags: ['react'],
    status: 'approved',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const contentTagsTable = 'ContentTags';
const contentItemsTable = 'ContentItems';
const tables = { contentTagsTable, contentItemsTable };

// ─── listAllTags ───────────────────────────────────────────

describe('listAllTags', () => {
  it('should return tags sorted by tagName ascending', async () => {
    const tags = [
      makeTagRecord({ tagId: 'tag-3', tagName: 'vue', usageCount: 2 }),
      makeTagRecord({ tagId: 'tag-1', tagName: 'angular', usageCount: 3 }),
      makeTagRecord({ tagId: 'tag-2', tagName: 'react', usageCount: 10 }),
    ];
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Items: tags }),
    } as any;

    const result = await listAllTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toHaveLength(3);
    expect(result.tags![0].tagName).toBe('angular');
    expect(result.tags![1].tagName).toBe('react');
    expect(result.tags![2].tagName).toBe('vue');
  });

  it('should return empty array when no tags exist', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Items: [] }),
    } as any;

    const result = await listAllTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toHaveLength(0);
  });

  it('should handle undefined Items from DynamoDB', async () => {
    const dynamo = {
      send: vi.fn().mockResolvedValue({ Items: undefined }),
    } as any;

    const result = await listAllTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toHaveLength(0);
  });
});

// ─── mergeTags ─────────────────────────────────────────────

describe('mergeTags', () => {
  it('should merge source tag into target tag successfully', async () => {
    const sourceTag = makeTagRecord({ tagId: 'src-1', tagName: 'reactjs', usageCount: 3 });
    const targetTag = makeTagRecord({ tagId: 'tgt-1', tagName: 'react', usageCount: 5 });
    const matchingItems = [
      makeContentItem({ contentId: 'c1', tags: ['reactjs', 'typescript'] }),
      makeContentItem({ contentId: 'c2', tags: ['reactjs'] }),
    ];

    let callIndex = 0;
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          callIndex++;
          if (callIndex === 1) return Promise.resolve({ Item: sourceTag });
          return Promise.resolve({ Item: targetTag });
        }
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: matchingItems });
        }
        // UpdateCommand / DeleteCommand
        return Promise.resolve({});
      }),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'src-1', targetTagId: 'tgt-1' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(true);

    // Verify UpdateCommand calls for content items + target tag usageCount + DeleteCommand for source
    const calls = dynamo.send.mock.calls;
    const updateCalls = calls.filter((c: any) => c[0].constructor.name === 'UpdateCommand');
    const deleteCalls = calls.filter((c: any) => c[0].constructor.name === 'DeleteCommand');

    // 2 content items updated + 1 target usageCount update = 3 UpdateCommands
    expect(updateCalls.length).toBe(3);
    // 1 source tag deleted
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][0].input.Key.tagId).toBe('src-1');
  });

  it('should handle dedup when content item already has target tag', async () => {
    const sourceTag = makeTagRecord({ tagId: 'src-1', tagName: 'reactjs', usageCount: 2 });
    const targetTag = makeTagRecord({ tagId: 'tgt-1', tagName: 'react', usageCount: 5 });
    // This item already has both source and target tags
    const matchingItems = [
      makeContentItem({ contentId: 'c1', tags: ['reactjs', 'react'] }),
      makeContentItem({ contentId: 'c2', tags: ['reactjs'] }),
    ];

    let callIndex = 0;
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          callIndex++;
          if (callIndex === 1) return Promise.resolve({ Item: sourceTag });
          return Promise.resolve({ Item: targetTag });
        }
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: matchingItems });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'src-1', targetTagId: 'tgt-1' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(true);

    // Verify the usageCount update accounts for dedup
    const updateCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );

    // Find the usageCount update for target tag (uses ADD expression)
    const usageCountUpdate = updateCalls.find(
      (c: any) => c[0].input.TableName === contentTagsTable,
    );
    expect(usageCountUpdate).toBeDefined();
    // usageIncrement = sourceTag.usageCount(2) - dedupCount(1) = 1
    expect(usageCountUpdate![0].input.ExpressionAttributeValues[':inc']).toBe(1);
  });

  it('should reject self-merge (sourceTagId === targetTagId)', async () => {
    const dynamo = {
      send: vi.fn(),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'tag-1', targetTagId: 'tag-1' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TAG_MERGE_SELF_ERROR);
    // Should not call DynamoDB at all
    expect(dynamo.send).not.toHaveBeenCalled();
  });

  it('should return TAG_NOT_FOUND when source tag does not exist', async () => {
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: undefined });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'nonexistent', targetTagId: 'tgt-1' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TAG_NOT_FOUND);
  });

  it('should return TAG_NOT_FOUND when target tag does not exist', async () => {
    const sourceTag = makeTagRecord({ tagId: 'src-1', tagName: 'reactjs', usageCount: 3 });

    let callIndex = 0;
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          callIndex++;
          if (callIndex === 1) return Promise.resolve({ Item: sourceTag });
          return Promise.resolve({ Item: undefined }); // target not found
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'src-1', targetTagId: 'nonexistent' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TAG_NOT_FOUND);
  });

  it('should skip usageCount update when increment is zero', async () => {
    const sourceTag = makeTagRecord({ tagId: 'src-1', tagName: 'reactjs', usageCount: 1 });
    const targetTag = makeTagRecord({ tagId: 'tgt-1', tagName: 'react', usageCount: 5 });
    // The only matching item already has the target tag, so dedup = 1, increment = 1 - 1 = 0
    const matchingItems = [
      makeContentItem({ contentId: 'c1', tags: ['reactjs', 'react'] }),
    ];

    let callIndex = 0;
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          callIndex++;
          if (callIndex === 1) return Promise.resolve({ Item: sourceTag });
          return Promise.resolve({ Item: targetTag });
        }
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: matchingItems });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await mergeTags(
      { sourceTagId: 'src-1', targetTagId: 'tgt-1' },
      dynamo,
      tables,
    );

    expect(result.success).toBe(true);

    // Should NOT have an UpdateCommand for the target tag usageCount (increment is 0)
    const updateCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand' && c[0].input.TableName === contentTagsTable,
    );
    expect(updateCalls.length).toBe(0);
  });
});

// ─── deleteTag ─────────────────────────────────────────────

describe('deleteTag', () => {
  it('should delete tag and remove from all content items', async () => {
    const tag = makeTagRecord({ tagId: 'tag-1', tagName: 'react', usageCount: 3 });
    const matchingItems = [
      makeContentItem({ contentId: 'c1', tags: ['react', 'typescript'] }),
      makeContentItem({ contentId: 'c2', tags: ['react'] }),
    ];

    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: tag });
        }
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: matchingItems });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await deleteTag('tag-1', dynamo, tables);

    expect(result.success).toBe(true);

    // Verify content items were updated (tags removed)
    const updateCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCalls.length).toBe(2);

    // Verify the tag record was deleted
    const deleteCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][0].input.Key.tagId).toBe('tag-1');
  });

  it('should return TAG_NOT_FOUND when tag does not exist', async () => {
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: undefined });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await deleteTag('nonexistent', dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TAG_NOT_FOUND);
  });

  it('should handle tag with no matching content items', async () => {
    const tag = makeTagRecord({ tagId: 'tag-1', tagName: 'unused-tag', usageCount: 0 });

    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          return Promise.resolve({ Item: tag });
        }
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      }),
    } as any;

    const result = await deleteTag('tag-1', dynamo, tables);

    expect(result.success).toBe(true);

    // No UpdateCommand calls (no content items to update)
    const updateCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCalls.length).toBe(0);

    // Tag record should still be deleted
    const deleteCalls = dynamo.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCalls.length).toBe(1);
  });
});
