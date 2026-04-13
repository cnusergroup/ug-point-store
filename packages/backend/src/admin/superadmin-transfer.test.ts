import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transferSuperAdmin } from './superadmin-transfer';
import { ErrorCodes } from '@points-mall/shared';
import { hash } from 'bcryptjs';

const TABLE = 'Users';
const CALLER_ID = 'caller-superadmin';
const TARGET_ID = 'target-admin';
const CORRECT_PASSWORD = 'correctPass1';

async function makeCallerRecord(overrides: Record<string, any> = {}) {
  return {
    userId: CALLER_ID,
    email: 'superadmin@example.com',
    nickname: 'SuperAdmin',
    roles: ['SuperAdmin', 'Admin'],
    passwordHash: await hash(CORRECT_PASSWORD, 10),
    ...overrides,
  };
}

function makeTargetRecord(overrides: Record<string, any> = {}) {
  return {
    userId: TARGET_ID,
    email: 'admin@example.com',
    nickname: 'AdminUser',
    roles: ['Admin'],
    ...overrides,
  };
}

/**
 * Creates a mock DynamoDB client that returns caller and target records
 * for GetCommand calls (in order), and resolves for TransactWriteCommand.
 */
function createMockDynamoClient(callerItem: any, targetItem: any) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetCommand') {
      const key = command.input.Key?.userId;
      if (key === CALLER_ID) return Promise.resolve({ Item: callerItem });
      if (key === TARGET_ID) return Promise.resolve({ Item: targetItem });
      return Promise.resolve({ Item: undefined });
    }
    if (name === 'TransactWriteCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

describe('transferSuperAdmin', () => {
  describe('successful transfer', () => {
    it('should succeed with correct password and valid Admin target', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should issue a TransactWriteCommand on success', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeDefined();

      const items = transactCall![0].input.TransactItems;
      expect(items).toHaveLength(2);

      // Caller should be demoted (SuperAdmin removed, Admin preserved)
      const callerUpdate = items[0].Update;
      expect(callerUpdate.Key).toEqual({ userId: CALLER_ID });
      const newCallerRoles = callerUpdate.ExpressionAttributeValues[':newRoles'];
      expect(newCallerRoles).toContain('Admin');
      expect(newCallerRoles).not.toContain('SuperAdmin');

      // Target should be promoted (SuperAdmin added)
      const targetUpdate = items[1].Update;
      expect(targetUpdate.Key).toEqual({ userId: TARGET_ID });
      const newTargetRoles = targetUpdate.ExpressionAttributeValues[':newRoles'];
      expect(newTargetRoles).toContain('SuperAdmin');
      expect(newTargetRoles).toContain('Admin');
    });

    it('should update rolesVersion and updatedAt on both records', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      const before = Date.now();
      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );
      const after = Date.now();

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      const items = transactCall![0].input.TransactItems;

      for (const item of items) {
        const rv = item.Update.ExpressionAttributeValues[':rv'];
        const now = item.Update.ExpressionAttributeValues[':now'];
        expect(rv).toBeGreaterThanOrEqual(before);
        expect(rv).toBeLessThanOrEqual(after);
        expect(new Date(now).toISOString()).toBe(now);
      }
    });

    it('should preserve other roles the caller holds beyond SuperAdmin', async () => {
      const caller = await makeCallerRecord({ roles: ['SuperAdmin', 'Admin', 'Speaker'] });
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      const callerUpdate = transactCall![0].input.TransactItems[0].Update;
      const newCallerRoles = callerUpdate.ExpressionAttributeValues[':newRoles'];
      expect(newCallerRoles).toContain('Admin');
      expect(newCallerRoles).toContain('Speaker');
      expect(newCallerRoles).not.toContain('SuperAdmin');
    });
  });

  describe('rejection when caller is not SuperAdmin', () => {
    it('should return FORBIDDEN when caller has no SuperAdmin role', async () => {
      const caller = await makeCallerRecord({ roles: ['Admin'] });
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('should not issue a TransactWriteCommand when caller is not SuperAdmin', async () => {
      const caller = await makeCallerRecord({ roles: ['Admin'] });
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeUndefined();
    });

    it('should return FORBIDDEN when caller record does not exist', async () => {
      const client = createMockDynamoClient(undefined, makeTargetRecord());

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.FORBIDDEN);
    });
  });

  describe('rejection when target is self', () => {
    it('should return TRANSFER_TARGET_IS_SELF when targetUserId equals callerId', async () => {
      const caller = await makeCallerRecord();
      const client = createMockDynamoClient(caller, caller);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: CALLER_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.TRANSFER_TARGET_IS_SELF);
    });

    it('should not issue a TransactWriteCommand when target is self', async () => {
      const caller = await makeCallerRecord();
      const client = createMockDynamoClient(caller, caller);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: CALLER_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeUndefined();
    });
  });

  describe('rejection when target does not exist', () => {
    it('should return TRANSFER_TARGET_NOT_FOUND when target record is absent', async () => {
      const caller = await makeCallerRecord();
      const client = createMockDynamoClient(caller, undefined);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.TRANSFER_TARGET_NOT_FOUND);
    });

    it('should not issue a TransactWriteCommand when target does not exist', async () => {
      const caller = await makeCallerRecord();
      const client = createMockDynamoClient(caller, undefined);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeUndefined();
    });
  });

  describe('rejection when target is not Admin', () => {
    it('should return TRANSFER_TARGET_NOT_ADMIN when target has no Admin role', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord({ roles: ['Speaker', 'Volunteer'] });
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.TRANSFER_TARGET_NOT_ADMIN);
    });

    it('should return TRANSFER_TARGET_NOT_ADMIN when target has empty roles', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord({ roles: [] });
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.TRANSFER_TARGET_NOT_ADMIN);
    });

    it('should not issue a TransactWriteCommand when target is not Admin', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord({ roles: ['Speaker'] });
      const client = createMockDynamoClient(caller, target);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: CORRECT_PASSWORD },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeUndefined();
    });
  });

  describe('rejection when password is incorrect', () => {
    it('should return INVALID_CURRENT_PASSWORD when password does not match', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: 'wrongPassword1' },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_CURRENT_PASSWORD);
    });

    it('should not issue a TransactWriteCommand when password is incorrect', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: 'wrongPassword1' },
        client,
        TABLE,
      );

      const transactCall = client.send.mock.calls.find(
        (c: any) => c[0].constructor.name === 'TransactWriteCommand',
      );
      expect(transactCall).toBeUndefined();
    });

    it('should return INVALID_CURRENT_PASSWORD for empty password string', async () => {
      const caller = await makeCallerRecord();
      const target = makeTargetRecord();
      const client = createMockDynamoClient(caller, target);

      const result = await transferSuperAdmin(
        { callerId: CALLER_ID, targetUserId: TARGET_ID, password: '' },
        client,
        TABLE,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCodes.INVALID_CURRENT_PASSWORD);
    });
  });
});
