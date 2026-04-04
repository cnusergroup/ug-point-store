import { describe, it, expect, vi } from 'vitest';
import { verifyEmail } from './verify-email';

function createMockDynamoClient(scanItems: any[] = []) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;
      if (name === 'ScanCommand') {
        return Promise.resolve({ Items: scanItems });
      }
      if (name === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

describe('verifyEmail', () => {
  const tableName = 'Users';

  it('should verify email successfully with valid token', async () => {
    const user = { userId: 'user-1', verificationToken: 'valid-token', emailVerified: false };
    const dynamoClient = createMockDynamoClient([user]);

    const result = await verifyEmail('valid-token', dynamoClient, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was called to set emailVerified and remove token
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    const input = updateCall![0].input;
    expect(input.Key).toEqual({ userId: 'user-1' });
    expect(input.UpdateExpression).toContain('emailVerified');
    expect(input.UpdateExpression).toContain('REMOVE verificationToken');
  });

  it('should fail with empty token', async () => {
    const dynamoClient = createMockDynamoClient();

    const result = await verifyEmail('', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_TOKEN');
    expect(dynamoClient.send).not.toHaveBeenCalled();
  });

  it('should fail when token not found', async () => {
    const dynamoClient = createMockDynamoClient([]);

    const result = await verifyEmail('nonexistent-token', dynamoClient, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_TOKEN');

    // Should have called scan but not update
    const scanCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'ScanCommand',
    );
    expect(scanCall).toBeDefined();
    const updateCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeUndefined();
  });
});
