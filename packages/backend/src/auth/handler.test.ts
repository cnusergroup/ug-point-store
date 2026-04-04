import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({}) },
}));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({})),
}));

// Mock the auth modules
vi.mock('./register', () => ({
  registerUser: vi.fn(),
}));
vi.mock('./login', () => ({
  loginUser: vi.fn(),
}));
vi.mock('./verify-email', () => ({
  verifyEmail: vi.fn(),
}));
vi.mock('./wechat', () => ({
  getWechatQrCode: vi.fn(),
  handleWechatCallback: vi.fn(),
}));
vi.mock('./token', () => ({
  generateToken: vi.fn().mockReturnValue('mock-jwt-token'),
  verifyToken: vi.fn(),
}));
vi.mock('./change-password', () => ({
  changePassword: vi.fn(),
}));
vi.mock('./forgot-password', () => ({
  forgotPassword: vi.fn(),
}));
vi.mock('./reset-password', () => ({
  resetPassword: vi.fn(),
}));

import { handler } from './handler';
import { registerUser } from './register';
import { loginUser } from './login';
import { verifyEmail } from './verify-email';
import { getWechatQrCode, handleWechatCallback } from './wechat';
import { generateToken, verifyToken } from './token';
import { changePassword } from './change-password';
import { forgotPassword } from './forgot-password';
import { resetPassword } from './reset-password';

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

describe('Auth Lambda Handler - Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for unknown routes', async () => {
    const event = makeEvent({ httpMethod: 'GET', path: '/api/auth/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const event = makeEvent({ httpMethod: 'OPTIONS', path: '/api/auth/login' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  describe('POST /api/auth/register', () => {
    it('routes to registerUser and returns 201 on success with token', async () => {
      const mockUser = { userId: 'user-123', email: 'a@b.com', nickname: 'Test', roles: ['Volunteer'], points: 0 };
      vi.mocked(registerUser).mockResolvedValue({ success: true, userId: 'user-123', user: mockUser });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/register',
        body: JSON.stringify({ email: 'a@b.com', password: 'Pass1234', nickname: 'Test', inviteToken: 'a'.repeat(64) }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.accessToken).toBeDefined();
      expect(body.user).toEqual(mockUser);
      expect(registerUser).toHaveBeenCalledOnce();
    });

    it('returns error when registerUser fails', async () => {
      vi.mocked(registerUser).mockResolvedValue({
        success: false,
        error: { code: 'EMAIL_ALREADY_EXISTS', message: '邮箱已被注册' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/register',
        body: JSON.stringify({ email: 'a@b.com', password: 'Pass1234', nickname: 'Test', inviteToken: 'a'.repeat(64) }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('returns 400 when body is missing required fields', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/register',
        body: JSON.stringify({ email: 'a@b.com' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('POST /api/auth/login', () => {
    it('routes to loginUser and returns token on success', async () => {
      vi.mocked(loginUser).mockResolvedValue({
        success: true,
        user: { userId: 'u1', email: 'a@b.com', nickname: 'N', roles: [], points: 0, emailVerified: true },
      });
      vi.mocked(generateToken).mockReturnValue('jwt-token');
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/login',
        body: JSON.stringify({ email: 'a@b.com', password: 'Pass1234' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.accessToken).toBe('jwt-token');
      expect(body.user.userId).toBe('u1');
      expect(generateToken).toHaveBeenCalledWith({
        userId: 'u1', email: 'a@b.com', roles: [],
      });
    });

    it('returns error when login fails', async () => {
      vi.mocked(loginUser).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/login',
        body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 400 when body is missing fields', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/login',
        body: JSON.stringify({ email: 'a@b.com' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /api/auth/verify-email', () => {
    it('routes to verifyEmail with token from query params', async () => {
      vi.mocked(verifyEmail).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/auth/verify-email',
        queryStringParameters: { token: 'verify-tok' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(verifyEmail).toHaveBeenCalledWith('verify-tok', expect.anything(), expect.anything());
    });

    it('returns 400 when token query param is missing', async () => {
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/auth/verify-email',
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when verifyEmail fails', async () => {
      vi.mocked(verifyEmail).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_TOKEN', message: '验证令牌无效' },
      });
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/api/auth/verify-email',
        queryStringParameters: { token: 'bad-tok' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/wechat/qrcode', () => {
    it('routes to getWechatQrCode and returns authUrl', async () => {
      vi.mocked(getWechatQrCode).mockReturnValue({
        success: true, authUrl: 'https://wx.qq.com/auth', state: 'st-1',
      });
      const event = makeEvent({ httpMethod: 'POST', path: '/api/auth/wechat/qrcode' });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.authUrl).toBe('https://wx.qq.com/auth');
      expect(body.state).toBe('st-1');
    });

    it('returns 500 when wechat config is missing', async () => {
      vi.mocked(getWechatQrCode).mockReturnValue({
        success: false, error: { code: 'WECHAT_CONFIG_ERROR', message: '微信登录配置缺失' },
      });
      const event = makeEvent({ httpMethod: 'POST', path: '/api/auth/wechat/qrcode' });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
    });
  });

  describe('POST /api/auth/wechat/callback', () => {
    it('routes to handleWechatCallback and returns token', async () => {
      vi.mocked(handleWechatCallback).mockResolvedValue({
        success: true,
        accessToken: 'wx-jwt',
        user: { userId: 'u2', nickname: 'WxUser', wechatOpenId: 'ox1', roles: [], points: 0 },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/wechat/callback',
        body: JSON.stringify({ code: 'wx-code', state: 'st-1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.accessToken).toBe('wx-jwt');
      expect(body.user.userId).toBe('u2');
    });

    it('returns 400 when body is missing fields', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/wechat/callback',
        body: JSON.stringify({ code: 'wx-code' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('verifies existing token and returns new token', () => {
      vi.mocked(verifyToken).mockReturnValue({
        valid: true,
        payload: { userId: 'u1', email: 'a@b.com', roles: ['Speaker'] } as any,
      });
      vi.mocked(generateToken).mockReturnValue('new-jwt');
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/refresh',
        headers: { Authorization: 'Bearer old-jwt' },
      });
      // handler returns a promise for consistency, but refresh is sync
      const resultPromise = handler(event);
      return resultPromise.then((result) => {
        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).accessToken).toBe('new-jwt');
        expect(verifyToken).toHaveBeenCalledWith('old-jwt');
      });
    });

    it('returns 401 when no Authorization header', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/refresh',
        headers: {},
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('returns 401 when token is expired', async () => {
      vi.mocked(verifyToken).mockReturnValue({ valid: false, error: 'TOKEN_EXPIRED' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/refresh',
        headers: { Authorization: 'Bearer expired-jwt' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('TOKEN_EXPIRED');
    });

    it('returns 401 when token is invalid', async () => {
      vi.mocked(verifyToken).mockReturnValue({ valid: false, error: 'INVALID_TOKEN' });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/refresh',
        headers: { Authorization: 'Bearer bad-jwt' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('returns 200 on successful password change', async () => {
      vi.mocked(verifyToken).mockReturnValue({
        valid: true,
        payload: { userId: 'u1', email: 'a@b.com', roles: [] } as any,
      });
      vi.mocked(changePassword).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/change-password',
        headers: { Authorization: 'Bearer valid-jwt' },
        body: JSON.stringify({ currentPassword: 'OldPass1', newPassword: 'NewPass1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('密码修改成功');
      expect(changePassword).toHaveBeenCalledWith(
        'u1', 'OldPass1', 'NewPass1', expect.anything(), expect.anything(),
      );
    });

    it('returns 401 when Authorization header is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/change-password',
        headers: {},
        body: JSON.stringify({ currentPassword: 'OldPass1', newPassword: 'NewPass1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('returns 400 when body fields are missing', async () => {
      vi.mocked(verifyToken).mockReturnValue({
        valid: true,
        payload: { userId: 'u1', email: 'a@b.com', roles: [] } as any,
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/change-password',
        headers: { Authorization: 'Bearer valid-jwt' },
        body: JSON.stringify({ currentPassword: 'OldPass1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when changePassword fails', async () => {
      vi.mocked(verifyToken).mockReturnValue({
        valid: true,
        payload: { userId: 'u1', email: 'a@b.com', roles: [] } as any,
      });
      vi.mocked(changePassword).mockResolvedValue({
        success: false,
        error: { code: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/change-password',
        headers: { Authorization: 'Bearer valid-jwt' },
        body: JSON.stringify({ currentPassword: 'WrongPass1', newPassword: 'NewPass1' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_CURRENT_PASSWORD');
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns 200 on success', async () => {
      vi.mocked(forgotPassword).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/forgot-password',
        body: JSON.stringify({ email: 'user@example.com' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('如果该邮箱已注册，重置邮件已发送');
      expect(forgotPassword).toHaveBeenCalledWith(
        'user@example.com', expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('returns 400 when email is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/forgot-password',
        body: JSON.stringify({}),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('returns 200 on successful reset', async () => {
      vi.mocked(resetPassword).mockResolvedValue({ success: true });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/reset-password',
        body: JSON.stringify({ token: 'reset-tok', newPassword: 'NewPass123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('密码重置成功');
      expect(resetPassword).toHaveBeenCalledWith(
        'reset-tok', 'NewPass123', expect.anything(), expect.anything(),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/reset-password',
        body: JSON.stringify({ token: 'reset-tok' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });

    it('returns error when resetPassword fails', async () => {
      vi.mocked(resetPassword).mockResolvedValue({
        success: false,
        error: { code: 'RESET_TOKEN_EXPIRED', message: '重置链接已过期' },
      });
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/reset-password',
        body: JSON.stringify({ token: 'expired-tok', newPassword: 'NewPass123' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('RESET_TOKEN_EXPIRED');
    });
  });

  describe('Error handling', () => {
    it('returns 500 when an unexpected error occurs', async () => {
      vi.mocked(registerUser).mockRejectedValue(new Error('DynamoDB timeout'));
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/register',
        body: JSON.stringify({ email: 'a@b.com', password: 'Pass1234', nickname: 'Test', inviteToken: 'a'.repeat(64) }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).code).toBe('INTERNAL_ERROR');
    });

    it('returns 400 when body is not valid JSON', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/api/auth/register',
        body: 'not-json',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).code).toBe('INVALID_REQUEST');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers in all responses', async () => {
      const event = makeEvent({ httpMethod: 'GET', path: '/api/auth/unknown' });
      const result = await handler(event);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
    });
  });
});
