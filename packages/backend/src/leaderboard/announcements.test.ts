import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isBatchRecord,
  isReservationRecord,
  validateAnnouncementParams,
  getAnnouncements,
} from './announcements';

// ============================================================
// Helpers
// ============================================================

const TABLES = {
  pointsRecordsTable: 'PointsRecords',
  usersTable: 'Users',
  batchDistributionsTable: 'BatchDistributions',
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

// ============================================================
// 1. isBatchRecord
// ============================================================

describe('isBatchRecord', () => {
  it('should return true for source starting with "批量发放:"', () => {
    expect(isBatchRecord('批量发放:活动积分')).toBe(true);
    expect(isBatchRecord('批量发放:test')).toBe(true);
    expect(isBatchRecord('批量发放:')).toBe(true);
  });

  it('should return false for other strings', () => {
    expect(isBatchRecord('预约审批:xxx')).toBe(false);
    expect(isBatchRecord('手动发放')).toBe(false);
    expect(isBatchRecord('')).toBe(false);
    expect(isBatchRecord('批量发放')).toBe(false); // missing colon
  });
});

// ============================================================
// 2. isReservationRecord
// ============================================================

describe('isReservationRecord', () => {
  it('should return true for source starting with "预约审批:"', () => {
    expect(isReservationRecord('预约审批:活动预约')).toBe(true);
    expect(isReservationRecord('预约审批:test')).toBe(true);
    expect(isReservationRecord('预约审批:')).toBe(true);
  });

  it('should return false for other strings', () => {
    expect(isReservationRecord('批量发放:xxx')).toBe(false);
    expect(isReservationRecord('手动发放')).toBe(false);
    expect(isReservationRecord('')).toBe(false);
    expect(isReservationRecord('预约审批')).toBe(false); // missing colon
  });
});

// ============================================================
// 3. validateAnnouncementParams
// ============================================================

describe('validateAnnouncementParams', () => {
  // --- Valid parameters ---

  it('should return valid with default limit when no params provided', () => {
    const result = validateAnnouncementParams({});
    expect(result.valid).toBe(true);
    expect(result.options).toEqual({ limit: 20 });
  });

  it('should accept explicit valid limit', () => {
    const result = validateAnnouncementParams({ limit: '30' });
    expect(result.valid).toBe(true);
    expect(result.options!.limit).toBe(30);
  });

  it('should accept limit at boundary (1)', () => {
    const result = validateAnnouncementParams({ limit: '1' });
    expect(result.valid).toBe(true);
    expect(result.options!.limit).toBe(1);
  });

  it('should accept limit at boundary (50)', () => {
    const result = validateAnnouncementParams({ limit: '50' });
    expect(result.valid).toBe(true);
    expect(result.options!.limit).toBe(50);
  });

  it('should accept valid base64-encoded JSON lastKey', () => {
    const key = { type: 'earn', createdAt: '2024-01-01T00:00:00Z', recordId: 'r1' };
    const encoded = Buffer.from(JSON.stringify(key)).toString('base64');
    const result = validateAnnouncementParams({ lastKey: encoded });
    expect(result.valid).toBe(true);
    expect(result.options!.lastKey).toBe(encoded);
  });

  it('should ignore empty lastKey', () => {
    const result = validateAnnouncementParams({ lastKey: '' });
    expect(result.valid).toBe(true);
    expect(result.options!.lastKey).toBeUndefined();
  });

  // --- Invalid limit ---

  it('should reject limit of 0', () => {
    const result = validateAnnouncementParams({ limit: '0' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject limit of 51', () => {
    const result = validateAnnouncementParams({ limit: '51' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject negative limit', () => {
    const result = validateAnnouncementParams({ limit: '-5' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-numeric limit', () => {
    const result = validateAnnouncementParams({ limit: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  // --- Invalid lastKey ---

  it('should reject invalid base64 lastKey', () => {
    const result = validateAnnouncementParams({ lastKey: '!!!not-valid-base64!!!' });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });

  it('should reject lastKey that is valid base64 but not valid JSON', () => {
    const notJson = Buffer.from('this is not json').toString('base64');
    const result = validateAnnouncementParams({ lastKey: notJson });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });
});

// ============================================================
// 4. getAnnouncements — integration with mock DynamoDB
// ============================================================

describe('getAnnouncements', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return earn records with correct fields', async () => {
    // 1st call: QueryCommand for PointsRecords
    client.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1',
          userId: 'u1',
          amount: 100,
          source: '预约审批:活动预约',
          createdAt: '2024-06-01T10:00:00Z',
          targetRole: 'Speaker',
          type: 'earn',
          activityUG: 'UG-Beijing',
          activityDate: '2024-06-01',
          activityTopic: 'AI Workshop',
          activityType: 'workshop',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // 2nd call: BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
        ],
      },
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);

    const item = result.items![0];
    expect(item.recordId).toBe('r1');
    expect(item.recipientNickname).toBe('Alice');
    expect(item.amount).toBe(100);
    expect(item.source).toBe('预约审批:活动预约');
    expect(item.createdAt).toBe('2024-06-01T10:00:00Z');
    expect(item.targetRole).toBe('Speaker');
    expect(item.activityUG).toBe('UG-Beijing');
    expect(item.activityDate).toBe('2024-06-01');
    expect(item.activityTopic).toBe('AI Workshop');
    expect(item.activityType).toBe('workshop');
    expect(item.distributorNickname).toBeUndefined();
  });

  it('should handle pagination with lastKey', async () => {
    const lastEvalKey = { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r2' };

    // 1st call: QueryCommand returns items + LastEvaluatedKey
    client.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1',
          userId: 'u1',
          amount: 50,
          source: '预约审批:test',
          createdAt: '2024-06-01T10:00:00Z',
          targetRole: 'Volunteer',
          type: 'earn',
        },
      ],
      LastEvaluatedKey: lastEvalKey,
    });

    // 2nd call: BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Bob' },
        ],
      },
    });

    const result = await getAnnouncements({ limit: 1 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.lastKey).not.toBeNull();

    // Verify lastKey is valid base64-encoded JSON
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should pass decoded lastKey as ExclusiveStartKey to DynamoDB', async () => {
    const cursorObj = { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r0' };
    const encodedCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');

    // 1st call: QueryCommand
    client.send.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await getAnnouncements({ limit: 20, lastKey: encodedCursor }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);

    // Verify the QueryCommand was called with ExclusiveStartKey
    const queryCall = client.send.mock.calls[0][0];
    expect(queryCall.input.ExclusiveStartKey).toEqual(cursorObj);
  });

  it('should lookup recipient nicknames via BatchGet', async () => {
    // 1st call: QueryCommand returns records with different userIds
    client.send.mockResolvedValueOnce({
      Items: [
        { recordId: 'r1', userId: 'u1', amount: 100, source: '预约审批:a', createdAt: '2024-06-02T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
        { recordId: 'r2', userId: 'u2', amount: 200, source: '预约审批:b', createdAt: '2024-06-01T00:00:00Z', targetRole: 'Volunteer', type: 'earn' },
        { recordId: 'r3', userId: 'u1', amount: 50, source: '预约审批:c', createdAt: '2024-05-31T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
      ],
      LastEvaluatedKey: undefined,
    });

    // 2nd call: BatchGetCommand for user nicknames (deduplicated userIds)
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
          { userId: 'u2', nickname: 'Bob' },
        ],
      },
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items![0].recipientNickname).toBe('Alice');
    expect(result.items![1].recipientNickname).toBe('Bob');
    expect(result.items![2].recipientNickname).toBe('Alice');

    // Verify BatchGet was called with deduplicated userIds
    const batchGetCall = client.send.mock.calls[1][0];
    const keys = batchGetCall.input.RequestItems[TABLES.usersTable].Keys;
    expect(keys).toHaveLength(2); // u1 and u2 (deduplicated)
  });

  it('should lookup distributor nickname for batch records', async () => {
    // 1st call: QueryCommand returns a batch record
    client.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1',
          userId: 'u1',
          amount: 100,
          source: '批量发放:活动积分',
          createdAt: '2024-06-01T10:00:00Z',
          targetRole: 'Speaker',
          type: 'earn',
          activityId: 'act-1',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // 2nd call: BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
        ],
      },
    });

    // 3rd call: QueryCommand for BatchDistributions (distributor nickname)
    client.send.mockResolvedValueOnce({
      Items: [
        { activityId: 'act-1', distributorNickname: 'AdminUser' },
      ],
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].distributorNickname).toBe('AdminUser');
    expect(result.items![0].recipientNickname).toBe('Alice');
  });

  it('should return empty items when no records found', async () => {
    client.send.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.lastKey).toBeNull();

    // Should only have 1 call (QueryCommand), no BatchGet needed
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('should return error for invalid lastKey', async () => {
    const result = await getAnnouncements(
      { limit: 20, lastKey: 'invalid-base64!!' },
      client,
      TABLES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });

  it('should return null lastKey when no more pages', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { recordId: 'r1', userId: 'u1', amount: 100, source: '预约审批:a', createdAt: '2024-06-01T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
      ],
      LastEvaluatedKey: undefined,
    });

    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
        ],
      },
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeNull();
  });

  it('should default recipientNickname to empty string when user not found', async () => {
    client.send.mockResolvedValueOnce({
      Items: [
        { recordId: 'r1', userId: 'u-unknown', amount: 50, source: '预约审批:a', createdAt: '2024-06-01T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
      ],
      LastEvaluatedKey: undefined,
    });

    // BatchGet returns empty — user not found
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [],
      },
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items![0].recipientNickname).toBe('');
  });
});
