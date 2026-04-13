/**
 * 端到端集成测试 - 积分商城系统
 *
 * 测试完整的跨服务业务流程：
 * 1. 积分码兑换 → 积分商品兑换流程 (需求 4.1, 6.1)
 * 2. Code 专属商品兑换流程 (需求 7.1)
 * 3. 角色变更后权限变化 (需求 3.4)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redeemCode, RedeemCodeTableNames } from '../points/redeem-code';
import { redeemWithPoints, RedemptionTableNames } from '../redemptions/points-redemption';
import { redeemWithCode, CodeRedemptionTableNames } from '../redemptions/code-redemption';
import { assignRoles, revokeRole } from '../admin/roles';
import { ErrorCodes } from '@points-mall/shared';

// ---------------------------------------------------------------------------
// Shared table names
// ---------------------------------------------------------------------------
const CODES_TABLE = 'Codes';
const USERS_TABLE = 'Users';
const PRODUCTS_TABLE = 'Products';
const REDEMPTIONS_TABLE = 'Redemptions';
const POINTS_RECORDS_TABLE = 'PointsRecords';

const redeemCodeTables: RedeemCodeTableNames = {
  codesTable: CODES_TABLE,
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
};

const pointsRedemptionTables: RedemptionTableNames = {
  usersTable: USERS_TABLE,
  productsTable: PRODUCTS_TABLE,
  redemptionsTable: REDEMPTIONS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

const codeRedemptionTables: CodeRedemptionTableNames = {
  codesTable: CODES_TABLE,
  productsTable: PRODUCTS_TABLE,
  redemptionsTable: REDEMPTIONS_TABLE,
  addressesTable: 'Addresses',
  ordersTable: 'Orders',
};

// ---------------------------------------------------------------------------
// Helpers – simulated in-memory DynamoDB state
// ---------------------------------------------------------------------------

interface MockState {
  users: Record<string, any>;
  codes: Record<string, any>;
  products: Record<string, any>;
  redemptions: Record<string, any>;
  pointsRecords: Record<string, any>;
  addresses: Record<string, any>;
  orders: Record<string, any>;
}

/**
 * Build a mock DynamoDB client that tracks state across sequential calls.
 * Each service function issues specific DynamoDB commands in a known order,
 * so we wire up responses that reflect the current in-memory state and
 * apply side-effects for TransactWriteCommand to keep state consistent.
 */
function createStatefulMockClient(state: MockState) {
  const send = vi.fn().mockImplementation((cmd: any) => {
    const name: string = cmd.constructor.name;

    // --- QueryCommand (Codes table codeValue-index) ---
    if (name === 'QueryCommand') {
      const codeValue = cmd.input.ExpressionAttributeValues[':cv'];
      const match = Object.values(state.codes).find((c: any) => c.codeValue === codeValue);
      return Promise.resolve({ Items: match ? [{ ...match }] : [] });
    }

    // --- GetCommand ---
    if (name === 'GetCommand') {
      const table = cmd.input.TableName;
      if (table === USERS_TABLE) {
        const userId = cmd.input.Key.userId;
        const user = state.users[userId];
        return Promise.resolve({ Item: user ? { ...user } : undefined });
      }
      if (table === PRODUCTS_TABLE) {
        const productId = cmd.input.Key.productId;
        const product = state.products[productId];
        return Promise.resolve({ Item: product ? { ...product } : undefined });
      }
      if (table === 'Addresses') {
        const addressId = cmd.input.Key.addressId;
        const address = state.addresses[addressId];
        return Promise.resolve({ Item: address ? { ...address } : undefined });
      }
    }

    // --- UpdateCommand (role assign / revoke) ---
    if (name === 'UpdateCommand') {
      const table = cmd.input.TableName;
      if (table === USERS_TABLE) {
        const userId = cmd.input.Key.userId;
        const expr: string = cmd.input.UpdateExpression ?? '';
        // Current implementation uses SET #roles = :roles
        if (expr.includes('#roles') && cmd.input.ExpressionAttributeValues[':roles']) {
          const user = state.users[userId] ?? { userId, roles: [], points: 0 };
          user.roles = cmd.input.ExpressionAttributeValues[':roles'];
          state.users[userId] = user;
        }
      }
      return Promise.resolve({});
    }

    // --- TransactWriteCommand – apply side-effects to state ---
    if (name === 'TransactWriteCommand') {
      const items: any[] = cmd.input.TransactItems;
      for (const item of items) {
        if (item.Update) {
          const table = item.Update.TableName;
          const expr: string = item.Update.UpdateExpression ?? '';
          if (table === CODES_TABLE) {
            const codeId = item.Update.Key.codeId;
            const code = state.codes[codeId];
            if (code) {
              code.currentUses += 1;
              code.status = item.Update.ExpressionAttributeValues[':newStatus'] ?? code.status;
              // record userId in usedBy
              const uidKey = Object.keys(item.Update.ExpressionAttributeNames ?? {}).find(
                (k) => k !== '#s',
              );
              if (uidKey) {
                const userId = item.Update.ExpressionAttributeNames[uidKey];
                if (!code.usedBy) code.usedBy = {};
                code.usedBy[userId] = new Date().toISOString();
              }
            }
          }
          if (table === USERS_TABLE) {
            const userId = item.Update.Key.userId;
            const user = state.users[userId];
            if (user) {
              if (expr.includes('points + :pv')) {
                user.points += item.Update.ExpressionAttributeValues[':pv'];
              } else if (expr.includes('points - :cost')) {
                user.points -= item.Update.ExpressionAttributeValues[':cost'];
              }
            }
          }
          if (table === PRODUCTS_TABLE) {
            const productId = item.Update.Key.productId;
            const product = state.products[productId];
            if (product) {
              product.stock -= 1;
              product.redemptionCount += 1;
            }
          }
        }
        if (item.Put) {
          const table = item.Put.TableName;
          if (table === REDEMPTIONS_TABLE) {
            state.redemptions[item.Put.Item.redemptionId] = item.Put.Item;
          }
          if (table === POINTS_RECORDS_TABLE) {
            state.pointsRecords[item.Put.Item.recordId] = item.Put.Item;
          }
          if (table === 'Orders') {
            state.orders[item.Put.Item.orderId] = item.Put.Item;
          }
        }
      }
      return Promise.resolve({});
    }

    return Promise.resolve({});
  });

  return { send } as any;
}

function makeInitialState(): MockState {
  return {
    users: {
      'user-001': {
        userId: 'user-001',
        nickname: 'Alice',
        email: 'alice@example.com',
        roles: ['Speaker'],
        points: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
    codes: {
      'code-points-001': {
        codeId: 'code-points-001',
        codeValue: 'EARN-500',
        type: 'points',
        pointsValue: 500,
        maxUses: 10,
        currentUses: 0,
        status: 'active',
        usedBy: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      'code-product-001': {
        codeId: 'code-product-001',
        codeValue: 'EXCLUSIVE-GIFT',
        type: 'product',
        productId: 'prod-exclusive-001',
        maxUses: 1,
        currentUses: 0,
        status: 'active',
        usedBy: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    },
    products: {
      'prod-points-001': {
        productId: 'prod-points-001',
        name: 'Speaker 专属礼品',
        description: '仅限 Speaker 兑换',
        imageUrl: 'https://example.com/speaker-gift.png',
        type: 'points',
        status: 'active',
        stock: 5,
        redemptionCount: 0,
        pointsCost: 200,
        allowedRoles: ['Speaker'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      'prod-exclusive-001': {
        productId: 'prod-exclusive-001',
        name: '活动限定周边',
        description: 'Code 专属商品',
        imageUrl: 'https://example.com/exclusive.png',
        type: 'code_exclusive',
        status: 'active',
        stock: 3,
        redemptionCount: 0,
        eventInfo: '2024 社区年会',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
    redemptions: {},
    pointsRecords: {},
    addresses: {
      'addr-001': {
        addressId: 'addr-001',
        userId: 'user-001',
        recipientName: 'Alice',
        phone: '13800138000',
        detailAddress: '北京市朝阳区某某路1号',
        isDefault: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
    orders: {},
  };
}


// ===========================================================================
// 流程 1: 积分码兑换 → 积分商品兑换 (需求 4.1, 6.1)
// ===========================================================================
describe('E2E: 积分码兑换 → 积分商品兑换', () => {
  let state: MockState;
  let client: ReturnType<typeof createStatefulMockClient>;

  beforeEach(() => {
    state = makeInitialState();
    client = createStatefulMockClient(state);
  });

  it('用户兑换积分码获得积分，然后用积分兑换商品', async () => {
    // Step 1: 用户初始积分为 0
    expect(state.users['user-001'].points).toBe(0);

    // Step 2: 兑换积分码 EARN-500，获得 500 积分
    const earnResult = await redeemCode(
      { code: 'EARN-500', userId: 'user-001' },
      client,
      redeemCodeTables,
    );
    expect(earnResult.success).toBe(true);
    expect(earnResult.earnedPoints).toBe(500);
    expect(state.users['user-001'].points).toBe(500);

    // Step 3: 验证积分记录已生成
    const earnRecords = Object.values(state.pointsRecords).filter(
      (r: any) => r.userId === 'user-001' && r.type === 'earn',
    );
    expect(earnRecords).toHaveLength(1);
    expect((earnRecords[0] as any).amount).toBe(500);
    expect((earnRecords[0] as any).source).toBe('EARN-500');

    // Step 4: 用 200 积分兑换 Speaker 专属礼品
    const redeemResult = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(redeemResult.success).toBe(true);
    expect(redeemResult.redemptionId).toBeDefined();

    // Step 5: 验证积分已扣减
    expect(state.users['user-001'].points).toBe(300); // 500 - 200

    // Step 6: 验证商品库存减少
    expect(state.products['prod-points-001'].stock).toBe(4); // 5 - 1
    expect(state.products['prod-points-001'].redemptionCount).toBe(1);

    // Step 7: 验证兑换记录已生成
    const redemptions = Object.values(state.redemptions);
    expect(redemptions).toHaveLength(1);
    expect((redemptions[0] as any).method).toBe('points');
    expect((redemptions[0] as any).pointsSpent).toBe(200);
    expect((redemptions[0] as any).productName).toBe('Speaker 专属礼品');

    // Step 8: 验证积分扣减记录已生成
    const spendRecords = Object.values(state.pointsRecords).filter(
      (r: any) => r.userId === 'user-001' && r.type === 'spend',
    );
    expect(spendRecords).toHaveLength(1);
    expect((spendRecords[0] as any).amount).toBe(-200);
  });

  it('积分不足时兑换商品应失败，状态不变', async () => {
    // 用户有 0 积分，直接尝试兑换 200 积分商品
    const result = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INSUFFICIENT_POINTS);

    // 积分和库存均不变
    expect(state.users['user-001'].points).toBe(0);
    expect(state.products['prod-points-001'].stock).toBe(5);
    expect(Object.keys(state.redemptions)).toHaveLength(0);
  });

  it('同一积分码不能被同一用户重复使用', async () => {
    // 第一次兑换成功
    const first = await redeemCode(
      { code: 'EARN-500', userId: 'user-001' },
      client,
      redeemCodeTables,
    );
    expect(first.success).toBe(true);

    // 第二次兑换应失败（usedBy 已记录）
    const second = await redeemCode(
      { code: 'EARN-500', userId: 'user-001' },
      client,
      redeemCodeTables,
    );
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe(ErrorCodes.CODE_ALREADY_USED);

    // 积分只增加了一次
    expect(state.users['user-001'].points).toBe(500);
  });
});

// ===========================================================================
// 流程 2: Code 专属商品兑换 (需求 7.1)
// ===========================================================================
describe('E2E: Code 专属商品兑换', () => {
  let state: MockState;
  let client: ReturnType<typeof createStatefulMockClient>;

  beforeEach(() => {
    state = makeInitialState();
    client = createStatefulMockClient(state);
  });

  it('用户使用商品专属码兑换 Code 专属商品，不扣积分', async () => {
    // 先给用户一些积分，确认兑换后积分不变
    state.users['user-001'].points = 1000;

    const result = await redeemWithCode(
      { productId: 'prod-exclusive-001', code: 'EXCLUSIVE-GIFT', userId: 'user-001', addressId: 'addr-001' },
      client,
      codeRedemptionTables,
    );

    expect(result.success).toBe(true);
    expect(result.redemptionId).toBeDefined();

    // 积分不变
    expect(state.users['user-001'].points).toBe(1000);

    // 库存减少
    expect(state.products['prod-exclusive-001'].stock).toBe(2);
    expect(state.products['prod-exclusive-001'].redemptionCount).toBe(1);

    // 兑换记录 method=code，无 pointsSpent
    const redemptions = Object.values(state.redemptions);
    expect(redemptions).toHaveLength(1);
    expect((redemptions[0] as any).method).toBe('code');
    expect((redemptions[0] as any).codeUsed).toBe('EXCLUSIVE-GIFT');
    expect((redemptions[0] as any).pointsSpent).toBeUndefined();

    // 无积分变动记录
    const pointsRecords = Object.values(state.pointsRecords);
    expect(pointsRecords).toHaveLength(0);
  });

  it('用积分购买 Code 专属商品应被拒绝', async () => {
    state.users['user-001'].points = 9999;

    const result = await redeemWithPoints(
      { productId: 'prod-exclusive-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_ONLY_PRODUCT);

    // 积分和库存不变
    expect(state.users['user-001'].points).toBe(9999);
    expect(state.products['prod-exclusive-001'].stock).toBe(3);
  });

  it('Code 与商品不匹配时应被拒绝', async () => {
    // 尝试用绑定 prod-exclusive-001 的 code 兑换另一个商品
    const result = await redeemWithCode(
      { productId: 'prod-points-001', code: 'EXCLUSIVE-GIFT', userId: 'user-001', addressId: 'addr-001' },
      client,
      codeRedemptionTables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_PRODUCT_MISMATCH);
  });

  it('已使用的 Code 不能再次兑换', async () => {
    // maxUses=1，第一次成功
    const first = await redeemWithCode(
      { productId: 'prod-exclusive-001', code: 'EXCLUSIVE-GIFT', userId: 'user-001', addressId: 'addr-001' },
      client,
      codeRedemptionTables,
    );
    expect(first.success).toBe(true);

    // Code 状态变为 exhausted，第二次应失败
    const second = await redeemWithCode(
      { productId: 'prod-exclusive-001', code: 'EXCLUSIVE-GIFT', userId: 'user-002', addressId: 'addr-001' },
      client,
      codeRedemptionTables,
    );
    // Code is now exhausted (status != 'active')
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });
});


// ===========================================================================
// 流程 3: 角色变更后权限变化 (需求 3.4)
// ===========================================================================
describe('E2E: 角色变更后权限即时生效', () => {
  let state: MockState;
  let client: ReturnType<typeof createStatefulMockClient>;

  beforeEach(() => {
    state = makeInitialState();
    client = createStatefulMockClient(state);
    // 给用户足够积分，排除积分不足的干扰
    state.users['user-001'].points = 10000;
  });

  it('用户拥有 Speaker 角色时可兑换 Speaker 限定商品', async () => {
    // user-001 初始角色为 ['Speaker']，商品 allowedRoles 为 ['Speaker']
    const result = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );

    expect(result.success).toBe(true);
  });

  it('撤销 Speaker 角色后无法兑换 Speaker 限定商品', async () => {
    // 撤销 Speaker 角色
    const revokeResult = await revokeRole('user-001', 'Speaker', client, USERS_TABLE);
    expect(revokeResult.success).toBe(true);
    expect(state.users['user-001'].roles).not.toContain('Speaker');

    // 尝试兑换 Speaker 限定商品
    const result = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);

    // 积分和库存不变
    expect(state.users['user-001'].points).toBe(10000);
    expect(state.products['prod-points-001'].stock).toBe(5);
  });

  it('重新分配 Speaker 角色后恢复兑换权限', async () => {
    // 先撤销
    await revokeRole('user-001', 'Speaker', client, USERS_TABLE);
    expect(state.users['user-001'].roles).not.toContain('Speaker');

    // 验证无权限
    const denied = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(denied.success).toBe(false);
    expect(denied.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);

    // 重新分配 Speaker
    const assignResult = await assignRoles('user-001', ['Speaker'], client, USERS_TABLE);
    expect(assignResult.success).toBe(true);
    expect(state.users['user-001'].roles).toContain('Speaker');

    // 现在可以兑换
    const allowed = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(allowed.success).toBe(true);
  });

  it('分配新角色后可兑换对应角色限定商品', async () => {
    // 添加一个 Volunteer 限定商品
    state.products['prod-volunteer-001'] = {
      productId: 'prod-volunteer-001',
      name: 'Volunteer 专属礼品',
      description: '仅限 Volunteer 兑换',
      imageUrl: 'https://example.com/vol.png',
      type: 'points',
      status: 'active',
      stock: 10,
      redemptionCount: 0,
      pointsCost: 100,
      allowedRoles: ['Volunteer'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    // user-001 只有 Speaker 角色，无法兑换 Volunteer 商品
    const denied = await redeemWithPoints(
      { productId: 'prod-volunteer-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(denied.success).toBe(false);
    expect(denied.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);

    // 分配 Volunteer 角色
    await assignRoles('user-001', ['Volunteer'], client, USERS_TABLE);
    expect(state.users['user-001'].roles).toContain('Volunteer');

    // 现在可以兑换
    const allowed = await redeemWithPoints(
      { productId: 'prod-volunteer-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(allowed.success).toBe(true);
    expect(state.products['prod-volunteer-001'].stock).toBe(9);
  });

  it('完整流程：兑换积分 → 分配角色 → 兑换商品 → 撤销角色 → 再次兑换失败', async () => {
    // 重置用户为无角色、无积分
    state.users['user-001'].roles = [];
    state.users['user-001'].points = 0;

    // Step 1: 兑换积分码获得 500 积分
    const earn = await redeemCode(
      { code: 'EARN-500', userId: 'user-001' },
      client,
      redeemCodeTables,
    );
    expect(earn.success).toBe(true);
    expect(state.users['user-001'].points).toBe(500);

    // Step 2: 无角色，无法兑换 Speaker 限定商品
    const noRole = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(noRole.success).toBe(false);
    expect(noRole.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);

    // Step 3: 分配 Speaker 角色
    await assignRoles('user-001', ['Speaker'], client, USERS_TABLE);

    // Step 4: 兑换成功
    const success = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(success.success).toBe(true);
    expect(state.users['user-001'].points).toBe(300); // 500 - 200

    // Step 5: 撤销 Speaker 角色
    await revokeRole('user-001', 'Speaker', client, USERS_TABLE);

    // Step 6: 再次兑换失败
    const denied = await redeemWithPoints(
      { productId: 'prod-points-001', userId: 'user-001', addressId: 'addr-001' },
      client,
      pointsRedemptionTables,
    );
    expect(denied.success).toBe(false);
    expect(denied.error?.code).toBe(ErrorCodes.NO_REDEMPTION_PERMISSION);

    // 积分保持 300（第二次兑换未扣减）
    expect(state.users['user-001'].points).toBe(300);
  });
});
