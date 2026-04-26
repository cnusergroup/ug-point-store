import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import { hash } from 'bcryptjs';
import { ulid } from 'ulid';
import { validatePassword } from './validators';
import { validateInviteToken, consumeInviteToken } from './invite';

const BCRYPT_SALT_ROUNDS = 10;

export interface RegisterRequest {
  email: string;
  password: string;
  nickname: string;
  inviteToken: string;
}

export interface RegisterResult {
  success: boolean;
  userId?: string;
  user?: { userId: string; email: string; nickname: string; roles: string[]; points: number };
  error?: { code: string; message: string };
}

export async function registerUser(
  request: RegisterRequest,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  invitesTable: string,
): Promise<RegisterResult> {
  // 1. Validate inviteToken
  const inviteValidation = await validateInviteToken(request.inviteToken, dynamoClient, invitesTable);
  if (!inviteValidation.success) {
    return { success: false, error: inviteValidation.error };
  }
  const { roles, isEmployee } = inviteValidation;

  // 1b. Fetch invite's createdBy to record who invited this user
  const inviteRecord = await dynamoClient.send(
    new GetCommand({
      TableName: invitesTable,
      Key: { token: request.inviteToken },
      ProjectionExpression: 'createdBy',
    }),
  );
  const invitedBy = inviteRecord.Item?.createdBy as string | undefined;

  // 2. Validate password format
  const passwordCheck = validatePassword(request.password);
  if (!passwordCheck.valid) {
    return {
      success: false,
      error: {
        code: ErrorCodes.INVALID_PASSWORD_FORMAT,
        message: passwordCheck.message ?? ErrorMessages.INVALID_PASSWORD_FORMAT,
      },
    };
  }

  // 3. Check email uniqueness via GSI (do NOT consume token on duplicate)
  const existingUser = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': request.email },
      Limit: 1,
    }),
  );

  if (existingUser.Items && existingUser.Items.length > 0) {
    return {
      success: false,
      error: {
        code: ErrorCodes.EMAIL_ALREADY_EXISTS,
        message: ErrorMessages.EMAIL_ALREADY_EXISTS,
      },
    };
  }

  // 4. Hash password
  const passwordHash = await hash(request.password, BCRYPT_SALT_ROUNDS);

  // 5. Generate userId
  const userId = ulid();
  const now = new Date().toISOString();

  // 6. Create user record in DynamoDB with role from invite
  // Invite-based registration: email is pre-verified, no need for email verification flow
  // Initialize leaderboard fields based on assigned roles so user appears in role-specific GSIs
  const roleFieldMap: Record<string, string> = {
    Speaker: 'earnTotalSpeaker',
    UserGroupLeader: 'earnTotalLeader',
    Volunteer: 'earnTotalVolunteer',
  };
  const leaderboardFields: Record<string, any> = {};
  // Only add pk='ALL' for non-excluded roles (SA/OA should not appear in ranking GSI)
  const isExcludedFromRanking = roles.includes('SuperAdmin') || roles.includes('OrderAdmin');
  if (!isExcludedFromRanking) {
    leaderboardFields.pk = 'ALL';
    leaderboardFields.earnTotal = 0;
  }
  for (const role of roles) {
    const field = roleFieldMap[role];
    if (field) {
      leaderboardFields[field] = 0;
    }
  }

  const user = {
    userId,
    email: request.email,
    passwordHash,
    nickname: request.nickname,
    roles: roles,
    points: 0,
    emailVerified: true,
    loginFailCount: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    entityType: 'user',
    emailSubscriptions: { newProduct: true, newContent: true },
    ...leaderboardFields,
    ...(isEmployee === true ? { isEmployee: true } : {}),
    ...(invitedBy ? { invitedBy } : {}),
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tableName,
      Item: user,
    }),
  );

  // 7. Consume invite token (conditional update, concurrent conflict → INVITE_TOKEN_USED)
  const consumeResult = await consumeInviteToken(request.inviteToken, userId, dynamoClient, invitesTable, request.nickname);
  if (!consumeResult.success) {
    return { success: false, error: consumeResult.error };
  }

  return {
    success: true,
    userId,
    user: {
      userId,
      email: request.email,
      nickname: request.nickname,
      roles: roles,
      points: 0,
    },
  };
}
