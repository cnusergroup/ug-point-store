import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages } from '@points-mall/shared';
import type { ContentReservation, ReservationApprovalItem } from '@points-mall/shared';

// ─── Review Reservation ────────────────────────────────────

export interface ReviewReservationInput {
  pk: string;
  reviewerId: string;
  action: 'approve' | 'reject';
}

export interface ReviewReservationResult {
  success: boolean;
  error?: { code: string; message: string };
}

/**
 * Review a content reservation: approve (with atomic points award) or reject.
 *
 * Approve flow (TransactWriteCommand atomic):
 * 1. Update ContentReservations: SET status=approved, reviewerId, reviewedAt, ConditionExpression: status = :pending
 * 2. Update Users: SET points = points + rewardPoints (for the content uploader)
 * 3. Put PointsRecords: complete activity info + targetRole=Speaker
 *
 * Reject flow (TransactWriteCommand atomic):
 * 1. Update ContentReservations: SET status=rejected, reviewerId, reviewedAt, ConditionExpression: status = :pending
 */
export async function reviewReservation(
  input: ReviewReservationInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    reservationsTable: string;
    contentItemsTable: string;
    usersTable: string;
    pointsRecordsTable: string;
  },
  rewardPoints: number,
): Promise<ReviewReservationResult> {
  // 1. Get the reservation record
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.reservationsTable,
      Key: { pk: input.pk },
    }),
  );

  const reservation = getResult.Item as ContentReservation | undefined;
  if (!reservation) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: '预约记录不存在' },
    };
  }

  // 2. Check reservation is still pending
  if (reservation.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.RESERVATION_ALREADY_REVIEWED, message: ErrorMessages[ErrorCodes.RESERVATION_ALREADY_REVIEWED] },
    };
  }

  const now = new Date().toISOString();

  // 3. Handle reject
  if (input.action === 'reject') {
    try {
      await dynamoClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tables.reservationsTable,
                Key: { pk: input.pk },
                UpdateExpression: 'SET #s = :rejected, reviewerId = :rid, reviewedAt = :rat',
                ConditionExpression: '#s = :pending',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: {
                  ':rejected': 'rejected',
                  ':pending': 'pending',
                  ':rid': input.reviewerId,
                  ':rat': now,
                },
              },
            },
          ],
        }),
      );
    } catch (err: any) {
      if (err.name === 'TransactionCanceledException') {
        return {
          success: false,
          error: { code: ErrorCodes.RESERVATION_ALREADY_REVIEWED, message: ErrorMessages[ErrorCodes.RESERVATION_ALREADY_REVIEWED] },
        };
      }
      throw err;
    }

    return { success: true };
  }

  // 4. Handle approve — need to find the content uploader
  const contentResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.contentItemsTable,
      Key: { contentId: reservation.contentId },
    }),
  );

  const contentItem = contentResult.Item;
  if (!contentItem) {
    return {
      success: false,
      error: { code: ErrorCodes.CONTENT_NOT_FOUND, message: ErrorMessages[ErrorCodes.CONTENT_NOT_FOUND] },
    };
  }

  const uploaderId = contentItem.uploaderId as string;
  const contentTitle = (contentItem.title as string) || '';

  // Get reserver's nickname for the source description
  const reserverResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId: reservation.userId },
      ProjectionExpression: 'nickname',
    }),
  );
  const reserverNickname = (reserverResult.Item?.nickname as string) || '用户';

  // Get uploader's current points for balanceAfter calculation
  const userResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.usersTable,
      Key: { userId: uploaderId },
      ProjectionExpression: 'points',
    }),
  );
  const currentPoints = (userResult.Item?.points as number) ?? 0;
  const newBalance = currentPoints + rewardPoints;

  const recordId = ulid();

  // Atomic transaction: update reservation + increment user points + create points record
  try {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // a. Update reservation status
          {
            Update: {
              TableName: tables.reservationsTable,
              Key: { pk: input.pk },
              UpdateExpression: 'SET #s = :approved, reviewerId = :rid, reviewedAt = :rat',
              ConditionExpression: '#s = :pending',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':approved': 'approved',
                ':pending': 'pending',
                ':rid': input.reviewerId,
                ':rat': now,
              },
            },
          },
          // b. Update user points — also increment earnTotal (all) and earnTotalSpeaker (reservation approval is always Speaker)
          {
            Update: {
              TableName: tables.usersTable,
              Key: { userId: uploaderId },
              UpdateExpression: 'SET points = points + :pv, earnTotal = if_not_exists(earnTotal, :zero) + :pv, earnTotalSpeaker = if_not_exists(earnTotalSpeaker, :zero) + :pv, pk = :pk, updatedAt = :now',
              ExpressionAttributeValues: {
                ':pv': rewardPoints,
                ':zero': 0,
                ':pk': 'ALL',
                ':now': now,
              },
            },
          },
          // c. Create points record with complete activity info
          {
            Put: {
              TableName: tables.pointsRecordsTable,
              Item: {
                recordId,
                userId: uploaderId,
                type: 'earn',
                amount: rewardPoints,
                source: `预约审批:${reserverNickname}|${reservation.activityUG || ''}|${reservation.activityTopic || ''}|${reservation.activityDate || ''}|${contentTitle}`,
                balanceAfter: newBalance,
                createdAt: now,
                activityId: reservation.activityId,
                activityType: reservation.activityType,
                activityUG: reservation.activityUG,
                activityTopic: reservation.activityTopic,
                activityDate: reservation.activityDate,
                targetRole: 'Speaker',
              },
            },
          },
        ],
      }),
    );
  } catch (err: any) {
    if (err.name === 'TransactionCanceledException') {
      return {
        success: false,
        error: { code: ErrorCodes.RESERVATION_ALREADY_REVIEWED, message: ErrorMessages[ErrorCodes.RESERVATION_ALREADY_REVIEWED] },
      };
    }
    throw err;
  }

  return { success: true };
}

// ─── List Reservation Approvals ────────────────────────────

export interface ListReservationApprovalsOptions {
  status?: 'pending' | 'approved' | 'rejected';
  ugNames?: string[];
  pageSize?: number;
  lastKey?: string;
}

export interface ListReservationApprovalsResult {
  success: boolean;
  reservations?: ReservationApprovalItem[];
  lastKey?: string;
  error?: { code: string; message: string };
}

/**
 * List reservation approvals with optional status filter and UG name filter.
 * - When status is provided, uses GSI status-createdAt-index for efficient query.
 * - When status is omitted, uses Scan + client-side sort.
 * - Filters by ugNames (activityUG field) if provided.
 * - For each reservation, batch gets content title and reserver nickname.
 */
export async function listReservationApprovals(
  options: ListReservationApprovalsOptions,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    reservationsTable: string;
    contentItemsTable: string;
    usersTable: string;
  },
): Promise<ListReservationApprovalsResult> {
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

  let items: ContentReservation[];

  if (options.status) {
    // Use GSI status-createdAt-index for efficient query by status
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.reservationsTable,
        IndexName: 'status-createdAt-index',
        KeyConditionExpression: '#st = :status',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':status': options.status },
        ScanIndexForward: false,
        Limit: pageSize,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    items = (result.Items ?? []) as ContentReservation[];

    // Handle pagination key from GSI query
    if (result.LastEvaluatedKey) {
      exclusiveStartKey = result.LastEvaluatedKey;
    } else {
      exclusiveStartKey = undefined;
    }
  } else {
    // No status filter: use Scan + sort by createdAt descending
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: tables.reservationsTable,
        Limit: pageSize,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    items = ((result.Items ?? []) as ContentReservation[]).sort(
      (a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0),
    );

    if (result.LastEvaluatedKey) {
      exclusiveStartKey = result.LastEvaluatedKey;
    } else {
      exclusiveStartKey = undefined;
    }
  }

  // Filter by ugNames if provided
  if (options.ugNames && options.ugNames.length > 0) {
    const ugSet = new Set(options.ugNames);
    items = items.filter(item => ugSet.has(item.activityUG));
  }

  // Batch get content titles and reserver nicknames
  const contentIds = [...new Set(items.map(item => item.contentId))];
  const userIds = [...new Set(items.map(item => item.userId))];

  const contentTitleMap = new Map<string, string>();
  const userNicknameMap = new Map<string, string>();

  // Batch get content titles
  if (contentIds.length > 0) {
    const contentChunks = chunkArray(contentIds, 100);
    for (const chunk of contentChunks) {
      const result = await dynamoClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tables.contentItemsTable]: {
              Keys: chunk.map(contentId => ({ contentId })),
              ProjectionExpression: 'contentId, title',
            },
          },
        }),
      );
      const contentItems = result.Responses?.[tables.contentItemsTable] ?? [];
      for (const item of contentItems) {
        contentTitleMap.set(item.contentId as string, (item.title as string) ?? '');
      }
    }
  }

  // Batch get user nicknames
  if (userIds.length > 0) {
    const userChunks = chunkArray(userIds, 100);
    for (const chunk of userChunks) {
      const result = await dynamoClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tables.usersTable]: {
              Keys: chunk.map(userId => ({ userId })),
              ProjectionExpression: 'userId, nickname',
            },
          },
        }),
      );
      const userItems = result.Responses?.[tables.usersTable] ?? [];
      for (const item of userItems) {
        userNicknameMap.set(item.userId as string, (item.nickname as string) ?? '');
      }
    }
  }

  // Build result items
  const reservations: ReservationApprovalItem[] = items.map(item => ({
    pk: item.pk,
    userId: item.userId,
    contentId: item.contentId,
    contentTitle: contentTitleMap.get(item.contentId) ?? '',
    reserverNickname: userNicknameMap.get(item.userId) ?? '',
    activityId: item.activityId,
    activityType: item.activityType,
    activityUG: item.activityUG,
    activityTopic: item.activityTopic,
    activityDate: item.activityDate,
    status: item.status,
    reviewerId: item.reviewerId,
    reviewedAt: item.reviewedAt,
    createdAt: item.createdAt,
  }));

  let lastKey: string | undefined;
  if (exclusiveStartKey) {
    lastKey = Buffer.from(JSON.stringify(exclusiveStartKey)).toString('base64');
  }

  return { success: true, reservations, lastKey };
}

// ─── Visibility Logic ──────────────────────────────────────

export interface UGRecord {
  ugId: string;
  name: string;
  status: 'active' | 'inactive';
  leaderId?: string;
  leaderNickname?: string;
}

/**
 * Determine the ugNames filter based on admin role and UG leader assignments.
 *
 * - SuperAdmin: returns undefined (no filter, sees all)
 * - Leader Admin: returns UG names where this admin is leader
 * - Non-Leader Admin: returns UG names with no leader assigned
 */
export function getVisibleUGNames(
  roles: string[],
  adminUserId: string,
  ugs: UGRecord[],
): string[] | undefined {
  // SuperAdmin sees all
  if (roles.includes('SuperAdmin')) {
    return undefined;
  }

  // Check if this admin is a leader of any UG
  const leaderUGs = ugs.filter(ug => ug.leaderId === adminUserId);

  if (leaderUGs.length > 0) {
    // Leader Admin: sees only their responsible UGs
    return leaderUGs.map(ug => ug.name);
  }

  // Non-Leader Admin: sees UGs with no leader assigned
  const noLeaderUGs = ugs.filter(ug => !ug.leaderId);
  return noLeaderUGs.map(ug => ug.name);
}

// ─── Utility ───────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
