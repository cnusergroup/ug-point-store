import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getColumnDefs,
  generateCSV,
  formatPointsDetailForExport,
  formatUGSummaryForExport,
  formatUserRankingForExport,
  formatActivitySummaryForExport,
  type ReportType,
  type ColumnDef,
} from './formatters';
import type {
  PointsDetailRecord,
  UGActivitySummaryRecord,
  UserRankingRecord,
  ActivitySummaryRecord,
} from './query';

// ============================================================
// Arbitraries
// ============================================================

/** Arbitrary for a safe string that won't break CSV parsing (no unbalanced quotes) */
const safeStringArb = fc.array(
  fc.constantFrom(
    'a', 'b', 'c', 'd', '1', '2', '3', '-', '_', '.',
    '中', '文', '测', '试', '活', '动',
  ),
  { minLength: 1, maxLength: 20 },
).map(arr => arr.join(''));

/** Arbitrary for a string that may contain CSV-special characters */
const csvStringArb = fc.oneof(
  safeStringArb,
  safeStringArb.map(s => `${s},${s}`),       // contains comma
  safeStringArb.map(s => `"${s}"`),           // contains quotes
  safeStringArb.map(s => `${s}\n${s}`),       // contains newline
);

/** Arbitrary for an ISO 8601 date string */
const isoDateArb = fc.integer({
  min: new Date('2023-01-01').getTime(),
  max: new Date('2025-12-31').getTime(),
}).map(ts => new Date(ts).toISOString());

/** Arbitrary for points type */
const pointsTypeArb = fc.constantFrom<'earn' | 'spend'>('earn', 'spend');

/** Arbitrary for target role */
const targetRoleArb = fc.constantFrom('UserGroupLeader', 'Speaker', 'Volunteer');

/** Arbitrary for PointsDetailRecord */
const pointsDetailRecordArb: fc.Arbitrary<PointsDetailRecord> = fc.record({
  recordId: fc.uuid(),
  createdAt: isoDateArb,
  userId: fc.uuid(),
  nickname: safeStringArb,
  amount: fc.integer({ min: 1, max: 10000 }),
  type: pointsTypeArb,
  source: fc.constantFrom('batch', 'claim', 'manual'),
  activityUG: fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen'),
  activityTopic: safeStringArb,
  activityId: fc.uuid(),
  targetRole: targetRoleArb,
  distributorNickname: safeStringArb,
});

/** Arbitrary for UGActivitySummaryRecord */
const ugSummaryRecordArb: fc.Arbitrary<UGActivitySummaryRecord> = fc.record({
  ugName: safeStringArb,
  activityCount: fc.integer({ min: 0, max: 100 }),
  totalPoints: fc.integer({ min: 0, max: 100000 }),
  participantCount: fc.integer({ min: 0, max: 500 }),
});

/** Arbitrary for UserRankingRecord */
const userRankingRecordArb: fc.Arbitrary<UserRankingRecord> = fc.record({
  rank: fc.integer({ min: 1, max: 1000 }),
  userId: fc.uuid(),
  nickname: safeStringArb,
  totalEarnPoints: fc.integer({ min: 0, max: 100000 }),
  targetRole: targetRoleArb,
});

/** Arbitrary for ActivitySummaryRecord */
const activitySummaryRecordArb: fc.Arbitrary<ActivitySummaryRecord> = fc.record({
  activityId: fc.uuid(),
  activityTopic: safeStringArb,
  activityDate: fc.integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-12-31').getTime(),
  }).map(ts => new Date(ts).toISOString().slice(0, 10)),
  activityUG: fc.constantFrom('UG-Beijing', 'UG-Shanghai', 'UG-Shenzhen'),
  totalPoints: fc.integer({ min: 0, max: 100000 }),
  participantCount: fc.integer({ min: 0, max: 500 }),
  uglCount: fc.integer({ min: 0, max: 100 }),
  speakerCount: fc.integer({ min: 0, max: 100 }),
  volunteerCount: fc.integer({ min: 0, max: 100 }),
});

// ============================================================
// CSV parsing helper (simple parser for round-trip verification)
// ============================================================

/**
 * Parse a CSV string into rows of string arrays.
 * Handles quoted fields with escaped double quotes.
 */
function parseCSV(csv: string): string[][] {
  // Remove BOM if present
  const content = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote
        if (i + 1 < content.length && content[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        currentField += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n or standalone \r
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        if (i + 1 < content.length && content[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else if (ch === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  // Push last field and row if there's remaining content
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

// ============================================================
// Property 8: CSV generation round-trip
// Feature: admin-reports-export, Property 8: CSV generation round-trip
// **Validates: Requirements 10.2, 13.1, 13.3**
// ============================================================

describe('Feature: admin-reports-export, Property 8: CSV generation round-trip', () => {
  it('CSV parse produces same row count and matching values for arbitrary records and columns', () => {
    // Arbitrary for column definitions with safe keys and labels
    const columnDefArb: fc.Arbitrary<ColumnDef> = fc.record({
      key: fc.constantFrom('col_a', 'col_b', 'col_c', 'col_d', 'col_e'),
      label: safeStringArb,
    });

    // Arbitrary for a record that has values for all column keys
    const recordForColumnsArb = (columns: ColumnDef[]): fc.Arbitrary<Record<string, unknown>> =>
      fc.record(
        Object.fromEntries(columns.map(c => [c.key, safeStringArb])) as Record<string, fc.Arbitrary<string>>,
      );

    // Use a fixed set of unique columns to avoid key collisions
    const uniqueColumnsArb = fc.integer({ min: 1, max: 5 }).chain(n => {
      const allKeys = ['col_a', 'col_b', 'col_c', 'col_d', 'col_e'];
      const selectedKeys = allKeys.slice(0, n);
      return fc.tuple(
        ...selectedKeys.map(key =>
          safeStringArb.map(label => ({ key, label })),
        ),
      ) as fc.Arbitrary<ColumnDef[]>;
    });

    fc.assert(
      fc.property(
        uniqueColumnsArb.chain(columns =>
          fc.tuple(
            fc.constant(columns),
            fc.array(recordForColumnsArb(columns), { minLength: 0, maxLength: 20 }),
          ),
        ),
        ([columns, records]) => {
          const csvBuffer = generateCSV(records, columns);
          const csvString = csvBuffer.toString('utf-8');

          // Parse the CSV back
          const parsed = parseCSV(csvString);

          // Should have header row + data rows
          expect(parsed.length).toBe(records.length + 1);

          // Header row should match column labels
          const headerRow = parsed[0];
          expect(headerRow.length).toBe(columns.length);
          for (let i = 0; i < columns.length; i++) {
            expect(headerRow[i]).toBe(columns[i].label);
          }

          // Each data row should match the original record values
          for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
            const dataRow = parsed[rowIdx + 1];
            expect(dataRow.length).toBe(columns.length);
            for (let colIdx = 0; colIdx < columns.length; colIdx++) {
              const originalValue = String(records[rowIdx][columns[colIdx].key] ?? '');
              expect(dataRow[colIdx]).toBe(originalValue);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CSV with special characters (commas, quotes) round-trips correctly', () => {
    const columns: ColumnDef[] = [
      { key: 'name', label: '名称' },
      { key: 'value', label: '值' },
    ];

    const recordArb = fc.record({
      name: csvStringArb,
      value: csvStringArb,
    });

    fc.assert(
      fc.property(
        fc.array(recordArb, { minLength: 1, maxLength: 10 }),
        (records) => {
          const csvBuffer = generateCSV(records as Record<string, unknown>[], columns);
          const csvString = csvBuffer.toString('utf-8');
          const parsed = parseCSV(csvString);

          // Row count: header + data
          expect(parsed.length).toBe(records.length + 1);

          // Each data row values match originals
          for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
            const dataRow = parsed[rowIdx + 1];
            expect(dataRow[0]).toBe(records[rowIdx].name);
            expect(dataRow[1]).toBe(records[rowIdx].value);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 9: Export field completeness
// Feature: admin-reports-export, Property 9: Export field completeness
// **Validates: Requirements 13.1, 14.1, 15.1, 16.1**
// ============================================================

describe('Feature: admin-reports-export, Property 9: Export field completeness', () => {
  it('points-detail formatted rows contain all defined columns with no undefined values', () => {
    fc.assert(
      fc.property(
        fc.array(pointsDetailRecordArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const formatted = formatPointsDetailForExport(records);
          const columns = getColumnDefs('points-detail');

          expect(formatted.length).toBe(records.length);

          for (const row of formatted) {
            for (const col of columns) {
              expect(row).toHaveProperty(col.key);
              expect(row[col.key]).not.toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ug-activity-summary formatted rows contain all defined columns with no undefined values', () => {
    fc.assert(
      fc.property(
        fc.array(ugSummaryRecordArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const formatted = formatUGSummaryForExport(records);
          const columns = getColumnDefs('ug-activity-summary');

          expect(formatted.length).toBe(records.length);

          for (const row of formatted) {
            for (const col of columns) {
              expect(row).toHaveProperty(col.key);
              expect(row[col.key]).not.toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('user-points-ranking formatted rows contain all defined columns with no undefined values', () => {
    fc.assert(
      fc.property(
        fc.array(userRankingRecordArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const formatted = formatUserRankingForExport(records);
          const columns = getColumnDefs('user-points-ranking');

          expect(formatted.length).toBe(records.length);

          for (const row of formatted) {
            for (const col of columns) {
              expect(row).toHaveProperty(col.key);
              expect(row[col.key]).not.toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('activity-points-summary formatted rows contain all defined columns with no undefined values', () => {
    fc.assert(
      fc.property(
        fc.array(activitySummaryRecordArb, { minLength: 1, maxLength: 20 }),
        (records) => {
          const formatted = formatActivitySummaryForExport(records);
          const columns = getColumnDefs('activity-points-summary');

          expect(formatted.length).toBe(records.length);

          for (const row of formatted) {
            for (const col of columns) {
              expect(row).toHaveProperty(col.key);
              expect(row[col.key]).not.toBeUndefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
