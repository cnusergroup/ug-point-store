import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock leaderboard modules
vi.mock('./ranking', () => ({
  validateRankingParams: vi.fn(),
  getRanking: vi.fn(),
}));
vi.mock('./announcements', () => ({
  validateAnnouncementParams: vi.fn(),
  getAnnouncements: vi.fn(),
}));

// Mock auth middleware — roles controlled by mockUserRoles; set to null to simulate unauthenticated
let mockUserRoles: string[] | null = ['Speaker'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      if (mockUserRoles === null) {
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          },
          body: JSON.stringify({ code: 'UNAUTHORIZED', message: '缺少访问令牌' }),
        };
      }
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
import { validateRankingParams, getRanking } from './ranking';
import { validateAnnouncementParams, getAnnouncements } from './announcements';

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

describe('Leaderboard Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['Speaker'];
  });

  // ---- 1. Route dispatch correctness ----

  describe('Route dispatch', () => {
    it('routes GET /api/leaderboard/ranking to handleGetRanking', async () => {
      vi.mocked(validateRankingParams).mockReturnValue({
        valid: true,
        options: { role: 'all', limit: 20 },
      } as any);
      vi.mocked(getRanking).mockResolvedValue({
        success: true,
        items: [],
        lastKey: null,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/ranking',
        queryStringParameters: { role: 'all', limit: '20' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(validateRankingParams).toHaveBeenCalled();
      expect(getRanking).toHaveBeenCalled();
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('lastKey');
    });

    it('routes GET /api/leaderboard/announcements to handleGetAnnouncements', async () => {
      vi.mocked(validateAnnouncementParams).mockReturnValue({
        valid: true,
        options: { limit: 20 },
      } as any);
      vi.mocked(getAnnouncements).mockResolvedValue({
        success: true,
        items: [],
        lastKey: null,
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/announcements',
        queryStringParameters: { limit: '20' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(validateAnnouncementParams).toHaveBeenCalled();
      expect(getAnnouncements).toHaveBeenCalled();
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('lastKey');
    });
  });

  // ---- 2. JWT verification — unauthenticated returns 401 ----

  describe('JWT verification', () => {
    it('returns 401 UNAUTHORIZED when user is not authenticated', async () => {
      mockUserRoles = null;
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/ranking',
        headers: {},
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  // ---- 3. OrderAdmin interception — returns 403 ----

  describe('OrderAdmin interception', () => {
    it('returns 403 FORBIDDEN with "无权访问" for OrderAdmin role', async () => {
      mockUserRoles = ['OrderAdmin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/ranking',
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('无权访问');
    });

    it('blocks OrderAdmin from accessing announcements as well', async () => {
      mockUserRoles = ['OrderAdmin'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/announcements',
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBe('无权访问');
    });
  });

  // ---- 4. CORS preflight ----

  describe('CORS preflight', () => {
    it('returns 200 for OPTIONS requests', async () => {
      const event = makeEvent({
        httpMethod: 'OPTIONS',
        path: '/api/leaderboard/ranking',
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Content-Type': 'application/json',
      });
    });
  });

  // ---- 5. Unknown routes return 404 ----

  describe('Unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/leaderboard/unknown',
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 404 for POST method on ranking route', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/leaderboard/ranking',
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});
