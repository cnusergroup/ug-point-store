import { describe, it, expect, vi } from 'vitest';
import { listUsers, setUserStatus, deleteUser } from './users';

function createMockDynamoClient(response: any = { Items: [] }) {
  return {
    send: vi.fn().mockResolvedValue(response),
  } as any;
}

const tableName = 'Users';

describe('listUsers', () => {
  it('should return empty array when no users exist', async () => {
    const client = createMockDynamoClient({ Items: undefined });
    const result = await listUsers({}, client, tableName);

    expect(result.users).toEqual([]);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return users with all required fields', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: new Set(['Speaker']),
        points: 100,
        status: 'active',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toEqual({
      userId: 'u1',
      email: 'a@test.com',
      nickname: 'Alice',
      roles: ['Speaker'],
      points: 100,
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('should default status to active for historical records without status', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: new Set(['Volunteer']),
        points: 50,
        createdAt: '2023-06-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0].status).toBe('active');
  });

  it('should convert DynamoDB StringSet roles to array', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: new Set(['Speaker', 'Volunteer']),
        points: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(Array.isArray(result.users[0].roles)).toBe(true);
    expect(result.users[0].roles).toContain('Speaker');
    expect(result.users[0].roles).toContain('Volunteer');
  });

  it('should handle roles already as array', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: ['Admin'],
        points: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0].roles).toEqual(['Admin']);
  });

  it('should use ScanCommand with ProjectionExpression', async () => {
    const client = createMockDynamoClient();
    await listUsers({}, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('ScanCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.ProjectionExpression).toContain('#userId');
    expect(command.input.ProjectionExpression).toContain('#email');
    expect(command.input.ProjectionExpression).toContain('#roles');
    expect(command.input.ProjectionExpression).toContain('#status');
  });

  it('should default pageSize to 20', async () => {
    const client = createMockDynamoClient();
    await listUsers({}, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    const client = createMockDynamoClient();
    await listUsers({ pageSize: 500 }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.Limit).toBe(100);
  });

  it('should use provided pageSize when within range', async () => {
    const client = createMockDynamoClient();
    await listUsers({ pageSize: 50 }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.Limit).toBe(50);
  });

  it('should pass lastKey as ExclusiveStartKey', async () => {
    const lastKey = { userId: 'u5' };
    const client = createMockDynamoClient();
    await listUsers({ lastKey }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('should return lastKey from DynamoDB response for pagination', async () => {
    const nextKey = { userId: 'u10' };
    const client = createMockDynamoClient({ Items: [], LastEvaluatedKey: nextKey });
    const result = await listUsers({}, client, tableName);

    expect(result.lastKey).toEqual(nextKey);
  });

  it('should add FilterExpression when role is provided', async () => {
    const client = createMockDynamoClient();
    await listUsers({ role: 'Speaker' }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toBe('contains(#roles, :role)');
    expect(command.input.ExpressionAttributeValues[':role']).toBe('Speaker');
  });

  it('should not add FilterExpression when role is not provided', async () => {
    const client = createMockDynamoClient();
    await listUsers({}, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toBeUndefined();
    expect(command.input.ExpressionAttributeValues).toBeUndefined();
  });

  it('should default points to 0 when not present', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: new Set(['Volunteer']),
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0].points).toBe(0);
  });

  it('should handle empty roles gracefully', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        points: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0].roles).toEqual([]);
  });

  it('should ensure pageSize is at least 1', async () => {
    const client = createMockDynamoClient();
    await listUsers({ pageSize: 0 }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.Limit).toBe(1);
  });
});


describe('setUserStatus', () => {
  function createMockDynamoClientForStatus(getItem: any) {
    return {
      send: vi.fn().mockImplementation((cmd: any) => {
        if (cmd.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: getItem });
        }
        // UpdateCommand
        return Promise.resolve({});
      }),
    } as any;
  }

  it('should return USER_NOT_FOUND when user does not exist', async () => {
    const client = createMockDynamoClientForStatus(undefined);
    const result = await setUserStatus('nonexistent', 'disabled', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('USER_NOT_FOUND');
  });

  it('should return CANNOT_DISABLE_SUPERADMIN when target has SuperAdmin role (Set)', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'sa1',
      roles: new Set(['SuperAdmin', 'Admin']),
    });
    const result = await setUserStatus('sa1', 'disabled', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANNOT_DISABLE_SUPERADMIN');
  });

  it('should return CANNOT_DISABLE_SUPERADMIN when target has SuperAdmin role (Array)', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'sa1',
      roles: ['SuperAdmin'],
    });
    const result = await setUserStatus('sa1', 'disabled', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANNOT_DISABLE_SUPERADMIN');
  });

  it('should return ONLY_SUPERADMIN_CAN_MANAGE_ADMIN when non-SuperAdmin tries to manage Admin', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'admin1',
      roles: new Set(['Admin']),
    });
    const result = await setUserStatus('admin1', 'disabled', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ADMIN');
  });

  it('should allow SuperAdmin to manage Admin users', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'admin1',
      roles: new Set(['Admin']),
    });
    const result = await setUserStatus('admin1', 'disabled', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify UpdateCommand was sent
    const updateCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':status']).toBe('disabled');
  });

  it('should successfully update status for a regular user', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'user1',
      roles: new Set(['Speaker', 'Volunteer']),
    });
    const result = await setUserStatus('user1', 'disabled', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(true);

    const updateCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.Key).toEqual({ userId: 'user1' });
    expect(updateCall![0].input.ExpressionAttributeValues[':status']).toBe('disabled');
  });

  it('should successfully re-enable a disabled user', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'user1',
      roles: new Set(['Speaker']),
      status: 'disabled',
    });
    const result = await setUserStatus('user1', 'active', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(true);

    const updateCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall![0].input.ExpressionAttributeValues[':status']).toBe('active');
  });
});


describe('deleteUser', () => {
  function createMockDynamoClientForDelete(getItem: any) {
    return {
      send: vi.fn().mockImplementation((cmd: any) => {
        if (cmd.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: getItem });
        }
        // DeleteCommand
        return Promise.resolve({});
      }),
    } as any;
  }

  it('should return USER_NOT_FOUND when user does not exist', async () => {
    const client = createMockDynamoClientForDelete(undefined);
    const result = await deleteUser('nonexistent', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('USER_NOT_FOUND');
  });

  it('should return CANNOT_DELETE_SELF when deleting own account', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'caller1',
      roles: new Set(['Admin']),
    });
    const result = await deleteUser('caller1', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANNOT_DELETE_SELF');
  });

  it('should return CANNOT_DELETE_SUPERADMIN when target has SuperAdmin role (Set)', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'sa1',
      roles: new Set(['SuperAdmin', 'Admin']),
    });
    const result = await deleteUser('sa1', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANNOT_DELETE_SUPERADMIN');
  });

  it('should return CANNOT_DELETE_SUPERADMIN when target has SuperAdmin role (Array)', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'sa1',
      roles: ['SuperAdmin'],
    });
    const result = await deleteUser('sa1', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CANNOT_DELETE_SUPERADMIN');
  });

  it('should return ONLY_SUPERADMIN_CAN_MANAGE_ADMIN when non-SuperAdmin tries to delete Admin', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'admin1',
      roles: new Set(['Admin']),
    });
    const result = await deleteUser('admin1', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ADMIN');
  });

  it('should successfully delete a regular user', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'user1',
      roles: new Set(['Speaker', 'Volunteer']),
    });
    const result = await deleteUser('user1', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const deleteCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key).toEqual({ userId: 'user1' });
  });

  it('should allow SuperAdmin to delete Admin users', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'admin1',
      roles: new Set(['Admin']),
    });
    const result = await deleteUser('admin1', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const deleteCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key).toEqual({ userId: 'admin1' });
  });
});
