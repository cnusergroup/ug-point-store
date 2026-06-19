import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { UserRole } from '@points-mall/shared';

// ---- Interfaces ----

export interface SearchUsersOptions {
  /** 不区分大小写，匹配 nickname 或 email（contains） */
  keyword?: string;
  /** 角色过滤：UserGroupLeader/Speaker/Volunteer/Admin/SuperAdmin/OrderAdmin */
  role?: UserRole;
  /** 默认 20，clamp 至 [1,100] */
  pageSize?: number;
  /** 分页游标，解析失败则从首页查询 */
  lastKey?: Record<string, unknown>;
}

export interface SearchUserItem {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
}

export interface SearchUsersResult {
  users: SearchUserItem[];
  lastKey?: Record<string, unknown>;
}

// ---- Core Function ----

/**
 * 按昵称/邮箱关键字与角色查询用户（User_Query_Service）。
 *
 * 复用 entityType-createdAt-index GSI（ScanIndexForward=false，最新优先）。
 * - role 通过 FilterExpression contains(#roles,:role) 服务端过滤；
 * - keyword 在每页结果上以 toLowerCase().includes() 对 nickname/email 不区分大小写内存过滤；
 * - pageSize 默认 20，clamp 至 [1,100]；lastKey 解析失败则从首页查询；
 * - 返回单页结果（users）+ 用于加载下一页的游标 lastKey。
 */
export async function searchUsers(
  options: SearchUsersOptions,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<SearchUsersResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);

  const expressionAttributeNames: Record<string, string> = {
    '#userId': 'userId',
    '#email': 'email',
    '#nickname': 'nickname',
    '#roles': 'roles',
  };

  const expressionAttributeValues: Record<string, unknown> = {
    ':et': 'user',
  };

  const params: Record<string, unknown> = {
    TableName: usersTable,
    IndexName: 'entityType-createdAt-index',
    KeyConditionExpression: 'entityType = :et',
    ScanIndexForward: false,
    Limit: pageSize,
    ProjectionExpression: '#userId, #email, #nickname, #roles',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  // 角色服务端过滤
  if (options.role) {
    params.FilterExpression = 'contains(#roles, :role)';
    expressionAttributeValues[':role'] = options.role;
  }

  // lastKey 解析失败（非对象）则忽略，从首页查询
  if (options.lastKey && typeof options.lastKey === 'object') {
    params.ExclusiveStartKey = options.lastKey;
  }

  const result = await dynamoClient.send(new QueryCommand(params as any));

  const keyword = options.keyword?.trim().toLowerCase();

  const users: SearchUserItem[] = [];
  for (const item of result.Items ?? []) {
    const roles =
      item.roles instanceof Set
        ? Array.from(item.roles as Set<string>)
        : Array.isArray(item.roles)
          ? (item.roles as string[])
          : [];

    const nickname: string = item.nickname ?? '';
    const email: string = item.email ?? '';

    // 关键字不区分大小写内存过滤（nickname 或 email contains）
    if (keyword) {
      const matches =
        nickname.toLowerCase().includes(keyword) ||
        email.toLowerCase().includes(keyword);
      if (!matches) {
        continue;
      }
    }

    users.push({
      userId: item.userId,
      nickname,
      email,
      roles,
    });
  }

  const lastEvaluatedKey = result.LastEvaluatedKey as
    | Record<string, unknown>
    | undefined;

  return {
    users,
    ...(lastEvaluatedKey ? { lastKey: lastEvaluatedKey } : {}),
  };
}
