import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Feature: order-admin-role, Property 2: OrderAdmin API 白名单强制执行
// For any admin API path (/api/admin/*) not in the order whitelist
// (GET /api/admin/orders, GET /api/admin/orders/stats,
//  GET /api/admin/orders/:id, PATCH /api/admin/orders/:id/shipping),
// when the requester role is ['OrderAdmin'], the system should return HTTP 403.
// **Validates: Requirements 3.4**

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

const { mockDynamoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: mockDynamoSend }) },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'GetCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
}));

// Mock admin modules
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

// Mock auth middleware - inject user with OrderAdmin role
let mockUserRoles: string[] = ['OrderAdmin'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      event.user = {
        userId: 'order-admin-user-id',
        email: 'orderadmin@example.com',
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

/**
 * Non-order admin API paths that OrderAdmin should NOT be able to access.
 * These cover all route categories handled by admin/handler.ts.
 */
const NON_ORDER_ADMIN_PATHS: { method: string; path: string }[] = [
  // Users
  { method: 'GET', path: '/api/admin/users' },
  { method: 'PATCH', path: '/api/admin/users/user-123/status' },
  { method: 'DELETE', path: '/api/admin/users/user-456' },
  { method: 'PUT', path: '/api/admin/users/user-789/roles' },
  // Codes
  { method: 'GET', path: '/api/admin/codes' },
  { method: 'POST', path: '/api/admin/codes/batch-generate' },
  { method: 'POST', path: '/api/admin/codes/product-code' },
  { method: 'PATCH', path: '/api/admin/codes/code-001/disable' },
  { method: 'DELETE', path: '/api/admin/codes/code-002' },
  // Products
  { method: 'POST', path: '/api/admin/products' },
  { method: 'PUT', path: '/api/admin/products/prod-1' },
  { method: 'PATCH', path: '/api/admin/products/prod-1/status' },
  { method: 'POST', path: '/api/admin/products/prod-1/upload-url' },
  { method: 'DELETE', path: '/api/admin/products/prod-1/images/abc.jpg' },
  // Invites
  { method: 'POST', path: '/api/admin/invites/batch' },
  { method: 'GET', path: '/api/admin/invites' },
  { method: 'PATCH', path: '/api/admin/invites/inv-001/revoke' },
  // Claims
  { method: 'GET', path: '/api/admin/claims' },
  { method: 'PATCH', path: '/api/admin/claims/claim-001/review' },
  // Content
  { method: 'GET', path: '/api/admin/content' },
  { method: 'PATCH', path: '/api/admin/content/content-001/review' },
  { method: 'DELETE', path: '/api/admin/content/content-002' },
  { method: 'POST', path: '/api/admin/content/categories' },
  { method: 'PUT', path: '/api/admin/content/categories/cat-001' },
  { method: 'DELETE', path: '/api/admin/content/categories/cat-002' },
  // Tags
  { method: 'GET', path: '/api/admin/tags' },
  { method: 'POST', path: '/api/admin/tags/merge' },
  { method: 'DELETE', path: '/api/admin/tags/tag-001' },
  // Settings
  { method: 'PUT', path: '/api/admin/settings/feature-toggles' },
  { method: 'PUT', path: '/api/admin/settings/invite-settings' },
  { method: 'PUT', path: '/api/admin/settings/content-role-permissions' },
  { method: 'PUT', path: '/api/admin/settings/travel-sponsorship' },
  // Batch points
  { method: 'POST', path: '/api/admin/batch-points' },
  { method: 'GET', path: '/api/admin/batch-points/history' },
  { method: 'GET', path: '/api/admin/batch-points/history/dist-001' },
  // Travel
  { method: 'GET', path: '/api/admin/travel/applications' },
  { method: 'PATCH', path: '/api/admin/travel/app-001/review' },
  // Images
  { method: 'POST', path: '/api/admin/images/upload-url' },
  // SuperAdmin transfer
  { method: 'POST', path: '/api/admin/superadmin/transfer' },
];

describe('Feature: order-admin-role, Property 2: OrderAdmin API 白名单强制执行', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['OrderAdmin'];
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
      updatedAt: '2024-01-01T00:00:00.000Z',
      updatedBy: 'system',
    } as any);
    vi.mocked(checkReviewPermission).mockImplementation((roles: string[]) =>
      roles.includes('SuperAdmin'),
    );
    vi.mocked(getInviteSettings).mockResolvedValue({ inviteExpiryDays: 1 });
  });

  it('OrderAdmin receives 403 for any non-order admin API path', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...NON_ORDER_ADMIN_PATHS),
        async (route) => {
          const event = makeEvent({
            httpMethod: route.method,
            path: route.path,
            body: route.method !== 'GET' && route.method !== 'DELETE'
              ? JSON.stringify({})
              : null,
          });
          const result = await handler(event);
          expect(result.statusCode).toBe(403);
          const body = JSON.parse(result.body);
          expect(body.code).toBe('FORBIDDEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: order-admin-role, Property 3: 非 SuperAdmin 不可操作 OrderAdmin 用户
// For any user operation (setUserStatus, deleteUser), when the target user's roles
// include OrderAdmin and the caller's roles do NOT include SuperAdmin, the operation
// should return { success: false } with a permission error.
// **Validates: Requirements 9.2, 9.3**

/**
 * All roles that are NOT SuperAdmin — used to generate non-SuperAdmin caller role combinations.
 */
const NON_SUPERADMIN_ROLES = ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'OrderAdmin'] as const;

describe('Feature: order-admin-role, Property 3: 非 SuperAdmin 不可操作 OrderAdmin 用户', () => {
  let realSetUserStatus: typeof import('./users').setUserStatus;
  let realDeleteUser: typeof import('./users').deleteUser;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import the real (unmocked) implementations
    const actual = await vi.importActual<typeof import('./users')>('./users');
    realSetUserStatus = actual.setUserStatus;
    realDeleteUser = actual.deleteUser;

    // Mock DynamoDB to return a user with OrderAdmin role for any GetCommand
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetCommand') {
        return Promise.resolve({
          Item: {
            userId: 'target-order-admin',
            email: 'orderadmin@example.com',
            nickname: 'OrderAdminUser',
            roles: ['OrderAdmin'],
            points: 0,
            status: 'active',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        });
      }
      return Promise.resolve({});
    });
  });

  it('non-SuperAdmin caller cannot setUserStatus on OrderAdmin user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...NON_SUPERADMIN_ROLES], { minLength: 1 }),
        fc.constantFrom('active' as const, 'disabled' as const),
        async (callerRoles, status) => {
          // Ensure caller does NOT have SuperAdmin
          expect(callerRoles).not.toContain('SuperAdmin');

          const fakeDynamoClient = { send: mockDynamoSend } as unknown as DynamoDBDocumentClient;
          const result = await realSetUserStatus(
            'target-order-admin',
            status,
            'caller-user-id',
            callerRoles as string[],
            fakeDynamoClient,
            'UsersTable',
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-SuperAdmin caller cannot deleteUser on OrderAdmin user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...NON_SUPERADMIN_ROLES], { minLength: 1 }),
        async (callerRoles) => {
          // Ensure caller does NOT have SuperAdmin
          expect(callerRoles).not.toContain('SuperAdmin');

          const fakeDynamoClient = { send: mockDynamoSend } as unknown as DynamoDBDocumentClient;
          const result = await realDeleteUser(
            'target-order-admin',
            'caller-user-id',  // different from target to avoid CANNOT_DELETE_SELF
            callerRoles as string[],
            fakeDynamoClient,
            'UsersTable',
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN');
        },
      ),
      { numRuns: 100 },
    );
  });
});
