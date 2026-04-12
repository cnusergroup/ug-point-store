import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { TravelSponsorshipSettings } from '@points-mall/shared';

// ---- Interfaces ----

export interface TravelSponsorshipSettingsRecord extends TravelSponsorshipSettings {
  userId: string;
  updatedAt: string;
  updatedBy: string;
}

export interface UpdateTravelSettingsInput {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
  updatedBy: string;
}

export interface UpdateTravelSettingsResult {
  success: boolean;
  settings?: TravelSponsorshipSettingsRecord;
  error?: { code: string; message: string };
}

// ---- Constants ----

const TRAVEL_SETTINGS_KEY = 'travel-sponsorship';

const DEFAULT_SETTINGS: TravelSponsorshipSettings = {
  travelSponsorshipEnabled: false,
  domesticThreshold: 0,
  internationalThreshold: 0,
};

// ---- Validation ----

/**
 * Validate the request body for updating travel sponsorship settings.
 * Requires travelSponsorshipEnabled (boolean), domesticThreshold (positive integer >= 1),
 * and internationalThreshold (positive integer >= 1).
 */
export function validateTravelSettingsInput(
  body: Record<string, unknown> | null,
): { valid: true } | { valid: false; error: { code: string; message: string } } {
  if (!body) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: '请求体不能为空' } };
  }

  if (typeof body.travelSponsorshipEnabled !== 'boolean') {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'travelSponsorshipEnabled 必须为布尔值' } };
  }

  if (
    typeof body.domesticThreshold !== 'number' ||
    !Number.isInteger(body.domesticThreshold) ||
    body.domesticThreshold < 1
  ) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'domesticThreshold 必须为正整数（最小值 1）' } };
  }

  if (
    typeof body.internationalThreshold !== 'number' ||
    !Number.isInteger(body.internationalThreshold) ||
    body.internationalThreshold < 1
  ) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: 'internationalThreshold 必须为正整数（最小值 1）' } };
  }

  return { valid: true };
}

// ---- Core Functions ----

/**
 * Read travel sponsorship settings from DynamoDB.
 * Returns default values when the record does not exist.
 */
export async function getTravelSettings(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<TravelSponsorshipSettings> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: usersTable,
      Key: { userId: TRAVEL_SETTINGS_KEY },
    }),
  );

  if (!result.Item) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    travelSponsorshipEnabled: result.Item.travelSponsorshipEnabled === true,
    domesticThreshold: result.Item.domesticThreshold ?? 0,
    internationalThreshold: result.Item.internationalThreshold ?? 0,
  };
}

/**
 * Update travel sponsorship settings in DynamoDB.
 * Writes to the Users table with userId = "travel-sponsorship".
 */
export async function updateTravelSettings(
  input: UpdateTravelSettingsInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<UpdateTravelSettingsResult> {
  const now = new Date().toISOString();

  const record: TravelSponsorshipSettingsRecord = {
    userId: TRAVEL_SETTINGS_KEY,
    travelSponsorshipEnabled: input.travelSponsorshipEnabled,
    domesticThreshold: input.domesticThreshold,
    internationalThreshold: input.internationalThreshold,
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
    settings: record,
  };
}
