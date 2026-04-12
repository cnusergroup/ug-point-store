import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  TransactWriteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { TravelApplication, TravelApplicationStatus } from '@points-mall/shared';
import { clampPageSize } from './apply';

// ---- Interfaces ----

export interface ReviewTravelApplicationInput {
  applicationId: string;
  reviewerId: string;
  reviewerNickname: string;
  action: 'approve' | 'reject';
  rejectReason?: string;
}

export interface ReviewTravelApplicationResult {
  success: boolean;
  application?: TravelApplication;
  error?: { code: string; message: string };
}

export interface ListAllTravelApplicationsOptions {
  status?: TravelApplicationStatus;
  pageSize?: number;
  lastKey?: string;
}

export interface ListAllTravelApplicationsResult {
  success: boolean;
  applications: TravelApplication[];
  lastKey?: string;
  error?: { code: string; message: string };
}

// ---- Core Functions ----

/**
 * Review a travel application: approve or reject.
 *
 * - approve: UpdateCommand to set status=approved, record reviewer info. travelEarnUsed stays unchanged.
 * - reject: TransactWriteCommand to atomically update status=rejected + record rejectReason +
 *           decrease user's travelEarnUsed by earnDeducted (ConditionExpression ensures non-negative).
 */
export async function reviewTravelApplication(
  input: ReviewTravelApplicationInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: { usersTable: string; travelApplicationsTable: string },
): Promise<ReviewTravelApplicationResult> {
  // 1. Read the application record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.travelApplicationsTable,
      Key: { applicationId: input.applicationId },
    }),
  );

  const application = getResult.Item as TravelApplication | undefined;

  // 2. Verify application exists
  if (!application) {
    return {
      success: false,
      error: { code: ErrorCodes.APPLICATION_NOT_FOUND, message: ErrorMessages.APPLICATION_NOT_FOUND },
    };
  }

  // 3. Verify status is pending
  if (application.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.APPLICATION_ALREADY_REVIEWED, message: ErrorMessages.APPLICATION_ALREADY_REVIEWED },
    };
  }

  const now = new Date().toISOString();

  // 4. Handle approve
  if (input.action === 'approve') {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.travelApplicationsTable,
        Key: { applicationId: input.applicationId },
        UpdateExpression: 'SET #s = :approved, reviewerId = :rid, reviewerNickname = :rnick, reviewedAt = :rat, updatedAt = :now',
        ConditionExpression: '#s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'approved',
          ':pending': 'pending',
          ':rid': input.reviewerId,
          ':rnick': input.reviewerNickname,
          ':rat': now,
          ':now': now,
        },
      }),
    );

    const updatedApplication: TravelApplication = {
      ...application,
      status: 'approved',
      reviewerId: input.reviewerId,
      reviewerNickname: input.reviewerNickname,
      reviewedAt: now,
      updatedAt: now,
    };

    return { success: true, application: updatedApplication };
  }

  // 5. Handle reject — atomic transaction: update status + return quota
  await dynamoClient.send(
    new TransactWriteCommand({
      TransactItems: [
        // a. Update TravelApplication status to rejected
        {
          Update: {
            TableName: tables.travelApplicationsTable,
            Key: { applicationId: input.applicationId },
            UpdateExpression: 'SET #s = :rejected, rejectReason = :reason, reviewerId = :rid, reviewerNickname = :rnick, reviewedAt = :rat, updatedAt = :now',
            ConditionExpression: '#s = :pending',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: {
              ':rejected': 'rejected',
              ':pending': 'pending',
              ':reason': input.rejectReason ?? '',
              ':rid': input.reviewerId,
              ':rnick': input.reviewerNickname,
              ':rat': now,
              ':now': now,
            },
          },
        },
        // b. Decrease user's travelEarnUsed by earnDeducted (with non-negative guard)
        {
          Update: {
            TableName: tables.usersTable,
            Key: { userId: application.userId },
            UpdateExpression: 'SET travelEarnUsed = travelEarnUsed - :deducted, updatedAt = :now',
            ConditionExpression: 'travelEarnUsed >= :deducted',
            ExpressionAttributeValues: {
              ':deducted': application.earnDeducted,
              ':now': now,
            },
          },
        },
      ],
    }),
  );

  const updatedApplication: TravelApplication = {
    ...application,
    status: 'rejected',
    rejectReason: input.rejectReason ?? '',
    reviewerId: input.reviewerId,
    reviewerNickname: input.reviewerNickname,
    reviewedAt: now,
    updatedAt: now,
  };

  return { success: true, application: updatedApplication };
}

/**
 * List all travel applications for admin review.
 *
 * - When status is provided: uses GSI `status-createdAt-index` for efficient query (ScanIndexForward=false).
 * - When status is omitted: Scan the entire table + client-side sort by createdAt descending.
 * - pageSize defaults to 20, clamped to [1, 100].
 * - Supports cursor-based pagination via base64-encoded lastKey.
 */
export async function listAllTravelApplications(
  options: ListAllTravelApplicationsOptions,
  dynamoClient: DynamoDBDocumentClient,
  travelApplicationsTable: string,
): Promise<ListAllTravelApplicationsResult> {
  const limit = clampPageSize(options.pageSize);

  // Decode pagination cursor
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (options.lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(options.lastKey, 'base64').toString('utf-8'));
    } catch {
      exclusiveStartKey = undefined;
    }
  }

  if (options.status) {
    // Use GSI status-createdAt-index for efficient query by status
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: travelApplicationsTable,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#st = :status',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':status': options.status },
        ScanIndexForward: false,
        Limit: limit,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    const applications = (result.Items ?? []) as TravelApplication[];
    let lastKey: string | undefined;
    if (result.LastEvaluatedKey) {
      lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return { success: true, applications, lastKey };
  }

  // No status filter: Scan entire table + sort by createdAt descending
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: travelApplicationsTable,
      Limit: limit,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const applications = ((result.Items ?? []) as TravelApplication[]).sort(
    (a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0),
  );

  let lastKey: string | undefined;
  if (result.LastEvaluatedKey) {
    lastKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return { success: true, applications, lastKey };
}
