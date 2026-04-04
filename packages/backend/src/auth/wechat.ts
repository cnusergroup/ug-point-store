import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { generateToken } from './token';

export interface WechatQrCodeResult {
  success: boolean;
  authUrl?: string;
  state?: string;
  error?: { code: string; message: string };
}

export interface WechatCallbackResult {
  success: boolean;
  accessToken?: string;
  user?: {
    userId: string;
    nickname: string;
    wechatOpenId: string;
    roles: string[];
    points: number;
  };
  error?: { code: string; message: string };
}

export interface WechatTokenResponse {
  access_token?: string;
  openid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatUserInfoResponse {
  openid?: string;
  nickname?: string;
  errcode?: number;
  errmsg?: string;
}

/** Fetcher interface for WeChat API calls (allows injection for testing) */
export interface WechatApiFetcher {
  getAccessToken(code: string, appId: string, appSecret: string): Promise<WechatTokenResponse>;
  getUserInfo(accessToken: string, openid: string): Promise<WechatUserInfoResponse>;
}

/** Default fetcher using global fetch */
export const defaultWechatFetcher: WechatApiFetcher = {
  async getAccessToken(code, appId, appSecret) {
    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;
    const res = await fetch(url);
    return res.json() as Promise<WechatTokenResponse>;
  },
  async getUserInfo(accessToken, openid) {
    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}`;
    const res = await fetch(url);
    return res.json() as Promise<WechatUserInfoResponse>;
  },
};

export function getWechatQrCode(): WechatQrCodeResult {
  const appId = process.env.WECHAT_APP_ID;
  const redirectUri = process.env.WECHAT_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return {
      success: false,
      error: { code: 'WECHAT_CONFIG_ERROR', message: '微信登录配置缺失' },
    };
  }

  const state = ulid();
  const encodedRedirectUri = encodeURIComponent(redirectUri);
  const authUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${appId}&redirect_uri=${encodedRedirectUri}&response_type=code&scope=snsapi_login&state=${state}`;

  return { success: true, authUrl, state };
}

export async function handleWechatCallback(
  code: string,
  state: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  fetcher: WechatApiFetcher = defaultWechatFetcher,
): Promise<WechatCallbackResult> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      success: false,
      error: { code: 'WECHAT_CONFIG_ERROR', message: '微信登录配置缺失' },
    };
  }

  // 1. Exchange code for access_token
  const tokenRes = await fetcher.getAccessToken(code, appId, appSecret);

  if (tokenRes.errcode || !tokenRes.access_token || !tokenRes.openid) {
    return {
      success: false,
      error: { code: 'WECHAT_AUTH_FAILED', message: tokenRes.errmsg ?? '微信授权失败，请稍后重试' },
    };
  }

  // 2. Get user info from WeChat
  const userInfoRes = await fetcher.getUserInfo(tokenRes.access_token, tokenRes.openid);

  if (userInfoRes.errcode || !userInfoRes.openid) {
    return {
      success: false,
      error: { code: 'WECHAT_AUTH_FAILED', message: userInfoRes.errmsg ?? '获取微信用户信息失败' },
    };
  }

  const wechatOpenId = userInfoRes.openid;
  const wechatNickname = userInfoRes.nickname ?? '微信用户';

  // 3. Check if user exists by wechatOpenId
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'wechatOpenId-index',
      KeyConditionExpression: 'wechatOpenId = :openId',
      ExpressionAttributeValues: { ':openId': wechatOpenId },
      Limit: 1,
    }),
  );

  let user: Record<string, any>;

  if (queryResult.Items && queryResult.Items.length > 0) {
    // Existing user — use their profile
    user = queryResult.Items[0];
  } else {
    // New user — create account
    const userId = ulid();
    const now = new Date().toISOString();
    user = {
      userId,
      wechatOpenId,
      nickname: wechatNickname,
      roles: [],
      points: 0,
      emailVerified: false,
      loginFailCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await dynamoClient.send(
      new PutCommand({
        TableName: tableName,
        Item: user,
      }),
    );
  }

  // 4. Generate JWT token
  const accessToken = await generateToken({
    userId: user.userId,
    roles: user.roles || [],
  });

  return {
    success: true,
    accessToken,
    user: {
      userId: user.userId,
      nickname: user.nickname,
      wechatOpenId: user.wechatOpenId,
      roles: user.roles || [],
      points: user.points || 0,
    },
  };
}
