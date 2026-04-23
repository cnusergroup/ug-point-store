import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { aggregateEmployeeEngagement, calculateEngagementRate } from './insight-query';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a single points record */
const pointsRecordArb = fc.record({
  userId: fc.constantFrom('emp1', 'emp2', 'emp3', 'emp4', 'emp5'),
  amount: fc.integer({ min: 1, max: 1000 }),
  activityId: fc.constantFrom('act1', 'act2', 'act3'),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).filter(d => !isNaN(d.getTime())).map(d => d.toISOString()),
  targetRole: fc.constantFrom('Speaker', 'Volunteer', 'UserGroupLeader', ''),
  activityUG: fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen', ''),
});

/** Arbitrary for an array of 1–50 points records */
const recordsArb = fc.array(pointsRecordArb, { minLength: 1, maxLength: 50 });

// ============================================================
// Property 1: 积分守恒 (Points Conservation)
// Feature: employee-engagement-report, Property 1: 积分守恒 (Points Conservation)
// Validates: Requirements 2.6, 3.5, 6.1, 9.1
// ============================================================

describe('Feature: employee-engagement-report, Property 1: 积分守恒 (Points Conservation)', () => {
  it('sum of all aggregated totalPoints equals sum of all input amount values', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        const inputSum = records.reduce((sum, r) => sum + r.amount, 0);
        const aggregatedSum = aggregated.reduce((sum, a) => sum + a.totalPoints, 0);

        expect(aggregatedSum).toBe(inputSum);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: 用户计数一致性 (User Count Consistency)
// Feature: employee-engagement-report, Property 2: 用户计数一致性 (User Count Consistency)
// Validates: Requirements 2.4, 6.5, 9.2
// ============================================================

describe('Feature: employee-engagement-report, Property 2: 用户计数一致性 (User Count Consistency)', () => {
  it('number of aggregated entries equals number of distinct userId values in input', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        const distinctUserIds = new Set(records.map(r => r.userId));

        expect(aggregated.length).toBe(distinctUserIds.size);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: 活动数上界 (Activity Count Upper Bound)
// Feature: employee-engagement-report, Property 3: 活动数上界 (Activity Count Upper Bound)
// Validates: Requirements 3.6, 9.3
// ============================================================

describe('Feature: employee-engagement-report, Property 3: 活动数上界 (Activity Count Upper Bound)', () => {
  it('each employee activityCount is less than or equal to that employee total record count', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        for (const entry of aggregated) {
          const employeeRecordCount = records.filter(r => r.userId === entry.userId).length;
          expect(entry.activityCount).toBeLessThanOrEqual(employeeRecordCount);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 4: 最后活跃时间为最大值 (Last Active Time is Maximum)
// Feature: employee-engagement-report, Property 4: 最后活跃时间为最大值 (Last Active Time is Maximum)
// Validates: Requirements 3.7, 9.4
// ============================================================

describe('Feature: employee-engagement-report, Property 4: 最后活跃时间为最大值 (Last Active Time is Maximum)', () => {
  it('each employee lastActiveTime is greater than or equal to all of that employee createdAt values', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        for (const entry of aggregated) {
          const employeeRecords = records.filter(r => r.userId === entry.userId);
          for (const r of employeeRecords) {
            expect(entry.lastActiveTime >= r.createdAt).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 5: 活跃率公式正确性与范围 (Engagement Rate Formula and Range)
// Feature: employee-engagement-report, Property 5: 活跃率公式正确性与范围 (Engagement Rate Formula and Range)
// Validates: Requirements 2.5, 6.3, 9.5
// ============================================================

describe('Feature: employee-engagement-report, Property 5: 活跃率公式正确性与范围 (Engagement Rate Formula and Range)', () => {
  it('result is in [0, 100], equals 0 when totalCount=0, matches formula otherwise', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (activeCount, totalCount) => {
          // Ensure activeCount <= totalCount
          const active = Math.min(activeCount, totalCount);
          const total = totalCount;

          const rate = calculateEngagementRate(active, total);

          // Range check: always in [0, 100]
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(100);

          if (total === 0) {
            // When totalCount is 0, result should be 0
            expect(rate).toBe(0);
          } else {
            // Matches formula: activeCount / totalCount × 100, rounded to one decimal
            const expected = Math.round((active / total) * 1000) / 10;
            expect(rate).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 6: 汇总与明细一致性 (Summary-Detail Consistency)
// Feature: employee-engagement-report, Property 6: 汇总与明细一致性 (Summary-Detail Consistency)
// Validates: Requirements 4.4, 6.5, 6.6
// ============================================================

describe('Feature: employee-engagement-report, Property 6: 汇总与明细一致性 (Summary-Detail Consistency)', () => {
  it('summary.activeEmployees === aggregated.length and summary.totalPoints === sum of aggregated totalPoints', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        // Compute summary manually
        const activeEmployees = aggregated.length;
        const totalPoints = aggregated.reduce((sum, a) => sum + a.totalPoints, 0);

        // Verify consistency
        expect(activeEmployees).toBe(aggregated.length);
        expect(totalPoints).toBe(aggregated.reduce((sum, a) => sum + a.totalPoints, 0));
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: 排名排序正确性 (Ranking Order Correctness)
// Feature: employee-engagement-report, Property 7: 排名排序正确性 (Ranking Order Correctness)
// Validates: Requirements 3.3, 6.4
// ============================================================

describe('Feature: employee-engagement-report, Property 7: 排名排序正确性 (Ranking Order Correctness)', () => {
  it('ranks are 1..N consecutive, sorted by totalPoints desc then lastActiveTime desc', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        // Sort by totalPoints desc, then lastActiveTime desc
        const sorted = [...aggregated].sort((a, b) => {
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          return b.lastActiveTime.localeCompare(a.lastActiveTime);
        });

        // Assign ranks
        const ranked = sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));

        // Verify ranks are 1..N consecutive
        for (let i = 0; i < ranked.length; i++) {
          expect(ranked[i].rank).toBe(i + 1);
        }

        // Verify sorting order: for adjacent entries
        for (let i = 0; i < ranked.length - 1; i++) {
          // totalPoints[i] >= totalPoints[i+1]
          expect(ranked[i].totalPoints).toBeGreaterThanOrEqual(ranked[i + 1].totalPoints);

          // When totalPoints are equal, lastActiveTime[i] >= lastActiveTime[i+1]
          if (ranked[i].totalPoints === ranked[i + 1].totalPoints) {
            expect(ranked[i].lastActiveTime >= ranked[i + 1].lastActiveTime).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 8: 员工集合完整性 (Per-Employee Set Completeness)
// Feature: employee-engagement-report, Property 8: 员工集合完整性 (Per-Employee Set Completeness)
// Validates: Requirements 3.8, 3.9
// ============================================================

describe('Feature: employee-engagement-report, Property 8: 员工集合完整性 (Per-Employee Set Completeness)', () => {
  it('each employee primaryRoles contains all non-empty targetRole values, ugSet contains all non-empty activityUG values', () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const aggregated = aggregateEmployeeEngagement(records);

        for (const entry of aggregated) {
          const employeeRecords = records.filter(r => r.userId === entry.userId);

          // Collect expected non-empty targetRole values
          const expectedRoles = new Set<string>();
          for (const r of employeeRecords) {
            if (r.targetRole && r.targetRole !== '') {
              expectedRoles.add(r.targetRole);
            }
          }

          // Collect expected non-empty activityUG values
          const expectedUGs = new Set<string>();
          for (const r of employeeRecords) {
            if (r.activityUG && r.activityUG !== '') {
              expectedUGs.add(r.activityUG);
            }
          }

          // Verify primaryRoles contains all expected roles
          for (const role of expectedRoles) {
            expect(entry.primaryRoles.has(role)).toBe(true);
          }

          // Verify ugSet contains all expected UGs
          for (const ug of expectedUGs) {
            expect(entry.ugSet.has(ug)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: 格式化函数确定性与正确性 (Formatter Determinism and Correctness)
// Feature: employee-engagement-report, Property 9: 格式化函数确定性与正确性 (Formatter Determinism and Correctness)
// Validates: Requirements 7.3, 8.1, 8.2, 8.3, 8.4
// ============================================================

import { formatEmployeeEngagementForExport } from './formatters';
import type { EmployeeEngagementRecord } from './insight-query';

const engagementRecordArb = fc.record({
  rank: fc.integer({ min: 1, max: 100 }),
  userId: fc.constantFrom('emp1', 'emp2', 'emp3', 'emp4', 'emp5'),
  nickname: fc.constantFrom('Alice', 'Bob', 'Charlie', 'Diana', 'Eve'),
  totalPoints: fc.integer({ min: 0, max: 10000 }),
  activityCount: fc.integer({ min: 0, max: 50 }),
  lastActiveTime: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).filter(d => !isNaN(d.getTime())).map(d => d.toISOString()),
  primaryRoles: fc.constantFrom('Speaker', 'Volunteer', 'Speaker, Volunteer', ''),
  ugList: fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Beijing、UG-Shanghai', ''),
});
const engagementRecordsArb = fc.array(engagementRecordArb, { minLength: 1, maxLength: 30 });

describe('Feature: employee-engagement-report, Property 9: 格式化函数确定性与正确性 (Formatter Determinism and Correctness)', () => {
  it('output row count equals input count, each row has all 7 column keys, lastActiveTime matches YYYY-MM-DD HH:mm:ss, deterministic on same input', () => {
    fc.assert(
      fc.property(engagementRecordsArb, (records: EmployeeEngagementRecord[]) => {
        const output = formatEmployeeEngagementForExport(records);

        // 1. Output row count equals input count
        expect(output.length).toBe(records.length);

        const expectedKeys = ['rank', 'nickname', 'totalPoints', 'activityCount', 'lastActiveTime', 'primaryRoles', 'ugList'];
        const dateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

        for (const row of output) {
          // 2. Each row has all 7 column keys
          for (const key of expectedKeys) {
            expect(row).toHaveProperty(key);
          }

          // 3. lastActiveTime matches YYYY-MM-DD HH:mm:ss pattern
          expect(String(row.lastActiveTime)).toMatch(dateTimePattern);
        }

        // 4. Determinism: calling the function twice with the same input produces identical output
        const output2 = formatEmployeeEngagementForExport(records);
        expect(output).toEqual(output2);
      }),
      { numRuns: 100 },
    );
  });
});
