import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { listAllTags, mergeTags, deleteTag } from './admin-tags';
import type { TagRecord, ContentItem, UserRole } from '@points-mall/shared';
import { isSuperAdmin, normalizeTagName } from '@points-mall/shared';

// ─── Helpers ───────────────────────────────────────────────

const contentTagsTable = 'PointsMall-ContentTags';
const contentItemsTable = 'PointsMall-ContentItems';
const tables = { contentTagsTable, contentItemsTable };

// ─── Stateful Mock DynamoDB Client ─────────────────────────
// Tracks both TagRecords and ContentItems state, supporting
// GetCommand, ScanCommand, UpdateCommand, and DeleteCommand.

interface MockStore {
  tags: Map<string, TagRecord>;
  items: Map<string, ContentItem>;
}

function createStatefulMockClient(initialTags: TagRecord[], initialItems: ContentItem[]) {
  const store: MockStore = {
    tags: new Map(),
    items: new Map(),
  };

  for (const tag of initialTags) {
    store.tags.set(tag.tagId, { ...tag });
  }
  for (const item of initialItems) {
    store.items.set(item.contentId, { ...item, tags: [...(item.tags ?? [])] });
  }

  const client = {
    send: vi.fn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      const tableName = cmd.input?.TableName as string;

      // ── GetCommand ──
      if (cmdName === 'GetCommand') {
        if (tableName === contentTagsTable) {
          const tagId = cmd.input.Key.tagId as string;
          const tag = store.tags.get(tagId);
          return Promise.resolve({ Item: tag ? { ...tag } : undefined });
        }
        if (tableName === contentItemsTable) {
          const contentId = cmd.input.Key.contentId as string;
          const item = store.items.get(contentId);
          return Promise.resolve({ Item: item ? { ...item, tags: [...(item.tags ?? [])] } : undefined });
        }
        return Promise.resolve({ Item: undefined });
      }

      // ── ScanCommand ──
      if (cmdName === 'ScanCommand') {
        if (tableName === contentTagsTable) {
          const allTags = Array.from(store.tags.values()).map(t => ({ ...t }));
          return Promise.resolve({ Items: allTags });
        }
        if (tableName === contentItemsTable) {
          const filterExpr = cmd.input?.FilterExpression as string | undefined;
          let items = Array.from(store.items.values()).map(i => ({
            ...i,
            tags: [...(i.tags ?? [])],
          }));

          if (filterExpr && filterExpr.includes('contains(tags, :sourceTagName)')) {
            const tagName = cmd.input.ExpressionAttributeValues[':sourceTagName'] as string;
            items = items.filter(i => (i.tags ?? []).includes(tagName));
          } else if (filterExpr && filterExpr.includes('contains(tags, :tagName)')) {
            const tagName = cmd.input.ExpressionAttributeValues[':tagName'] as string;
            items = items.filter(i => (i.tags ?? []).includes(tagName));
          }

          return Promise.resolve({ Items: items });
        }
        return Promise.resolve({ Items: [] });
      }

      // ── UpdateCommand ──
      if (cmdName === 'UpdateCommand') {
        if (tableName === contentTagsTable) {
          const tagId = cmd.input.Key.tagId as string;
          const tag = store.tags.get(tagId);
          if (tag) {
            const updateExpr = cmd.input.UpdateExpression as string;
            if (updateExpr.includes('ADD usageCount')) {
              const inc = cmd.input.ExpressionAttributeValues[':inc'] as number;
              tag.usageCount += inc;
            }
          }
          return Promise.resolve({});
        }
        if (tableName === contentItemsTable) {
          const contentId = cmd.input.Key.contentId as string;
          const item = store.items.get(contentId);
          if (item) {
            const newTags = cmd.input.ExpressionAttributeValues[':tags'] as string[];
            item.tags = [...newTags];
          }
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }

      // ── DeleteCommand ──
      if (cmdName === 'DeleteCommand') {
        if (tableName === contentTagsTable) {
          const tagId = cmd.input.Key.tagId as string;
          store.tags.delete(tagId);
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;

  return { client, store };
}

// ─── Arbitraries ───────────────────────────────────────────

/** Arbitrary for a valid tag name (2-20 lowercase chars) */
const validTagNameArb = fc.string({
  minLength: 2,
  maxLength: 20,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
}).filter(s => s.trim().length >= 2);

/** Arbitrary for a TagRecord with random values */
const tagRecordArb = fc.record({
  tagId: fc.uuid(),
  tagName: validTagNameArb,
  usageCount: fc.nat({ max: 1000 }),
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
});

/** Arbitrary for a set of TagRecords with unique tagNames and unique tagIds */
const tagRecordSetArb = fc.array(tagRecordArb, { minLength: 0, maxLength: 30 })
  .map(records => {
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    return records.filter(r => {
      if (seenNames.has(r.tagName) || seenIds.has(r.tagId)) return false;
      seenNames.add(r.tagName);
      seenIds.add(r.tagId);
      return true;
    });
  });

/** Arbitrary for a ContentItem with random tags */
function contentItemArb(possibleTags: string[]) {
  return fc.record({
    contentId: fc.uuid(),
    title: fc.constant('Test Content'),
    description: fc.constant('Test Description'),
    categoryId: fc.uuid(),
    categoryName: fc.constant('Tech'),
    uploaderId: fc.uuid(),
    uploaderNickname: fc.constant('User'),
    uploaderRole: fc.constant('Speaker'),
    fileKey: fc.constant('content/file.pdf'),
    fileName: fc.constant('file.pdf'),
    fileSize: fc.constant(1024),
    status: fc.constant('approved' as const),
    likeCount: fc.constant(0),
    commentCount: fc.constant(0),
    reservationCount: fc.constant(0),
    createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
    tags: fc.subarray(possibleTags, { minLength: 0, maxLength: Math.min(5, possibleTags.length) }),
  });
}

/** Arbitrary for a UserRole */
const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom(
  'UserGroupLeader' as UserRole,
  'Speaker' as UserRole,
  'Volunteer' as UserRole,
  'Admin' as UserRole,
  'SuperAdmin' as UserRole,
);

/** Arbitrary for a set of user roles (1-5 roles, unique) */
const roleSetArb = fc.uniqueArray(userRoleArb, { minLength: 1, maxLength: 5 });

// ═══════════════════════════════════════════════════════════
// Property 12: 标签合并正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 12: 标签合并正确性
// 对于任何源标签和目标标签的合并操作，完成后：
// - 所有原本包含源标签名的 ContentItem 的 tags 数组中，源标签名应被替换为目标标签名
// - 如果某 ContentItem 原本同时包含源标签和目标标签，合并后 tags 数组中目标标签应仅出现一次（去重）
// - 目标 TagRecord 的 usageCount 应等于合并前 source.usageCount + target.usageCount 减去去重数量
// - 源 TagRecord 应被删除
// **Validates: Requirements 7.3, 7.4, 7.9**

describe('Feature: content-tags, Property 12: 标签合并正确性', () => {
  it('合并后源标签被替换为目标标签，去重正确，usageCount 正确，源 TagRecord 被删除', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate two distinct tag names for source and target
        validTagNameArb,
        validTagNameArb,
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        // Generate 0-10 content items
        fc.nat({ max: 10 }),
        fc.infiniteStream(fc.boolean()),
        fc.infiniteStream(fc.boolean()),
        fc.infiniteStream(fc.array(validTagNameArb, { minLength: 0, maxLength: 3 })),
        async (sourceTagName, targetTagName, sourceUsage, targetUsage, itemCount, hasSourceStream, hasTargetStream, otherTagsStream) => {
          // Ensure source and target are different
          fc.pre(sourceTagName !== targetTagName);

          const sourceTagId = 'source-tag-id';
          const targetTagId = 'target-tag-id';

          const sourceTag: TagRecord = {
            tagId: sourceTagId,
            tagName: sourceTagName,
            usageCount: sourceUsage,
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          const targetTag: TagRecord = {
            tagId: targetTagId,
            tagName: targetTagName,
            usageCount: targetUsage,
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          // Build content items with random combinations of source/target tags
          const items: ContentItem[] = [];
          const hasSourceIter = hasSourceStream[Symbol.iterator]();
          const hasTargetIter = hasTargetStream[Symbol.iterator]();
          const otherTagsIter = otherTagsStream[Symbol.iterator]();

          for (let i = 0; i < itemCount; i++) {
            const hasSource = hasSourceIter.next().value;
            const hasTarget = hasTargetIter.next().value;
            const otherTags = (otherTagsIter.next().value as string[])
              .filter(t => t !== sourceTagName && t !== targetTagName);

            const itemTags: string[] = [...otherTags];
            if (hasSource) itemTags.push(sourceTagName);
            if (hasTarget) itemTags.push(targetTagName);

            // Deduplicate and limit to 5
            const uniqueTags = [...new Set(itemTags)].slice(0, 5);

            items.push({
              contentId: `content-${i}`,
              title: `Content ${i}`,
              description: 'Desc',
              categoryId: 'cat-1',
              categoryName: 'Tech',
              uploaderId: 'user-1',
              uploaderNickname: 'User',
              uploaderRole: 'Speaker',
              fileKey: 'file.pdf',
              fileName: 'file.pdf',
              fileSize: 1024,
              status: 'approved',
              likeCount: 0,
              commentCount: 0,
              reservationCount: 0,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              tags: uniqueTags,
            });
          }

          // Snapshot state before merge
          const itemsBefore = items.map(i => ({
            contentId: i.contentId,
            tags: [...(i.tags ?? [])],
          }));

          const { client, store } = createStatefulMockClient([sourceTag, targetTag], items);

          // Count items that had both source and target (dedup cases)
          const dedupCount = itemsBefore.filter(
            i => i.tags.includes(sourceTagName) && i.tags.includes(targetTagName),
          ).length;

          const result = await mergeTags(
            { sourceTagId, targetTagId },
            client,
            tables,
          );

          expect(result.success).toBe(true);

          // Verify: source tag name no longer appears in any content item
          for (const [, item] of store.items) {
            expect((item.tags ?? []).includes(sourceTagName)).toBe(false);
          }

          // Verify: items that originally had source tag now have target tag
          for (const before of itemsBefore) {
            if (before.tags.includes(sourceTagName)) {
              const after = store.items.get(before.contentId)!;
              expect((after.tags ?? []).includes(targetTagName)).toBe(true);
            }
          }

          // Verify: target tag appears at most once in each item (dedup)
          for (const [, item] of store.items) {
            const targetCount = (item.tags ?? []).filter(t => t === targetTagName).length;
            expect(targetCount).toBeLessThanOrEqual(1);
          }

          // Verify: target usageCount = original source + target - dedupCount
          const expectedUsageCount = sourceUsage + targetUsage - dedupCount;
          // If usageIncrement was 0, the update is skipped, so target keeps original count
          const usageIncrement = sourceUsage - dedupCount;
          const expectedTargetUsage = usageIncrement !== 0
            ? targetUsage + usageIncrement
            : targetUsage;
          const targetAfter = store.tags.get(targetTagId);
          expect(targetAfter).toBeDefined();
          expect(targetAfter!.usageCount).toBe(expectedTargetUsage);

          // Verify: source TagRecord is deleted
          expect(store.tags.has(sourceTagId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 13: 标签删除正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 13: 标签删除正确性
// 对于任何被删除的标签，完成后：
// - 所有原本包含该标签名的 ContentItem 的 tags 数组中不再包含该标签名
// - 受影响的 ContentItem 的 tags 数组长度应相应减少
// - 该 TagRecord 应被删除
// **Validates: Requirements 7.5, 7.6**

describe('Feature: content-tags, Property 13: 标签删除正确性', () => {
  it('删除后标签从所有 ContentItem 中移除，tags 长度减少，TagRecord 被删除', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTagNameArb,
        fc.nat({ max: 100 }),
        fc.nat({ max: 10 }),
        fc.infiniteStream(fc.boolean()),
        fc.infiniteStream(fc.array(validTagNameArb, { minLength: 0, maxLength: 4 })),
        async (tagName, usageCount, itemCount, hasTagStream, otherTagsStream) => {
          const tagId = 'delete-tag-id';
          const tag: TagRecord = {
            tagId,
            tagName,
            usageCount,
            createdAt: '2024-01-01T00:00:00.000Z',
          };

          // Build content items, some containing the tag
          const items: ContentItem[] = [];
          const hasTagIter = hasTagStream[Symbol.iterator]();
          const otherTagsIter = otherTagsStream[Symbol.iterator]();

          for (let i = 0; i < itemCount; i++) {
            const hasTag = hasTagIter.next().value;
            const otherTags = (otherTagsIter.next().value as string[])
              .filter(t => t !== tagName);

            const itemTags: string[] = [...otherTags];
            if (hasTag) itemTags.push(tagName);

            const uniqueTags = [...new Set(itemTags)].slice(0, 5);

            items.push({
              contentId: `content-${i}`,
              title: `Content ${i}`,
              description: 'Desc',
              categoryId: 'cat-1',
              categoryName: 'Tech',
              uploaderId: 'user-1',
              uploaderNickname: 'User',
              uploaderRole: 'Speaker',
              fileKey: 'file.pdf',
              fileName: 'file.pdf',
              fileSize: 1024,
              status: 'approved',
              likeCount: 0,
              commentCount: 0,
              reservationCount: 0,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              tags: uniqueTags,
            });
          }

          // Snapshot state before delete
          const itemsBefore = items.map(i => ({
            contentId: i.contentId,
            tags: [...(i.tags ?? [])],
          }));

          const { client, store } = createStatefulMockClient([tag], items);

          const result = await deleteTag(tagId, client, tables);

          expect(result.success).toBe(true);

          // Verify: tag name no longer appears in any content item
          for (const [, item] of store.items) {
            expect((item.tags ?? []).includes(tagName)).toBe(false);
          }

          // Verify: affected items' tags array length decreased
          for (const before of itemsBefore) {
            const after = store.items.get(before.contentId)!;
            if (before.tags.includes(tagName)) {
              expect((after.tags ?? []).length).toBe(before.tags.length - 1);
            } else {
              // Unaffected items should remain unchanged
              expect((after.tags ?? []).length).toBe(before.tags.length);
            }
          }

          // Verify: TagRecord is deleted
          expect(store.tags.has(tagId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 15: 管理端标签列表排序正确性
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 15: 管理端标签列表排序正确性
// 对于任何 TagRecord 集合，listAllTags 返回的结果应按 tagName 升序排列，且包含所有 TagRecord。
// **Validates: Requirements 7.2**

describe('Feature: content-tags, Property 15: 管理端标签列表排序正确性', () => {
  it('listAllTags 返回结果按 tagName 升序排列，且包含所有 TagRecord', async () => {
    await fc.assert(
      fc.asyncProperty(
        tagRecordSetArb,
        async (records) => {
          // Create a simple scan mock that returns all records
          const mockClient = {
            send: vi.fn().mockResolvedValue({ Items: records.map(r => ({ ...r })) }),
          } as any;

          const result = await listAllTags(mockClient, contentTagsTable);

          expect(result.success).toBe(true);
          const tags = result.tags!;

          // Verify: contains all TagRecords
          expect(tags.length).toBe(records.length);

          // Verify: sorted by tagName ascending
          for (let i = 1; i < tags.length; i++) {
            const cmp = tags[i - 1].tagName <= tags[i].tagName;
            expect(cmp).toBe(true);
          }

          // Verify: all original tag names are present
          const originalNames = new Set(records.map(r => r.tagName));
          const resultNames = new Set(tags.map(t => t.tagName));
          expect(resultNames).toEqual(originalNames);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Property 16: 标签管理权限校验
// ═══════════════════════════════════════════════════════════

// Feature: content-tags, Property 16: 标签管理权限校验
// 对于任何用户角色集合，如果该集合不包含 SuperAdmin，则标签管理操作（合并、删除）应被拒绝；
// 如果包含 SuperAdmin，则权限校验应通过。
// **Validates: Requirements 7.1**

describe('Feature: content-tags, Property 16: 标签管理权限校验', () => {
  it('不包含 SuperAdmin 的角色集合被拒绝，包含 SuperAdmin 的角色集合通过', () => {
    fc.assert(
      fc.property(
        roleSetArb,
        (roles) => {
          const hasSuperAdmin = roles.includes('SuperAdmin');
          const checkResult = isSuperAdmin(roles);

          if (hasSuperAdmin) {
            // Sets with SuperAdmin should pass permission check
            expect(checkResult).toBe(true);
          } else {
            // Sets without SuperAdmin should be rejected
            expect(checkResult).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
