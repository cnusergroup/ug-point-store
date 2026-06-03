import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAssociation,
  type AssociationInput,
  type CreateAssociationParams,
} from './association';

// Task 2.6 — 关联唯一性单元/集成测试
//
// Uses a mocked DynamoDB Document Client (vi.fn routed by command constructor
// name, matching the style of revoke.test.ts) to verify:
//   1. A second create for the same `activityId` is rejected with
//      DUPLICATE_ASSOCIATION while the original association is left untouched
//      (no PutCommand to the associations table is issued).
//   2. A create request missing a required field returns
//      MISSING_REQUIRED_FIELD with a message naming the missing field, and no
//      write occurs.
// A happy-path create (activity exists, no existing association) is also
// asserted to issue a single conditional PutCommand to the associations table.
//
// Requirements: 1.6, 2.6

const ASSOCIATIONS_TABLE = 'PointsMall-ActivityTemplateAssociations';
const ACTIVITIES_TABLE = 'PointsMall-Activities';
const ACTIVITY_ID = 'act-001';

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

/** A fully valid association input (all required fields present). */
function makeValidInput(overrides: Partial<AssociationInput> = {}): AssociationInput {
  return {
    activityId: ACTIVITY_ID,
    eventName: 'AWS Community Day 2026 Summer',
    eventPrefix: 'ACD',
    year: '2026',
    season: 'Summer',
    allowedRoles: [
      { role: 'Speaker', identityText: 'Speaker' },
      { role: 'Volunteer', identityText: 'Volunteer' },
    ],
    ...overrides,
  };
}

function makeParams(overrides: Partial<CreateAssociationParams> = {}): CreateAssociationParams {
  return {
    input: makeValidInput(),
    createdBy: 'user-superadmin-001',
    dynamoClient: createMockDynamoClient(),
    associationsTable: ASSOCIATIONS_TABLE,
    activitiesTable: ACTIVITIES_TABLE,
    ...overrides,
  };
}

/** An existing association as returned from the activityId-index query. */
function existingAssociationItem() {
  return {
    associationId: '01HEXISTING0000000000000000',
    activityId: ACTIVITY_ID,
    eventName: '原有活动名称',
    eventPrefix: 'OLD',
    year: '2025',
    season: 'Spring',
    allowedRoles: [{ role: 'Speaker', roleCode: 'SPK', identityText: 'Speaker' }],
    locale: 'en',
    issuingOrganization: 'AWS User Group China',
    createdAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'user-superadmin-000',
  };
}

describe('createAssociation — 关联唯一性与必填校验', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('同一 activityId 二次创建被拒，返回 DUPLICATE_ASSOCIATION 且不写入（原关联不变）', async () => {
    const params = makeParams();
    const client = params.dynamoClient as any;

    const sentCommands: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      sentCommands.push(cmd);
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        // activity exists in PointsMall-Activities
        return Promise.resolve({ Item: { activityId: ACTIVITY_ID } });
      }
      if (cmdName === 'QueryCommand') {
        // activityId-index returns an existing association
        return Promise.resolve({ Items: [existingAssociationItem()] });
      }
      // any PutCommand here would be unexpected
      return Promise.resolve({});
    });

    const result = await createAssociation(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('DUPLICATE_ASSOCIATION');
      expect(result.message).toBe('该活动已存在证书模版关联');
      expect(result.statusCode).toBe(409);
    }

    // 原关联不变：NO PutCommand to the associations table was issued.
    const putCommands = sentCommands.filter(
      (c) => c.constructor.name === 'PutCommand',
    );
    expect(putCommands).toHaveLength(0);
  });

  it('缺失必填字段（eventName）返回 MISSING_REQUIRED_FIELD 且指明缺失字段，不发起任何写入', async () => {
    const input = makeValidInput();
    delete (input as Partial<AssociationInput>).eventName;
    const params = makeParams({ input });
    const client = params.dynamoClient;

    const result = await createAssociation(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.statusCode).toBe(400);
      // message names the missing field
      expect(result.message).toContain('eventName');
    }

    // Validation fails before any DynamoDB access — no commands at all.
    expect(client.send).not.toHaveBeenCalled();
  });

  it('缺失必填字段（allowedRoles）返回 MISSING_REQUIRED_FIELD 且指明缺失字段，不发起任何写入', async () => {
    const input = makeValidInput();
    delete (input as Partial<AssociationInput>).allowedRoles;
    const params = makeParams({ input });
    const client = params.dynamoClient;

    const result = await createAssociation(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('allowedRoles');
    }

    expect(client.send).not.toHaveBeenCalled();
  });

  it('活动存在且无已有关联时创建成功，发起一条带条件表达式的 PutCommand', async () => {
    const params = makeParams();
    const client = params.dynamoClient as any;

    const sentCommands: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      sentCommands.push(cmd);
      const cmdName = cmd.constructor.name;
      if (cmdName === 'GetCommand') {
        return Promise.resolve({ Item: { activityId: ACTIVITY_ID } });
      }
      if (cmdName === 'QueryCommand') {
        // no existing association for this activity
        return Promise.resolve({ Items: [] });
      }
      // PutCommand
      return Promise.resolve({});
    });

    const result = await createAssociation(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.association.activityId).toBe(ACTIVITY_ID);
      expect(result.association.eventName).toBe('AWS Community Day 2026 Summer');
      expect(result.association.createdBy).toBe('user-superadmin-001');
      expect(result.association.locale).toBe('en');
      // roleCode backfilled for each allowed role
      expect(result.association.allowedRoles.map((r) => r.roleCode)).toEqual([
        'SPK',
        'VOL',
      ]);
      // default issuing organization applied
      expect(result.association.issuingOrganization).toBe('AWS User Group China');
      expect(result.association.associationId).toBeTruthy();
    }

    // Exactly one conditional write to the associations table was issued.
    const putCommands = sentCommands.filter(
      (c) => c.constructor.name === 'PutCommand',
    );
    expect(putCommands).toHaveLength(1);
    expect(putCommands[0].input.TableName).toBe(ASSOCIATIONS_TABLE);
    expect(putCommands[0].input.ConditionExpression).toBe(
      'attribute_not_exists(associationId)',
    );
  });
});
