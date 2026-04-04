import { describe, it, expect, vi } from 'vitest';
import { changePassword } from './change-password';
import { ErrorCodes } from '@points-mall/shared';
import { hash, compare } from 'bcryptjs';

function createMockDynamoClient(getItem: any | null = null) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      return Promise.resolve({ Item: getItem });
    }
    if (name === 'UpdateCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

describe('changePassword', () => {
  const tableName = 'Users';
  const userId = 'user-1';
  const currentPassword = 'oldPass123';
  const newPassword = 'newPass456';

  it('should change password successfully with correct current password', async () => {
    const passwordHash = await hash(currentPassword, 10);
    const dynamoClient = createMockDynamoClient({ passwordHash });

    const result = await changePassword(userId, currentPassword, newPassword, dynamoClient, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called with new hash
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.Key).toEqual({ userId });

    // Verify the new hash is valid for the new password
    const newHash = input.ExpressionAttributeValues[':hash'];
    const matches = await compare(newPassword, newHash);
    expect(matches).toBe(true);
  });

  it('should reject when current password is wrong', async () => {
    const passwordHash = await hash(currentPassword, 10);
    const dynamoClient = createMockDynamoClient({ passwordHash });

    const result = await changePassword(userId, 'wrongPassword1', newPassword, dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CURRENT_PASSWORD);

    // Verify no UpdateCommand was sent
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should reject when new password format is invalid', async () => {
    const passwordHash = await hash(currentPassword, 10);
    const dynamoClient = createMockDynamoClient({ passwordHash });

    // Password too short
    const result = await changePassword(userId, currentPassword, 'short1', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);

    // Verify no UpdateCommand was sent
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should reject when user is not found', async () => {
    const dynamoClient = createMockDynamoClient(null);

    const result = await changePassword(userId, currentPassword, newPassword, dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CURRENT_PASSWORD);
  });

  it('should reject new password without letters', async () => {
    const passwordHash = await hash(currentPassword, 10);
    const dynamoClient = createMockDynamoClient({ passwordHash });

    const result = await changePassword(userId, currentPassword, '12345678', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });

  it('should reject new password without numbers', async () => {
    const passwordHash = await hash(currentPassword, 10);
    const dynamoClient = createMockDynamoClient({ passwordHash });

    const result = await changePassword(userId, currentPassword, 'abcdefgh', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });
});
