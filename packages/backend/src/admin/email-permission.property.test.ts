import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================================
// Feature: admin-email-permission, Property 3: Email notification API permission matrix
//
// For any combination of user role (Admin or SuperAdmin) and toggle state
// (true or false), the email notification API permission check should satisfy:
//   1. SuperAdmin is always allowed regardless of toggle state
//   2. Admin is allowed if and only if the corresponding toggle is true
//   3. Admin is denied with 403 if the corresponding toggle is false
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
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
  ScanCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'ScanCommand', input })),
  UpdateCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'UpdateCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

// ---- Mock admin modules ----

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
vi.mock('./superadmin-transfer', () => ({
  transferSuperAdmin: vi.fn(),
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
  sendNewProductNotification: vi.fn().mockResolvedValue({
    totalBatches: 1,
    successCount: 1,
    failureCount: 0,
  }),
  sendNewContentNotification: vi.fn().mockResolvedValue({
    totalBatches: 1,
    successCount: 1,
    failureCount: 0,
  }),
  sendPointsEarnedEmail: vi.fn(),
}));

// ---- Mock auth middleware — role is controlled per-test via mockUserRoles ----

let mockUserRoles: string[] = ['Admin'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'test-user-id',
        email: 'test@example.com',
        roles: mockUserRoles,
      };
      return innerHandler(event);
    };
  }),
}));

import { handler } from './handler';
import { getFeatureToggles } from '../settings/feature-toggles';

// ---- Helpers ----

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
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

function buildToggles(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    contentRolePermissions: {
      Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    },
    emailPointsEarnedEnabled: false,
    emailNewOrderEnabled: false,
    emailOrderShippedEnabled: false,
    emailNewProductEnabled: true,   // must be true so the global email toggle doesn't block first
    emailNewContentEnabled: true,   // must be true so the global email toggle doesn't block first
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
    ...overrides,
  };
}

// ---- Notification API endpoints under test ----

const EMAIL_APIS = [
  {
    name: 'send-product-notification',
    path: '/api/admin/email/send-product-notification',
    toggleKey: 'adminEmailProductsEnabled',
    body: JSON.stringify({ productList: 'Test product list' }),
  },
  {
    name: 'send-content-notification',
    path: '/api/admin/email/send-content-notification',
    toggleKey: 'adminEmailContentEnabled',
    body: JSON.stringify({ contentList: 'Test content list' }),
  },
] as const;

// ---- Tests ----

describe('Feature: admin-email-permission, Property 3: Email notification API permission matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['Admin'];

    // Mock ScanCommand to return empty subscriber list (so handler proceeds past scan)
    mockDynamoSend.mockResolvedValue({ Items: [] });
  });

  it(
    'SuperAdmin is always allowed regardless of toggle state for any email notification API',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EMAIL_APIS),
          fc.boolean(), // toggle state for the corresponding admin permission toggle
          async (api, toggleState) => {
            mockUserRoles = ['SuperAdmin'];

            vi.mocked(getFeatureToggles).mockResolvedValue(
              buildToggles({ [api.toggleKey]: toggleState }) as any,
            );

            const event = makeEvent({
              httpMethod: 'POST',
              path: api.path,
              body: api.body,
            });

            const result = await handler(event);

            // SuperAdmin should always succeed (200), never get 403
            expect(result.statusCode).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'Admin is allowed if and only if the corresponding toggle is true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EMAIL_APIS),
          fc.boolean(), // toggle state
          async (api, toggleState) => {
            mockUserRoles = ['Admin'];

            vi.mocked(getFeatureToggles).mockResolvedValue(
              buildToggles({ [api.toggleKey]: toggleState }) as any,
            );

            const event = makeEvent({
              httpMethod: 'POST',
              path: api.path,
              body: api.body,
            });

            const result = await handler(event);

            if (toggleState) {
              // Admin with toggle=true → allowed (200)
              expect(result.statusCode).toBe(200);
            } else {
              // Admin with toggle=false → denied (403)
              expect(result.statusCode).toBe(403);
              const body = JSON.parse(result.body);
              expect(body.code).toBe('FORBIDDEN');
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'permission matrix holds for all role × toggle × API combinations',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('Admin', 'SuperAdmin'),
          fc.boolean(), // adminEmailProductsEnabled
          fc.boolean(), // adminEmailContentEnabled
          fc.constantFrom(...EMAIL_APIS),
          async (role, productToggle, contentToggle, api) => {
            mockUserRoles = [role];

            const toggleValue = api.toggleKey === 'adminEmailProductsEnabled'
              ? productToggle
              : contentToggle;

            vi.mocked(getFeatureToggles).mockResolvedValue(
              buildToggles({
                adminEmailProductsEnabled: productToggle,
                adminEmailContentEnabled: contentToggle,
              }) as any,
            );

            const event = makeEvent({
              httpMethod: 'POST',
              path: api.path,
              body: api.body,
            });

            const result = await handler(event);

            if (role === 'SuperAdmin') {
              // SuperAdmin always allowed
              expect(result.statusCode).toBe(200);
            } else if (toggleValue) {
              // Admin with toggle=true → allowed
              expect(result.statusCode).toBe(200);
            } else {
              // Admin with toggle=false → denied
              expect(result.statusCode).toBe(403);
              const body = JSON.parse(result.body);
              expect(body.code).toBe('FORBIDDEN');
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
