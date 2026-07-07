import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { compare, hash } from 'bcryptjs';

/** 修改查询密码时使用的 bcrypt 加密轮数，与 backend 其他模块保持一致 */
const CREDENTIAL_BCRYPT_SALT_ROUNDS = 10;

/**
 * 查询登录凭证记录（PointsMall-QueryCredentials 表）。
 * 与商城用户账号体系（Users 表）完全隔离。
 */
export interface QueryCredentialRecord {
  /** 分区键，≤64 字符 */
  username: string;
  /** bcrypt 哈希，不出现在任何 API 响应中 */
  passwordHash: string;
  /** 密码版本号，每次修改 +1，用于会话吊销判定 */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** 最近一次修改密码的 SuperAdmin userId */
  updatedBy?: string;
}

/** bcrypt 哈希格式：$2[aby]$轮数（2 位数字）$53 位字符 */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}$/;

/**
 * 校验字符串是否符合 bcrypt 哈希格式（`$2[aby]$轮数$53字符`）。
 * Requirement 1.6。
 */
export function isValidBcryptHash(hash: string): boolean {
  return BCRYPT_HASH_PATTERN.test(hash);
}

export interface QueryPasswordStrengthResult {
  valid: boolean;
  error?: { code: string; message: string };
}

/**
 * 校验查询密码强度：长度 ≥8 且同时包含至少一个字母和一个数字。
 * Requirements 2.3, 2.4。
 */
export function validateQueryPasswordStrength(password: string): QueryPasswordStrengthResult {
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      valid: false,
      error: {
        code: ErrorCodes.INVALID_PASSWORD_FORMAT,
        message: ErrorMessages[ErrorCodes.INVALID_PASSWORD_FORMAT],
      },
    };
  }

  return { valid: true };
}

/**
 * 权限校验：仅 SuperAdmin 角色可修改查询密码。
 * Requirements 2.5, 2.6。
 */
export function isAuthorizedToUpdateCredential(roles: string[]): boolean {
  return roles.includes('SuperAdmin');
}

/**
 * 从任意对象中剔除密码相关字段（`passwordHash`、`password`），用于 API 响应序列化。
 * Requirement 1.5。
 */
export function stripSecrets<T extends Record<string, unknown>>(
  record: T,
): Omit<T, 'passwordHash' | 'password'> {
  const { passwordHash, password, ...rest } = record as Record<string, unknown> & {
    passwordHash?: unknown;
    password?: unknown;
  };
  return rest as Omit<T, 'passwordHash' | 'password'>;
}

/**
 * 读取当前查询登录凭证记录；若不存在（即表为空，尚未 bootstrap 过），
 * 使用注入的默认用户名/密码哈希创建默认记录。
 *
 * 由于 QueryCredentials 表全局只存在一条记录，且该记录的 `username`（分区键）
 * 一旦创建后不会被重命名，因此直接按 `defaults.username` 读取即可判断该记录是否已存在。
 *
 * 使用条件写 `ConditionExpression: attribute_not_exists(username)` 防止并发重复创建：
 * 若并发写入导致条件失败（`ConditionalCheckFailedException`），重新读取已创建的记录并返回。
 *
 * 若记录已存在但 `passwordHash` 格式不合法，抛出错误（不修改任何数据）。
 * Requirements 1.1, 1.3, 1.6。
 */
export async function getOrBootstrapCredential(
  dynamoClient: DynamoDBDocumentClient,
  table: string,
  defaults: { username: string; passwordHash: string },
): Promise<QueryCredentialRecord> {
  const existing = await dynamoClient.send(
    new GetCommand({
      TableName: table,
      Key: { username: defaults.username },
    }),
  );

  if (existing.Item) {
    const record = existing.Item as QueryCredentialRecord;
    assertValidCredentialHash(record);
    return record;
  }

  const now = new Date().toISOString();
  const bootstrapRecord: QueryCredentialRecord = {
    username: defaults.username,
    passwordHash: defaults.passwordHash,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: table,
        Item: bootstrapRecord,
        ConditionExpression: 'attribute_not_exists(username)',
      }),
    );
    return bootstrapRecord;
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }

    // 并发场景：另一个请求已抢先创建了默认记录，重新读取并返回
    const reRead = await dynamoClient.send(
      new GetCommand({
        TableName: table,
        Key: { username: defaults.username },
      }),
    );

    if (!reRead.Item) {
      // 极小概率：记录在条件写失败与重读之间被删除，直接抛出原始错误
      throw err;
    }

    const record = reRead.Item as QueryCredentialRecord;
    assertValidCredentialHash(record);
    return record;
  }
}

/** 校验记录中的 passwordHash 格式，格式不合法时抛出错误，不修改任何数据 */
function assertValidCredentialHash(record: QueryCredentialRecord): void {
  if (!isValidBcryptHash(record.passwordHash)) {
    throw new Error(
      'QUERY_CREDENTIAL_CORRUPTED: Query credential passwordHash 格式不合法，需人工介入处理',
    );
  }
}

/**
 * 校验登录用户名密码是否匹配当前查询凭证记录（bcrypt compare）。
 * 用户名不匹配（记录不存在）或密码不匹配均返回 `{ valid: false }`。
 * Requirement 3.2, 3.3。
 */
export async function verifyCredential(
  username: string,
  password: string,
  dynamoClient: DynamoDBDocumentClient,
  table: string,
): Promise<{ valid: boolean; version?: number }> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: table,
      Key: { username },
    }),
  );

  if (!result.Item) {
    return { valid: false };
  }

  const record = result.Item as QueryCredentialRecord;
  const passwordMatch = await compare(password, record.passwordHash);

  if (!passwordMatch) {
    return { valid: false };
  }

  return { valid: true, version: record.version };
}

export interface UpdateCredentialPasswordInput {
  newPassword: string;
  requesterRoles: string[];
  requesterId: string;
}

export interface UpdateCredentialPasswordResult {
  success: boolean;
  version?: number;
  error?: { code: string; message: string };
}

/**
 * SuperAdmin 修改查询登录密码：校验角色 + 密码强度，全部通过才原子更新
 * `passwordHash` 与 `version = version + 1`；任一校验失败则不发生任何写入。
 * Requirements 1.1, 2.7。
 */
export async function updateCredentialPassword(
  input: UpdateCredentialPasswordInput,
  dynamoClient: DynamoDBDocumentClient,
  table: string,
): Promise<UpdateCredentialPasswordResult> {
  if (!isAuthorizedToUpdateCredential(input.requesterRoles)) {
    return {
      success: false,
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: ErrorMessages[ErrorCodes.FORBIDDEN],
      },
    };
  }

  const strength = validateQueryPasswordStrength(input.newPassword);
  if (!strength.valid) {
    return { success: false, error: strength.error };
  }

  // QueryCredentials 表全局只存在一条记录；通过 Scan 定位其分区键（username）
  const scanResult = await dynamoClient.send(
    new ScanCommand({ TableName: table, Limit: 1 }),
  );
  const record = scanResult.Items?.[0] as QueryCredentialRecord | undefined;

  if (!record) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '查询凭证尚未初始化',
      },
    };
  }

  const newHash = await hash(input.newPassword, CREDENTIAL_BCRYPT_SALT_ROUNDS);
  const now = new Date().toISOString();

  const updated = await dynamoClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { username: record.username },
      UpdateExpression:
        'SET passwordHash = :hash, version = version + :one, updatedAt = :now, updatedBy = :by',
      ExpressionAttributeValues: {
        ':hash': newHash,
        ':one': 1,
        ':now': now,
        ':by': input.requesterId,
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  return {
    success: true,
    version: updated.Attributes?.version as number | undefined,
  };
}
