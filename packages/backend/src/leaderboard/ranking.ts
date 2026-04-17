import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { REGULAR_ROLES } from '@points-mall/shared';

// ============================================================
// Interfaces
// ============================================================

export interface RankingQueryOptions {
  role: 'all' | 'Speaker' | 'UserGroupLeader' | 'Volunteer';
  limit: number;    // 1~50, 默认 20
  lastKey?: string;  // base64 编码的分页游标
}

export interface RankingItem {
  rank: number;
  nickname: string;
  roles: string[];      // 仅普通角色
  earnTotal: number;
}

export interface RankingResult {
  success: boolean;
  items?: RankingItem[];
  lastKey?: string | null;
  error?: { code: string; message: string };
}

// ============================================================
// Constants
// ============================================================

const VALID_ROLES = ['all', 'Speaker', 'UserGroupLeader', 'Volunteer'] as const;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_LIMIT = 1;

/** Over-fetch multiplier to handle role filtering at application layer */
const OVER_FETCH_MULTIPLIER = 3;

// ============================================================
// Validation
// ============================================================

/**
 * Validate and normalize ranking query parameters.
 * - role: all/Speaker/UserGroupLeader/Volunteer, default 'all'
 * - limit: 1~50, default 20
 * - lastKey: optional base64 pagination cursor
 */
export function validateRankingParams(query: Record<string, string | undefined>): {
  valid: boolean;
  options?: RankingQueryOptions;
  error?: { code: string; message: string };
} {
  // Validate role
  const role = query.role ?? 'all';
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return {
      valid: false,
      error: { code: 'INVALID_REQUEST', message: 'role 参数无效，取值为 all、Speaker、UserGroupLeader 或 Volunteer' },
    };
  }

  // Validate limit
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== '') {
    const parsed = parseInt(query.limit, 10);
    if (isNaN(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: `limit 参数无效，取值范围为 ${MIN_LIMIT}~${MAX_LIMIT}` },
      };
    }
    limit = parsed;
  }

  // Validate lastKey (optional base64 pagination cursor)
  let lastKey: string | undefined;
  if (query.lastKey !== undefined && query.lastKey !== '') {
    try {
      const decoded = Buffer.from(query.lastKey, 'base64').toString('utf-8');
      JSON.parse(decoded); // Validate it's valid JSON
      lastKey = query.lastKey;
    } catch {
      return {
        valid: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  return {
    valid: true,
    options: {
      role: role as RankingQueryOptions['role'],
      limit,
      ...(lastKey && { lastKey }),
    },
  };
}

// ============================================================
// Role filtering helpers
// ============================================================

/**
 * Returns true if the user has at least one regular role (Speaker, UserGroupLeader, Volunteer).
 * Users with only admin roles (Admin, SuperAdmin, OrderAdmin) are excluded from ranking.
 */
export function isEligibleForRanking(roles: string[]): boolean {
  return roles.some(r => (REGULAR_ROLES as string[]).includes(r));
}

/**
 * Filter users by role.
 * - When role='all', returns users with at least one regular role.
 * - When role is a specific role, returns users who have that role AND at least one regular role.
 */
export function filterByRole(
  users: Array<{ roles?: string[]; [key: string]: unknown }>,
  role: string,
): Array<{ roles?: string[]; [key: string]: unknown }> {
  if (role === 'all') {
    return users.filter(u => isEligibleForRanking(u.roles ?? []));
  }
  return users.filter(u => {
    const userRoles = u.roles ?? [];
    return userRoles.includes(role) && isEligibleForRanking(userRoles);
  });
}

// ============================================================
// GSI and field mapping per role
// ============================================================

const ROLE_GSI_MAP: Record<string, { indexName: string; sortKeyField: string }> = {
  all:              { indexName: 'earnTotal-index',         sortKeyField: 'earnTotal' },
  Speaker:          { indexName: 'earnTotalSpeaker-index',  sortKeyField: 'earnTotalSpeaker' },
  UserGroupLeader:  { indexName: 'earnTotalLeader-index',   sortKeyField: 'earnTotalLeader' },
  Volunteer:        { indexName: 'earnTotalVolunteer-index', sortKeyField: 'earnTotalVolunteer' },
};

// ============================================================
// Main ranking query
// ============================================================

/**
 * Query the ranking leaderboard.
 * - For 'all': queries earnTotal-index GSI, returns all users with at least one regular role
 * - For specific roles: queries the role-specific GSI (earnTotalSpeaker/Leader/Volunteer-index)
 *   and returns only users who have that role, showing their role-specific earnTotal
 * - Calculates rank numbers
 * - Returns paginated results (items + lastKey)
 */
export async function getRanking(
  options: RankingQueryOptions,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<RankingResult> {
  const { role, limit, lastKey } = options;

  // Pick the correct GSI and sort key field based on role
  const gsiConfig = ROLE_GSI_MAP[role] ?? ROLE_GSI_MAP['all'];
  const { indexName, sortKeyField } = gsiConfig;

  // Decode pagination cursor
  let exclusiveStartKey: Record<string, any> | undefined;
  if (lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8'));
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  // For role-specific GSIs: no application-layer filtering needed — the GSI only contains
  // users who have that role's earnTotal field set. We still over-fetch slightly to handle
  // edge cases where users may lack the required role in their roles array.
  // For 'all': over-fetch to handle admin-only users being filtered out.
  const fetchLimit = role === 'all' ? limit * OVER_FETCH_MULTIPLIER : Math.ceil(limit * 1.5);

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: usersTable,
      IndexName: indexName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALL' },
      ScanIndexForward: false,
      Limit: fetchLimit,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const rawUsers = result.Items ?? [];

  // For 'all': filter out admin-only users (no regular role)
  // For specific roles: filter to users who actually have that role in their roles array
  const filteredUsers = filterByRole(rawUsers, role);

  // Take only the requested limit
  const pageUsers = filteredUsers.slice(0, limit);

  const items: RankingItem[] = pageUsers.map((user, index) => ({
    rank: index + 1,
    nickname: (user.nickname as string) ?? '',
    roles: ((user.roles as string[]) ?? []).filter(r => (REGULAR_ROLES as string[]).includes(r)),
    // Show the role-specific earnTotal for role tabs, total earnTotal for 'all' tab
    earnTotal: (user[sortKeyField] as number) ?? 0,
  }));

  // Determine next page cursor
  let nextLastKey: string | null = null;

  if (pageUsers.length === limit) {
    const lastReturnedUser = pageUsers[pageUsers.length - 1];
    const lastReturnedIndex = rawUsers.indexOf(lastReturnedUser);

    if (lastReturnedIndex < rawUsers.length - 1) {
      const lastRawItem = rawUsers[lastReturnedIndex];
      nextLastKey = Buffer.from(JSON.stringify({
        pk: lastRawItem.pk ?? 'ALL',
        [sortKeyField]: (lastRawItem[sortKeyField] as number) ?? 0,
        userId: lastRawItem.userId,
      })).toString('base64');
    } else if (result.LastEvaluatedKey) {
      nextLastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }
  } else if (filteredUsers.length > limit) {
    const lastReturnedUser = pageUsers[pageUsers.length - 1];
    const lastReturnedIndex = rawUsers.indexOf(lastReturnedUser);
    const lastRawItem = rawUsers[lastReturnedIndex];
    nextLastKey = Buffer.from(JSON.stringify({
      pk: lastRawItem.pk ?? 'ALL',
      [sortKeyField]: (lastRawItem[sortKeyField] as number) ?? 0,
      userId: lastRawItem.userId,
    })).toString('base64');
  } else if (result.LastEvaluatedKey && filteredUsers.length < limit) {
    nextLastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return {
    success: true,
    items,
    lastKey: nextLastKey,
  };
}
