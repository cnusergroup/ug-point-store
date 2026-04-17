import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listReservationActivities } from './reservation-activities';
import type { ActivityRecord, UGRecord } from '@points-mall/shared';

// ── Mock DynamoDB client ───────────────────────────────────

const mockSend = vi.fn();
const mockDynamoClient = { send: mockSend } as any;

const TABLES = {
  activitiesTable: 'Activities',
  ugsTable: 'UGs',
};

// ── Helpers ────────────────────────────────────────────────

function makeUG(name: string, status: 'active' | 'inactive' = 'active', leaderId?: string): UGRecord {
  return {
    ugId: `ug-${name}`,
    name,
    status,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...(leaderId ? { leaderId, leaderNickname: `Leader-${leaderId}` } : {}),
  };
}

function makeActivity(id: string, ugName: string, date: string): ActivityRecord {
  return {
    activityId: id,
    activityType: '线上活动',
    ugName,
    topic: `Topic for ${id}`,
    activityDate: date,
    syncedAt: '2024-01-01T00:00:00.000Z',
    sourceUrl: `https://example.com/${id}`,
  };
}

describe('listReservationActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns activities filtered by active UGs', async () => {
    // First call: query UGs (active)
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A'), makeUG('UG-B')],
    });
    // Second call: query Activities
    mockSend.mockResolvedValueOnce({
      Items: [
        makeActivity('act-1', 'UG-A', '2024-06-15'),
        makeActivity('act-2', 'UG-C', '2024-06-14'), // UG-C is not active
        makeActivity('act-3', 'UG-B', '2024-06-13'),
      ],
    });

    const result = await listReservationActivities({}, mockDynamoClient, TABLES);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(2);
    expect(result.activities[0].activityId).toBe('act-1');
    expect(result.activities[1].activityId).toBe('act-3');
    // UG-C activity should be filtered out
    expect(result.activities.every((a) => a.ugName !== 'UG-C')).toBe(true);
  });

  it('returns activities sorted by activityDate descending', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A')],
    });
    // Activities returned in descending order from DynamoDB (ScanIndexForward=false)
    mockSend.mockResolvedValueOnce({
      Items: [
        makeActivity('act-3', 'UG-A', '2024-06-20'),
        makeActivity('act-1', 'UG-A', '2024-06-15'),
        makeActivity('act-2', 'UG-A', '2024-06-10'),
      ],
    });

    const result = await listReservationActivities({}, mockDynamoClient, TABLES);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(3);
    // Verify descending order is preserved
    expect(result.activities[0].activityDate).toBe('2024-06-20');
    expect(result.activities[1].activityDate).toBe('2024-06-15');
    expect(result.activities[2].activityDate).toBe('2024-06-10');
  });

  it('supports pagination with pageSize', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A')],
    });
    // Return more items than pageSize with a LastEvaluatedKey
    mockSend.mockResolvedValueOnce({
      Items: [
        makeActivity('act-1', 'UG-A', '2024-06-20'),
        makeActivity('act-2', 'UG-A', '2024-06-19'),
        makeActivity('act-3', 'UG-A', '2024-06-18'),
      ],
      LastEvaluatedKey: { pk: 'ALL', activityDate: '2024-06-18', activityId: 'act-3' },
    });

    const result = await listReservationActivities({ pageSize: 2 }, mockDynamoClient, TABLES);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(2);
    expect(result.activities[0].activityId).toBe('act-1');
    expect(result.activities[1].activityId).toBe('act-2');
    // Should have a lastKey for pagination
    expect(result.lastKey).toBeDefined();
  });

  it('returns empty array when no active UGs exist', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [], // no active UGs
    });

    const result = await listReservationActivities({}, mockDynamoClient, TABLES);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(0);
    // Should not query activities table at all
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no activities match active UGs', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A')],
    });
    mockSend.mockResolvedValueOnce({
      Items: [
        makeActivity('act-1', 'UG-B', '2024-06-15'), // UG-B not active
        makeActivity('act-2', 'UG-C', '2024-06-14'), // UG-C not active
      ],
    });

    const result = await listReservationActivities({}, mockDynamoClient, TABLES);

    expect(result.success).toBe(true);
    expect(result.activities).toHaveLength(0);
  });

  it('uses default pageSize of 50', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A')],
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
    });

    await listReservationActivities({}, mockDynamoClient, TABLES);

    // The second call should use a Limit of 150 (pageSize * 3 = 50 * 3)
    const activityQueryCall = mockSend.mock.calls[1][0];
    expect(activityQueryCall.input.Limit).toBe(150);
  });

  it('clamps pageSize to valid range', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeUG('UG-A')],
    });
    mockSend.mockResolvedValueOnce({
      Items: [],
    });

    await listReservationActivities({ pageSize: 200 }, mockDynamoClient, TABLES);

    // pageSize clamped to 100, so Limit = 100 * 3 = 300
    const activityQueryCall = mockSend.mock.calls[1][0];
    expect(activityQueryCall.input.Limit).toBe(300);
  });

  it('handles DynamoDB errors gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await listReservationActivities({}, mockDynamoClient, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});
