import { describe, it, expect, vi } from 'vitest';
import { resetPassword } from './reset-password';
import { ErrorCodes } from '@points-mall/shared';
import { hash, compare } from 'bcryptjs';

function createMockDynamoClient(scanItems: any[] | null = null) {
  const updateInputs: any[] = [];
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'ScanCommand') {
      return Promise.resolve({ Items: scanItems });
    }
    if (name === 'UpdateCommand') {
      updateInputs.push(command.input);
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn, _updateInputs: updateInputs } as any;
}

describe('resetPassword', () => {
  const tableName = 'Users';
  const validToken = 'VALID_RESET_TOKEN_123';
  const newPassword = 'newPass456';

  it('should reset password successfully with valid token', async () => {
    const oldHash = await hash('oldPass123', 10);
    const futureExpiry = Date.now() + 3600000; // 1 hour from now
    const dynamoClient = createMockDynamoClient([
      { userId: 'user-1', passwordHash: oldHash, resetToken: validToken, resetTokenExpiry: futureExpiry },
    ]);

    const result = await resetPassword(validToken, newPassword, dynamoClient, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.Key).toEqual({ userId: 'user-1' });

    // Verify new hash is valid for new password
    const newHash = input.ExpressionAttributeValues[':hash'];
    const matches = await compare(newPassword, newHash);
    expect(matches).toBe(true);

    // Verify loginFailCount reset to 0
    expect(input.ExpressionAttributeValues[':zero']).toBe(0);

    // Verify REMOVE clause includes resetToken, resetTokenExpiry, lockUntil
    expect(input.UpdateExpression).toContain('REMOVE resetToken, resetTokenExpiry, lockUntil');
  });

  it('should return RESET_TOKEN_INVALID when token not found', async () => {
    const dynamoClient = createMockDynamoClient([]);

    const result = await resetPassword('nonexistent-token', newPassword, dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESET_TOKEN_INVALID);

    // Verify no UpdateCommand was sent
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should return RESET_TOKEN_INVALID when scan returns null Items', async () => {
    const dynamoClient = createMockDynamoClient(null);

    const result = await resetPassword('some-token', newPassword, dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESET_TOKEN_INVALID);
  });

  it('should return RESET_TOKEN_EXPIRED when token is expired', async () => {
    const pastExpiry = Date.now() - 1000; // 1 second ago
    const dynamoClient = createMockDynamoClient([
      { userId: 'user-1', resetToken: validToken, resetTokenExpiry: pastExpiry },
    ]);

    const result = await resetPassword(validToken, newPassword, dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESET_TOKEN_EXPIRED);

    // Verify no UpdateCommand was sent
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });

  it('should return INVALID_PASSWORD_FORMAT when new password is too short', async () => {
    const futureExpiry = Date.now() + 3600000;
    const dynamoClient = createMockDynamoClient([
      { userId: 'user-1', resetToken: validToken, resetTokenExpiry: futureExpiry },
    ]);

    const result = await resetPassword(validToken, 'short1', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });

  it('should return INVALID_PASSWORD_FORMAT when new password has no letters', async () => {
    const futureExpiry = Date.now() + 3600000;
    const dynamoClient = createMockDynamoClient([
      { userId: 'user-1', resetToken: validToken, resetTokenExpiry: futureExpiry },
    ]);

    const result = await resetPassword(validToken, '12345678', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });

  it('should return INVALID_PASSWORD_FORMAT when new password has no numbers', async () => {
    const futureExpiry = Date.now() + 3600000;
    const dynamoClient = createMockDynamoClient([
      { userId: 'user-1', resetToken: validToken, resetTokenExpiry: futureExpiry },
    ]);

    const result = await resetPassword(validToken, 'abcdefgh', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PASSWORD_FORMAT);
  });

  it('should reset loginFailCount and remove lockUntil on successful reset', async () => {
    const oldHash = await hash('oldPass123', 10);
    const futureExpiry = Date.now() + 3600000;
    const dynamoClient = createMockDynamoClient([
      {
        userId: 'user-locked',
        passwordHash: oldHash,
        resetToken: validToken,
        resetTokenExpiry: futureExpiry,
        loginFailCount: 5,
        lockUntil: Date.now() + 1800000,
      },
    ]);

    const result = await resetPassword(validToken, newPassword, dynamoClient, tableName);

    expect(result.success).toBe(true);

    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    const input = updateCall![0].input;

    // loginFailCount should be reset to 0
    expect(input.ExpressionAttributeValues[':zero']).toBe(0);
    // lockUntil should be removed
    expect(input.UpdateExpression).toContain('REMOVE');
    expect(input.UpdateExpression).toContain('lockUntil');
  });
});
