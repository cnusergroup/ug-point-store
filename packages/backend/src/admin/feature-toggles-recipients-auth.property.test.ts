import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================================
// Feature: ugl-inactivity-exit-flow, Property 13: Additional Notification
// Recipients CRUD correctness and authorization
//
// For any caller role set NOT containing 'SuperAdmin', PUT
// /api/admin/settings/feature-toggles (handleUpdateFeatureToggles's existing
// isSuperAdmin gate) rejects the call with 403 FORBIDDEN — regardless of the
// additionalNotificationRecipients payload — and never invokes
// updateFeatureToggles, so stored state is never modified.
//
// **Validates: Requirements 7.2, 7.3, 7.4, 7.5**
// ============================================================================

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

// ---- Mock the feature-toggles module the route calls into ----
// If the 403 gate is working, updateFeatureToggles should never be invoked.

const { mockUpdateFeatureToggles } = vi.hoisted(() => ({
  mockUpdateFeatureToggles: vi.fn(),
}));

vi.mock('../settings/feature-toggles', () => ({
  updateFeatureToggles: mockUpdateFeatureToggles,
  getFeatureToggles: vi.fn().mockResolvedValue({}),
  updateContentRolePermissions: vi.fn(),
  DEFAULT_POINTS_RULE_CONFIG: {},
}));

// ---- Mock every other module admin/handler.ts imports, so importing it doesn't
// pull in real DB/SES logic. Mirrors ugl-exit-routes.property.test.ts's mock set. ----

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
vi.mock('../ugl-exit/pending-exit-list', () => ({ queryPendingExitUGLs: vi.fn() }));
vi.mock('../ugl-exit/quarter', () => ({ resolveDetectionQuarter: vi.fn() }));
vi.mock('../ugl-exit/detection-job', () => ({ runUGLDetectionJob: vi.fn() }));
vi.mock('../ugl-exit/review-actions', () => ({ confirmExit: vi.fn(), restoreTracking: vi.fn() }));

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
    httpMethod: 'PUT',
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

/** Arbitrary generating an arbitrary additionalNotificationRecipients payload (well-formed or malformed, does not matter for the auth gate). */
const recipientsPayloadArb = fc.array(fc.string({ maxLength: 20 }), { maxLength: 5 });

describe('Feature: ugl-inactivity-exit-flow, Property 13: Additional Notification Recipients CRUD correctness and authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDynamoSend.mockReset();
    mockUpdateFeatureToggles.mockReset();
  });

  it(
    'PUT /api/admin/settings/feature-toggles returns 403 FORBIDDEN for any non-SuperAdmin caller, ' +
      'regardless of the additionalNotificationRecipients payload, and never invokes updateFeatureToggles',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonSuperAdminCallerRolesArb, recipientsPayloadArb, async (roles, additionalNotificationRecipients) => {
          mockUserRoles = roles;
          const event = makeEvent({
            httpMethod: 'PUT',
            path: '/api/admin/settings/feature-toggles',
            body: JSON.stringify({ additionalNotificationRecipients }),
          });

          const result = await handler(event);

          expect(result.statusCode).toBe(403);
          expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
          expect(mockUpdateFeatureToggles).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'SuperAdmin callers are allowed through the gate (updateFeatureToggles is invoked)',
    async () => {
      mockUserRoles = ['SuperAdmin'];
      mockUpdateFeatureToggles.mockResolvedValue({
        success: true,
        settings: { additionalNotificationRecipients: ['a@b.com'] },
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/settings/feature-toggles',
        body: JSON.stringify({ additionalNotificationRecipients: ['a@b.com'] }),
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockUpdateFeatureToggles).toHaveBeenCalledTimes(1);
    },
  );
});
