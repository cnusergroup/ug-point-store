import { describe, it, expect, vi } from 'vitest';
import { getFeatureToggles, updateFeatureToggles } from './feature-toggles';

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
      return Promise.resolve({});
    }),
  } as any;
}

// ---- getFeatureToggles ----

describe('getFeatureToggles', () => {
  it('should return stored values when record exists', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: true,
      pointsClaimEnabled: false,
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: true,
      pointsClaimEnabled: false,
    });
  });

  it('should return default false values when record does not exist', async () => {
    const client = createMockClient(null);

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
    });
  });

  it('should return default false values when DynamoDB throws', async () => {
    const client = createMockClient(null, true);

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
    });
  });

  it('should treat non-boolean truthy values as false', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: 'yes',
      pointsClaimEnabled: 1,
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
    });
  });
});

// ---- updateFeatureToggles ----

describe('updateFeatureToggles', () => {
  it('should write and return settings on valid input', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      { codeRedemptionEnabled: true, pointsClaimEnabled: false, updatedBy: 'user-1' },
      client,
      'users-table',
    );

    expect(result.success).toBe(true);
    expect(result.settings).toBeDefined();
    expect(result.settings!.codeRedemptionEnabled).toBe(true);
    expect(result.settings!.pointsClaimEnabled).toBe(false);
    expect(result.settings!.updatedBy).toBe('user-1');
    expect(result.settings!.updatedAt).toBeTruthy();
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('should reject when codeRedemptionEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      { codeRedemptionEnabled: 'true' as any, pointsClaimEnabled: false, updatedBy: 'user-1' },
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
      { codeRedemptionEnabled: true, pointsClaimEnabled: 1 as any, updatedBy: 'user-1' },
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
      { codeRedemptionEnabled: null as any, pointsClaimEnabled: undefined as any, updatedBy: 'user-1' },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('should write correct record structure to DynamoDB', async () => {
    const client = createMockClient();

    await updateFeatureToggles(
      { codeRedemptionEnabled: false, pointsClaimEnabled: true, updatedBy: 'admin-1' },
      client,
      'users-table',
    );

    const putCall = client.send.mock.calls[0][0];
    expect(putCall.input.TableName).toBe('users-table');
    expect(putCall.input.Item.userId).toBe('feature-toggles');
    expect(putCall.input.Item.codeRedemptionEnabled).toBe(false);
    expect(putCall.input.Item.pointsClaimEnabled).toBe(true);
    expect(putCall.input.Item.updatedBy).toBe('admin-1');
    expect(putCall.input.Item.updatedAt).toBeTruthy();
  });
});
