import { describe, it, expect, vi } from 'vitest';
import {
  searchTags,
  getHotTags,
  getTagCloudTags,
  syncTagsOnCreate,
  syncTagsOnEdit,
} from './tags';
import type { TagRecord } from '@points-mall/shared';

// ─── Helpers ───────────────────────────────────────────────

function makeTag(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    tagId: 'tag-1',
    tagName: 'react',
    usageCount: 10,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createScanMockClient(items: TagRecord[]) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'ScanCommand') {
        // If FilterExpression contains begins_with, filter items by prefix
        const filterExpr = cmd.input?.FilterExpression as string | undefined;
        if (filterExpr && filterExpr.includes('begins_with')) {
          const prefix = cmd.input?.ExpressionAttributeValues?.[':prefix'] as string;
          const filtered = items.filter(t => t.tagName.startsWith(prefix));
          return Promise.resolve({ Items: filtered });
        }
        return Promise.resolve({ Items: items });
      }
      return Promise.resolve({});
    }),
  } as any;
}

function createSyncMockClient(existingTags: Map<string, TagRecord> = new Map()) {
  const calls: { cmdName: string; input: any }[] = [];
  return {
    calls,
    client: {
      send: vi.fn().mockImplementation((cmd: any) => {
        const cmdName = cmd.constructor.name;
        calls.push({ cmdName, input: cmd.input });

        if (cmdName === 'QueryCommand') {
          const tagName = cmd.input?.ExpressionAttributeValues?.[':tagName'] as string;
          const existing = existingTags.get(tagName);
          if (existing) {
            return Promise.resolve({ Items: [existing] });
          }
          return Promise.resolve({ Items: [] });
        }
        if (cmdName === 'PutCommand') {
          return Promise.resolve({});
        }
        if (cmdName === 'UpdateCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }),
    } as any,
  };
}

const contentTagsTable = 'PointsMall-ContentTags';

// ─── searchTags ────────────────────────────────────────────

describe('searchTags', () => {
  it('should return empty array when prefix is empty string', async () => {
    const dynamo = createScanMockClient([makeTag()]);
    const result = await searchTags({ prefix: '' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toEqual([]);
    // Should not call DynamoDB at all
    expect(dynamo.send).not.toHaveBeenCalled();
  });

  it('should return empty array when prefix is only whitespace', async () => {
    const dynamo = createScanMockClient([makeTag()]);
    const result = await searchTags({ prefix: '   ' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it('should return tags matching the prefix', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 20 }),
      makeTag({ tagId: 'tag-2', tagName: 'redux', usageCount: 10 }),
      makeTag({ tagId: 'tag-3', tagName: 'vue', usageCount: 15 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await searchTags({ prefix: 're' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(2);
    expect(result.tags!.every(t => t.tagName.startsWith('re'))).toBe(true);
  });

  it('should sort results by usageCount descending', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 }),
      makeTag({ tagId: 'tag-2', tagName: 'redux', usageCount: 20 }),
      makeTag({ tagId: 'tag-3', tagName: 'relay', usageCount: 10 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await searchTags({ prefix: 're' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags![0].tagName).toBe('redux');
    expect(result.tags![1].tagName).toBe('relay');
    expect(result.tags![2].tagName).toBe('react');
  });

  it('should respect the limit parameter', async () => {
    const tags = Array.from({ length: 15 }, (_, i) =>
      makeTag({ tagId: `tag-${i}`, tagName: `react${i}`, usageCount: 100 - i }),
    );
    const dynamo = createScanMockClient(tags);
    const result = await searchTags({ prefix: 'react', limit: 5 }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(5);
  });

  it('should default limit to 10', async () => {
    const tags = Array.from({ length: 15 }, (_, i) =>
      makeTag({ tagId: `tag-${i}`, tagName: `react${i}`, usageCount: 100 - i }),
    );
    const dynamo = createScanMockClient(tags);
    const result = await searchTags({ prefix: 'react' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(10);
  });

  it('should normalize prefix to lowercase before matching', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 10 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await searchTags({ prefix: 'Re' }, dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    // The scan mock filters by normalized prefix 're', so 'react' should match
    expect(result.tags!.length).toBe(1);
    expect(result.tags![0].tagName).toBe('react');
  });
});

// ─── getHotTags ────────────────────────────────────────────

describe('getHotTags', () => {
  it('should return tags sorted by usageCount descending', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 }),
      makeTag({ tagId: 'tag-2', tagName: 'vue', usageCount: 20 }),
      makeTag({ tagId: 'tag-3', tagName: 'angular', usageCount: 10 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await getHotTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags![0].tagName).toBe('vue');
    expect(result.tags![1].tagName).toBe('angular');
    expect(result.tags![2].tagName).toBe('react');
  });

  it('should return at most 10 tags', async () => {
    const tags = Array.from({ length: 15 }, (_, i) =>
      makeTag({ tagId: `tag-${i}`, tagName: `tag${i}`, usageCount: 100 - i }),
    );
    const dynamo = createScanMockClient(tags);
    const result = await getHotTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(10);
  });

  it('should return all tags when fewer than 10 exist', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 10 }),
      makeTag({ tagId: 'tag-2', tagName: 'vue', usageCount: 5 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await getHotTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(2);
  });

  it('should return empty array when no tags exist', async () => {
    const dynamo = createScanMockClient([]);
    const result = await getHotTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags).toEqual([]);
  });
});

// ─── getTagCloudTags ───────────────────────────────────────

describe('getTagCloudTags', () => {
  it('should return tags sorted by usageCount descending', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 }),
      makeTag({ tagId: 'tag-2', tagName: 'vue', usageCount: 20 }),
      makeTag({ tagId: 'tag-3', tagName: 'angular', usageCount: 10 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await getTagCloudTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags![0].tagName).toBe('vue');
    expect(result.tags![1].tagName).toBe('angular');
    expect(result.tags![2].tagName).toBe('react');
  });

  it('should return at most 20 tags', async () => {
    const tags = Array.from({ length: 25 }, (_, i) =>
      makeTag({ tagId: `tag-${i}`, tagName: `tag${i}`, usageCount: 100 - i }),
    );
    const dynamo = createScanMockClient(tags);
    const result = await getTagCloudTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(20);
  });

  it('should return all tags when fewer than 20 exist', async () => {
    const tags = [
      makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 10 }),
    ];
    const dynamo = createScanMockClient(tags);
    const result = await getTagCloudTags(dynamo, contentTagsTable);

    expect(result.success).toBe(true);
    expect(result.tags!.length).toBe(1);
  });
});

// ─── syncTagsOnCreate ──────────────────────────────────────

describe('syncTagsOnCreate', () => {
  it('should create new TagRecord with usageCount=1 for new tag', async () => {
    const { client, calls } = createSyncMockClient(new Map());
    await syncTagsOnCreate(['React'], client, contentTagsTable);

    // Should query for the tag first
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(1);
    expect(queryCalls[0].input.ExpressionAttributeValues[':tagName']).toBe('react');

    // Should create a new tag via PutCommand
    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0].input.Item.tagName).toBe('react');
    expect(putCalls[0].input.Item.usageCount).toBe(1);
  });

  it('should increment usageCount for existing tag', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);
    await syncTagsOnCreate(['react'], client, contentTagsTable);

    // Should query for the tag
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(1);

    // Should NOT create a new tag
    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls.length).toBe(0);

    // Should update existing tag via UpdateCommand
    const updateCalls = calls.filter(c => c.cmdName === 'UpdateCommand');
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.Key.tagId).toBe('tag-1');
    expect(updateCalls[0].input.UpdateExpression).toBe('ADD usageCount :one');
  });

  it('should handle multiple tags (mix of new and existing)', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);
    await syncTagsOnCreate(['react', 'Vue'], client, contentTagsTable);

    // Two queries (one per tag)
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(2);

    // One PutCommand for 'vue' (new)
    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0].input.Item.tagName).toBe('vue');

    // One UpdateCommand for 'react' (existing)
    const updateCalls = calls.filter(c => c.cmdName === 'UpdateCommand');
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.Key.tagId).toBe('tag-1');
  });

  it('should normalize tag names before processing', async () => {
    const { client, calls } = createSyncMockClient(new Map());
    await syncTagsOnCreate(['  React  '], client, contentTagsTable);

    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls[0].input.ExpressionAttributeValues[':tagName']).toBe('react');

    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls[0].input.Item.tagName).toBe('react');
  });

  it('should handle empty tags array without errors', async () => {
    const { client, calls } = createSyncMockClient(new Map());
    await syncTagsOnCreate([], client, contentTagsTable);

    expect(calls.length).toBe(0);
  });
});

// ─── syncTagsOnEdit ────────────────────────────────────────

describe('syncTagsOnEdit', () => {
  it('should decrement usageCount for removed tags and increment for added tags', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
      ['vue', makeTag({ tagId: 'tag-2', tagName: 'vue', usageCount: 3 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);

    // Old: ['react', 'vue'], New: ['react', 'angular']
    // Removed: 'vue', Added: 'angular'
    await syncTagsOnEdit(['react', 'vue'], ['react', 'angular'], client, contentTagsTable);

    // Query for 'vue' (removed) + Query for 'angular' (added, via syncTagsOnCreate)
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(2);

    // UpdateCommand for 'vue' (decrement) + PutCommand for 'angular' (new tag)
    const updateCalls = calls.filter(c => c.cmdName === 'UpdateCommand');
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.Key.tagId).toBe('tag-2'); // vue's tagId
    expect(updateCalls[0].input.UpdateExpression).toContain('usageCount');

    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0].input.Item.tagName).toBe('angular');
  });

  it('should not change anything when old and new tags are the same', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);

    await syncTagsOnEdit(['react'], ['react'], client, contentTagsTable);

    // No removed or added tags, so no queries should be made
    expect(calls.length).toBe(0);
  });

  it('should handle going from tags to empty tags', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
      ['vue', makeTag({ tagId: 'tag-2', tagName: 'vue', usageCount: 3 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);

    await syncTagsOnEdit(['react', 'vue'], [], client, contentTagsTable);

    // Should query for both removed tags
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(2);

    // Should update (decrement) both tags
    const updateCalls = calls.filter(c => c.cmdName === 'UpdateCommand');
    expect(updateCalls.length).toBe(2);
  });

  it('should handle going from empty tags to new tags', async () => {
    const { client, calls } = createSyncMockClient(new Map());

    await syncTagsOnEdit([], ['react', 'vue'], client, contentTagsTable);

    // Should query for both added tags (via syncTagsOnCreate)
    const queryCalls = calls.filter(c => c.cmdName === 'QueryCommand');
    expect(queryCalls.length).toBe(2);

    // Should create both new tags
    const putCalls = calls.filter(c => c.cmdName === 'PutCommand');
    expect(putCalls.length).toBe(2);
  });

  it('should normalize tag names for comparison', async () => {
    const existingTags = new Map<string, TagRecord>([
      ['react', makeTag({ tagId: 'tag-1', tagName: 'react', usageCount: 5 })],
    ]);
    const { client, calls } = createSyncMockClient(existingTags);

    // 'React' normalizes to 'react', so no change
    await syncTagsOnEdit(['React'], ['react'], client, contentTagsTable);

    expect(calls.length).toBe(0);
  });
});
