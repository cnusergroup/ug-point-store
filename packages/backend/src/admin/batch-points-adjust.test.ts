import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DistributionRecord } from '@points-mall/shared';
import type { PointsRuleConfig } from '../settings/feature-toggles';
import { DEFAULT_POINTS_RULE_CONFIG } from '../settings/feature-toggles';
import {
  computeAdjustmentDiff,
  validateAdjustmentInput,
  executeAdjustment,
  type AdjustmentInput,
} from './batch-points-adjust';

// ============================================================
// Helpers
// ============================================================

function makeConfig(overrides: Partial<PointsRuleConfig> = {}): PointsRuleConfig {
  return { ...DEFAULT_POINTS_RULE_CONFIG, ...overrides };
}

function makeDistribution(overrides: Partial<DistributionRecord> = {}): DistributionRecord {
  return {
    distributionId: 'dist-001',
    distributorId: 'admin-001',
    distributorNickname: 'Admin',
    targetRole: 'Speaker',
    speakerType: 'typeA',
    recipientIds: ['u1', 'u2', 'u3'],
    points: 100, // speakerTypeAPoints default
    reason: '季度活动奖励',
    successCount: 3,
    totalPoints: 300,
    createdAt: '2024-06-01T00:00:00Z',
    activityId: 'act-001',
    activityUG: 'Tokyo',
    activityTopic: 'AWS Summit',
    activityDate: '2024-06-15',
    ...overrides,
  };
}

function makeInput(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    distributionId: 'dist-001',
    recipientIds: ['u1', 'u2', 'u3'],
    targetRole: 'Speaker',
    speakerType: 'typeA',
    adjustedBy: 'superadmin-001',
    ...overrides,
  };
}

// ============================================================
// 1. computeAdjustmentDiff — added / removed / retained users
// ============================================================

describe('computeAdjustmentDiff', () => {
  const config = makeConfig();

  describe('user set computation', () => {
    it('should identify added users (in new but not in original)', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2'] });
      const input = makeInput({ recipientIds: ['u1', 'u2', 'u3', 'u4'] });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.addedUserIds).toEqual(['u3', 'u4']);
    });

    it('should identify removed users (in original but not in new)', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2', 'u3'] });
      const input = makeInput({ recipientIds: ['u1'] });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.removedUserIds).toEqual(['u2', 'u3']);
    });

    it('should identify retained users (in both)', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2', 'u3'] });
      const input = makeInput({ recipientIds: ['u2', 'u3', 'u4'] });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.retainedUserIds).toEqual(['u2', 'u3']);
    });

    it('should handle complete replacement (all removed, all added)', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2'] });
      const input = makeInput({ recipientIds: ['u3', 'u4'] });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.addedUserIds).toEqual(['u3', 'u4']);
      expect(diff.removedUserIds).toEqual(['u1', 'u2']);
      expect(diff.retainedUserIds).toEqual([]);
    });

    it('should handle no user changes (same recipients)', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2'] });
      const input = makeInput({ recipientIds: ['u1', 'u2'] });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.addedUserIds).toEqual([]);
      expect(diff.removedUserIds).toEqual([]);
      expect(diff.retainedUserIds).toEqual(['u1', 'u2']);
    });
  });

  describe('points delta calculation', () => {
    it('should compute zero delta when role and speakerType are unchanged', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.originalPoints).toBe(100);
      expect(diff.newPoints).toBe(100); // speakerTypeAPoints = 100
      expect(diff.pointsDelta).toBe(0);
      // No userAdjustments for retained users when delta is 0
      expect(diff.userAdjustments).toEqual([]);
    });

    it('should compute positive delta when speaker type changes from typeB to typeA', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeB',
        points: 50, // speakerTypeBPoints = 50
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.originalPoints).toBe(50);
      expect(diff.newPoints).toBe(100); // speakerTypeAPoints = 100
      expect(diff.pointsDelta).toBe(50);
      // Both retained users should get +50 delta
      expect(diff.userAdjustments).toHaveLength(2);
      expect(diff.userAdjustments).toEqual(
        expect.arrayContaining([
          { userId: 'u1', delta: 50 },
          { userId: 'u2', delta: 50 },
        ]),
      );
    });

    it('should compute negative delta when speaker type changes from typeA to roundtable', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'roundtable',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.originalPoints).toBe(100);
      expect(diff.newPoints).toBe(50); // speakerRoundtablePoints = 50
      expect(diff.pointsDelta).toBe(-50);
      expect(diff.userAdjustments).toEqual([{ userId: 'u1', delta: -50 }]);
    });

    it('should compute delta when role changes from Speaker to Volunteer', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.originalPoints).toBe(100);
      expect(diff.newPoints).toBe(30); // volunteerPointsPerEvent = 30
      expect(diff.pointsDelta).toBe(-70);
      expect(diff.userAdjustments).toEqual([{ userId: 'u1', delta: -70 }]);
    });

    it('should compute delta when role changes from Volunteer to UserGroupLeader', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Volunteer',
        points: 30,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.originalPoints).toBe(30);
      expect(diff.newPoints).toBe(50); // uglPointsPerEvent = 50
      expect(diff.pointsDelta).toBe(20);
      expect(diff.userAdjustments).toEqual([{ userId: 'u1', delta: 20 }]);
    });
  });

  describe('per-user adjustment amounts', () => {
    it('should assign negative delta equal to original points for removed users', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      const removedAdj = diff.userAdjustments.find(ua => ua.userId === 'u2');
      expect(removedAdj).toEqual({ userId: 'u2', delta: -100 });
    });

    it('should assign positive delta equal to new points for added users', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      const addedAdj = diff.userAdjustments.find(ua => ua.userId === 'u2');
      expect(addedAdj).toEqual({ userId: 'u2', delta: 100 });
    });

    it('should not include retained users when points are unchanged', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2', 'u3'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      // Only added user u3 should have an adjustment
      expect(diff.userAdjustments).toHaveLength(1);
      expect(diff.userAdjustments[0]).toEqual({ userId: 'u3', delta: 100 });
    });

    it('should handle mixed scenario: add, remove, and retain with speaker type change', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2', 'u3'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });
      // Remove u3, add u4, retain u1 & u2, change speakerType to typeB
      const input = makeInput({
        recipientIds: ['u1', 'u2', 'u4'],
        targetRole: 'Speaker',
        speakerType: 'typeB',
      });

      const diff = computeAdjustmentDiff(original, input, config);

      expect(diff.addedUserIds).toEqual(['u4']);
      expect(diff.removedUserIds).toEqual(['u3']);
      expect(diff.retainedUserIds).toEqual(['u1', 'u2']);
      expect(diff.originalPoints).toBe(100);
      expect(diff.newPoints).toBe(50); // speakerTypeBPoints = 50
      expect(diff.pointsDelta).toBe(-50);

      // Removed u3: -100 (original points)
      expect(diff.userAdjustments).toContainEqual({ userId: 'u3', delta: -100 });
      // Added u4: +50 (new points)
      expect(diff.userAdjustments).toContainEqual({ userId: 'u4', delta: 50 });
      // Retained u1, u2: -50 each (delta)
      expect(diff.userAdjustments).toContainEqual({ userId: 'u1', delta: -50 });
      expect(diff.userAdjustments).toContainEqual({ userId: 'u2', delta: -50 });
      expect(diff.userAdjustments).toHaveLength(4);
    });
  });

  describe('custom config values', () => {
    it('should use custom config values for points calculation', () => {
      const customConfig = makeConfig({
        speakerTypeAPoints: 200,
        speakerTypeBPoints: 80,
      });
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeB',
        points: 80,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const diff = computeAdjustmentDiff(original, input, customConfig);

      expect(diff.originalPoints).toBe(80);
      expect(diff.newPoints).toBe(200);
      expect(diff.pointsDelta).toBe(120);
      expect(diff.userAdjustments).toEqual([{ userId: 'u1', delta: 120 }]);
    });
  });
});

// ============================================================
// 2. validateAdjustmentInput
// ============================================================

describe('validateAdjustmentInput', () => {
  const config = makeConfig();

  describe('empty recipients (Req 10.1)', () => {
    it('should reject empty recipientIds array', () => {
      const original = makeDistribution();
      const input = makeInput({ recipientIds: [] });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('should reject undefined recipientIds', () => {
      const original = makeDistribution();
      const input = makeInput({ recipientIds: undefined as any });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });
  });

  describe('missing speakerType for Speaker role (Req 10.2)', () => {
    it('should reject Speaker role without speakerType', () => {
      const original = makeDistribution();
      const input = makeInput({
        targetRole: 'Speaker',
        speakerType: undefined,
        recipientIds: ['u1', 'u4'], // different from original to avoid NO_CHANGES
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('speakerType');
      }
    });

    it('should accept Speaker role with valid speakerType', () => {
      const original = makeDistribution({ recipientIds: ['u1'] });
      const input = makeInput({
        targetRole: 'Speaker',
        speakerType: 'typeB',
        recipientIds: ['u1'],
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });
  });

  describe('volunteer limit exceeded (Req 10.3)', () => {
    it('should reject when volunteer count exceeds volunteerMaxPerEvent', () => {
      const original = makeDistribution({ targetRole: 'Volunteer' });
      // Default volunteerMaxPerEvent = 10, send 11 unique users
      const userIds = Array.from({ length: 11 }, (_, i) => `vol-${i + 1}`);
      const input = makeInput({
        recipientIds: userIds,
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('VOLUNTEER_LIMIT_EXCEEDED');
      }
    });

    it('should accept when volunteer count equals volunteerMaxPerEvent', () => {
      const original = makeDistribution({ targetRole: 'Volunteer', recipientIds: ['v1'] });
      // Default volunteerMaxPerEvent = 10, send exactly 10 unique users
      const userIds = Array.from({ length: 10 }, (_, i) => `vol-${i + 1}`);
      const input = makeInput({
        recipientIds: userIds,
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should deduplicate recipientIds when checking volunteer limit', () => {
      const original = makeDistribution({ targetRole: 'Volunteer', recipientIds: ['v1'] });
      // 11 entries but only 5 unique — should pass
      const userIds = ['v1', 'v1', 'v2', 'v2', 'v3', 'v3', 'v4', 'v4', 'v5', 'v5', 'v1'];
      const input = makeInput({
        recipientIds: userIds,
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should not check volunteer limit for non-Volunteer roles', () => {
      const original = makeDistribution({ targetRole: 'Speaker', speakerType: 'typeA', recipientIds: ['u1'] });
      // 15 users as Speaker — should not trigger volunteer limit
      const userIds = Array.from({ length: 15 }, (_, i) => `spk-${i + 1}`);
      const input = makeInput({
        recipientIds: userIds,
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should use custom volunteerMaxPerEvent from config', () => {
      const customConfig = makeConfig({ volunteerMaxPerEvent: 3 });
      const original = makeDistribution({ targetRole: 'Volunteer', recipientIds: ['v1'] });
      const userIds = ['v1', 'v2', 'v3', 'v4']; // 4 > 3
      const input = makeInput({
        recipientIds: userIds,
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, customConfig);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('VOLUNTEER_LIMIT_EXCEEDED');
      }
    });
  });

  describe('no changes detected (Req 10.5)', () => {
    it('should reject when recipients, role, and speakerType are all unchanged', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('NO_CHANGES');
      }
    });

    it('should reject when recipients are same but in different order', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2', 'u3'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u3', 'u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('NO_CHANGES');
      }
    });

    it('should accept when recipients changed', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1', 'u3'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should accept when speakerType changed', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeB',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should accept when targetRole changed', () => {
      const original = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });
  });

  describe('valid inputs', () => {
    it('should accept valid adjustment with added users', () => {
      const original = makeDistribution({ recipientIds: ['u1'] });
      const input = makeInput({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should accept valid adjustment with removed users', () => {
      const original = makeDistribution({ recipientIds: ['u1', 'u2', 'u3'] });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should accept Volunteer role without speakerType', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Volunteer',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });

    it('should accept UserGroupLeader role without speakerType', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'UserGroupLeader',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(true);
    });
  });

  describe('validation priority', () => {
    it('should reject empty recipients before checking speakerType', () => {
      const original = makeDistribution();
      const input = makeInput({
        recipientIds: [],
        targetRole: 'Speaker',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Should be INVALID_REQUEST for empty recipients, not for missing speakerType
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('should reject missing speakerType before checking no-changes', () => {
      const original = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: undefined as any,
      });
      const input = makeInput({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: undefined,
      });

      const result = validateAdjustmentInput(original, input, config);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toContain('speakerType');
      }
    });
  });
});

// ============================================================
// 3. executeAdjustment — integration tests
// ============================================================

const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';
const BATCH_DISTRIBUTIONS_TABLE = 'BatchDistributions';
const TABLES = {
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  batchDistributionsTable: BATCH_DISTRIBUTIONS_TABLE,
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

/** Default feature-toggles response with default PointsRuleConfig */
function featureTogglesResponse(overrides: Partial<PointsRuleConfig> = {}) {
  return {
    Item: {
      userId: 'feature-toggles',
      pointsRuleConfig: { ...DEFAULT_POINTS_RULE_CONFIG, ...overrides },
    },
  };
}

describe('executeAdjustment', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --------------------------------------------------------
  // 3.1 Distribution not found (Req 6.1)
  // --------------------------------------------------------

  describe('distribution not found', () => {
    it('should return DISTRIBUTION_NOT_FOUND when distributionId does not exist', async () => {
      // GetCommand for DistributionRecord returns nothing
      client.send.mockResolvedValueOnce({ Item: undefined });

      const result = await executeAdjustment(
        makeInput({ distributionId: 'nonexistent' }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISTRIBUTION_NOT_FOUND');
      // Should stop after the first GetCommand — no further calls
      expect(client.send).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------
  // 3.2 Successful adjustment with added/removed/retained users (Req 6.1, 7.1–7.3, 8.1–8.5)
  // --------------------------------------------------------

  describe('successful adjustment with added/removed/retained users', () => {
    it('should execute full adjustment: add u4, remove u3, retain u1 & u2', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1', 'u2', 'u3'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
        successCount: 3,
        totalPoints: 300,
      });

      // 1. GetCommand — fetch DistributionRecord
      client.send.mockResolvedValueOnce({ Item: originalDist });
      // 2. GetCommand — fetch feature-toggles
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // 3. BatchGetCommand — fetch balances for ALL negative-delta users
      //    Removed u3 (-100), retained u1 (-50), retained u2 (-50) all have negative deltas
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u3', points: 200 },
            { userId: 'u1', points: 500 },
            { userId: 'u2', points: 500 },
          ],
        },
      });
      // 4. BatchGetCommand — fetch user details for new recipients [u1, u2, u4]
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
            { userId: 'u4', nickname: 'Dave', email: 'dave@test.com' },
          ],
        },
      });
      // 5. TransactWriteCommand — user batch succeeds
      client.send.mockResolvedValueOnce({});
      // 6. UpdateCommand — update DistributionRecord
      client.send.mockResolvedValueOnce({});

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2', 'u4'],
          targetRole: 'Speaker',
          speakerType: 'typeB', // changed from typeA → typeB
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Verify TransactWriteCommand was called (call index 4)
      const txCmd = client.send.mock.calls[4][0];
      expect(txCmd.constructor.name).toBe('TransactWriteCommand');
      const items = txCmd.input.TransactItems;
      // 4 affected users (u3 removed, u4 added, u1 & u2 retained with delta) × 2 ops = 8 items
      expect(items).toHaveLength(8);

      // Verify correction records have type 'adjust'
      const putItems = items.filter((item: any) => item.Put);
      expect(putItems).toHaveLength(4);
      for (const putItem of putItems) {
        expect(putItem.Put.Item.type).toBe('adjust');
        expect(putItem.Put.Item.distributionId).toBe('dist-001');
      }

      // Verify UpdateCommand for DistributionRecord (call index 5)
      const updateCmd = client.send.mock.calls[5][0];
      expect(updateCmd.constructor.name).toBe('UpdateCommand');
      expect(updateCmd.input.TableName).toBe(BATCH_DISTRIBUTIONS_TABLE);
      expect(updateCmd.input.Key).toEqual({ distributionId: 'dist-001' });
      // New points = speakerTypeBPoints = 50, 3 users
      expect(updateCmd.input.ExpressionAttributeValues[':pts']).toBe(50);
      expect(updateCmd.input.ExpressionAttributeValues[':sc']).toBe(3);
      expect(updateCmd.input.ExpressionAttributeValues[':tp']).toBe(150); // 3 × 50
      expect(updateCmd.input.ExpressionAttributeValues[':rids']).toEqual(['u1', 'u2', 'u4']);
      expect(updateCmd.input.ExpressionAttributeValues[':aby']).toBe('superadmin-001');
    });

    it('should write correction records preserving original earn records (Req 8.5)', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // No negative-delta users when adding u2 (u1 retained with same points if speakerType unchanged)
      // But we change speakerType so u1 gets delta -50
      client.send.mockResolvedValueOnce({
        Responses: { [USERS_TABLE]: [{ userId: 'u1', points: 500 }] },
      });
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
          ],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'],
          targetRole: 'Speaker',
          speakerType: 'typeB', // changed: 100 → 50
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);

      // Verify correction records contain activity metadata
      const txCmd = client.send.mock.calls[4][0];
      const putItems = txCmd.input.TransactItems.filter((item: any) => item.Put);
      for (const putItem of putItems) {
        expect(putItem.Put.Item.activityId).toBe('act-001');
        expect(putItem.Put.Item.activityUG).toBe('Tokyo');
        expect(putItem.Put.Item.activityTopic).toBe('AWS Summit');
        expect(putItem.Put.Item.activityDate).toBe('2024-06-15');
        expect(putItem.Put.Item.type).toBe('adjust');
        expect(putItem.Put.Item.recordId).toBeDefined();
        expect(putItem.Put.Item.createdAt).toBeDefined();
      }
    });
  });

  // --------------------------------------------------------
  // 3.3 Insufficient balance rejection (Req 7.5)
  // --------------------------------------------------------

  describe('insufficient balance rejection', () => {
    it('should reject when removed user would have negative balance', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u2 has only 50 points but needs -100 deduction
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u2', points: 50 }],
        },
      });

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1'], // remove u2
          targetRole: 'Speaker',
          speakerType: 'typeA',
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT_BALANCE');
      expect(result.error?.message).toContain('u2');
    });

    it('should reject when retained user with negative delta would go below zero', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u1 has 30 points, delta = 50 - 100 = -50 → would go to -20
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u1', points: 30 }],
        },
      });

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1'],
          targetRole: 'Speaker',
          speakerType: 'typeB', // typeA(100) → typeB(50), delta = -50
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should pass when user has exactly enough balance for negative delta', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u2 has exactly 100 points, delta = -100 → balance becomes 0 (OK)
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u2', points: 100 }],
        },
      });
      // Fetch user details for new recipients [u1]
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u1', nickname: 'Alice', email: 'alice@test.com' }],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1'], // remove u2
          targetRole: 'Speaker',
          speakerType: 'typeA',
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------
  // 3.4 Batch splitting for >12 users (USERS_PER_BATCH = 12) (Req 6.2)
  // --------------------------------------------------------

  describe('batch splitting for many users', () => {
    it('should split into multiple TransactWriteCommand batches when users exceed USERS_PER_BATCH', async () => {
      // Original has 1 user, we add 14 new users → 15 total affected (1 retained + 14 added)
      // But we need a change: change speakerType so retained user also gets a delta
      const originalDist = makeDistribution({
        recipientIds: ['u-orig'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      const newUserIds = Array.from({ length: 14 }, (_, i) => `u-new-${i + 1}`);
      const allNewRecipients = ['u-orig', ...newUserIds];

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u-orig has negative delta (typeA 100 → typeB 50 = -50), need balance check
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u-orig', points: 500 }],
        },
      });
      // Fetch user details for all 15 recipients
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: allNewRecipients.map(id => ({
            userId: id,
            nickname: `Nick-${id}`,
            email: `${id}@test.com`,
          })),
        },
      });
      // Two TransactWriteCommand batches (12 + 3 users)
      client.send.mockResolvedValueOnce({}); // batch 1
      client.send.mockResolvedValueOnce({}); // batch 2
      // UpdateCommand for DistributionRecord
      client.send.mockResolvedValueOnce({});

      const result = await executeAdjustment(
        makeInput({
          recipientIds: allNewRecipients,
          targetRole: 'Speaker',
          speakerType: 'typeB', // changed to trigger delta for retained user
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);

      // Verify two TransactWriteCommand calls were made
      const txCalls = client.send.mock.calls.filter(
        (call: any) => call[0].constructor.name === 'TransactWriteCommand',
      );
      expect(txCalls).toHaveLength(2);

      // First batch: 12 users × 2 items = 24 items
      expect(txCalls[0][0].input.TransactItems).toHaveLength(24);
      // Second batch: 3 users × 2 items = 6 items
      expect(txCalls[1][0].input.TransactItems).toHaveLength(6);
    });

    it('should return ADJUSTMENT_FAILED if any transaction batch fails (Req 6.3)', async () => {
      // Use a scenario with only added users (positive deltas) so no balance check is needed
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // No negative-delta users: u1 retained with same points, u2 added with +100
      // Fetch user details
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
          ],
        },
      });
      // TransactWriteCommand fails
      client.send.mockRejectedValueOnce(new Error('TransactionCanceledException'));

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'], // add u2, retain u1 with same speakerType
          targetRole: 'Speaker',
          speakerType: 'typeA', // same speakerType → no delta for retained u1, only u2 added (+100)
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ADJUSTMENT_FAILED');
    });
  });

  // --------------------------------------------------------
  // 3.5 Role change earnTotal adjustments (Req 7.3, 7.4)
  // --------------------------------------------------------

  describe('role change earnTotal adjustments', () => {
    it('should update role-specific earnTotal fields when role changes from Speaker to Volunteer', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u1 has negative delta: 30 - 100 = -70, check balance
      client.send.mockResolvedValueOnce({
        Responses: { [USERS_TABLE]: [{ userId: 'u1', points: 200 }] },
      });
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u1', nickname: 'Alice', email: 'alice@test.com' }],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1'],
          targetRole: 'Volunteer', // changed from Speaker
          speakerType: undefined,
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);

      // Verify the Update item for u1 handles role change
      const txCmd = client.send.mock.calls[4][0];
      const updateItem = txCmd.input.TransactItems.find((item: any) => item.Update);
      expect(updateItem).toBeDefined();

      // Role changed: should reference both original (earnTotalSpeaker) and new (earnTotalVolunteer) fields
      const expr = updateItem.Update.UpdateExpression;
      const names = updateItem.Update.ExpressionAttributeNames;
      expect(names['#origRole']).toBe('earnTotalSpeaker');
      expect(names['#newRole']).toBe('earnTotalVolunteer');
      // Delta = volunteerPoints(30) - speakerTypeA(100) = -70
      expect(updateItem.Update.ExpressionAttributeValues[':delta']).toBe(-70);
      expect(updateItem.Update.ExpressionAttributeValues[':origPts']).toBe(100);
      expect(updateItem.Update.ExpressionAttributeValues[':newPts']).toBe(30);
    });

    it('should update role-specific earnTotal fields when role changes from Volunteer to UserGroupLeader', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Volunteer',
        speakerType: undefined,
        points: 30,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // Positive delta: 50 - 30 = +20, no balance check needed
      // Fetch user details
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [{ userId: 'u1', nickname: 'Alice', email: 'alice@test.com' }],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1'],
          targetRole: 'UserGroupLeader', // changed from Volunteer
          speakerType: undefined,
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);

      const txCmd = client.send.mock.calls[3][0];
      const updateItem = txCmd.input.TransactItems.find((item: any) => item.Update);
      const names = updateItem.Update.ExpressionAttributeNames;
      expect(names['#origRole']).toBe('earnTotalVolunteer');
      expect(names['#newRole']).toBe('earnTotalLeader');
      expect(updateItem.Update.ExpressionAttributeValues[':delta']).toBe(20);
    });

    it('should use normal (non-role-change) path for added users even when role changed', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // u1 retained with negative delta: 50 - 100 = -50
      client.send.mockResolvedValueOnce({
        Responses: { [USERS_TABLE]: [{ userId: 'u1', points: 500 }] },
      });
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
          ],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'], // u2 is added
          targetRole: 'UserGroupLeader', // role changed from Speaker
          speakerType: undefined,
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(true);

      const txCmd = client.send.mock.calls[4][0];
      const txItems = txCmd.input.TransactItems;

      // Find the Update for u2 (added user) — should use normal path with newRole field
      const u2Update = txItems.find(
        (item: any) => item.Update && item.Update.Key.userId === 'u2',
      );
      expect(u2Update).toBeDefined();
      // Added user uses newRoleField (earnTotalLeader), not the role-change path
      expect(u2Update.Update.ExpressionAttributeNames['#rf']).toBe('earnTotalLeader');
      expect(u2Update.Update.ExpressionAttributeValues[':delta']).toBe(50); // uglPointsPerEvent

      // Find the Update for u1 (retained user with role change) — should use role-change path
      const u1Update = txItems.find(
        (item: any) => item.Update && item.Update.Key.userId === 'u1',
      );
      expect(u1Update).toBeDefined();
      expect(u1Update.Update.ExpressionAttributeNames['#origRole']).toBe('earnTotalSpeaker');
      expect(u1Update.Update.ExpressionAttributeNames['#newRole']).toBe('earnTotalLeader');
    });
  });

  // --------------------------------------------------------
  // 3.6 Validation pass-through (Req 10.1–10.5)
  // --------------------------------------------------------

  describe('validation pass-through', () => {
    it('should return NO_CHANGES when no actual changes detected', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1', 'u2'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'],
          targetRole: 'Speaker',
          speakerType: 'typeA',
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_CHANGES');
    });

    it('should return INVALID_REQUEST when recipientIds is empty', async () => {
      const originalDist = makeDistribution();

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());

      const result = await executeAdjustment(
        makeInput({ recipientIds: [] }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REQUEST');
    });
  });

  // --------------------------------------------------------
  // 3.7 Distribution record update (Req 9.1–9.5)
  // --------------------------------------------------------

  describe('distribution record update', () => {
    it('should update DistributionRecord with adjusted state including adjustedAt and adjustedBy', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // No negative-delta users (adding u2 with +100)
      // Fetch user details
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
          ],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite
      client.send.mockResolvedValueOnce({}); // UpdateCommand

      await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'],
          targetRole: 'Speaker',
          speakerType: 'typeA',
          adjustedBy: 'sa-admin-99',
        }),
        client,
        TABLES,
      );

      // Verify the UpdateCommand for DistributionRecord
      const updateCmd = client.send.mock.calls[4][0];
      expect(updateCmd.constructor.name).toBe('UpdateCommand');
      const vals = updateCmd.input.ExpressionAttributeValues;
      expect(vals[':rids']).toEqual(['u1', 'u2']);
      expect(vals[':tr']).toBe('Speaker');
      expect(vals[':pts']).toBe(100); // speakerTypeAPoints
      expect(vals[':sc']).toBe(2);
      expect(vals[':tp']).toBe(200); // 2 × 100
      expect(vals[':aby']).toBe('sa-admin-99');
      expect(vals[':aat']).toBeDefined(); // ISO timestamp
      expect(vals[':st']).toBe('typeA');

      // Verify recipientDetails are included
      expect(vals[':rdetails']).toEqual([
        { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
        { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
      ]);
    });

    it('should return ADJUSTMENT_FAILED when DistributionRecord update fails', async () => {
      const originalDist = makeDistribution({
        recipientIds: ['u1'],
        targetRole: 'Speaker',
        speakerType: 'typeA',
        points: 100,
      });

      client.send.mockResolvedValueOnce({ Item: originalDist });
      client.send.mockResolvedValueOnce(featureTogglesResponse());
      // Fetch user details
      client.send.mockResolvedValueOnce({
        Responses: {
          [USERS_TABLE]: [
            { userId: 'u1', nickname: 'Alice', email: 'alice@test.com' },
            { userId: 'u2', nickname: 'Bob', email: 'bob@test.com' },
          ],
        },
      });
      client.send.mockResolvedValueOnce({}); // TransactWrite succeeds
      // UpdateCommand for DistributionRecord fails
      client.send.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      const result = await executeAdjustment(
        makeInput({
          recipientIds: ['u1', 'u2'],
          targetRole: 'Speaker',
          speakerType: 'typeA',
        }),
        client,
        TABLES,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ADJUSTMENT_FAILED');
    });
  });
});
