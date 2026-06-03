import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================
// Mocks — declared before importing the handler under test.
//
// Strategy for task 7.5 (routing + authorization):
//  - Use the REAL `withAuth` middleware so the "unauthenticated" paths are
//    genuinely exercised. We mock ONLY `../auth/token.verifyToken` to control
//    token validity, and supply a benign default DynamoDB response so the
//    middleware's optional Users-table lookup never rejects a valid token
//    regardless of whether USERS_TABLE is set in the environment.
//  - Keep the REAL `assertSuperAdmin` (the actual authorization gate under
//    test) via a partial mock of `./association`, while mocking the CRUD I/O
//    functions so we can assert dispatch without touching DynamoDB.
//  - Mock the downstream business modules (eligibility / self-apply /
//    my-credentials) so we test routing + auth in isolation; their business
//    logic is covered by their own dedicated tests.
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
  QueryCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'QueryCommand', input })),
  ScanCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'ScanCommand', input })),
  DeleteCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'DeleteCommand', input })),
}));

vi.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  CreateInvalidationCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'CreateInvalidationCommand', input })),
}));

// Mock the JWT verification used by the real withAuth middleware.
const { mockVerifyToken } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
}));
vi.mock('../auth/token', () => ({
  verifyToken: mockVerifyToken,
}));

// Mock downstream business modules (routing isolation).
vi.mock('./render', () => ({
  renderCredentialPage: vi.fn(),
  render404Page: vi.fn().mockReturnValue('<html>404</html>'),
}));
vi.mock('./batch', () => ({
  batchCreateCredentials: vi.fn(),
}));
vi.mock('./revoke', () => ({
  revokeCredential: vi.fn(),
}));
vi.mock('./feishu-export', () => ({
  exportCredentialsToFeishu: vi.fn(),
}));
vi.mock('./eligibility', () => ({
  getMyApplications: vi.fn(),
}));
vi.mock('./self-apply', () => ({
  applyForCredential: vi.fn(),
}));
vi.mock('./my-credentials', () => ({
  getMyCredentials: vi.fn(),
}));

// Partial mock of ./association: keep the REAL assertSuperAdmin (the actual
// authorization gate), but mock the DynamoDB-backed CRUD functions.
vi.mock('./association', async () => {
  const actual = await vi.importActual<typeof import('./association')>('./association');
  return {
    ...actual,
    createAssociation: vi.fn(),
    updateAssociation: vi.fn(),
    deleteAssociation: vi.fn(),
    listAssociations: vi.fn(),
  };
});

import { handler } from './handler';
import { getMyApplications } from './eligibility';
import { applyForCredential } from './self-apply';
import { getMyCredentials } from './my-credentials';
import { createAssociation, deleteAssociation, listAssociations, updateAssociation } from './association';

// ============================================================
// Helpers
// ============================================================

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    body: null,
    headers: {},
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

/** Configure verifyToken to authenticate as a user with the given roles. */
function authAs(roles: string[], userId = 'user-1', email = 'user@example.com'): void {
  mockVerifyToken.mockResolvedValue({
    valid: true,
    payload: { userId, email, roles, rolesVersion: Date.now() + 1_000_000 },
  });
}

const AUTH_HEADER = { Authorization: 'Bearer valid-token' };

describe('Credential Lambda Handler — routing & authorization (task 7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Benign default Users-table lookup so the real withAuth never rejects a
    // valid token even if USERS_TABLE happens to be set. rolesVersion (1) is
    // far below the token's value, so token roles are preserved.
    mockDynamoSend.mockResolvedValue({
      Item: { userId: 'user-1', status: 'active', isEmployee: false, rolesVersion: 1 },
    });
  });

  // ----------------------------------------------------------
  // Unauthenticated access → authentication error, no business data (Req 9.9)
  // ----------------------------------------------------------
  describe('unauthenticated requests', () => {
    it('returns 401 when a user route is called without an Authorization header', async () => {
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/credentials/my-applications',
        headers: {},
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('UNAUTHORIZED');
      // No business data returned and the downstream handler never runs.
      expect(getMyApplications).not.toHaveBeenCalled();
    });

    it('returns 401 with an invalid token on a user route', async () => {
      mockVerifyToken.mockResolvedValue({ valid: false, error: 'INVALID_TOKEN' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/credentials/apply',
        headers: { Authorization: 'Bearer garbage' },
        body: JSON.stringify({ activityId: 'a1', sourceRole: 'Speaker', recipientName: 'Jane' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('INVALID_TOKEN');
      expect(applyForCredential).not.toHaveBeenCalled();
    });

    it('returns 401 (TOKEN_EXPIRED) when the token is expired on a user route', async () => {
      mockVerifyToken.mockResolvedValue({ valid: false, error: 'TOKEN_EXPIRED' });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/credentials/my-credentials',
        headers: { Authorization: 'Bearer expired' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('TOKEN_EXPIRED');
      expect(getMyCredentials).not.toHaveBeenCalled();
    });

    it('returns 401 when an admin association route is called without authentication', async () => {
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/credential-associations',
        headers: {},
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('UNAUTHORIZED');
      // The route's existence/structure is not exposed and CRUD never runs.
      expect(listAssociations).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Non-SuperAdmin hitting admin association routes → 403, no leak (Req 2.9, 9.7, 9.8)
  // ----------------------------------------------------------
  describe('admin association routes — authorization', () => {
    it('returns 403 for a regular (non-admin) user and does not leak internal structure', async () => {
      authAs(['Speaker', 'Volunteer']);
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/credential-associations',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      // Body exposes only { code, message } — no association data or internals.
      expect(Object.keys(body).sort()).toEqual(['code', 'message']);
      expect(body).not.toHaveProperty('associations');
      expect(listAssociations).not.toHaveBeenCalled();
    });

    it('returns 403 for an Admin (not SuperAdmin) on the association list route', async () => {
      authAs(['Admin']);
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/credential-associations',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(Object.keys(body).sort()).toEqual(['code', 'message']);
      expect(listAssociations).not.toHaveBeenCalled();
    });

    it('returns 403 for an Admin (not SuperAdmin) attempting to create an association', async () => {
      authAs(['Admin']);
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/credential-associations',
        headers: AUTH_HEADER,
        body: JSON.stringify({ activityId: 'a1', eventName: 'E' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      // No association is created when authorization fails (Req 2.9).
      expect(createAssociation).not.toHaveBeenCalled();
    });

    it('returns 403 for an Admin (not SuperAdmin) attempting to delete an association', async () => {
      authAs(['Admin']);
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/credential-associations/assoc-1',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
      expect(deleteAssociation).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Authenticated regular user → dispatched to the correct user handler
  // ----------------------------------------------------------
  describe('user routes — dispatch with authenticated userId', () => {
    it('routes GET /api/credentials/my-applications to getMyApplications with the authenticated userId', async () => {
      authAs(['Speaker'], 'user-42');
      vi.mocked(getMyApplications).mockResolvedValue({ items: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/credentials/my-applications',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ items: [] });
      expect(getMyApplications).toHaveBeenCalledWith('user-42', expect.anything(), expect.anything());
    });

    it('routes POST /api/credentials/apply to applyForCredential with the authenticated userId', async () => {
      authAs(['Speaker'], 'user-77');
      vi.mocked(applyForCredential).mockResolvedValue({
        success: true,
        credentialId: 'ACD-2026-Summer-SPK-0001',
        url: 'https://creds.awscommunity.cn/c/ACD-2026-Summer-SPK-0001',
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/credentials/apply',
        headers: AUTH_HEADER,
        body: JSON.stringify({ activityId: 'act-1', sourceRole: 'Speaker', recipientName: 'Jane Doe' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).credentialId).toBe('ACD-2026-Summer-SPK-0001');
      // First arg is the authenticated userId (client-supplied ids are ignored).
      expect(applyForCredential).toHaveBeenCalledWith(
        'user-77',
        expect.objectContaining({ activityId: 'act-1', sourceRole: 'Speaker', recipientName: 'Jane Doe' }),
        expect.anything(),
        expect.anything(),
        expect.any(String),
      );
    });

    it('routes GET /api/credentials/my-credentials to getMyCredentials with the authenticated userId', async () => {
      authAs(['Volunteer'], 'user-9');
      vi.mocked(getMyCredentials).mockResolvedValue({ items: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/credentials/my-credentials',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(getMyCredentials).toHaveBeenCalledWith('user-9', expect.anything(), expect.anything(), expect.any(String));
    });

    it('returns 404 for an unknown user-side credentials route', async () => {
      authAs(['Speaker']);
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/credentials/does-not-exist',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
    });
  });

  // ----------------------------------------------------------
  // Authenticated SuperAdmin → dispatched to association CRUD
  // ----------------------------------------------------------
  describe('admin association routes — SuperAdmin dispatch', () => {
    it('routes GET /api/admin/credential-associations to listAssociations for a SuperAdmin', async () => {
      authAs(['SuperAdmin']);
      vi.mocked(listAssociations).mockResolvedValue({ success: true, associations: [] });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/admin/credential-associations',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ associations: [] });
      expect(listAssociations).toHaveBeenCalledOnce();
    });

    it('routes POST /api/admin/credential-associations to createAssociation for a SuperAdmin', async () => {
      authAs(['SuperAdmin'], 'super-1');
      const association = {
        associationId: 'assoc-1',
        activityId: 'act-1',
        eventName: 'AWS Community Day',
        eventPrefix: 'ACD',
        year: '2026',
        season: 'Summer',
        allowedRoles: [{ role: 'Speaker', roleCode: 'SPK', identityText: 'Speaker' }],
        locale: 'en',
        issuingOrganization: 'AWS User Group China',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'super-1',
      };
      vi.mocked(createAssociation).mockResolvedValue({ success: true, association: association as any });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/admin/credential-associations',
        headers: AUTH_HEADER,
        body: JSON.stringify({
          activityId: 'act-1',
          eventName: 'AWS Community Day',
          eventPrefix: 'ACD',
          year: '2026',
          season: 'Summer',
          allowedRoles: [{ role: 'Speaker', identityText: 'Speaker' }],
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).associationId).toBe('assoc-1');
      expect(createAssociation).toHaveBeenCalledOnce();
      // createdBy is taken from the authenticated user.
      expect(vi.mocked(createAssociation).mock.calls[0][0]).toMatchObject({ createdBy: 'super-1' });
    });

    it('routes PUT /api/admin/credential-associations/{id} to updateAssociation for a SuperAdmin', async () => {
      authAs(['SuperAdmin'], 'super-2');
      vi.mocked(updateAssociation).mockResolvedValue({ success: true, association: { associationId: 'assoc-9' } as any });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/admin/credential-associations/assoc-9',
        headers: AUTH_HEADER,
        body: JSON.stringify({ eventName: 'Updated' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(updateAssociation).toHaveBeenCalledOnce();
      expect(vi.mocked(updateAssociation).mock.calls[0][0]).toMatchObject({
        associationId: 'assoc-9',
        updatedBy: 'super-2',
      });
    });

    it('routes DELETE /api/admin/credential-associations/{id} to deleteAssociation for a SuperAdmin', async () => {
      authAs(['SuperAdmin']);
      vi.mocked(deleteAssociation).mockResolvedValue({ success: true, associationId: 'assoc-3' });
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/api/admin/credential-associations/assoc-3',
        headers: AUTH_HEADER,
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ associationId: 'assoc-3' });
      expect(deleteAssociation).toHaveBeenCalledOnce();
    });
  });

  // ----------------------------------------------------------
  // CORS preflight
  // ----------------------------------------------------------
  describe('OPTIONS preflight', () => {
    it('returns 200 with CORS headers and does not require authentication', async () => {
      const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/credentials/apply' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
      });
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });
  });
});
