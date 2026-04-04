import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { compare, hash } from 'bcryptjs';
import { validatePassword } from './validators';

export interface ChangePasswordResult {
  success: boolean;
  error?: { code: string; message: string };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ChangePasswordResult> {
  // 1. Fetch user record by userId
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
      ProjectionExpression: 'passwordHash',
    }),
  );

  if (!getResult.Item) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_CURRENT_PASSWORD,
        message: ErrorMessages.INVALID_CURRENT_PASSWORD,
      },
    };
  }

  // 2. Verify current password
  const passwordMatch = await compare(currentPassword, getResult.Item.passwordHash);
  if (!passwordMatch) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_CURRENT_PASSWORD,
        message: ErrorMessages.INVALID_CURRENT_PASSWORD,
      },
    };
  }

  // 3. Validate new password format
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_PASSWORD_FORMAT,
        message: validation.message || ErrorMessages.INVALID_PASSWORD_FORMAT,
      },
    };
  }

  // 4. Hash new password
  const newHash = await hash(newPassword, 10);

  // 5. Update Users table
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId },
      UpdateExpression: 'SET passwordHash = :hash, updatedAt = :now',
      ExpressionAttributeValues: {
        ':hash': newHash,
        ':now': new Date().toISOString(),
      },
    }),
  );

  return { success: true };
}
