import { describe, it, expect } from 'vitest';
import {
  clampPageSize,
  applyDefaultDateRange,
  filterPointsRecords,
  sortRecords,
  aggregateByUG,
  aggregateByUser,
  aggregateByActivity,
  type RawPointsRecord,
} from './query';

// ============================================================
// clampPageSize
// ============================================================

describe('clampPageSize', () => {
  it('returns default 20 when undefined', () => {
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('returns custom default when provided', () => {
    expect(clampPageSize(undefined, 50)).toBe(50);
  });

  it('clamps to 1 when value is 0 or negative', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
  });

  it('clamps to 100 when value exceeds 100', () => {
    expect(clampPageSize(200)).toBe(100);
    expect(clampPageSize(101)).toBe(100);
  });

  it('floors fractional values', () => {
    expect(clampPageSize(10.9)).toBe(10);
  });

  it('returns value as-is when in range', () => {
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(1)).toBe(1);
    expect(clampPageSize(100)).toBe(100);
  });
});

// ============================================================
// applyDefaultDateRange
// ============================================================

describe('applyDefaultDateRange', () => {
  it('returns provided dates when both are given', () => {
    const result = applyDefaultDateRange('2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(result.startDate).toBe('2024-01-01T00:00:00Z');
    expect(result.endDate).toBe('2024-01-31T23:59:59Z');
  });

  it('defaults to 30 days ago when no startDate', () => {
    const before = Date.now();
    const result = applyDefaultDateRange(undefined, undefined);
    const after = Date.now();

    const start = new Date(result.startDate).getTime();
    const end = new Date(result.endDate).getTime();

    // endDate should be close to now
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(after + 1000);

    // startDate should be ~30 days before endDate
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(end - start).toBeGreaterThanOrEqual(thirtyDaysMs - 1000);
    expect(end - start).toBeLessThanOrEqual(thirtyDaysMs + 1000);
  });

  it('uses provided endDate when startDate is missing', () => {
    const result = applyDefaultDateRange(undefined, '2024-06-15T00:00:00Z');
    expect(result.endDate).toBe('2024-06-15T00:00:00Z');
    // startDate should be 30 days before now (not before endDate)
    expect(new Date(result.startDate).getTime()).toBeLessThan(Date.now());
  });
});

// ============================================================
// filterPointsRecords
// ============================================================

function makeRecord(overrides: Partial<RawPointsRecord> = {}): RawPointsRecord {
  return {
    recordId: 'r1',
    userId: 'u1',
    type: 'earn',
    amount: 100,
    source: 'test',
    balanceAfter: 100,
    createdAt: '2024-06-15T10:00:00Z',
    activityId: 'a1',
    activityUG: 'UG-Beijing',
    activityTopic: 'Topic A',
    activityDate: '2024-06-15',
    targetRole: 'Speaker',
    ...overrides,
  };
}

describe('filterPointsRecords', () => {
  const records: RawPointsRecord[] = [
    makeRecord({ recordId: 'r1', type: 'earn', activityUG: 'UG-Beijing', targetRole: 'Speaker', createdAt: '2024-06-10T00:00:00Z' }),
    makeRecord({ recordId: 'r2', type: 'spend', activityUG: 'UG-Shanghai', targetRole: 'Volunteer', createdAt: '2024-06-15T00:00:00Z' }),
    makeRecord({ recordId: 'r3', type: 'earn', activityUG: 'UG-Beijing', targetRole: 'UserGroupLeader', createdAt: '2024-06-20T00:00:00Z', activityId: 'a2' }),
  ];

  it('returns all records when no filters', () => {
    expect(filterPointsRecords(records, {})).toHaveLength(3);
  });

  it('filters by type', () => {
    const result = filterPointsRecords(records, { type: 'earn' });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'earn')).toBe(true);
  });

  it('filters by ugName', () => {
    const result = filterPointsRecords(records, { ugName: 'UG-Beijing' });
    expect(result).toHaveLength(2);
  });

  it('filters by targetRole', () => {
    const result = filterPointsRecords(records, { targetRole: 'Speaker' });
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r1');
  });

  it('filters by date range', () => {
    const result = filterPointsRecords(records, {
      startDate: '2024-06-12T00:00:00Z',
      endDate: '2024-06-18T00:00:00Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r2');
  });

  it('filters by activityId', () => {
    const result = filterPointsRecords(records, { activityId: 'a2' });
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r3');
  });

  it('applies multiple filters simultaneously', () => {
    const result = filterPointsRecords(records, { type: 'earn', ugName: 'UG-Beijing' });
    expect(result).toHaveLength(2);
  });

  it('type=all does not filter by type', () => {
    const result = filterPointsRecords(records, { type: 'all' });
    expect(result).toHaveLength(3);
  });

  it('targetRole=all does not filter by role', () => {
    const result = filterPointsRecords(records, { targetRole: 'all' });
    expect(result).toHaveLength(3);
  });
});

// ============================================================
// sortRecords
// ============================================================

describe('sortRecords', () => {
  it('sorts by createdAt descending', () => {
    const records = [
      { createdAt: '2024-06-10T00:00:00Z', id: 'a' },
      { createdAt: '2024-06-20T00:00:00Z', id: 'b' },
      { createdAt: '2024-06-15T00:00:00Z', id: 'c' },
    ];
    const sorted = sortRecords(records, 'createdAt', 'desc');
    expect(sorted.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by numeric field descending', () => {
    const records = [
      { totalPoints: 100, id: 'a' },
      { totalPoints: 300, id: 'b' },
      { totalPoints: 200, id: 'c' },
    ];
    const sorted = sortRecords(records, 'totalPoints', 'desc');
    expect(sorted.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate original array', () => {
    const records = [{ val: 2 }, { val: 1 }, { val: 3 }];
    const sorted = sortRecords(records, 'val', 'asc');
    expect(sorted.map(r => r.val)).toEqual([1, 2, 3]);
    expect(records.map(r => r.val)).toEqual([2, 1, 3]);
  });
});

// ============================================================
// aggregateByUG
// ============================================================

describe('aggregateByUG', () => {
  it('aggregates by activityUG correctly', () => {
    const records: RawPointsRecord[] = [
      makeRecord({ userId: 'u1', activityUG: 'UG-A', activityId: 'a1', amount: 100 }),
      makeRecord({ userId: 'u2', activityUG: 'UG-A', activityId: 'a1', amount: 50 }),
      makeRecord({ userId: 'u1', activityUG: 'UG-A', activityId: 'a2', amount: 200 }),
      makeRecord({ userId: 'u3', activityUG: 'UG-B', activityId: 'a3', amount: 300 }),
    ];

    const result = aggregateByUG(records);
    expect(result).toHaveLength(2);

    const ugA = result.find(r => r.ugName === 'UG-A')!;
    expect(ugA.activityCount).toBe(2); // a1, a2
    expect(ugA.totalPoints).toBe(350); // 100 + 50 + 200
    expect(ugA.participantCount).toBe(2); // u1, u2

    const ugB = result.find(r => r.ugName === 'UG-B')!;
    expect(ugB.activityCount).toBe(1);
    expect(ugB.totalPoints).toBe(300);
    expect(ugB.participantCount).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateByUG([])).toEqual([]);
  });
});

// ============================================================
// aggregateByUser
// ============================================================

describe('aggregateByUser', () => {
  it('aggregates by userId correctly', () => {
    const records: RawPointsRecord[] = [
      makeRecord({ userId: 'u1', amount: 100, targetRole: 'Speaker' }),
      makeRecord({ userId: 'u1', amount: 200, targetRole: 'Speaker' }),
      makeRecord({ userId: 'u2', amount: 50, targetRole: 'Volunteer' }),
    ];

    const result = aggregateByUser(records);
    expect(result).toHaveLength(2);

    const u1 = result.find(r => r.userId === 'u1')!;
    expect(u1.totalEarnPoints).toBe(300);
    expect(u1.targetRole).toBe('Speaker');

    const u2 = result.find(r => r.userId === 'u2')!;
    expect(u2.totalEarnPoints).toBe(50);
    expect(u2.targetRole).toBe('Volunteer');
  });

  it('returns empty array for empty input', () => {
    expect(aggregateByUser([])).toEqual([]);
  });
});

// ============================================================
// aggregateByActivity
// ============================================================

describe('aggregateByActivity', () => {
  it('aggregates by activityId with role-specific counts', () => {
    const records: RawPointsRecord[] = [
      makeRecord({ userId: 'u1', activityId: 'a1', amount: 100, targetRole: 'Speaker', activityTopic: 'Topic A', activityDate: '2024-06-15', activityUG: 'UG-A' }),
      makeRecord({ userId: 'u2', activityId: 'a1', amount: 50, targetRole: 'Volunteer', activityTopic: 'Topic A', activityDate: '2024-06-15', activityUG: 'UG-A' }),
      makeRecord({ userId: 'u3', activityId: 'a1', amount: 200, targetRole: 'UserGroupLeader', activityTopic: 'Topic A', activityDate: '2024-06-15', activityUG: 'UG-A' }),
      makeRecord({ userId: 'u1', activityId: 'a2', amount: 150, targetRole: 'Speaker', activityTopic: 'Topic B', activityDate: '2024-06-20', activityUG: 'UG-B' }),
    ];

    const result = aggregateByActivity(records);
    expect(result).toHaveLength(2);

    const a1 = result.find(r => r.activityId === 'a1')!;
    expect(a1.totalPoints).toBe(350);
    expect(a1.participantCount).toBe(3);
    expect(a1.uglCount).toBe(1);
    expect(a1.speakerCount).toBe(1);
    expect(a1.volunteerCount).toBe(1);
    expect(a1.activityTopic).toBe('Topic A');
    expect(a1.activityDate).toBe('2024-06-15');
    expect(a1.activityUG).toBe('UG-A');

    const a2 = result.find(r => r.activityId === 'a2')!;
    expect(a2.totalPoints).toBe(150);
    expect(a2.participantCount).toBe(1);
    expect(a2.speakerCount).toBe(1);
    expect(a2.uglCount).toBe(0);
    expect(a2.volunteerCount).toBe(0);
  });

  it('counts distinct users per role', () => {
    const records: RawPointsRecord[] = [
      makeRecord({ userId: 'u1', activityId: 'a1', amount: 100, targetRole: 'Speaker' }),
      makeRecord({ userId: 'u1', activityId: 'a1', amount: 50, targetRole: 'Speaker' }), // same user, same role
    ];

    const result = aggregateByActivity(records);
    const a1 = result.find(r => r.activityId === 'a1')!;
    expect(a1.participantCount).toBe(1); // distinct userId
    expect(a1.speakerCount).toBe(1); // distinct userId per role
    expect(a1.totalPoints).toBe(150);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateByActivity([])).toEqual([]);
  });
});
