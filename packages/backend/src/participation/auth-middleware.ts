/**
 * 查询鉴权中间件 (`packages/backend/src/participation/auth-middleware.ts`)。
 *
 * 包装查询数据接口：
 * 1. 解析 Authorization: Bearer <token>，缺失或非 Bearer 格式 → 401 QUERY_UNAUTHORIZED
 * 2. 读取当前凭证 version（getOrBootstrapCredential）；passwordHash 格式不合法 → 500 QUERY_CREDENTIAL_CORRUPTED
 * 3. verifyQuerySession(token, currentVersion)，按失败原因映射为 401 QUERY_SESSION_EXPIRED /
 *    401 QUERY_SESSION_REVOKED / 401 QUERY_UNAUTHORIZED（MALFORMED 及其他情况）
 * 4. 通过则调用被包装的 handler
 *
 * 该模块完全独立于商城用户账号体系：使用独立的 QueryCredentials 表与独立的 Query_Session JWT。
 *
 * See design.md "4. 查询鉴权中间件"。
 * Requirements: 4.1, 4.2, 4.3, 4.4, 1.6。
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { getOrBootstrapCredential } from './credential';
import { verifyQuerySession } from './session';
import { getBootstrapDefaults } from './bootstrap-defaults';

export type QueryHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const QUERY_CREDENTIALS_TABLE = process.env.QUERY_CREDENTIALS_TABLE ?? '';

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

/**
 * 包装查询数据接口，校验 Query_Session 后再调用被包装的 handler。
 * Requirements: 4.1, 4.2, 4.3, 4.4, 1.6。
 */
export function withQuerySession(handler: QueryHandler): QueryHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(
        401,
        ErrorCodes.QUERY_UNAUTHORIZED,
        ErrorMessages[ErrorCodes.QUERY_UNAUTHORIZED],
      );
    }

    const token = authHeader.slice(7);

    let currentVersion: number;
    try {
      const defaults = await getBootstrapDefaults();
      const credential = await getOrBootstrapCredential(dynamoClient, QUERY_CREDENTIALS_TABLE, defaults);
      currentVersion = credential.version;
    } catch (err) {
      console.error('withQuerySession: failed to load query credential', err);
      return errorResponse(
        500,
        ErrorCodes.QUERY_CREDENTIAL_CORRUPTED,
        ErrorMessages[ErrorCodes.QUERY_CREDENTIAL_CORRUPTED],
      );
    }

    const result = await verifyQuerySession(token, currentVersion);

    if (!result.valid) {
      if (result.error === 'EXPIRED') {
        return errorResponse(
          401,
          ErrorCodes.QUERY_SESSION_EXPIRED,
          ErrorMessages[ErrorCodes.QUERY_SESSION_EXPIRED],
        );
      }
      if (result.error === 'STALE_VERSION') {
        return errorResponse(
          401,
          ErrorCodes.QUERY_SESSION_REVOKED,
          ErrorMessages[ErrorCodes.QUERY_SESSION_REVOKED],
        );
      }
      // MALFORMED（或任何其他未识别的失败原因）
      return errorResponse(
        401,
        ErrorCodes.QUERY_UNAUTHORIZED,
        ErrorMessages[ErrorCodes.QUERY_UNAUTHORIZED],
      );
    }

    return handler(event);
  };
}
