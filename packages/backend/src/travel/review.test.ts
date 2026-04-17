import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reviewTravelApplication,
  listAllTravelApplications,
  ReviewTravelApplicationInput,
} from './review';
import { ErrorCodes } from '@points-mall/shared';

const USERS_TABLE = 'Users';
const TRAVEL_APPLICATIONS_TABLE = 'TravelApplications';

const tables = {
  usersTable: USERS_TABLE,
  travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE,
};

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makePendingApplication(overrides: Record<string, any> = {}) {
  return {
    applicationId: 'app-001',
    userId: 'user-001',
    applicantNickname: 'Alice',
    category: 'domestic',
    communityRole: 'Hero',
    eventLink: 'https://example.com/event',
    cfpScreenshotUrl: 'https://cdn.example.com/screenshot.png',
    flightCost: 1500,
    hotelCost: 800,
    totalCost: 2300,
    status: 'pending',
    earnDeducted: 500,
    createdAt: '2024-01-10T00:00:00.000Z',
    updatedAt: '2024-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeApproveInput(overrides: Partial<ReviewTravelApplicationInput> = {}): ReviewTravelApplicationInput {
  return {
    applicationId: 'app-001',
    reviewerId: 'admin-001',
    reviewerNickname: 'SuperAdmin',
    action: 'approve',
    ...overrides,
  };
}

function makeRejectInput(overrides: Partial<ReviewTravelApplicationInput> = {}): ReviewTravelApplicationInput {
  return {
    applicationId: 'app-001',
    reviewerId: 'admin-001',
    reviewerNickname: 'SuperAdmin',
    action: 'reject',
    rejectReason: '材料不完整',
    ...overrides,
  };
}

// ============================================================
// reviewTravelApplication
// ============================================================

describe('reviewTravelApplication', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --- Approve success ---

  it('should approve application: status becomes approved, reviewerId and reviewedAt set, travelEarnUsed unchanged', async () => {
    // GetCommand returns pending application
    client.send.mockResolvedValueOnce({ Item: makePendingApplication() });
    // UpdateCommand succeeds
    client.send.mockResolvedValueOnce({});

    const result = await reviewTravelApplication(makeApproveInput(), client, tables);

    expect(result.success).toBe(true);
    expect(result.application).toBeDefined();
    expect(result.application!.status).toBe('approved');
    expect(result.application!.reviewerId).toBe('admin-001');
    expect(result.application!.reviewerNickname).toBe('SuperAdmin');
    expect(result.application!.reviewedAt).toBeDefined();
    // travelEarnUsed stays unchanged — approve uses UpdateCommand, not TransactWriteCommand
    expect(client.send).toHaveBeenCalledTimes(2);
    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
  });

  it('should preserve original application fields on approve', async () => {
    const app = makePendingApplication({ earnDeducted: 1000, category: 'international' });
    client.send.mockResolvedValueOnce({ Item: app });
    client.send.mockResolvedValueOnce({});

    const result = await reviewTravelApplication(makeApproveInput(), client, tables);

    expect(result.application!.earnDeducted).toBe(1000);
    expect(result.application!.category).toBe('international');
    expect(result.application!.totalCost).toBe(2300);
  });

  // --- Reject success ---

  it('should reject application: status becomes rejected, rejectReason recorded, no travelEarnUsed change', async () => {
    const app = makePendingApplication({ earnDeducted: 500 });
    client.send.mockResolvedValueOnce({ Item: app });
    // UpdateCommand succeeds
    client.send.mockResolvedValueOnce({});

    const result = await reviewTravelApplication(makeRejectInput({ rejectReason: '信息不完整' }), client, tables);

    expect(result.success).toBe(true);
    expect(result.application!.status).toBe('rejected');
    expect(result.application!.rejectReason).toBe('信息不完整');
    expect(result.application!.reviewerId).toBe('admin-001');
    expect(result.application!.reviewerNickname).toBe('SuperAdmin');
    expect(result.application!.reviewedAt).toBeDefined();
  });

  it('should use UpdateCommand on reject to update application status', async () => {
    const app = makePendingApplication({ earnDeducted: 500 });
    client.send.mockResolvedValueOnce({ Item: app });
    client.send.mockResolvedValueOnce({});

    await reviewTravelApplication(makeRejectInput(), client, tables);

    expect(client.send).toHaveBeenCalledTimes(2);
    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');

    // Verify UpdateCommand targets only TravelApplications table
    expect(updateCmd.input.TableName).toBe(TRAVEL_APPLICATIONS_TABLE);

    // No TransactItems — this is a simple UpdateCommand, not a TransactWriteCommand
    expect(updateCmd.input.TransactItems).toBeUndefined();
  });

  it('should set empty rejectReason when not provided on reject', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingApplication() });
    client.send.mockResolvedValueOnce({});

    const result = await reviewTravelApplication(
      makeRejectInput({ rejectReason: undefined }),
      client,
      tables,
    );

    expect(result.success).toBe(true);
    expect(result.application!.rejectReason).toBe('');
  });

  // --- Duplicate review ---

  it('should return APPLICATION_ALREADY_REVIEWED when application is already approved', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingApplication({ status: 'approved' }) });

    const result = await reviewTravelApplication(makeApproveInput(), client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.APPLICATION_ALREADY_REVIEWED);
  });

  it('should return APPLICATION_ALREADY_REVIEWED when application is already rejected', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingApplication({ status: 'rejected' }) });

    const result = await reviewTravelApplication(makeRejectInput(), client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.APPLICATION_ALREADY_REVIEWED);
  });

  // --- Not found ---

  it('should return APPLICATION_NOT_FOUND when application does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await reviewTravelApplication(makeApproveInput(), client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.APPLICATION_NOT_FOUND);
  });

  it('should return APPLICATION_NOT_FOUND for reject when application does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await reviewTravelApplication(makeRejectInput(), client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.APPLICATION_NOT_FOUND);
  });
});


// ============================================================
// listAllTravelApplications
// ============================================================

describe('listAllTravelApplications', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --- Pagination with default pageSize ---

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications({}, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications({ pageSize: 200 }, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(100);
  });

  it('should use custom pageSize when within range', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications({ pageSize: 50 }, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(50);
  });

  // --- Status filter using GSI ---

  it('should use GSI status-createdAt-index when status is provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listAllTravelApplications({ status: 'pending' }, client, TRAVEL_APPLICATIONS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('QueryCommand');
    expect(cmd.input.TableName).toBe(TRAVEL_APPLICATIONS_TABLE);
    expect(cmd.input.IndexName).toBe('status-createdAt-index');
    expect(cmd.input.KeyConditionExpression).toBe('#st = :status');
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  it('should query approved status via GSI', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications({ status: 'approved' }, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('QueryCommand');
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('approved');
  });

  // --- Default pending status behavior ---

  it('should not default to pending status — no status means Scan', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications({}, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('ScanCommand');
  });

  // --- No status filter uses Scan ---

  it('should use Scan when status is not provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listAllTravelApplications({}, client, TRAVEL_APPLICATIONS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('ScanCommand');
    expect(cmd.input.TableName).toBe(TRAVEL_APPLICATIONS_TABLE);
  });

  // --- Descending sort by createdAt ---

  it('should sort scan results by createdAt descending', async () => {
    const items = [
      { applicationId: 'a1', createdAt: '2024-01-01T00:00:00Z' },
      { applicationId: 'a3', createdAt: '2024-01-03T00:00:00Z' },
      { applicationId: 'a2', createdAt: '2024-01-02T00:00:00Z' },
    ];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await listAllTravelApplications({}, client, TRAVEL_APPLICATIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.applications[0].applicationId).toBe('a3');
    expect(result.applications[1].applicationId).toBe('a2');
    expect(result.applications[2].applicationId).toBe('a1');
  });

  it('should return GSI query results in descending order (ScanIndexForward=false)', async () => {
    const items = [
      { applicationId: 'a2', status: 'pending', createdAt: '2024-01-02T00:00:00Z' },
      { applicationId: 'a1', status: 'pending', createdAt: '2024-01-01T00:00:00Z' },
    ];
    client.send.mockResolvedValueOnce({ Items: items });

    const result = await listAllTravelApplications({ status: 'pending' }, client, TRAVEL_APPLICATIONS_TABLE);

    expect(result.applications).toEqual(items);
  });

  // --- Pagination ---

  it('should return lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { applicationId: 'a2', status: 'pending', createdAt: '2024-01-01T00:00:00Z' };
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastEvalKey });

    const result = await listAllTravelApplications({ status: 'pending' }, client, TRAVEL_APPLICATIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should pass ExclusiveStartKey when lastKey is provided', async () => {
    const lastEvalKey = { applicationId: 'a2', status: 'pending', createdAt: '2024-01-01T00:00:00Z' };
    const encodedKey = Buffer.from(JSON.stringify(lastEvalKey)).toString('base64');
    client.send.mockResolvedValueOnce({ Items: [] });

    await listAllTravelApplications(
      { status: 'pending', lastKey: encodedKey },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toEqual(lastEvalKey);
  });

  it('should ignore invalid lastKey and start from beginning', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await listAllTravelApplications(
      { lastKey: 'not-valid-base64!!' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(result.success).toBe(true);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toBeUndefined();
  });

  // --- Empty results ---

  it('should return empty applications array when no items found', async () => {
    client.send.mockResolvedValueOnce({ Items: undefined });

    const result = await listAllTravelApplications({}, client, TRAVEL_APPLICATIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.applications).toEqual([]);
  });

  it('should return empty applications array with status filter when no items found', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await listAllTravelApplications({ status: 'rejected' }, client, TRAVEL_APPLICATIONS_TABLE);

    expect(result.success).toBe(true);
    expect(result.applications).toEqual([]);
    expect(result.lastKey).toBeUndefined();
  });
});
