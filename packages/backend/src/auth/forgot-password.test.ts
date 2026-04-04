import { describe, it, expect, vi } from 'vitest';
import { forgotPassword } from './forgot-password';

function createMockDynamoClient(queryItems: any[] = []) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;
      if (name === 'QueryCommand') {
        return Promise.resolve({ Items: queryItems });
      }
      if (name === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

function createMockSesClient(shouldFail = false) {
  const sendFn = shouldFail
    ? vi.fn().mockRejectedValue(new Error('SES failure'))
    : vi.fn().mockResolvedValue({});
  return { send: sendFn } as any;
}

describe('forgotPassword', () => {
  const tableName = 'Users';
  const senderEmail = 'noreply@example.com';
  const resetBaseUrl = 'https://example.com/reset-password';

  it('should return success and send email for existing user', async () => {
    const user = { userId: 'user-1', email: 'test@example.com' };
    const dynamoClient = createMockDynamoClient([user]);
    const sesClient = createMockSesClient();

    const result = await forgotPassword(
      'test@example.com', dynamoClient, sesClient, tableName, senderEmail, resetBaseUrl,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called with resetToken and resetTokenExpiry
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.Key).toEqual({ userId: 'user-1' });
    expect(input.ExpressionAttributeValues[':token']).toBeDefined();
    expect(input.ExpressionAttributeValues[':expiry']).toBeGreaterThan(Date.now());

    // Verify SES was called
    expect(sesClient.send).toHaveBeenCalledTimes(1);
    const sesInput = sesClient.send.mock.calls[0][0].input;
    expect(sesInput.Destination.ToAddresses).toEqual(['test@example.com']);
    expect(sesInput.Message.Body.Html.Data).toContain(input.ExpressionAttributeValues[':token']);
  });

  it('should return success for non-existent email (anti-enumeration)', async () => {
    const dynamoClient = createMockDynamoClient([]);
    const sesClient = createMockSesClient();

    const result = await forgotPassword(
      'unknown@example.com', dynamoClient, sesClient, tableName, senderEmail, resetBaseUrl,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify no UpdateCommand was sent
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();

    // Verify SES was NOT called
    expect(sesClient.send).not.toHaveBeenCalled();
  });

  it('should return success even when SES fails (anti-enumeration)', async () => {
    const user = { userId: 'user-1', email: 'test@example.com' };
    const dynamoClient = createMockDynamoClient([user]);
    const sesClient = createMockSesClient(true);

    const result = await forgotPassword(
      'test@example.com', dynamoClient, sesClient, tableName, senderEmail, resetBaseUrl,
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was still called (token was stored)
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();

    // Verify SES was attempted
    expect(sesClient.send).toHaveBeenCalledTimes(1);
  });
});
