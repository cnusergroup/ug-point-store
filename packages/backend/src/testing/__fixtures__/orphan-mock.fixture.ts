/**
 * Fixture: Bug Condition A, orphaned property colliding with the mock lifecycle.
 *
 * Test A hands a slow `fc.asyncProperty` to `fc.assert` without awaiting it, so the property is
 * still in flight when test B starts. Test B's `beforeEach` calls `vi.restoreAllMocks()` - the
 * repo-wide convention - which wipes the `vi.fn()` mocks the in-flight property is still using.
 * The wiped `send` then resolves to `undefined` and the failure surfaces from inside
 * `orphan-mock-service.ts` as `TypeError: Cannot read properties of undefined (reading 'Items')`.
 *
 * Two mock styles are exercised so the run distinguishes which one `vi.restoreAllMocks()` actually
 * wipes under Vitest 3: a bare `vi.fn()` (the corpus convention) and a `vi.spyOn` on a
 * module-scope client.
 *
 * NOTE: the un-awaited assertion here is intentional. Do NOT "fix" it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { listItemsForUser, DocClientLike } from './orphan-mock-service';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Module-scope client, spied on inside the property - mirrors files that spy on a shared client.
const sharedClient: DocClientLike = {
  send: async () => {
    throw new Error('sharedClient.send must be mocked');
  },
};

describe('fixture: orphaned property meets vi.restoreAllMocks()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A: un-awaited property with vi.fn() mocks', () => {
    fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1, maxLength: 3 }), async (items) => {
        const sendMock = vi.fn();
        sendMock.mockResolvedValueOnce({ Items: items });
        const client = { send: sendMock } as DocClientLike;

        // Keep the property in flight past the end of this test.
        await sleep(10);

        const result = await listItemsForUser(client, 'user-fixture');
        expect(result.items).toEqual(items);
      }),
      // endOnFailure keeps the rejection prompt: shrinking a slow async property can otherwise
      // push the rejection past the end of the run, where it disappears entirely.
      { numRuns: 40, endOnFailure: true },
    );
  });

  it('B: un-awaited property with a vi.spyOn mock', () => {
    fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { minLength: 1, maxLength: 3 }), async (items) => {
        vi.spyOn(sharedClient, 'send').mockResolvedValue({ Items: items });

        await sleep(10);

        const result = await listItemsForUser(sharedClient, 'user-fixture');
        expect(result.items).toEqual(items);
      }),
      { numRuns: 40, endOnFailure: true },
    );
  });

  it('C: later test whose beforeEach resets mocks while A and B are still running', async () => {
    // Long enough for the orphaned properties above to keep executing across this reset.
    await sleep(2500);
    expect(true).toBe(true);
  });
});
