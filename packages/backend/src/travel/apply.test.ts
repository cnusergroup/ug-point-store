import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateAvailableCount,
  validateTravelApplicationInput,
  getTravelQuota,
  submitTravelApplication,
  listMyTravelApplications,
  resubmitTravelApplication,
  clampPageSize,
  SubmitTravelApplicationInput,
  ResubmitTravelApplicationInput,
} from './apply';
import { ErrorCodes } from '@points-mall/shared';

const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';
const TRAVEL_APPLICATIONS_TABLE = 'TravelApplications';

const tables = {
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  travelApplicationsTable: TRAVEL_APPLICATIONS_TABLE,
};

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

// ============================================================
// clampPageSize
// ============================================================

describe('clampPageSize', () => {
  it('should default to 20 when undefined', () => {
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('should default to 20 when null', () => {
    expect(clampPageSize(null as any)).toBe(20);
  });

  it('should clamp to 1 when value < 1', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
  });

  it('should clamp to 100 when value > 100', () => {
    expect(clampPageSize(101)).toBe(100);
    expect(clampPageSize(999)).toBe(100);
  });

  it('should return the value when within range', () => {
    expect(clampPageSize(1)).toBe(1);
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(100)).toBe(100);
  });

  it('should floor fractional values', () => {
    expect(clampPageSize(20.9)).toBe(20);
    expect(clampPageSize(1.5)).toBe(1);
  });
});

// ============================================================
// calculateAvailableCount
// ============================================================

describe('calculateAvailableCount', () => {
  it('should return floor(earnTotal / threshold) - categoryUsedCount for normal case', () => {
    // floor(1000/500) - 0 = 2
    expect(calculateAvailableCount(1000, 500, 0)).toBe(2);
    // floor(1000/500) - 1 = 1
    expect(calculateAvailableCount(1000, 500, 1)).toBe(1);
    // floor(1000/300) - 1 = 3 - 1 = 2
    expect(calculateAvailableCount(1000, 300, 1)).toBe(2);
  });

  it('should return 0 when threshold is 0', () => {
    expect(calculateAvailableCount(1000, 0, 0)).toBe(0);
    expect(calculateAvailableCount(0, 0, 0)).toBe(0);
  });

  it('should return 0 when categoryUsedCount exceeds total quota', () => {
    // floor(100/50) = 2, 2 - 5 = -3 → clamped to 0
    expect(calculateAvailableCount(100, 50, 5)).toBe(0);
    // floor(0/1) = 0, 0 - 1 = -1 → clamped to 0
    expect(calculateAvailableCount(0, 1, 1)).toBe(0);
  });

  it('should return 0 when categoryUsedCount equals total quota', () => {
    // floor(500/500) = 1, 1 - 1 = 0
    expect(calculateAvailableCount(500, 500, 1)).toBe(0);
  });

  it('should handle large values', () => {
    // floor(100000/1000) - 0 = 100
    expect(calculateAvailableCount(100000, 1000, 0)).toBe(100);
  });

  it('should return 0 when earnTotal is less than threshold', () => {
    // floor(200/500) = 0, 0 - 0 = 0
    expect(calculateAvailableCount(200, 500, 0)).toBe(0);
  });
});


// ============================================================
// validateTravelApplicationInput
// ============================================================

describe('validateTravelApplicationInput', () => {
  const validInput = {
    category: 'domestic',
    communityRole: 'Hero',
    eventLink: 'https://example.com/event',
    cfpScreenshotUrl: 'https://cdn.example.com/screenshot.png',
    flightCost: 1500,
    hotelCost: 800,
  };

  it('should accept valid domestic input', () => {
    const result = validateTravelApplicationInput(validInput);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.category).toBe('domestic');
      expect(result.data.communityRole).toBe('Hero');
      expect(result.data.flightCost).toBe(1500);
      expect(result.data.hotelCost).toBe(800);
    }
  });

  it('should accept valid international input', () => {
    const result = validateTravelApplicationInput({ ...validInput, category: 'international' });
    expect(result.valid).toBe(true);
  });

  it('should accept all valid communityRole values', () => {
    for (const role of ['Hero', 'CommunityBuilder', 'UGL']) {
      const result = validateTravelApplicationInput({ ...validInput, communityRole: role });
      expect(result.valid).toBe(true);
    }
  });

  it('should accept zero costs', () => {
    const result = validateTravelApplicationInput({ ...validInput, flightCost: 0, hotelCost: 0 });
    expect(result.valid).toBe(true);
  });

  // --- Rejection cases ---

  it('should reject null body', () => {
    const result = validateTravelApplicationInput(null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject invalid category', () => {
    const result = validateTravelApplicationInput({ ...validInput, category: 'local' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject missing category', () => {
    const { category, ...rest } = validInput;
    const result = validateTravelApplicationInput(rest);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid communityRole', () => {
    const result = validateTravelApplicationInput({ ...validInput, communityRole: 'Speaker' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject missing communityRole', () => {
    const { communityRole, ...rest } = validInput;
    const result = validateTravelApplicationInput(rest);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid eventLink (not a URL)', () => {
    const result = validateTravelApplicationInput({ ...validInput, eventLink: 'not-a-url' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-string eventLink', () => {
    const result = validateTravelApplicationInput({ ...validInput, eventLink: 123 });
    expect(result.valid).toBe(false);
  });

  it('should reject empty cfpScreenshotUrl', () => {
    const result = validateTravelApplicationInput({ ...validInput, cfpScreenshotUrl: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject whitespace-only cfpScreenshotUrl', () => {
    const result = validateTravelApplicationInput({ ...validInput, cfpScreenshotUrl: '   ' });
    expect(result.valid).toBe(false);
  });

  it('should reject non-string cfpScreenshotUrl', () => {
    const result = validateTravelApplicationInput({ ...validInput, cfpScreenshotUrl: 123 });
    expect(result.valid).toBe(false);
  });

  it('should reject negative flightCost', () => {
    const result = validateTravelApplicationInput({ ...validInput, flightCost: -1 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-number flightCost', () => {
    const result = validateTravelApplicationInput({ ...validInput, flightCost: '100' });
    expect(result.valid).toBe(false);
  });

  it('should reject Infinity flightCost', () => {
    const result = validateTravelApplicationInput({ ...validInput, flightCost: Infinity });
    expect(result.valid).toBe(false);
  });

  it('should reject negative hotelCost', () => {
    const result = validateTravelApplicationInput({ ...validInput, hotelCost: -0.01 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-number hotelCost', () => {
    const result = validateTravelApplicationInput({ ...validInput, hotelCost: null });
    expect(result.valid).toBe(false);
  });
});


// ============================================================
// getTravelQuota
// ============================================================

describe('getTravelQuota', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should correctly calculate earnTotal and available counts', async () => {
    // Call 1: QueryCommand for PointsRecords (earnTotal)
    client.send.mockResolvedValueOnce({
      Items: [{ amount: 300 }, { amount: 200 }, { amount: 500 }],
      LastEvaluatedKey: undefined,
    });
    // Call 2: GetCommand for travel settings
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      },
    });
    // Call 3: QueryCommand for pending+approved applications
    client.send.mockResolvedValueOnce({
      Items: [
        { category: 'domestic' },
      ],
      LastEvaluatedKey: undefined,
    });

    const quota = await getTravelQuota('user-001', client, tables);

    expect(quota.speakerEarnTotal).toBe(1000);
    expect(quota.domesticThreshold).toBe(500);
    expect(quota.internationalThreshold).toBe(1000);
    // floor(1000/500) - 1 = 1
    expect(quota.domesticAvailable).toBe(1);
    // floor(1000/1000) - 0 = 1
    expect(quota.internationalAvailable).toBe(1);
    expect(quota.domesticUsedCount).toBe(1);
    expect(quota.internationalUsedCount).toBe(0);
  });

  it('should return zero used counts when no pending or approved applications exist', async () => {
    client.send.mockResolvedValueOnce({
      Items: [{ amount: 500 }],
      LastEvaluatedKey: undefined,
    });
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold: 100,
        internationalThreshold: 200,
      },
    });
    // No pending/approved applications
    client.send.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const quota = await getTravelQuota('user-001', client, tables);

    expect(quota.domesticUsedCount).toBe(0);
    expect(quota.internationalUsedCount).toBe(0);
    expect(quota.domesticAvailable).toBe(5); // floor(500/100) - 0
    expect(quota.internationalAvailable).toBe(2); // floor(500/200) - 0
  });

  it('should handle paginated PointsRecords query', async () => {
    // First page
    client.send.mockResolvedValueOnce({
      Items: [{ amount: 100 }],
      LastEvaluatedKey: { userId: 'user-001', createdAt: '2024-01-01' },
    });
    // Second page
    client.send.mockResolvedValueOnce({
      Items: [{ amount: 200 }],
      LastEvaluatedKey: undefined,
    });
    // Settings
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold: 100,
        internationalThreshold: 200,
      },
    });
    // Applications query
    client.send.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const quota = await getTravelQuota('user-001', client, tables);

    expect(quota.speakerEarnTotal).toBe(300);
  });
});


// ============================================================
// submitTravelApplication
// ============================================================

describe('submitTravelApplication', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  const validSubmitInput: SubmitTravelApplicationInput = {
    userId: 'user-001',
    userNickname: 'Alice',
    category: 'domestic',
    communityRole: 'Hero',
    eventLink: 'https://example.com/event',
    cfpScreenshotUrl: 'https://cdn.example.com/screenshot.png',
    flightCost: 1500,
    hotelCost: 800,
  };

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  function mockSettingsEnabled(domesticThreshold = 500, internationalThreshold = 1000) {
    // getTravelSettings call
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold,
        internationalThreshold,
      },
    });
  }

  function mockSettingsDisabled() {
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: false,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      },
    });
  }

  function mockEarnTotal(amounts: number[]) {
    // QueryCommand for PointsRecords
    client.send.mockResolvedValueOnce({
      Items: amounts.map((a) => ({ amount: a })),
      LastEvaluatedKey: undefined,
    });
  }

  function mockCategoryUsedCount(count: number, category: string = 'domestic') {
    // QueryCommand for pending+approved applications per category
    client.send.mockResolvedValueOnce({
      Items: Array.from({ length: count }, () => ({ category })),
      LastEvaluatedKey: undefined,
    });
  }

  function mockPutSuccess() {
    client.send.mockResolvedValueOnce({});
  }

  it('should return FEATURE_DISABLED when travel sponsorship is disabled', async () => {
    mockSettingsDisabled();

    const result = await submitTravelApplication(validSubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.FEATURE_DISABLED);
  });

  it('should return INSUFFICIENT_EARN_QUOTA when available count < 1', async () => {
    mockSettingsEnabled(500, 1000);
    mockEarnTotal([100]); // earnTotal = 100, floor(100/500) = 0
    mockCategoryUsedCount(0); // 0 used, but 0 total quota

    const result = await submitTravelApplication(validSubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_EARN_QUOTA);
  });

  it('should successfully submit a domestic application', async () => {
    mockSettingsEnabled(500, 1000);
    mockEarnTotal([1000]); // earnTotal = 1000, floor(1000/500) = 2
    mockCategoryUsedCount(0); // 0 used
    mockPutSuccess();

    const result = await submitTravelApplication(validSubmitInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.application).toBeDefined();
    expect(result.application!.status).toBe('pending');
    expect(result.application!.category).toBe('domestic');
    expect(result.application!.totalCost).toBe(2300); // 1500 + 800
    expect(result.application!.earnDeducted).toBeUndefined();
    expect(result.application!.applicationId).toBeDefined();
    expect(result.application!.userId).toBe('user-001');
    expect(result.application!.applicantNickname).toBe('Alice');
  });

  it('should successfully submit an international application', async () => {
    mockSettingsEnabled(500, 1000);
    mockEarnTotal([2000]); // earnTotal = 2000, floor(2000/1000) = 2
    mockCategoryUsedCount(0, 'international');
    mockPutSuccess();

    const result = await submitTravelApplication(
      { ...validSubmitInput, category: 'international' },
      client,
      tables,
    );

    expect(result.success).toBe(true);
    expect(result.application!.category).toBe('international');
    expect(result.application!.earnDeducted).toBeUndefined();
  });

  it('should use PutCommand for application creation', async () => {
    mockSettingsEnabled(500, 1000);
    mockEarnTotal([1000]);
    mockCategoryUsedCount(0);
    mockPutSuccess();

    await submitTravelApplication(validSubmitInput, client, tables);

    // Settings call + earnTotal query + category count query + put = 4 calls
    expect(client.send).toHaveBeenCalledTimes(4);
    const lastCmd = client.send.mock.calls[3][0];
    expect(lastCmd.constructor.name).toBe('PutCommand');
  });
});


// ============================================================
// listMyTravelApplications
// ============================================================

describe('listMyTravelApplications', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should query userId-createdAt-index with ScanIndexForward=false', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listMyTravelApplications(
      { userId: 'user-001' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe(TRAVEL_APPLICATIONS_TABLE);
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listMyTravelApplications({ userId: 'user-001' }, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listMyTravelApplications(
      { userId: 'user-001', pageSize: 200 },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(100);
  });

  it('should add FilterExpression when status is provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listMyTravelApplications(
      { userId: 'user-001', status: 'pending' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe('#s = :status');
    expect(cmd.input.ExpressionAttributeNames).toEqual({ '#s': 'status' });
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
  });

  it('should not add FilterExpression when status is not provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    await listMyTravelApplications({ userId: 'user-001' }, client, TRAVEL_APPLICATIONS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBeUndefined();
  });

  it('should return applications from DynamoDB response', async () => {
    const mockApps = [
      { applicationId: 'a1', userId: 'user-001', status: 'pending', createdAt: '2024-01-02T00:00:00Z' },
      { applicationId: 'a2', userId: 'user-001', status: 'approved', createdAt: '2024-01-01T00:00:00Z' },
    ];
    client.send.mockResolvedValueOnce({ Items: mockApps });

    const result = await listMyTravelApplications(
      { userId: 'user-001' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.applications).toEqual(mockApps);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { applicationId: 'a2', userId: 'user-001', createdAt: '2024-01-01T00:00:00Z' };
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastEvalKey });

    const result = await listMyTravelApplications(
      { userId: 'user-001' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(result.lastKey).toBeDefined();
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should pass ExclusiveStartKey when lastKey is provided', async () => {
    const lastEvalKey = { applicationId: 'a2', userId: 'user-001', createdAt: '2024-01-01T00:00:00Z' };
    const encodedKey = Buffer.from(JSON.stringify(lastEvalKey)).toString('base64');
    client.send.mockResolvedValueOnce({ Items: [] });

    await listMyTravelApplications(
      { userId: 'user-001', lastKey: encodedKey },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toEqual(lastEvalKey);
  });

  it('should ignore invalid lastKey and start from beginning', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await listMyTravelApplications(
      { userId: 'user-001', lastKey: 'not-valid-base64!!' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(result.success).toBe(true);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toBeUndefined();
  });

  it('should return empty applications array when no items found', async () => {
    client.send.mockResolvedValueOnce({ Items: undefined });

    const result = await listMyTravelApplications(
      { userId: 'user-001' },
      client,
      TRAVEL_APPLICATIONS_TABLE,
    );

    expect(result.success).toBe(true);
    expect(result.applications).toEqual([]);
  });
});


// ============================================================
// resubmitTravelApplication
// ============================================================

describe('resubmitTravelApplication', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  const baseResubmitInput: ResubmitTravelApplicationInput = {
    applicationId: 'app-001',
    userId: 'user-001',
    userNickname: 'Alice',
    category: 'domestic',
    communityRole: 'Hero',
    eventLink: 'https://example.com/event',
    cfpScreenshotUrl: 'https://cdn.example.com/screenshot.png',
    flightCost: 1200,
    hotelCost: 600,
  };

  const rejectedApp = {
    applicationId: 'app-001',
    userId: 'user-001',
    applicantNickname: 'Alice',
    category: 'domestic' as const,
    communityRole: 'Hero' as const,
    eventLink: 'https://example.com/old-event',
    cfpScreenshotUrl: 'https://cdn.example.com/old.png',
    flightCost: 1000,
    hotelCost: 500,
    totalCost: 1500,
    status: 'rejected' as const,
    earnDeducted: 500,
    rejectReason: 'Incomplete info',
    reviewerId: 'admin-001',
    reviewerNickname: 'Admin',
    reviewedAt: '2024-01-15T00:00:00.000Z',
    createdAt: '2024-01-10T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
  };

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  function mockGetApplication(app: any) {
    client.send.mockResolvedValueOnce({ Item: app });
  }

  function mockEarnTotal(amounts: number[]) {
    client.send.mockResolvedValueOnce({
      Items: amounts.map((a) => ({ amount: a })),
      LastEvaluatedKey: undefined,
    });
  }

  function mockSettings(domesticThreshold = 500, internationalThreshold = 1000) {
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold,
        internationalThreshold,
      },
    });
  }

  function mockCategoryUsedCount(count: number, category: string = 'domestic') {
    // QueryCommand for pending+approved applications per category
    client.send.mockResolvedValueOnce({
      Items: Array.from({ length: count }, () => ({ category })),
      LastEvaluatedKey: undefined,
    });
  }

  function mockPutSuccess() {
    client.send.mockResolvedValueOnce({});
  }

  it('should return APPLICATION_NOT_FOUND when application does not exist', async () => {
    mockGetApplication(undefined);

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.APPLICATION_NOT_FOUND);
  });

  it('should return FORBIDDEN when application belongs to another user', async () => {
    mockGetApplication({ ...rejectedApp, userId: 'user-999' });

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('should return INVALID_APPLICATION_STATUS when application is not rejected', async () => {
    mockGetApplication({ ...rejectedApp, status: 'pending' });

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_APPLICATION_STATUS);
  });

  it('should return INVALID_APPLICATION_STATUS when application is approved', async () => {
    mockGetApplication({ ...rejectedApp, status: 'approved' });

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_APPLICATION_STATUS);
  });

  it('should return INSUFFICIENT_EARN_QUOTA when quota is insufficient', async () => {
    mockGetApplication(rejectedApp);
    mockEarnTotal([100]); // earnTotal = 100, floor(100/500) = 0
    mockSettings(500, 1000);
    mockCategoryUsedCount(0); // 0 used, but 0 total quota

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_EARN_QUOTA);
  });

  it('should successfully resubmit with same category', async () => {
    mockGetApplication(rejectedApp);
    mockEarnTotal([2000]); // earnTotal = 2000, floor(2000/500) = 4
    mockSettings(500, 1000);
    mockCategoryUsedCount(0); // 0 used
    mockPutSuccess();

    const result = await resubmitTravelApplication(baseResubmitInput, client, tables);

    expect(result.success).toBe(true);
    expect(result.application).toBeDefined();
    expect(result.application!.status).toBe('pending');
    expect(result.application!.category).toBe('domestic');
    expect(result.application!.earnDeducted).toBeUndefined();
    expect(result.application!.totalCost).toBe(1800); // 1200 + 600
    expect(result.application!.applicationId).toBe('app-001');
    // rejectReason and review info should be cleared
    expect(result.application!.rejectReason).toBeUndefined();
    expect(result.application!.reviewerId).toBeUndefined();
    expect(result.application!.reviewerNickname).toBeUndefined();
    expect(result.application!.reviewedAt).toBeUndefined();
    // createdAt should be preserved
    expect(result.application!.createdAt).toBe(rejectedApp.createdAt);
  });

  it('should successfully resubmit with different category', async () => {
    mockGetApplication(rejectedApp); // original was domestic
    mockEarnTotal([3000]); // earnTotal = 3000, floor(3000/1000) = 3
    mockSettings(500, 1000);
    mockCategoryUsedCount(0, 'international'); // 0 used for international
    mockPutSuccess();

    const result = await resubmitTravelApplication(
      { ...baseResubmitInput, category: 'international' },
      client,
      tables,
    );

    expect(result.success).toBe(true);
    expect(result.application!.category).toBe('international');
    expect(result.application!.earnDeducted).toBeUndefined();
  });

  it('should use PutCommand for application update', async () => {
    mockGetApplication(rejectedApp);
    mockEarnTotal([2000]);
    mockSettings(500, 1000);
    mockCategoryUsedCount(0);
    mockPutSuccess();

    await resubmitTravelApplication(baseResubmitInput, client, tables);

    // getApp + earnTotal query + settings + category count query + put = 5 calls
    expect(client.send).toHaveBeenCalledTimes(5);
    const lastCmd = client.send.mock.calls[4][0];
    expect(lastCmd.constructor.name).toBe('PutCommand');
  });

  it('should reject resubmit with invalid input fields', async () => {
    mockGetApplication(rejectedApp);

    const result = await resubmitTravelApplication(
      { ...baseResubmitInput, eventLink: 'not-a-url' },
      client,
      tables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });
});
