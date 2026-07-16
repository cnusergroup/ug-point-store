import { describe, it, expect, vi } from 'vitest';
import {
  queryAllUGLUsersForExit,
  queryQuarterQualifyingRecords,
  extractActiveUserIdsForQuarter,
  computeFullyInactiveUGLs,
  type ExitQualifyingRecord,
  type ExitEligibleUser,
} from './eligibility';

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

/**
 * Type-aware mock: dispatches each QueryCommand to a per-type list of pages based on the
 * `:type` ExpressionAttributeValue, so it is robust to the parallel (Promise.all) earn/adjust
 * pagination in queryQuarterQualifyingRecords regardless of microtask interleaving.
 */
function createTypeAwareMockClient(pagesByType: { earn?: any[]; adjust?: any[] }) {
  const cursors: Record<string, number> = { earn: 0, adjust: 0 };
  const send = vi.fn().mockImplementation((command: any) => {
    const type = command.input.ExpressionAttributeValues[':type'] as 'earn' | 'adjust';
    const pages = pagesByType[type] ?? [{ Items: [] }];
    const idx = cursors[type];
    cursors[type] = idx + 1;
    return Promise.resolve(pages[idx] ?? { Items: [] });
  });
  return { send } as any;
}

describe('queryQuarterQualifyingRecords', () => {
  const quarterStart = '2024-01-01T00:00:00.000Z';
  const quarterEnd = '2024-03-31T23:59:59.999Z';

  it('should query both earn and adjust types, paginate each, and merge results', async () => {
    const client = createTypeAwareMockClient({
      earn: [
        {
          Items: [
            {
              recordId: 'r1',
              userId: 'u1',
              targetRole: 'UserGroupLeader',
              activityDate: '2024-02-01',
              createdAt: '2024-02-01T00:00:00.000Z',
              amount: 50,
            },
          ],
          LastEvaluatedKey: { recordId: 'r1' },
        },
        {
          Items: [
            {
              recordId: 'r2',
              userId: 'u2',
              targetRole: 'UserGroupLeader',
              createdAt: '2024-02-15T00:00:00.000Z',
              consumedForQuarter: '2023-Q4',
              amount: 50,
            },
          ],
        },
      ],
      adjust: [
        {
          Items: [
            {
              recordId: 'a1',
              userId: 'u1',
              targetRole: 'UserGroupLeader',
              activityDate: '2024-02-01',
              createdAt: '2024-03-01T00:00:00.000Z',
              amount: -50,
            },
          ],
        },
      ],
    });

    const result = await queryQuarterQualifyingRecords(client, 'PointsRecords', quarterStart, quarterEnd);

    // 2 earn pages + 1 adjust page = 3 send calls
    expect(client.send).toHaveBeenCalledTimes(3);
    // 2 earn records + 1 adjust record
    expect(result).toHaveLength(3);

    const r1 = result.find((r) => r.recordId === 'r1')!;
    expect(r1.amount).toBe(50);
    const a1 = result.find((r) => r.recordId === 'a1')!;
    expect(a1).toEqual({
      recordId: 'a1',
      userId: 'u1',
      targetRole: 'UserGroupLeader',
      activityDate: '2024-02-01',
      createdAt: '2024-03-01T00:00:00.000Z',
      consumedForQuarter: undefined,
      amount: -50,
    });

    // Verify both a :type='earn' and a :type='adjust' query were issued with the correct shape.
    const types = client.send.mock.calls.map((c: any[]) => c[0].input.ExpressionAttributeValues[':type']);
    expect(types).toContain('earn');
    expect(types).toContain('adjust');

    const anyCall = client.send.mock.calls[0][0].input;
    expect(anyCall.TableName).toBe('PointsRecords');
    expect(anyCall.IndexName).toBe('type-createdAt-index');
    expect(anyCall.KeyConditionExpression).toBe('#type = :type AND createdAt BETWEEN :start AND :end');
    expect(anyCall.FilterExpression).toBe('targetRole = :ugl');
    expect(anyCall.ExpressionAttributeValues[':ugl']).toBe('UserGroupLeader');
    expect(anyCall.ProjectionExpression).toContain('amount');
    // Widened range extends before quarterStart and after quarterEnd
    expect(new Date(anyCall.ExpressionAttributeValues[':start']).getTime()).toBeLessThan(
      new Date(quarterStart).getTime(),
    );
    expect(new Date(anyCall.ExpressionAttributeValues[':end']).getTime()).toBeGreaterThan(
      new Date(quarterEnd).getTime(),
    );
  });

  it('should return an empty array when no items exist for either type', async () => {
    const client = createTypeAwareMockClient({ earn: [{ Items: [] }], adjust: [{ Items: [] }] });
    const result = await queryQuarterQualifyingRecords(client, 'PointsRecords', quarterStart, quarterEnd);
    expect(result).toEqual([]);
  });
});

describe('extractActiveUserIdsForQuarter (net-sum semantics)', () => {
  const quarterStart = '2024-01-01T00:00:00.000Z';
  const quarterEnd = '2024-03-31T23:59:59.999Z';

  function rec(overrides: Partial<ExitQualifyingRecord>): ExitQualifyingRecord {
    return {
      recordId: 'r',
      userId: 'u',
      targetRole: 'UserGroupLeader',
      activityDate: '2024-02-01',
      createdAt: '2024-02-01T00:00:00.000Z',
      amount: 50,
      ...overrides,
    };
  }

  it('treats a UGL as active when net qualifying points > 0', () => {
    const active = extractActiveUserIdsForQuarter([rec({ userId: 'u1', amount: 50 })], quarterStart, quarterEnd);
    expect(active.has('u1')).toBe(true);
  });

  it('treats a UGL as INACTIVE when the only activity was fully reversed (earn +50, adjust -50, net 0)', () => {
    const records = [
      rec({ recordId: 'e1', userId: 'u1', amount: 50 }),
      rec({ recordId: 'a1', userId: 'u1', amount: -50, createdAt: '2024-03-10T00:00:00.000Z' }),
    ];
    const active = extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd);
    expect(active.has('u1')).toBe(false);
  });

  it('keeps a UGL active on a partial downward correction that leaves a positive net (+50 then -20 = 30)', () => {
    const records = [
      rec({ recordId: 'e1', userId: 'u1', amount: 50 }),
      rec({ recordId: 'a1', userId: 'u1', amount: -20, createdAt: '2024-03-10T00:00:00.000Z' }),
    ];
    const active = extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd);
    expect(active.has('u1')).toBe(true);
  });

  it('treats a UGL as inactive when a net-negative correction overshoots (net < 0)', () => {
    const records = [
      rec({ recordId: 'e1', userId: 'u1', amount: 50 }),
      rec({ recordId: 'a1', userId: 'u1', amount: -60, createdAt: '2024-03-10T00:00:00.000Z' }),
    ];
    const active = extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd);
    expect(active.has('u1')).toBe(false);
  });

  it('ignores non-UGL, consumed, and out-of-window records when summing', () => {
    const records = [
      rec({ recordId: 'x1', userId: 'u1', targetRole: 'Speaker', amount: 100 }),
      rec({ recordId: 'x2', userId: 'u1', consumedForQuarter: '2023-Q4', amount: 100 }),
      rec({ recordId: 'x3', userId: 'u1', activityDate: '2023-12-31', amount: 100 }),
    ];
    const active = extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd);
    expect(active.has('u1')).toBe(false);
  });

  it('computeFullyInactiveUGLs flags a fully-reversed UGL as inactive end-to-end', () => {
    const eligible: ExitEligibleUser[] = [
      { userId: 'u1', nickname: 'A', email: 'a@t.com', roles: ['UserGroupLeader'], status: 'active', createdAt: '2023-01-01T00:00:00.000Z' },
      { userId: 'u2', nickname: 'B', email: 'b@t.com', roles: ['UserGroupLeader'], status: 'active', createdAt: '2023-01-01T00:00:00.000Z' },
    ];
    const records = [
      // u1: reversed to net 0 -> inactive
      rec({ recordId: 'e1', userId: 'u1', amount: 50 }),
      rec({ recordId: 'a1', userId: 'u1', amount: -50, createdAt: '2024-03-10T00:00:00.000Z' }),
      // u2: genuine activity -> active
      rec({ recordId: 'e2', userId: 'u2', amount: 50 }),
    ];
    const activeIds = extractActiveUserIdsForQuarter(records, quarterStart, quarterEnd);
    const inactive = computeFullyInactiveUGLs(eligible, activeIds);
    expect(inactive.map((u) => u.userId)).toEqual(['u1']);
  });
});
