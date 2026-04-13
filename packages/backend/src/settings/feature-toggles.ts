// Feature toggles module — v3 (adminContentReviewEnabled, adminCategoriesEnabled, contentRolePermissions)
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

// ---- Interfaces ----

export interface RolePermissions {
  canAccess: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canReserve: boolean;
}

export interface ContentRolePermissions {
  Speaker: RolePermissions;
  UserGroupLeader: RolePermissions;
  Volunteer: RolePermissions;
}

export interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can manage products (create/edit/status/images) */
  adminProductsEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can manage orders and shipping */
  adminOrdersEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can review content (approve/reject) */
  adminContentReviewEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can manage content categories */
  adminCategoriesEnabled: boolean;
  /** Per-role content permissions matrix for Speaker, UserGroupLeader, Volunteer */
  contentRolePermissions: ContentRolePermissions;
  /** Whether pointsEarned email notifications are enabled */
  emailPointsEarnedEnabled: boolean;
  /** Whether newOrder email notifications are enabled */
  emailNewOrderEnabled: boolean;
  /** Whether orderShipped email notifications are enabled */
  emailOrderShippedEnabled: boolean;
  /** Whether newProduct email notifications are enabled */
  emailNewProductEnabled: boolean;
  /** Whether newContent email notifications are enabled */
  emailNewContentEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can trigger new product email notifications */
  adminEmailProductsEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can trigger new content email notifications */
  adminEmailContentEnabled: boolean;
}

export interface UpdateFeatureTogglesInput {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  adminProductsEnabled: boolean;
  adminOrdersEnabled: boolean;
  adminContentReviewEnabled: boolean;
  adminCategoriesEnabled: boolean;
  emailPointsEarnedEnabled: boolean;
  emailNewOrderEnabled: boolean;
  emailOrderShippedEnabled: boolean;
  emailNewProductEnabled: boolean;
  emailNewContentEnabled: boolean;
  adminEmailProductsEnabled: boolean;
  adminEmailContentEnabled: boolean;
  updatedBy: string;
}

export interface UpdateFeatureTogglesResult {
  success: boolean;
  settings?: FeatureToggles & { updatedAt: string; updatedBy: string };
  error?: { code: string; message: string };
}

export interface UpdateContentRolePermissionsInput {
  contentRolePermissions: ContentRolePermissions;
  updatedBy: string;
}

export interface UpdateContentRolePermissionsResult {
  success: boolean;
  contentRolePermissions?: ContentRolePermissions;
  error?: { code: string; message: string };
}

// ---- Constants ----

const FEATURE_TOGGLES_KEY = 'feature-toggles';

const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  canAccess: true,
  canUpload: true,
  canDownload: true,
  canReserve: true,
};

const DEFAULT_VOLUNTEER_PERMISSIONS: RolePermissions = {
  canAccess: true,
  canUpload: false,
  canDownload: false,
  canReserve: false,
};

const DEFAULT_CONTENT_ROLE_PERMISSIONS: ContentRolePermissions = {
  Speaker: { ...DEFAULT_ROLE_PERMISSIONS },
  UserGroupLeader: { ...DEFAULT_ROLE_PERMISSIONS },
  Volunteer: { ...DEFAULT_VOLUNTEER_PERMISSIONS },
};

const DEFAULT_TOGGLES: FeatureToggles = {
  codeRedemptionEnabled: false,
  pointsClaimEnabled: false,
  adminProductsEnabled: true,            // default: Admin CAN manage products
  adminOrdersEnabled: true,              // default: Admin CAN manage orders
  adminContentReviewEnabled: false,      // default: only SuperAdmin can review content
  adminCategoriesEnabled: false,         // default: only SuperAdmin can manage categories
  contentRolePermissions: {
    Speaker: { ...DEFAULT_ROLE_PERMISSIONS },
    UserGroupLeader: { ...DEFAULT_ROLE_PERMISSIONS },
    Volunteer: { ...DEFAULT_ROLE_PERMISSIONS },
  },
  emailPointsEarnedEnabled: false,       // default: email notifications disabled
  emailNewOrderEnabled: false,
  emailOrderShippedEnabled: false,
  emailNewProductEnabled: false,
  emailNewContentEnabled: false,
  adminEmailProductsEnabled: false,          // default: Admin cannot trigger product email notifications
  adminEmailContentEnabled: false,           // default: Admin cannot trigger content email notifications
};

// ---- Core Functions ----

/**
 * Read feature toggle settings from DynamoDB.
 * Returns default values (both false) when the record does not exist or read fails.
 */
export async function getFeatureToggles(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<FeatureToggles> {
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userId: FEATURE_TOGGLES_KEY },
      }),
    );

    if (!result.Item) {
      return { ...DEFAULT_TOGGLES };
    }

    // Safe-default helper for per-role permissions: missing field → true
    const safeRolePerms = (raw: unknown): RolePermissions => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return {
        canAccess:   r.canAccess   !== false,
        canUpload:   r.canUpload   !== false,
        canDownload: r.canDownload !== false,
        canReserve:  r.canReserve  !== false,
      };
    };

    const rawCrp = result.Item.contentRolePermissions as Record<string, unknown> | undefined;

    return {
      codeRedemptionEnabled:    result.Item.codeRedemptionEnabled === true,
      pointsClaimEnabled:       result.Item.pointsClaimEnabled === true,
      adminProductsEnabled:     result.Item.adminProductsEnabled !== false,      // default true
      adminOrdersEnabled:       result.Item.adminOrdersEnabled !== false,        // default true
      adminContentReviewEnabled: result.Item.adminContentReviewEnabled === true, // default false
      adminCategoriesEnabled:   result.Item.adminCategoriesEnabled === true,     // default false
      contentRolePermissions: {
        Speaker:          safeRolePerms(rawCrp?.Speaker),
        UserGroupLeader:  safeRolePerms(rawCrp?.UserGroupLeader),
        Volunteer:        safeRolePerms(rawCrp?.Volunteer),
      },
      emailPointsEarnedEnabled: result.Item.emailPointsEarnedEnabled === true,   // default false
      emailNewOrderEnabled:     result.Item.emailNewOrderEnabled === true,        // default false
      emailOrderShippedEnabled: result.Item.emailOrderShippedEnabled === true,    // default false
      emailNewProductEnabled:   result.Item.emailNewProductEnabled === true,      // default false
      emailNewContentEnabled:   result.Item.emailNewContentEnabled === true,      // default false
      adminEmailProductsEnabled: result.Item.adminEmailProductsEnabled === true,  // default false
      adminEmailContentEnabled:  result.Item.adminEmailContentEnabled === true,   // default false
    };
  } catch {
    // Safe degradation: return defaults when read fails
    return { ...DEFAULT_TOGGLES };
  }
}

/**
 * Update feature toggle settings in DynamoDB.
 * Validates that all toggle values are booleans before writing.
 * Uses UpdateCommand to only update toggle fields, preserving contentRolePermissions untouched.
 */
export async function updateFeatureToggles(
  input: UpdateFeatureTogglesInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<UpdateFeatureTogglesResult> {
  // Validate boolean types
  if (
    typeof input.codeRedemptionEnabled !== 'boolean' ||
    typeof input.pointsClaimEnabled !== 'boolean' ||
    typeof input.adminProductsEnabled !== 'boolean' ||
    typeof input.adminOrdersEnabled !== 'boolean' ||
    typeof input.adminContentReviewEnabled !== 'boolean' ||
    typeof input.adminCategoriesEnabled !== 'boolean' ||
    typeof input.emailPointsEarnedEnabled !== 'boolean' ||
    typeof input.emailNewOrderEnabled !== 'boolean' ||
    typeof input.emailOrderShippedEnabled !== 'boolean' ||
    typeof input.emailNewProductEnabled !== 'boolean' ||
    typeof input.emailNewContentEnabled !== 'boolean' ||
    typeof input.adminEmailProductsEnabled !== 'boolean' ||
    typeof input.adminEmailContentEnabled !== 'boolean'
  ) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: '请求参数无效' },
    };
  }

  const now = new Date().toISOString();

  // Use UpdateCommand to only update toggle fields — never touches contentRolePermissions
  await dynamoClient.send(
    new UpdateCommand({
      TableName: usersTable,
      Key: { userId: FEATURE_TOGGLES_KEY },
      UpdateExpression: `SET
        codeRedemptionEnabled = :cre,
        pointsClaimEnabled = :pce,
        adminProductsEnabled = :ape,
        adminOrdersEnabled = :aoe,
        adminContentReviewEnabled = :acre,
        adminCategoriesEnabled = :acae,
        emailPointsEarnedEnabled = :epe,
        emailNewOrderEnabled = :eno,
        emailOrderShippedEnabled = :eos,
        emailNewProductEnabled = :enp,
        emailNewContentEnabled = :enc,
        adminEmailProductsEnabled = :aepe,
        adminEmailContentEnabled = :aece,
        updatedAt = :ua,
        updatedBy = :ub`,
      ExpressionAttributeValues: {
        ':cre': input.codeRedemptionEnabled,
        ':pce': input.pointsClaimEnabled,
        ':ape': input.adminProductsEnabled,
        ':aoe': input.adminOrdersEnabled,
        ':acre': input.adminContentReviewEnabled,
        ':acae': input.adminCategoriesEnabled,
        ':epe': input.emailPointsEarnedEnabled,
        ':eno': input.emailNewOrderEnabled,
        ':eos': input.emailOrderShippedEnabled,
        ':enp': input.emailNewProductEnabled,
        ':enc': input.emailNewContentEnabled,
        ':aepe': input.adminEmailProductsEnabled,
        ':aece': input.adminEmailContentEnabled,
        ':ua': now,
        ':ub': input.updatedBy,
      },
    }),
  );

  // Read back the full record to return complete settings
  const readResult = await dynamoClient.send(
    new GetCommand({ TableName: usersTable, Key: { userId: FEATURE_TOGGLES_KEY } }),
  );

  const item = readResult.Item ?? {};

  const safeRolePerms = (raw: unknown): RolePermissions => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      canAccess:   r.canAccess   !== false,
      canUpload:   r.canUpload   !== false,
      canDownload: r.canDownload !== false,
      canReserve:  r.canReserve  !== false,
    };
  };

  const rawCrp = item.contentRolePermissions as Record<string, unknown> | undefined;

  return {
    success: true,
    settings: {
      codeRedemptionEnabled: input.codeRedemptionEnabled,
      pointsClaimEnabled: input.pointsClaimEnabled,
      adminProductsEnabled: input.adminProductsEnabled,
      adminOrdersEnabled: input.adminOrdersEnabled,
      adminContentReviewEnabled: input.adminContentReviewEnabled,
      adminCategoriesEnabled: input.adminCategoriesEnabled,
      contentRolePermissions: {
        Speaker:          safeRolePerms(rawCrp?.Speaker),
        UserGroupLeader:  safeRolePerms(rawCrp?.UserGroupLeader),
        Volunteer:        safeRolePerms(rawCrp?.Volunteer),
      },
      emailPointsEarnedEnabled: input.emailPointsEarnedEnabled,
      emailNewOrderEnabled: input.emailNewOrderEnabled,
      emailOrderShippedEnabled: input.emailOrderShippedEnabled,
      emailNewProductEnabled: input.emailNewProductEnabled,
      emailNewContentEnabled: input.emailNewContentEnabled,
      adminEmailProductsEnabled: input.adminEmailProductsEnabled,
      adminEmailContentEnabled: input.adminEmailContentEnabled,
      updatedAt: now,
      updatedBy: input.updatedBy,
    },
  };
}

/**
 * Update only the contentRolePermissions field in DynamoDB using UpdateCommand,
 * leaving all other feature-toggle fields untouched.
 */
export async function updateContentRolePermissions(
  input: UpdateContentRolePermissionsInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<UpdateContentRolePermissionsResult> {
  const { contentRolePermissions, updatedBy } = input;

  // Validate all 12 permission fields are booleans
  const roles = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
  const perms = ['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const;
  for (const role of roles) {
    for (const perm of perms) {
      if (typeof contentRolePermissions[role]?.[perm] !== 'boolean') {
        return {
          success: false,
          error: { code: 'INVALID_REQUEST', message: '请求参数无效' },
        };
      }
    }
  }

  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateCommand({
      TableName: usersTable,
      Key: { userId: FEATURE_TOGGLES_KEY },
      UpdateExpression:
        'SET contentRolePermissions = :crp, updatedAt = :updatedAt, updatedBy = :updatedBy',
      ExpressionAttributeValues: {
        ':crp': contentRolePermissions,
        ':updatedAt': now,
        ':updatedBy': updatedBy,
      },
    }),
  );

  return {
    success: true,
    contentRolePermissions,
  };
}
