import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { verifyToken } from '../auth/token';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  roles: string[];
}

export interface AuthenticatedEvent extends APIGatewayProxyEvent {
  user: AuthenticatedUser;
}

type LambdaHandler = (event: AuthenticatedEvent) => Promise<APIGatewayProxyResult>;

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
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

    const authenticatedEvent = event as AuthenticatedEvent;
    authenticatedEvent.user = {
      userId: result.payload!.userId,
      email: result.payload!.email,
      roles: result.payload!.roles || [],
    };

    return handler(authenticatedEvent);
  };
}
