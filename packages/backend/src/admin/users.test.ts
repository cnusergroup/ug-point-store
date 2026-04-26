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

  it('should use QueryCommand on entityType-createdAt-index GSI', async () => {
    const client = createMockDynamoClient();
    await listUsers({}, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.IndexName).toBe('entityType-createdAt-index');
    expect(command.input.KeyConditionExpression).toBe('entityType = :et');
    expect(command.input.ExpressionAttributeValues[':et']).toBe('user');
    expect(command.input.ScanIndexForward).toBe(false);
    expect(command.input.ProjectionExpression).toContain('#userId');
    expect(command.input.ProjectionExpression).toContain('#email');
    expect(command.input.ProjectionExpression).toContain('#roles');
    expect(command.input.ProjectionExpression).toContain('#status');
    expect(command.input.ProjectionExpression).toContain('#invitedBy');
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

  it('should add FilterExpression with contains(roles) when role is provided', async () => {
    const client = createMockDynamoClient();
    await listUsers({ role: 'Speaker' }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toContain('contains(#roles, :role)');
    expect(command.input.ExpressionAttributeValues[':role']).toBe('Speaker');
  });

  it('should not set FilterExpression when no role or excludeRoles filters', async () => {
    const client = createMockDynamoClient();
    await listUsers({}, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toBeUndefined();
  });

  it('should add NOT contains for each excludeRole in FilterExpression', async () => {
    const client = createMockDynamoClient();
    await listUsers({ excludeRoles: ['SuperAdmin', 'OrderAdmin'] }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toContain('NOT contains(#roles, :exRole0)');
    expect(command.input.FilterExpression).toContain('NOT contains(#roles, :exRole1)');
    expect(command.input.ExpressionAttributeValues[':exRole0']).toBe('SuperAdmin');
    expect(command.input.ExpressionAttributeValues[':exRole1']).toBe('OrderAdmin');
  });

  it('should combine role and excludeRoles in FilterExpression with AND', async () => {
    const client = createMockDynamoClient();
    await listUsers({ role: 'Speaker', excludeRoles: ['SuperAdmin'] }, client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.FilterExpression).toContain('contains(#roles, :role)');
    expect(command.input.FilterExpression).toContain('NOT contains(#roles, :exRole0)');
    expect(command.input.FilterExpression).toContain(' AND ');
    expect(command.input.ExpressionAttributeValues[':role']).toBe('Speaker');
    expect(command.input.ExpressionAttributeValues[':exRole0']).toBe('SuperAdmin');
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

  it('should include invitedBy in user result when present', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: ['Speaker'],
        points: 100,
        status: 'active',
        createdAt: '2024-01-01T00:00:00.000Z',
        invitedBy: 'admin1',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0].invitedBy).toBe('admin1');
  });

  it('should omit invitedBy from user result when not present', async () => {
    const items = [
      {
        userId: 'u1',
        email: 'a@test.com',
        nickname: 'Alice',
        roles: ['Speaker'],
        points: 100,
        status: 'active',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const client = createMockDynamoClient({ Items: items });
    const result = await listUsers({}, client, tableName);

    expect(result.users[0]).not.toHaveProperty('invitedBy');
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

  it('should return ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN when non-SuperAdmin tries to disable OrderAdmin', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'oa1',
      roles: ['OrderAdmin'],
    });
    const result = await setUserStatus('oa1', 'disabled', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN');
  });

  it('should allow SuperAdmin to disable OrderAdmin user', async () => {
    const client = createMockDynamoClientForStatus({
      userId: 'oa1',
      roles: ['OrderAdmin'],
    });
    const result = await setUserStatus('oa1', 'disabled', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(true);

    const updateCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'UpdateCommand',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ExpressionAttributeValues[':status']).toBe('disabled');
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

  it('should return ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN when non-SuperAdmin tries to delete OrderAdmin', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'oa1',
      roles: ['OrderAdmin'],
    });
    const result = await deleteUser('oa1', 'caller1', ['Admin'], client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN');
  });

  it('should allow SuperAdmin to delete OrderAdmin user', async () => {
    const client = createMockDynamoClientForDelete({
      userId: 'oa1',
      roles: ['OrderAdmin'],
    });
    const result = await deleteUser('oa1', 'caller1', ['SuperAdmin'], client, tableName);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const deleteCall = client.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'DeleteCommand',
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.Key).toEqual({ userId: 'oa1' });
  });
});
