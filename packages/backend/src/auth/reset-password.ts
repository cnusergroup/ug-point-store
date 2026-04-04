import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { hash } from 'bcryptjs';
import { validatePassword } from './validators';

export interface ResetPasswordResult {
  success: boolean;
  error?: { code: string; message: string };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<ResetPasswordResult> {
  // 1. Scan for user with matching resetToken
  const scanResult = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'resetToken = :token',
      ExpressionAttributeValues: { ':token': token },
      Limit: 1,
    }),
  );

  // 2. If no user found, return RESET_TOKEN_INVALID
  if (!scanResult.Items || scanResult.Items.length === 0) {
    return {
      success: false,
      error: {
        code: ErrorCodes.RESET_TOKEN_INVALID,
        message: ErrorMessages.RESET_TOKEN_INVALID,
      },
    };
  }

  const user = scanResult.Items[0];

  // 3. Check if resetTokenExpiry > Date.now()
  if (!user.resetTokenExpiry || user.resetTokenExpiry <= Date.now()) {
    return {
      success: false,
      error: {
        code: ErrorCodes.RESET_TOKEN_EXPIRED,
        message: ErrorMessages.RESET_TOKEN_EXPIRED,
      },
    };
  }

  // 4. Validate new password format
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

  // 5. Hash new password
  const newHash = await hash(newPassword, 10);

  // 6. Update user: set new passwordHash, reset loginFailCount, remove resetToken/resetTokenExpiry/lockUntil
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId: user.userId },
      UpdateExpression:
        'SET passwordHash = :hash, loginFailCount = :zero, updatedAt = :now REMOVE resetToken, resetTokenExpiry, lockUntil',
      ExpressionAttributeValues: {
        ':hash': newHash,
        ':zero': 0,
        ':now': new Date().toISOString(),
      },
    }),
  );

  // 7. Return success
  return { success: true };
}
