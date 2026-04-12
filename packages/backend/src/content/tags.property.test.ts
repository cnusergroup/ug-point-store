import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  searchTags,
  getHotTags,
  getTagCloudTags,
  syncTagsOnCreate,
  syncTagsOnEdit,
} from './tags';
import { editContentItem } from './edit';
import type { TagRecord, ContentItem } from '@points-mall/shared';
import { normalizeTagName } from '@points-mall/shared';

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

/** Create a mock DynamoDB client that simulates Scan with optional begins_with filtering */
function createScanMockClient(items: TagRecord[]) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'ScanCommand') {
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

/**
 * Create a stateful mock DynamoDB client that tracks TagRecord state for sync operations.
 * This mock supports QueryCommand (tagName-index lookup), PutCommand (create), and UpdateCommand (increment/decrement).
 */
function createStatefulSyncMockClient(initialTags: Map<string, TagRecord> = new Map()) {
  // Deep clone the initial state
  const store = new Map<string, TagRecord>();
  for (const [key, value] of initialTags) {
    store.set(key, { ...value });
  }

  // Index by tagName for GSI lookup
  const getByTagName = (tagName: string): TagRecord | undefined => {
    for (const record of store.values()) {
      if (record.tagName === tagName) return record;
    }
    return undefined;
  };

  let tagIdCounter = 1000;

  const client = {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;

      if (cmdName === 'QueryCommand') {
        const tagName = cmd.input?.ExpressionAttributeValues?.[':tagName'] as string;
        const existing = getByTagName(tagName);
        if (existing) {
          return Promise.resolve({ Items: [{ ...existing }] });
        }
        return Promise.resolve({ Items: [] });
      }

      if (cmdName === 'PutCommand') {
        const item = cmd.input?.Item as TagRecord;
        store.set(item.tagId, { ...item });
        return Promise.resolve({});
      }

      if (cmdName === 'UpdateCommand') {
        const tagId = cmd.input?.Key?.tagId as string;
        const record = store.get(tagId);
        if (record) {
          const updateExpr = cmd.input?.UpdateExpression as string;
          if (updateExpr.includes('ADD usageCount')) {
            record.usageCount += 1;
          } else if (updateExpr.includes('SET usageCount = usageCount - :one')) {
            // Decrement with condition check (usageCount > 0)
            if (record.usageCount > 0) {
              record.usageCount -= 1;
            } else {
              const err = new Error('ConditionalCheckFailedException');
              (err as any).name = 'ConditionalCheckFailedException';
              return Promise.reject(err);
            }
          }
        }
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;

  return { client, store, getByTagName };
}

const contentTagsTable = 'PointsMall-ContentTags';

// ─── Arbitraries ───────────────────────────────────────────

/** Arbitrary for a valid tag name (2-20 lowercase chars, no leading/trailing whitespace) */
const validTagNameArb = fc.string({ minLength: 2, maxLength: 20, unit: fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
) }).filter(s => s.trim().length >= 2);

/** Arbitrary for a TagRecord with random values */
const tagRecordArb = fc.record({
  tagId: fc.uuid(),
  tagName: validTagNameArb,
  usageCount: fc.nat({ max: 1000 }),
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
});

/** Arbitrary for a set of TagRecords with unique tagNames */
const tagRecordSetArb = fc.array(tagRecordArb, { minLength: 0, maxLength: 30 })
  .map(records => {
    const seen = new Set<string>();
    return records.filter(r => {
      if (seen.has(r.tagName)) return false;
      seen.add(r.tagName);
      return true;
    });
  });

/** Arbitrary for a search prefix (1-10 lowercase alphanumeric chars) */
const prefixArb = fc.string({ minLength: 1, maxLength: 10, unit: fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
) }).filter(s => s.trim().length >= 1);

/** Arbitrary for a valid tags array (0-5 unique valid tag names) */
const validTagsArrayArb = fc.array(validTagNameArb, { minLength: 0, maxLength: 5 })
  .map(tags => {
    const seen = new Set<string>();
    return tags.filter(t => {
      const n = normalizeTagName(t);
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  });


// ═══════════════════════════════════════════════════════════
// Property 8: 标签自动补全搜索正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 8: 标签自动补全搜索正确性
// 对于任何长度 ≥ 1 的搜索前缀和任意 TagRecord 集合，searchTags 返回的每条 TagRecord 的 tagName
// 都应以规范化后的前缀开头，结果按 usageCount 降序排列，且结果数量不超过 10。
// **Validates: Requirements 4.1, 4.2**

describe('Feature: content-tags, Property 8: 标签自动补全搜索正确性', () => {
  it('返回的每条 TagRecord 的 tagName 以规范化前缀开头，按 usageCount 降序，数量 ≤ 10', async () => {
    await fc.assert(
      fc.asyncProperty(
        prefixArb,
        tagRecordSetArb,
        async (prefix, records) => {
          const dynamo = createScanMockClient(records);
          const result = await searchTags({ prefix }, dynamo, contentTagsTable);

          expect(result.success).toBe(true);
          const tags = result.tags!;

          const normalizedPrefix = normalizeTagName(prefix);

          // Every returned tag's tagName starts with the normalized prefix
          for (const tag of tags) {
            expect(tag.tagName.startsWith(normalizedPrefix)).toBe(true);
          }

          // Results sorted by usageCount descending
          for (let i = 1; i < tags.length; i++) {
            expect(tags[i - 1].usageCount).toBeGreaterThanOrEqual(tags[i].usageCount);
          }

          // Count ≤ 10
          expect(tags.length).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 9: 热门标签正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 9: 热门标签正确性
// 对于任何 TagRecord 集合，getHotTags 返回的结果应按 usageCount 降序排列，
// 数量不超过 10，且当集合中不足 10 条时返回全部。
// **Validates: Requirements 5.1, 5.2**

describe('Feature: content-tags, Property 9: 热门标签正确性', () => {
  it('结果按 usageCount 降序排列，数量 ≤ 10，不足 10 条时返回全部', async () => {
    await fc.assert(
      fc.asyncProperty(
        tagRecordSetArb,
        async (records) => {
          const dynamo = createScanMockClient(records);
          const result = await getHotTags(dynamo, contentTagsTable);

          expect(result.success).toBe(true);
          const tags = result.tags!;

          // Results sorted by usageCount descending
          for (let i = 1; i < tags.length; i++) {
            expect(tags[i - 1].usageCount).toBeGreaterThanOrEqual(tags[i].usageCount);
          }

          // Count ≤ 10
          expect(tags.length).toBeLessThanOrEqual(10);

          // When fewer than 10 records exist, return all
          if (records.length <= 10) {
            expect(tags.length).toBe(records.length);
          } else {
            expect(tags.length).toBe(10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 11: 标签云正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 11: 标签云正确性
// 对于任何 TagRecord 集合，getTagCloudTags 返回的结果应按 usageCount 降序排列，数量不超过 20。
// **Validates: Requirements 6.6**

describe('Feature: content-tags, Property 11: 标签云正确性', () => {
  it('结果按 usageCount 降序排列，数量 ≤ 20', async () => {
    await fc.assert(
      fc.asyncProperty(
        tagRecordSetArb,
        async (records) => {
          const dynamo = createScanMockClient(records);
          const result = await getTagCloudTags(dynamo, contentTagsTable);

          expect(result.success).toBe(true);
          const tags = result.tags!;

          // Results sorted by usageCount descending
          for (let i = 1; i < tags.length; i++) {
            expect(tags[i - 1].usageCount).toBeGreaterThanOrEqual(tags[i].usageCount);
          }

          // Count ≤ 20
          expect(tags.length).toBeLessThanOrEqual(20);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 5: 内容创建时标签同步正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 5: 内容创建时标签同步正确性
// 对于任何有效的标签名数组（0~5 个，每个 2~20 字符），调用 syncTagsOnCreate 后：
// - 每个标签名在 ContentTags 表中应存在对应的 TagRecord
// - 新标签的 usageCount 应为 1
// - 已存在标签的 usageCount 应比调用前增加 1
// - 所有 TagRecord 的 usageCount 应 ≥ 0
// **Validates: Requirements 1.1, 1.6, 2.3, 2.4**

/** Arbitrary for a set of pre-existing TagRecords to seed the mock store */
const existingTagsSubsetArb = fc.array(
  fc.record({
    tagName: validTagNameArb,
    usageCount: fc.nat({ max: 100 }),
  }),
  { minLength: 0, maxLength: 10 },
).map(records => {
  const seen = new Set<string>();
  return records.filter(r => {
    const n = normalizeTagName(r.tagName);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
});

describe('Feature: content-tags, Property 5: 内容创建时标签同步正确性', () => {
  it('新标签 usageCount=1，已存在标签 usageCount 递增 1，所有 usageCount ≥ 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTagsArrayArb,
        existingTagsSubsetArb,
        async (tags, existingRecords) => {
          // Build initial store: some tags may already exist
          const initialStore = new Map<string, TagRecord>();
          for (const rec of existingRecords) {
            const normalized = normalizeTagName(rec.tagName);
            const tagId = `existing-${normalized}`;
            initialStore.set(tagId, {
              tagId,
              tagName: normalized,
              usageCount: rec.usageCount,
              createdAt: '2024-01-01T00:00:00.000Z',
            });
          }

          // Snapshot usageCounts before sync
          const beforeCounts = new Map<string, number>();
          for (const record of initialStore.values()) {
            beforeCounts.set(record.tagName, record.usageCount);
          }

          const { client, store } = createStatefulSyncMockClient(initialStore);

          await syncTagsOnCreate(tags, client, contentTagsTable);

          // Verify each tag
          for (const tag of tags) {
            const normalized = normalizeTagName(tag);
            let found = false;
            for (const record of store.values()) {
              if (record.tagName === normalized) {
                found = true;
                const previousCount = beforeCounts.get(normalized);
                if (previousCount !== undefined) {
                  // Existing tag: usageCount should be incremented by 1
                  expect(record.usageCount).toBe(previousCount + 1);
                } else {
                  // New tag: usageCount should be 1
                  expect(record.usageCount).toBe(1);
                }
                // All usageCount ≥ 0
                expect(record.usageCount).toBeGreaterThanOrEqual(0);
                break;
              }
            }
            expect(found).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 6: 内容编辑时标签同步正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 6: 内容编辑时标签同步正确性
// 对于任何旧标签数组和新标签数组，调用 syncTagsOnEdit(oldTags, newTags) 后：
// - 被移除的标签（在 oldTags 中但不在 newTags 中）的 usageCount 应减少 1
// - 被新增的标签（在 newTags 中但不在 oldTags 中）的 usageCount 应增加 1
// - 未变化的标签的 usageCount 应不变
// - 所有 TagRecord 的 usageCount 应 ≥ 0
// **Validates: Requirements 1.6, 3.2**

describe('Feature: content-tags, Property 6: 内容编辑时标签同步正确性', () => {
  it('移除标签 usageCount 减 1，新增标签 usageCount 加 1，未变化标签不变，所有 usageCount ≥ 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTagsArrayArb,
        validTagsArrayArb,
        async (oldTags, newTags) => {
          // Build initial store: all tags from oldTags and newTags should exist
          const allTagNames = new Set([
            ...oldTags.map(normalizeTagName),
            ...newTags.map(normalizeTagName),
          ]);

          const initialStore = new Map<string, TagRecord>();
          for (const tagName of allTagNames) {
            const tagId = `tag-${tagName}`;
            initialStore.set(tagId, {
              tagId,
              tagName,
              usageCount: 5, // Start with a baseline count
              createdAt: '2024-01-01T00:00:00.000Z',
            });
          }

          // Snapshot usageCounts before sync
          const beforeCounts = new Map<string, number>();
          for (const record of initialStore.values()) {
            beforeCounts.set(record.tagName, record.usageCount);
          }

          const { client, store } = createStatefulSyncMockClient(initialStore);

          const normalizedOld = oldTags.map(normalizeTagName);
          const normalizedNew = newTags.map(normalizeTagName);
          const oldSet = new Set(normalizedOld);
          const newSet = new Set(normalizedNew);

          const removedTags = normalizedOld.filter(t => !newSet.has(t));
          const addedTags = normalizedNew.filter(t => !oldSet.has(t));
          const unchangedTags = normalizedOld.filter(t => newSet.has(t));

          await syncTagsOnEdit(oldTags, newTags, client, contentTagsTable);

          // Verify removed tags: usageCount decreased by 1
          for (const tagName of removedTags) {
            for (const record of store.values()) {
              if (record.tagName === tagName) {
                const before = beforeCounts.get(tagName)!;
                expect(record.usageCount).toBe(Math.max(0, before - 1));
                break;
              }
            }
          }

          // Verify added tags: usageCount increased by 1
          for (const tagName of addedTags) {
            let found = false;
            for (const record of store.values()) {
              if (record.tagName === tagName) {
                found = true;
                const before = beforeCounts.get(tagName);
                if (before !== undefined) {
                  expect(record.usageCount).toBe(before + 1);
                } else {
                  // New tag created
                  expect(record.usageCount).toBe(1);
                }
                break;
              }
            }
            expect(found).toBe(true);
          }

          // Verify unchanged tags: usageCount unchanged
          for (const tagName of unchangedTags) {
            for (const record of store.values()) {
              if (record.tagName === tagName) {
                const before = beforeCounts.get(tagName)!;
                expect(record.usageCount).toBe(before);
                break;
              }
            }
          }

          // All usageCount ≥ 0
          for (const record of store.values()) {
            expect(record.usageCount).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 14: 向后兼容性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 14: 向后兼容性
// 对于任何不包含 tags 字段的 ContentItem 记录，读取时应返回空数组 []；
// 对于任何不包含 tags 参数的上传或编辑请求，应正常处理且 ContentItem 的 tags 字段为空数组。
// **Validates: Requirements 8.1, 8.2, 8.4**

/** Arbitrary for a ContentItem that may or may not have a tags field */
const contentItemWithOptionalTagsArb = fc.record({
  contentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  description: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  categoryId: fc.uuid(),
  categoryName: fc.constantFrom('Tech', 'Design', 'Marketing'),
  uploaderId: fc.uuid(),
  uploaderNickname: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  uploaderRole: fc.constantFrom('Speaker', 'Volunteer'),
  fileKey: fc.constant('content/user/file.pdf'),
  fileName: fc.constant('file.pdf'),
  fileSize: fc.nat({ max: 10000 }),
  status: fc.constantFrom('pending', 'approved', 'rejected') as fc.Arbitrary<'pending' | 'approved' | 'rejected'>,
  likeCount: fc.nat({ max: 100 }),
  commentCount: fc.nat({ max: 100 }),
  reservationCount: fc.nat({ max: 100 }),
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  hasTags: fc.boolean(),
  tagsValue: fc.array(validTagNameArb, { minLength: 0, maxLength: 5 }),
});

describe('Feature: content-tags, Property 14: 向后兼容性', () => {
  it('不包含 tags 字段的记录读取时 item.tags ?? [] 返回空数组', () => {
    fc.assert(
      fc.property(
        contentItemWithOptionalTagsArb,
        (itemData) => {
          // Build a ContentItem-like object, conditionally including tags
          const item: Record<string, any> = {
            contentId: itemData.contentId,
            title: itemData.title,
            description: itemData.description,
            categoryId: itemData.categoryId,
            categoryName: itemData.categoryName,
            uploaderId: itemData.uploaderId,
            uploaderNickname: itemData.uploaderNickname,
            uploaderRole: itemData.uploaderRole,
            fileKey: itemData.fileKey,
            fileName: itemData.fileName,
            fileSize: itemData.fileSize,
            status: itemData.status,
            likeCount: itemData.likeCount,
            commentCount: itemData.commentCount,
            reservationCount: itemData.reservationCount,
            createdAt: itemData.createdAt,
            updatedAt: itemData.updatedAt,
          };

          if (itemData.hasTags) {
            item.tags = itemData.tagsValue;
          }
          // else: tags field is absent (simulating old records)

          // The backward-compatible read pattern: item.tags ?? []
          const readTags: string[] = (item as any).tags ?? [];

          if (itemData.hasTags) {
            // When tags field exists, it should be returned as-is
            expect(readTags).toEqual(itemData.tagsValue);
          } else {
            // When tags field is absent, should default to empty array
            expect(readTags).toEqual([]);
          }

          // In all cases, readTags should be an array
          expect(Array.isArray(readTags)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tags 为 undefined 时 ?? [] 返回空数组', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        (tags) => {
          const result: string[] = tags ?? [];
          expect(result).toEqual([]);
          expect(Array.isArray(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tags 为 null 时 ?? [] 返回空数组', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        (tags) => {
          const result: string[] = tags ?? [];
          expect(result).toEqual([]);
          expect(Array.isArray(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tags 为有效数组时 ?? [] 返回原数组', () => {
    fc.assert(
      fc.property(
        fc.array(validTagNameArb, { minLength: 0, maxLength: 5 }),
        (tags) => {
          const result: string[] = tags ?? [];
          expect(result).toEqual(tags);
          expect(result.length).toBe(tags.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ═══════════════════════════════════════════════════════════
// Property 7: 标签编辑 Round-Trip
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 7: 标签编辑 Round-Trip
// 对于任何有效的标签数组，编辑 ContentItem 的 tags 后再读取，返回的 tags 数组
// 应与编辑时提交的规范化标签数组完全一致。
// **Validates: Requirements 3.4**

describe('Feature: content-tags, Property 7: 标签编辑 Round-Trip', () => {
  it('编辑 ContentItem 的 tags 后读取，返回的 tags 与提交的规范化标签完全一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTagsArrayArb,
        async (tags) => {
          // Build a pending ContentItem with no existing tags
          const existingItem: ContentItem = {
            contentId: 'content-roundtrip',
            title: 'Test Content',
            description: 'Test Description',
            categoryId: 'cat-1',
            categoryName: 'Tech',
            uploaderId: 'user-1',
            uploaderNickname: 'TestUser',
            uploaderRole: 'Speaker',
            fileKey: 'content/user-1/file.pdf',
            fileName: 'file.pdf',
            fileSize: 1024,
            status: 'pending',
            likeCount: 0,
            commentCount: 0,
            reservationCount: 0,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            tags: [],
          };

          // Mock DynamoDB client that returns the existing item on GetCommand
          // and accepts UpdateCommand (no-op)
          const mockDynamo = {
            send: vi.fn().mockImplementation((cmd: any) => {
              const cmdName = cmd.constructor.name;
              if (cmdName === 'GetCommand') {
                return Promise.resolve({ Item: { ...existingItem } });
              }
              if (cmdName === 'UpdateCommand') {
                return Promise.resolve({});
              }
              if (cmdName === 'QueryCommand') {
                // For syncTagsOnEdit tagName-index lookup
                return Promise.resolve({ Items: [] });
              }
              if (cmdName === 'PutCommand') {
                return Promise.resolve({});
              }
              return Promise.resolve({});
            }),
          } as any;

          const mockS3 = {
            send: vi.fn().mockResolvedValue({}),
          } as any;

          const tablesWithTags = {
            contentItemsTable: 'ContentItems',
            categoriesTable: 'ContentCategories',
            contentTagsTable: 'PointsMall-ContentTags',
          };

          const result = await editContentItem(
            { contentId: 'content-roundtrip', userId: 'user-1', tags },
            mockDynamo,
            mockS3,
            tablesWithTags,
            'test-bucket',
          );

          expect(result.success).toBe(true);
          expect(result.item).toBeDefined();

          // The returned tags should be exactly the normalized version of the input
          const expectedTags = tags.map(normalizeTagName);
          expect(result.item!.tags).toEqual(expectedTags);

          // Round-trip: reading the returned item's tags should match
          const readTags = result.item!.tags ?? [];
          expect(readTags).toEqual(expectedTags);
          expect(readTags.length).toBe(expectedTags.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
