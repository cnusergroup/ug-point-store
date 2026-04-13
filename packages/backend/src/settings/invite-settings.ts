import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

// ---- Interfaces ----

export interface InviteSettings {
  inviteExpiryDays: 1 | 3 | 7;
}

// ---- Constants ----

export const INVITE_SETTINGS_KEY = 'invite-settings';
export const ALLOWED_EXPIRY_DAYS = [1, 3, 7] as const;
export const DEFAULT_EXPIRY_DAYS = 1;

// ---- Core Functions ----

/**
 * Read invite expiry settings from DynamoDB.
 * Returns default { inviteExpiryDays: 1 } when the record does not exist.
 */
export async function getInviteSettings(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<InviteSettings> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: usersTable,
      Key: { userId: INVITE_SETTINGS_KEY },
    }),
  );

  if (!result.Item) {
    return { inviteExpiryDays: DEFAULT_EXPIRY_DAYS };
  }

  return { inviteExpiryDays: result.Item.inviteExpiryDays as 1 | 3 | 7 };
}

/**
 * Update invite expiry settings in DynamoDB.
 * Validates that inviteExpiryDays is one of the allowed values {1, 3, 7}.
 */
export async function updateInviteSettings(
  inviteExpiryDays: number,
  updatedBy: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  if (!(ALLOWED_EXPIRY_DAYS as readonly number[]).includes(inviteExpiryDays)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_EXPIRY_VALUE, message: ErrorMessages.INVALID_EXPIRY_VALUE },
    };
  }

  const updatedAt = new Date().toISOString();

  await dynamoClient.send(
    new PutCommand({
      TableName: usersTable,
      Item: {
        userId: INVITE_SETTINGS_KEY,
        inviteExpiryDays,
        updatedAt,
        updatedBy,
      },
    }),
  );

  return { success: true };
}
