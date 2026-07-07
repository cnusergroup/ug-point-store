import { describe, it, expect, vi } from 'vitest';
import { queryPendingExitUGLs } from './pending-exit-list';

// ============================================================
// Mock DynamoDB client
// ============================================================

function createMockDynamoClient(usersItems: unknown[], ugsItems: unknown[]) {
  return {
    send: vi.fn(async (command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'QueryCommand') {
        return { Items: usersItems };
      }
      if (commandName === 'ScanCommand') {
        return { Items: ugsItems };
      }
      throw new Error(`Unexpected command: ${commandName}`);
    }),
  };
}

// ============================================================
// Unit tests
// Validates: Requirements 9.1
// ============================================================
describe('queryPendingExitUGLs', () => {
  it('returns ugName: "" for a pending-exit user who leads no UG', async () => {
    const usersItems = [
      {
        userId: 'u1',
        nickname: 'Alice',
        email: 'alice@example.com',
        uglExitTriggeredQuarter: '2025-Q2',
        uglExitMarkedAt: '2025-08-01T00:00:00.000Z',
      },
    ];
    // UGs table has no entry for leaderId 'u1'.
    const ugsItems = [{ leaderId: 'u2', name: 'Some Other UG' }];

    const dynamoClient = createMockDynamoClient(usersItems, ugsItems) as any;
    const result = await queryPendingExitUGLs(dynamoClient, {
      usersTable: 'UsersTable',
      ugsTable: 'UGsTable',
    });

    expect(result).toEqual([
      {
        userId: 'u1',
        nickname: 'Alice',
        email: 'alice@example.com',
        ugName: '',
        triggeredQuarter: '2025-Q2',
        markedAt: '2025-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns the matching UG name when the user leads a UG', async () => {
    const usersItems = [
      {
        userId: 'u1',
        nickname: 'Bob',
        email: 'bob@example.com',
        uglExitTriggeredQuarter: '2025-Q3',
        uglExitMarkedAt: '2025-11-01T00:00:00.000Z',
      },
    ];
    const ugsItems = [{ leaderId: 'u1', name: 'Bob Group' }];

    const dynamoClient = createMockDynamoClient(usersItems, ugsItems) as any;
    const result = await queryPendingExitUGLs(dynamoClient, {
      usersTable: 'UsersTable',
      ugsTable: 'UGsTable',
    });

    expect(result).toHaveLength(1);
    expect(result[0].ugName).toBe('Bob Group');
  });

  it('returns an empty array when there are no pending-exit users', async () => {
    const dynamoClient = createMockDynamoClient([], []) as any;
    const result = await queryPendingExitUGLs(dynamoClient, {
      usersTable: 'UsersTable',
      ugsTable: 'UGsTable',
    });
    expect(result).toEqual([]);
  });
});
