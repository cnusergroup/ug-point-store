import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));

// Mock the points modules
vi.mock('./redeem-code', () => ({
  redeemCode: vi.fn(),
}));
vi.mock('./balance', () => ({
  getPointsBalance: vi.fn(),
}));
vi.mock('./records', () => ({
  getPointsRecords: vi.fn(),
}));
vi.mock('../user/profile', () => ({
  getUserProfile: vi.fn(),
}));
vi.mock('../claims/submit', () => ({
  submitClaim: vi.fn(),
  listMyClaims: vi.fn(),
}));
vi.mock('../settings/feature-toggles', () => ({
  getFeatureToggles: vi.fn(),
}));
vi.mock('../settings/invite-settings', () => ({
  getInviteSettings: vi.fn(),
}));
vi.mock('../travel/settings', () => ({
  getTravelSettings: vi.fn(),
}));
vi.mock('../travel/apply', () => ({
  getTravelQuota: vi.fn(),
  submitTravelApplication: vi.fn(),
  listMyTravelApplications: vi.fn(),
  resubmitTravelApplication: vi.fn(),
  validateTravelApplicationInput: vi.fn(),
}));

// Mock auth middleware - wrap the inner handler so we can inject user
let mockUserRoles: string[] = ['Speaker'];
vi.mock('../middleware/auth-middleware', () => ({
  withAuth: vi.fn((innerHandler: any) => {
    return async (event: any) => {
      // Simulate auth: attach a mock user
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
import { redeemCode } from './redeem-code';
import { getPointsBalance } from './balance';
import { getPointsRecords } from './records';
import { getUserProfile } from '../user/profile';
import { submitClaim } from '../claims/submit';
import { listMyClaims } from '../claims/submit';
import { getFeatureToggles } from '../settings/feature-toggles';
import { getInviteSettings } from '../settings/invite-settings';
import { getTravelSettings } from '../travel/settings';
import {
  getTravelQuota,
  submitTravelApplication,
  listMyTravelApplications,
  resubmitTravelApplication,
  validateTravelApplicationInput,
} from '../travel/apply';

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

describe('Points Lambda Handler - Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoles = ['Speaker'];
    // Default: both feature toggles enabled so existing tests pass
    vi.mocked(getFeatureToggles).mockResolvedValue({
      codeRedemptionEnabled: true,
      pointsClaimEnabled: true,
    });
  });

  it('returns 404 for unknown routes', async () => {
    const event = makeEvent({ httpMethod: 'GET', path: '/api/points/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).code).toBe('NOT_FOUND');
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/points/balance' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  describe('POST /api/points/redeem-code', () => {
    it('routes to redeemCode and returns earnedPoints on success', async () => {
      vi.mocked(redeemCode).mockResolvedValue({ success: true, earnedPoints: 100 });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({ code: 'ABC123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ earnedPoints: 100 });
      expect(redeemCode).toHaveBeenCalledWith(
        { code: 'ABC123', userId: 'test-user-id' },
        expect.anything(),
        expect.objectContaining({
          codesTable: '',
          usersTable: '',
          pointsRecordsTable: '',
        }),
      );
    });

    it('returns error when redeemCode fails with INVALID_CODE', async () => {
      vi.mocked(redeemCode).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CODE', message: '兑换码无效或不存在' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({ code: 'BAD' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_CODE');
    });

    it('returns error when redeemCode fails with CODE_ALREADY_USED', async () => {
      vi.mocked(redeemCode).mockResolvedValue({
        success: false,
        error: { code: 'CODE_ALREADY_USED', message: '兑换码已被使用' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({ code: 'USED' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('CODE_ALREADY_USED');
    });

    it('returns 400 when body is missing code field', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when body is null', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/points/balance', () => {
    it('routes to getPointsBalance and returns points', async () => {
      vi.mocked(getPointsBalance).mockResolvedValue({ success: true, points: 500 });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/points/balance',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ points: 500 });
      expect(getPointsBalance).toHaveBeenCalledWith('test-user-id', expect.anything(), '');
    });

    it('returns error when user not found', async () => {
      vi.mocked(getPointsBalance).mockResolvedValue({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/points/balance',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('USER_NOT_FOUND');
    });
  });

  describe('GET /api/points/records', () => {
    it('routes to getPointsRecords and returns items with page-based pagination', async () => {
      const mockItems = [
        { recordId: 'r1', userId: 'test-user-id', type: 'earn' as const, amount: 100, source: 'CODE1', balanceAfter: 100, createdAt: '2024-01-01T00:00:00Z' },
      ];
      vi.mocked(getPointsRecords).mockResolvedValue({
        success: true,
        items: mockItems,
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/points/records',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.items).toEqual(mockItems);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(getPointsRecords).toHaveBeenCalledWith(
        'test-user-id',
        expect.anything(),
        '',
        { page: undefined, pageSize: undefined },
      );
    });

    it('passes page and pageSize from query params', async () => {
      vi.mocked(getPointsRecords).mockResolvedValue({
        success: true,
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/points/records',
        queryStringParameters: { page: '2', pageSize: '10' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(10);
      expect(body.total).toBe(0);
      expect(body.items).toEqual([]);
      expect(getPointsRecords).toHaveBeenCalledWith(
        'test-user-id',
        expect.anything(),
        '',
        { page: 2, pageSize: 10 },
      );
    });

    it('returns error when records query fails', async () => {
      vi.mocked(getPointsRecords).mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '查询失败' },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/points/records',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Error handling', () => {
    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(redeemCode).mockRejectedValue(new Error('DynamoDB timeout'));
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({ code: 'ABC' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in all responses', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/points/unknown' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('POST /api/claims', () => {
    it('routes to submitClaim and returns 201 on success', async () => {
      vi.mocked(getUserProfile).mockResolvedValue({
        success: true,
        profile: { userId: 'test-user-id', nickname: 'TestUser', email: 'test@example.com', roles: ['Speaker'], points: 0, createdAt: '2024-01-01T00:00:00Z' },
      });
      const mockClaim = {
        claimId: 'claim-1',
        userId: 'test-user-id',
        applicantNickname: 'TestUser',
        applicantRole: 'Speaker',
        title: 'My Contribution',
        description: 'I gave a talk',
        imageUrls: [],
        status: 'pending' as const,
        createdAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(submitClaim).mockResolvedValue({ success: true, claim: mockClaim });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/claims',
        body: JSON.stringify({ title: 'My Contribution', description: 'I gave a talk' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).claim).toEqual(mockClaim);
      expect(submitClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-id',
          userRoles: ['Speaker'],
          title: 'My Contribution',
          description: 'I gave a talk',
        }),
        expect.anything(),
        '',
      );
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/claims',
        body: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when submitClaim fails', async () => {
      vi.mocked(getUserProfile).mockResolvedValue({
        success: true,
        profile: { userId: 'test-user-id', nickname: 'TestUser', email: 'test@example.com', roles: ['Speaker'], points: 0, createdAt: '2024-01-01T00:00:00Z' },
      });
      vi.mocked(submitClaim).mockResolvedValue({
        success: false,
        error: { code: 'CLAIM_ROLE_NOT_ALLOWED', message: '当前角色无法申请积分' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/claims',
        body: JSON.stringify({ title: 'Test', description: 'Test' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('CLAIM_ROLE_NOT_ALLOWED');
    });
  });

  describe('GET /api/settings/feature-toggles (public route)', () => {
    it('returns feature toggle settings without auth', async () => {
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/settings/feature-toggles',
        headers: {}, // no Authorization header
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.codeRedemptionEnabled).toBe(true);
      expect(body.pointsClaimEnabled).toBe(false);
    });
  });

  describe('POST /api/points/redeem-code feature toggle interception', () => {
    it('returns 403 FEATURE_DISABLED when codeRedemptionEnabled is false', async () => {
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: false,
        pointsClaimEnabled: true,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/points/redeem-code',
        body: JSON.stringify({ code: 'ABC123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FEATURE_DISABLED');
    });
  });

  describe('POST /api/claims feature toggle interception', () => {
    it('returns 403 FEATURE_DISABLED when pointsClaimEnabled is false', async () => {
      vi.mocked(getFeatureToggles).mockResolvedValue({
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/claims',
        body: JSON.stringify({ title: 'Test', description: 'Test' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FEATURE_DISABLED');
    });
  });

  describe('GET /api/claims', () => {
    it('routes to listMyClaims and returns claims', async () => {
      const mockClaims = [
        {
          claimId: 'claim-1',
          userId: 'test-user-id',
          applicantNickname: 'TestUser',
          applicantRole: 'Speaker',
          title: 'Talk',
          description: 'Gave a talk',
          imageUrls: [],
          status: 'pending' as const,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(listMyClaims).mockResolvedValue({ success: true, claims: mockClaims });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/claims',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).claims).toEqual(mockClaims);
      expect(listMyClaims).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'test-user-id' }),
        expect.anything(),
        '',
      );
    });

    it('passes status, pageSize and lastKey query params', async () => {
      vi.mocked(listMyClaims).mockResolvedValue({ success: true, claims: [], lastKey: undefined });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/claims',
        queryStringParameters: { status: 'approved', pageSize: '10', lastKey: 'some-key' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(listMyClaims).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'test-user-id', status: 'approved', pageSize: 10, lastKey: 'some-key' }),
        expect.anything(),
        '',
      );
    });
  });

  // ── Travel Sponsorship Routes ──────────────────────────────

  describe('GET /api/settings/travel-sponsorship (public route)', () => {
    it('returns travel sponsorship settings without auth', async () => {
      vi.mocked(getTravelSettings).mockResolvedValue({
        travelSponsorshipEnabled: true,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/settings/travel-sponsorship',
        headers: {}, // no Authorization header
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.travelSponsorshipEnabled).toBe(true);
      expect(body.domesticThreshold).toBe(500);
      expect(body.internationalThreshold).toBe(1000);
    });

    it('returns 500 when getTravelSettings throws', async () => {
      vi.mocked(getTravelSettings).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/settings/travel-sponsorship',
        headers: {},
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  // ── Invite Settings Routes ──────────────────────────────

  describe('GET /api/settings/invite-settings (public route)', () => {
    it('returns invite settings without auth', async () => {
      vi.mocked(getInviteSettings).mockResolvedValue({ inviteExpiryDays: 3 });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/settings/invite-settings',
        headers: {}, // no Authorization header
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.inviteExpiryDays).toBe(3);
    });

    it('returns 500 when getInviteSettings throws', async () => {
      vi.mocked(getInviteSettings).mockRejectedValue(new Error('DB error'));
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/settings/invite-settings',
        headers: {},
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/travel/quota', () => {
    it('routes to getTravelQuota for Speaker and returns quota', async () => {
      mockUserRoles = ['Speaker'];
      const mockQuota = {
        earnTotal: 2000,
        travelEarnUsed: 500,
        domesticAvailable: 3,
        internationalAvailable: 1,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      };
      vi.mocked(getTravelQuota).mockResolvedValue(mockQuota);
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/travel/quota',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockQuota);
      expect(getTravelQuota).toHaveBeenCalledWith(
        'test-user-id',
        expect.anything(),
        expect.objectContaining({ usersTable: '', pointsRecordsTable: '' }),
      );
    });

    it('returns 403 TRAVEL_SPEAKER_ONLY when user is not Speaker', async () => {
      mockUserRoles = ['Volunteer'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/travel/quota',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('TRAVEL_SPEAKER_ONLY');
      expect(getTravelQuota).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/travel/apply', () => {
    it('routes to submitTravelApplication for Speaker and returns 201', async () => {
      mockUserRoles = ['Speaker'];
      vi.mocked(getTravelSettings).mockResolvedValue({
        travelSponsorshipEnabled: true,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      });
      vi.mocked(validateTravelApplicationInput).mockReturnValue({
        valid: true,
        data: {
          category: 'domestic',
          communityRole: 'Hero',
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
        },
      } as any);
      vi.mocked(getUserProfile).mockResolvedValue({
        success: true,
        profile: { userId: 'test-user-id', nickname: 'TestUser', email: 'test@example.com', roles: ['Speaker'], points: 0, createdAt: '2024-01-01T00:00:00Z' },
      });
      const mockApplication = {
        applicationId: 'app-1',
        userId: 'test-user-id',
        applicantNickname: 'TestUser',
        category: 'domestic' as const,
        communityRole: 'Hero' as const,
        eventLink: 'https://example.com/event',
        cfpScreenshotUrl: 'https://example.com/screenshot.png',
        flightCost: 1000,
        hotelCost: 500,
        totalCost: 1500,
        status: 'pending' as const,
        earnDeducted: 500,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(submitTravelApplication).mockResolvedValue({ success: true, application: mockApplication });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/travel/apply',
        body: JSON.stringify({
          category: 'domestic',
          communityRole: 'Hero',
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).application).toEqual(mockApplication);
      expect(submitTravelApplication).toHaveBeenCalled();
    });

    it('returns 403 TRAVEL_SPEAKER_ONLY when user is not Speaker', async () => {
      mockUserRoles = ['Volunteer'];
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/travel/apply',
        body: JSON.stringify({ category: 'domestic' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('TRAVEL_SPEAKER_ONLY');
      expect(submitTravelApplication).not.toHaveBeenCalled();
    });

    it('returns 403 FEATURE_DISABLED when travel sponsorship is disabled', async () => {
      mockUserRoles = ['Speaker'];
      vi.mocked(getTravelSettings).mockResolvedValue({
        travelSponsorshipEnabled: false,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/travel/apply',
        body: JSON.stringify({ category: 'domestic' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('FEATURE_DISABLED');
      expect(submitTravelApplication).not.toHaveBeenCalled();
    });

    it('returns 400 when validation fails', async () => {
      mockUserRoles = ['Speaker'];
      vi.mocked(getTravelSettings).mockResolvedValue({
        travelSponsorshipEnabled: true,
        domesticThreshold: 500,
        internationalThreshold: 1000,
      });
      vi.mocked(validateTravelApplicationInput).mockReturnValue({
        valid: false,
        error: { code: 'INVALID_REQUEST', message: 'category 必须为 domestic 或 international' },
      } as any);
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/travel/apply',
        body: JSON.stringify({ category: 'invalid' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('GET /api/travel/my-applications', () => {
    it('routes to listMyTravelApplications for Speaker', async () => {
      mockUserRoles = ['Speaker'];
      const mockApplications = [
        {
          applicationId: 'app-1',
          userId: 'test-user-id',
          applicantNickname: 'TestUser',
          category: 'domestic' as const,
          communityRole: 'Hero' as const,
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
          totalCost: 1500,
          status: 'pending' as const,
          earnDeducted: 500,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      vi.mocked(listMyTravelApplications).mockResolvedValue({
        applications: mockApplications,
        lastKey: undefined,
      } as any);
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/travel/my-applications',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).applications).toEqual(mockApplications);
      expect(listMyTravelApplications).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'test-user-id' }),
        expect.anything(),
        '',
      );
    });

    it('returns 403 TRAVEL_SPEAKER_ONLY when user is not Speaker', async () => {
      mockUserRoles = ['Volunteer'];
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/travel/my-applications',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('TRAVEL_SPEAKER_ONLY');
      expect(listMyTravelApplications).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/travel/applications/{id}', () => {
    it('routes to resubmitTravelApplication for Speaker', async () => {
      mockUserRoles = ['Speaker'];
      vi.mocked(validateTravelApplicationInput).mockReturnValue({
        valid: true,
        data: {
          category: 'international',
          communityRole: 'CommunityBuilder',
          eventLink: 'https://example.com/event2',
          cfpScreenshotUrl: 'https://example.com/screenshot2.png',
          flightCost: 2000,
          hotelCost: 800,
        },
      } as any);
      vi.mocked(getUserProfile).mockResolvedValue({
        success: true,
        profile: { userId: 'test-user-id', nickname: 'TestUser', email: 'test@example.com', roles: ['Speaker'], points: 0, createdAt: '2024-01-01T00:00:00Z' },
      });
      const mockApplication = {
        applicationId: 'app-1',
        userId: 'test-user-id',
        applicantNickname: 'TestUser',
        category: 'international' as const,
        communityRole: 'CommunityBuilder' as const,
        eventLink: 'https://example.com/event2',
        cfpScreenshotUrl: 'https://example.com/screenshot2.png',
        flightCost: 2000,
        hotelCost: 800,
        totalCost: 2800,
        status: 'pending' as const,
        earnDeducted: 1000,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      vi.mocked(resubmitTravelApplication).mockResolvedValue({ success: true, application: mockApplication });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/travel/applications/app-1',
        body: JSON.stringify({
          category: 'international',
          communityRole: 'CommunityBuilder',
          eventLink: 'https://example.com/event2',
          cfpScreenshotUrl: 'https://example.com/screenshot2.png',
          flightCost: 2000,
          hotelCost: 800,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).application).toEqual(mockApplication);
      expect(resubmitTravelApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-1',
          userId: 'test-user-id',
          userNickname: 'TestUser',
        }),
        expect.anything(),
        expect.objectContaining({
          usersTable: '',
          pointsRecordsTable: '',
          travelApplicationsTable: '',
        }),
      );
    });

    it('returns 403 TRAVEL_SPEAKER_ONLY when user is not Speaker', async () => {
      mockUserRoles = ['Volunteer'];
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/travel/applications/app-1',
        body: JSON.stringify({ category: 'domestic' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).code).toBe('TRAVEL_SPEAKER_ONLY');
      expect(resubmitTravelApplication).not.toHaveBeenCalled();
    });

    it('returns error when resubmitTravelApplication fails', async () => {
      mockUserRoles = ['Speaker'];
      vi.mocked(validateTravelApplicationInput).mockReturnValue({
        valid: true,
        data: {
          category: 'domestic',
          communityRole: 'Hero',
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
        },
      } as any);
      vi.mocked(getUserProfile).mockResolvedValue({
        success: true,
        profile: { userId: 'test-user-id', nickname: 'TestUser', email: 'test@example.com', roles: ['Speaker'], points: 0, createdAt: '2024-01-01T00:00:00Z' },
      });
      vi.mocked(resubmitTravelApplication).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_APPLICATION_STATUS', message: '仅被驳回的申请可以编辑重新提交' },
      });
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/api/travel/applications/app-1',
        body: JSON.stringify({
          category: 'domestic',
          communityRole: 'Hero',
          eventLink: 'https://example.com/event',
          cfpScreenshotUrl: 'https://example.com/screenshot.png',
          flightCost: 1000,
          hotelCost: 500,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_APPLICATION_STATUS');
    });
  });
});
