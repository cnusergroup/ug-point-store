import Taro from '@tarojs/taro';

/** API 基础 URL，从环境变量读取 */
const BASE_URL = process.env.TARO_APP_API_BASE_URL || '';

/** Token 在本地存储中的 key */
const TOKEN_KEY = 'access_token';

/** 错误响应结构（与后端 ErrorResponse 一致） */
interface ErrorResponse {
  code: string;
  message: string;
}

/** 请求配置 */
interface RequestOptions {
  /** 请求路径（相对于 BASE_URL） */
  url: string;
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** 请求体 */
  data?: Record<string, unknown>;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 是否跳过 Token 注入（用于登录/注册等公开接口） */
  skipAuth?: boolean;
}

/** 自定义请求错误 */
export class RequestError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = 'RequestError';
  }
}

/** 获取本地存储的 Token */
export function getToken(): string | null {
  try {
    return Taro.getStorageSync(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

/** 保存 Token 到本地存储 */
export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token);
}

/** 清除本地存储的 Token */
export function clearToken(): void {
  Taro.removeStorageSync(TOKEN_KEY);
}

/** Token 过期处理：清除 Token、跳转登录页 */
let isHandlingTokenExpiry = false;
function handleTokenExpired(): void {
  if (isHandlingTokenExpiry) return; // prevent duplicate calls
  isHandlingTokenExpiry = true;
  clearToken();
  const env = Taro.getEnv();
  if (env === Taro.ENV_TYPE.WEB) {
    window.location.hash = '#/pages/login/index';
    window.location.reload();
  } else {
    Taro.redirectTo({ url: '/pages/login/index' });
  }
}

/**
 * 统一请求封装
 * - 自动注入 Bearer Token
 * - 统一错误处理（解析 ErrorResponse）
 * - Token 过期自动跳转登录
 */
export async function request<T = unknown>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, headers = {}, skipAuth = false } = options;

  // 注入 Authorization header
  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await Taro.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    const { statusCode, data: responseData } = response;

    // 成功响应
    if (statusCode >= 200 && statusCode < 300) {
      return responseData as T;
    }

    // Token 过期 → 跳转登录
    const errorData = responseData as ErrorResponse;
    if (statusCode === 401 && errorData?.code === 'TOKEN_EXPIRED') {
      handleTokenExpired();
      throw new RequestError('TOKEN_EXPIRED', '登录已过期，请重新登录', 401);
    }

    // 其他业务错误
    if (errorData?.code && errorData?.message) {
      throw new RequestError(errorData.code, errorData.message, statusCode);
    }

    // 未知错误格式
    throw new RequestError('UNKNOWN_ERROR', `请求失败 (${statusCode})`, statusCode);
  } catch (err) {
    // 已经是 RequestError 则直接抛出
    if (err instanceof RequestError) {
      throw err;
    }
    // 网络错误等
    throw new RequestError('NETWORK_ERROR', '网络连接失败，请检查网络设置', 0);
  }
}
