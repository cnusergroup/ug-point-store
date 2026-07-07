import { describe, it, expect, vi } from 'vitest';
import { queryAllUGLUsersForExit, queryQuarterQualifyingRecords } from './eligibility';

function createMockDynamoClient(responses: any[]) {
  const send = vi.fn();
  for (const response of responses) {
    send.mockResolvedValueOnce(response);
  }
  return { send } as any;
}

describe('queryAllUGLUsersForExit', () => {
  it('should aggregate all pages when LastEvaluatedKey is returned', async () => {
    const page1 = {
      Items: [
        {
          userId: 'u1',
          nickname: 'Alice',
          email: 'a@test.com',
          roles: ['UserGroupLeader'],
          status: 'active',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      LastEvaluatedKey: { userId: 'u1' },
    };
    const page2 = {
      Items: [
        {
          userId: 'u2',
          nickname: 'Bob',
          email: 'b@test.com',
          roles: ['UserGroupLeader'],
          status: 'active',
          createdAt: '2024-02-01T00:00:00.000Z',
          uglExitStatus: 'pending_exit',
        },
      ],
      // no LastEvaluatedKey -> last page
    };
    const client = createMockDynamoClient([page1, page2]);

    const result = await queryAllUGLUsersForExit(client, 'Users');

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe('u1');
    expect(result[1]).toEqual({
      userId: 'u2',
      nickname: 'Bob',
      email: 'b@test.com',
      roles: ['UserGroupLeader'],
      status: 'active',
      createdAt: '2024-02-01T00:00:00.000Z',
      uglExitStatus: 'pending_exit',
    });

    // Verify the second call passed ExclusiveStartKey from the first page's LastEvaluatedKey
    const secondCallInput = client.send.mock.calls[1][0].input;
    expect(secondCallInput.ExclusiveStartKey).toEqual({ userId: 'u1' });

    // Verify query shape
    const firstCallInput = client.send.mock.calls[0][0].input;
    expect(firstCallInput.TableName).toBe('Users');
    expect(firstCallInput.IndexName).toBe('entityType-createdAt-index');
    expect(firstCallInput.KeyConditionExpression).toBe('entityType = :entityType');
    expect(firstCallInput.FilterExpression).toBe('contains(#roles, :ugl)');
    expect(firstCallInput.ExpressionAttributeValues[':entityType']).toBe('user');
    expect(firstCallInput.ExpressionAttributeValues[':ugl']).toBe('UserGroupLeader');
  });

  it('should return an empty array when no items exist', async () => {
    const client = createMockDynamoClient([{ Items: [] }]);
    const result = await queryAllUGLUsersForExit(client, 'Users');
    expect(result).toEqual([]);
  });
});

describe('queryQuarterQualifyingRecords', () => {
  const quarterStart = '2024-01-01T00:00:00.000Z';
  const quarterEnd = '2024-03-31T23:59:59.999Z';

  it('should aggregate all pages when LastEvaluatedKey is returned', async () => {
    const page1 = {
      Items: [
        {
          recordId: 'r1',
          userId: 'u1',
          targetRole: 'UserGroupLeader',
          activityDate: '2024-02-01',
          createdAt: '2024-02-01T00:00:00.000Z',
        },
      ],
      LastEvaluatedKey: { recordId: 'r1' },
    };
    const page2 = {
      Items: [
        {
          recordId: 'r2',
          userId: 'u2',
          targetRole: 'UserGroupLeader',
          createdAt: '2024-02-15T00:00:00.000Z',
          consumedForQuarter: '2023-Q4',
        },
      ],
    };
    const client = createMockDynamoClient([page1, page2]);

    const result = await queryQuarterQualifyingRecords(client, 'PointsRecords', quarterStart, quarterEnd);

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0].recordId).toBe('r1');
    expect(result[1]).toEqual({
      recordId: 'r2',
      userId: 'u2',
      targetRole: 'UserGroupLeader',
      activityDate: undefined,
      createdAt: '2024-02-15T00:00:00.000Z',
      consumedForQuarter: '2023-Q4',
    });

    const secondCallInput = client.send.mock.calls[1][0].input;
    expect(secondCallInput.ExclusiveStartKey).toEqual({ recordId: 'r1' });

    // Verify widened-range query shape (no activityDate FilterExpression component)
    const firstCallInput = client.send.mock.calls[0][0].input;
    expect(firstCallInput.TableName).toBe('PointsRecords');
    expect(firstCallInput.IndexName).toBe('type-createdAt-index');
    expect(firstCallInput.KeyConditionExpression).toBe('#type = :type AND createdAt BETWEEN :start AND :end');
    expect(firstCallInput.FilterExpression).toBe('targetRole = :ugl');
    expect(firstCallInput.ExpressionAttributeValues[':type']).toBe('earn');
    expect(firstCallInput.ExpressionAttributeValues[':ugl']).toBe('UserGroupLeader');

    // The widened range should extend before quarterStart and after quarterEnd
    expect(new Date(firstCallInput.ExpressionAttributeValues[':start']).getTime()).toBeLessThan(
      new Date(quarterStart).getTime(),
    );
    expect(new Date(firstCallInput.ExpressionAttributeValues[':end']).getTime()).toBeGreaterThan(
      new Date(quarterEnd).getTime(),
    );
  });

  it('should return an empty array when no items exist', async () => {
    const client = createMockDynamoClient([{ Items: [] }]);
    const result = await queryQuarterQualifyingRecords(client, 'PointsRecords', quarterStart, quarterEnd);
    expect(result).toEqual([]);
  });
});
