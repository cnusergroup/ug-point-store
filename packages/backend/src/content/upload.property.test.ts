import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createContentItem, type CreateContentItemInput } from './upload';

// Feature: content-hub, Property 3: 新建内容初始状态不变量
// 对于任何有效的内容上传输入，创建成功后的 ContentItem 的 status 应始终为 pending，
// 且 likeCount、commentCount、reservationCount 均为 0。
// **Validates: Requirements 1.7**

/** Mock DynamoDB client that always returns a valid category */
function createMockDynamoClient(categoryName: string) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      if (cmd.constructor.name === 'GetCommand') {
        return Promise.resolve({ Item: { categoryId: 'cat-1', name: categoryName } });
      }
      // PutCommand — just resolve
      return Promise.resolve({});
    }),
  } as any;
}

/** Arbitrary for valid CreateContentItemInput */
const validInputArb: fc.Arbitrary<CreateContentItemInput> = fc.record({
  userId: fc.uuid(),
  userNickname: fc.string({ minLength: 1, maxLength: 30 }),
  userRole: fc.constantFrom('UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.string({ minLength: 1, maxLength: 2000 }),
  categoryId: fc.uuid(),
  fileKey: fc.string({ minLength: 1, maxLength: 200 }),
  fileName: fc.string({ minLength: 1, maxLength: 100 }),
  fileSize: fc.integer({ min: 1, max: 50 * 1024 * 1024 }),
});

const tables = { contentItemsTable: 'ContentItems', categoriesTable: 'ContentCategories' };

describe('Property 3: 新建内容初始状态不变量', () => {
  it('创建成功后 status=pending, likeCount=0, commentCount=0, reservationCount=0', async () => {
    await fc.assert(
      fc.asyncProperty(validInputArb, async (input) => {
        const dynamo = createMockDynamoClient('TestCategory');
        const result = await createContentItem(input, dynamo, tables);

        expect(result.success).toBe(true);
        expect(result.item).toBeDefined();
        expect(result.item!.status).toBe('pending');
        expect(result.item!.likeCount).toBe(0);
        expect(result.item!.commentCount).toBe(0);
        expect(result.item!.reservationCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
