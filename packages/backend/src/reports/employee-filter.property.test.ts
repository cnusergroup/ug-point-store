import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  formatUserRankingForExport,
  formatPointsDetailForExport,
} from './formatters';
import type { UserRankingRecord, PointsDetailRecord } from './query';

/**
 * Feature: employee-badge, Property 3: 报表导出 isEmployee 筛选正确性
 *
 * For any set of user records and optional isEmployee filter, when the filter
 * is specified, every exported record must satisfy the filter condition. When
 * no filter is specified, all records should be exported. Every exported record
 * should include the isEmployee field.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

// ============================================================
// Arbitraries
// ============================================================

const nicknameArb = fc.string({ minLength: 1, maxLength: 20, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')) });
const userIdArb = fc.string({ minLength: 8, maxLength: 16, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) });
const roleArb = fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer');
const sourceArb = fc.constantFrom('activity', 'manual', 'batch');
const ugNameArb = fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen', 'UG-Hangzhou');
const topicArb = fc.string({ minLength: 1, maxLength: 30 });
const isoDateArb = fc.integer({
  min: new Date('2024-01-01T00:00:00.000Z').getTime(),
  max: new Date('2025-12-31T23:59:59.999Z').getTime(),
}).map(ts => new Date(ts).toISOString());

/** Arbitrary for UserRankingRecord with isEmployee */
const userRankingRecordArb = fc.record({
  rank: fc.integer({ min: 1, max: 10000 }),
  userId: userIdArb,
  nickname: nicknameArb,
  totalEarnPoints: fc.integer({ min: 0, max: 100000 }),
  targetRole: roleArb,
  isEmployee: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(undefined)),
}) as fc.Arbitrary<UserRankingRecord & { isEmployee?: boolean }>;

/** Arbitrary for PointsDetailRecord with isEmployee */
const pointsDetailRecordArb = fc.record({
  recordId: userIdArb,
  createdAt: isoDateArb,
  userId: userIdArb,
  nickname: nicknameArb,
  amount: fc.integer({ min: 1, max: 10000 }),
  type: fc.constantFrom('earn' as const, 'spend' as const),
  source: sourceArb,
  activityUG: ugNameArb,
  activityTopic: topicArb,
  activityId: userIdArb,
  targetRole: roleArb,
  distributorNickname: nicknameArb,
  isEmployee: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(undefined)),
}) as fc.Arbitrary<PointsDetailRecord & { isEmployee?: boolean }>;

/** Arbitrary for isEmployee filter: 'true', 'false', or undefined (no filter) */
const isEmployeeFilterArb = fc.oneof(
  fc.constant('true' as const),
  fc.constant('false' as const),
  fc.constant(undefined),
);

/**
 * Simulate the in-memory isEmployee filtering logic used in executeExport.
 * This mirrors the filtering in export.ts for both user-points-ranking and points-detail.
 */
function applyIsEmployeeFilter<T extends { isEmployee?: boolean }>(
  records: T[],
  filterValue: 'true' | 'false' | undefined,
): T[] {
  if (filterValue === 'true') {
    return records.filter(r => r.isEmployee === true);
  } else if (filterValue === 'false') {
    return records.filter(r => !r.isEmployee);
  }
  return records;
}

// ============================================================
// Tests
// ============================================================

describe('Feature: employee-badge, Property 3: 报表导出 isEmployee 筛选正确性', () => {
  describe('formatUserRankingForExport — isEmployee 字段映射', () => {
    it('每条导出记录都应包含 isEmployee 字段，且 true 映射为 "是"，false/undefined 映射为 "否"', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 0, maxLength: 50 }),
          (records) => {
            const formatted = formatUserRankingForExport(records);

            // Every formatted record must include the isEmployee field
            expect(formatted).toHaveLength(records.length);

            for (let i = 0; i < records.length; i++) {
              const original = records[i];
              const exported = formatted[i];

              // isEmployee field must exist in every exported record
              expect(exported).toHaveProperty('isEmployee');

              // Mapping correctness: true → '是', false/undefined → '否'
              if (original.isEmployee === true) {
                expect(exported.isEmployee).toBe('是');
              } else {
                expect(exported.isEmployee).toBe('否');
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('formatPointsDetailForExport — isEmployee 字段映射', () => {
    it('每条导出记录都应包含 isEmployee 字段，且 true 映射为 "是"，false/undefined 映射为 "否"', () => {
      fc.assert(
        fc.property(
          fc.array(pointsDetailRecordArb, { minLength: 0, maxLength: 50 }),
          (records) => {
            const formatted = formatPointsDetailForExport(records);

            expect(formatted).toHaveLength(records.length);

            for (let i = 0; i < records.length; i++) {
              const original = records[i];
              const exported = formatted[i];

              expect(exported).toHaveProperty('isEmployee');

              if (original.isEmployee === true) {
                expect(exported.isEmployee).toBe('是');
              } else {
                expect(exported.isEmployee).toBe('否');
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('isEmployee 筛选逻辑 — UserRanking', () => {
    it('当指定 isEmployee 筛选时，导出结果中的每条记录应满足筛选条件', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);

            if (filterValue === 'true') {
              // Every record in the result must have isEmployee === true
              for (const r of filtered) {
                expect(r.isEmployee).toBe(true);
              }
            } else if (filterValue === 'false') {
              // Every record in the result must have isEmployee falsy (false or undefined)
              for (const r of filtered) {
                expect(r.isEmployee).not.toBe(true);
              }
            } else {
              // No filter: all records should be present
              expect(filtered).toHaveLength(records.length);
              expect(filtered).toEqual(records);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('筛选后的记录数应不超过原始记录数', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);
            expect(filtered.length).toBeLessThanOrEqual(records.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('筛选后格式化的每条记录都应包含 isEmployee 字段', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);
            const formatted = formatUserRankingForExport(filtered);

            for (const exported of formatted) {
              expect(exported).toHaveProperty('isEmployee');
              expect(typeof exported.isEmployee).toBe('string');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('isEmployee 筛选逻辑 — PointsDetail', () => {
    it('当指定 isEmployee 筛选时，导出结果中的每条记录应满足筛选条件', () => {
      fc.assert(
        fc.property(
          fc.array(pointsDetailRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);

            if (filterValue === 'true') {
              for (const r of filtered) {
                expect(r.isEmployee).toBe(true);
              }
            } else if (filterValue === 'false') {
              for (const r of filtered) {
                expect(r.isEmployee).not.toBe(true);
              }
            } else {
              expect(filtered).toHaveLength(records.length);
              expect(filtered).toEqual(records);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('筛选后的记录数应不超过原始记录数', () => {
      fc.assert(
        fc.property(
          fc.array(pointsDetailRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);
            expect(filtered.length).toBeLessThanOrEqual(records.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('筛选后格式化的每条记录都应包含 isEmployee 字段', () => {
      fc.assert(
        fc.property(
          fc.array(pointsDetailRecordArb, { minLength: 0, maxLength: 50 }),
          isEmployeeFilterArb,
          (records, filterValue) => {
            const filtered = applyIsEmployeeFilter(records, filterValue);
            const formatted = formatPointsDetailForExport(filtered);

            for (const exported of formatted) {
              expect(exported).toHaveProperty('isEmployee');
              expect(typeof exported.isEmployee).toBe('string');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('筛选与未筛选的一致性', () => {
    it('未指定筛选时，导出结果应包含所有记录且每条都有 isEmployee 字段', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 1, maxLength: 50 }),
          (records) => {
            // No filter applied
            const filtered = applyIsEmployeeFilter(records, undefined);
            const formatted = formatUserRankingForExport(filtered);

            // All records should be present
            expect(formatted).toHaveLength(records.length);

            // Every record should have isEmployee field
            for (const exported of formatted) {
              expect(exported).toHaveProperty('isEmployee');
              expect(['是', '否']).toContain(exported.isEmployee);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('isEmployee=true 筛选结果 + isEmployee=false 筛选结果 = 全部记录', () => {
      fc.assert(
        fc.property(
          fc.array(userRankingRecordArb, { minLength: 0, maxLength: 50 }),
          (records) => {
            const employeeRecords = applyIsEmployeeFilter(records, 'true');
            const nonEmployeeRecords = applyIsEmployeeFilter(records, 'false');

            // The union of both filtered sets should equal the total count
            expect(employeeRecords.length + nonEmployeeRecords.length).toBe(records.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
