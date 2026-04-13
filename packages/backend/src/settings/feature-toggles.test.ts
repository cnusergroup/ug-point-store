import { describe, it, expect, vi } from 'vitest';
import { getFeatureToggles, updateFeatureToggles, updateContentRolePermissions } from './feature-toggles';

// ---- Mock DynamoDB Client ----

function createMockClient(getItem?: Record<string, unknown> | null, shouldThrow = false) {
  return {
    send: vi.fn().mockImplementation((command: any) => {
      if (shouldThrow) {
        throw new Error('DynamoDB error');
      }
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        return Promise.resolve({ Item: getItem ?? undefined });
      }
      if (name === 'PutCommand') {
        return Promise.resolve({});
      }
      if (name === 'UpdateCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as any;
}

const DEFAULT_CONTENT_ROLE_PERMISSIONS = {
  Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
  UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
  Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
};

// ---- getFeatureToggles ----

describe('getFeatureToggles', () => {
  it('should return stored values when record exists', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: true,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: false,
      adminContentReviewEnabled: true,
      adminCategoriesEnabled: false,
      contentRolePermissions: {
        Speaker:         { canAccess: true,  canUpload: false, canDownload: true,  canReserve: false },
        UserGroupLeader: { canAccess: false, canUpload: true,  canDownload: false, canReserve: true  },
        Volunteer:       { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
      },
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: true,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: false,
      adminContentReviewEnabled: true,
      adminCategoriesEnabled: false,
      contentRolePermissions: {
        Speaker:         { canAccess: true,  canUpload: false, canDownload: true,  canReserve: false },
        UserGroupLeader: { canAccess: false, canUpload: true,  canDownload: false, canReserve: true  },
        Volunteer:       { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
      },
    });
  });

  it('should return default values when record does not exist', async () => {
    const client = createMockClient(null);

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      contentRolePermissions: DEFAULT_CONTENT_ROLE_PERMISSIONS,
    });
  });

  it('should return default values when DynamoDB throws', async () => {
    const client = createMockClient(null, true);

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      contentRolePermissions: DEFAULT_CONTENT_ROLE_PERMISSIONS,
    });
  });

  it('should treat non-boolean truthy values as false', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: 'yes',
      pointsClaimEnabled: 1,
      adminProductsEnabled: 'yes',
      adminOrdersEnabled: 1,
    });

    const result = await getFeatureToggles(client, 'users-table');

    // codeRedemptionEnabled and pointsClaimEnabled must be strict true to be enabled
    // adminProductsEnabled and adminOrdersEnabled default to true unless explicitly false
    // adminContentReviewEnabled and adminCategoriesEnabled default to false
    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      contentRolePermissions: DEFAULT_CONTENT_ROLE_PERMISSIONS,
    });
  });

  it('should default missing contentRolePermissions fields to true', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      // contentRolePermissions missing entirely
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result.contentRolePermissions).toEqual(DEFAULT_CONTENT_ROLE_PERMISSIONS);
  });
});

// ---- updateFeatureToggles ----

describe('updateFeatureToggles', () => {
  it('should write and return settings on valid input', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: false,
        adminContentReviewEnabled: true,
        adminCategoriesEnabled: false,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(true);
    expect(result.settings).toBeDefined();
    expect(result.settings!.codeRedemptionEnabled).toBe(true);
    expect(result.settings!.pointsClaimEnabled).toBe(false);
    expect(result.settings!.adminProductsEnabled).toBe(true);
    expect(result.settings!.adminOrdersEnabled).toBe(false);
    expect(result.settings!.adminContentReviewEnabled).toBe(true);
    expect(result.settings!.adminCategoriesEnabled).toBe(false);
    expect(result.settings!.updatedBy).toBe('user-1');
    expect(result.settings!.updatedAt).toBeTruthy();
  });

  it('should reject when codeRedemptionEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: 'true' as any,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when pointsClaimEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: 1 as any,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when both values are not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: null as any,
        pointsClaimEnabled: undefined as any,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should reject when adminContentReviewEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: 'yes' as any,
        adminCategoriesEnabled: false,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should write correct record structure to DynamoDB', async () => {
    const client = createMockClient();

    await updateFeatureToggles(
      {
        codeRedemptionEnabled: false,
        pointsClaimEnabled: true,
        adminProductsEnabled: true,
        adminOrdersEnabled: false,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: true,
        updatedBy: 'admin-1',
      },
      client,
      'users-table',
    );

    // First call is GetCommand (to preserve contentRolePermissions), second is PutCommand
    const putCall = client.send.mock.calls[1][0];
    expect(putCall.input.TableName).toBe('users-table');
    expect(putCall.input.Item.userId).toBe('feature-toggles');
    expect(putCall.input.Item.codeRedemptionEnabled).toBe(false);
    expect(putCall.input.Item.pointsClaimEnabled).toBe(true);
    expect(putCall.input.Item.adminProductsEnabled).toBe(true);
    expect(putCall.input.Item.adminOrdersEnabled).toBe(false);
    expect(putCall.input.Item.adminContentReviewEnabled).toBe(false);
    expect(putCall.input.Item.adminCategoriesEnabled).toBe(true);
    expect(putCall.input.Item.updatedBy).toBe('admin-1');
    expect(putCall.input.Item.updatedAt).toBeTruthy();
  });
});

// ---- updateContentRolePermissions ----

describe('updateContentRolePermissions', () => {
  const validPermissions = {
    Speaker:         { canAccess: true,  canUpload: false, canDownload: true,  canReserve: false },
    UserGroupLeader: { canAccess: false, canUpload: true,  canDownload: false, canReserve: true  },
    Volunteer:       { canAccess: true,  canUpload: true,  canDownload: true,  canReserve: true  },
  };

  it('should use UpdateCommand (not PutCommand) to preserve other fields', async () => {
    const client = createMockClient();

    await updateContentRolePermissions(
      { contentRolePermissions: validPermissions, updatedBy: 'user-1' },
      client,
      'users-table',
    );

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('UpdateCommand');
    // Must NOT be a PutCommand
    expect(cmd.constructor.name).not.toBe('PutCommand');
  });

  it('should return success with contentRolePermissions on valid input', async () => {
    const client = createMockClient();

    const result = await updateContentRolePermissions(
      { contentRolePermissions: validPermissions, updatedBy: 'user-1' },
      client,
      'users-table',
    );

    expect(result.success).toBe(true);
    expect(result.contentRolePermissions).toEqual(validPermissions);
    expect(result.error).toBeUndefined();
  });

  it('should return INVALID_REQUEST when a permission field is not boolean', async () => {
    const client = createMockClient();

    const result = await updateContentRolePermissions(
      {
        contentRolePermissions: {
          Speaker:         { canAccess: 'yes' as any, canUpload: false, canDownload: true, canReserve: false },
          UserGroupLeader: { canAccess: false, canUpload: true, canDownload: false, canReserve: true },
          Volunteer:       { canAccess: true,  canUpload: true, canDownload: true,  canReserve: true },
        },
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should return INVALID_REQUEST when a role is missing a permission field', async () => {
    const client = createMockClient();

    const result = await updateContentRolePermissions(
      {
        contentRolePermissions: {
          Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true } as any, // missing canReserve
        },
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should return INVALID_REQUEST when a role object is null', async () => {
    const client = createMockClient();

    const result = await updateContentRolePermissions(
      {
        contentRolePermissions: {
          Speaker:         null as any,
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        },
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should write correct UpdateCommand parameters to DynamoDB', async () => {
    const client = createMockClient();

    await updateContentRolePermissions(
      { contentRolePermissions: validPermissions, updatedBy: 'admin-1' },
      client,
      'users-table',
    );

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('users-table');
    expect(cmd.input.Key).toEqual({ userId: 'feature-toggles' });
    expect(cmd.input.UpdateExpression).toContain('contentRolePermissions');
    expect(cmd.input.ExpressionAttributeValues[':crp']).toEqual(validPermissions);
    expect(cmd.input.ExpressionAttributeValues[':updatedBy']).toBe('admin-1');
    expect(cmd.input.ExpressionAttributeValues[':updatedAt']).toBeTruthy();
  });

  it('should validate all 12 permission fields — reject when any one is non-boolean', async () => {
    const client = createMockClient();

    // Test each of the 12 fields individually
    const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
    const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;

    for (const role of roles) {
      for (const perm of perms) {
        const permissions = {
          Speaker:         { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
          Volunteer:       { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
        };
        (permissions[role] as any)[perm] = null; // inject invalid value

        const result = await updateContentRolePermissions(
          { contentRolePermissions: permissions, updatedBy: 'user-1' },
          client,
          'users-table',
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_REQUEST');
      }
    }

    // DynamoDB should never have been called
    expect(client.send).not.toHaveBeenCalled();
  });
});
