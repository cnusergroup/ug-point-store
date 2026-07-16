import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================
// Feature: ugl-inactivity-exit-flow, Property 16: Authorization gate for
// awaiting-reminder, send-reminder, pending-exit list, and review action endpoints
//
// For any caller role set NOT containing 'SuperAdmin' (but still admin-eligible,
// i.e. containing at least one of Admin/SuperAdmin/OrderAdmin so the outer isAdmin
// gate is passed and we're exercising the SuperAdmin-specific gate itself — OrderAdmin
// is excluded here since it is rejected earlier by the OrderAdmin whitelist, which is
// a separate, already-tested gate), all five ugl-exit admin routes:
//   GET  /api/admin/ugl-exit/awaiting-reminder
//   POST /api/admin/ugl-exit/send-reminder
//   GET  /api/admin/ugl-exit/pending
//   POST /api/admin/ugl-exit/detection-job
//   POST /api/admin/ugl-exit/{userId}/confirm-exit
//   POST /api/admin/ugl-exit/{userId}/restore-tracking
// return 403 FORBIDDEN, and the tracking table / target user's record is left
// completely unmodified — regardless of that user's current uglExitStatus.
//
// **Validates: Requirements 5.10, 12.2, 13.5**
// ============================================================

// ---- Mock AWS SDK clients before importing handler ----

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
  QueryCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'QueryCommand', input })),
  BatchGetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'BatchGetCommand', input })),
  UpdateCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'UpdateCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  InvokeCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'InvokeCommand', input })),
}));

// ---- Mock the ugl-exit modules the routes call into ----
// If the 403 gate is working, none of these should ever be invoked.

const {
  mockQueryPendingExitUGLs,
  mockRunUGLDetectionJob,
  mockConfirmExit,
  mockRestoreTracking,
  mockQueryAwaitingReminderUGLs,
  mockSendReminderAction,
} = vi.hoisted(() => ({
  mockQueryPendingExitUGLs: vi.fn(),
  mockRunUGLDetectionJob: vi.fn(),
  mockConfirmExit: vi.fn(),
  mockRestoreTracking: vi.fn(),
  mockQueryAwaitingReminderUGLs: vi.fn(),
  mockSendReminderAction: vi.fn(),
}));

vi.mock('../ugl-exit/pending-exit-list', () => ({
  queryPendingExitUGLs: mockQueryPendingExitUGLs,
}));
vi.mock('../ugl-exit/awaiting-reminder-list', () => ({
  queryAwaitingReminderUGLs: mockQueryAwaitingReminderUGLs,
}));
vi.mock('../ugl-exit/send-reminder-action', () => ({
  sendReminderAction: mockSendReminderAction,
}));
vi.mock('../ugl-exit/quarter', () => ({
  resolveDetectionQuarter: vi.fn(),
}));
vi.mock('../ugl-exit/detection-job', () => ({
  runUGLDetectionJob: mockRunUGLDetectionJob,
}));
vi.mock('../ugl-exit/review-actions', () => ({
  confirmExit: mockConfirmExit,
  restoreTracking: mockRestoreTracking,
}));

// ---- Mock every other module admin/handler.ts imports, so importing it doesn't
// pull in real DB/SES logic. Mirrors handler.test.ts's mock set. ----

vi.mock('./roles', () => ({ assignRoles: vi.fn() }));
vi.mock('./codes', () => ({
  batchGeneratePointsCodes: vi.fn(),
  generateProductCodes: vi.fn(),
  listCodes: vi.fn(),
  disableCode: vi.fn(),
  deleteCode: vi.fn(),
}));
vi.mock('./codes-distribution', () => ({
  distributeCodes: vi.fn(),
  resendCodeEmail: vi.fn(),
}));
vi.mock('./user-search', () => ({ searchUsers: vi.fn() }));
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
vi.mock('./invites', () => ({
  batchGenerateInvites: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock('./users', () => ({
  listUsers: vi.fn(),
  setUserStatus: vi.fn(),
  deleteUser: vi.fn(),
  unlockUser: vi.fn(),
}));
vi.mock('./batch-points', () => ({
  executeBatchDistribution: vi.fn(),
  validateBatchDistributionInput: vi.fn(),
  listDistributionHistory: vi.fn(),
  getDistributionDetail: vi.fn(),
  getAwardedUserIds: vi.fn(),
}));
vi.mock('./batch-points-adjust', () => ({ executeAdjustment: vi.fn() }));
vi.mock('../claims/review', () => ({ reviewClaim: vi.fn(), listAllClaims: vi.fn() }));
vi.mock('../content/admin', () => ({
  reviewContent: vi.fn(),
  listAllContent: vi.fn(),
  deleteContent: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock('../content/admin-tags', () => ({
  listAllTags: vi.fn(),
  mergeTags: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('./award-tags', () => ({
  searchAwardTags: vi.fn(),
  getHotAwardTags: vi.fn(),
  createAwardTag: vi.fn(),
  deleteAwardTag: vi.fn(),
  normalizeTagName: vi.fn(),
}));
vi.mock('./reward-tags', () => ({
  searchRewardTags: vi.fn(),
  getHotRewardTags: vi.fn(),
  createRewardTag: vi.fn(),
  deleteRewardTag: vi.fn(),
}));
vi.mock('./special-activity-award', () => ({ executeSpecialActivityDistribution: vi.fn() }));
vi.mock('./special-reward-award', () => ({ executeSpecialRewardDistribution: vi.fn() }));
vi.mock('../settings/feature-toggles', () => ({
  updateFeatureToggles: vi.fn(),
  getFeatureToggles: vi.fn().mockResolvedValue({}),
  updateContentRolePermissions: vi.fn(),
  DEFAULT_POINTS_RULE_CONFIG: {},
}));
vi.mock('../content/content-permission', () => ({ checkReviewPermission: vi.fn() }));
vi.mock('./product-permission', () => ({ checkProductPermission: vi.fn() }));
vi.mock('../settings/invite-settings', () => ({
  getInviteSettings: vi.fn(),
  updateInviteSettings: vi.fn(),
}));
vi.mock('./superadmin-transfer', () => ({ transferSuperAdmin: vi.fn() }));
vi.mock('../travel/settings', () => ({
  updateTravelSettings: vi.fn(),
  validateTravelSettingsInput: vi.fn(),
}));
vi.mock('../travel/review', () => ({
  reviewTravelApplication: vi.fn(),
  listAllTravelApplications: vi.fn(),
}));
vi.mock('../email/templates', () => ({
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  validateTemplateInput: vi.fn(),
  getRequiredVariables: vi.fn(),
}));
vi.mock('../email/seed', () => ({ seedDefaultTemplates: vi.fn() }));
vi.mock('../email/notifications', () => ({
  sendNewProductNotification: vi.fn(),
  sendNewContentNotification: vi.fn(),
  sendPointsEarnedEmail: vi.fn(),
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
vi.mock('./activities', () => ({ listActivities: vi.fn() }));
vi.mock('./skill-claims', () => ({ getSkillClaimsForActivity: vi.fn() }));
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
vi.mock('../sync/meetup-api', () => ({
  maskCookie: vi.fn(),
  testMeetupConnection: vi.fn(),
}));
vi.mock('../sync/handler', () => ({ getMeetupSyncConfig: vi.fn() }));
vi.mock('../reports/insight-query', () => ({
  queryPopularProducts: vi.fn(),
  queryHotContent: vi.fn(),
  queryContentContributors: vi.fn(),
  queryInventoryAlert: vi.fn(),
  queryTravelStatistics: vi.fn(),
  queryInviteConversion: vi.fn(),
  queryEmployeeEngagement: vi.fn(),
}));
vi.mock('../reports/inactive-ugl-query', () => ({ queryInactiveUGLs: vi.fn() }));
vi.mock('../participation/credential', () => ({ updateCredentialPassword: vi.fn() }));

// ---- Mock auth middleware — inject a caller with the given roles ----

let mockUserRoles: string[] = ['Admin'];
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

// Non-SuperAdmin caller role sets that still pass the outer isAdmin gate.
// OrderAdmin is excluded — it is rejected earlier by a separate whitelist gate
// unrelated to this property (already covered by handler.test.ts).
const nonSuperAdminCallerRolesArb = fc
  .subarray(['Admin', 'UserGroupLeader', 'Volunteer', 'Speaker'], { minLength: 1 })
  .map((roles) => (roles.includes('Admin') ? roles : [...roles, 'Admin']));

const uglExitStatusArb = fc.constantFrom<undefined | 'pending_exit' | 'other'>(
  undefined,
  'pending_exit',
  'other' as any,
);

const targetUserIdArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).filter((s) => s.length > 0);

describe('Feature: ugl-inactivity-exit-flow, Property 16: Authorization gate for awaiting-reminder, send-reminder, pending-exit list, and review action endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDynamoSend.mockReset();
    mockQueryPendingExitUGLs.mockReset();
    mockRunUGLDetectionJob.mockReset();
    mockConfirmExit.mockReset();
    mockRestoreTracking.mockReset();
    mockQueryAwaitingReminderUGLs.mockReset();
    mockSendReminderAction.mockReset();
  });

  it('GET /api/admin/ugl-exit/awaiting-reminder returns 403 FORBIDDEN for any non-SuperAdmin caller with no tracking-table access', async () => {
    await fc.assert(
      fc.asyncProperty(nonSuperAdminCallerRolesArb, async (roles) => {
        mockUserRoles = roles;
        // If the 403 gate were bypassed, the list query would read the tracking table —
        // fail loudly if any DB access happens.
        mockDynamoSend.mockRejectedValue(new Error('No DB access expected — 403 gate should short-circuit'));

        const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugl-exit/awaiting-reminder' });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
        expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
        expect(mockQueryAwaitingReminderUGLs).not.toHaveBeenCalled();
        expect(mockDynamoSend).not.toHaveBeenCalled();
      }),
      { numRuns: 50 },
    );
  });

  it('POST /api/admin/ugl-exit/send-reminder returns 403 FORBIDDEN for any non-SuperAdmin caller with no tracking-table mutation', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonSuperAdminCallerRolesArb,
        fc.array(targetUserIdArb, { maxLength: 5 }),
        async (roles, userIds) => {
          mockUserRoles = roles;
          // If the 403 gate were bypassed, sendReminderAction would mutate the tracking
          // table — fail loudly if any DB access happens.
          mockDynamoSend.mockRejectedValue(new Error('No DB access expected — 403 gate should short-circuit'));

          const event = makeEvent({
            httpMethod: 'POST',
            path: '/api/admin/ugl-exit/send-reminder',
            body: JSON.stringify({ userIds }),
          });

          const result = await handler(event);

          expect(result.statusCode).toBe(403);
          expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
          expect(mockSendReminderAction).not.toHaveBeenCalled();
          expect(mockDynamoSend).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('GET /api/admin/ugl-exit/pending returns 403 FORBIDDEN for any non-SuperAdmin caller', async () => {
    await fc.assert(
      fc.asyncProperty(nonSuperAdminCallerRolesArb, async (roles) => {
        mockUserRoles = roles;
        const event = makeEvent({ httpMethod: 'GET', path: '/api/admin/ugl-exit/pending' });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
        expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
        expect(mockQueryPendingExitUGLs).not.toHaveBeenCalled();
      }),
      { numRuns: 50 },
    );
  });

  it('POST /api/admin/ugl-exit/detection-job returns 403 FORBIDDEN for any non-SuperAdmin caller', async () => {
    await fc.assert(
      fc.asyncProperty(nonSuperAdminCallerRolesArb, async (roles) => {
        mockUserRoles = roles;
        const event = makeEvent({
          httpMethod: 'POST',
          path: '/api/admin/ugl-exit/detection-job',
          body: JSON.stringify({ quarter: '2024-Q1' }),
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(403);
        expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
        expect(mockRunUGLDetectionJob).not.toHaveBeenCalled();
      }),
      { numRuns: 50 },
    );
  });

  it(
    'POST /api/admin/ugl-exit/{userId}/confirm-exit returns 403 FORBIDDEN for any non-SuperAdmin caller ' +
      'and leaves the target user record unmodified regardless of uglExitStatus',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          nonSuperAdminCallerRolesArb,
          targetUserIdArb,
          uglExitStatusArb,
          async (roles, targetUserId, uglExitStatus) => {
            mockUserRoles = roles;
            // If the 403 gate were bypassed, confirmExit would read/write via dynamoClient —
            // fail loudly if that ever happens.
            mockDynamoSend.mockRejectedValue(new Error('No DB access expected — 403 gate should short-circuit'));

            const event = makeEvent({
              httpMethod: 'POST',
              path: `/api/admin/ugl-exit/${targetUserId}/confirm-exit`,
              body: null,
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(403);
            expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
            expect(mockConfirmExit).not.toHaveBeenCalled();
            expect(mockDynamoSend).not.toHaveBeenCalled();
            // uglExitStatus is unused beyond documenting "regardless of status" — no DB call
            // was made at all, so the target record (whatever its status) is provably untouched.
            void uglExitStatus;
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  it(
    'POST /api/admin/ugl-exit/{userId}/restore-tracking returns 403 FORBIDDEN for any non-SuperAdmin caller ' +
      'and leaves the target user record unmodified regardless of uglExitStatus',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          nonSuperAdminCallerRolesArb,
          targetUserIdArb,
          uglExitStatusArb,
          async (roles, targetUserId, uglExitStatus) => {
            mockUserRoles = roles;
            mockDynamoSend.mockRejectedValue(new Error('No DB access expected — 403 gate should short-circuit'));

            const event = makeEvent({
              httpMethod: 'POST',
              path: `/api/admin/ugl-exit/${targetUserId}/restore-tracking`,
              body: null,
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(403);
            expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
            expect(mockRestoreTracking).not.toHaveBeenCalled();
            expect(mockDynamoSend).not.toHaveBeenCalled();
            void uglExitStatus;
          },
        ),
        { numRuns: 50 },
      );
    },
  );
});
