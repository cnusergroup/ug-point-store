import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateExportInput,
  executeExport,
  isApproachingTimeout,
  type ExportInput,
} from './export';

// ============================================================
// Mock AWS SDK modules
// ============================================================

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input, constructor: { name: 'PutObjectCommand' } })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input, constructor: { name: 'GetObjectCommand' } })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

vi.mock('ulid', () => ({
  ulid: vi.fn().mockReturnValue('01HTEST00000000000000000'),
}));

// ============================================================
// Helpers
// ============================================================

const TABLES = {
  pointsRecordsTable: 'PointsRecords',
  usersTable: 'Users',
  batchDistributionsTable: 'BatchDistributions',
};

const BUCKET = 'test-images-bucket';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function createMockS3Client() {
  return { send: vi.fn() } as any;
}

// ============================================================
// 1. validateExportInput
// ============================================================

describe('validateExportInput', () => {
  it('should accept valid input with all fields', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      format: 'csv',
      filters: { startDate: '2024-01-01', endDate: '2024-01-31' },
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should accept valid input with xlsx format', () => {
    const result = validateExportInput({
      reportType: 'ug-activity-summary',
      format: 'xlsx',
      filters: {},
    });
    expect(result.valid).toBe(true);
  });

  it('should accept all four valid report types', () => {
    const types = ['points-detail', 'ug-activity-summary', 'user-points-ranking', 'activity-points-summary'];
    for (const reportType of types) {
      const result = validateExportInput({ reportType, format: 'csv', filters: {} });
      expect(result.valid).toBe(true);
    }
  });

  it('should accept input without filters', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      format: 'csv',
    });
    expect(result.valid).toBe(true);
  });

  it('should reject null body', () => {
    const result = validateExportInput(null);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject undefined body', () => {
    const result = validateExportInput(undefined);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject non-object body', () => {
    const result = validateExportInput('string');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject invalid reportType', () => {
    const result = validateExportInput({
      reportType: 'invalid-type',
      format: 'csv',
      filters: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REPORT_TYPE');
  });

  it('should reject missing reportType', () => {
    const result = validateExportInput({
      format: 'csv',
      filters: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REPORT_TYPE');
  });

  it('should reject invalid format', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      format: 'pdf',
      filters: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_EXPORT_FORMAT');
  });

  it('should reject missing format', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      filters: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_EXPORT_FORMAT');
  });

  it('should reject filters that is an array', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      format: 'csv',
      filters: [1, 2, 3],
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(result.error?.message).toContain('filters');
  });

  it('should reject filters that is a string', () => {
    const result = validateExportInput({
      reportType: 'points-detail',
      format: 'csv',
      filters: 'not-an-object',
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });
});

// ============================================================
// 2. isApproachingTimeout
// ============================================================

describe('isApproachingTimeout', () => {
  it('should return false when just started', () => {
    const startTime = Date.now();
    expect(isApproachingTimeout(startTime)).toBe(false);
  });

  it('should return false when well within time limit', () => {
    // 5 minutes ago
    const startTime = Date.now() - 5 * 60 * 1000;
    expect(isApproachingTimeout(startTime)).toBe(false);
  });

  it('should return false at 13 minutes (still 2 min buffer)', () => {
    const startTime = Date.now() - 13 * 60 * 1000;
    expect(isApproachingTimeout(startTime)).toBe(false);
  });

  it('should return true at exactly 14 minutes (1 min buffer reached)', () => {
    const startTime = Date.now() - 14 * 60 * 1000;
    expect(isApproachingTimeout(startTime)).toBe(true);
  });

  it('should return true when past 15 minutes', () => {
    const startTime = Date.now() - 16 * 60 * 1000;
    expect(isApproachingTimeout(startTime)).toBe(true);
  });

  it('should return true at exactly the boundary (15min - 60s = 14min)', () => {
    // Exactly at the boundary: elapsed = 14 * 60 * 1000 = 840000
    // maxDuration - buffer = 15*60*1000 - 60000 = 840000
    // elapsed >= 840000 → true
    const startTime = Date.now() - (15 * 60 * 1000 - 60_000);
    expect(isApproachingTimeout(startTime)).toBe(true);
  });
});

// ============================================================
// 3. executeExport — EXPORT_LIMIT_EXCEEDED
// ============================================================

describe('executeExport — EXPORT_LIMIT_EXCEEDED', () => {
  let dynamoClient: ReturnType<typeof createMockDynamoClient>;
  let s3Client: ReturnType<typeof createMockS3Client>;

  beforeEach(() => {
    dynamoClient = createMockDynamoClient();
    s3Client = createMockS3Client();
  });

  it('should return EXPORT_LIMIT_EXCEEDED when records exceed 50,000', async () => {
    // Simulate DynamoDB returning more than 50,000 records across pages
    // First page: 50,001 items with a LastEvaluatedKey to trigger the check
    const largeItems = Array.from({ length: 50_001 }, (_, i) => ({
      recordId: `r${i}`,
      userId: `u${i % 100}`,
      type: 'earn',
      amount: 10,
      source: 'batch',
      createdAt: '2024-01-15T00:00:00Z',
      activityUG: 'TestUG',
      activityTopic: 'Test',
      activityId: 'act-001',
      targetRole: 'Speaker',
    }));

    // Return all items in one page but with LastEvaluatedKey to simulate pagination
    dynamoClient.send.mockResolvedValueOnce({
      Items: largeItems,
      LastEvaluatedKey: undefined,
    });

    const input: ExportInput = {
      reportType: 'ug-activity-summary',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXPORT_LIMIT_EXCEEDED');
    expect(result.error?.message).toContain('导出数据量超过限制');
  });
});

// ============================================================
// 4. executeExport — S3 upload and presigned URL
// ============================================================

describe('executeExport — S3 upload and presigned URL', () => {
  let dynamoClient: ReturnType<typeof createMockDynamoClient>;
  let s3Client: ReturnType<typeof createMockS3Client>;

  beforeEach(() => {
    dynamoClient = createMockDynamoClient();
    s3Client = createMockS3Client();
    vi.clearAllMocks();
  });

  it('should upload CSV to S3 and return presigned URL for ug-activity-summary', async () => {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    // Mock DynamoDB query returning a small dataset
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1', userId: 'u1', type: 'earn', amount: 100,
          source: 'batch', createdAt: '2024-01-15T10:00:00Z',
          activityUG: 'Tokyo', activityTopic: 'Summit', activityId: 'act-1',
          targetRole: 'Speaker',
        },
        {
          recordId: 'r2', userId: 'u2', type: 'earn', amount: 200,
          source: 'batch', createdAt: '2024-01-16T10:00:00Z',
          activityUG: 'Tokyo', activityTopic: 'Summit', activityId: 'act-1',
          targetRole: 'Volunteer',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock S3 PutObject
    s3Client.send.mockResolvedValueOnce({});

    const input: ExportInput = {
      reportType: 'ug-activity-summary',
      format: 'csv',
      filters: { startDate: '2024-01-01T00:00:00Z', endDate: '2024-01-31T23:59:59Z' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');

    // Verify S3 PutObject was called
    expect(s3Client.send).toHaveBeenCalledTimes(1);
    const putCall = s3Client.send.mock.calls[0][0];
    expect(putCall.input.Bucket).toBe(BUCKET);
    expect(putCall.input.Key).toMatch(/^exports\/ug-activity-summary\/.+\.csv$/);
    expect(putCall.input.ContentType).toBe('text/csv; charset=utf-8');
    expect(putCall.input.Body).toBeInstanceOf(Buffer);

    // Verify getSignedUrl was called
    expect(getSignedUrl).toHaveBeenCalled();
  });

  it('should upload Excel to S3 and return presigned URL for user-points-ranking', async () => {
    // Mock DynamoDB query for earn records
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1', userId: 'u1', type: 'earn', amount: 500,
          source: 'batch', createdAt: '2024-01-15T10:00:00Z',
          activityUG: 'Tokyo', activityTopic: 'Summit', activityId: 'act-1',
          targetRole: 'Speaker',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock BatchGet for user nicknames
    dynamoClient.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
        ],
      },
    });

    // Mock S3 PutObject
    s3Client.send.mockResolvedValueOnce({});

    const input: ExportInput = {
      reportType: 'user-points-ranking',
      format: 'xlsx',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');

    // Verify S3 upload used xlsx content type
    const putCall = s3Client.send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^exports\/user-points-ranking\/.+\.xlsx$/);
    expect(putCall.input.ContentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('should handle points-detail export with earn and spend records', async () => {
    // Mock earn query
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1', userId: 'u1', type: 'earn', amount: 100,
          source: 'batch', createdAt: '2024-01-15T10:00:00Z',
          activityUG: 'Tokyo', activityTopic: 'Summit', activityId: 'act-1',
          targetRole: 'Speaker',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock spend query
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r2', userId: 'u2', type: 'spend', amount: 50,
          source: 'redemption', createdAt: '2024-01-16T10:00:00Z',
          activityUG: '', activityTopic: '', activityId: '',
          targetRole: '',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock BatchGet for user nicknames
    dynamoClient.send.mockResolvedValueOnce({
      Responses: {
        [TABLES.usersTable]: [
          { userId: 'u1', nickname: 'Alice' },
          { userId: 'u2', nickname: 'Bob' },
        ],
      },
    });

    // Mock BatchDistributions query
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        { activityId: 'act-1', targetRole: 'Speaker', distributorNickname: 'Admin' },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock S3 PutObject
    s3Client.send.mockResolvedValueOnce({});

    const input: ExportInput = {
      reportType: 'points-detail',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
  });

  it('should handle activity-points-summary export', async () => {
    // Mock DynamoDB query
    dynamoClient.send.mockResolvedValueOnce({
      Items: [
        {
          recordId: 'r1', userId: 'u1', type: 'earn', amount: 100,
          source: 'batch', createdAt: '2024-01-15T10:00:00Z',
          activityUG: 'Tokyo', activityTopic: 'Summit', activityId: 'act-1',
          activityDate: '2024-01-15', targetRole: 'Speaker',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Mock S3 PutObject
    s3Client.send.mockResolvedValueOnce({});

    const input: ExportInput = {
      reportType: 'activity-points-summary',
      format: 'xlsx',
      filters: { ugName: 'Tokyo' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
  });
});

// ============================================================
// 5. executeExport — timeout detection
// ============================================================

describe('executeExport — timeout detection', () => {
  let dynamoClient: ReturnType<typeof createMockDynamoClient>;
  let s3Client: ReturnType<typeof createMockS3Client>;

  beforeEach(() => {
    dynamoClient = createMockDynamoClient();
    s3Client = createMockS3Client();
  });

  it('should return EXPORT_TIMEOUT when approaching Lambda timeout', async () => {
    // Simulate a start time 14 minutes ago (past the buffer)
    const lambdaStartTime = Date.now() - 14 * 60 * 1000;

    // The query should detect timeout before even making a DynamoDB call
    const input: ExportInput = {
      reportType: 'ug-activity-summary',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET, lambdaStartTime);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXPORT_TIMEOUT');
    expect(result.error?.message).toContain('导出超时');
  });
});

// ============================================================
// 6. executeExport — error handling
// ============================================================

describe('executeExport — error handling', () => {
  let dynamoClient: ReturnType<typeof createMockDynamoClient>;
  let s3Client: ReturnType<typeof createMockS3Client>;

  beforeEach(() => {
    dynamoClient = createMockDynamoClient();
    s3Client = createMockS3Client();
  });

  it('should return INTERNAL_ERROR when DynamoDB query fails', async () => {
    dynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

    const input: ExportInput = {
      reportType: 'ug-activity-summary',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, TABLES, BUCKET);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});


// ============================================================
// 7. validateExportInput — new report types
// ============================================================

describe('validateExportInput — new report types', () => {
  const newTypes = [
    'popular-products',
    'hot-content',
    'content-contributors',
    'inventory-alert',
    'travel-statistics',
    'invite-conversion',
  ];

  it.each(newTypes)('should accept new report type: %s', (reportType) => {
    const result = validateExportInput({
      reportType,
      format: 'csv',
      filters: {},
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it.each(newTypes)('should accept new report type with xlsx format: %s', (reportType) => {
    const result = validateExportInput({
      reportType,
      format: 'xlsx',
      filters: {},
    });
    expect(result.valid).toBe(true);
  });

  it('should still reject invalid report types after expansion', () => {
    const result = validateExportInput({
      reportType: 'nonexistent-report',
      format: 'csv',
      filters: {},
    });
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_REPORT_TYPE');
  });

  it('should accept all 10 report types total', () => {
    const allTypes = [
      'points-detail', 'ug-activity-summary', 'user-points-ranking', 'activity-points-summary',
      ...newTypes,
    ];
    for (const reportType of allTypes) {
      const result = validateExportInput({ reportType, format: 'csv', filters: {} });
      expect(result.valid).toBe(true);
    }
  });
});

// ============================================================
// 8. executeExport — new report type branches
// ============================================================

// Mock insight-query module
vi.mock('./insight-query', () => ({
  queryPopularProducts: vi.fn(),
  queryHotContent: vi.fn(),
  queryContentContributors: vi.fn(),
  queryInventoryAlert: vi.fn(),
  queryTravelStatistics: vi.fn(),
  queryInviteConversion: vi.fn(),
}));

describe('executeExport — new report type branches', () => {
  let dynamoClient: ReturnType<typeof createMockDynamoClient>;
  let s3Client: ReturnType<typeof createMockS3Client>;

  const EXTENDED_TABLES = {
    ...TABLES,
    productsTable: 'Products',
    ordersTable: 'Orders',
    contentItemsTable: 'ContentItems',
    contentCategoriesTable: 'ContentCategories',
    travelApplicationsTable: 'TravelApplications',
    invitesTable: 'Invites',
  };

  beforeEach(() => {
    dynamoClient = createMockDynamoClient();
    s3Client = createMockS3Client();
    vi.clearAllMocks();
    // Mock S3 PutObject for all tests
    s3Client.send.mockResolvedValue({});
  });

  it('should export popular-products report as CSV', async () => {
    const { queryPopularProducts } = await import('./insight-query');
    (queryPopularProducts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [
        {
          productId: 'p1',
          productName: 'Test Product',
          productType: 'points',
          redemptionCount: 10,
          totalPointsSpent: 500,
          currentStock: 5,
          stockConsumptionRate: 66.7,
        },
      ],
    });

    const input: ExportInput = {
      reportType: 'popular-products',
      format: 'csv',
      filters: { startDate: '2024-01-01', endDate: '2024-12-31', productType: 'all' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryPopularProducts).toHaveBeenCalledWith(
      expect.objectContaining({ productType: 'all' }),
      dynamoClient,
      { ordersTable: 'Orders', productsTable: 'Products' },
    );
    const putCall = s3Client.send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^exports\/popular-products\/.+\.csv$/);
  });

  it('should export hot-content report as xlsx', async () => {
    const { queryHotContent } = await import('./insight-query');
    (queryHotContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [
        {
          contentId: 'c1',
          title: 'Hot Article',
          uploaderNickname: 'Author',
          categoryName: 'Tech',
          likeCount: 100,
          commentCount: 50,
          reservationCount: 20,
          engagementScore: 170,
        },
      ],
    });

    const input: ExportInput = {
      reportType: 'hot-content',
      format: 'xlsx',
      filters: { categoryId: 'cat-1' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryHotContent).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'cat-1' }),
      dynamoClient,
      { contentItemsTable: 'ContentItems', contentCategoriesTable: 'ContentCategories', usersTable: 'Users' },
    );
    const putCall = s3Client.send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^exports\/hot-content\/.+\.xlsx$/);
  });

  it('should export content-contributors report as CSV', async () => {
    const { queryContentContributors } = await import('./insight-query');
    (queryContentContributors as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [
        {
          rank: 1,
          userId: 'u1',
          nickname: 'TopContributor',
          approvedCount: 25,
          totalLikes: 300,
          totalComments: 150,
        },
      ],
    });

    const input: ExportInput = {
      reportType: 'content-contributors',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryContentContributors).toHaveBeenCalledWith(
      expect.any(Object),
      dynamoClient,
      { contentItemsTable: 'ContentItems', usersTable: 'Users' },
    );
  });

  it('should export inventory-alert report as CSV', async () => {
    const { queryInventoryAlert } = await import('./insight-query');
    (queryInventoryAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [
        {
          productId: 'p1',
          productName: 'Low Stock Item',
          productType: 'points',
          currentStock: 2,
          totalStock: 2,
          productStatus: 'active',
        },
      ],
    });

    const input: ExportInput = {
      reportType: 'inventory-alert',
      format: 'csv',
      filters: { stockThreshold: '10', productType: 'points', productStatus: 'active' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryInventoryAlert).toHaveBeenCalledWith(
      expect.objectContaining({ stockThreshold: 10, productType: 'points', productStatus: 'active' }),
      dynamoClient,
      { productsTable: 'Products' },
    );
  });

  it('should export travel-statistics report as xlsx', async () => {
    const { queryTravelStatistics } = await import('./insight-query');
    (queryTravelStatistics as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [
        {
          period: '2024-01',
          totalApplications: 10,
          approvedCount: 7,
          rejectedCount: 2,
          pendingCount: 1,
          approvalRate: 70.0,
          totalSponsoredAmount: 50000,
        },
      ],
    });

    const input: ExportInput = {
      reportType: 'travel-statistics',
      format: 'xlsx',
      filters: { periodType: 'month', category: 'domestic' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryTravelStatistics).toHaveBeenCalledWith(
      expect.objectContaining({ periodType: 'month', category: 'domestic' }),
      dynamoClient,
      { travelApplicationsTable: 'TravelApplications' },
    );
  });

  it('should export invite-conversion report as CSV with single record wrapped in array', async () => {
    const { queryInviteConversion } = await import('./insight-query');
    (queryInviteConversion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      record: {
        totalInvites: 100,
        usedCount: 60,
        expiredCount: 20,
        pendingCount: 20,
        conversionRate: 60.0,
      },
    });

    const input: ExportInput = {
      reportType: 'invite-conversion',
      format: 'csv',
      filters: { startDate: '2024-01-01', endDate: '2024-12-31' },
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(queryInviteConversion).toHaveBeenCalledWith(
      expect.any(Object),
      dynamoClient,
      { invitesTable: 'Invites' },
    );
    const putCall = s3Client.send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^exports\/invite-conversion\/.+\.csv$/);
  });

  it('should return error when insight query fails for popular-products', async () => {
    const { queryPopularProducts } = await import('./insight-query');
    (queryPopularProducts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });

    const input: ExportInput = {
      reportType: 'popular-products',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('should return error when invite-conversion query returns no record', async () => {
    const { queryInviteConversion } = await import('./insight-query');
    (queryInviteConversion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });

    const input: ExportInput = {
      reportType: 'invite-conversion',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('should use default stockThreshold of 5 when not provided for inventory-alert', async () => {
    const { queryInventoryAlert } = await import('./insight-query');
    (queryInventoryAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      records: [],
    });

    const input: ExportInput = {
      reportType: 'inventory-alert',
      format: 'csv',
      filters: {},
    };

    const result = await executeExport(input, dynamoClient, s3Client, EXTENDED_TABLES, BUCKET);

    expect(result.success).toBe(true);
    expect(queryInventoryAlert).toHaveBeenCalledWith(
      expect.objectContaining({ stockThreshold: 5 }),
      dynamoClient,
      { productsTable: 'Products' },
    );
  });
});
