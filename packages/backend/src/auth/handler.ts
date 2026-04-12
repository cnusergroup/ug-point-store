import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { ErrorCodes, ErrorHttpStatus, ErrorMessages } from '@points-mall/shared';
import { registerUser } from './register';
import { loginUser } from './login';
import { validateInviteToken } from './invite';
import { verifyEmail } from './verify-email';
import { getWechatQrCode, handleWechatCallback } from './wechat';
import { generateToken, verifyToken } from './token';
import { changePassword } from './change-password';
import { forgotPassword } from './forgot-password';
import { resetPassword } from './reset-password';

// Create clients outside handler for Lambda container reuse
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sesClient = new SESClient({});

const USERS_TABLE = process.env.USERS_TABLE ?? '';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? '';
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL ?? '';
const RESET_BASE_URL = process.env.RESET_BASE_URL ?? '';
const INVITES_TABLE = process.env.INVITES_TABLE ?? '';
const REGISTER_BASE_URL = process.env.REGISTER_BASE_URL ?? '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(code: string, message: string, statusCode?: number): APIGatewayProxyResult {
  const status = statusCode ?? (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
  return jsonResponse(status, { code, message });
}

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  try {
    // POST /api/auth/register
    if (method === 'POST' && path === '/api/auth/register') {
      return await handleRegister(event);
    }

    // POST /api/auth/login
    if (method === 'POST' && path === '/api/auth/login') {
      return await handleLogin(event);
    }

    // GET /api/auth/verify-email
    if (method === 'GET' && path === '/api/auth/verify-email') {
      return await handleVerifyEmail(event);
    }

    // POST /api/auth/wechat/qrcode
    if (method === 'POST' && path === '/api/auth/wechat/qrcode') {
      return handleWechatQrCodeRoute();
    }

    // POST /api/auth/wechat/callback
    if (method === 'POST' && path === '/api/auth/wechat/callback') {
      return await handleWechatCallbackRoute(event);
    }

    // POST /api/auth/refresh
    if (method === 'POST' && path === '/api/auth/refresh') {
      return await handleRefresh(event);
    }

    // POST /api/auth/change-password
    if (method === 'POST' && path === '/api/auth/change-password') {
      return await handleChangePassword(event);
    }

    // POST /api/auth/forgot-password
    if (method === 'POST' && path === '/api/auth/forgot-password') {
      return await handleForgotPassword(event);
    }

    // POST /api/auth/reset-password
    if (method === 'POST' && path === '/api/auth/reset-password') {
      return await handleResetPassword(event);
    }

    // POST /api/auth/validate-invite
    if (method === 'POST' && path === '/api/auth/validate-invite') {
      return await handleValidateInvite(event);
    }

    // POST /api/auth/logout
    if (method === 'POST' && path === '/api/auth/logout') {
      // JWT is stateless — server just returns 200; client clears the token
      return jsonResponse(200, { message: '已退出登录' });
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  } catch (err) {
    console.error('Unhandled error:', err);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

async function handleRegister(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.email || !body.password || !body.nickname || !body.inviteToken) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: email, password, nickname, inviteToken', 400);
  }

  const result = await registerUser(
    {
      email: body.email as string,
      password: body.password as string,
      nickname: body.nickname as string,
      inviteToken: body.inviteToken as string,
    },
    dynamoClient,
    USERS_TABLE,
    INVITES_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  // Generate JWT token so user is auto-logged-in after registration
  const accessToken = await generateToken({
    userId: result.user!.userId,
    email: result.user!.email,
    roles: result.user!.roles,
  });

  return jsonResponse(201, { accessToken, user: result.user });
}

async function handleLogin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.email || !body.password) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: email, password', 400);
  }

  const result = await loginUser(
    { email: body.email as string, password: body.password as string },
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 401;
    return jsonResponse(status, result.error);
  }

  // Generate JWT token on successful login
  const accessToken = await generateToken({
    userId: result.user!.userId,
    email: result.user!.email,
    roles: result.user!.roles,
  });

  return jsonResponse(200, { accessToken, user: result.user });
}

async function handleVerifyEmail(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const token = event.queryStringParameters?.token;
  if (!token) {
    return errorResponse('INVALID_REQUEST', 'Missing required query parameter: token', 400);
  }

  const result = await verifyEmail(token, dynamoClient, USERS_TABLE);

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { message: '邮箱验证成功' });
}

function handleWechatQrCodeRoute(): APIGatewayProxyResult {
  const result = getWechatQrCode();

  if (!result.success) {
    return jsonResponse(500, result.error);
  }

  return jsonResponse(200, { authUrl: result.authUrl, state: result.state });
}

async function handleWechatCallbackRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.code || !body.state) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: code, state', 400);
  }

  const result = await handleWechatCallback(
    body.code as string,
    body.state as string,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    return jsonResponse(400, result.error);
  }

  return jsonResponse(200, { accessToken: result.accessToken, user: result.user });
}

async function handleRefresh(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) {
    return errorResponse(ErrorCodes.TOKEN_EXPIRED, ErrorMessages.TOKEN_EXPIRED, 401);
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const verifyResult = await verifyToken(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    const code = verifyResult.error === 'TOKEN_EXPIRED' ? ErrorCodes.TOKEN_EXPIRED : 'INVALID_TOKEN';
    const message = verifyResult.error === 'TOKEN_EXPIRED' ? ErrorMessages.TOKEN_EXPIRED : 'Invalid token';
    return errorResponse(code, message, 401);
  }

  const payload = verifyResult.payload;
  const newToken = await generateToken({
    userId: payload.userId as string,
    email: payload.email as string | undefined,
    roles: (payload.roles as string[]) || [],
  });

  return jsonResponse(200, { accessToken: newToken });
}

async function handleChangePassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract JWT from Authorization header
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) {
    return errorResponse(ErrorCodes.TOKEN_EXPIRED, ErrorMessages.TOKEN_EXPIRED, 401);
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const verifyResult = await verifyToken(token);

  if (!verifyResult.valid || !verifyResult.payload) {
    const code = verifyResult.error === 'TOKEN_EXPIRED' ? ErrorCodes.TOKEN_EXPIRED : 'INVALID_TOKEN';
    const message = verifyResult.error === 'TOKEN_EXPIRED' ? ErrorMessages.TOKEN_EXPIRED : 'Invalid token';
    return errorResponse(code, message, 401);
  }

  // 2. Extract userId from token payload
  const userId = verifyResult.payload.userId as string;

  // 3. Parse body to get currentPassword and newPassword
  const body = parseBody(event);
  if (!body || !body.currentPassword || !body.newPassword) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: currentPassword, newPassword', 400);
  }

  // 4. Call changePassword
  const result = await changePassword(
    userId,
    body.currentPassword as string,
    body.newPassword as string,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '密码修改成功' });
}

async function handleForgotPassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.email) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: email', 400);
  }

  // Derive reset base URL from request Origin header if RESET_BASE_URL is not configured
  let resetBase = RESET_BASE_URL;
  if (!resetBase) {
    const origin = event.headers?.origin || event.headers?.Origin || '';
    if (origin) {
      resetBase = `${origin}/reset-password/index.html`;
    }
  }

  await forgotPassword(
    body.email as string,
    dynamoClient,
    sesClient,
    USERS_TABLE,
    SENDER_EMAIL,
    resetBase,
  );

  return jsonResponse(200, { message: '如果该邮箱已注册，重置邮件已发送' });
}

async function handleResetPassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.token || !body.newPassword) {
    return errorResponse('INVALID_REQUEST', 'Missing required fields: token, newPassword', 400);
  }

  const result = await resetPassword(
    body.token as string,
    body.newPassword as string,
    dynamoClient,
    USERS_TABLE,
  );

  if (!result.success) {
    const code = result.error!.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { message: '密码重置成功' });
}

async function handleValidateInvite(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body || !body.token) {
    return errorResponse('INVALID_REQUEST', 'Missing required field: token', 400);
  }

  const result = await validateInviteToken(body.token as string, dynamoClient, INVITES_TABLE);

  if (!result.success) {
    const code = result.error.code;
    const status = (ErrorHttpStatus as Record<string, number>)[code] ?? 400;
    return jsonResponse(status, result.error);
  }

  return jsonResponse(200, { valid: true, roles: result.roles });
}
