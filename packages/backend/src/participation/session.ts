import jwt from 'jsonwebtoken';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

/**
 * Query_Session JWT payload（会话签发时嵌入的业务字段）。
 * 不含 `userId`/`roles`，与商城 Auth token 结构不同，两者互不兼容。
 */
export interface QuerySessionPayload {
  /** 签发时刻的查询凭证密码版本号，用于会话吊销判定 */
  credentialVersion: number;
}

const QUERY_SESSION_EXPIRY = '24h'; // 24 小时有效期，Requirement 3.2

// Cache the secret after first SSM fetch (Lambda cold start)，与 auth/token.ts 模式一致，
// 但使用独立的模块级变量与独立的 SSM 参数，避免与商城 Auth JWT 密钥混用。
let cachedQuerySecret: string | null = null;

async function fetchQueryJwtSecretFromSsm(): Promise<string> {
  const paramName = process.env.QUERY_JWT_SECRET_PARAM;
  if (!paramName) {
    throw new Error('QUERY_JWT_SECRET_PARAM environment variable is not set');
  }
  const client = new SSMClient({});
  const result = await client.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  if (!result.Parameter?.Value) {
    throw new Error(`SSM parameter ${paramName} has no value`);
  }
  return result.Parameter.Value;
}

/**
 * 获取查询会话 JWT 密钥。首次调用从 SSM 读取，随后缓存。
 * 本地开发/测试时可通过 QUERY_JWT_SECRET 环境变量直接提供，跳过 SSM 调用。
 */
async function getQueryJwtSecret(): Promise<string> {
  if (cachedQuerySecret) return cachedQuerySecret;

  if (process.env.QUERY_JWT_SECRET) {
    cachedQuerySecret = process.env.QUERY_JWT_SECRET;
    return cachedQuerySecret;
  }

  cachedQuerySecret = await fetchQueryJwtSecretFromSsm();
  return cachedQuerySecret;
}

/**
 * 签发 24 小时有效的 Query_Session（独立 JWT 密钥，通过 QUERY_JWT_SECRET_PARAM 读取）。
 * Requirement 3.2。
 */
export async function issueQuerySession(payload: QuerySessionPayload): Promise<string> {
  const secret = await getQueryJwtSecret();
  return jwt.sign(
    {
      credentialVersion: payload.credentialVersion,
    },
    secret,
    { expiresIn: QUERY_SESSION_EXPIRY },
  );
}

/** 会话校验失败原因：格式无法识别 / 已过期 / 凭证版本不匹配（含改密码触发的吊销） */
export type VerifyQuerySessionError = 'MALFORMED' | 'EXPIRED' | 'STALE_VERSION';

export interface VerifyQuerySessionResult {
  valid: boolean;
  error?: VerifyQuerySessionError;
}

/**
 * 校验 Query_Session：
 * - 格式无法解析/签名不合法 → { valid: false, error: 'MALFORMED' }
 * - 已超过 24 小时（JWT 原生 exp 判断） → { valid: false, error: 'EXPIRED' }
 * - payload.credentialVersion !== currentVersion → { valid: false, error: 'STALE_VERSION' }
 * - 否则 → { valid: true }
 *
 * Requirements 4.1, 4.2, 4.3, 4.4。
 */
export async function verifyQuerySession(
  token: string,
  currentVersion: number,
): Promise<VerifyQuerySessionResult> {
  const secret = await getQueryJwtSecret();

  let decoded: (jwt.JwtPayload & Partial<QuerySessionPayload>) | string;
  try {
    decoded = jwt.verify(token, secret) as jwt.JwtPayload & Partial<QuerySessionPayload>;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, error: 'EXPIRED' };
    }
    // jwt.JsonWebTokenError（签名不合法/格式无法解析）以及其他解析失败均视为 MALFORMED
    return { valid: false, error: 'MALFORMED' };
  }

  if (typeof decoded === 'string' || typeof decoded.credentialVersion !== 'number') {
    return { valid: false, error: 'MALFORMED' };
  }

  if (decoded.credentialVersion !== currentVersion) {
    return { valid: false, error: 'STALE_VERSION' };
  }

  return { valid: true };
}
