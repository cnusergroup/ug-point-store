import { describe, it, expect, vi } from 'vitest';
import { getInviteSettings, updateInviteSettings, INVITE_SETTINGS_KEY } from './invite-settings';

// ---- Mock DynamoDB Client ----

function createMockClient(getItem?: Record<string, unknown> | null) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        return Promise.resolve({ Item: getItem ?? undefined });
      }
      if (name === 'PutCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

// ---- getInviteSettings ----

describe('getInviteSettings', () => {
  it('should return default inviteExpiryDays of 1 when record does not exist', async () => {
    const client = createMockClient(null);

    const result = await getInviteSettings(client, 'users-table');

    expect(result).toEqual({ inviteExpiryDays: 1 });
  });

  it('should return stored inviteExpiryDays when record exists', async () => {
    const client = createMockClient({
      userId: INVITE_SETTINGS_KEY,
      inviteExpiryDays: 7,
    });

    const result = await getInviteSettings(client, 'users-table');

    expect(result).toEqual({ inviteExpiryDays: 7 });
  });

  it('should return stored value of 3 when record exists with 3 days', async () => {
    const client = createMockClient({
      userId: INVITE_SETTINGS_KEY,
      inviteExpiryDays: 3,
    });

    const result = await getInviteSettings(client, 'users-table');

    expect(result).toEqual({ inviteExpiryDays: 3 });
  });
});

// ---- updateInviteSettings ----

describe('updateInviteSettings', () => {
  it('should succeed when inviteExpiryDays is 1', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(1, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('should succeed when inviteExpiryDays is 3', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(3, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('should succeed when inviteExpiryDays is 7', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(7, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('should reject when inviteExpiryDays is 2 (not in allowed set)', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(2, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_EXPIRY_VALUE');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when inviteExpiryDays is 0', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(0, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_EXPIRY_VALUE');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when inviteExpiryDays is 30', async () => {
    const client = createMockClient();

    const result = await updateInviteSettings(30, 'superadmin-1', client, 'users-table');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_EXPIRY_VALUE');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should write correct record structure to DynamoDB on success', async () => {
    const client = createMockClient();

    await updateInviteSettings(3, 'superadmin-1', client, 'users-table');

    const putCall = client.send.mock.calls[0][0];
    expect(putCall.input.TableName).toBe('users-table');
    expect(putCall.input.Item.userId).toBe(INVITE_SETTINGS_KEY);
    expect(putCall.input.Item.inviteExpiryDays).toBe(3);
    expect(putCall.input.Item.updatedBy).toBe('superadmin-1');
    expect(putCall.input.Item.updatedAt).toBeTruthy();
  });
});
