import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { changeNickname } from './change-nickname';
import { ErrorCodes } from '@points-mall/shared';

// ============================================================
// Constants
// ============================================================

const TABLE_NAME = 'PointsMall-Users';
const NICKNAME_INDEX = 'nickname-index';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a single non-control Unicode character (BMP, excluding control ranges) */
const nonControlCharArb = fc.oneof(
  fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)),
  fc.integer({ min: 0xa0, max: 0xd7ff }).map((c) => String.fromCharCode(c)),
  fc.integer({ min: 0xe000, max: 0xffff }).map((c) => String.fromCharCode(c)),
);

/** Arbitrary for a valid nickname string (1-20 codepoints, no control chars, no leading/trailing whitespace) */
const validNicknameArb = fc
  .array(nonControlCharArb, { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''))
  .filter((s) => s.trim().length > 0 && s.trim() === s);

/** Arbitrary for whitespace padding (spaces/tabs only) */
const whitespacePaddingArb = fc.string({
  unit: fc.constantFrom(' ', '\t'),
  minLength: 0,
  maxLength: 3,
});

/** Arbitrary for a userId */
const userIdArb = fc.string({
  minLength: 5,
  maxLength: 30,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'),
});

// ============================================================
// Feature: nickname-change, Property 2: Same-nickname rejection
// **Validates: Requirements 1.6**
//
// For any valid nickname string N that passes format validation,
// if the user's current nickname equals N (case-sensitive comparison
// after trim), then changeNickname SHALL reject with
// NICKNAME_SAME_AS_CURRENT and SHALL NOT modify any field on the
// user record (including updatedAt).
// ============================================================

describe('Feature: nickname-change, Property 2: Same-nickname rejection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with NICKNAME_SAME_AS_CURRENT when trimmed input equals current nickname, no Update or Query called', () => {
    fc.assert(
      fc.asyncProperty(
        validNicknameArb,
        whitespacePaddingArb,
        whitespacePaddingArb,
        userIdArb,
        async (nickname, leadingWs, trailingWs, userId) => {
          const input = leadingWs + nickname + trailingWs;
          const currentNickname = nickname;

          const mockSend = vi.fn().mockImplementation((command: any) => {
            const name = command.constructor.name;
            if (name === 'GetCommand') {
              return Promise.resolve({
                Item: {
                  userId,
                  nickname: currentNickname,
                  nicknameHistory: [],
                  nicknameChangedAt: undefined,
                },
              });
            }
            if (name === 'QueryCommand') {
              return Promise.resolve({ Items: [] });
            }
            if (name === 'UpdateCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          const client = { send: mockSend } as any;
          const result = await changeNickname(
            userId, input, client, TABLE_NAME, NICKNAME_INDEX,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NICKNAME_SAME_AS_CURRENT);

          const updateCalls = mockSend.mock.calls.filter(
            ([cmd]: any) => cmd.constructor.name === 'UpdateCommand',
          );
          expect(updateCalls).toHaveLength(0);

          const queryCalls = mockSend.mock.calls.filter(
            ([cmd]: any) => cmd.constructor.name === 'QueryCommand',
          );
          expect(queryCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exact same nickname without whitespace is always rejected with no DB modifications', () => {
    fc.assert(
      fc.asyncProperty(
        validNicknameArb,
        userIdArb,
        async (nickname, userId) => {
          const mockSend = vi.fn().mockImplementation((command: any) => {
            const name = command.constructor.name;
            if (name === 'GetCommand') {
              return Promise.resolve({
                Item: {
                  userId,
                  nickname,
                  nicknameHistory: [
                    { previousNickname: 'old', changedAt: '2024-01-01T00:00:00Z' },
                  ],
                  nicknameChangedAt: undefined,
                },
              });
            }
            if (name === 'QueryCommand') {
              return Promise.resolve({ Items: [] });
            }
            if (name === 'UpdateCommand') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          const client = { send: mockSend } as any;
          const result = await changeNickname(
            userId, nickname, client, TABLE_NAME, NICKNAME_INDEX,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.NICKNAME_SAME_AS_CURRENT);

          const updateCalls = mockSend.mock.calls.filter(
            ([cmd]: any) => cmd.constructor.name === 'UpdateCommand',
          );
          const queryCalls = mockSend.mock.calls.filter(
            ([cmd]: any) => cmd.constructor.name === 'QueryCommand',
          );
          expect(updateCalls).toHaveLength(0);
          expect(queryCalls).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Feature: nickname-change, Property 5: Successful change correctness
// **Validates: Requirements 1.3, 5.1, 5.2, 5.3, 6.2, 8.4**
// ============================================================

describe('Feature: nickname-change, Property 5: Successful change correctness', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-06-01T12:00:00Z').getTime());
  });

  it('UpdateCommand sets nickname=trimmedNew, appends history with previousNickname, sets nicknameChangedAt', () => {
    fc.assert(
      fc.asyncProperty(userIdArb, validNicknameArb, validNicknameArb, async (userId, curNick, newNick) => {
        fc.pre(newNick !== curNick);
        let captured: any = null;
        const mockSend = vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof GetCommand) {
            return Promise.resolve({
              Item: { nickname: curNick, nicknameHistory: [{ previousNickname: 'old1', changedAt: '2024-01-01T00:00:00.000Z' }], nicknameChangedAt: '2024-01-01T00:00:00.000Z' },
            });
          }
          if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [] });
          if (cmd instanceof UpdateCommand) { captured = cmd.input; return Promise.resolve({}); }
          return Promise.resolve({});
        });
        const result = await changeNickname(userId, newNick, { send: mockSend } as any, TABLE_NAME, NICKNAME_INDEX);
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        // Verify UpdateCommand called exactly once
        expect(mockSend.mock.calls.filter(([c]: any) => c instanceof UpdateCommand)).toHaveLength(1);
        expect(captured).not.toBeNull();
        const ev = captured.ExpressionAttributeValues;
        // (a) nickname = trimmed new nickname
        expect(ev[':newNick']).toBe(newNick.trim());
        // (b) history entry records the OLD nickname
        expect(ev[':historyEntry']).toHaveLength(1);
        expect(ev[':historyEntry'][0].previousNickname).toBe(curNick);
        expect(ev[':historyEntry'][0].changedAt).toBeDefined();
        expect(new Date(ev[':historyEntry'][0].changedAt).toISOString()).toBe(ev[':historyEntry'][0].changedAt);
        // (c) nicknameChangedAt = valid ISO timestamp
        expect(new Date(ev[':now']).toISOString()).toBe(ev[':now']);
        expect(ev[':historyEntry'][0].changedAt).toBe(ev[':now']);
      }),
      { numRuns: 100 },
    );
  });

  it('returns { success: true } for valid inputs with all checks passing', () => {
    fc.assert(
      fc.asyncProperty(userIdArb, validNicknameArb, validNicknameArb, async (userId, curNick, newNick) => {
        fc.pre(newNick !== curNick);
        const mockSend = vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof GetCommand) return Promise.resolve({ Item: { nickname: curNick, nicknameHistory: [], nicknameChangedAt: undefined } });
          if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [] });
          if (cmd instanceof UpdateCommand) return Promise.resolve({});
          return Promise.resolve({});
        });
        const result = await changeNickname(userId, newNick, { send: mockSend } as any, TABLE_NAME, NICKNAME_INDEX);
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('UpdateCommand only updates nickname-related fields; key is userId only', () => {
    fc.assert(
      fc.asyncProperty(userIdArb, validNicknameArb, validNicknameArb, async (userId, curNick, newNick) => {
        fc.pre(newNick !== curNick);
        let captured: any = null;
        const mockSend = vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof GetCommand) return Promise.resolve({ Item: { nickname: curNick, nicknameHistory: [], nicknameChangedAt: undefined } });
          if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [] });
          if (cmd instanceof UpdateCommand) { captured = cmd.input; return Promise.resolve({}); }
          return Promise.resolve({});
        });
        await changeNickname(userId, newNick, { send: mockSend } as any, TABLE_NAME, NICKNAME_INDEX);
        expect(captured).not.toBeNull();
        expect(captured.Key).toEqual({ userId });
        expect(captured.TableName).toBe(TABLE_NAME);
        const expr: string = captured.UpdateExpression;
        expect(expr).toContain('nickname = :newNick');
        expect(expr).toContain('nicknameChangedAt = :now');
        expect(expr).toContain('updatedAt = :now');
        expect(expr).toContain('nicknameHistory');
        // Should NOT modify other user fields
        expect(expr).not.toContain('roles');
        expect(expr).not.toContain('points');
        expect(expr).not.toContain('passwordHash');
        expect(expr).not.toContain('email');
        expect(expr).not.toContain('earnTotal');
      }),
      { numRuns: 100 },
    );
  });

  it('nicknameHistory uses list_append with if_not_exists for first-time changes', () => {
    fc.assert(
      fc.asyncProperty(userIdArb, validNicknameArb, validNicknameArb, async (userId, curNick, newNick) => {
        fc.pre(newNick !== curNick);
        let captured: any = null;
        const mockSend = vi.fn().mockImplementation((cmd: any) => {
          if (cmd instanceof GetCommand) return Promise.resolve({ Item: { nickname: curNick, nicknameChangedAt: undefined } });
          if (cmd instanceof QueryCommand) return Promise.resolve({ Items: [] });
          if (cmd instanceof UpdateCommand) { captured = cmd.input; return Promise.resolve({}); }
          return Promise.resolve({});
        });
        const result = await changeNickname(userId, newNick, { send: mockSend } as any, TABLE_NAME, NICKNAME_INDEX);
        expect(result.success).toBe(true);
        const expr: string = captured.UpdateExpression;
        expect(expr).toContain('list_append');
        expect(expr).toContain('if_not_exists');
        expect(captured.ExpressionAttributeValues[':emptyList']).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
