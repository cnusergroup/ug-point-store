import { describe, it, expect, vi } from 'vitest';

// ============================================================
// Mock './reminder-tracking' — lets each test control exactly what
// queryAwaitingReminderRecords returns, independent of its own Scan+Filter
// pagination logic (already covered by reminder-tracking's own tests).
// ============================================================
const { queryAwaitingReminderRecordsMock } = vi.hoisted(() => ({
  queryAwaitingReminderRecordsMock: vi.fn(),
}));

vi.mock('./reminder-tracking', () => ({
  queryAwaitingReminderRecords: queryAwaitingReminderRecordsMock,
}));

import { queryAwaitingReminderUGLs } from './awaiting-reminder-list';

const USERS_TABLE = 'UsersTable';
const UGS_TABLE = 'UGsTable';
const TRACKING_TABLE = 'TrackingTable';

// ============================================================
// Unit tests
// Validates: Requirements 5.1, 5.11
// ============================================================
describe('queryAwaitingReminderUGLs', () => {
  it('aggregates the UGs table Scan across multiple pages before the join (leaderId on the second page is reflected in ugName)', async () => {
    queryAwaitingReminderRecordsMock.mockReset();
    queryAwaitingReminderRecordsMock.mockResolvedValue([
      { userId: 'u1', quarter: '2025-Q2', outcome: 'awaiting_reminder', createdAt: '2025-06-01T00:00:00.000Z' },
    ]);

    let scanCallCount = 0;
    const dynamoClient = {
      send: vi.fn(async (command: any) => {
        const name = command.constructor.name;

        if (name === 'BatchGetCommand') {
          return {
            Responses: {
              [USERS_TABLE]: [{ userId: 'u1', nickname: 'Alice', email: 'alice@example.com' }],
            },
          };
        }

        if (name === 'ScanCommand') {
          scanCallCount += 1;
          if (scanCallCount === 1) {
            // First page: no entry for 'u1' yet, but signals there's a second page.
            return {
              Items: [{ leaderId: 'other-leader', name: 'Other UG' }],
              LastEvaluatedKey: { leaderId: 'other-leader' },
            };
          }
          // Second page: 'u1' only appears here.
          return { Items: [{ leaderId: 'u1', name: 'Alice UG' }] };
        }

        throw new Error(`Unexpected command: ${name}`);
      }),
    };

    const result = await queryAwaitingReminderUGLs(dynamoClient as any, {
      trackingTable: TRACKING_TABLE,
      usersTable: USERS_TABLE,
      ugsTable: UGS_TABLE,
    });

    expect(scanCallCount).toBe(2);
    expect(result).toEqual([
      {
        userId: 'u1',
        nickname: 'Alice',
        email: 'alice@example.com',
        ugName: 'Alice UG',
        quarter: '2025-Q2',
        recordedAt: '2025-06-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns [] immediately without calling BatchGetCommand or ScanCommand when there are zero awaiting_reminder records', async () => {
    queryAwaitingReminderRecordsMock.mockReset();
    queryAwaitingReminderRecordsMock.mockResolvedValue([]);

    const sendMock = vi.fn(async (command: any) => {
      throw new Error(`Should not be called: ${command.constructor.name}`);
    });
    const dynamoClient = { send: sendMock };

    const result = await queryAwaitingReminderUGLs(dynamoClient as any, {
      trackingTable: TRACKING_TABLE,
      usersTable: USERS_TABLE,
      ugsTable: UGS_TABLE,
    });

    expect(result).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(queryAwaitingReminderRecordsMock).toHaveBeenCalledTimes(1);
  });
});
