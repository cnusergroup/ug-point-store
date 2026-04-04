import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWechatQrCode, handleWechatCallback, WechatApiFetcher } from './wechat';

// Mock JWT so generateToken works without a real secret
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-jwt-token'),
    verify: vi.fn(),
  },
}));

function createMockDynamoClient(queryItems: any[] = []) {
  const sendFn = vi.fn().mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'QueryCommand') {
      return Promise.resolve({ Items: queryItems });
    }
    if (name === 'PutCommand') {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { send: sendFn } as any;
}

function createMockFetcher(
  tokenResponse: any,
  userInfoResponse: any,
): WechatApiFetcher {
  return {
    getAccessToken: vi.fn().mockResolvedValue(tokenResponse),
    getUserInfo: vi.fn().mockResolvedValue(userInfoResponse),
  };
}

const VALID_TOKEN_RESPONSE = {
  access_token: 'wx-access-token-123',
  openid: 'openid-abc',
};

const VALID_USER_INFO = {
  openid: 'openid-abc',
  nickname: '微信昵称',
};

describe('getWechatQrCode', () => {
  afterEach(() => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_REDIRECT_URI;
  });

  it('should return auth URL when config is present', () => {
    process.env.WECHAT_APP_ID = 'wx-app-id';
    process.env.WECHAT_REDIRECT_URI = 'https://example.com/callback';

    const result = getWechatQrCode();

    expect(result.success).toBe(true);
    expect(result.authUrl).toContain('https://open.weixin.qq.com/connect/qrconnect');
    expect(result.authUrl).toContain('appid=wx-app-id');
    expect(result.authUrl).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    expect(result.authUrl).toContain('scope=snsapi_login');
    expect(result.state).toBeDefined();
    expect(result.state!.length).toBeGreaterThan(0);
  });

  it('should return error when WECHAT_APP_ID is missing', () => {
    process.env.WECHAT_REDIRECT_URI = 'https://example.com/callback';

    const result = getWechatQrCode();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WECHAT_CONFIG_ERROR');
  });

  it('should return error when WECHAT_REDIRECT_URI is missing', () => {
    process.env.WECHAT_APP_ID = 'wx-app-id';

    const result = getWechatQrCode();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WECHAT_CONFIG_ERROR');
  });

  it('should generate unique state tokens on each call', () => {
    process.env.WECHAT_APP_ID = 'wx-app-id';
    process.env.WECHAT_REDIRECT_URI = 'https://example.com/callback';

    const result1 = getWechatQrCode();
    const result2 = getWechatQrCode();

    expect(result1.state).not.toBe(result2.state);
  });
});

describe('handleWechatCallback', () => {
  const tableName = 'Users';

  beforeEach(() => {
    process.env.WECHAT_APP_ID = 'wx-app-id';
    process.env.WECHAT_APP_SECRET = 'wx-app-secret';
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  afterEach(() => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.JWT_SECRET;
  });

  it('should return error when WeChat config is missing', async () => {
    delete process.env.WECHAT_APP_ID;
    const dynamoClient = createMockDynamoClient();
    const fetcher = createMockFetcher(VALID_TOKEN_RESPONSE, VALID_USER_INFO);

    const result = await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WECHAT_CONFIG_ERROR');
  });

  it('should return error when WeChat token exchange fails', async () => {
    const dynamoClient = createMockDynamoClient();
    const fetcher = createMockFetcher(
      { errcode: 40029, errmsg: 'invalid code' },
      VALID_USER_INFO,
    );

    const result = await handleWechatCallback('bad-code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WECHAT_AUTH_FAILED');
    expect(result.error?.message).toBe('invalid code');
  });

  it('should return error when WeChat user info fetch fails', async () => {
    const dynamoClient = createMockDynamoClient();
    const fetcher = createMockFetcher(
      VALID_TOKEN_RESPONSE,
      { errcode: 40003, errmsg: 'invalid openid' },
    );

    const result = await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WECHAT_AUTH_FAILED');
  });

  it('should create new user when wechatOpenId not found', async () => {
    const dynamoClient = createMockDynamoClient([]); // no existing user
    const fetcher = createMockFetcher(VALID_TOKEN_RESPONSE, VALID_USER_INFO);

    const result = await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user!.wechatOpenId).toBe('openid-abc');
    expect(result.user!.nickname).toBe('微信昵称');
    expect(result.user!.roles).toEqual([]);
    expect(result.user!.points).toBe(0);

    // Verify PutCommand was called to create user
    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall).toBeDefined();
    const item = putCall![0].input.Item;
    expect(item.wechatOpenId).toBe('openid-abc');
    expect(item.nickname).toBe('微信昵称');
    expect(item.roles).toEqual([]);
    expect(item.points).toBe(0);
    expect(item.status).toBe('active');
  });

  it('should return existing user when wechatOpenId is found', async () => {
    const existingUser = {
      userId: 'existing-user-id',
      wechatOpenId: 'openid-abc',
      nickname: '已有用户',
      roles: ['Speaker'],
      points: 500,
    };
    const dynamoClient = createMockDynamoClient([existingUser]);
    const fetcher = createMockFetcher(VALID_TOKEN_RESPONSE, VALID_USER_INFO);

    const result = await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.user!.userId).toBe('existing-user-id');
    expect(result.user!.nickname).toBe('已有用户');
    expect(result.user!.roles).toEqual(['Speaker']);
    expect(result.user!.points).toBe(500);

    // Verify no PutCommand was called (user already exists)
    const putCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'PutCommand',
    );
    expect(putCall).toBeUndefined();
  });

  it('should use default nickname when WeChat returns no nickname', async () => {
    const dynamoClient = createMockDynamoClient([]);
    const fetcher = createMockFetcher(
      VALID_TOKEN_RESPONSE,
      { openid: 'openid-abc' }, // no nickname
    );

    const result = await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    expect(result.success).toBe(true);
    expect(result.user!.nickname).toBe('微信用户');
  });

  it('should query wechatOpenId-index GSI', async () => {
    const dynamoClient = createMockDynamoClient([]);
    const fetcher = createMockFetcher(VALID_TOKEN_RESPONSE, VALID_USER_INFO);

    await handleWechatCallback('code', 'state', dynamoClient, tableName, fetcher);

    const queryCall = dynamoClient.send.mock.calls.find(
      (c: any) => c[0].constructor.name === 'QueryCommand',
    );
    expect(queryCall).toBeDefined();
    expect(queryCall![0].input.IndexName).toBe('wechatOpenId-index');
    expect(queryCall![0].input.ExpressionAttributeValues[':openId']).toBe('openid-abc');
  });
});
