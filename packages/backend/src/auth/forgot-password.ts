import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ulid } from 'ulid';

const RESET_TOKEN_TTL_MS = 3600000; // 1 hour

export interface ForgotPasswordResult {
  success: boolean;
  error?: { code: string; message: string };
}

export async function forgotPassword(
  email: string,
  dynamoClient: DynamoDBDocumentClient,
  sesClient: SESClient,
  tableName: string,
  senderEmail: string,
  resetBaseUrl: string,
): Promise<ForgotPasswordResult> {
  // 1. Query user by email GSI
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }),
  );

  // 2. If user not found, return success (anti-enumeration)
  if (!queryResult.Items || queryResult.Items.length === 0) {
    return { success: true };
  }

  const user = queryResult.Items[0];

  // 3. Generate ULID as resetToken
  const resetToken = ulid();

  // 4. Set resetTokenExpiry = now + 1 hour
  const resetTokenExpiry = Date.now() + RESET_TOKEN_TTL_MS;

  // 5. Update user record with resetToken and resetTokenExpiry
  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId: user.userId },
      UpdateExpression: 'SET resetToken = :token, resetTokenExpiry = :expiry, updatedAt = :now',
      ExpressionAttributeValues: {
        ':token': resetToken,
        ':expiry': resetTokenExpiry,
        ':now': new Date().toISOString(),
      },
    }),
  );

  // 6. Send reset email via SES (failure still returns success for anti-enumeration)
  try {
    const resetLink = `${resetBaseUrl}?token=${resetToken}`;
    await sesClient.send(
      new SendEmailCommand({
        Source: senderEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: '积分商城 - 密码重置' },
          Body: {
            Html: {
              Data: `<p>您好，</p><p>您请求了密码重置。请点击以下链接设置新密码：</p><p><a href="${resetLink}">${resetLink}</a></p><p>此链接有效期为 1 小时。如果您没有请求密码重置，请忽略此邮件。</p>`,
            },
          },
        },
      }),
    );
  } catch {
    // SES failure: still return success (anti-enumeration)
  }

  // 7. Return success
  return { success: true };
}
