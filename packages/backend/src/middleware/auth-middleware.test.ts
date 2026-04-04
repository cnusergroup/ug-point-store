import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ErrorCodes } from '@points-mall/shared';
import { generateToken } from '../auth/token';
import { withAuth, AuthenticatedEvent } from './auth-middleware';

const TEST_SECRET = 'test-jwt-secret-key-for-testing';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/test',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('withAuth middleware', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const successHandler = async (event: AuthenticatedEvent): Promise<APIGatewayProxyResult> => {
    return {
      statusCode: 200,
      body: JSON.stringify({ userId: event.user.userId, roles: event.user.roles }),
    };
  };

  it('should return 401 when Authorization header is missing', async () => {
    const handler = withAuth(successHandler);
    const event = makeEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 when Authorization header does not start with Bearer', async () => {
    const handler = withAuth(successHandler);
    const event = makeEvent({ headers: { Authorization: 'Basic abc123' } });
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 with TOKEN_EXPIRED for an expired token', async () => {
    const jwt = await import('jsonwebtoken');
    const expiredToken = jwt.default.sign({ userId: 'u1', roles: [] }, TEST_SECRET, { expiresIn: -1 });
    const handler = withAuth(successHandler);
    const event = makeEvent({ headers: { Authorization: `Bearer ${expiredToken}` } });
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe(ErrorCodes.TOKEN_EXPIRED);
  });

  it('should return 401 with INVALID_TOKEN for a bad token', async () => {
    const handler = withAuth(successHandler);
    const event = makeEvent({ headers: { Authorization: 'Bearer invalid.token.here' } });
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('should call handler with user info for a valid token', async () => {
    const token = await generateToken({ userId: 'user-42', email: 'test@test.com', roles: ['Speaker', 'Volunteer'] });
    const handler = withAuth(successHandler);
    const event = makeEvent({ headers: { Authorization: `Bearer ${token}` } });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.userId).toBe('user-42');
    expect(body.roles).toEqual(['Speaker', 'Volunteer']);
  });

  it('should handle lowercase authorization header', async () => {
    const token = await generateToken({ userId: 'user-99', roles: ['Volunteer'] });
    const handler = withAuth(successHandler);
    const event = makeEvent({ headers: { authorization: `Bearer ${token}` } });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.userId).toBe('user-99');
  });
});
