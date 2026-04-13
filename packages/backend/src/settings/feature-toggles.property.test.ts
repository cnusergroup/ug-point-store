import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getFeatureToggles, updateFeatureToggles } from './feature-toggles';
import { isSuperAdmin, ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { UserRole } from '@points-mall/shared';

// ---- In-memory DynamoDB mock ----

/**
 * Creates a mock DynamoDB client backed by an in-memory store.
 * Supports GetCommand and PutCommand for round-trip / idempotency tests.
 */
function createInMemoryClient() {
  const store = new Map<string, Record<string, unknown>>();

  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;

      if (name === 'GetCommand') {
        const key = command.input.Key.userId as string;
        const item = store.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      if (name === 'PutCommand') {
        const item = command.input.Item;
        store.set(item.userId as string, { ...item });
        return Promise.resolve({});
      }

      if (name === 'UpdateCommand') {
        const key = command.input.Key.userId as string;
        const existing = store.get(key) ?? { userId: key };
        const vals = command.input.ExpressionAttributeValues ?? {};
        const updated = { ...existing };
        // Map expression attribute values to field names
        const fieldMap: Record<string, string> = {
          ':cre': 'codeRedemptionEnabled',
          ':pce': 'pointsClaimEnabled',
          ':ape': 'adminProductsEnabled',
          ':aoe': 'adminOrdersEnabled',
          ':acre': 'adminContentReviewEnabled',
          ':acae': 'adminCategoriesEnabled',
          ':epe': 'emailPointsEarnedEnabled',
          ':eno': 'emailNewOrderEnabled',
          ':eos': 'emailOrderShippedEnabled',
          ':enp': 'emailNewProductEnabled',
          ':enc': 'emailNewContentEnabled',
          ':aepe': 'adminEmailProductsEnabled',
          ':aece': 'adminEmailContentEnabled',
          ':ua': 'updatedAt',
          ':ub': 'updatedBy',
          ':crp': 'contentRolePermissions',
          ':updatedAt': 'updatedAt',
          ':updatedBy': 'updatedBy',
        };
        for (const [placeholder, value] of Object.entries(vals)) {
          const field = fieldMap[placeholder];
          if (field) {
            updated[field] = value;
          }
        }
        store.set(key, updated);
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
    _store: store,
  } as any;
}

/**
 * Creates a mock DynamoDB client that always returns undefined Item (record not found).
 */
function createEmptyClient() {
  return {
    send: vi.fn().mockResolvedValue({ Item: undefined }),
  } as any;
}

const TABLE = 'users-table';

// ============================================================================
// Property 1: 默认值正确性
// Feature: feature-toggle-settings, Property 1: 默认值正确性
// 对于任何不存在 Settings_Record 的数据库状态，调用 getFeatureToggles 应返回
// { codeRedemptionEnabled: false, pointsClaimEnabled: false }
// **Validates: Requirements 1.3, 2.2**
// ============================================================================

describe('Property 1: 默认值正确性', () => {
  it(
    'should always return { codeRedemptionEnabled: false, pointsClaimEnabled: false } when record does not exist',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random arbitrary data to ensure the default is always returned
          fc.record({
            tableName: fc.string({ minLength: 1, maxLength: 50 }),
            randomSeed: fc.integer(),
          }),
          async ({ tableName }) => {
            const client = createEmptyClient();
            const result = await getFeatureToggles(client, tableName);

            expect(result.codeRedemptionEnabled).toBe(false);
            expect(result.pointsClaimEnabled).toBe(false);
            // adminProductsEnabled and adminOrdersEnabled default to true
            expect(result.adminProductsEnabled).toBe(true);
            expect(result.adminOrdersEnabled).toBe(true);
          },
        ),
        {
          numRuns: 100,
          verbose: false,
        },
      );
    },
  );
});

// ============================================================================
// Property 3: 更新输入校验正确性
// Feature: feature-toggle-settings, Property 3: 更新输入校验正确性
// 对于任何请求体，如果 codeRedemptionEnabled 或 pointsClaimEnabled 不是布尔值
// （包括 undefined、null、数字、字符串等），则更新请求应被拒绝并返回 INVALID_REQUEST。
// **Validates: Requirements 3.3, 3.4**
// ============================================================================

/** Arbitrary that generates any non-boolean value */
const nonBooleanArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.float(),
  fc.constant(null),
  fc.constant(undefined),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string()),
  fc.array(fc.integer(), { maxLength: 5 }),
);

describe('Property 3: 更新输入校验正确性', () => {
  it(
    'should reject with INVALID_REQUEST when codeRedemptionEnabled is not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBooleanArb, fc.boolean(), async (invalidValue, validBool) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: invalidValue as any,
              pointsClaimEnabled: validBool,
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
              updatedBy: 'test-user',
            },
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('INVALID_REQUEST');
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should reject with INVALID_REQUEST when pointsClaimEnabled is not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), nonBooleanArb, async (validBool, invalidValue) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: validBool,
              pointsClaimEnabled: invalidValue as any,
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
              updatedBy: 'test-user',
            },
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('INVALID_REQUEST');
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should reject with INVALID_REQUEST when both values are not boolean',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBooleanArb, nonBooleanArb, async (invalidA, invalidB) => {
          const client = createInMemoryClient();
          const result = await updateFeatureToggles(
            {
              codeRedemptionEnabled: invalidA as any,
              pointsClaimEnabled: invalidB as any,
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
              updatedBy: 'test-user',
            },
            client,
            TABLE,
          );

          expect(result.success).toBe(false);
          expect(result.error?.code).toBe('INVALID_REQUEST');
        }),
        { numRuns: 100 },
      );
    },
  );
});

// ============================================================================
// Property 4: 更新幂等性
// Feature: feature-toggle-settings, Property 4: 更新幂等性
// 对于任何有效的功能开关设置值，连续两次使用相同值调用 updateFeatureToggles，
// 第二次调用后读取的设置应与第一次调用后读取的设置在 codeRedemptionEnabled 和
// pointsClaimEnabled 字段上完全一致。
// **Validates: Requirements 3.6**
// ============================================================================

describe('Property 4: 更新幂等性', () => {
  it(
    'calling updateFeatureToggles twice with the same values should produce consistent results',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          async (codeRedemption, pointsClaim, adminProducts, adminOrders) => {
            const client = createInMemoryClient();

            // First update
            const result1 = await updateFeatureToggles(
              {
                codeRedemptionEnabled: codeRedemption,
                pointsClaimEnabled: pointsClaim,
                adminProductsEnabled: adminProducts,
                adminOrdersEnabled: adminOrders,
                adminContentReviewEnabled: false,
                adminCategoriesEnabled: false,
                emailPointsEarnedEnabled: false,
                emailNewOrderEnabled: false,
                emailOrderShippedEnabled: false,
                emailNewProductEnabled: false,
                emailNewContentEnabled: false,
                adminEmailProductsEnabled: false,
                adminEmailContentEnabled: false,
                updatedBy: 'admin-1',
              },
              client,
              TABLE,
            );
            expect(result1.success).toBe(true);

            // Read after first update
            const read1 = await getFeatureToggles(client, TABLE);

            // Second update with same values
            const result2 = await updateFeatureToggles(
              {
                codeRedemptionEnabled: codeRedemption,
                pointsClaimEnabled: pointsClaim,
                adminProductsEnabled: adminProducts,
                adminOrdersEnabled: adminOrders,
                adminContentReviewEnabled: false,
                adminCategoriesEnabled: false,
                emailPointsEarnedEnabled: false,
                emailNewOrderEnabled: false,
                emailOrderShippedEnabled: false,
                emailNewProductEnabled: false,
                emailNewContentEnabled: false,
                adminEmailProductsEnabled: false,
                adminEmailContentEnabled: false,
                updatedBy: 'admin-1',
              },
              client,
              TABLE,
            );
            expect(result2.success).toBe(true);

            // Read after second update
            const read2 = await getFeatureToggles(client, TABLE);

            // Both reads should be identical on the toggle fields
            expect(read2.codeRedemptionEnabled).toBe(read1.codeRedemptionEnabled);
            expect(read2.pointsClaimEnabled).toBe(read1.pointsClaimEnabled);
            expect(read2.adminProductsEnabled).toBe(read1.adminProductsEnabled);
            expect(read2.adminOrdersEnabled).toBe(read1.adminOrdersEnabled);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

// ============================================================================
// Property 6: 读写一致性（Round-trip）
// Feature: feature-toggle-settings, Property 6: 读写一致性
// 对于任何有效的布尔值组合，调用 updateFeatureToggles 写入后，立即调用
// getFeatureToggles 读取，返回的 codeRedemptionEnabled 和 pointsClaimEnabled
// 应与写入值完全一致。
// **Validates: Requirements 1.1, 1.2, 2.1**
// ============================================================================

describe('Property 6: 读写一致性（Round-trip）', () => {
  it(
    'getFeatureToggles should return the same values that were written by updateFeatureToggles',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          async (codeRedemption, pointsClaim, adminProducts, adminOrders) => {
            const client = createInMemoryClient();

            // Write
            const writeResult = await updateFeatureToggles(
              {
                codeRedemptionEnabled: codeRedemption,
                pointsClaimEnabled: pointsClaim,
                adminProductsEnabled: adminProducts,
                adminOrdersEnabled: adminOrders,
                adminContentReviewEnabled: false,
                adminCategoriesEnabled: false,
                emailPointsEarnedEnabled: false,
                emailNewOrderEnabled: false,
                emailOrderShippedEnabled: false,
                emailNewProductEnabled: false,
                emailNewContentEnabled: false,
                adminEmailProductsEnabled: false,
                adminEmailContentEnabled: false,
                updatedBy: 'admin-1',
              },
              client,
              TABLE,
            );
            expect(writeResult.success).toBe(true);

            // Read
            const readResult = await getFeatureToggles(client, TABLE);

            // Round-trip: read values must match written values
            expect(readResult.codeRedemptionEnabled).toBe(codeRedemption);
            expect(readResult.pointsClaimEnabled).toBe(pointsClaim);
            expect(readResult.adminProductsEnabled).toBe(adminProducts);
            expect(readResult.adminOrdersEnabled).toBe(adminOrders);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});


// ============================================================================
// Property 5: 功能开关拦截正确性
// Feature: feature-toggle-settings, Property 5: 功能开关拦截正确性
// 对于任何功能开关状态组合（codeRedemptionEnabled: true/false, pointsClaimEnabled:
// true/false），当 codeRedemptionEnabled 为 false 时 POST /api/points/redeem-code
// 应返回 FEATURE_DISABLED，当 pointsClaimEnabled 为 false 时 POST /api/claims
// 应返回 FEATURE_DISABLED；当对应开关为 true 时，请求应正常通过功能开关检查。
// **Validates: Requirements 4.1, 4.2, 4.3**
// ============================================================================

/**
 * Simulates the interception logic from Points Handler:
 * Check toggle → return FEATURE_DISABLED error or pass through.
 */
function simulateInterception(
  toggles: { codeRedemptionEnabled: boolean; pointsClaimEnabled: boolean },
  route: 'POST /api/points/redeem-code' | 'POST /api/claims',
): { blocked: boolean; errorCode?: string; errorMessage?: string } {
  if (route === 'POST /api/points/redeem-code' && !toggles.codeRedemptionEnabled) {
    return {
      blocked: true,
      errorCode: ErrorCodes.FEATURE_DISABLED,
      errorMessage: ErrorMessages[ErrorCodes.FEATURE_DISABLED],
    };
  }
  if (route === 'POST /api/claims' && !toggles.pointsClaimEnabled) {
    return {
      blocked: true,
      errorCode: ErrorCodes.FEATURE_DISABLED,
      errorMessage: ErrorMessages[ErrorCodes.FEATURE_DISABLED],
    };
  }
  return { blocked: false };
}

describe('Property 5: 功能开关拦截正确性', () => {
  it(
    'POST /api/points/redeem-code should be blocked when codeRedemptionEnabled is false, and pass when true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          async (codeRedemptionEnabled, pointsClaimEnabled) => {
            const client = createInMemoryClient();

            // Write the toggle state
            await updateFeatureToggles(
              {
                codeRedemptionEnabled,
                pointsClaimEnabled,
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
                updatedBy: 'admin',
              },
              client,
              TABLE,
            );

            // Read back the toggles (as the handler would)
            const toggles = await getFeatureToggles(client, TABLE);

            const result = simulateInterception(toggles, 'POST /api/points/redeem-code');

            if (!codeRedemptionEnabled) {
              expect(result.blocked).toBe(true);
              expect(result.errorCode).toBe('FEATURE_DISABLED');
            } else {
              expect(result.blocked).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'POST /api/claims should be blocked when pointsClaimEnabled is false, and pass when true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          async (codeRedemptionEnabled, pointsClaimEnabled) => {
            const client = createInMemoryClient();

            // Write the toggle state
            await updateFeatureToggles(
              {
                codeRedemptionEnabled,
                pointsClaimEnabled,
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
                updatedBy: 'admin',
              },
              client,
              TABLE,
            );

            // Read back the toggles (as the handler would)
            const toggles = await getFeatureToggles(client, TABLE);

            const result = simulateInterception(toggles, 'POST /api/claims');

            if (!pointsClaimEnabled) {
              expect(result.blocked).toBe(true);
              expect(result.errorCode).toBe('FEATURE_DISABLED');
            } else {
              expect(result.blocked).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'each route is only affected by its own toggle, not the other',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.boolean(),
          async (codeRedemptionEnabled, pointsClaimEnabled) => {
            const toggles = { codeRedemptionEnabled, pointsClaimEnabled };

            const redeemResult = simulateInterception(toggles, 'POST /api/points/redeem-code');
            const claimsResult = simulateInterception(toggles, 'POST /api/claims');

            // redeem-code is only affected by codeRedemptionEnabled
            expect(redeemResult.blocked).toBe(!codeRedemptionEnabled);

            // claims is only affected by pointsClaimEnabled
            expect(claimsResult.blocked).toBe(!pointsClaimEnabled);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

// ============================================================================
// Property 2: 更新权限校验正确性
// Feature: feature-toggle-settings, Property 2: 更新权限校验正确性
// 对于任何用户角色集合，如果该集合不包含 SuperAdmin，则更新功能开关请求应被拒绝
// 并返回 FORBIDDEN；如果包含 SuperAdmin，则权限校验应通过。
// **Validates: Requirements 3.1, 3.2**
// ============================================================================

/** All valid roles in the system */
const ALL_VALID_ROLES: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin', 'SuperAdmin'];

/** Arbitrary that generates a random subset of valid roles */
const roleSubsetArb = fc.subarray(ALL_VALID_ROLES, { minLength: 0, maxLength: ALL_VALID_ROLES.length });

describe('Property 2: 更新权限校验正确性', () => {
  it(
    'should reject (FORBIDDEN) when role set does NOT contain SuperAdmin',
    async () => {
      // Generate role sets that explicitly exclude SuperAdmin
      const nonSuperAdminRolesArb = fc.subarray(
        ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin'] as UserRole[],
        { minLength: 0, maxLength: 4 },
      );

      await fc.assert(
        fc.asyncProperty(nonSuperAdminRolesArb, async (roles) => {
          // isSuperAdmin should return false for any set without SuperAdmin
          expect(isSuperAdmin(roles)).toBe(false);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'should pass permission check when role set DOES contain SuperAdmin',
    async () => {
      // Generate role sets that always include SuperAdmin
      const nonSuperAdminRoles: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer', 'Admin'];
      const superAdminRolesArb = fc.subarray(nonSuperAdminRoles, { minLength: 0, maxLength: 4 }).map(
        (subset) => [...subset, 'SuperAdmin'] as UserRole[],
      );

      await fc.assert(
        fc.asyncProperty(superAdminRolesArb, async (roles) => {
          // isSuperAdmin should return true for any set containing SuperAdmin
          expect(isSuperAdmin(roles)).toBe(true);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'for any random role set, isSuperAdmin result matches whether SuperAdmin is in the set',
    async () => {
      await fc.assert(
        fc.asyncProperty(roleSubsetArb, async (roles) => {
          const hasSuperAdmin = roles.includes('SuperAdmin');
          expect(isSuperAdmin(roles)).toBe(hasSuperAdmin);
        }),
        { numRuns: 100 },
      );
    },
  );
});


// ============================================================================
// ---- In-memory DynamoDB mock with UpdateCommand support ----
// Used by content-role-settings properties (Properties 1–4 below)
// ============================================================================

/**
 * Creates an in-memory DynamoDB client that supports GetCommand, PutCommand,
 * and UpdateCommand (simulating SET contentRolePermissions = :crp).
 */
function createInMemoryClientWithUpdate(initialItem?: Record<string, unknown>) {
  const store = new Map<string, Record<string, unknown>>();
  if (initialItem) {
    store.set(initialItem.userId as string, { ...initialItem });
  }

  return {
    send: vi.fn().mockImplementation((command: any) => {
      const name = command.constructor.name;

      if (name === 'GetCommand') {
        const key = command.input.Key.userId as string;
        const item = store.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      if (name === 'PutCommand') {
        const item = command.input.Item;
        store.set(item.userId as string, { ...item });
        return Promise.resolve({});
      }

      if (name === 'UpdateCommand') {
        const key = command.input.Key.userId as string;
        const existing = store.get(key) ?? { userId: key };
        const vals = command.input.ExpressionAttributeValues ?? {};
        const updated = { ...existing };
        // Map expression attribute values to field names
        const fieldMap: Record<string, string> = {
          ':cre': 'codeRedemptionEnabled',
          ':pce': 'pointsClaimEnabled',
          ':ape': 'adminProductsEnabled',
          ':aoe': 'adminOrdersEnabled',
          ':acre': 'adminContentReviewEnabled',
          ':acae': 'adminCategoriesEnabled',
          ':epe': 'emailPointsEarnedEnabled',
          ':eno': 'emailNewOrderEnabled',
          ':eos': 'emailOrderShippedEnabled',
          ':enp': 'emailNewProductEnabled',
          ':enc': 'emailNewContentEnabled',
          ':aepe': 'adminEmailProductsEnabled',
          ':aece': 'adminEmailContentEnabled',
          ':ua': 'updatedAt',
          ':ub': 'updatedBy',
          ':crp': 'contentRolePermissions',
          ':updatedAt': 'updatedAt',
          ':updatedBy': 'updatedBy',
        };
        for (const [placeholder, value] of Object.entries(vals)) {
          const field = fieldMap[placeholder];
          if (field) {
            updated[field] = value;
          }
        }
        store.set(key, updated);
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
    _store: store,
  } as any;
}

// Arbitrary for a valid ContentRolePermissions (12 booleans)
const contentRolePermissionsArb = fc.record({
  Speaker: fc.record({
    canAccess: fc.boolean(),
    canUpload: fc.boolean(),
    canDownload: fc.boolean(),
    canReserve: fc.boolean(),
  }),
  UserGroupLeader: fc.record({
    canAccess: fc.boolean(),
    canUpload: fc.boolean(),
    canDownload: fc.boolean(),
    canReserve: fc.boolean(),
  }),
  Volunteer: fc.record({
    canAccess: fc.boolean(),
    canUpload: fc.boolean(),
    canDownload: fc.boolean(),
    canReserve: fc.boolean(),
  }),
});

// ============================================================================
// Property 1 (content-role-settings): getFeatureToggles 始终返回完整的新字段
// Feature: content-role-settings, Property 1: getFeatureToggles 始终返回完整的新字段
// For any DynamoDB record state (missing, partial, complete), returned object
// always has boolean adminContentReviewEnabled, boolean adminCategoriesEnabled,
// and complete contentRolePermissions with all 12 boolean fields.
// **Validates: Requirements 1.1–1.4, 2.1–2.5, 3.1–3.3**
// ============================================================================

describe('Property 1 (content-role-settings): getFeatureToggles 始终返回完整的新字段', () => {
  it('record not found → all new fields present with correct defaults', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (tableName) => {
          const client = createEmptyClient();
          const result = await getFeatureToggles(client, tableName);

          // adminContentReviewEnabled must be boolean, default false
          expect(typeof result.adminContentReviewEnabled).toBe('boolean');
          expect(result.adminContentReviewEnabled).toBe(false);

          // adminCategoriesEnabled must be boolean, default false
          expect(typeof result.adminCategoriesEnabled).toBe('boolean');
          expect(result.adminCategoriesEnabled).toBe(false);

          // contentRolePermissions must be complete with all 12 boolean fields
          const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
          const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
          for (const role of roles) {
            for (const perm of perms) {
              expect(typeof result.contentRolePermissions[role][perm]).toBe('boolean');
              // default is true
              expect(result.contentRolePermissions[role][perm]).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('partial record (missing contentRolePermissions) → defaults to all-true matrix', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (adminContentReview, adminCategories) => {
          // Record exists but has no contentRolePermissions field
          const client = createInMemoryClientWithUpdate({
            userId: 'feature-toggles',
            codeRedemptionEnabled: false,
            pointsClaimEnabled: false,
            adminProductsEnabled: true,
            adminOrdersEnabled: true,
            adminContentReviewEnabled: adminContentReview,
            adminCategoriesEnabled: adminCategories,
            // intentionally omit contentRolePermissions
          });

          const result = await getFeatureToggles(client, TABLE);

          expect(typeof result.adminContentReviewEnabled).toBe('boolean');
          expect(result.adminContentReviewEnabled).toBe(adminContentReview);

          const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
          const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
          for (const role of roles) {
            for (const perm of perms) {
              expect(typeof result.contentRolePermissions[role][perm]).toBe('boolean');
              expect(result.contentRolePermissions[role][perm]).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('complete record → all 12 fields are booleans', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        contentRolePermissionsArb,
        async (adminContentReview, crp) => {
          const client = createInMemoryClientWithUpdate({
            userId: 'feature-toggles',
            codeRedemptionEnabled: false,
            pointsClaimEnabled: false,
            adminProductsEnabled: true,
            adminOrdersEnabled: true,
            adminContentReviewEnabled: adminContentReview,
            adminCategoriesEnabled: false,
            contentRolePermissions: crp,
          });

          const result = await getFeatureToggles(client, TABLE);

          expect(typeof result.adminContentReviewEnabled).toBe('boolean');

          const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
          const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
          for (const role of roles) {
            for (const perm of perms) {
              expect(typeof result.contentRolePermissions[role][perm]).toBe('boolean');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 2 (content-role-settings): adminContentReviewEnabled 写入读取往返
// Feature: content-role-settings, Property 2: adminContentReviewEnabled 写入读取往返
// For any boolean v, write updateFeatureToggles({ adminContentReviewEnabled: v, ... }),
// then read with getFeatureToggles, the returned adminContentReviewEnabled should equal v.
// **Validates: Requirements 1.4, 4.1, 4.3**
// ============================================================================

describe('Property 2 (content-role-settings): adminContentReviewEnabled 写入读取往返', () => {
  it('adminContentReviewEnabled round-trips correctly for any boolean value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (v, adminCategoriesEnabled) => {
          const client = createInMemoryClientWithUpdate();

          const writeResult = await updateFeatureToggles(
            {
              codeRedemptionEnabled: false,
              pointsClaimEnabled: false,
              adminProductsEnabled: true,
              adminOrdersEnabled: true,
              adminContentReviewEnabled: v,
              adminCategoriesEnabled,
              emailPointsEarnedEnabled: false,
              emailNewOrderEnabled: false,
              emailOrderShippedEnabled: false,
              emailNewProductEnabled: false,
              emailNewContentEnabled: false,
              adminEmailProductsEnabled: false,
              adminEmailContentEnabled: false,
              updatedBy: 'test-user',
            },
            client,
            TABLE,
          );
          expect(writeResult.success).toBe(true);

          const readResult = await getFeatureToggles(client, TABLE);
          expect(readResult.adminContentReviewEnabled).toBe(v);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 3 (content-role-settings): contentRolePermissions 写入读取往返
// Feature: content-role-settings, Property 3: contentRolePermissions 写入读取往返
// For any valid 12-boolean ContentRolePermissions matrix, call
// updateContentRolePermissions, then read with getFeatureToggles, the returned
// contentRolePermissions should equal the written value.
// **Validates: Requirements 2.5, 5.5**
// ============================================================================

import { updateContentRolePermissions } from './feature-toggles';

describe('Property 3 (content-role-settings): contentRolePermissions 写入读取往返', () => {
  it('contentRolePermissions round-trips correctly for any valid 12-boolean matrix', async () => {
    await fc.assert(
      fc.asyncProperty(
        contentRolePermissionsArb,
        async (crp) => {
          const client = createInMemoryClientWithUpdate();

          const writeResult = await updateContentRolePermissions(
            { contentRolePermissions: crp, updatedBy: 'test-user' },
            client,
            TABLE,
          );
          expect(writeResult.success).toBe(true);

          const readResult = await getFeatureToggles(client, TABLE);

          const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
          const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
          for (const role of roles) {
            for (const perm of perms) {
              expect(readResult.contentRolePermissions[role][perm]).toBe(crp[role][perm]);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 4 (content-role-settings): contentRolePermissions 更新幂等性
// Feature: content-role-settings, Property 4: contentRolePermissions 更新幂等性
// For any valid ContentRolePermissions, calling updateContentRolePermissions twice
// with the same input produces the same read result.
// **Validates: Requirements 5.6**
// ============================================================================

describe('Property 4 (content-role-settings): contentRolePermissions 更新幂等性', () => {
  it('two identical updateContentRolePermissions calls produce the same read result', async () => {
    await fc.assert(
      fc.asyncProperty(
        contentRolePermissionsArb,
        async (crp) => {
          const client = createInMemoryClientWithUpdate();

          // First write
          const result1 = await updateContentRolePermissions(
            { contentRolePermissions: crp, updatedBy: 'test-user' },
            client,
            TABLE,
          );
          expect(result1.success).toBe(true);

          const read1 = await getFeatureToggles(client, TABLE);

          // Second write with same input
          const result2 = await updateContentRolePermissions(
            { contentRolePermissions: crp, updatedBy: 'test-user' },
            client,
            TABLE,
          );
          expect(result2.success).toBe(true);

          const read2 = await getFeatureToggles(client, TABLE);

          // Both reads must be identical
          const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
          const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
          for (const role of roles) {
            for (const perm of perms) {
              expect(read2.contentRolePermissions[role][perm]).toBe(
                read1.contentRolePermissions[role][perm],
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
