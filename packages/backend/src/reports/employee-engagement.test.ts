import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryEmployeeEngagement,
  type EmployeeEngagementFilter,
} from './insight-query';

// ============================================================
// Helpers
// ============================================================

const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';
const TABLES = {
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

/**
 * Build a mock ScanCommand response (for scanAll — may paginate).
 * Returns a single page with all items.
 */
function scanResponse(items: Record<string, unknown>[]) {
  return { Items: items, LastEvaluatedKey: undefined };
}

/**
 * Build a mock QueryCommand response (for queryAll — may paginate).
 * Returns a single page with all items.
 */
function queryResponse(items: Record<string, unknown>[]) {
  return { Items: items, LastEvaluatedKey: undefined };
}

/**
 * Build a mock BatchGetCommand response.
 */
function batchGetResponse(tableName: string, items: Record<string, unknown>[]) {
  return { Responses: { [tableName]: items } };
}

// ============================================================
// queryEmployeeEngagement — full query flow
// ============================================================

describe('queryEmployeeEngagement', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.1 — full query flow with mocked DynamoDB
  // ----------------------------------------------------------
  it('should return correct summary and records for a normal query flow', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-06-30T23:59:59Z',
    };

    // 1. ScanCommand — employee users
    client.send.mockResolvedValueOnce(
      scanResponse([
        { userId: 'emp1', isEmployee: true },
        { userId: 'emp2', isEmployee: true },
        { userId: 'emp3', isEmployee: true },
      ]),
    );

    // 2. QueryCommand — earn records in date range
    client.send.mockResolvedValueOnce(
      queryResponse([
        { userId: 'emp1', amount: 100, activityId: 'act1', createdAt: '2024-03-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Beijing', type: 'earn' },
        { userId: 'emp1', amount: 50, activityId: 'act2', createdAt: '2024-04-15T12:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Shanghai', type: 'earn' },
        { userId: 'emp2', amount: 200, activityId: 'act1', createdAt: '2024-05-20T08:00:00Z', targetRole: 'Volunteer', activityUG: 'UG-Beijing', type: 'earn' },
        { userId: 'non-employee', amount: 500, activityId: 'act3', createdAt: '2024-06-01T09:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Shenzhen', type: 'earn' },
      ]),
    );

    // 3. BatchGetCommand — nicknames for active employees (emp1, emp2)
    client.send.mockResolvedValueOnce(
      batchGetResponse(USERS_TABLE, [
        { userId: 'emp1', nickname: 'Alice' },
        { userId: 'emp2', nickname: 'Bob' },
      ]),
    );

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.records).toBeDefined();

    // Summary checks
    expect(result.summary!.totalEmployees).toBe(3);
    expect(result.summary!.activeEmployees).toBe(2);
    // engagementRate = 2/3 * 100 = 66.7
    expect(result.summary!.engagementRate).toBe(66.7);
    expect(result.summary!.totalPoints).toBe(350); // 100 + 50 + 200
    expect(result.summary!.totalActivities).toBe(2); // act1, act2 (only employee records)

    // Records checks — sorted by totalPoints desc
    expect(result.records).toHaveLength(2);
    // emp2 has 200 points, emp1 has 150 points
    expect(result.records![0].rank).toBe(1);
    expect(result.records![0].userId).toBe('emp2');
    expect(result.records![0].nickname).toBe('Bob');
    expect(result.records![0].totalPoints).toBe(200);
    expect(result.records![0].activityCount).toBe(1);
    expect(result.records![0].primaryRoles).toBe('Volunteer');
    expect(result.records![0].ugList).toBe('UG-Beijing');

    expect(result.records![1].rank).toBe(2);
    expect(result.records![1].userId).toBe('emp1');
    expect(result.records![1].nickname).toBe('Alice');
    expect(result.records![1].totalPoints).toBe(150);
    expect(result.records![1].activityCount).toBe(2);
    expect(result.records![1].lastActiveTime).toBe('2024-04-15T12:00:00Z');
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.3 — empty employee set returns zero metrics
  // ----------------------------------------------------------
  it('should return zero metrics when no employees exist', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    };

    // 1. ScanCommand — no employees
    client.send.mockResolvedValueOnce(scanResponse([]));

    // 2. QueryCommand — some earn records exist but no employees to match
    client.send.mockResolvedValueOnce(
      queryResponse([
        { userId: 'user1', amount: 100, activityId: 'act1', createdAt: '2024-06-01T00:00:00Z', type: 'earn' },
      ]),
    );

    // 3. BatchGetCommand — no active employees, so empty keys → no call needed
    //    But batchGetItems returns [] for empty keys, so no send call happens

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.summary!.totalEmployees).toBe(0);
    expect(result.summary!.activeEmployees).toBe(0);
    expect(result.summary!.engagementRate).toBe(0);
    expect(result.summary!.totalPoints).toBe(0);
    expect(result.summary!.totalActivities).toBe(0);
    expect(result.records).toEqual([]);
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.3 — employees exist but no earn records in date range
  // ----------------------------------------------------------
  it('should return zero active employees when no earn records in date range', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-31T23:59:59Z',
    };

    // 1. ScanCommand — 2 employees
    client.send.mockResolvedValueOnce(
      scanResponse([
        { userId: 'emp1', isEmployee: true },
        { userId: 'emp2', isEmployee: true },
      ]),
    );

    // 2. QueryCommand — no earn records in this date range
    client.send.mockResolvedValueOnce(queryResponse([]));

    // No BatchGetCommand needed since no active employees

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.summary!.totalEmployees).toBe(2);
    expect(result.summary!.activeEmployees).toBe(0);
    expect(result.summary!.engagementRate).toBe(0);
    expect(result.summary!.totalPoints).toBe(0);
    expect(result.summary!.totalActivities).toBe(0);
    expect(result.records).toEqual([]);
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.7 — correct ranking with tied points
  // ----------------------------------------------------------
  it('should rank by totalPoints desc, tiebreak by lastActiveTime desc', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    };

    // 1. ScanCommand — 3 employees
    client.send.mockResolvedValueOnce(
      scanResponse([
        { userId: 'emp1', isEmployee: true },
        { userId: 'emp2', isEmployee: true },
        { userId: 'emp3', isEmployee: true },
      ]),
    );

    // 2. QueryCommand — emp1 and emp2 have same total points (100 each), emp3 has 200
    client.send.mockResolvedValueOnce(
      queryResponse([
        { userId: 'emp1', amount: 100, activityId: 'act1', createdAt: '2024-06-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Beijing', type: 'earn' },
        { userId: 'emp2', amount: 100, activityId: 'act2', createdAt: '2024-06-15T10:00:00Z', targetRole: 'Volunteer', activityUG: 'UG-Shanghai', type: 'earn' },
        { userId: 'emp3', amount: 200, activityId: 'act3', createdAt: '2024-03-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Shenzhen', type: 'earn' },
      ]),
    );

    // 3. BatchGetCommand — nicknames
    client.send.mockResolvedValueOnce(
      batchGetResponse(USERS_TABLE, [
        { userId: 'emp1', nickname: 'Alice' },
        { userId: 'emp2', nickname: 'Bob' },
        { userId: 'emp3', nickname: 'Charlie' },
      ]),
    );

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(3);

    // emp3 has highest points (200) → rank 1
    expect(result.records![0].rank).toBe(1);
    expect(result.records![0].userId).toBe('emp3');
    expect(result.records![0].totalPoints).toBe(200);

    // emp1 and emp2 both have 100 points; emp2 has later lastActiveTime → rank 2
    expect(result.records![1].rank).toBe(2);
    expect(result.records![1].userId).toBe('emp2');
    expect(result.records![1].totalPoints).toBe(100);
    expect(result.records![1].lastActiveTime).toBe('2024-06-15T10:00:00Z');

    expect(result.records![2].rank).toBe(3);
    expect(result.records![2].userId).toBe('emp1');
    expect(result.records![2].totalPoints).toBe(100);
    expect(result.records![2].lastActiveTime).toBe('2024-06-01T10:00:00Z');
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.1 — date range filtering via applyDefaultDateRange
  // ----------------------------------------------------------
  it('should use default date range when no dates provided', async () => {
    const filter: EmployeeEngagementFilter = {};

    // 1. ScanCommand — 1 employee
    client.send.mockResolvedValueOnce(
      scanResponse([{ userId: 'emp1', isEmployee: true }]),
    );

    // 2. QueryCommand — no records
    client.send.mockResolvedValueOnce(queryResponse([]));

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);

    // Verify the QueryCommand was called with date range parameters
    const queryCmd = client.send.mock.calls[1][0];
    expect(queryCmd.constructor.name).toBe('QueryCommand');
    expect(queryCmd.input.IndexName).toBe('type-createdAt-index');
    expect(queryCmd.input.ExpressionAttributeValues[':type']).toBe('earn');
    // startDate and endDate should be set (defaults applied)
    expect(queryCmd.input.ExpressionAttributeValues[':start']).toBeDefined();
    expect(queryCmd.input.ExpressionAttributeValues[':end']).toBeDefined();
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.7 — DynamoDB error returns error response
  // ----------------------------------------------------------
  it('should return error response when DynamoDB throws', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    };

    // ScanCommand throws
    client.send.mockRejectedValueOnce(new Error('DynamoDB connection error'));

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('INTERNAL_ERROR');
    expect(result.error!.message).toBe('Internal server error');
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.1 — non-employee records are filtered out
  // ----------------------------------------------------------
  it('should filter out non-employee records from earn results', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    };

    // 1. ScanCommand — only emp1 is an employee
    client.send.mockResolvedValueOnce(
      scanResponse([{ userId: 'emp1', isEmployee: true }]),
    );

    // 2. QueryCommand — records from both employee and non-employee
    client.send.mockResolvedValueOnce(
      queryResponse([
        { userId: 'emp1', amount: 100, activityId: 'act1', createdAt: '2024-06-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Beijing', type: 'earn' },
        { userId: 'regular-user', amount: 500, activityId: 'act2', createdAt: '2024-06-15T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Shanghai', type: 'earn' },
        { userId: 'another-user', amount: 300, activityId: 'act3', createdAt: '2024-07-01T10:00:00Z', targetRole: 'Volunteer', activityUG: 'UG-Shenzhen', type: 'earn' },
      ]),
    );

    // 3. BatchGetCommand — only emp1
    client.send.mockResolvedValueOnce(
      batchGetResponse(USERS_TABLE, [
        { userId: 'emp1', nickname: 'Alice' },
      ]),
    );

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.summary!.totalEmployees).toBe(1);
    expect(result.summary!.activeEmployees).toBe(1);
    expect(result.summary!.totalPoints).toBe(100); // only emp1's points
    expect(result.records).toHaveLength(1);
    expect(result.records![0].userId).toBe('emp1');
  });

  // ----------------------------------------------------------
  // Validates: Requirement 5.1 — roles and UG aggregation
  // ----------------------------------------------------------
  it('should aggregate roles and UG sets correctly per employee', async () => {
    const filter: EmployeeEngagementFilter = {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    };

    // 1. ScanCommand — 1 employee
    client.send.mockResolvedValueOnce(
      scanResponse([{ userId: 'emp1', isEmployee: true }]),
    );

    // 2. QueryCommand — multiple records for emp1 with different roles and UGs
    client.send.mockResolvedValueOnce(
      queryResponse([
        { userId: 'emp1', amount: 100, activityId: 'act1', createdAt: '2024-03-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Beijing', type: 'earn' },
        { userId: 'emp1', amount: 50, activityId: 'act2', createdAt: '2024-04-01T10:00:00Z', targetRole: 'Volunteer', activityUG: 'UG-Shanghai', type: 'earn' },
        { userId: 'emp1', amount: 75, activityId: 'act3', createdAt: '2024-05-01T10:00:00Z', targetRole: 'Speaker', activityUG: 'UG-Beijing', type: 'earn' },
      ]),
    );

    // 3. BatchGetCommand
    client.send.mockResolvedValueOnce(
      batchGetResponse(USERS_TABLE, [
        { userId: 'emp1', nickname: 'Alice' },
      ]),
    );

    const result = await queryEmployeeEngagement(filter, client, TABLES);

    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(1);

    const record = result.records![0];
    expect(record.totalPoints).toBe(225);
    expect(record.activityCount).toBe(3);
    expect(record.lastActiveTime).toBe('2024-05-01T10:00:00Z');
    // primaryRoles should contain both Speaker and Volunteer (Set → comma-separated)
    expect(record.primaryRoles).toContain('Speaker');
    expect(record.primaryRoles).toContain('Volunteer');
    // ugList should contain both UG-Beijing and UG-Shanghai (Set → 顿号-separated)
    expect(record.ugList).toContain('UG-Beijing');
    expect(record.ugList).toContain('UG-Shanghai');
  });
});
