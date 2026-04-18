import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================
// Mocks — must be set up before importing handler
// ============================================================

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

const { mockDynamoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: mockDynamoSend }) },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'GetCommand', input })),
  PutCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'PutCommand', input })),
  ScanCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'ScanCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

// Mock all admin modules that the handler imports
vi.mock('./roles', () => ({ assignRoles: vi.fn() }));
vi.mock('./codes', () => ({
  batchGeneratePointsCodes: vi.fn(),
  generateProductCodes: vi.fn(),
  listCodes: vi.fn(),
  disableCode: vi.fn(),
  deleteCode: vi.fn(),
}));
vi.mock('./products', () => ({
  createPointsProduct: vi.fn(),
  createCodeExclusiveProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductStatus: vi.fn(),
}));
vi.mock('./images', () => ({
  getUploadUrl: vi.fn(),
  getTempUploadUrl: vi.fn(),
  deleteImage: vi.fn(),
}));
vi.mock('./users', () => ({
  listUsers: vi.fn(),
  setUserStatus: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('./invites', () => ({
  batchGenerateInvites: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock('../claims/review', () => ({
  reviewClaim: vi.fn(),
  listAllClaims: vi.fn(),
}));
vi.mock('../content/admin', () => ({
  reviewContent: vi.fn(),
  listAllContent: vi.fn(),
  deleteContent: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock('../content/content-permission', () => ({
  checkReviewPermission: vi.fn(),
}));
vi.mock('../settings/feature-toggles', () => ({
  updateFeatureToggles: vi.fn(),
  updateContentRolePermissions: vi.fn(),
  getFeatureToggles: vi.fn(),
}));
vi.mock('../content/admin-tags', () => ({
  listAllTags: vi.fn(),
  mergeTags: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('./batch-points', () => ({
  executeBatchDistribution: vi.fn(),
  validateBatchDistributionInput: vi.fn(),
  listDistributionHistory: vi.fn(),
  getDistributionDetail: vi.fn(),
  getAwardedUserIds: vi.fn(),
}));
vi.mock('../travel/settings', () => ({
  updateTravelSettings: vi.fn(),
  validateTravelSettingsInput: vi.fn(),
}));
vi.mock('../travel/review', () => ({
  reviewTravelApplication: vi.fn(),
  listAllTravelApplications: vi.fn(),
}));
vi.mock('../settings/invite-settings', () => ({
  getInviteSettings: vi.fn(),
  updateInviteSettings: vi.fn(),
}));
vi.mock('./ug', () => ({
  createUG: vi.fn(),
  deleteUG: vi.fn(),
  updateUGStatus: vi.fn(),
  updateUGName: vi.fn(),
  listUGs: vi.fn(),
  assignLeader: vi.fn(),
  removeLeader: vi.fn(),
  getMyUGs: vi.fn(),
}));
vi.mock('./activities', () => ({
  listActivities: vi.fn(),
}));
vi.mock('../content/reservation-approval', () => ({
  reviewReservation: vi.fn(),
  listReservationApprovals: vi.fn(),
  getVisibleUGNames: vi.fn(),
}));
vi.mock('../reports/query', () => ({
  queryPointsDetail: vi.fn(),
  queryUGActivitySummary: vi.fn(),
  queryUserPointsRanking: vi.fn(),
  queryActivityPointsSummary: vi.fn(),
}));
vi.mock('../reports/export', () => ({
  executeExport: vi.fn(),
  validateExportInput: vi.fn(),
}));
vi.mock('../reports/insight-query', () => ({
  queryPopularProducts: vi.fn(),
  queryHotContent: vi.fn(),
  queryContentContributors: vi.fn(),
  queryInventoryAlert: vi.fn(),
  queryTravelStatistics: vi.fn(),
  queryInviteConversion: vi.fn(),
}));
vi.mock('../email/templates', () => ({
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  validateTemplateInput: vi.fn(),
  getRequiredVariables: vi.fn(),
}));
vi.mock('../email/seed', () => ({
  seedDefaultTemplates: vi.fn(),
}));
vi.mock('../email/notifications', () => ({
  sendNewProductNotification: vi.fn(),
  sendNewContentNotification: vi.fn(),
  sendPointsEarnedEmail: vi.fn(),
}));
vi.mock('./superadmin-transfer', () => ({
  transferSuperAdmin: vi.fn(),
}));

const { mockLambdaSend } = vi.hoisted(() => ({
  mockLambdaSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'InvokeCommand', input })),
}));

// Mock the meetup-api module
const mockTestMeetupConnection = vi.fn();
vi.mock('../sync/meetup-api', () => ({
  maskCookie: (value: string) => {
    if (!value || value.length <= 4) return value ? '****' : '';
    return '*'.repeat(value.length - 4) + value.slice(-4);
  },
  testMeetupConnection: (...args: any[]) => mockTestMeetupConnection(...args),
}));

// Mock the sync handler's getMeetupSyncConfig
const mockGetMeetupSyncConfig = vi.fn();
vi.mock('../sync/handler', () => ({
  getMeetupSyncConfig: (...args: any[]) => mockGetMeetupSyncConfig(...args),
}));

// Mock auth middleware
let mockUserRoles: string[] = ['SuperAdmin'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'admin-user-id',
        email: 'admin@example.com',
        roles: mockUserRoles,
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { getFeatureToggles } from '../settings/feature-toggles';
import { checkReviewPermission } from '../content/content-permission';
import { getInviteSettings } from '../settings/invite-settings';

// ============================================================
// Helpers
// ============================================================

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    body: null,
    headers: { Authorization: 'Bearer mock-token' },
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Admin Handler — Meetup Config Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['SuperAdmin'];
    // Default mocks for feature toggles and permissions
    vi.mocked(getFeatureToggles).mockResolvedValue({
      codeRedemptionEnabled: true,
      pointsClaimEnabled: true,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: true,
      contentRolePermissions: {
        Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      },
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 10,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
    } as any);
    vi.mocked(checkReviewPermission).mockImplementation((roles: string[]) =>
      roles.includes('SuperAdmin'),
    );
    vi.mocked(getInviteSettings).mockResolvedValue({ inviteExpiryDays: 1 });
  });

  // ── GET /api/admin/settings/meetup-sync-config ──

  describe('GET /api/admin/settings/meetup-sync-config', () => {
    it('returns config with masked cookies when config exists', async () => {
      mockGetMeetupSyncConfig.mockResolvedValue({
        settingKey: 'meetup-sync-config',
        groups: [{ urlname: 'aws-ughk', displayName: 'AWS UGHK' }],
        meetupToken: 'abcdefghijklmnop',
        meetupCsrf: 'csrf-token-value',
        meetupSession: 'session-value-12345',
        autoSyncEnabled: true,
        updatedAt: '2024-01-01T00:00:00Z',
        updatedBy: 'user-1',
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/meetup-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.groups).toEqual([{ urlname: 'aws-ughk', displayName: 'AWS UGHK' }]);
      // Cookies should be masked
      expect(body.meetupToken).toMatch(/^\*+.{4}$/);
      expect(body.meetupToken.endsWith('mnop')).toBe(true);
      expect(body.meetupCsrf).toMatch(/^\*+.{4}$/);
      expect(body.meetupSession).toMatch(/^\*+.{4}$/);
      expect(body.autoSyncEnabled).toBe(true);
    });

    it('returns default empty config when no config exists', async () => {
      mockGetMeetupSyncConfig.mockResolvedValue(null);

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/meetup-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.groups).toEqual([]);
      expect(body.meetupToken).toBe('');
      expect(body.meetupCsrf).toBe('');
      expect(body.meetupSession).toBe('');
      expect(body.autoSyncEnabled).toBe(false);
    });

    it('non-SuperAdmin gets 403', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/settings/meetup-sync-config',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── PUT /api/admin/settings/meetup-sync-config ──

  describe('PUT /api/admin/settings/meetup-sync-config', () => {
    it('updates config and returns masked cookies', async () => {
      // Mock existing config for masked value resolution
      mockGetMeetupSyncConfig.mockResolvedValue({
        settingKey: 'meetup-sync-config',
        groups: [],
        meetupToken: 'old-token-value',
        meetupCsrf: 'old-csrf-value',
        meetupSession: 'old-session-value',
        autoSyncEnabled: false,
        updatedAt: '2024-01-01T00:00:00Z',
        updatedBy: 'user-1',
      });
      mockDynamoSend.mockResolvedValue({});

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: JSON.stringify({
          groups: [{ urlname: 'new-group', displayName: 'New Group' }],
          meetupToken: 'new-token-12345678',
          meetupCsrf: 'new-csrf-value-abc',
          meetupSession: 'new-session-xyz',
          autoSyncEnabled: true,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.groups).toEqual([{ urlname: 'new-group', displayName: 'New Group' }]);
      expect(body.autoSyncEnabled).toBe(true);
      // Cookies should be masked in response
      expect(body.meetupToken).toMatch(/^\*+/);
      expect(body.meetupCsrf).toMatch(/^\*+/);
      expect(body.meetupSession).toMatch(/^\*+/);
    });

    it('retains existing cookie values when masked values are sent', async () => {
      mockGetMeetupSyncConfig.mockResolvedValue({
        settingKey: 'meetup-sync-config',
        groups: [{ urlname: 'g1', displayName: 'G1' }],
        meetupToken: 'real-token-value',
        meetupCsrf: 'real-csrf-value',
        meetupSession: 'real-session-value',
        autoSyncEnabled: false,
        updatedAt: '2024-01-01T00:00:00Z',
        updatedBy: 'user-1',
      });

      let savedItem: any = null;
      mockDynamoSend.mockImplementation(async (cmd: any) => {
        if (cmd._type === 'PutCommand') {
          savedItem = cmd.input.Item;
        }
        return {};
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: JSON.stringify({
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: '************alue',  // masked value starting with *
          meetupCsrf: '*********alue',      // masked value
          meetupSession: '***********alue', // masked value
          autoSyncEnabled: true,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);

      // The saved item should retain the original values
      expect(savedItem).not.toBeNull();
      expect(savedItem.meetupToken).toBe('real-token-value');
      expect(savedItem.meetupCsrf).toBe('real-csrf-value');
      expect(savedItem.meetupSession).toBe('real-session-value');
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when groups is not an array', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: JSON.stringify({ groups: 'not-an-array' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when group item is missing urlname', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: JSON.stringify({
          groups: [{ displayName: 'Missing URL' }],
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('non-SuperAdmin gets 403', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/meetup-sync-config',
        body: JSON.stringify({ groups: [] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── POST /api/admin/settings/meetup-sync-config/test ──

  describe('POST /api/admin/settings/meetup-sync-config/test', () => {
    it('returns success when connection test passes', async () => {
      mockTestMeetupConnection.mockResolvedValue({ success: true });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/settings/meetup-sync-config/test',
        body: JSON.stringify({
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).success).toBe(true);
    });

    it('returns failure when connection test fails', async () => {
      mockTestMeetupConnection.mockResolvedValue({
        success: false,
        error: { code: 'MEETUP_AUTH_EXPIRED', message: 'Auth expired' },
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/settings/meetup-sync-config/test',
        body: JSON.stringify({
          meetupToken: 'bad-tok',
          meetupCsrf: 'bad-csrf',
          meetupSession: 'bad-sess',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MEETUP_AUTH_EXPIRED');
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/settings/meetup-sync-config/test',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when meetupToken is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/settings/meetup-sync-config/test',
        body: JSON.stringify({
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('non-SuperAdmin gets 403', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/settings/meetup-sync-config/test',
        body: JSON.stringify({
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── POST /api/admin/sync/meetup ──

  describe('POST /api/admin/sync/meetup', () => {
    it('SuperAdmin can trigger meetup sync (returns 500 when SYNC_FUNCTION_NAME not configured)', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/meetup',
      });
      const result = await handler(event);
      // SYNC_FUNCTION_NAME is empty in test env, so handler returns 500
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('non-SuperAdmin gets 403', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/meetup',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });

  // ── POST /api/admin/sync/feishu ──

  describe('POST /api/admin/sync/feishu', () => {
    it('SuperAdmin can trigger feishu sync (returns 500 when SYNC_FUNCTION_NAME not configured)', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/feishu',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('non-SuperAdmin gets 403', async () => {
      mockUserRoles = ['Admin'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/sync/feishu',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
    });
  });
});
