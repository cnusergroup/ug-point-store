import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMyApplications, type EligibilityTables } from './eligibility';

// Unit tests for the getMyApplications I/O orchestration: when any underlying
// DynamoDB read fails, the function MUST propagate an error (reject) rather than
// swallow it into an empty list or a partial result.
//
// Validates: Requirements 3.7

const TABLES: EligibilityTables = {
  pointsRecordsTable: 'PointsMall-PointsRecords',
  associationsTable: 'PointsMall-ActivityTemplateAssociations',
  credentialsTable: 'PointsMall-Credentials',
};

const USER_ID = 'user-001';

// GSI names used to distinguish which query a given command targets.
const POINTS_INDEX = 'userId-createdAt-index';
const ASSOC_INDEX = 'activityId-index';
const APPLIED_INDEX = 'appliedByUserId-index';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function indexOf(cmd: any): string | undefined {
  return cmd?.input?.IndexName;
}

/** Success response for the points-records query: one identity points record. */
function pointsRecordsOk() {
  return Promise.resolve({
    Items: [{ activityId: 'act-1', targetRole: 'Speaker' }],
    LastEvaluatedKey: undefined,
  });
}

/** Success response for the associations query: one matching association. */
function associationsOk() {
  return Promise.resolve({
    Items: [
      {
        associationId: 'assoc-1',
        activityId: 'act-1',
        eventName: 'AWS Community Day 2026 Summer',
        eventPrefix: 'ACD',
        year: '2026',
        season: 'Summer',
        allowedRoles: [
          { role: 'Speaker', roleCode: 'SPK', identityText: 'Speaker' },
        ],
        locale: 'en',
        issuingOrganization: 'AWS User Group China',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'admin',
      },
    ],
  });
}

/** Success response for the applied-credentials query: none applied yet. */
function appliedOk() {
  return Promise.resolve({ Items: [], LastEvaluatedKey: undefined });
}

describe('getMyApplications I/O failure handling (Req 3.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when the points-records query fails (never returns an empty list)', async () => {
    const client = createMockDynamoClient();
    const dbError = new Error('DynamoDB unavailable');

    // The first DynamoDB read (points records via userId-createdAt-index) rejects.
    client.send.mockImplementation((cmd: any) => {
      if (indexOf(cmd) === POINTS_INDEX) return Promise.reject(dbError);
      return appliedOk();
    });

    await expect(getMyApplications(USER_ID, client, TABLES)).rejects.toThrow(
      'DynamoDB unavailable',
    );
  });

  it('does not resolve to a partial/empty result when the points-records query fails', async () => {
    const client = createMockDynamoClient();
    client.send.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    // Assert the promise rejects: capture any (incorrectly) resolved value to fail loudly.
    let resolvedValue: unknown;
    let threw = false;
    try {
      resolvedValue = await getMyApplications(USER_ID, client, TABLES);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // It must never have resolved to an empty list (or any value).
    expect(resolvedValue).toBeUndefined();
  });

  it('rejects when the associations query fails (no partial result)', async () => {
    const client = createMockDynamoClient();
    const dbError = new Error('Associations table unavailable');

    // Points records succeed (yielding act-1), but the associations query rejects.
    client.send.mockImplementation((cmd: any) => {
      const idx = indexOf(cmd);
      if (idx === POINTS_INDEX) return pointsRecordsOk();
      if (idx === ASSOC_INDEX) return Promise.reject(dbError);
      return appliedOk();
    });

    await expect(getMyApplications(USER_ID, client, TABLES)).rejects.toThrow(
      'Associations table unavailable',
    );
  });

  it('rejects when the applied-credentials query fails (no partial result)', async () => {
    const client = createMockDynamoClient();
    const dbError = new Error('Credentials table unavailable');

    // Points records and associations succeed, but the credentials query rejects.
    client.send.mockImplementation((cmd: any) => {
      const idx = indexOf(cmd);
      if (idx === POINTS_INDEX) return pointsRecordsOk();
      if (idx === ASSOC_INDEX) return associationsOk();
      if (idx === APPLIED_INDEX) return Promise.reject(dbError);
      return appliedOk();
    });

    await expect(getMyApplications(USER_ID, client, TABLES)).rejects.toThrow(
      'Credentials table unavailable',
    );
  });
});
