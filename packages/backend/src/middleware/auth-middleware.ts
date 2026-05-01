import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { verifyToken } from '../auth/token';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  roles: string[];
  isEmployee: boolean;
}

export interface AuthenticatedEvent extends APIGatewayProxyEvent {
  user: AuthenticatedUser;
}

type LambdaHandler = (event: AuthenticatedEvent) => Promise<APIGatewayProxyResult>;

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USERS_TABLE = process.env.USERS_TABLE ?? '';

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify({ code, message }),
  };
}

export function withAuth(handler: LambdaHandler) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(401, 'UNAUTHORIZED', '缺少访问令牌');
    }

    const token = authHeader.slice(7);
    const result = await verifyToken(token);

    if (!result.valid) {
      if (result.error === 'TOKEN_EXPIRED') {
        return errorResponse(401, ErrorCodes.TOKEN_EXPIRED, ErrorMessages.TOKEN_EXPIRED);
      }
      return errorResponse(401, 'INVALID_TOKEN', '无效的访问令牌');
    }

    const payload = result.payload!;
    let roles: string[] = payload.roles || [];
    let isEmployee = false;

    // Only read DB if rolesVersion is missing (old token) or roles were updated after token was issued.
    // assignRoles writes rolesVersion (ms timestamp) to DynamoDB; token carries the same value.
    // If they match, skip the DB read — saves ~5-20ms per request.
    if (USERS_TABLE) {
      const tokenRolesVersion: number = payload.rolesVersion ?? 0;
      let needsDbRead = tokenRolesVersion === 0; // old token without rolesVersion always reads DB

      if (!needsDbRead) {
        // Quick check: read only rolesVersion from DB (single attribute, minimal cost)
        try {
          const versionRecord = await dynamoClient.send(
            new GetCommand({
              TableName: USERS_TABLE,
              Key: { userId: payload.userId },
              ProjectionExpression: 'rolesVersion, #r, #s, isEmployee',
              ExpressionAttributeNames: { '#r': 'roles', '#s': 'status' },
            }),
          );
          // User deleted or not found — reject immediately
          if (!versionRecord.Item) {
            return errorResponse(401, 'USER_DELETED', '用户已被删除');
          }
          // User disabled — reject
          if (versionRecord.Item.status === 'disabled') {
            return errorResponse(401, 'USER_DISABLED', '账号已被停用');
          }
          isEmployee = versionRecord.Item?.isEmployee === true;
          const dbRolesVersion: number = versionRecord.Item?.rolesVersion ?? 0;
          if (dbRolesVersion > tokenRolesVersion) {
            // Roles were updated after this token was issued — use DB roles
            roles = (versionRecord.Item?.roles as string[]) ?? roles;
          }
          // else: token roles are current, no extra read needed
        } catch {
          // Fallback to token roles if DB read fails
        }
      } else {
        // Old token: read full roles from DB
        try {
          const userRecord = await dynamoClient.send(
            new GetCommand({
              TableName: USERS_TABLE,
              Key: { userId: payload.userId },
              ProjectionExpression: '#r, #s, isEmployee',
              ExpressionAttributeNames: { '#r': 'roles', '#s': 'status' },
            }),
          );
          // User deleted or not found — reject immediately
          if (!userRecord.Item) {
            return errorResponse(401, 'USER_DELETED', '用户已被删除');
          }
          // User disabled — reject
          if (userRecord.Item.status === 'disabled') {
            return errorResponse(401, 'USER_DISABLED', '账号已被停用');
          }
          isEmployee = userRecord.Item?.isEmployee === true;
          if (userRecord.Item?.roles) {
            roles = userRecord.Item.roles as string[];
          }
        } catch {
          // Fallback to token roles
        }
      }
    }

    const authenticatedEvent = event as AuthenticatedEvent;
    authenticatedEvent.user = {
      userId: payload.userId,
      email: payload.email,
      roles,
      isEmployee,
    };

    return handler(authenticatedEvent);
  };
}
