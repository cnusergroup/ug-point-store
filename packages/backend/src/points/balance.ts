import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export interface GetPointsBalanceResult {
  success: boolean;
  points?: number;
  error?: { code: string; message: string };
}

/**
 * Get user's current points balance from Users table.
 */
export async function getPointsBalance(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<GetPointsBalanceResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: usersTable,
      Key: { userId },
      ProjectionExpression: 'points',
    }),
  );

  if (!result.Item) {
    return {
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
    };
  }

  return { success: true, points: result.Item.points ?? 0 };
}
