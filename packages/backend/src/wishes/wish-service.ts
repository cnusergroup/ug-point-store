import crypto from 'node:crypto';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ErrorCodes, ErrorMessages, type WishListItem, type WishRecord, type WishStatus, type MyWishListItem } from '@points-mall/shared';
import type { FeatureToggles } from '../settings/feature-toggles';
import { validateWishTitle, validateWishDescription, validateCloseReason, isValidStatusTransition } from './wish-validators';
import { sendWishAdoptedEmail, sendWishFulfilledEmail, sendWishRejectedEmail } from '../email/notifications';
import type { NotificationContext } from '../email/notifications';

// ---- Constants ----

/** Maximum wishes a user can submit per UTC month */
const MONTHLY_WISH_LIMIT = 3;

// ---- Interfaces ----

export interface CreateWishInput {
  userId: string;
  title: string;        // 1-50 chars
  description: string;  // 1-500 chars
  imageUrl?: string;
}

export interface CreateWishResult {
  success: boolean;
  wish?: WishRecord;
  error?: { code: string; message: string };
}

export interface VoteWishResult {
  success: boolean;
  error?: { code: string; message: string };
}

export interface WishServiceTables {
  wishesTable: string;
  wishVotesTable: string;
  usersTable?: string;
  pointsRecordsTable?: string;
}

export interface UpdateWishStatusInput {
  wishId: string;
  targetStatus: 'adopted' | 'fulfilled' | 'closed';
  operatorId: string;
  productId?: string;     // required when targetStatus = 'fulfilled'
  closeReason?: string;   // required when targetStatus = 'closed'
}

export interface UpdateWishStatusResult {
  success: boolean;
  error?: { code: string; message: string };
}

// ---- Core Functions ----

/**
 * Get the number of wishes a user has submitted in the current UTC month.
 * Queries UserWishIndex GSI (PK: userId, SK: createdAt) with a range filter
 * for createdAt >= first day of current UTC month.
 */
export async function getMonthlyWishCount(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
): Promise<number> {
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tables.wishesTable,
      IndexName: 'UserWishIndex',
      KeyConditionExpression: 'userId = :uid AND createdAt >= :monthStart',
      ExpressionAttributeValues: {
        ':uid': userId,
        ':monthStart': monthStart,
      },
      Select: 'COUNT',
    }),
  );

  return result.Count ?? 0;
}

/**
 * Create a new wish.
 *
 * Checks:
 * 1. wishPoolEnabled feature toggle
 * 2. Input validation (title, description)
 * 3. Monthly wish limit (3 per user per UTC month)
 *
 * On success, writes a new WishRecord to WishesTable with status=pending, voteCount=0.
 */
export async function createWish(
  input: CreateWishInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
  featureToggles: FeatureToggles,
): Promise<CreateWishResult> {
  // 1. Check feature toggle
  if (!featureToggles.wishPoolEnabled) {
    return {
      success: false,
      error: { code: ErrorCodes.FEATURE_DISABLED, message: ErrorMessages[ErrorCodes.FEATURE_DISABLED] },
    };
  }

  // 2. Validate title
  if (!validateWishTitle(input.title)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_WISH_TITLE, message: ErrorMessages[ErrorCodes.INVALID_WISH_TITLE] },
    };
  }

  // 3. Validate description
  if (!validateWishDescription(input.description)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_WISH_DESCRIPTION, message: ErrorMessages[ErrorCodes.INVALID_WISH_DESCRIPTION] },
    };
  }

  // 4. Check monthly limit
  const monthlyCount = await getMonthlyWishCount(input.userId, dynamoClient, tables);
  if (monthlyCount >= MONTHLY_WISH_LIMIT) {
    return {
      success: false,
      error: { code: ErrorCodes.MONTHLY_LIMIT_EXCEEDED, message: ErrorMessages[ErrorCodes.MONTHLY_LIMIT_EXCEEDED] },
    };
  }

  // 5. Create wish record
  const now = new Date().toISOString();
  const wish: WishRecord = {
    wishId: crypto.randomUUID(),
    userId: input.userId,
    title: input.title.trim(),
    description: input.description.trim(),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    status: 'pending',
    voteCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: tables.wishesTable,
      Item: wish,
    }),
  );

  return { success: true, wish };
}


/**
 * Vote for a wish.
 *
 * Checks:
 * 1. wishPoolEnabled feature toggle
 * 2. Wish exists
 * 3. Voter is not the wish author
 * 4. Wish status is 'approved'
 * 5. Atomic transaction: PutItem to WishVotesTable + UpdateItem WishesTable (voteCount + 1)
 *
 * Uses TransactWriteItems for atomicity. Catches TransactionCanceledException
 * to detect duplicate votes (PutItem condition failure).
 */
export async function voteWish(
  wishId: string,
  voterId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
  featureToggles: FeatureToggles,
): Promise<VoteWishResult> {
  // 1. Check feature toggle
  if (!featureToggles.wishPoolEnabled) {
    return {
      success: false,
      error: { code: ErrorCodes.FEATURE_DISABLED, message: ErrorMessages[ErrorCodes.FEATURE_DISABLED] },
    };
  }

  // 2. Fetch wish
  const wishResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
    }),
  );

  if (!wishResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_FOUND, message: ErrorMessages[ErrorCodes.WISH_NOT_FOUND] },
    };
  }

  const wish = wishResult.Item as WishRecord;

  // 3. Check voter is not the wish author
  if (wish.userId === voterId) {
    return {
      success: false,
      error: { code: ErrorCodes.CANNOT_VOTE_OWN_WISH, message: ErrorMessages[ErrorCodes.CANNOT_VOTE_OWN_WISH] },
    };
  }

  // 4. Check wish status is 'approved'
  if (wish.status !== 'approved') {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_VOTABLE, message: ErrorMessages[ErrorCodes.WISH_NOT_VOTABLE] },
    };
  }

  // 5. Atomic transaction: write vote record + increment voteCount
  const now = new Date().toISOString();

  try {
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // a. Put vote record (condition prevents duplicate votes)
          {
            Put: {
              TableName: tables.wishVotesTable,
              Item: {
                wishId,
                voterId,
                createdAt: now,
              },
              ConditionExpression: 'attribute_not_exists(wishId) AND attribute_not_exists(voterId)',
            },
          },
          // b. Increment voteCount on WishesTable (condition ensures wish is still approved)
          {
            Update: {
              TableName: tables.wishesTable,
              Key: { wishId },
              UpdateExpression: 'SET voteCount = voteCount + :one, updatedAt = :now',
              ExpressionAttributeValues: {
                ':one': 1,
                ':now': now,
                ':approved': 'approved',
              },
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ConditionExpression: '#status = :approved',
            },
          },
        ],
      }),
    );
  } catch (err: any) {
    // TransactionCanceledException: check if first item (PutItem) failed → duplicate vote
    if (err.name === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons ?? [];
      if (reasons.length > 0 && reasons[0]?.Code === 'ConditionalCheckFailed') {
        return {
          success: false,
          error: { code: ErrorCodes.ALREADY_VOTED, message: ErrorMessages[ErrorCodes.ALREADY_VOTED] },
        };
      }
    }
    throw err;
  }

  return { success: true };
}


/**
 * Review a wish (pending → approved or pending → closed).
 *
 * - action=approve: update status to approved
 * - action=reject: validate closeReason, update status to closed with closeReason, send rejection email (best-effort)
 */
export async function reviewWish(
  wishId: string,
  action: 'approve' | 'reject',
  closeReason: string | undefined,
  operatorId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
  notificationCtx?: NotificationContext,
): Promise<UpdateWishStatusResult> {
  // 1. Fetch the wish
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
    }),
  );

  const wish = getResult.Item as WishRecord | undefined;
  if (!wish) {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_FOUND, message: ErrorMessages[ErrorCodes.WISH_NOT_FOUND] },
    };
  }

  // 2. Validate status is pending
  if (wish.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages[ErrorCodes.INVALID_STATUS_TRANSITION] },
    };
  }

  const now = new Date().toISOString();

  // 3. Handle approve
  if (action === 'approve') {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.wishesTable,
        Key: { wishId },
        UpdateExpression: 'SET #status = :approved, updatedAt = :now',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'approved',
          ':pending': 'pending',
          ':now': now,
        },
      }),
    );

    return { success: true };
  }

  // 4. Handle reject
  if (!closeReason || !validateCloseReason(closeReason)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_CLOSE_REASON, message: ErrorMessages[ErrorCodes.INVALID_CLOSE_REASON] },
    };
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
      UpdateExpression: 'SET #status = :closed, closeReason = :reason, updatedAt = :now',
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':closed': 'closed',
        ':pending': 'pending',
        ':reason': closeReason.trim(),
        ':now': now,
      },
    }),
  );

  // Send rejection email (best-effort)
  try {
    if (notificationCtx) {
      await sendWishRejectedEmail(notificationCtx, wish.userId, wish.title, closeReason);
    }
  } catch {
    // Email failure is non-blocking
  }

  return { success: true };
}

/**
 * Update wish status for subsequent transitions (approved → adopted, adopted → fulfilled, any → closed).
 *
 * - For fulfilled: require productId, use TransactWriteItems (update wish + award points + create PointsRecord),
 *   set priorityPurchase=true, send fulfilled email (best-effort)
 * - For adopted: update status, send adopted email (best-effort)
 * - For closed: require closeReason, update status with closeReason
 */
export async function updateWishStatus(
  input: UpdateWishStatusInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
  featureToggles: FeatureToggles,
  notificationCtx?: NotificationContext,
): Promise<UpdateWishStatusResult> {
  // 1. Fetch the wish
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.wishesTable,
      Key: { wishId: input.wishId },
    }),
  );

  const wish = getResult.Item as WishRecord | undefined;
  if (!wish) {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_FOUND, message: ErrorMessages[ErrorCodes.WISH_NOT_FOUND] },
    };
  }

  // 2. Validate status transition
  if (!isValidStatusTransition(wish.status, input.targetStatus)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages[ErrorCodes.INVALID_STATUS_TRANSITION] },
    };
  }

  const now = new Date().toISOString();

  // 3. Handle fulfilled transition
  if (input.targetStatus === 'fulfilled') {
    if (!input.productId) {
      return {
        success: false,
        error: { code: 'PRODUCT_ID_REQUIRED', message: '上架操作需要关联商品 ID' },
      };
    }

    const usersTable = tables.usersTable || process.env.USERS_TABLE || '';
    const pointsRecordsTable = tables.pointsRecordsTable || process.env.POINTS_RECORDS_TABLE || '';
    const rewardPoints = featureToggles.wishFulfilledRewardPoints;
    const recordId = ulid();

    // Get current user points for balanceAfter calculation
    const userResult = await dynamoClient.send(
      new GetCommand({
        TableName: usersTable,
        Key: { userId: wish.userId },
        ProjectionExpression: 'points',
      }),
    );
    const currentPoints = (userResult.Item?.points as number) ?? 0;
    const newBalance = currentPoints + rewardPoints;

    // Atomic transaction: update wish status + award points + create PointsRecord
    await dynamoClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // a. Update WishesTable: status=fulfilled, productId, priorityPurchase=true
          {
            Update: {
              TableName: tables.wishesTable,
              Key: { wishId: input.wishId },
              UpdateExpression: 'SET #status = :fulfilled, productId = :pid, priorityPurchase = :pp, updatedAt = :now',
              ConditionExpression: '#status = :currentStatus',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':fulfilled': 'fulfilled',
                ':currentStatus': wish.status,
                ':pid': input.productId,
                ':pp': true,
                ':now': now,
              },
            },
          },
          // b. Update UsersTable: increment points
          {
            Update: {
              TableName: usersTable,
              Key: { userId: wish.userId },
              UpdateExpression: 'SET points = points + :reward, updatedAt = :now',
              ExpressionAttributeValues: {
                ':reward': rewardPoints,
                ':now': now,
              },
            },
          },
          // c. Put PointsRecordsTable: create points record
          {
            Put: {
              TableName: pointsRecordsTable,
              Item: {
                recordId,
                userId: wish.userId,
                type: 'earn',
                amount: rewardPoints,
                source: '许愿池奖励',
                balanceAfter: newBalance,
                createdAt: now,
              },
            },
          },
        ],
      }),
    );

    // Send fulfilled email (best-effort)
    try {
      if (notificationCtx) {
        await sendWishFulfilledEmail(notificationCtx, wish.userId, wish.title, input.productId!);
      }
    } catch {
      // Email failure is non-blocking
    }

    return { success: true };
  }

  // 4. Handle adopted transition
  if (input.targetStatus === 'adopted') {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.wishesTable,
        Key: { wishId: input.wishId },
        UpdateExpression: 'SET #status = :adopted, updatedAt = :now',
        ConditionExpression: '#status = :currentStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':adopted': 'adopted',
          ':currentStatus': wish.status,
          ':now': now,
        },
      }),
    );

    // Send adopted email (best-effort)
    try {
      // TODO: Implement in task 9.1 — sendWishAdoptedEmail(ctx, wish.userId, wish.title)
    } catch {
      // Email failure is non-blocking
    }

    return { success: true };
  }

  // 5. Handle closed transition
  if (input.targetStatus === 'closed') {
    if (!input.closeReason || !validateCloseReason(input.closeReason)) {
      return {
        success: false,
        error: { code: ErrorCodes.INVALID_CLOSE_REASON, message: ErrorMessages[ErrorCodes.INVALID_CLOSE_REASON] },
      };
    }

    await dynamoClient.send(
      new UpdateCommand({
        TableName: tables.wishesTable,
        Key: { wishId: input.wishId },
        UpdateExpression: 'SET #status = :closed, closeReason = :reason, updatedAt = :now',
        ConditionExpression: '#status = :currentStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':closed': 'closed',
          ':currentStatus': wish.status,
          ':reason': input.closeReason.trim(),
          ':now': now,
        },
      }),
    );

    return { success: true };
  }

  // Should not reach here given valid targetStatus values
  return {
    success: false,
    error: { code: ErrorCodes.INVALID_STATUS_TRANSITION, message: ErrorMessages[ErrorCodes.INVALID_STATUS_TRANSITION] },
  };
}


// ---- List / My Wishes / Update / Delete Interfaces ----

export interface ListWishesInput {
  status?: WishStatus[];
  sortBy: 'votes' | 'time';
  page: number;
  pageSize: number;
  currentUserId?: string;
}

export interface ListWishesResult {
  success: boolean;
  wishes?: WishListItem[];
  total?: number;
  error?: { code: string; message: string };
}

export interface MyWishesResult {
  success: boolean;
  wishes?: MyWishListItem[];
  remainingWishes?: number;
  total?: number;
  error?: { code: string; message: string };
}

export interface UpdateWishResult {
  success: boolean;
  wish?: WishRecord;
  error?: { code: string; message: string };
}

export interface DeleteWishResult {
  success: boolean;
  error?: { code: string; message: string };
}

// ---- Utility ----

/** Split an array into chunks of the given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---- List / My Wishes / Update / Delete Functions ----

/**
 * List wishes visible to the community.
 *
 * Queries StatusVoteIndex GSI for each visible status (approved, adopted, fulfilled by default).
 * Supports sorting by 'votes' (descending voteCount) or 'time' (descending createdAt).
 * Supports offset-based pagination (page, pageSize).
 * If currentUserId is provided, batch-checks WishVotesTable to mark hasVoted.
 */
export async function listWishes(
  input: ListWishesInput,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
): Promise<ListWishesResult> {
  const visibleStatuses: WishStatus[] = input.status ?? ['approved', 'adopted', 'fulfilled'];
  const { sortBy, page, pageSize, currentUserId } = input;

  // 1. Query each visible status from StatusVoteIndex
  const allWishes: WishRecord[] = [];

  for (const status of visibleStatuses) {
    let lastEvaluatedKey: Record<string, any> | undefined;
    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: tables.wishesTable,
          IndexName: 'StatusVoteIndex',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
          ScanIndexForward: false, // descending by sort key (voteCount)
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
      const items = (result.Items ?? []) as WishRecord[];
      allWishes.push(...items);
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  // 2. Sort merged results
  if (sortBy === 'votes') {
    allWishes.sort((a, b) => b.voteCount - a.voteCount);
  } else {
    // sort by time (createdAt descending)
    allWishes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // 3. Pagination (offset-based)
  const total = allWishes.length;
  const startIndex = (page - 1) * pageSize;
  const pagedWishes = allWishes.slice(startIndex, startIndex + pageSize);

  // 4. Mark hasVoted if currentUserId provided
  let wishListItems: WishListItem[];

  if (currentUserId && pagedWishes.length > 0) {
    // Batch-check WishVotesTable for each wish
    const voteChecks = new Map<string, boolean>();
    const chunks = chunkArray(pagedWishes, 100);

    for (const chunk of chunks) {
      const keys = chunk.map(w => ({ wishId: w.wishId, voterId: currentUserId }));
      const batchResult = await dynamoClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tables.wishVotesTable]: {
              Keys: keys,
              ProjectionExpression: 'wishId',
            },
          },
        }),
      );
      const items = batchResult.Responses?.[tables.wishVotesTable] ?? [];
      for (const item of items) {
        voteChecks.set(item.wishId as string, true);
      }
    }

    wishListItems = pagedWishes.map(w => ({
      ...w,
      hasVoted: voteChecks.has(w.wishId),
    }));
  } else {
    wishListItems = pagedWishes.map(w => ({ ...w, hasVoted: false }));
  }

  return { success: true, wishes: wishListItems, total };
}

/**
 * Get the current user's wishes.
 *
 * Queries UserWishIndex GSI by userId, sorted by createdAt descending.
 * Calculates remainingWishes = 3 - monthly count.
 */
export async function getMyWishes(
  userId: string,
  page: number,
  pageSize: number,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
): Promise<MyWishesResult> {
  // 1. Query all wishes for this user (UserWishIndex: PK=userId, SK=createdAt)
  const allWishes: WishRecord[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.wishesTable,
        IndexName: 'UserWishIndex',
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false, // descending createdAt
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    const items = (result.Items ?? []) as WishRecord[];
    allWishes.push(...items);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // 2. Pagination
  const total = allWishes.length;
  const startIndex = (page - 1) * pageSize;
  const pagedWishes = allWishes.slice(startIndex, startIndex + pageSize);

  // 3. Calculate remainingWishes (3 - current month count)
  const monthlyCount = await getMonthlyWishCount(userId, dynamoClient, tables);
  const remainingWishes = Math.max(0, MONTHLY_WISH_LIMIT - monthlyCount);

  // 4. Map to MyWishListItem
  const wishes: MyWishListItem[] = pagedWishes.map(w => ({
    ...w,
    remainingWishes,
  }));

  return { success: true, wishes, remainingWishes, total };
}

/**
 * Update a wish (title, description, imageUrl).
 *
 * Only the wish author can update, and only when status is 'pending'.
 */
export async function updateWish(
  wishId: string,
  userId: string,
  updates: { title?: string; description?: string; imageUrl?: string },
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
): Promise<UpdateWishResult> {
  // 1. Fetch wish
  const wishResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
    }),
  );

  if (!wishResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_FOUND, message: ErrorMessages[ErrorCodes.WISH_NOT_FOUND] },
    };
  }

  const wish = wishResult.Item as WishRecord;

  // 2. Check userId matches (authorization)
  if (wish.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: ErrorMessages[ErrorCodes.FORBIDDEN] },
    };
  }

  // 3. Check status is pending
  if (wish.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_EDITABLE, message: ErrorMessages[ErrorCodes.WISH_NOT_EDITABLE] },
    };
  }

  // 4. Validate updated fields
  if (updates.title !== undefined && !validateWishTitle(updates.title)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_WISH_TITLE, message: ErrorMessages[ErrorCodes.INVALID_WISH_TITLE] },
    };
  }

  if (updates.description !== undefined && !validateWishDescription(updates.description)) {
    return {
      success: false,
      error: { code: ErrorCodes.INVALID_WISH_DESCRIPTION, message: ErrorMessages[ErrorCodes.INVALID_WISH_DESCRIPTION] },
    };
  }

  // 5. Build update expression
  const now = new Date().toISOString();
  const expressionParts: string[] = ['#updatedAt = :now'];
  const expressionNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionValues: Record<string, any> = { ':now': now };

  if (updates.title !== undefined) {
    expressionParts.push('#title = :title');
    expressionNames['#title'] = 'title';
    expressionValues[':title'] = updates.title.trim();
  }

  if (updates.description !== undefined) {
    expressionParts.push('#description = :description');
    expressionNames['#description'] = 'description';
    expressionValues[':description'] = updates.description.trim();
  }

  if (updates.imageUrl !== undefined) {
    expressionParts.push('#imageUrl = :imageUrl');
    expressionNames['#imageUrl'] = 'imageUrl';
    expressionValues[':imageUrl'] = updates.imageUrl;
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  // Return updated wish
  const updatedWish: WishRecord = {
    ...wish,
    ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
    ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
    ...(updates.imageUrl !== undefined ? { imageUrl: updates.imageUrl } : {}),
    updatedAt: now,
  };

  return { success: true, wish: updatedWish };
}

/**
 * Delete a wish (physical delete).
 *
 * Only the wish author can delete, and only when status is 'pending'.
 * Physical delete releases the monthly quota.
 */
export async function deleteWish(
  wishId: string,
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: WishServiceTables,
): Promise<DeleteWishResult> {
  // 1. Fetch wish
  const wishResult = await dynamoClient.send(
    new GetCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
    }),
  );

  if (!wishResult.Item) {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_FOUND, message: ErrorMessages[ErrorCodes.WISH_NOT_FOUND] },
    };
  }

  const wish = wishResult.Item as WishRecord;

  // 2. Check userId matches (authorization)
  if (wish.userId !== userId) {
    return {
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: ErrorMessages[ErrorCodes.FORBIDDEN] },
    };
  }

  // 3. Check status is pending
  if (wish.status !== 'pending') {
    return {
      success: false,
      error: { code: ErrorCodes.WISH_NOT_DELETABLE, message: ErrorMessages[ErrorCodes.WISH_NOT_DELETABLE] },
    };
  }

  // 4. Physical delete
  await dynamoClient.send(
    new DeleteCommand({
      TableName: tables.wishesTable,
      Key: { wishId },
    }),
  );

  return { success: true };
}
