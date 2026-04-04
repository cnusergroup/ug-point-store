import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  TransactWriteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ClaimRecord } from '@points-mall/shared';

export interface ReviewClaimInput {
  claimId: string;
  reviewerId: string;
  reviewerNickname?: string;
  action: 'approve' | 'reject';
  awardedPoints?: number;   // required when action=approve, 1~10000
  rejectReason?: string;    // required when action=reject, 1~500 chars
}

export interface ReviewClaimResult {
  success: boolean;
  claim?: ClaimRecord;
  error?: { code: string; message: string };
}

/**
 * Review a points claim: approve (with atomic points award) or reject.
 */
export async function reviewClaim(
  input: ReviewClaimInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { claimsTable: string; usersTable: string; pointsRecordsTable: string },
): Promise<ReviewClaimResult> {
  // 1. Get the claim record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.claimsTable,
      Key: { claimId: input.claimId },
    }),
  );

  const claim = getResult.Item as ClaimRecord | undefined;
  if (!claim) {
    return {
      success: false,
      error: { code: ErrorCodes.CLAIM_NOT_FOUND, message: ErrorMessages.CLAIM_NOT_FOUND },
    };
  }

  // 2. Check claim is still pending
  if (claim.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.CLAIM_ALREADY_REVIEWED, message: ErrorMessages.CLAIM_ALREADY_REVIEWED },
    };
  }

  const now = new Date().toISOString();

  // 3. Handle approve
  if (input.action === 'approve') {
    // Validate awardedPoints (1~10000)
    if (
      input.awardedPoints === undefined ||
      input.awardedPoints === null ||
      !Number.isInteger(input.awardedPoints) ||
      input.awardedPoints < 1 ||
      input.awardedPoints > 10000
    ) {
      return {
        success: false,
        error: { code: ErrorCodes.INVALID_POINTS_AMOUNT, message: ErrorMessages.INVALID_POINTS_AMOUNT },
      };
    }

    const awardedPoints = input.awardedPoints;
    const recordId = ulid();

    // Get current user points for balanceAfter calculation
    const userResult = await dynamoClient.send(
      new GetCommand({
        TableName: tables.usersTable,
        Key: { userId: claim.userId },
        ProjectionExpression: 'points',
      }),
    );
    const currentPoints = userResult.Item?.points ?? 0;
    const newBalance = currentPoints + awardedPoints;

    // Atomic transaction: update claim + increment user points + create points record
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // a. Update Claims table
          {
            Update: {
              TableName: tables.claimsTable,
              Key: { claimId: input.claimId },
              UpdateExpression: 'SET #s = :approved, awardedPoints = :pts, reviewerId = :rid, reviewerNickname = :rnick, reviewedAt = :rat',
              ConditionExpression: '#s = :pending',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':approved': 'approved',
                ':pending': 'pending',
                ':pts': awardedPoints,
                ':rid': input.reviewerId,
                ':rnick': input.reviewerNickname ?? '',
                ':rat': now,
              },
            },
          },
          // b. Update Users table: increment points
          {
            Update: {
              TableName: tables.usersTable,
              Key: { userId: claim.userId },
              UpdateExpression: 'SET points = points + :pv, updatedAt = :now',
              ExpressionAttributeValues: {
                ':pv': awardedPoints,
                ':now': now,
              },
            },
          },
          // c. Put new PointsRecord
          {
            Put: {
              TableName: tables.pointsRecordsTable,
              Item: {
                recordId,
                userId: claim.userId,
                type: 'earn',
                amount: awardedPoints,
                source: `积分申请审批:${input.claimId}`,
                balanceAfter: newBalance,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );

    const updatedClaim: ClaimRecord = {
      ...claim,
      status: 'approved',
      awardedPoints,
      reviewerId: input.reviewerId,
      reviewerNickname: input.reviewerNickname ?? '',
      reviewedAt: now,
    };

    return { success: true, claim: updatedClaim };
  }

  // 4. Handle reject
  // Validate rejectReason (1~500 chars)
  if (!input.rejectReason || input.rejectReason.length > 500) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_REJECT_REASON, message: ErrorMessages.INVALID_REJECT_REASON },
    };
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tables.claimsTable,
      Key: { claimId: input.claimId },
      UpdateExpression: 'SET #s = :rejected, rejectReason = :reason, reviewerId = :rid, reviewerNickname = :rnick, reviewedAt = :rat',
      ConditionExpression: '#s = :pending',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':rejected': 'rejected',
        ':pending': 'pending',
        ':reason': input.rejectReason,
        ':rid': input.reviewerId,
        ':rnick': input.reviewerNickname ?? '',
        ':rat': now,
      },
    }),
  );

  const updatedClaim: ClaimRecord = {
    ...claim,
    status: 'rejected',
    rejectReason: input.rejectReason,
    reviewerId: input.reviewerId,
    reviewerNickname: input.reviewerNickname ?? '',
    reviewedAt: now,
  };

  return { success: true, claim: updatedClaim };
}


export interface ListAllClaimsOptions {
  status?: 'pending' | 'approved' | 'rejected';
  pageSize?: number;
  lastKey?: string;
}

export interface ListAllClaimsResult {
  success: boolean;
  claims?: ClaimRecord[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/**
 * List all claims for admin review, sorted by createdAt descending.
 * When status is provided, uses GSI status-createdAt-index for efficient query.
 * When status is omitted, uses Scan + client-side sort.
 * Supports cursor-based pagination with base64-encoded lastKey.
 */
export async function listAllClaims(
  options: ListAllClaimsOptions,
  dynamoClient: DynamoDBDocumentClient,
  claimsTable: string,
): Promise<ListAllClaimsResult> {
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

  if (options.status) {
    // Use GSI status-createdAt-index for efficient query by status
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: claimsTable,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#st = :status',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':status': options.status },
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

  // No status filter: use Scan + sort by createdAt descending
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: claimsTable,
      Limit: pageSize,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const claims = ((result.Items ?? []) as ClaimRecord[]).sort(
    (a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0),
  );

  let lastKey: string | undefined;
  if (result.LastEvaluatedKey) {
    lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return { success: true, claims, lastKey };
}
