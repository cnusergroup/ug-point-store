import { describe, it, expect, vi } from 'vitest';
import { loginUser, SLIDING_WINDOW_MS } from './login';
import { ErrorCodes } from '@points-mall/shared';
import { hash } from 'bcryptjs';

async function makeUser(overrides: Record<string, any> = {}) {
  return {
    userId: 'user-1',
    email: 'test@example.com',
    passwordHash: await hash('password1', 10),
    nickname: 'TestUser',
    roles: ['Speaker'],
    points: 100,
    emailVerified: true,
    loginFailCount: 0,
    status: 'active',
    ...overrides,
  };
}

function createMockDynamoClient(queryItems: any[] = []) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: queryItems });
    }
    if (name === 'UpdateCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

describe('loginUser', () => {
  const tableName = 'Users';

  it('should login successfully with correct credentials', async () => {
    const user = await makeUser();
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user!.userId).toBe('user-1');
    expect(result.user!.email).toBe('test@example.com');
    expect(result.user!.nickname).toBe('TestUser');
    expect(result.user!.roles).toEqual(['Speaker']);
    expect(result.user!.points).toBe(100);

    // Verify loginFailCount was reset
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.ExpressionAttributeValues[':zero']).toBe(0);
  });

  it('should return INVALID_CREDENTIALS when user not found', async () => {
    const dynamoClient = createMockDynamoClient([]);

    const result = await loginUser(
      { email: 'unknown@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
  });

  it('should return ACCOUNT_LOCKED when account is locked', async () => {
    const lockUntil = Date.now() + 10 * 60 * 1000; // 10 minutes from now
    const user = await makeUser({ lockUntil, status: 'locked' });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(result.error?.lockRemainingMs).toBeGreaterThan(0);
  });

  it('should return INVALID_CREDENTIALS on wrong password and increment fail count', async () => {
    const user = await makeUser({ loginFailCount: 0 });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'wrongpassword1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CREDENTIALS);

    // Verify loginFailCount was set to 1 (new sliding window started)
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':count']).toBe(1);
    // firstFailAt should be set
    expect(updateCall![0].input.ExpressionAttributeValues[':firstFailAt']).toBeDefined();
  });

  it('should lock account after 5 consecutive failed attempts within sliding window', async () => {
    // User has 4 failures within the sliding window
    const recentFirstFailAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago (within window)
    const user = await makeUser({ loginFailCount: 4, firstFailAt: recentFirstFailAt });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'wrongpassword1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(result.error?.lockRemainingMs).toBeGreaterThan(0);

    // Verify account was locked
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.ExpressionAttributeValues[':count']).toBe(5);
    expect(input.ExpressionAttributeValues[':locked']).toBe('locked');
    expect(input.ExpressionAttributeValues[':lockUntil']).toBeGreaterThan(Date.now());
  });

  it('should allow login after lock expires', async () => {
    const user = await makeUser({ lockUntil: Date.now() - 1000, status: 'locked', loginFailCount: 5 });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();

    // Verify lock state was reset (there should be 2 UpdateCommands: one for lock reset, one for success)
    const updateCalls = dynamoClient.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCalls.length).toBe(2);
    // First update: lock expiry reset
    const resetInput = updateCalls[0][0].input;
    expect(resetInput.ExpressionAttributeValues[':zero']).toBe(0);
    expect(resetInput.ExpressionAttributeValues[':active']).toBe('active');
  });

  it('should not lock when already at 3 failures within sliding window', async () => {
    const recentFirstFailAt = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const user = await makeUser({ loginFailCount: 3, firstFailAt: recentFirstFailAt });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'wrongpassword1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    // Should increment to 4, not lock yet
    expect(updateCall![0].input.ExpressionAttributeValues[':count']).toBe(4);
    expect(updateCall![0].input.ExpressionAttributeValues[':locked']).toBeUndefined();
  });

  it('should return ACCOUNT_DISABLED when user status is disabled even with correct password', async () => {
    const user = await makeUser({ status: 'disabled' });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ACCOUNT_DISABLED);
    expect(result.error?.message).toBe('账号已停用');

    // Verify no UpdateCommand was sent (no password comparison or fail count update)
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should reset sliding window when firstFailAt is stale (older than 15 min)', async () => {
    const staleFirstFailAt = Date.now() - SLIDING_WINDOW_MS - 1000; // 15+ minutes ago
    const user = await makeUser({ loginFailCount: 4, firstFailAt: staleFirstFailAt });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'wrongpassword1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CREDENTIALS);

    // Should reset to count=1 (new window), NOT increment to 5 and lock
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall![0].input.ExpressionAttributeValues[':count']).toBe(1);
  });

  it('should clear firstFailAt on successful login', async () => {
    const recentFirstFailAt = Date.now() - 5 * 60 * 1000;
    const user = await makeUser({ loginFailCount: 2, firstFailAt: recentFirstFailAt });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(true);

    // Verify the REMOVE clause includes firstFailAt
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const updateExpr = updateCall![0].input.UpdateExpression as string;
    expect(updateExpr).toContain('REMOVE');
    expect(updateExpr).toContain('firstFailAt');
  });

  it('should clear firstFailAt on lock expiry reset', async () => {
    const user = await makeUser({
      lockUntil: Date.now() - 1000,
      status: 'locked',
      loginFailCount: 5,
      firstFailAt: Date.now() - 20 * 60 * 1000,
    });
    const dynamoClient = createMockDynamoClient([user]);

    const result = await loginUser(
      { email: 'test@example.com', password: 'password1' },
      dynamoClient,
      tableName,
    );

    expect(result.success).toBe(true);

    // First UpdateCommand should be the lock expiry reset
    const updateCalls = dynamoClient.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCalls.length).toBe(2);
    const resetExpr = updateCalls[0][0].input.UpdateExpression as string;
    expect(resetExpr).toContain('REMOVE');
    expect(resetExpr).toContain('firstFailAt');
    expect(resetExpr).toContain('lockUntil');
  });
});
