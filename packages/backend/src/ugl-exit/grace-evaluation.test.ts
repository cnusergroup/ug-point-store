import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryMakeupCandidates } from './grace-evaluation';

// Unit tests for queryMakeupCandidates: verifies the DynamoDB query shape used to fetch
// Makeup_Record candidates, specifically the inclusive [sentAt, deadline] boundary
// (Req 5.2) and the exclusion of already-consumed records via the FilterExpression (Req 5.4).

const TABLE = 'PointsMall-PointsRecords';
const USER_ID = 'user-001';
const SENT_AT = '2025-05-01T00:00:00.000Z';
const DEADLINE = '2025-05-31T00:00:00.000Z';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

describe('queryMakeupCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the userId-createdAt-index GSI with an inclusive [sentAt, deadline] KeyConditionExpression', async () => {
    const client = createMockDynamoClient();
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await queryMakeupCandidates(USER_ID, SENT_AT, DEADLINE, client, TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe(TABLE);
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
    expect(cmd.input.KeyConditionExpression).toBe('userId = :uid AND createdAt BETWEEN :sentAt AND :deadline');
    expect(cmd.input.ExpressionAttributeValues[':uid']).toBe(USER_ID);
    expect(cmd.input.ExpressionAttributeValues[':sentAt']).toBe(SENT_AT);
    expect(cmd.input.ExpressionAttributeValues[':deadline']).toBe(DEADLINE);
  });

  it('filters to targetRole = UserGroupLeader AND consumedForQuarter unset', async () => {
    const client = createMockDynamoClient();
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await queryMakeupCandidates(USER_ID, SENT_AT, DEADLINE, client, TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe(
      'targetRole = :ugl AND attribute_not_exists(consumedForQuarter)',
    );
    expect(cmd.input.ExpressionAttributeValues[':ugl']).toBe('UserGroupLeader');
  });

  it('includes a candidate whose createdAt exactly equals sentAt (inclusive lower boundary)', async () => {
    const client = createMockDynamoClient();
    client.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1',
          userId: USER_ID,
          targetRole: 'UserGroupLeader',
          createdAt: SENT_AT,
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await queryMakeupCandidates(USER_ID, SENT_AT, DEADLINE, client, TABLE);

    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r1');
    expect(result[0].createdAt).toBe(SENT_AT);
  });

  it('includes a candidate whose createdAt exactly equals deadline (inclusive upper boundary)', async () => {
    const client = createMockDynamoClient();
    client.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r2',
          userId: USER_ID,
          targetRole: 'UserGroupLeader',
          createdAt: DEADLINE,
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await queryMakeupCandidates(USER_ID, SENT_AT, DEADLINE, client, TABLE);

    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r2');
    expect(result[0].createdAt).toBe(DEADLINE);
  });

  it('aggregates all pages when the DynamoDB response is paginated', async () => {
    const client = createMockDynamoClient();
    client.send
      .mockResolvedValueOnce({
        Items: [{ recordId: 'r1', userId: USER_ID, targetRole: 'UserGroupLeader', createdAt: SENT_AT }],
        LastEvaluatedKey: { userId: USER_ID, createdAt: SENT_AT },
      })
      .mockResolvedValueOnce({
        Items: [{ recordId: 'r2', userId: USER_ID, targetRole: 'UserGroupLeader', createdAt: DEADLINE }],
        LastEvaluatedKey: undefined,
      });

    const result = await queryMakeupCandidates(USER_ID, SENT_AT, DEADLINE, client, TABLE);

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(result.map((r) => r.recordId)).toEqual(['r1', 'r2']);
  });
});
