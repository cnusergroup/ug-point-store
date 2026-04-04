import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ClaimRecord } from '@points-mall/shared';

/** Roles allowed to submit a claim */
const CLAIM_ALLOWED_ROLES = ['Speaker', 'UserGroupLeader', 'CommunityBuilder', 'Volunteer'];

export interface SubmitClaimInput {
  userId: string;
  userRoles: string[];
  userNickname: string;
  selectedRole?: string;
  title: string;
  description: string;
  imageUrls?: string[];
  activityUrl?: string;
}

export interface SubmitClaimResult {
  success: boolean;
  claim?: ClaimRecord;
  error?: { code: string; message: string };
}

/**
 * Validate whether a string is a valid URL.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Submit a points claim: validate inputs, then write to Claims table.
 */
export async function submitClaim(
  input: SubmitClaimInput,
  dynamoClient: DynamoDBDocumentClient,
  claimsTable: string,
): Promise<SubmitClaimResult> {
  // 1. Validate user has an allowed role
  const hasAllowedRole = input.userRoles.some((r) => CLAIM_ALLOWED_ROLES.includes(r));
  if (!hasAllowedRole) {
    return {
      success: false,
      error: { code: ErrorCodes.CLAIM_ROLE_NOT_ALLOWED, message: ErrorMessages.CLAIM_ROLE_NOT_ALLOWED },
    };
  }

  // 2. Validate title (1~100 chars) and description (1~1000 chars)
  if (!input.title || input.title.length > 100 || !input.description || input.description.length > 1000) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CLAIM_CONTENT, message: ErrorMessages.INVALID_CLAIM_CONTENT },
    };
  }

  // 3. Validate imageUrls (optional, max 5)
  if (input.imageUrls && input.imageUrls.length > 5) {
    return {
      success: false,
      error: { code: ErrorCodes.CLAIM_IMAGE_LIMIT_EXCEEDED, message: ErrorMessages.CLAIM_IMAGE_LIMIT_EXCEEDED },
    };
  }

  // 4. Validate activityUrl (optional, must be valid URL)
  if (input.activityUrl !== undefined && input.activityUrl !== '' && !isValidUrl(input.activityUrl)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_ACTIVITY_URL, message: ErrorMessages.INVALID_ACTIVITY_URL },
    };
  }

  // 5. Build claim record
  const now = new Date().toISOString();
  const claimId = ulid();
  // Use selectedRole if provided and valid, otherwise pick the first allowed role
  let applicantRole: string;
  if (input.selectedRole && CLAIM_ALLOWED_ROLES.includes(input.selectedRole) && input.userRoles.includes(input.selectedRole)) {
    applicantRole = input.selectedRole;
  } else {
    applicantRole = input.userRoles.find((r) => CLAIM_ALLOWED_ROLES.includes(r)) ?? input.userRoles[0];
  }

  const claim: ClaimRecord = {
    claimId,
    userId: input.userId,
    applicantNickname: input.userNickname,
    applicantRole,
    title: input.title,
    description: input.description,
    imageUrls: input.imageUrls ?? [],
    ...(input.activityUrl ? { activityUrl: input.activityUrl } : {}),
    status: 'pending',
    createdAt: now,
  };

  // 6. Write to Claims table
  await dynamoClient.send(
    new PutCommand({
      TableName: claimsTable,
      Item: claim,
    }),
  );

  return { success: true, claim };
}


export interface ListMyClaimsOptions {
  userId: string;
  status?: 'pending' | 'approved' | 'rejected';
  pageSize?: number;
  lastKey?: string;
}

export interface ListMyClaimsResult {
  success: boolean;
  claims?: ClaimRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/**
 * List claims submitted by a specific user, sorted by createdAt descending.
 * Supports optional status filtering and cursor-based pagination.
 */
export async function listMyClaims(
  options: ListMyClaimsOptions,
  dynamoClient: DynamoDBDocumentClient,
  claimsTable: string,
): Promise<ListMyClaimsResult> {
  const pageSize = Math.min(options.pageSize ?? 20, 100);

  let exclusiveStartKey: Record<string, any> | undefined;
  if (options.lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'));
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  const expressionAttributeValues: Record<string, any> = { ':uid': options.userId };
  let filterExpression: string | undefined;

  if (options.status) {
    filterExpression = '#st = :status';
    expressionAttributeValues[':status'] = options.status;
  }

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: claimsTable,
      IndexName: 'userId-createdAt-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: expressionAttributeValues,
      ...(filterExpression && {
        FilterExpression: filterExpression,
        ExpressionAttributeNames: { '#st': 'status' },
      }),
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const claims = (result.Items ?? []) as ClaimRecord[];

  let lastKey: string | undefined;
  if (result.LastEvaluatedKey) {
    lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return { success: true, claims, lastKey };
}
