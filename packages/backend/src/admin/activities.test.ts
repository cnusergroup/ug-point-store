import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listActivities, getActivity } from './activities';

// ============================================================
// Helpers
// ============================================================

const ACTIVITIES_TABLE = 'Activities';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeActivity(overrides: Record<string, any> = {}) {
  return {
    activityId: 'act-001',
    pk: 'ALL',
    activityType: '线上活动',
    ugName: 'Tokyo UG',
    topic: 'AWS re:Invent 2024 回顾',
    activityDate: '2024-12-01',
    syncedAt: '2024-12-02T00:00:00Z',
    sourceUrl: 'https://feishu.cn/table/xxx',
    ...overrides,
  };
}

// ============================================================
// 1. listActivities — basic query
// ============================================================

describe('listActivities', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return activities without any filters', async () => {
    const items = [
      makeActivity({ activityId: 'act-001', activityDate: '2024-12-01' }),
      makeActivity({ activityId: 'act-002', activityDate: '2024-11-15' }),
    ];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await listActivities({}, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(2);

    // Verify QueryCommand on activityDate-index GSI
    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.constructor.name).toBe('QueryCommand');
    expect(queryCmd.input.IndexName).toBe('activityDate-index');
    expect(queryCmd.input.ScanIndexForward).toBe(false);
    expect(queryCmd.input.Limit).toBe(20); // default pageSize
  });

  // ============================================================
  // 2. listActivities — ugName filter
  // ============================================================

  it('should filter by ugName', async () => {
    client.send.mockResolvedValueOnce({ Items: [makeActivity({ ugName: 'Tokyo UG' })] });

    const result = await listActivities({ ugName: 'Tokyo UG' }, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(true);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.FilterExpression).toContain('#ugName = :ugName');
    expect(queryCmd.input.ExpressionAttributeValues[':ugName']).toBe('Tokyo UG');
  });

  // ============================================================
  // 3. listActivities — date range filter
  // ============================================================

  it('should filter by startDate and endDate', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities(
      { startDate: '2024-01-01', endDate: '2024-12-31' },
      client,
      ACTIVITIES_TABLE,
    );

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.KeyConditionExpression).toContain('BETWEEN');
    expect(queryCmd.input.ExpressionAttributeValues[':startDate']).toBe('2024-01-01');
    expect(queryCmd.input.ExpressionAttributeValues[':endDate']).toBe('2024-12-31');
  });

  it('should filter by startDate only', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ startDate: '2024-06-01' }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.KeyConditionExpression).toContain('>= :startDate');
  });

  it('should filter by endDate only', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ endDate: '2024-12-31' }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.KeyConditionExpression).toContain('<= :endDate');
  });

  // ============================================================
  // 4. listActivities — keyword search
  // ============================================================

  it('should filter by keyword (contains on topic)', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ keyword: 'AWS' }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.FilterExpression).toContain('contains(#topic, :keyword)');
    expect(queryCmd.input.ExpressionAttributeValues[':keyword']).toBe('AWS');
  });

  // ============================================================
  // 5. listActivities — combined filters
  // ============================================================

  it('should combine ugName and keyword filters', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ ugName: 'Tokyo UG', keyword: 'AWS' }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.FilterExpression).toContain('#ugName = :ugName');
    expect(queryCmd.input.FilterExpression).toContain('contains(#topic, :keyword)');
    expect(queryCmd.input.FilterExpression).toContain(' AND ');
  });

  // ============================================================
  // 6. listActivities — pageSize clamping
  // ============================================================

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({}, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(20);
  });

  it('should clamp pageSize to minimum 1', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ pageSize: 0 }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(1);
  });

  it('should clamp pageSize to maximum 100', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ pageSize: 200 }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(100);
  });

  it('should accept pageSize within range', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ pageSize: 50 }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.Limit).toBe(50);
  });

  // ============================================================
  // 7. listActivities — pagination (lastKey)
  // ============================================================

  it('should decode base64 lastKey and pass as ExclusiveStartKey', async () => {
    const lastKeyObj = { activityId: 'act-005', pk: 'ALL', activityDate: '2024-06-01' };
    const encodedKey = Buffer.from(JSON.stringify(lastKeyObj)).toString('base64');

    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({ lastKey: encodedKey }, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.ExclusiveStartKey).toEqual(lastKeyObj);
  });

  it('should return encoded lastKey when DynamoDB returns LastEvaluatedKey', async () => {
    const lastEvaluatedKey = { activityId: 'act-010', pk: 'ALL', activityDate: '2024-03-01' };
    client.send.mockResolvedValueOnce({
      Items: [makeActivity()],
      LastEvaluatedKey: lastEvaluatedKey,
    });

    const result = await listActivities({}, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();

    // Decode and verify
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvaluatedKey);
  });

  it('should not return lastKey when no more pages', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeActivity()],
      // No LastEvaluatedKey
    });

    const result = await listActivities({}, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return error for invalid lastKey', async () => {
    const result = await listActivities({ lastKey: 'not-valid-base64!!!' }, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  // ============================================================
  // 8. listActivities — descending order
  // ============================================================

  it('should query with ScanIndexForward=false for descending date order', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listActivities({}, client, ACTIVITIES_TABLE);

    const queryCmd = client.send.mock.calls[0][0];
    expect(queryCmd.input.ScanIndexForward).toBe(false);
  });

  // ============================================================
  // 9. listActivities — error handling
  // ============================================================

  it('should return INTERNAL_ERROR on DynamoDB failure', async () => {
    client.send.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await listActivities({}, client, ACTIVITIES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ============================================================
// getActivity
// ============================================================

describe('getActivity', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return activity when it exists', async () => {
    const activity = makeActivity();
    client.send.mockResolvedValueOnce({ Item: activity });

    const result = await getActivity('act-001', client, ACTIVITIES_TABLE);

    expect(result.success).toBe(true);
    expect(result.activity).toEqual(activity);

    // Verify GetCommand
    const getCmd = client.send.mock.calls[0][0];
    expect(getCmd.constructor.name).toBe('GetCommand');
    expect(getCmd.input.Key).toEqual({ activityId: 'act-001' });
  });

  it('should return ACTIVITY_NOT_FOUND when activity does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getActivity('nonexistent', client, ACTIVITIES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ACTIVITY_NOT_FOUND');
  });

  it('should return INTERNAL_ERROR on DynamoDB failure', async () => {
    client.send.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await getActivity('act-001', client, ACTIVITIES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});
