import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reviewReservation,
  ReviewReservationInput,
  listReservationApprovals,
  getVisibleUGNames,
  UGRecord,
} from './reservation-approval';
import { ErrorCodes } from '@points-mall/shared';

const RESERVATIONS_TABLE = 'ContentReservations';
const CONTENT_ITEMS_TABLE = 'ContentItems';
const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';

const REVIEW_TABLES = {
  reservationsTable: RESERVATIONS_TABLE,
  contentItemsTable: CONTENT_ITEMS_TABLE,
  usersTable: USERS_TABLE,
  pointsRecordsTable: POINTS_RECORDS_TABLE,
};

const LIST_TABLES = {
  reservationsTable: RESERVATIONS_TABLE,
  contentItemsTable: CONTENT_ITEMS_TABLE,
  usersTable: USERS_TABLE,
};

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makePendingReservation(overrides: Record<string, any> = {}) {
  return {
    pk: 'user-1#content-1',
    userId: 'user-1',
    contentId: 'content-1',
    activityId: 'activity-1',
    activityType: '线上活动',
    activityUG: 'UG-Test',
    activityTopic: 'Test Topic',
    activityDate: '2024-06-15',
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApproveInput(overrides: Partial<ReviewReservationInput> = {}): ReviewReservationInput {
  return {
    pk: 'user-1#content-1',
    reviewerId: 'admin-001',
    action: 'approve',
    ...overrides,
  };
}

function makeRejectInput(overrides: Partial<ReviewReservationInput> = {}): ReviewReservationInput {
  return {
    pk: 'user-1#content-1',
    reviewerId: 'admin-001',
    action: 'reject',
    ...overrides,
  };
}

// ─── reviewReservation tests ───────────────────────────────

describe('reviewReservation', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --- Approve success ---

  it('should approve reservation with atomic points award', async () => {
    // GetCommand: reservation
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    // GetCommand: content item (for uploaderId)
    client.send.mockResolvedValueOnce({ Item: { contentId: 'content-1', uploaderId: 'uploader-1' } });
    // GetCommand: reserver nickname
    client.send.mockResolvedValueOnce({ Item: { nickname: 'Reserver' } });
    // GetCommand: user points
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(5);

    // Verify TransactWriteCommand has 3 items
    const txCmd = client.send.mock.calls[4][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    expect(txCmd.input.TransactItems).toHaveLength(3);

    const [reservationUpdate, userUpdate, pointsRecord] = txCmd.input.TransactItems;

    // a. Reservation status update
    expect(reservationUpdate.Update.TableName).toBe(RESERVATIONS_TABLE);
    expect(reservationUpdate.Update.ExpressionAttributeValues[':approved']).toBe('approved');
    expect(reservationUpdate.Update.ExpressionAttributeValues[':rid']).toBe('admin-001');
    expect(reservationUpdate.Update.ConditionExpression).toBe('#s = :pending');

    // b. User points update
    expect(userUpdate.Update.TableName).toBe(USERS_TABLE);
    expect(userUpdate.Update.Key).toEqual({ userId: 'uploader-1' });
    expect(userUpdate.Update.ExpressionAttributeValues[':pv']).toBe(10);

    // c. Points record
    expect(pointsRecord.Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(pointsRecord.Put.Item.userId).toBe('uploader-1');
    expect(pointsRecord.Put.Item.type).toBe('earn');
    expect(pointsRecord.Put.Item.amount).toBe(10);
    expect(pointsRecord.Put.Item.balanceAfter).toBe(110);
    expect(pointsRecord.Put.Item.source).toBe('预约审批:Reserver|UG-Test|Test Topic|2024-06-15|');
    expect(pointsRecord.Put.Item.activityId).toBe('activity-1');
    expect(pointsRecord.Put.Item.activityType).toBe('线上活动');
    expect(pointsRecord.Put.Item.activityUG).toBe('UG-Test');
    expect(pointsRecord.Put.Item.activityTopic).toBe('Test Topic');
    expect(pointsRecord.Put.Item.activityDate).toBe('2024-06-15');
    expect(pointsRecord.Put.Item.targetRole).toBe('Speaker');
  });

  // --- Reject success ---

  it('should reject reservation without points award', async () => {
    // GetCommand: reservation
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    // TransactWriteCommand
    client.send.mockResolvedValueOnce({});

    const result = await reviewReservation(makeRejectInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);

    const txCmd = client.send.mock.calls[1][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    expect(txCmd.input.TransactItems).toHaveLength(1);
    expect(txCmd.input.TransactItems[0].Update.ExpressionAttributeValues[':rejected']).toBe('rejected');
  });

  // --- Reservation not found ---

  it('should return error when reservation not found', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  // --- Already reviewed ---

  it('should return RESERVATION_ALREADY_REVIEWED when status is approved', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation({ status: 'approved' }) });

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESERVATION_ALREADY_REVIEWED);
  });

  it('should return RESERVATION_ALREADY_REVIEWED when status is rejected', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation({ status: 'rejected' }) });

    const result = await reviewReservation(makeRejectInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESERVATION_ALREADY_REVIEWED);
  });

  // --- Content not found during approve ---

  it('should return CONTENT_NOT_FOUND when content item missing during approve', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
  });

  // --- Concurrent review (TransactionCanceledException) ---

  it('should return RESERVATION_ALREADY_REVIEWED on concurrent approve', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    client.send.mockResolvedValueOnce({ Item: { contentId: 'content-1', uploaderId: 'uploader-1' } });
    // GetCommand: reserver nickname
    client.send.mockResolvedValueOnce({ Item: { nickname: 'Reserver' } });
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });

    const err: any = new Error('Transaction cancelled');
    err.name = 'TransactionCanceledException';
    client.send.mockRejectedValueOnce(err);

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.RESERVATION_ALREADY_REVIEWED);
  });

  // --- Zero initial points ---

  it('should handle uploader with zero initial points', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    client.send.mockResolvedValueOnce({ Item: { contentId: 'content-1', uploaderId: 'uploader-1' } });
    // GetCommand: reserver nickname
    client.send.mockResolvedValueOnce({ Item: { nickname: 'Reserver' } });
    client.send.mockResolvedValueOnce({ Item: { points: 0 } });
    client.send.mockResolvedValueOnce({});

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(true);

    const txCmd = client.send.mock.calls[4][0];
    const pointsRecord = txCmd.input.TransactItems[2].Put.Item;
    expect(pointsRecord.balanceAfter).toBe(10);
  });

  // --- Missing user points field ---

  it('should default to 0 when user has no points field', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingReservation() });
    client.send.mockResolvedValueOnce({ Item: { contentId: 'content-1', uploaderId: 'uploader-1' } });
    // GetCommand: reserver nickname
    client.send.mockResolvedValueOnce({ Item: { nickname: 'Reserver' } });
    client.send.mockResolvedValueOnce({ Item: {} }); // no points field
    client.send.mockResolvedValueOnce({});

    const result = await reviewReservation(makeApproveInput(), client, REVIEW_TABLES, 10);

    expect(result.success).toBe(true);
    const txCmd = client.send.mock.calls[4][0];
    const pointsRecord = txCmd.input.TransactItems[2].Put.Item;
    expect(pointsRecord.balanceAfter).toBe(10);
  });
});

// ─── listReservationApprovals tests ────────────────────────

describe('listReservationApprovals', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should use GSI when status is provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listReservationApprovals({ status: 'pending' }, client, LIST_TABLES);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('QueryCommand');
    expect(cmd.input.IndexName).toBe('status-createdAt-index');
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  it('should use Scan when status is not provided', async () => {
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listReservationApprovals({}, client, LIST_TABLES);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('ScanCommand');
  });

  it('should filter by ugNames', async () => {
    const items = [
      makePendingReservation({ pk: 'u1#c1', activityUG: 'UG-A', userId: 'u1', contentId: 'c1' }),
      makePendingReservation({ pk: 'u2#c2', activityUG: 'UG-B', userId: 'u2', contentId: 'c2' }),
      makePendingReservation({ pk: 'u3#c3', activityUG: 'UG-A', userId: 'u3', contentId: 'c3' }),
    ];
    // Scan
    client.send.mockResolvedValueOnce({ Items: items });
    // BatchGetCommand for content titles
    client.send.mockResolvedValueOnce({
      Responses: { [CONTENT_ITEMS_TABLE]: [
        { contentId: 'c1', title: 'Content A' },
        { contentId: 'c3', title: 'Content C' },
      ] },
    });
    // BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [
        { userId: 'u1', nickname: 'Alice' },
        { userId: 'u3', nickname: 'Charlie' },
      ] },
    });

    const result = await listReservationApprovals(
      { ugNames: ['UG-A'] },
      client,
      LIST_TABLES,
    );

    expect(result.success).toBe(true);
    expect(result.reservations).toHaveLength(2);
    expect(result.reservations!.every(r => r.activityUG === 'UG-A')).toBe(true);
  });

  it('should batch get content titles and user nicknames', async () => {
    const items = [
      makePendingReservation({ pk: 'u1#c1', userId: 'u1', contentId: 'c1' }),
    ];
    // Query/Scan
    client.send.mockResolvedValueOnce({ Items: items });
    // BatchGetCommand for content titles
    client.send.mockResolvedValueOnce({
      Responses: { [CONTENT_ITEMS_TABLE]: [{ contentId: 'c1', title: 'My Content' }] },
    });
    // BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [{ userId: 'u1', nickname: 'Alice' }] },
    });

    const result = await listReservationApprovals({}, client, LIST_TABLES);

    expect(result.success).toBe(true);
    expect(result.reservations![0].contentTitle).toBe('My Content');
    expect(result.reservations![0].reserverNickname).toBe('Alice');
  });

  it('should default pageSize to 20 and cap at 100', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listReservationApprovals({}, client, LIST_TABLES);
    expect(client.send.mock.calls[0][0].input.Limit).toBe(20);

    client.send.mockClear();
    client.send.mockResolvedValue({ Items: [] });
    await listReservationApprovals({ pageSize: 200 }, client, LIST_TABLES);
    expect(client.send.mock.calls[0][0].input.Limit).toBe(100);
  });

  it('should return error for invalid lastKey', async () => {
    const result = await listReservationApprovals(
      { lastKey: 'not-valid-base64!!' },
      client,
      LIST_TABLES,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
  });

  it('should return lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { pk: 'u1#c1', status: 'pending', createdAt: '2024-01-01T00:00:00Z' };
    client.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastEvalKey });

    const result = await listReservationApprovals({ status: 'pending' }, client, LIST_TABLES);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should sort scan results by createdAt descending', async () => {
    const items = [
      makePendingReservation({ pk: 'u1#c1', createdAt: '2024-01-01T00:00:00Z', userId: 'u1', contentId: 'c1' }),
      makePendingReservation({ pk: 'u3#c3', createdAt: '2024-01-03T00:00:00Z', userId: 'u3', contentId: 'c3' }),
      makePendingReservation({ pk: 'u2#c2', createdAt: '2024-01-02T00:00:00Z', userId: 'u2', contentId: 'c2' }),
    ];
    // Scan
    client.send.mockResolvedValueOnce({ Items: items });
    // BatchGetCommand for content titles
    client.send.mockResolvedValueOnce({
      Responses: { [CONTENT_ITEMS_TABLE]: [
        { contentId: 'c1', title: 'C1' },
        { contentId: 'c2', title: 'C2' },
        { contentId: 'c3', title: 'C3' },
      ] },
    });
    // BatchGetCommand for user nicknames
    client.send.mockResolvedValueOnce({
      Responses: { [USERS_TABLE]: [
        { userId: 'u1', nickname: 'U1' },
        { userId: 'u2', nickname: 'U2' },
        { userId: 'u3', nickname: 'U3' },
      ] },
    });

    const result = await listReservationApprovals({}, client, LIST_TABLES);

    expect(result.success).toBe(true);
    expect(result.reservations![0].pk).toBe('u3#c3');
    expect(result.reservations![1].pk).toBe('u2#c2');
    expect(result.reservations![2].pk).toBe('u1#c1');
  });
});

// ─── getVisibleUGNames tests ───────────────────────────────

describe('getVisibleUGNames', () => {
  const ugs: UGRecord[] = [
    { ugId: 'ug-1', name: 'UG-A', status: 'active', leaderId: 'admin-1' },
    { ugId: 'ug-2', name: 'UG-B', status: 'active', leaderId: 'admin-2' },
    { ugId: 'ug-3', name: 'UG-C', status: 'active' },
    { ugId: 'ug-4', name: 'UG-D', status: 'active' },
  ];

  it('SuperAdmin sees all (returns undefined)', () => {
    const result = getVisibleUGNames(['SuperAdmin'], 'admin-1', ugs);
    expect(result).toBeUndefined();
  });

  it('Leader Admin sees only their responsible UGs', () => {
    const result = getVisibleUGNames(['Admin'], 'admin-1', ugs);
    expect(result).toEqual(['UG-A']);
  });

  it('Non-Leader Admin sees UGs with no leader', () => {
    const result = getVisibleUGNames(['Admin'], 'admin-99', ugs);
    expect(result).toEqual(['UG-C', 'UG-D']);
  });

  it('Leader Admin with multiple UGs sees all their UGs', () => {
    const ugsMulti: UGRecord[] = [
      { ugId: 'ug-1', name: 'UG-A', status: 'active', leaderId: 'admin-1' },
      { ugId: 'ug-2', name: 'UG-B', status: 'active', leaderId: 'admin-1' },
      { ugId: 'ug-3', name: 'UG-C', status: 'active' },
    ];
    const result = getVisibleUGNames(['Admin'], 'admin-1', ugsMulti);
    expect(result).toEqual(['UG-A', 'UG-B']);
  });

  it('Non-Leader Admin with all UGs having leaders sees empty array', () => {
    const ugsAllLeaders: UGRecord[] = [
      { ugId: 'ug-1', name: 'UG-A', status: 'active', leaderId: 'admin-1' },
      { ugId: 'ug-2', name: 'UG-B', status: 'active', leaderId: 'admin-2' },
    ];
    const result = getVisibleUGNames(['Admin'], 'admin-99', ugsAllLeaders);
    expect(result).toEqual([]);
  });
});
