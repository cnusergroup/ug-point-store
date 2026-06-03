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

// ============================================================
// Self-applied credential revocation (credential-self-application)
//
// Self-applied credentials live in the same PointsMall-Credentials table as
// batch-imported credentials and carry extra non-empty source fields
// (appliedByUserId / sourceActivityId / sourceRole / identityText /
// appliedDedupeKey). Revocation MUST behave identically to batch credentials:
// only SuperAdmin may revoke, active->revoked records revokedAt/revokedBy/
// revokeReason, and revoking a missing or already-revoked credential is rejected.
// _Requirements: 10.4, 10.5, 10.6, 10.7_
// ============================================================

describe('revokeCredential - self-applied credential', () => {
  const SELF_APPLIED_ID = 'ACD-2026-Summer-UGL-0001';

  // A self-applied credential fixture: same shape as a batch credential plus
  // the non-empty self-application source markers.
  function selfAppliedItem(overrides: Record<string, unknown> = {}) {
    return {
      credentialId: SELF_APPLIED_ID,
      recipientName: 'Jane Doe',
      eventName: 'AWS Community Day 2026 Summer',
      identityText: 'User Group Leader',
      role: 'UserGroupLeader',
      issueDate: '2026-06-20',
      locale: 'en',
      status: 'active',
      // self-application source markers (non-empty => self-applied origin)
      appliedByUserId: 'user-applicant-001',
      sourceActivityId: 'act-001',
      sourceRole: 'UserGroupLeader',
      appliedDedupeKey: 'user-applicant-001#act-001#UserGroupLeader',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should let SuperAdmin revoke an active self-applied credential and record revocation fields', async () => {
    const params = makeParams({ credentialId: SELF_APPLIED_ID });
    const client = params.dynamoClient as any;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({ Item: selfAppliedItem() });
      }
      // UpdateCommand
      return Promise.resolve({});
    });

    const result = await revokeCredential(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.credential.credentialId).toBe(SELF_APPLIED_ID);
      expect(result.credential.status).toBe('revoked');
      expect(result.credential.revokedBy).toBe('user-superadmin-001');
      expect(result.credential.revokeReason).toBe('信息填写错误');
      expect(result.credential.revokedAt).toBeTruthy();
    }
  });

  it('should reject revoking a self-applied credential when caller is not SuperAdmin', async () => {
    const params = makeParams({ credentialId: SELF_APPLIED_ID, callerRole: 'Admin' });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('FORBIDDEN');
    }
    // Must not touch DynamoDB / change credential state
    expect(params.dynamoClient.send).not.toHaveBeenCalled();
  });

  it('should return CREDENTIAL_NOT_FOUND when the self-applied credential does not exist', async () => {
    const params = makeParams({ credentialId: SELF_APPLIED_ID });
    const client = params.dynamoClient as any;

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

  it('should reject revoking an already-revoked self-applied credential and leave it unchanged', async () => {
    const params = makeParams({ credentialId: SELF_APPLIED_ID });
    const client = params.dynamoClient as any;

    const sentCommands: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      sentCommands.push(cmd);
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({
          Item: selfAppliedItem({
            status: 'revoked',
            revokedAt: '2026-06-21T08:00:00.000Z',
            revokedBy: 'user-other-superadmin',
            revokeReason: '之前的撤销原因',
          }),
        });
      }
      return Promise.resolve({});
    });

    const result = await revokeCredential(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ALREADY_REVOKED');
    }
    // Credential must be left unchanged: no UpdateCommand should be issued
    const updateCmds = sentCommands.filter((c) => c.constructor.name === 'UpdateCommand');
    expect(updateCmds).toHaveLength(0);
  });
});
