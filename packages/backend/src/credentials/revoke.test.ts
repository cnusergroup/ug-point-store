import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revokeCredential, type RevokeCredentialParams } from './revoke';

const TABLE_NAME = 'PointsMall-Credentials';

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makeParams(overrides: Partial<RevokeCredentialParams> = {}): RevokeCredentialParams {
  return {
    dynamoClient: createMockDynamoClient(),
    tableName: TABLE_NAME,
    credentialId: 'ACD-BASE-2026-Summer-VOL-0001',
    revokedBy: 'user-superadmin-001',
    revokeReason: '信息填写错误',
    callerRole: 'SuperAdmin',
    ...overrides,
  };
}

describe('revokeCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should revoke an active credential successfully', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({
          Item: {
            credentialId: 'ACD-BASE-2026-Summer-VOL-0001',
            recipientName: '张三',
            status: 'active',
          },
        });
      }
      // UpdateCommand
      return Promise.resolve({});
    });

    const result = await revokeCredential(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.credential.credentialId).toBe('ACD-BASE-2026-Summer-VOL-0001');
      expect(result.credential.status).toBe('revoked');
      expect(result.credential.revokedBy).toBe('user-superadmin-001');
      expect(result.credential.revokeReason).toBe('信息填写错误');
      expect(result.credential.revokedAt).toBeTruthy();
    }
  });

  it('should return FORBIDDEN when caller is not SuperAdmin', async () => {
    const params = makeParams({ callerRole: 'Admin' });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('FORBIDDEN');
    }
    // Should not have called DynamoDB at all
    expect(params.dynamoClient.send).not.toHaveBeenCalled();
  });

  it('should return FORBIDDEN for regular user role', async () => {
    const params = makeParams({ callerRole: 'User' });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('FORBIDDEN');
    }
  });

  it('should return CREDENTIAL_NOT_FOUND when credential does not exist', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({ Item: undefined });
      }
      return Promise.resolve({});
    });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('CREDENTIAL_NOT_FOUND');
    }
  });

  it('should return ALREADY_REVOKED when credential is already revoked', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({
          Item: {
            credentialId: 'ACD-BASE-2026-Summer-VOL-0001',
            status: 'revoked',
            revokedAt: '2026-06-20T10:00:00.000Z',
            revokedBy: 'user-other-001',
            revokeReason: '之前的原因',
          },
        });
      }
      return Promise.resolve({});
    });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ALREADY_REVOKED');
    }
  });

  it('should use UpdateCommand with correct expression to set revocation fields', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    const sentCommands: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      sentCommands.push(cmd);
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({
          Item: {
            credentialId: 'ACD-BASE-2026-Summer-VOL-0001',
            status: 'active',
          },
        });
      }
      return Promise.resolve({});
    });

    await revokeCredential(params);

    // Should have sent GetCommand then UpdateCommand
    expect(sentCommands).toHaveLength(2);

    const updateCmd = sentCommands[1];
    expect(updateCmd.input.TableName).toBe(TABLE_NAME);
    expect(updateCmd.input.Key).toEqual({ credentialId: 'ACD-BASE-2026-Summer-VOL-0001' });
    expect(updateCmd.input.UpdateExpression).toContain('#status = :status');
    expect(updateCmd.input.UpdateExpression).toContain('revokedAt = :revokedAt');
    expect(updateCmd.input.UpdateExpression).toContain('revokedBy = :revokedBy');
    expect(updateCmd.input.UpdateExpression).toContain('revokeReason = :revokeReason');
    expect(updateCmd.input.ExpressionAttributeValues[':status']).toBe('revoked');
    expect(updateCmd.input.ExpressionAttributeValues[':revokedBy']).toBe('user-superadmin-001');
    expect(updateCmd.input.ExpressionAttributeValues[':revokeReason']).toBe('信息填写错误');
  });

  it('should record a valid ISO timestamp for revokedAt', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({
          Item: { credentialId: 'ACD-BASE-2026-Summer-VOL-0001', status: 'active' },
        });
      }
      return Promise.resolve({});
    });

    const before = new Date().toISOString();
    const result = await revokeCredential(params);
    const after = new Date().toISOString();

    expect(result.success).toBe(true);
    if (result.success) {
      // revokedAt should be a valid ISO string between before and after
      expect(result.credential.revokedAt >= before).toBe(true);
      expect(result.credential.revokedAt <= after).toBe(true);
    }
  });
});
