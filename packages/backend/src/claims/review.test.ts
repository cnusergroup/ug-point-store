import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewClaim, ReviewClaimInput, listAllClaims } from './review';
import { ErrorCodes } from '@points-mall/shared';

const CLAIMS_TABLE = 'Claims';
const USERS_TABLE = 'Users';
const POINTS_RECORDS_TABLE = 'PointsRecords';
const TABLES = { claimsTable: CLAIMS_TABLE, usersTable: USERS_TABLE, pointsRecordsTable: POINTS_RECORDS_TABLE };

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makePendingClaim(overrides: Record<string, any> = {}) {
  return {
    claimId: 'claim-001',
    userId: 'user-001',
    applicantNickname: 'TestUser',
    applicantRole: 'Speaker',
    title: '社区分享活动',
    description: '在社区进行了一次技术分享',
    imageUrls: [],
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApproveInput(overrides: Partial<ReviewClaimInput> = {}): ReviewClaimInput {
  return {
    claimId: 'claim-001',
    reviewerId: 'admin-001',
    action: 'approve',
    awardedPoints: 500,
    ...overrides,
  };
}

function makeRejectInput(overrides: Partial<ReviewClaimInput> = {}): ReviewClaimInput {
  return {
    claimId: 'claim-001',
    reviewerId: 'admin-001',
    action: 'reject',
    rejectReason: '证明材料不足',
    ...overrides,
  };
}

describe('reviewClaim', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --- Approve success ---

  it('should approve claim successfully with correct points awarded', async () => {
    // GetCommand returns pending claim
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    // GetCommand returns user points
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });
    // TransactWriteCommand succeeds
    client.send.mockResolvedValueOnce({});

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 200 }), client, TABLES);

    expect(result.success).toBe(true);
    expect(result.claim?.status).toBe('approved');
    expect(result.claim?.awardedPoints).toBe(200);
    expect(result.claim?.reviewerId).toBe('admin-001');
    expect(result.claim?.reviewedAt).toBeDefined();
  });

  it('should call TransactWriteCommand with 3 items on approve', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });
    client.send.mockResolvedValueOnce({});

    await reviewClaim(makeApproveInput({ awardedPoints: 300 }), client, TABLES);

    // 3 calls: GetCommand(claim), GetCommand(user), TransactWriteCommand
    expect(client.send).toHaveBeenCalledTimes(3);
    const txCmd = client.send.mock.calls[2][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');
    expect(txCmd.input.TransactItems).toHaveLength(3);

    // Verify the 3 transaction items
    const [claimUpdate, userUpdate, pointsRecord] = txCmd.input.TransactItems;
    expect(claimUpdate.Update.TableName).toBe(CLAIMS_TABLE);
    expect(userUpdate.Update.TableName).toBe(USERS_TABLE);
    expect(pointsRecord.Put.TableName).toBe(POINTS_RECORDS_TABLE);
    expect(pointsRecord.Put.Item.type).toBe('earn');
    expect(pointsRecord.Put.Item.amount).toBe(300);
    expect(pointsRecord.Put.Item.balanceAfter).toBe(400); // 100 + 300
  });

  // --- Reject success ---

  it('should reject claim successfully with rejectReason stored', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({});

    const result = await reviewClaim(makeRejectInput({ rejectReason: '材料不完整' }), client, TABLES);

    expect(result.success).toBe(true);
    expect(result.claim?.status).toBe('rejected');
    expect(result.claim?.rejectReason).toBe('材料不完整');
    expect(result.claim?.reviewerId).toBe('admin-001');
    expect(result.claim?.reviewedAt).toBeDefined();
  });

  it('should call UpdateCommand on reject', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({});

    await reviewClaim(makeRejectInput(), client, TABLES);

    // 2 calls: GetCommand(claim), UpdateCommand
    expect(client.send).toHaveBeenCalledTimes(2);
    const updateCmd = client.send.mock.calls[1][0];
    expect(updateCmd.constructor.name).toBe('UpdateCommand');
    expect(updateCmd.input.TableName).toBe(CLAIMS_TABLE);
  });

  // --- Claim not found ---

  it('should return CLAIM_NOT_FOUND when claim does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await reviewClaim(makeApproveInput(), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_NOT_FOUND);
  });

  // --- Claim already reviewed ---

  it('should return CLAIM_ALREADY_REVIEWED when claim is approved', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim({ status: 'approved' }) });

    const result = await reviewClaim(makeApproveInput(), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_ALREADY_REVIEWED);
  });

  it('should return CLAIM_ALREADY_REVIEWED when claim is rejected', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim({ status: 'rejected' }) });

    const result = await reviewClaim(makeRejectInput(), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_ALREADY_REVIEWED);
  });

  // --- Invalid awardedPoints ---

  it('should return INVALID_POINTS_AMOUNT when awardedPoints is 0', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 0 }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_POINTS_AMOUNT);
  });

  it('should return INVALID_POINTS_AMOUNT when awardedPoints is negative', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeApproveInput({ awardedPoints: -5 }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_POINTS_AMOUNT);
  });

  it('should return INVALID_POINTS_AMOUNT when awardedPoints exceeds 10000', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 10001 }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_POINTS_AMOUNT);
  });

  it('should return INVALID_POINTS_AMOUNT when awardedPoints is non-integer', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 99.5 }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_POINTS_AMOUNT);
  });

  it('should accept awardedPoints at boundary 1', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });
    client.send.mockResolvedValueOnce({});

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 1 }), client, TABLES);

    expect(result.success).toBe(true);
    expect(result.claim?.awardedPoints).toBe(1);
  });

  it('should accept awardedPoints at boundary 10000', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({ Item: { points: 100 } });
    client.send.mockResolvedValueOnce({});

    const result = await reviewClaim(makeApproveInput({ awardedPoints: 10000 }), client, TABLES);

    expect(result.success).toBe(true);
    expect(result.claim?.awardedPoints).toBe(10000);
  });

  // --- Invalid rejectReason ---

  it('should return INVALID_REJECT_REASON when rejectReason is empty', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeRejectInput({ rejectReason: '' }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REJECT_REASON);
  });

  it('should return INVALID_REJECT_REASON when rejectReason exceeds 500 chars', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeRejectInput({ rejectReason: 'a'.repeat(501) }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REJECT_REASON);
  });

  it('should accept rejectReason at exactly 500 chars', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });
    client.send.mockResolvedValueOnce({});

    const result = await reviewClaim(makeRejectInput({ rejectReason: 'a'.repeat(500) }), client, TABLES);

    expect(result.success).toBe(true);
    expect(result.claim?.rejectReason).toBe('a'.repeat(500));
  });

  it('should return INVALID_REJECT_REASON when rejectReason is undefined', async () => {
    client.send.mockResolvedValueOnce({ Item: makePendingClaim() });

    const result = await reviewClaim(makeRejectInput({ rejectReason: undefined }), client, TABLES);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_REJECT_REASON);
  });
});


describe('listAllClaims', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  // --- Query with status uses GSI ---

  it('should use GSI status-createdAt-index when status is provided', async () => {
    client.send.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });

    await listAllClaims({ status: 'pending' }, client, CLAIMS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('QueryCommand');
    expect(cmd.input.TableName).toBe(CLAIMS_TABLE);
    expect(cmd.input.IndexName).toBe('status-createdAt-index');
    expect(cmd.input.KeyConditionExpression).toBe('#st = :status');
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  // --- Query without status uses Scan ---

  it('should use Scan when status is not provided', async () => {
    client.send.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });

    await listAllClaims({}, client, CLAIMS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('ScanCommand');
    expect(cmd.input.TableName).toBe(CLAIMS_TABLE);
  });

  // --- Default pageSize 20, cap at 100 ---

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listAllClaims({}, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listAllClaims({ pageSize: 200 }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(100);
  });

  it('should use custom pageSize when within range', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listAllClaims({ pageSize: 50 }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(50);
  });

  // --- Pagination with lastKey ---

  it('should return lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { claimId: 'c2', status: 'pending', createdAt: '2024-01-01T00:00:00Z' };
    client.send.mockResolvedValue({ Items: [], LastEvaluatedKey: lastEvalKey });

    const result = await listAllClaims({ status: 'pending' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should pass ExclusiveStartKey when lastKey is provided', async () => {
    const lastEvalKey = { claimId: 'c2', status: 'pending', createdAt: '2024-01-01T00:00:00Z' };
    const encodedKey = Buffer.from(JSON.stringify(lastEvalKey)).toString('base64');
    client.send.mockResolvedValue({ Items: [] });

    await listAllClaims({ status: 'pending', lastKey: encodedKey }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toEqual(lastEvalKey);
  });

  // --- Invalid lastKey ---

  it('should return error for invalid lastKey', async () => {
    const result = await listAllClaims({ lastKey: 'not-valid-base64!!' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
    expect(client.send).not.toHaveBeenCalled();
  });

  // --- Empty results ---

  it('should return empty claims array when no items found', async () => {
    client.send.mockResolvedValue({ Items: undefined });

    const result = await listAllClaims({}, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.claims).toEqual([]);
  });

  it('should return empty claims array when Items is empty with status filter', async () => {
    client.send.mockResolvedValue({ Items: [] });

    const result = await listAllClaims({ status: 'approved' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.claims).toEqual([]);
    expect(result.lastKey).toBeUndefined();
  });

  // --- Scan results sorted by createdAt descending ---

  it('should sort scan results by createdAt descending', async () => {
    const items = [
      { claimId: 'c1', createdAt: '2024-01-01T00:00:00Z' },
      { claimId: 'c3', createdAt: '2024-01-03T00:00:00Z' },
      { claimId: 'c2', createdAt: '2024-01-02T00:00:00Z' },
    ];
    client.send.mockResolvedValue({ Items: items });

    const result = await listAllClaims({}, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.claims![0].claimId).toBe('c3');
    expect(result.claims![1].claimId).toBe('c2');
    expect(result.claims![2].claimId).toBe('c1');
  });
});
