import { describe, it, expect, vi } from 'vitest';
import {
  roleFieldFor,
  aggregateClaims,
  isMergedSkillRecord,
  classifyOperation,
  buildPlan,
  applyOperation,
  type ClaimRow,
  type PointsRecordRow,
  type PlannedOperation,
} from './migrate-skill-points-to-volunteer';

// ============================================================
// Helpers
// ============================================================

const POINTS_RECORDS_TABLE = 'PointsRecords';
const CLAIMS_TABLE = 'Claims';
const USERS_TABLE = 'Users';

/**
 * Smart mock DynamoDBDocumentClient. Dispatches on the command constructor name:
 *   - ScanCommand          → returns the configured claim rows (PointsMall-Claims scan)
 *   - QueryCommand         → returns earn records for the queried (userId, activityId)
 *   - TransactWriteCommand → resolves {} (apply phase)
 */
function createMockClient(opts: {
  claims?: ClaimRow[];
  earnRecordsByKey?: Map<string, PointsRecordRow[]>;
  transactReject?: any;
}) {
  const send = vi.fn((command: any) => {
    const name = command.constructor.name;
    if (name === 'ScanCommand') {
      return Promise.resolve({ Items: opts.claims ?? [] });
    }
    if (name === 'QueryCommand') {
      const uid = command.input.ExpressionAttributeValues[':uid'];
      const aid = command.input.ExpressionAttributeValues[':aid'];
      const recs = opts.earnRecordsByKey?.get(`${uid}|${aid}`) ?? [];
      return Promise.resolve({ Items: recs });
    }
    if (name === 'TransactWriteCommand') {
      if (opts.transactReject) return Promise.reject(opts.transactReject);
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send } as any;
}

function makeClaim(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    activityId: 'act-001',
    skill: 'liveSupport',
    userId: 'u1',
    pointsAwarded: 20,
    distributionId: 'dist-001',
    ...overrides,
  };
}

function makeMergedRecord(overrides: Partial<PointsRecordRow> = {}): PointsRecordRow {
  return {
    recordId: 'rec-001',
    userId: 'u1',
    type: 'earn',
    amount: 70, // base 50 + skill 20
    source: '批量发放:UserGroupLeader|Tokyo|AWS Summit|2024-06-15|技能:liveSupport',
    balanceAfter: 170,
    createdAt: '2024-06-15T00:00:00Z',
    activityId: 'act-001',
    activityType: '线下活动',
    activityUG: 'Tokyo',
    activityTopic: 'AWS Summit',
    activityDate: '2024-06-15',
    targetRole: 'UserGroupLeader',
    ...overrides,
  };
}

// ============================================================
// 1. Pure helper unit tests
// ============================================================

describe('roleFieldFor', () => {
  it('maps UserGroupLeader → earnTotalLeader', () => {
    expect(roleFieldFor('UserGroupLeader')).toBe('earnTotalLeader');
  });

  it('maps Speaker → earnTotalSpeaker', () => {
    expect(roleFieldFor('Speaker')).toBe('earnTotalSpeaker');
  });

  it('returns null for Volunteer (no migration needed)', () => {
    expect(roleFieldFor('Volunteer')).toBeNull();
  });

  it('returns null for undefined / unknown roles', () => {
    expect(roleFieldFor(undefined)).toBeNull();
    expect(roleFieldFor('Admin')).toBeNull();
  });
});

describe('aggregateClaims', () => {
  it('aggregates skillSum and skills by (userId, activityId, distributionId)', () => {
    const groups = aggregateClaims([
      makeClaim({ skill: 'liveSupport', pointsAwarded: 20 }),
      makeClaim({ skill: 'posterDesign', pointsAwarded: 15 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].skillSum).toBe(35);
    expect(groups[0].skills).toEqual(['liveSupport', 'posterDesign']);
  });

  it('separates groups across different users / activities / distributions', () => {
    const groups = aggregateClaims([
      makeClaim({ userId: 'u1', activityId: 'act-001', distributionId: 'd1' }),
      makeClaim({ userId: 'u2', activityId: 'act-001', distributionId: 'd1' }),
      makeClaim({ userId: 'u1', activityId: 'act-002', distributionId: 'd2' }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('skips rows missing userId or activityId', () => {
    const groups = aggregateClaims([
      makeClaim({ userId: '' as any }),
      makeClaim({ activityId: '' as any }),
      makeClaim({ userId: 'u9', activityId: 'act-9', pointsAwarded: 10 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].userId).toBe('u9');
  });

  it('treats non-numeric pointsAwarded as 0', () => {
    const groups = aggregateClaims([makeClaim({ pointsAwarded: undefined as any })]);
    expect(groups[0].skillSum).toBe(0);
  });
});

describe('classifyOperation', () => {
  it('returns split when amount > skillSum (contains base points)', () => {
    expect(classifyOperation(70, 20)).toBe('split');
  });

  it('returns reclassify when amount === skillSum (pure skill)', () => {
    expect(classifyOperation(20, 20)).toBe('reclassify');
  });

  it('returns null when amount < skillSum (cannot be a merged skill record)', () => {
    expect(classifyOperation(10, 20)).toBeNull();
  });
});

describe('isMergedSkillRecord', () => {
  it('accepts a merged earn record (skill source, role, amount >= skillSum, not yet split)', () => {
    expect(isMergedSkillRecord(makeMergedRecord(), 'act-001', 20)).toBe(true);
  });

  it('rejects records already migrated (skillSplit=true) — idempotency guard', () => {
    expect(isMergedSkillRecord(makeMergedRecord({ skillSplit: true }), 'act-001', 20)).toBe(false);
  });

  it('rejects Volunteer-classified records (already correct)', () => {
    expect(isMergedSkillRecord(makeMergedRecord({ targetRole: 'Volunteer' }), 'act-001', 20)).toBe(false);
  });

  it('rejects records whose source has no skill marker', () => {
    expect(
      isMergedSkillRecord(makeMergedRecord({ source: '批量发放:UserGroupLeader|Tokyo' }), 'act-001', 20),
    ).toBe(false);
  });

  it('rejects records with a different activityId', () => {
    expect(isMergedSkillRecord(makeMergedRecord(), 'act-999', 20)).toBe(false);
  });

  it('rejects records with amount < skillSum', () => {
    expect(isMergedSkillRecord(makeMergedRecord({ amount: 10 }), 'act-001', 20)).toBe(false);
  });

  it('rejects non-earn records', () => {
    expect(isMergedSkillRecord(makeMergedRecord({ type: 'spend' }), 'act-001', 20)).toBe(false);
  });
});

// ============================================================
// 2. buildPlan — 拆分正确 (split) / 改分类 (reclassify)
// ============================================================

describe('buildPlan — classifies operations correctly', () => {
  it('拆分正确: merged record amount > skillSum → split operation (2 records affected)', async () => {
    const claims = [makeClaim({ userId: 'u1', pointsAwarded: 20 })];
    const earn = new Map<string, PointsRecordRow[]>([
      ['u1|act-001', [makeMergedRecord({ amount: 70, targetRole: 'UserGroupLeader' })]],
    ]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const plan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe('split');
    expect(plan.operations[0].roleField).toBe('earnTotalLeader');
    expect(plan.operations[0].group.skillSum).toBe(20);
    expect(plan.affectedRecordCount).toBe(2); // update R + new Volunteer V
    expect(plan.affectedUserIds.has('u1')).toBe(true);
    expect(plan.totalSkillPoints).toBe(20);
    expect(plan.unmatchedGroups).toHaveLength(0);
  });

  it('改分类: pure-skill amount === skillSum → reclassify operation (1 record affected)', async () => {
    const claims = [makeClaim({ userId: 'u2', pointsAwarded: 20, distributionId: 'd2' })];
    const earn = new Map<string, PointsRecordRow[]>([
      [
        'u2|act-001',
        [makeMergedRecord({ recordId: 'rec-pure', userId: 'u2', amount: 20, targetRole: 'Speaker' })],
      ],
    ]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const plan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].kind).toBe('reclassify');
    expect(plan.operations[0].roleField).toBe('earnTotalSpeaker');
    expect(plan.affectedRecordCount).toBe(1);
    expect(plan.totalSkillPoints).toBe(20);
  });

  it('skips Volunteer-role merged records (roleField null) — no migration needed', async () => {
    const claims = [makeClaim({ userId: 'u3', pointsAwarded: 20 })];
    const earn = new Map<string, PointsRecordRow[]>([
      // Source still contains 技能 but targetRole already Volunteer → isMergedSkillRecord rejects it.
      ['u3|act-001', [makeMergedRecord({ userId: 'u3', targetRole: 'Volunteer' })]],
    ]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const plan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.unmatchedGroups).toHaveLength(1);
  });
});

// ============================================================
// 3. 幂等：重复执行无副作用
// ============================================================

describe('buildPlan — idempotency (幂等)', () => {
  it('produces no operations when records are already migrated (skillSplit=true)', async () => {
    const claims = [makeClaim({ userId: 'u1', pointsAwarded: 20 })];
    // The original record was split (amount reduced + skillSplit) and a Volunteer record was added.
    const earn = new Map<string, PointsRecordRow[]>([
      [
        'u1|act-001',
        [
          makeMergedRecord({ recordId: 'rec-001', amount: 50, skillSplit: true }),
          makeMergedRecord({
            recordId: 'rec-vol',
            amount: 20,
            targetRole: 'Volunteer',
            skillSplit: true,
            source: '技能认领:Volunteer|Tokyo|AWS Summit|2024-06-15|技能:liveSupport',
          }),
        ],
      ],
    ]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const plan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.skippedAlreadyMigrated).toBe(1);
    expect(plan.affectedRecordCount).toBe(0);
    expect(plan.unmatchedGroups).toHaveLength(0);
  });

  it('re-running after a simulated apply yields no further writes (no extra Volunteer records)', async () => {
    const claims = [makeClaim({ userId: 'u1', pointsAwarded: 20 })];

    // First run: unmigrated merged record present.
    const recordsState: PointsRecordRow[] = [makeMergedRecord({ amount: 70, targetRole: 'UserGroupLeader' })];
    const earn = new Map<string, PointsRecordRow[]>([['u1|act-001', recordsState]]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const firstPlan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });
    expect(firstPlan.operations).toHaveLength(1);

    // Simulate the apply: original record gets skillSplit + reduced amount, and a Volunteer record is added.
    recordsState[0] = makeMergedRecord({ amount: 50, skillSplit: true });
    recordsState.push(
      makeMergedRecord({
        recordId: 'rec-vol',
        amount: 20,
        targetRole: 'Volunteer',
        skillSplit: true,
      }),
    );

    const secondPlan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });
    expect(secondPlan.operations).toHaveLength(0);
    expect(secondPlan.skippedAlreadyMigrated).toBe(1);
  });
});

// ============================================================
// 4. applyOperation — transaction construction & conservation
// ============================================================

function getTransactItems(client: any): any[] {
  const call = client.send.mock.calls.find((c: any[]) => c[0].constructor.name === 'TransactWriteCommand');
  return call[0].input.TransactItems;
}

describe('applyOperation — split transaction', () => {
  const splitOp: PlannedOperation = {
    kind: 'split',
    group: { userId: 'u1', activityId: 'act-001', distributionId: 'd1', skillSum: 20, skills: ['liveSupport'] },
    mergedRecord: makeMergedRecord({ amount: 70, targetRole: 'UserGroupLeader' }),
    roleField: 'earnTotalLeader',
  };

  it('builds Update(R) + Put(Volunteer) + Update(user) with correct fields', async () => {
    const client = createMockClient({});
    await applyOperation(client, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, splitOp);

    const items = getTransactItems(client);
    expect(items).toHaveLength(3);

    // 1) Update original record: amount -= skillSum, skillSplit=true, idempotency guard
    const updateR = items[0].Update;
    expect(updateR.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(updateR.Key).toEqual({ recordId: 'rec-001' });
    expect(updateR.UpdateExpression).toBe('SET amount = amount - :sv, skillSplit = :true');
    expect(updateR.ConditionExpression).toBe('attribute_not_exists(skillSplit)');
    expect(updateR.ExpressionAttributeValues[':sv']).toBe(20);

    // 2) New Volunteer skill record: amount = skillSum
    const putV = items[1].Put;
    expect(putV.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(putV.Item.amount).toBe(20);
    expect(putV.Item.targetRole).toBe('Volunteer');
    expect(putV.Item.skillSplit).toBe(true);
    expect(putV.Item.activityId).toBe('act-001');
    expect(putV.Item.source).toContain('技能认领');

    // 3) User update: role field -= skillSum, earnTotalVolunteer += skillSum
    const updateU = items[2].Update;
    expect(updateU.TableName).toBe(USERS_TABLE);
    expect(updateU.ExpressionAttributeNames['#rf']).toBe('earnTotalLeader');
    expect(updateU.ExpressionAttributeValues[':sv']).toBe(20);
    expect(updateU.UpdateExpression).toContain('#rf = if_not_exists(#rf, :zero) - :sv');
    expect(updateU.UpdateExpression).toContain('earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) + :sv');
  });

  // 需求 4.1: points/earnTotal 守恒 — user Update must never touch points or earnTotal.
  it('需求4.1 points/earnTotal 守恒: user Update references neither points nor earnTotal', async () => {
    const client = createMockClient({});
    await applyOperation(client, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, splitOp);

    const updateU = getTransactItems(client)[2].Update;
    const expr: string = updateU.UpdateExpression;
    // \bpoints\b would catch any standalone points reference
    expect(/\bpoints\b/.test(expr)).toBe(false);
    // \bearnTotal\b matches the bare total field but NOT earnTotalVolunteer (no word boundary before "Volunteer")
    expect(/\bearnTotal\b/.test(expr)).toBe(false);
  });

  // 需求 4.2: earn{Role} 三项之和守恒 — role field -skillSum, volunteer +skillSum nets to zero.
  it('需求4.2 earn{Role} 三项之和守恒: role -= skillSum and volunteer += skillSum (net zero)', async () => {
    const client = createMockClient({});
    await applyOperation(client, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, splitOp);

    const updateU = getTransactItems(client)[2].Update;
    const expr: string = updateU.UpdateExpression;
    const sv = updateU.ExpressionAttributeValues[':sv'];
    // The only two earn-field mutations are -:sv on the role field and +:sv on volunteer.
    expect(expr).toContain('#rf = if_not_exists(#rf, :zero) - :sv');
    expect(expr).toContain('earnTotalVolunteer = if_not_exists(earnTotalVolunteer, :zero) + :sv');
    expect(sv).toBe(splitOp.group.skillSum);
  });
});

describe('applyOperation — reclassify transaction', () => {
  const reclassifyOp: PlannedOperation = {
    kind: 'reclassify',
    group: { userId: 'u2', activityId: 'act-001', distributionId: 'd2', skillSum: 20, skills: ['posterDesign'] },
    mergedRecord: makeMergedRecord({ recordId: 'rec-pure', userId: 'u2', amount: 20, targetRole: 'Speaker' }),
    roleField: 'earnTotalSpeaker',
  };

  it('builds Update(R targetRole=Volunteer) + Update(user); no new record', async () => {
    const client = createMockClient({});
    await applyOperation(client, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, reclassifyOp);

    const items = getTransactItems(client);
    expect(items).toHaveLength(2);

    const updateR = items[0].Update;
    expect(updateR.UpdateExpression).toBe('SET targetRole = :vol, skillSplit = :true');
    expect(updateR.ConditionExpression).toBe('attribute_not_exists(skillSplit)');
    expect(updateR.ExpressionAttributeValues[':vol']).toBe('Volunteer');

    // No Put (no new Volunteer record created for pure-skill reclassify)
    expect(items.some((i: any) => i.Put)).toBe(false);

    const updateU = items[1].Update;
    expect(updateU.ExpressionAttributeNames['#rf']).toBe('earnTotalSpeaker');
    expect(updateU.ExpressionAttributeValues[':sv']).toBe(20);
  });

  it('需求4.1 points/earnTotal 守恒 also holds for reclassify', async () => {
    const client = createMockClient({});
    await applyOperation(client, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, reclassifyOp);
    const expr: string = getTransactItems(client)[1].Update.UpdateExpression;
    expect(/\bpoints\b/.test(expr)).toBe(false);
    expect(/\bearnTotal\b/.test(expr)).toBe(false);
  });
});

// ============================================================
// 5. 技能分总额守恒 (需求 4.3)
//    Σ claim.pointsAwarded == Σ Volunteer skill amounts produced by the migration.
// ============================================================

describe('技能分总额守恒 (需求 4.3)', () => {
  it('sum of claim pointsAwarded equals sum of produced Volunteer skill amounts', async () => {
    // Three groups: one split (UGL), one split (Speaker), one pure-skill reclassify.
    const claims: ClaimRow[] = [
      makeClaim({ userId: 'u1', activityId: 'act-001', distributionId: 'd1', skill: 'liveSupport', pointsAwarded: 20 }),
      makeClaim({ userId: 'u1', activityId: 'act-001', distributionId: 'd1', skill: 'posterDesign', pointsAwarded: 15 }),
      makeClaim({ userId: 'u2', activityId: 'act-002', distributionId: 'd2', skill: 'articleEditing', pointsAwarded: 10 }),
      makeClaim({ userId: 'u3', activityId: 'act-003', distributionId: 'd3', skill: 'liveSupport', pointsAwarded: 20 }),
    ];
    const earn = new Map<string, PointsRecordRow[]>([
      // u1: merged record contains base (80) + skill (35) → split
      ['u1|act-001', [makeMergedRecord({ recordId: 'r1', userId: 'u1', activityId: 'act-001', amount: 115, targetRole: 'UserGroupLeader' })]],
      // u2: merged record base (40) + skill (10) → split, Speaker
      ['u2|act-002', [makeMergedRecord({ recordId: 'r2', userId: 'u2', activityId: 'act-002', amount: 50, targetRole: 'Speaker' })]],
      // u3: pure skill (20) → reclassify
      ['u3|act-003', [makeMergedRecord({ recordId: 'r3', userId: 'u3', activityId: 'act-003', amount: 20, targetRole: 'UserGroupLeader' })]],
    ]);
    const client = createMockClient({ claims, earnRecordsByKey: earn });

    const plan = await buildPlan(client, {
      pointsRecordsTable: POINTS_RECORDS_TABLE,
      claimsTable: CLAIMS_TABLE,
    });

    const totalClaimPoints = claims.reduce((s, c) => s + c.pointsAwarded, 0); // 65
    expect(plan.totalSkillPoints).toBe(totalClaimPoints);

    // Apply every operation and collect the Volunteer skill amounts that land in the Volunteer classification.
    let volunteerTotal = 0;
    for (const op of plan.operations) {
      const opClient = createMockClient({});
      await applyOperation(opClient, { usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE }, op);
      const items = getTransactItems(opClient);
      if (op.kind === 'split') {
        // The newly created Volunteer Put carries the skill amount.
        const put = items.find((i: any) => i.Put);
        expect(put.Put.Item.targetRole).toBe('Volunteer');
        volunteerTotal += put.Put.Item.amount;
      } else {
        // reclassify: the original record (== skillSum) becomes Volunteer.
        volunteerTotal += op.group.skillSum;
      }
    }

    expect(volunteerTotal).toBe(totalClaimPoints);
  });
});
