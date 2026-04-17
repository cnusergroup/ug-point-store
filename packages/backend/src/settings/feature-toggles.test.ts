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
      emailPointsEarnedEnabled: true,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: true,
      emailNewProductEnabled: false,
      emailNewContentEnabled: true,
      adminEmailProductsEnabled: true,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 25,
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
      emailPointsEarnedEnabled: true,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: true,
      emailNewProductEnabled: false,
      emailNewContentEnabled: true,
      adminEmailProductsEnabled: true,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 25,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
      pointsRuleConfig: {
        uglPointsPerEvent: 50,
        volunteerPointsPerEvent: 30,
        volunteerMaxPerEvent: 10,
        speakerTypeAPoints: 100,
        speakerTypeBPoints: 50,
        speakerRoundtablePoints: 50,
      },
    });
  });

  it('should return stored leaderboard values when they exist in the record', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      leaderboardRankingEnabled: true,
      leaderboardAnnouncementEnabled: true,
      leaderboardUpdateFrequency: 'daily',
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result.leaderboardRankingEnabled).toBe(true);
    expect(result.leaderboardAnnouncementEnabled).toBe(true);
    expect(result.leaderboardUpdateFrequency).toBe('daily');
  });

  it('should default leaderboardUpdateFrequency to weekly when stored value is invalid', async () => {
    const client = createMockClient({
      userId: 'feature-toggles',
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      leaderboardRankingEnabled: true,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'yearly',
    });

    const result = await getFeatureToggles(client, 'users-table');

    expect(result.leaderboardRankingEnabled).toBe(true);
    expect(result.leaderboardAnnouncementEnabled).toBe(false);
    expect(result.leaderboardUpdateFrequency).toBe('weekly');
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
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 10,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
      pointsRuleConfig: {
        uglPointsPerEvent: 50,
        volunteerPointsPerEvent: 30,
        volunteerMaxPerEvent: 10,
        speakerTypeAPoints: 100,
        speakerTypeBPoints: 50,
        speakerRoundtablePoints: 50,
      },
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
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 10,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
      pointsRuleConfig: {
        uglPointsPerEvent: 50,
        volunteerPointsPerEvent: 30,
        volunteerMaxPerEvent: 10,
        speakerTypeAPoints: 100,
        speakerTypeBPoints: 50,
        speakerRoundtablePoints: 50,
      },
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
    // email toggles default to false (strict === true check)
    // reservationApprovalPoints defaults to 10 when missing or invalid
    expect(result).toEqual({
      codeRedemptionEnabled: false,
      pointsClaimEnabled: false,
      adminProductsEnabled: true,
      adminOrdersEnabled: true,
      adminContentReviewEnabled: false,
      adminCategoriesEnabled: false,
      contentRolePermissions: DEFAULT_CONTENT_ROLE_PERMISSIONS,
      emailPointsEarnedEnabled: false,
      emailNewOrderEnabled: false,
      emailOrderShippedEnabled: false,
      emailNewProductEnabled: false,
      emailNewContentEnabled: false,
      adminEmailProductsEnabled: false,
      adminEmailContentEnabled: false,
      reservationApprovalPoints: 10,
      leaderboardRankingEnabled: false,
      leaderboardAnnouncementEnabled: false,
      leaderboardUpdateFrequency: 'weekly',
      pointsRuleConfig: {
        uglPointsPerEvent: 50,
        volunteerPointsPerEvent: 30,
        volunteerMaxPerEvent: 10,
        speakerTypeAPoints: 100,
        speakerTypeBPoints: 50,
        speakerRoundtablePoints: 50,
      },
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
    // email toggles should default to false when missing
    expect(result.emailPointsEarnedEnabled).toBe(false);
    expect(result.emailNewOrderEnabled).toBe(false);
    expect(result.emailOrderShippedEnabled).toBe(false);
    expect(result.emailNewProductEnabled).toBe(false);
    expect(result.emailNewContentEnabled).toBe(false);
    expect(result.adminEmailProductsEnabled).toBe(false);
    expect(result.adminEmailContentEnabled).toBe(false);
    // reservationApprovalPoints should default to 10 when missing
    expect(result.reservationApprovalPoints).toBe(10);
    // leaderboard fields should default when missing
    expect(result.leaderboardRankingEnabled).toBe(false);
    expect(result.leaderboardAnnouncementEnabled).toBe(false);
    expect(result.leaderboardUpdateFrequency).toBe('weekly');
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
        emailPointsEarnedEnabled: true,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: true,
        emailNewProductEnabled: false,
        emailNewContentEnabled: true,
        adminEmailProductsEnabled: true,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 15,
        leaderboardRankingEnabled: true,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'daily',
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
    expect(result.settings!.emailPointsEarnedEnabled).toBe(true);
    expect(result.settings!.emailNewOrderEnabled).toBe(false);
    expect(result.settings!.emailOrderShippedEnabled).toBe(true);
    expect(result.settings!.emailNewProductEnabled).toBe(false);
    expect(result.settings!.emailNewContentEnabled).toBe(true);
    expect(result.settings!.adminEmailProductsEnabled).toBe(true);
    expect(result.settings!.adminEmailContentEnabled).toBe(false);
    expect(result.settings!.reservationApprovalPoints).toBe(15);
    expect(result.settings!.leaderboardRankingEnabled).toBe(true);
    expect(result.settings!.leaderboardAnnouncementEnabled).toBe(false);
    expect(result.settings!.leaderboardUpdateFrequency).toBe('daily');
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
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'weekly',
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
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'weekly',
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
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'weekly',
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
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'weekly',
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when leaderboardRankingEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: 'yes' as any,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'weekly',
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when leaderboardAnnouncementEnabled is not boolean', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: 1 as any,
        leaderboardUpdateFrequency: 'weekly',
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when leaderboardUpdateFrequency has an invalid value', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'yearly' as any,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(result.error?.message).toContain('更新频率值无效');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject when leaderboardUpdateFrequency is an empty string', async () => {
    const client = createMockClient();

    const result = await updateFeatureToggles(
      {
        codeRedemptionEnabled: true,
        pointsClaimEnabled: false,
        adminProductsEnabled: true,
        adminOrdersEnabled: true,
        adminContentReviewEnabled: false,
        adminCategoriesEnabled: false,
        emailPointsEarnedEnabled: false,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: false,
        emailNewProductEnabled: false,
        emailNewContentEnabled: false,
        adminEmailProductsEnabled: false,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 10,
        leaderboardRankingEnabled: false,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: '' as any,
        updatedBy: 'user-1',
      },
      client,
      'users-table',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should accept all three valid leaderboardUpdateFrequency values', async () => {
    for (const freq of ['daily', 'weekly', 'monthly'] as const) {
      const client = createMockClient();

      const result = await updateFeatureToggles(
        {
          codeRedemptionEnabled: true,
          pointsClaimEnabled: false,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: false,
          adminCategoriesEnabled: false,
          emailPointsEarnedEnabled: false,
          emailNewOrderEnabled: false,
          emailOrderShippedEnabled: false,
          emailNewProductEnabled: false,
          emailNewContentEnabled: false,
          adminEmailProductsEnabled: false,
          adminEmailContentEnabled: false,
          reservationApprovalPoints: 10,
          leaderboardRankingEnabled: false,
          leaderboardAnnouncementEnabled: false,
          leaderboardUpdateFrequency: freq,
          updatedBy: 'user-1',
        },
        client,
        'users-table',
      );

      expect(result.success).toBe(true);
      expect(result.settings!.leaderboardUpdateFrequency).toBe(freq);
    }
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
        emailPointsEarnedEnabled: true,
        emailNewOrderEnabled: false,
        emailOrderShippedEnabled: true,
        emailNewProductEnabled: false,
        emailNewContentEnabled: true,
        adminEmailProductsEnabled: true,
        adminEmailContentEnabled: false,
        reservationApprovalPoints: 20,
        leaderboardRankingEnabled: true,
        leaderboardAnnouncementEnabled: false,
        leaderboardUpdateFrequency: 'monthly',
        updatedBy: 'admin-1',
      },
      client,
      'users-table',
    );

    // First call is UpdateCommand, second is GetCommand (read-back)
    const updateCall = client.send.mock.calls[0][0];
    expect(updateCall.constructor.name).toBe('UpdateCommand');
    expect(updateCall.input.TableName).toBe('users-table');
    expect(updateCall.input.Key).toEqual({ userId: 'feature-toggles' });
    const vals = updateCall.input.ExpressionAttributeValues;
    expect(vals[':cre']).toBe(false);
    expect(vals[':pce']).toBe(true);
    expect(vals[':ape']).toBe(true);
    expect(vals[':aoe']).toBe(false);
    expect(vals[':acre']).toBe(false);
    expect(vals[':acae']).toBe(true);
    expect(vals[':epe']).toBe(true);
    expect(vals[':eno']).toBe(false);
    expect(vals[':eos']).toBe(true);
    expect(vals[':enp']).toBe(false);
    expect(vals[':enc']).toBe(true);
    expect(vals[':aepe']).toBe(true);
    expect(vals[':aece']).toBe(false);
    expect(vals[':rap']).toBe(20);
    expect(vals[':lre']).toBe(true);
    expect(vals[':lae']).toBe(false);
    expect(vals[':luf']).toBe('monthly');
    expect(vals[':ub']).toBe('admin-1');
    expect(vals[':ua']).toBeTruthy();

    // Second call is GetCommand (read-back)
    const getCall = client.send.mock.calls[1][0];
    expect(getCall.constructor.name).toBe('GetCommand');
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
