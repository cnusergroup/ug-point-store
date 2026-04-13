import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';

export interface RedeemCodeInput {
  code: string;
  userId: string;
}

export interface RedeemCodeResult {
  success: boolean;
  earnedPoints?: number;
  newBalance?: number;
  error?: { code: string; message: string };
}

export interface RedeemCodeTableNames {
  codesTable: string;
  usersTable: string;
  pointsRecordsTable: string;
}

/**
 * Redeem a points code: validate the code, then atomically update
 * the code usage, user points, and create a points record.
 */
export async function redeemCode(
  input: RedeemCodeInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: RedeemCodeTableNames,
): Promise<RedeemCodeResult> {
  // 1. Query Codes table by codeValue GSI
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tables.codesTable,
      IndexName: 'codeValue-index',
      KeyConditionExpression: 'codeValue = :cv',
      ExpressionAttributeValues: { ':cv': input.code },
    }),
  );

  const codeItem = queryResult.Items?.[0];

  // 2. Validate code exists and is active
  if (!codeItem || codeItem.status !== 'active') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 3. Validate code type is 'points' (not 'product')
  if (codeItem.type !== 'points') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CODE, message: ErrorMessages.INVALID_CODE },
    };
  }

  // 4. Validate usage limit
  if (codeItem.currentUses >= codeItem.maxUses) {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_EXHAUSTED, message: ErrorMessages.CODE_EXHAUSTED },
    };
  }

  // 5. Validate user hasn't already used this code
  const usedByMap: Record<string, string> = codeItem.usedBy ?? {};
  if (usedByMap[input.userId]) {
    return {
      success: false,
      error: { code: ErrorCodes.CODE_ALREADY_USED, message: ErrorMessages.CODE_ALREADY_USED },
    };
  }

  // 6. Get current user points for balanceAfter calculation
  const userResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId: input.userId },
      ProjectionExpression: 'points',
    }),
  );

  const currentPoints = userResult.Item?.points ?? 0;
  const pointsValue = codeItem.pointsValue as number;
  const newBalance = currentPoints + pointsValue;
  const now = new Date().toISOString();
  const recordId = ulid();
  const newUses = codeItem.currentUses + 1;
  const newStatus = newUses >= codeItem.maxUses ? 'exhausted' : 'active';

  // 7. Atomic transaction: update code, update user points, create points record
  await dynamoClient.send(
    new TransactWriteCommand({
      TransactItems: [
        // a. Update Codes table
        {
          Update: {
            TableName: tables.codesTable,
            Key: { codeId: codeItem.codeId },
            UpdateExpression:
              'SET currentUses = currentUses + :one, #s = :newStatus, usedBy.#uid = :ts',
            ConditionExpression: 'currentUses < maxUses AND NOT contains(usedBy, :uid)',
            ExpressionAttributeNames: {
              '#s': 'status',
              '#uid': input.userId,
            },
            ExpressionAttributeValues: {
              ':one': 1,
              ':newStatus': newStatus,
              ':ts': now,
              ':uid': input.userId,
            },
          },
        },
        // b. Update Users table: increment points
        {
          Update: {
            TableName: tables.usersTable,
            Key: { userId: input.userId },
            UpdateExpression: 'SET points = points + :pv, updatedAt = :now',
            ExpressionAttributeValues: {
              ':pv': pointsValue,
              ':now': now,
            },
          },
        },
        // c. Put new PointsRecord
        {
          Put: {
            TableName: tables.pointsRecordsTable,
            Item: {
              recordId,
              userId: input.userId,
              type: 'earn',
              amount: pointsValue,
              source: input.code,
              balanceAfter: newBalance,
              createdAt: now,
            },
          },
        },
      ],
    }),
  );

  return { success: true, earnedPoints: pointsValue, newBalance };
}
