import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type {
  TravelCategory,
  CommunityRole,
  TravelApplicationStatus,
  TravelApplication,
  TravelQuota,
  TravelSponsorshipSettings,
} from '@points-mall/shared';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { getTravelSettings } from './settings';

// ---- Interfaces ----

export interface ValidatedTravelApplicationData {
  category: TravelCategory;
  communityRole: CommunityRole;
  eventLink: string;
  cfpScreenshotUrl: string;
  flightCost: number;
  hotelCost: number;
}

export type ValidateResult =
  | { valid: true; data: ValidatedTravelApplicationData }
  | { valid: false; error: { code: string; message: string } };

export interface ListMyTravelApplicationsOptions {
  userId: string;
  status?: TravelApplicationStatus;
  pageSize?: number;
  lastKey?: string;
}

export interface ResubmitTravelApplicationInput {
  applicationId: string;
  userId: string;
  userNickname: string;
  category: TravelCategory;
  communityRole: CommunityRole;
  eventLink: string;
  cfpScreenshotUrl: string;
  flightCost: number;
  hotelCost: number;
}

export interface SubmitTravelApplicationInput {
  userId: string;
  userNickname: string;
  category: TravelCategory;
  communityRole: CommunityRole;
  eventLink: string;
  cfpScreenshotUrl: string;
  flightCost: number;
  hotelCost: number;
}

export interface SubmitTravelApplicationResult {
  success: boolean;
  application?: TravelApplication;
  error?: { code: string; message: string };
}

export interface ListMyTravelApplicationsResult {
  success: boolean;
  applications: TravelApplication[];
  lastKey?: string;
}

export interface ResubmitTravelApplicationResult {
  success: boolean;
  application?: TravelApplication;
  error?: { code: string; message: string };
}

// ---- Constants ----

const VALID_CATEGORIES: TravelCategory[] = ['domestic', 'international'];
const VALID_COMMUNITY_ROLES: CommunityRole[] = ['Hero', 'CommunityBuilder', 'UGL'];

// ---- Pure Functions ----

/**
 * Clamp pageSize to the range [1, 100], defaulting to 20 when not specified.
 */
export function clampPageSize(pageSize?: number): number {
  if (pageSize === undefined || pageSize === null) return 20;
  if (pageSize < 1) return 1;
  if (pageSize > 100) return 100;
  return Math.floor(pageSize);
}

/**
 * Calculate the number of available travel sponsorship applications.
 *
 * - threshold === 0 → 0
 * - threshold > 0 → max(0, floor(earnTotal / threshold) - categoryUsedCount)
 */
export function calculateAvailableCount(
  earnTotal: number,
  threshold: number,
  categoryUsedCount: number,
): number {
  if (threshold === 0) return 0;
  return Math.max(0, Math.floor(earnTotal / threshold) - categoryUsedCount);
}

/**
 * Validate the request body for a travel application (submit or resubmit).
 *
 * Returns `{ valid: true, data }` with extracted fields on success,
 * or `{ valid: false, error }` with code INVALID_REQUEST on failure.
 */
export function validateTravelApplicationInput(
  body: Record<string, unknown> | null,
): ValidateResult {
  if (!body) {
    return { valid: false, error: { code: 'INVALID_REQUEST', message: '请求体不能为空' } };
  }

  // category
  if (!body.category || !VALID_CATEGORIES.includes(body.category as TravelCategory)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'category 必须为 "domestic" 或 "international"' },
    };
  }

  // communityRole
  if (!body.communityRole || !VALID_COMMUNITY_ROLES.includes(body.communityRole as CommunityRole)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'communityRole 必须为 "Hero"、"CommunityBuilder" 或 "UGL"' },
    };
  }

  // eventLink — must be a valid URL
  if (typeof body.eventLink !== 'string' || !isValidUrl(body.eventLink)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'eventLink 必须为合法 URL' },
    };
  }

  // cfpScreenshotUrl — non-empty string
  if (typeof body.cfpScreenshotUrl !== 'string' || body.cfpScreenshotUrl.trim() === '') {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'cfpScreenshotUrl 不能为空' },
    };
  }

  // flightCost — non-negative number
  if (typeof body.flightCost !== 'number' || body.flightCost < 0 || !isFinite(body.flightCost)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'flightCost 必须为非负数' },
    };
  }

  // hotelCost — non-negative number
  if (typeof body.hotelCost !== 'number' || body.hotelCost < 0 || !isFinite(body.hotelCost)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'hotelCost 必须为非负数' },
    };
  }

  return {
    valid: true,
    data: {
      category: body.category as TravelCategory,
      communityRole: body.communityRole as CommunityRole,
      eventLink: body.eventLink as string,
      cfpScreenshotUrl: body.cfpScreenshotUrl as string,
      flightCost: body.flightCost as number,
      hotelCost: body.hotelCost as number,
    },
  };
}

// ---- Async Functions ----

/**
 * Query the user's travel quota.
 *
 * 1. Sum all type="earn" AND targetRole="Speaker" PointsRecords for the user → earnTotal (Speaker-only)
 * 2. Read travel settings → thresholds
 * 3. Count pending+approved applications per category → domesticUsedCount, internationalUsedCount
 * 4. Calculate available counts using independent formula
 * 5. Return TravelQuota
 *
 * Note: earnTotal only includes points earned with the Speaker role.
 * Points earned via other roles (UserGroupLeader, Volunteer, etc.) are excluded.
 */
export async function getTravelQuota(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: { usersTable: string; pointsRecordsTable: string; travelApplicationsTable: string },
): Promise<TravelQuota> {
  // 1. Calculate earnTotal by querying PointsRecords GSI
  const earnTotal = await queryEarnTotal(userId, dynamoClient, tables.pointsRecordsTable);

  // 2. Read travel settings
  const settings: TravelSponsorshipSettings = await getTravelSettings(dynamoClient, tables.usersTable);

  // 3. Count used (pending + approved) applications per category
  let domesticUsedCount = 0;
  let internationalUsedCount = 0;
  let appStartKey: Record<string, any> | undefined;
  do {
    const appResult = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.travelApplicationsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#s IN (:pending, :approved)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':uid': userId,
          ':pending': 'pending',
          ':approved': 'approved',
        },
        ProjectionExpression: 'category',
        ...(appStartKey && { ExclusiveStartKey: appStartKey }),
      }),
    );
    for (const item of appResult.Items ?? []) {
      if (item.category === 'domestic') domesticUsedCount++;
      else if (item.category === 'international') internationalUsedCount++;
    }
    appStartKey = appResult.LastEvaluatedKey;
  } while (appStartKey);

  // 4. Calculate available counts using independent formula
  const domesticAvailable = calculateAvailableCount(earnTotal, settings.domesticThreshold, domesticUsedCount);
  const internationalAvailable = calculateAvailableCount(earnTotal, settings.internationalThreshold, internationalUsedCount);

  return {
    speakerEarnTotal: earnTotal,
    domesticAvailable,
    internationalAvailable,
    domesticThreshold: settings.domesticThreshold,
    internationalThreshold: settings.internationalThreshold,
    domesticUsedCount,
    internationalUsedCount,
  };
}

/**
 * Submit a travel sponsorship application.
 *
 * 1. Verify travelSponsorshipEnabled is true
 * 2. Calculate earnTotal (queryEarnTotal)
 * 3. Get threshold for the requested category
 * 4. Count pending+approved applications for the target category
 * 5. Calculate available count and check sufficiency
 * 6. Create application record with single PutCommand (no TransactWriteCommand, no user record update)
 */
export async function submitTravelApplication(
  input: SubmitTravelApplicationInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { usersTable: string; pointsRecordsTable: string; travelApplicationsTable: string },
): Promise<SubmitTravelApplicationResult> {
  // 1. Verify feature is enabled
  const settings: TravelSponsorshipSettings = await getTravelSettings(dynamoClient, tables.usersTable);
  if (!settings.travelSponsorshipEnabled) {
    return {
      success: false,
      error: { code: ErrorCodes.FEATURE_DISABLED, message: ErrorMessages.FEATURE_DISABLED },
    };
  }

  // 2. Calculate earnTotal
  const earnTotal = await queryEarnTotal(input.userId, dynamoClient, tables.pointsRecordsTable);

  // 3. Get threshold for the requested category
  const threshold = input.category === 'domestic'
    ? settings.domesticThreshold
    : settings.internationalThreshold;

  // 4. Count pending+approved applications for the target category
  let categoryUsedCount = 0;
  let appStartKey: Record<string, any> | undefined;
  do {
    const appResult = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.travelApplicationsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#s IN (:pending, :approved) AND category = :cat',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':uid': input.userId,
          ':pending': 'pending',
          ':approved': 'approved',
          ':cat': input.category,
        },
        ProjectionExpression: 'category',
        ...(appStartKey && { ExclusiveStartKey: appStartKey }),
      }),
    );
    categoryUsedCount += (appResult.Items ?? []).length;
    appStartKey = appResult.LastEvaluatedKey;
  } while (appStartKey);

  // 5. Calculate available count and check sufficiency
  const availableCount = calculateAvailableCount(earnTotal, threshold, categoryUsedCount);
  if (availableCount < 1) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_EARN_QUOTA, message: ErrorMessages.INSUFFICIENT_EARN_QUOTA },
    };
  }

  // 6. Create application record with single PutCommand
  const now = new Date().toISOString();
  const applicationId = ulid();
  const totalCost = input.flightCost + input.hotelCost;

  const application: TravelApplication = {
    applicationId,
    userId: input.userId,
    applicantNickname: input.userNickname,
    category: input.category,
    communityRole: input.communityRole,
    eventLink: input.eventLink,
    cfpScreenshotUrl: input.cfpScreenshotUrl,
    flightCost: input.flightCost,
    hotelCost: input.hotelCost,
    totalCost,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.travelApplicationsTable,
      Item: application,
    }),
  );

  return { success: true, application };
}

/**
 * List the current user's travel applications.
 *
 * Uses GSI `userId-createdAt-index` with ScanIndexForward=false for descending time order.
 * Supports optional status filter and pagination via lastKey cursor.
 */
export async function listMyTravelApplications(
  options: ListMyTravelApplicationsOptions,
  dynamoClient: DynamoDBDocumentClient,
  table: string,
): Promise<ListMyTravelApplicationsResult> {
  const limit = clampPageSize(options.pageSize);

  // Decode pagination cursor
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (options.lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'));
    } catch {
      // Invalid cursor — ignore and start from the beginning
      exclusiveStartKey = undefined;
    }
  }

  const queryInput: Record<string, unknown> = {
    TableName: table,
    IndexName: 'userId-createdAt-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': options.userId } as Record<string, unknown>,
    ScanIndexForward: false,
    Limit: limit,
    ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
  };

  // Optional status filter
  if (options.status) {
    queryInput.FilterExpression = '#s = :status';
    queryInput.ExpressionAttributeNames = { '#s': 'status' };
    (queryInput.ExpressionAttributeValues as Record<string, unknown>)[':status'] = options.status;
  }

  const result = await dynamoClient.send(new QueryCommand(queryInput as any));

  const applications = (result.Items ?? []) as TravelApplication[];

  // Encode pagination cursor
  let lastKey: string | undefined;
  if (result.LastEvaluatedKey) {
    lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return { success: true, applications, lastKey };
}

/**
 * Edit and resubmit a rejected travel application.
 *
 * 1. Read the existing application record by applicationId
 * 2. Verify the application exists (APPLICATION_NOT_FOUND if not)
 * 3. Verify the application belongs to the current user (FORBIDDEN if not)
 * 4. Verify the application status is "rejected" (INVALID_APPLICATION_STATUS if not)
 * 5. Re-validate all input fields
 * 6. Calculate earnTotal (queryEarnTotal)
 * 7. Get travel settings and new threshold
 * 8. Count pending+approved applications for the new category
 * 9. Calculate available count and check sufficiency
 * 10. Create updated application record with single PutCommand
 */
export async function resubmitTravelApplication(
  input: ResubmitTravelApplicationInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { usersTable: string; pointsRecordsTable: string; travelApplicationsTable: string },
): Promise<ResubmitTravelApplicationResult> {
  // 1. Read the existing application record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.travelApplicationsTable,
      Key: { applicationId: input.applicationId },
    }),
  );

  const existingApp = getResult.Item as TravelApplication | undefined;

  // 2. Verify the application exists
  if (!existingApp) {
    return {
      success: false,
      error: { code: ErrorCodes.APPLICATION_NOT_FOUND, message: ErrorMessages.APPLICATION_NOT_FOUND },
    };
  }

  // 3. Verify the application belongs to the current user
  if (existingApp.userId !== input.userId) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: '无权编辑此申请' },
    };
  }

  // 4. Verify the application status is "rejected"
  if (existingApp.status !== 'rejected') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_APPLICATION_STATUS, message: ErrorMessages.INVALID_APPLICATION_STATUS },
    };
  }

  // 5. Re-validate all input fields
  const validation = validateTravelApplicationInput({
    category: input.category,
    communityRole: input.communityRole,
    eventLink: input.eventLink,
    cfpScreenshotUrl: input.cfpScreenshotUrl,
    flightCost: input.flightCost,
    hotelCost: input.hotelCost,
  });
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // 6. Calculate earnTotal
  const earnTotal = await queryEarnTotal(input.userId, dynamoClient, tables.pointsRecordsTable);

  // 7. Get travel settings and new threshold
  const settings = await getTravelSettings(dynamoClient, tables.usersTable);
  const newThreshold = input.category === 'domestic'
    ? settings.domesticThreshold
    : settings.internationalThreshold;

  // 8. Count pending+approved applications for the new category
  // The current rejected application won't be counted since its status is 'rejected'
  let categoryUsedCount = 0;
  let appStartKey: Record<string, any> | undefined;
  do {
    const appResult = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.travelApplicationsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#s IN (:pending, :approved) AND category = :cat',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':uid': input.userId,
          ':pending': 'pending',
          ':approved': 'approved',
          ':cat': input.category,
        },
        ProjectionExpression: 'category',
        ...(appStartKey && { ExclusiveStartKey: appStartKey }),
      }),
    );
    categoryUsedCount += (appResult.Items ?? []).length;
    appStartKey = appResult.LastEvaluatedKey;
  } while (appStartKey);

  // 9. Calculate available count and check sufficiency
  const availableCount = calculateAvailableCount(earnTotal, newThreshold, categoryUsedCount);
  if (availableCount < 1) {
    return {
      success: false,
      error: { code: ErrorCodes.INSUFFICIENT_EARN_QUOTA, message: ErrorMessages.INSUFFICIENT_EARN_QUOTA },
    };
  }

  // 10. Create updated application record with single PutCommand
  const now = new Date().toISOString();
  const totalCost = input.flightCost + input.hotelCost;

  const updatedApplication: TravelApplication = {
    applicationId: input.applicationId,
    userId: input.userId,
    applicantNickname: input.userNickname,
    category: input.category,
    communityRole: input.communityRole,
    eventLink: input.eventLink,
    cfpScreenshotUrl: input.cfpScreenshotUrl,
    flightCost: input.flightCost,
    hotelCost: input.hotelCost,
    totalCost,
    status: 'pending',
    createdAt: existingApp.createdAt,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.travelApplicationsTable,
      Item: updatedApplication,
    }),
  );

  return { success: true, application: updatedApplication };
}

// ---- Helpers ----

/**
 * Check whether a string is a valid URL using the URL constructor.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Query all type="earn" AND targetRole="Speaker" PointsRecords for a user and sum the amount.
 * Uses the `userId-createdAt-index` GSI with a FilterExpression on type and targetRole.
 * Only Speaker role earn records are included; records with other targetRole values
 * (e.g. UserGroupLeader, Volunteer) or missing targetRole are excluded.
 */
async function queryEarnTotal(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
): Promise<number> {
  let total = 0;
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#t = :earn AND #tr = :speaker',
        ExpressionAttributeNames: { '#t': 'type', '#tr': 'targetRole' },
        ExpressionAttributeValues: { ':uid': userId, ':earn': 'earn', ':speaker': 'Speaker' },
        ProjectionExpression: 'amount',
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      total += (item.amount as number) ?? 0;
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return total;
}
