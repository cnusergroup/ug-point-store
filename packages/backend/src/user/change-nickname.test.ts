import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { changeNickname } from './change-nickname';
import { ErrorCodes } from '@points-mall/shared';

const tableName = 'Users';
const nicknameIndexName = 'nickname-index';
const userId = 'user-123';

function createMockClient(options: {
  getItem?: any | null;
  queryItems?: any[];
}) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      return Promise.resolve({ Item: options.getItem ?? null });
    }
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: options.queryItems ?? [] });
    }
    if (name === 'UpdateCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

describe('changeNickname', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed with a valid nickname change', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-14T00:00:00.000Z', // >24h ago
      },
      queryItems: [], // no one else has this nickname
    });

    const result = await changeNickname(userId, 'NewNick', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.ExpressionAttributeValues[':newNick']).toBe('NewNick');
  });

  it('should reject with NICKNAME_EMPTY when new nickname is empty', async () => {
    const mockClient = createMockClient({
      getItem: { nickname: 'CurrentNick', nicknameHistory: [] },
    });

    const result = await changeNickname(userId, '', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NICKNAME_EMPTY);

    // No DynamoDB calls should be made beyond validation
    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('should reject with NICKNAME_SAME_AS_CURRENT and not call UpdateCommand', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'SameName',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-14T00:00:00.000Z',
      },
      queryItems: [],
    });

    const result = await changeNickname(userId, 'SameName', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NICKNAME_SAME_AS_CURRENT);

    // Verify UpdateCommand was never called
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should reject with NICKNAME_ALREADY_TAKEN when another user has the nickname', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-14T00:00:00.000Z',
      },
      queryItems: [{ userId: 'other-user-456' }], // another user owns this nickname
    });

    const result = await changeNickname(userId, 'TakenNick', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NICKNAME_ALREADY_TAKEN);

    // Verify UpdateCommand was never called
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should reject with NICKNAME_CHANGE_TOO_FREQUENT when within 24h cooldown', async () => {
    // Current time: 2024-06-15T12:00:00.000Z
    // Last change: 2024-06-15T06:00:00.000Z (6 hours ago, within 24h)
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-15T06:00:00.000Z',
      },
      queryItems: [],
    });

    const result = await changeNickname(userId, 'NewNick', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NICKNAME_CHANGE_TOO_FREQUENT);
    // Error message should contain remaining time info
    expect(result.error?.message).toMatch(/\d+/);

    // Verify no QueryCommand or UpdateCommand beyond GetCommand
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should allow first-time change when nicknameChangedAt is undefined (no rate limit)', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: undefined, // never changed before
      },
      queryItems: [],
    });

    const result = await changeNickname(userId, 'FirstChange', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
  });

  it('should initialize nicknameHistory from undefined (array created)', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        // nicknameHistory is undefined — simulates a user who never changed
        nicknameChangedAt: undefined,
      },
      queryItems: [],
    });

    const result = await changeNickname(userId, 'BrandNew', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(true);

    // Verify UpdateCommand uses if_not_exists for nicknameHistory
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    // The UpdateExpression uses if_not_exists(nicknameHistory, :emptyList)
    expect(input.UpdateExpression).toContain('if_not_exists(nicknameHistory');
    expect(input.ExpressionAttributeValues[':emptyList']).toEqual([]);
    expect(input.ExpressionAttributeValues[':historyEntry']).toEqual([
      { previousNickname: 'OldNick', changedAt: expect.any(String) },
    ]);
  });

  it('should allow nickname change when uniqueness query returns self (excludes self)', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-14T00:00:00.000Z',
      },
      queryItems: [{ userId }], // GSI returns the same user's ID
    });

    const result = await changeNickname(userId, 'SelfNick', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called (self is excluded from uniqueness check)
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
  });

  it('should succeed with emoji nickname', async () => {
    const mockClient = createMockClient({
      getItem: {
        nickname: 'OldNick',
        nicknameHistory: [],
        nicknameChangedAt: '2024-06-14T00:00:00.000Z',
      },
      queryItems: [],
    });

    const result = await changeNickname(userId, '🎉✨🌟', mockClient, tableName, nicknameIndexName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify the emoji nickname is stored correctly
    const updateCall = mockClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':newNick']).toBe('🎉✨🌟');
  });
});
