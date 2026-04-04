import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface VerifyEmailResult {
  success: boolean;
  error?: { code: string; message: string };
}

export async function verifyEmail(
  token: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<VerifyEmailResult> {
  if (!token) {
    return {
      success: false,
      error: { code: 'INVALID_TOKEN', message: '验证令牌无效' },
    };
  }

  // Look up user by verificationToken (scan since no GSI on this field)
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'verificationToken = :token',
      ExpressionAttributeValues: { ':token': token },
      Limit: 1,
    }),
  );

  if (!scanResult.Items || scanResult.Items.length === 0) {
    return {
      success: false,
      error: { code: 'INVALID_TOKEN', message: '验证令牌无效或已过期' },
    };
  }

  const user = scanResult.Items[0];

  // Set emailVerified=true and remove verificationToken
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId: user.userId },
      UpdateExpression: 'SET emailVerified = :verified, updatedAt = :now REMOVE verificationToken',
      ExpressionAttributeValues: {
        ':verified': true,
        ':now': new Date().toISOString(),
      },
    }),
  );

  return { success: true };
}
