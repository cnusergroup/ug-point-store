/**
 * 查询系统初始默认凭证读取模块 (`packages/backend/src/participation/bootstrap-defaults.ts`)。
 *
 * 设计决策 4（design.md）：初始查询密码通过 SSM SecureString 参数
 * `/points-mall/query-default-password` 注入明文密码，Lambda 冷启动时读取该参数，
 * 在内存中 bcrypt 哈希后缓存哈希结果（而非明文），供 `getOrBootstrapCredential` 使用。
 * CDK 不计算也不在模板中出现任何 bcrypt 哈希——哈希始终在 Lambda 运行时完成。
 *
 * SSM 读取/缓存模式与 `session.ts` 的 `fetchQueryJwtSecretFromSsm`/`getQueryJwtSecret` 保持一致：
 * 模块级缓存变量、独立 SSM 客户端实例、缺失参数名环境变量或参数值为空均抛出错误。
 * 本地开发/测试时可通过 `QUERY_DEFAULT_PASSWORD` 环境变量直接提供明文密码，跳过 SSM 调用
 * （与 `session.ts` 的 `QUERY_JWT_SECRET` 本地回退模式一致）。
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { hash } from 'bcryptjs';

/** 初始默认密码哈希使用的 bcrypt 加密轮数，与 credential.ts 的 CREDENTIAL_BCRYPT_SALT_ROUNDS 保持一致 */
const BOOTSTRAP_BCRYPT_SALT_ROUNDS = 10;

export interface BootstrapDefaults {
  username: string;
  passwordHash: string;
}

// Cache the resulting hash (not just the plaintext) after first computation (Lambda cold start),
// 与 session.ts 的模块级缓存变量模式一致，避免同一容器内重复调用 SSM 或重复哈希。
let cachedBootstrapDefaults: BootstrapDefaults | null = null;

const ssmClient = new SSMClient({});

async function fetchDefaultPasswordFromSsm(): Promise<string> {
  const paramName = process.env.QUERY_DEFAULT_PASSWORD_PARAM;
  if (!paramName) {
    throw new Error('QUERY_DEFAULT_PASSWORD_PARAM environment variable is not set');
  }
  const result = await ssmClient.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  if (!result.Parameter?.Value) {
    throw new Error(`SSM parameter ${paramName} has no value`);
  }
  return result.Parameter.Value;
}

/**
 * 获取查询系统 bootstrap 默认用户名与密码哈希。首次调用从 SSM 读取明文密码并哈希后缓存哈希结果，
 * 随后调用直接返回缓存值，不再重复哈希或读取 SSM。
 * 本地开发/测试时可通过 QUERY_DEFAULT_PASSWORD 环境变量直接提供明文密码，跳过 SSM 调用。
 */
export async function getBootstrapDefaults(): Promise<BootstrapDefaults> {
  if (cachedBootstrapDefaults) return cachedBootstrapDefaults;

  const username = process.env.QUERY_DEFAULT_USERNAME;
  if (!username) {
    throw new Error('QUERY_DEFAULT_USERNAME environment variable is not set');
  }

  const plaintextPassword = process.env.QUERY_DEFAULT_PASSWORD
    ? process.env.QUERY_DEFAULT_PASSWORD
    : await fetchDefaultPasswordFromSsm();

  const passwordHash = await hash(plaintextPassword, BOOTSTRAP_BCRYPT_SALT_ROUNDS);

  cachedBootstrapDefaults = { username, passwordHash };
  return cachedBootstrapDefaults;
}
