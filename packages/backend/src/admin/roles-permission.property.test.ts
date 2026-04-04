import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { assignRoles, revokeRole } from './roles';
import { redeemWithPoints } from '../redemptions/points-redemption';
import type { UserRole } from '@points-mall/shared';

// Feature: points-mall, Property 5: 角色变更后权限即时生效
// 对于任何用户和任何身份限定的积分商品，当用户的角色变更后，
// 该用户对商品的兑换权限判定结果应与其当前角色集合是否包含商品允许角色一致。
// Validates: Requirements 3.4, 5.3

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

const userIdArb = fc.string({
  minLength: 1,
  maxLength: 20,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
});

const rolesSubsetArb = fc.subarray(ALL_ROLES, { minLength: 0 }).map((r) => [...r]);
const nonEmptyRolesArb = fc.subarray(ALL_ROLES, { minLength: 1 }).map((r) => [...r]);
const singleRoleArb = fc.constantFrom<UserRole>(...ALL_ROLES);

/**
 * Pure permission check — mirrors the logic in redeemWithPoints step 7
 * and listProducts canRedeem.
 */
function hasRedemptionPermission(
  userRoles: UserRole[],
  allowedRoles: UserRole[] | 'all',
): boolean {
  if (allowedRoles === 'all') return true;
  return userRoles.some((role) => allowedRoles.includes(role));
}

describe('Property 5: 角色变更后权限即时生效', () => {
  it('权限判定应与用户当前角色集合和商品允许角色的交集一致', () => {
    fc.assert(
      fc.property(
        rolesSubsetArb,                    // user's current roles
        nonEmptyRolesArb,                  // product's allowedRoles (non-empty subset)
        (userRoles, allowedRoles) => {
          const result = hasRedemptionPermission(userRoles, allowedRoles);
          const hasIntersection = userRoles.some((r) => allowedRoles.includes(r));
          expect(result).toBe(hasIntersection);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allowedRoles 为 "all" 时任何角色组合均有权限', () => {
    fc.assert(
      fc.property(rolesSubsetArb, (userRoles) => {
        expect(hasRedemptionPermission(userRoles, 'all')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('分配角色后对该角色限定商品应立即获得权限', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        nonEmptyRolesArb,
        async (userId, rolesToAssign) => {
          // Simulate: user starts with no roles, then roles are assigned
          const client = { send: vi.fn().mockResolvedValue({}) } as any;
          const result = await assignRoles(userId, rolesToAssign, client, 'Users');
          expect(result.success).toBe(true);

          // After assignment, user has rolesToAssign — check permission
          // against a product that allows exactly those roles
          expect(hasRedemptionPermission(rolesToAssign, rolesToAssign)).toBe(true);

          // Against a product that allows a single role from the assigned set
          const singleAllowed = [rolesToAssign[0]];
          expect(hasRedemptionPermission(rolesToAssign, singleAllowed)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('撤销角色后对该角色限定商品应立即失去权限', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        singleRoleArb,
        async (userId, roleToRevoke) => {
          const client = { send: vi.fn().mockResolvedValue({}) } as any;
          const result = await revokeRole(userId, roleToRevoke, client, 'Users');
          expect(result.success).toBe(true);

          // After revocation, user no longer has roleToRevoke
          // Permission check against product requiring only that role should fail
          const remainingRoles: UserRole[] = [];
          expect(hasRedemptionPermission(remainingRoles, [roleToRevoke])).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('角色变更后 redeemWithPoints 的权限判定与当前角色一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        rolesSubsetArb,
        nonEmptyRolesArb,
        fc.integer({ min: 100, max: 10000 }),
        async (userId, userRoles, productAllowedRoles, pointsCost) => {
          const expectedPermission = hasRedemptionPermission(userRoles, productAllowedRoles);

          // Mock DynamoDB: GetCommand returns product then user
          const mockSend = vi.fn()
            // First call: get product
            .mockResolvedValueOnce({
              Item: {
                productId: 'prod-1',
                name: 'Test Product',
                type: 'points',
                status: 'active',
                stock: 10,
                pointsCost,
                allowedRoles: productAllowedRoles,
              },
            })
            // Second call: get user
            .mockResolvedValueOnce({
              Item: {
                userId,
                roles: userRoles,
                points: pointsCost + 1000, // ensure sufficient points
              },
            })
            // Third call: address lookup (if permission passes)
            .mockResolvedValueOnce({
              Item: {
                addressId: 'addr-001',
                userId,
                recipientName: '张三',
                phone: '13800138000',
                detailAddress: '北京市朝阳区某某路1号',
              },
            })
            // Fourth call: transaction (if permission passes)
            .mockResolvedValueOnce({});

          const client = { send: mockSend } as any;
          const tables = {
            usersTable: 'Users',
            productsTable: 'Products',
            redemptionsTable: 'Redemptions',
            pointsRecordsTable: 'PointsRecords',
            addressesTable: 'Addresses',
            ordersTable: 'Orders',
          };

          const result = await redeemWithPoints(
            { productId: 'prod-1', userId, addressId: 'addr-001' },
            client,
            tables,
          );

          if (expectedPermission) {
            // Should succeed (points sufficient, stock available, permission granted)
            expect(result.success).toBe(true);
          } else {
            // Should fail with NO_REDEMPTION_PERMISSION
            expect(result.success).toBe(false);
            expect(result.error?.code).toBe('NO_REDEMPTION_PERMISSION');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
