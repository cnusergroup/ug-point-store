import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isBatchRecord,
  isReservationRecord,
  isAdjustmentRecord,
  isDeletionAdjustmentRecord,
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

/**
 * Queue mock responses for the two parallel type-createdAt-index QueryCommand calls
 * (earn first, then adjust — matching Promise.all call order in getAnnouncements),
 * followed by any additional mock responses (BatchGet users, BatchDistributions, etc.).
 */
function queueEarnAdjustQueries(
  client: ReturnType<typeof createMockDynamoClient>,
  earnResponse: { Items: any[]; LastEvaluatedKey?: any },
  adjustResponse: { Items: any[]; LastEvaluatedKey?: any } = { Items: [], LastEvaluatedKey: undefined },
) {
  client.send.mockResolvedValueOnce(earnResponse);
  client.send.mockResolvedValueOnce(adjustResponse);
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
// 2b. isAdjustmentRecord / isDeletionAdjustmentRecord
// ============================================================

describe('isAdjustmentRecord', () => {
  it('should return true for all 5 adjust prefixes', () => {
    expect(isAdjustmentRecord('积分调整:Speaker|UG-Beijing|Topic|2024-06-01')).toBe(true);
    expect(isAdjustmentRecord('发放删除:Speaker|UG-Beijing|Topic|2024-06-01')).toBe(true);
    expect(isAdjustmentRecord('技能释放:liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(true);
    expect(isAdjustmentRecord('技能释放(删除):liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(true);
    expect(isAdjustmentRecord('技能指派:liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(true);
  });

  it('should return false for non-adjust sources', () => {
    expect(isAdjustmentRecord('批量发放:xxx')).toBe(false);
    expect(isAdjustmentRecord('预约审批:xxx')).toBe(false);
    expect(isAdjustmentRecord('')).toBe(false);
  });
});

describe('isDeletionAdjustmentRecord', () => {
  it('should return true only for deletion-related adjust prefixes', () => {
    expect(isDeletionAdjustmentRecord('发放删除:Speaker|UG-Beijing|Topic|2024-06-01')).toBe(true);
    expect(isDeletionAdjustmentRecord('技能释放(删除):liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(true);
  });

  it('should return false for non-deletion adjust prefixes and other sources', () => {
    expect(isDeletionAdjustmentRecord('积分调整:Speaker|UG-Beijing|Topic|2024-06-01')).toBe(false);
    expect(isDeletionAdjustmentRecord('技能释放:liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(false);
    expect(isDeletionAdjustmentRecord('技能指派:liveSupport|UG-Beijing|Topic|2024-06-01')).toBe(false);
    expect(isDeletionAdjustmentRecord('批量发放:xxx')).toBe(false);
    expect(isDeletionAdjustmentRecord('')).toBe(false);
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
    const key = { earnKey: { type: 'earn', createdAt: '2024-01-01T00:00:00Z', recordId: 'r1' }, adjustKey: null };
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
    // 1st call: QueryCommand for PointsRecords type='earn'
    // 2nd call: QueryCommand for PointsRecords type='adjust' (empty)
    queueEarnAdjustQueries(client, {
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

    // 3rd call: BatchGetCommand for user nicknames
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

  it('should handle pagination with lastKey (new { earnKey, adjustKey } cursor shape)', async () => {
    // Simulate: limit=1, only earn has data and more remains (adjust exhausted immediately)
    queueEarnAdjustQueries(
      client,
      {
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
        LastEvaluatedKey: { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r2' },
      },
      { Items: [], LastEvaluatedKey: undefined },
    );

    // BatchGetCommand for user nicknames
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

    // Verify lastKey decodes to the new { earnKey, adjustKey } cursor shape
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual({
      earnKey: { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r2' },
      adjustKey: null,
    });
  });

  it('should pass decoded legacy flat lastKey as ExclusiveStartKey to the earn query', async () => {
    // Legacy cursor shape (no earnKey/adjustKey wrapper) — treated as earn cursor
    const cursorObj = { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r0' };
    const encodedCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');

    queueEarnAdjustQueries(client, { Items: [], LastEvaluatedKey: undefined });

    const result = await getAnnouncements({ limit: 20, lastKey: encodedCursor }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);

    // Verify the first QueryCommand (earn) was called with ExclusiveStartKey = legacy cursor
    const earnQueryCall = client.send.mock.calls[0][0];
    expect(earnQueryCall.input.ExclusiveStartKey).toEqual(cursorObj);

    // Verify the second QueryCommand (adjust) was called with no ExclusiveStartKey (fresh start)
    const adjustQueryCall = client.send.mock.calls[1][0];
    expect(adjustQueryCall.input.ExclusiveStartKey).toBeUndefined();
  });

  it('should pass decoded { earnKey, adjustKey } cursor to the respective queries', async () => {
    const earnKey = { type: 'earn', createdAt: '2024-05-01T00:00:00Z', recordId: 'r0' };
    const adjustKey = { type: 'adjust', createdAt: '2024-04-01T00:00:00Z', recordId: 'a0' };
    const encodedCursor = Buffer.from(JSON.stringify({ earnKey, adjustKey })).toString('base64');

    queueEarnAdjustQueries(client, { Items: [], LastEvaluatedKey: undefined });

    const result = await getAnnouncements({ limit: 20, lastKey: encodedCursor }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);

    const earnQueryCall = client.send.mock.calls[0][0];
    expect(earnQueryCall.input.ExclusiveStartKey).toEqual(earnKey);

    const adjustQueryCall = client.send.mock.calls[1][0];
    expect(adjustQueryCall.input.ExclusiveStartKey).toEqual(adjustKey);
  });

  it('should skip the earn query entirely when earnKey cursor is null (exhausted)', async () => {
    const adjustKey = { type: 'adjust', createdAt: '2024-04-01T00:00:00Z', recordId: 'a0' };
    const encodedCursor = Buffer.from(JSON.stringify({ earnKey: null, adjustKey })).toString('base64');

    // Only one QueryCommand call expected (adjust) since earn is skipped
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await getAnnouncements({ limit: 20, lastKey: encodedCursor }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);

    // Only 1 call total: the adjust QueryCommand
    expect(client.send).toHaveBeenCalledTimes(1);
    const adjustQueryCall = client.send.mock.calls[0][0];
    expect(adjustQueryCall.input.ExpressionAttributeValues[':type']).toBe('adjust');
    expect(adjustQueryCall.input.ExclusiveStartKey).toEqual(adjustKey);
  });

  it('should lookup recipient nicknames via BatchGet', async () => {
    // earn query returns records with different userIds; adjust query empty
    queueEarnAdjustQueries(client, {
      Items: [
        { recordId: 'r1', userId: 'u1', amount: 100, source: '预约审批:a', createdAt: '2024-06-02T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
        { recordId: 'r2', userId: 'u2', amount: 200, source: '预约审批:b', createdAt: '2024-06-01T00:00:00Z', targetRole: 'Volunteer', type: 'earn' },
        { recordId: 'r3', userId: 'u1', amount: 50, source: '预约审批:c', createdAt: '2024-05-31T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
      ],
      LastEvaluatedKey: undefined,
    });

    // BatchGetCommand for user nicknames (deduplicated userIds)
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

    // Verify BatchGet was called with deduplicated userIds (3rd call overall)
    const batchGetCall = client.send.mock.calls[2][0];
    const keys = batchGetCall.input.RequestItems[TABLES.usersTable].Keys;
    expect(keys).toHaveLength(2); // u1 and u2 (deduplicated)
  });

  it('should lookup distributor nickname for batch records', async () => {
    // earn query returns a batch record; adjust query empty
    queueEarnAdjustQueries(client, {
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

    // BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
        ],
      },
    });

    // QueryCommand for BatchDistributions (distributor nickname)
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
    queueEarnAdjustQueries(client, { Items: [], LastEvaluatedKey: undefined });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.lastKey).toBeNull();

    // Should only have 2 calls (earn + adjust QueryCommand), no BatchGet needed
    expect(client.send).toHaveBeenCalledTimes(2);
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
    queueEarnAdjustQueries(client, {
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
    queueEarnAdjustQueries(client, {
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

  // --------------------------------------------------------
  // Adjust record handling
  // --------------------------------------------------------

  it('should include type="adjust" records with a positive delta (added recipient)', async () => {
    queueEarnAdjustQueries(
      client,
      { Items: [], LastEvaluatedKey: undefined },
      {
        Items: [
          {
            recordId: 'adj-1',
            userId: 'u1',
            amount: 500,
            source: '积分调整:Speaker|UG-Beijing|AI Workshop|2024-06-01',
            createdAt: '2024-06-02T00:00:00Z',
            targetRole: 'Speaker',
            type: 'adjust',
            activityId: 'act-1',
            activityUG: 'UG-Beijing',
            activityTopic: 'AI Workshop',
            activityDate: '2024-06-01',
            distributionId: 'dist-1',
          },
        ],
        LastEvaluatedKey: undefined,
      },
    );

    client.send.mockResolvedValueOnce({
      Responses: { [TABLES.usersTable]: [{ userId: 'u1', nickname: 'Alice' }] },
    });
    // Distributor lookup for the non-deletion adjust record
    client.send.mockResolvedValueOnce({
      Items: [{ activityId: 'act-1', distributorNickname: 'AdminUser' }],
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items![0];
    expect(item.source).toBe('积分调整:Speaker|UG-Beijing|AI Workshop|2024-06-01');
    expect(item.amount).toBe(500);
    expect(item.recipientNickname).toBe('Alice');
    expect(item.distributorNickname).toBe('AdminUser');
  });

  it('should include type="adjust" records with a negative delta (removed recipient)', async () => {
    queueEarnAdjustQueries(
      client,
      { Items: [], LastEvaluatedKey: undefined },
      {
        Items: [
          {
            recordId: 'adj-2',
            userId: 'u2',
            amount: -300,
            source: '积分调整:Speaker|UG-Beijing|AI Workshop|2024-06-01',
            createdAt: '2024-06-02T00:00:00Z',
            targetRole: 'Speaker',
            type: 'adjust',
            activityId: 'act-1',
            activityUG: 'UG-Beijing',
            activityTopic: 'AI Workshop',
            activityDate: '2024-06-01',
            distributionId: 'dist-1',
          },
        ],
        LastEvaluatedKey: undefined,
      },
    );

    client.send.mockResolvedValueOnce({
      Responses: { [TABLES.usersTable]: [{ userId: 'u2', nickname: 'Carol' }] },
    });
    client.send.mockResolvedValueOnce({
      Items: [{ activityId: 'act-1', distributorNickname: 'AdminUser' }],
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items![0];
    expect(item.amount).toBe(-300);
    expect(item.distributorNickname).toBe('AdminUser');
  });

  it('should default distributorNickname to "" for deletion adjust records ("发放删除:") without throwing', async () => {
    queueEarnAdjustQueries(
      client,
      { Items: [], LastEvaluatedKey: undefined },
      {
        Items: [
          {
            recordId: 'adj-3',
            userId: 'u3',
            amount: -800,
            source: '发放删除:Speaker|UG-Beijing|AI Workshop|2024-06-01',
            createdAt: '2024-06-03T00:00:00Z',
            targetRole: 'Speaker',
            type: 'adjust',
            activityId: 'act-deleted-1',
            activityUG: 'UG-Beijing',
            activityTopic: 'AI Workshop',
            activityDate: '2024-06-01',
            distributionId: 'dist-deleted-1',
          },
        ],
        LastEvaluatedKey: undefined,
      },
    );

    client.send.mockResolvedValueOnce({
      Responses: { [TABLES.usersTable]: [{ userId: 'u3', nickname: 'Dave' }] },
    });
    // No BatchDistributions query expected since the only adjust record is a deletion record

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    const item = result.items![0];
    expect(item.amount).toBe(-800);
    expect(item.distributorNickname).toBe('');
    // Only 3 calls: earn query, adjust query, BatchGet users (no BatchDistributions query)
    expect(client.send).toHaveBeenCalledTimes(3);
  });

  it('should merge and sort type="earn" and type="adjust" records together by createdAt descending', async () => {
    queueEarnAdjustQueries(
      client,
      {
        Items: [
          { recordId: 'e1', userId: 'u1', amount: 100, source: '预约审批:a', createdAt: '2024-06-03T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
          { recordId: 'e2', userId: 'u1', amount: 100, source: '预约审批:b', createdAt: '2024-06-01T00:00:00Z', targetRole: 'Speaker', type: 'earn' },
        ],
        LastEvaluatedKey: undefined,
      },
      {
        Items: [
          { recordId: 'a1', userId: 'u1', amount: 50, source: '技能指派:liveSupport|UG|Topic|2024-06-01', createdAt: '2024-06-02T00:00:00Z', targetRole: 'UserGroupLeader', type: 'adjust', activityId: 'act-2' },
        ],
        LastEvaluatedKey: undefined,
      },
    );

    client.send.mockResolvedValueOnce({
      Responses: { [TABLES.usersTable]: [{ userId: 'u1', nickname: 'Alice' }] },
    });
    client.send.mockResolvedValueOnce({
      Items: [{ activityId: 'act-2', distributorNickname: 'AdminUser' }],
    });

    const result = await getAnnouncements({ limit: 20 }, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(3);
    // Sorted by createdAt descending: e1 (06-03), a1 (06-02), e2 (06-01)
    expect(result.items!.map(i => i.recordId)).toEqual(['e1', 'a1', 'e2']);
  });
});
