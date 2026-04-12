// Feature toggles module — v2 (adminProductsEnabled, adminOrdersEnabled)
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

// ---- Interfaces ----

export interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can manage products (create/edit/status/images) */
  adminProductsEnabled: boolean;
  /** Whether Admin (non-SuperAdmin) can manage orders and shipping */
  adminOrdersEnabled: boolean;
}

export interface UpdateFeatureTogglesInput {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  adminProductsEnabled: boolean;
  adminOrdersEnabled: boolean;
  updatedBy: string;
}

export interface UpdateFeatureTogglesResult {
  success: boolean;
  settings?: FeatureToggles & { updatedAt: string; updatedBy: string };
  error?: { code: string; message: string };
}

// ---- Constants ----

const FEATURE_TOGGLES_KEY = 'feature-toggles';

const DEFAULT_TOGGLES: FeatureToggles = {
  codeRedemptionEnabled: false,
  pointsClaimEnabled: false,
  adminProductsEnabled: true,   // default: Admin CAN manage products
  adminOrdersEnabled: true,     // default: Admin CAN manage orders
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

    return {
      codeRedemptionEnabled: result.Item.codeRedemptionEnabled === true,
      pointsClaimEnabled: result.Item.pointsClaimEnabled === true,
      adminProductsEnabled: result.Item.adminProductsEnabled !== false, // default true
      adminOrdersEnabled: result.Item.adminOrdersEnabled !== false,     // default true
    };
  } catch {
    // Safe degradation: return defaults when read fails
    return { ...DEFAULT_TOGGLES };
  }
}

/**
 * Update feature toggle settings in DynamoDB.
 * Validates that both toggle values are booleans before writing.
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
    typeof input.adminOrdersEnabled !== 'boolean'
  ) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: '请求参数无效' },
    };
  }

  const now = new Date().toISOString();

  const record = {
    userId: FEATURE_TOGGLES_KEY,
    codeRedemptionEnabled: input.codeRedemptionEnabled,
    pointsClaimEnabled: input.pointsClaimEnabled,
    adminProductsEnabled: input.adminProductsEnabled,
    adminOrdersEnabled: input.adminOrdersEnabled,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: usersTable,
      Item: record,
    }),
  );

  return {
    success: true,
    settings: {
      codeRedemptionEnabled: record.codeRedemptionEnabled,
      pointsClaimEnabled: record.pointsClaimEnabled,
      adminProductsEnabled: record.adminProductsEnabled,
      adminOrdersEnabled: record.adminOrdersEnabled,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    },
  };
}
