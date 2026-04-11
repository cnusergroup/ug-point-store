import { describe, it, expect, vi } from 'vitest';
import { registerUser, RegisterRequest } from './register';
import { ErrorCodes } from '@points-mall/shared';

const VALID_TOKEN = 'a'.repeat(64);
const INVITES_TABLE = 'Invites';

// Mock DynamoDB DocumentClient
function createMockDynamoClient(queryItems: any[] = [], inviteItem?: any) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        return Promise.resolve({ Item: inviteItem });
      }
      if (name === 'QueryCommand') {
        return Promise.resolve({ Items: queryItems });
      }
      if (name === 'PutCommand') {
        return Promise.resolve({});
      }
      if (name === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

const validInviteRecord = {
  token: VALID_TOKEN,
  role: 'Volunteer',
  status: 'pending',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
};

const validRequest: RegisterRequest = {
  email: 'test@example.com',
  password: 'password1',
  nickname: 'TestUser',
  inviteToken: VALID_TOKEN,
};

describe('registerUser', () => {
  const tableName = 'Users';

  it('should register a new user successfully with emailVerified=true', async () => {
    const dynamoClient = createMockDynamoClient([], validInviteRecord);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(true);
    expect(result.userId).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user!.email).toBe('test@example.com');
    expect(result.user!.nickname).toBe('TestUser');
    expect(result.user!.roles).toEqual(['Volunteer']);
    expect(result.user!.points).toBe(0);
    expect(result.error).toBeUndefined();

    // Verify DynamoDB PutCommand was called
    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall).toBeDefined();
    const item = putCall![0].input.Item;
    expect(item.email).toBe('test@example.com');
    expect(item.nickname).toBe('TestUser');
    expect(item.roles).toEqual(['Volunteer']);
    expect(item.points).toBe(0);
    expect(item.emailVerified).toBe(true);
    expect(item.loginFailCount).toBe(0);
    expect(item.status).toBe('active');
  });

  it('should reject registration with invalid invite token', async () => {
    const dynamoClient = createMockDynamoClient([], undefined);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVITE_TOKEN_INVALID);
  });

  it('should reject registration with invalid password', async () => {
    const dynamoClient = createMockDynamoClient([], validInviteRecord);

    const result = await registerUser(
      { ...validRequest, password: 'short' },
      dynamoClient, tableName, INVITES_TABLE,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });

  it('should reject registration when email already exists and not consume token', async () => {
    const dynamoClient = createMockDynamoClient([{ userId: 'existing-user' }], validInviteRecord);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.EMAIL_ALREADY_EXISTS);
    const updateCalls = dynamoClient.send.mock.calls.filter(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('should hash the password before storing', async () => {
    const dynamoClient = createMockDynamoClient([], validInviteRecord);

    await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    const item = putCall![0].input.Item;
    expect(item.passwordHash).toBeDefined();
    expect(item.passwordHash).not.toBe(validRequest.password);
  });

  it('should return user object for auto-login after registration', async () => {
    const dynamoClient = createMockDynamoClient([], validInviteRecord);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user!.userId).toBe(result.userId);
    expect(result.user!.email).toBe('test@example.com');
    expect(result.user!.nickname).toBe('TestUser');
    expect(result.user!.roles).toEqual(['Volunteer']);
    expect(result.user!.points).toBe(0);
  });

  it('should assign all roles from multi-role invite to registered user', async () => {
    const multiRoleInvite = {
      token: VALID_TOKEN,
      role: 'Speaker',
      roles: ['Speaker', 'Volunteer'],
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    };
    const dynamoClient = createMockDynamoClient([], multiRoleInvite);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(true);
    expect(result.user!.roles).toEqual(['Speaker', 'Volunteer']);

    // Verify DynamoDB PutCommand stored all roles
    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall![0].input.Item.roles).toEqual(['Speaker', 'Volunteer']);
  });

  it('should handle old format invite with only role field (backward compat)', async () => {
    // Old invite record: only has `role`, no `roles` field
    const oldFormatInvite = {
      token: VALID_TOKEN,
      role: 'Speaker',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    };
    const dynamoClient = createMockDynamoClient([], oldFormatInvite);

    const result = await registerUser(validRequest, dynamoClient, tableName, INVITES_TABLE);

    expect(result.success).toBe(true);
    expect(result.user!.roles).toEqual(['Speaker']);

    // Verify DynamoDB PutCommand stored the single role as array
    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall![0].input.Item.roles).toEqual(['Speaker']);
  });
});
