import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { validateNickname } from './nickname-validators';

export interface NicknameHistoryEntry {
  previousNickname: string;
  changedAt: string;
}

export interface ChangeNicknameResult {
  success: boolean;
  error?: { code: string; message: string };
}

const COOLDOWN_MS = 86400000; // 24 hours

export async function changeNickname(
  userId: string,
  newNickname: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  nicknameIndexName: string,
): Promise<ChangeNicknameResult> {
  // Step 1: Validate nickname format
  const validation = validateNickname(newNickname);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  const trimmed = validation.trimmed;

  // Step 2: Fetch current user record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
      ProjectionExpression: 'nickname, nicknameHistory, nicknameChangedAt',
    }),
  );

  // Step 3: User not found
  if (!getResult.Item) {
    return {
      success: false,
      error: {
        code: ErrorCodes.USER_NOT_FOUND,
        message: ErrorMessages[ErrorCodes.USER_NOT_FOUND],
      },
    };
  }

  const currentNickname = getResult.Item.nickname as string;
  const nicknameChangedAt = getResult.Item.nicknameChangedAt as string | undefined;

  // Step 4: Same nickname check
  if (trimmed === currentNickname) {
    return {
      success: false,
      error: {
        code: ErrorCodes.NICKNAME_SAME_AS_CURRENT,
        message: ErrorMessages[ErrorCodes.NICKNAME_SAME_AS_CURRENT],
      },
    };
  }

  // Step 5: Rate limit check (24h cooldown)
  if (nicknameChangedAt) {
    const elapsed = Date.now() - new Date(nicknameChangedAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remainingMs = COOLDOWN_MS - elapsed;
      const remainingHours = Math.ceil(remainingMs / 3600000);
      return {
        success: false,
        error: {
          code: ErrorCodes.NICKNAME_CHANGE_TOO_FREQUENT,
          message: `改名过于频繁，请${remainingHours}小时后再试`,
        },
      };
    }
  }

  // Step 6: Uniqueness check via GSI
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: nicknameIndexName,
      KeyConditionExpression: 'nickname = :newNickname',
      ExpressionAttributeValues: {
        ':newNickname': trimmed,
      },
      ProjectionExpression: 'userId',
      Limit: 1,
    }),
  );

  if (queryResult.Items && queryResult.Items.length > 0) {
    const existingUserId = queryResult.Items[0].userId as string;
    if (existingUserId !== userId) {
      return {
        success: false,
        error: {
          code: ErrorCodes.NICKNAME_ALREADY_TAKEN,
          message: ErrorMessages[ErrorCodes.NICKNAME_ALREADY_TAKEN],
        },
      };
    }
  }

  // Step 7: Update user record
  const now = new Date().toISOString();
  const historyEntry: NicknameHistoryEntry = {
    previousNickname: currentNickname,
    changedAt: now,
  };

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression:
        'SET nickname = :newNick, nicknameChangedAt = :now, updatedAt = :now, nicknameHistory = list_append(if_not_exists(nicknameHistory, :emptyList), :historyEntry)',
      ExpressionAttributeValues: {
        ':newNick': trimmed,
        ':now': now,
        ':emptyList': [],
        ':historyEntry': [historyEntry],
      },
    }),
  );

  return { success: true };
}
