import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { UserProfile } from '@points-mall/shared';

export interface GetUserProfileResult {
  success: boolean;
  profile?: UserProfile;
  error?: { code: string; message: string };
}

/**
 * Get user profile by userId.
 * Returns UserProfile including roles list and points balance.
 */
export async function getUserProfile(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<GetUserProfileResult> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
    }),
  );

  if (!result.Item) {
    return {
      success: false,
      error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
    };
  }

  const item = result.Item;

  // DynamoDB StringSet comes back as a Set; convert to array
  let roles: string[] = [];
  if (item.roles) {
    roles = item.roles instanceof Set ? Array.from(item.roles) : Array.isArray(item.roles) ? item.roles : [];
  }

  const profile: UserProfile = {
    userId: item.userId,
    nickname: item.nickname,
    ...(item.email && { email: item.email }),
    ...(item.wechatOpenId && { wechatOpenId: item.wechatOpenId }),
    roles: roles as UserProfile['roles'],
    points: item.points ?? 0,
    createdAt: item.createdAt,
  };

  return { success: true, profile };
}
