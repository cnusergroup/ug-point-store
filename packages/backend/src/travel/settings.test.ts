import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTravelSettings,
  updateTravelSettings,
  validateTravelSettingsInput,
  UpdateTravelSettingsInput,
} from './settings';

const USERS_TABLE = 'Users';

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

describe('getTravelSettings', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return correct values when record exists', async () => {
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
        domesticThreshold: 500,
        internationalThreshold: 1000,
        updatedAt: '2024-01-01T00:00:00.000Z',
        updatedBy: 'admin-001',
      },
    });

    const result = await getTravelSettings(client, USERS_TABLE);

    expect(result).toEqual({
      travelSponsorshipEnabled: true,
      domesticThreshold: 500,
      internationalThreshold: 1000,
    });
  });

  it('should return defaults when record does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await getTravelSettings(client, USERS_TABLE);

    expect(result).toEqual({
      travelSponsorshipEnabled: false,
      domesticThreshold: 0,
      internationalThreshold: 0,
    });
  });

  it('should use GetCommand with correct table and key', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    await getTravelSettings(client, USERS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('GetCommand');
    expect(cmd.input.TableName).toBe(USERS_TABLE);
    expect(cmd.input.Key).toEqual({ userId: 'travel-sponsorship' });
  });

  it('should default travelSponsorshipEnabled to false when field is not boolean true', async () => {
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: 'yes',
        domesticThreshold: 100,
        internationalThreshold: 200,
      },
    });

    const result = await getTravelSettings(client, USERS_TABLE);

    expect(result.travelSponsorshipEnabled).toBe(false);
  });

  it('should default thresholds to 0 when fields are missing', async () => {
    client.send.mockResolvedValueOnce({
      Item: {
        userId: 'travel-sponsorship',
        travelSponsorshipEnabled: true,
      },
    });

    const result = await getTravelSettings(client, USERS_TABLE);

    expect(result.domesticThreshold).toBe(0);
    expect(result.internationalThreshold).toBe(0);
  });
});

describe('updateTravelSettings', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should write settings successfully and return result', async () => {
    client.send.mockResolvedValueOnce({});

    const input: UpdateTravelSettingsInput = {
      travelSponsorshipEnabled: true,
      domesticThreshold: 500,
      internationalThreshold: 1000,
      updatedBy: 'admin-001',
    };

    const result = await updateTravelSettings(input, client, USERS_TABLE);

    expect(result.success).toBe(true);
    expect(result.settings).toBeDefined();
    expect(result.settings!.travelSponsorshipEnabled).toBe(true);
    expect(result.settings!.domesticThreshold).toBe(500);
    expect(result.settings!.internationalThreshold).toBe(1000);
    expect(result.settings!.updatedBy).toBe('admin-001');
    expect(result.settings!.updatedAt).toBeDefined();
  });

  it('should use PutCommand with correct table and item', async () => {
    client.send.mockResolvedValueOnce({});

    const input: UpdateTravelSettingsInput = {
      travelSponsorshipEnabled: false,
      domesticThreshold: 200,
      internationalThreshold: 400,
      updatedBy: 'admin-002',
    };

    await updateTravelSettings(input, client, USERS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('PutCommand');
    expect(cmd.input.TableName).toBe(USERS_TABLE);
    expect(cmd.input.Item.userId).toBe('travel-sponsorship');
    expect(cmd.input.Item.travelSponsorshipEnabled).toBe(false);
    expect(cmd.input.Item.domesticThreshold).toBe(200);
    expect(cmd.input.Item.internationalThreshold).toBe(400);
    expect(cmd.input.Item.updatedBy).toBe('admin-002');
  });

  it('should include updatedAt as ISO string', async () => {
    client.send.mockResolvedValueOnce({});

    const input: UpdateTravelSettingsInput = {
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
      internationalThreshold: 200,
      updatedBy: 'admin-001',
    };

    const result = await updateTravelSettings(input, client, USERS_TABLE);

    // updatedAt should be a valid ISO 8601 string
    expect(() => new Date(result.settings!.updatedAt)).not.toThrow();
    expect(new Date(result.settings!.updatedAt).toISOString()).toBe(result.settings!.updatedAt);
  });
});

describe('validateTravelSettingsInput', () => {
  it('should accept valid input', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 500,
      internationalThreshold: 1000,
    });
    expect(result.valid).toBe(true);
  });

  it('should accept valid input with enabled=false', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: false,
      domesticThreshold: 1,
      internationalThreshold: 1,
    });
    expect(result.valid).toBe(true);
  });

  // --- null / missing body ---

  it('should reject null body', () => {
    const result = validateTravelSettingsInput(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  // --- travelSponsorshipEnabled ---

  it('should reject when travelSponsorshipEnabled is not boolean (string)', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: 'true',
      domesticThreshold: 100,
      internationalThreshold: 200,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when travelSponsorshipEnabled is missing', () => {
    const result = validateTravelSettingsInput({
      domesticThreshold: 100,
      internationalThreshold: 200,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  // --- domesticThreshold ---

  it('should reject when domesticThreshold is 0', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 0,
      internationalThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when domesticThreshold is negative', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: -1,
      internationalThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when domesticThreshold is a float', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 1.5,
      internationalThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when domesticThreshold is a string', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: '100',
      internationalThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when domesticThreshold is missing', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      internationalThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should accept domesticThreshold at boundary value 1', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 1,
      internationalThreshold: 1,
    });
    expect(result.valid).toBe(true);
  });

  // --- internationalThreshold ---

  it('should reject when internationalThreshold is 0', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
      internationalThreshold: 0,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when internationalThreshold is negative', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
      internationalThreshold: -5,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when internationalThreshold is a float', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
      internationalThreshold: 99.9,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when internationalThreshold is a string', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
      internationalThreshold: '200',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should reject when internationalThreshold is missing', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 100,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('should accept internationalThreshold at boundary value 1', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: false,
      domesticThreshold: 1,
      internationalThreshold: 1,
    });
    expect(result.valid).toBe(true);
  });

  it('should accept large threshold values', () => {
    const result = validateTravelSettingsInput({
      travelSponsorshipEnabled: true,
      domesticThreshold: 999999,
      internationalThreshold: 999999,
    });
    expect(result.valid).toBe(true);
  });
});
