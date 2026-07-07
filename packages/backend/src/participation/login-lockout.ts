import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * 登录锁定模块（PointsMall-QueryLoginAttempts 表）。
 * 按来源 IP 隔离的滑动窗口失败计数器，逻辑与现有 `auth/login.ts` 的账号锁定机制同构，
 * 但以 IP 为分区键、独立表存储，与商城用户账号体系完全隔离。
 */

/** 15 分钟滑动窗口内累计失败次数达到该阈值即锁定，Requirement 5.1 */
export const MAX_LOGIN_FAILURES = 5;
/** 滑动窗口时长：15 分钟，Requirement 5.1 */
export const SLIDING_WINDOW_MS = 15 * 60 * 1000;
/** 锁定持续时长：15 分钟，Requirement 5.1 */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** TTL 清理缓冲：状态失效后额外保留一段时间再自动清理，避免边界时刻误删 */
const TTL_CLEANUP_BUFFER_MS = 24 * 60 * 60 * 1000; // 1 天

/** 单个来源 IP 的登录锁定状态（`PointsMall-QueryLoginAttempts` 表记录的业务字段） */
export interface LockoutState {
  /** 当前滑动窗口内的失败次数 */
  failCount: number;
  /** 当前窗口起始时间（epoch ms） */
  firstFailAt?: number;
  /** 锁定截止时间（epoch ms） */
  lockUntil?: number;
}

/** 未有任何记录时的默认（未锁定、未失败）状态 */
const DEFAULT_LOCKOUT_STATE: LockoutState = { failCount: 0 };

/**
 * 纯函数：给定当前状态与当前时间，判断是否处于锁定中及剩余时长。
 * Requirement 5.2。
 */
export function evaluateLockout(
  state: LockoutState,
  now: number,
): { locked: boolean; remainingMs?: number } {
  if (state.lockUntil && state.lockUntil > now) {
    return { locked: true, remainingMs: state.lockUntil - now };
  }
  return { locked: false };
}

/**
 * 纯函数：记录一次失败尝试后的新状态（滑动窗口过期则重开窗口）。
 * 累计失败次数达到 `MAX_LOGIN_FAILURES` 时锁定 `LOCK_DURATION_MS`。
 * Requirement 5.1。
 */
export function recordFailure(state: LockoutState, now: number): LockoutState {
  let newFailCount: number;
  let newFirstFailAt: number;

  if (!state.firstFailAt || now - state.firstFailAt > SLIDING_WINDOW_MS) {
    // 无历史失败记录或窗口已过期 — 重新开窗
    newFirstFailAt = now;
    newFailCount = 1;
  } else {
    // 仍在滑动窗口内 — 累加
    newFirstFailAt = state.firstFailAt;
    newFailCount = state.failCount + 1;
  }

  if (newFailCount >= MAX_LOGIN_FAILURES) {
    return {
      failCount: newFailCount,
      firstFailAt: newFirstFailAt,
      lockUntil: now + LOCK_DURATION_MS,
    };
  }

  return {
    failCount: newFailCount,
    firstFailAt: newFirstFailAt,
  };
}

/**
 * 纯函数：登录成功后的重置状态。
 * Requirement 5.3。
 */
export function recordSuccess(): LockoutState {
  return { failCount: 0 };
}

/**
 * IO：读取指定 IP 当前锁定状态。不存在记录时返回默认（未锁定、未失败）状态。
 */
export async function getLockoutState(
  ip: string,
  dynamoClient: DynamoDBDocumentClient,
  table: string,
): Promise<LockoutState> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: table,
      Key: { ip },
    }),
  );

  if (!result.Item) {
    return { ...DEFAULT_LOCKOUT_STATE };
  }

  const item = result.Item as LockoutState;
  return {
    failCount: item.failCount ?? 0,
    ...(item.firstFailAt !== undefined ? { firstFailAt: item.firstFailAt } : {}),
    ...(item.lockUntil !== undefined ? { lockUntil: item.lockUntil } : {}),
  };
}

/**
 * IO：写回指定 IP 的锁定状态，附加 `ttl` 属性（epoch 秒）用于 DynamoDB 自动清理。
 * TTL 基于状态本身不再具有统计意义的时刻（锁定截止时间，或窗口过期时间，或当前时间）
 * 加上一段清理缓冲计算得出。
 */
export async function saveLockoutState(
  ip: string,
  state: LockoutState,
  dynamoClient: DynamoDBDocumentClient,
  table: string,
): Promise<void> {
  const now = Date.now();
  const relevantExpiryMs =
    state.lockUntil ?? (state.firstFailAt !== undefined ? state.firstFailAt + SLIDING_WINDOW_MS : now);
  const ttl = Math.floor((relevantExpiryMs + TTL_CLEANUP_BUFFER_MS) / 1000);

  await dynamoClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        ip,
        ...state,
        ttl,
      },
    }),
  );
}
