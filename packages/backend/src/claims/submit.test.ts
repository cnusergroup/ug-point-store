import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitClaim, SubmitClaimInput, listMyClaims } from './submit';
import { ErrorCodes } from '@points-mall/shared';

const CLAIMS_TABLE = 'Claims';

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makeValidInput(overrides: Partial<SubmitClaimInput> = {}): SubmitClaimInput {
  return {
    userId: 'user-001',
    userRoles: ['Speaker'],
    userNickname: 'TestUser',
    title: '社区分享活动',
    description: '在社区进行了一次技术分享',
    ...overrides,
  };
}

describe('submitClaim', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
    client.send.mockResolvedValue({});
  });

  // --- Role validation ---

  it('should reject when user has no allowed role', async () => {
    const result = await submitClaim(
      makeValidInput({ userRoles: ['Admin', 'SuperAdmin'] }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_ROLE_NOT_ALLOWED);
  });

  it('should reject when user has empty roles', async () => {
    const result = await submitClaim(
      makeValidInput({ userRoles: [] }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_ROLE_NOT_ALLOWED);
  });

  it.each(['Speaker', 'UserGroupLeader', 'Volunteer'])(
    'should accept when user has role %s',
    async (role) => {
      const result = await submitClaim(
        makeValidInput({ userRoles: [role] }),
        client,
        CLAIMS_TABLE,
      );
      expect(result.success).toBe(true);
      expect(result.claim).toBeDefined();
    },
  );

  it('should accept when user has mixed roles including an allowed one', async () => {
    const result = await submitClaim(
      makeValidInput({ userRoles: ['Admin', 'Volunteer'] }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
  });

  // --- Title / Description validation ---

  it('should reject when title is empty', async () => {
    const result = await submitClaim(
      makeValidInput({ title: '' }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CLAIM_CONTENT);
  });

  it('should reject when title exceeds 100 characters', async () => {
    const result = await submitClaim(
      makeValidInput({ title: 'a'.repeat(101) }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CLAIM_CONTENT);
  });

  it('should accept title at exactly 100 characters', async () => {
    const result = await submitClaim(
      makeValidInput({ title: 'a'.repeat(100) }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
  });

  it('should reject when description is empty', async () => {
    const result = await submitClaim(
      makeValidInput({ description: '' }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CLAIM_CONTENT);
  });

  it('should reject when description exceeds 1000 characters', async () => {
    const result = await submitClaim(
      makeValidInput({ description: 'a'.repeat(1001) }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CLAIM_CONTENT);
  });

  it('should accept description at exactly 1000 characters', async () => {
    const result = await submitClaim(
      makeValidInput({ description: 'a'.repeat(1000) }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
  });

  // --- imageUrls validation ---

  it('should reject when imageUrls has more than 5 items', async () => {
    const result = await submitClaim(
      makeValidInput({ imageUrls: Array(6).fill('https://example.com/img.png') }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CLAIM_IMAGE_LIMIT_EXCEEDED);
  });

  it('should accept when imageUrls has exactly 5 items', async () => {
    const result = await submitClaim(
      makeValidInput({ imageUrls: Array(5).fill('https://example.com/img.png') }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
  });

  it('should accept when imageUrls is omitted', async () => {
    const result = await submitClaim(
      makeValidInput({ imageUrls: undefined }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
    expect(result.claim?.imageUrls).toEqual([]);
  });

  // --- activityUrl validation ---

  it('should reject when activityUrl is not a valid URL', async () => {
    const result = await submitClaim(
      makeValidInput({ activityUrl: 'not-a-url' }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_ACTIVITY_URL);
  });

  it('should accept when activityUrl is a valid URL', async () => {
    const result = await submitClaim(
      makeValidInput({ activityUrl: 'https://example.com/event' }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
    expect(result.claim?.activityUrl).toBe('https://example.com/event');
  });

  it('should accept when activityUrl is omitted', async () => {
    const result = await submitClaim(
      makeValidInput({ activityUrl: undefined }),
      client,
      CLAIMS_TABLE,
    );
    expect(result.success).toBe(true);
    expect(result.claim?.activityUrl).toBeUndefined();
  });

  // --- Successful submission ---

  it('should create claim with correct fields on success', async () => {
    const result = await submitClaim(
      makeValidInput({
        userId: 'user-123',
        userRoles: ['Speaker', 'Volunteer'],
        userNickname: 'Alice',
        title: '技术分享',
        description: '分享了 AWS 最佳实践',
        imageUrls: ['https://example.com/1.png'],
        activityUrl: 'https://example.com/event',
      }),
      client,
      CLAIMS_TABLE,
    );

    expect(result.success).toBe(true);
    const claim = result.claim!;
    expect(claim.claimId).toBeDefined();
    expect(claim.userId).toBe('user-123');
    expect(claim.applicantNickname).toBe('Alice');
    expect(claim.applicantRole).toBe('Speaker');
    expect(claim.title).toBe('技术分享');
    expect(claim.description).toBe('分享了 AWS 最佳实践');
    expect(claim.imageUrls).toEqual(['https://example.com/1.png']);
    expect(claim.activityUrl).toBe('https://example.com/event');
    expect(claim.status).toBe('pending');
    expect(claim.createdAt).toBeDefined();
  });

  it('should call PutCommand with correct table and item', async () => {
    const result = await submitClaim(makeValidInput(), client, CLAIMS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('PutCommand');
    expect(cmd.input.TableName).toBe(CLAIMS_TABLE);
    expect(cmd.input.Item.claimId).toBe(result.claim!.claimId);
    expect(cmd.input.Item.status).toBe('pending');
  });
});


describe('listMyClaims', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should query userId-createdAt-index with ScanIndexForward=false', async () => {
    client.send.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });

    await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe(CLAIMS_TABLE);
    expect(cmd.input.IndexName).toBe('userId-createdAt-index');
    expect(cmd.input.KeyConditionExpression).toBe('userId = :uid');
    expect(cmd.input.ExpressionAttributeValues[':uid']).toBe('user-001');
    expect(cmd.input.ScanIndexForward).toBe(false);
  });

  it('should default pageSize to 20', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(20);
  });

  it('should cap pageSize at 100', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001', pageSize: 200 }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(100);
  });

  it('should use custom pageSize when within range', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001', pageSize: 50 }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(50);
  });

  it('should add FilterExpression when status is provided', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001', status: 'pending' }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBe('#st = :status');
    expect(cmd.input.ExpressionAttributeNames).toEqual({ '#st': 'status' });
    expect(cmd.input.ExpressionAttributeValues[':status']).toBe('pending');
  });

  it('should not add FilterExpression when status is not provided', async () => {
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.FilterExpression).toBeUndefined();
    expect(cmd.input.ExpressionAttributeNames).toBeUndefined();
  });

  it('should return claims from DynamoDB response', async () => {
    const mockClaims = [
      { claimId: 'c1', userId: 'user-001', status: 'pending', title: 'Claim 1', createdAt: '2024-01-02T00:00:00Z' },
      { claimId: 'c2', userId: 'user-001', status: 'approved', title: 'Claim 2', createdAt: '2024-01-01T00:00:00Z' },
    ];
    client.send.mockResolvedValue({ Items: mockClaims });

    const result = await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.claims).toEqual(mockClaims);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return lastKey when LastEvaluatedKey is present', async () => {
    const lastEvalKey = { claimId: 'c2', userId: 'user-001', createdAt: '2024-01-01T00:00:00Z' };
    client.send.mockResolvedValue({ Items: [], LastEvaluatedKey: lastEvalKey });

    const result = await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.lastKey).toBeDefined();
    // Verify it's valid base64-encoded JSON
    const decoded = JSON.parse(Buffer.from(result.lastKey!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastEvalKey);
  });

  it('should pass ExclusiveStartKey when lastKey is provided', async () => {
    const lastEvalKey = { claimId: 'c2', userId: 'user-001', createdAt: '2024-01-01T00:00:00Z' };
    const encodedKey = Buffer.from(JSON.stringify(lastEvalKey)).toString('base64');
    client.send.mockResolvedValue({ Items: [] });

    await listMyClaims({ userId: 'user-001', lastKey: encodedKey }, client, CLAIMS_TABLE);

    const cmd = client.send.mock.calls[0][0];
    expect(cmd.input.ExclusiveStartKey).toEqual(lastEvalKey);
  });

  it('should return error for invalid lastKey', async () => {
    const result = await listMyClaims({ userId: 'user-001', lastKey: 'not-valid-base64-json!!' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAGINATION_KEY');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should return empty claims array when no items found', async () => {
    client.send.mockResolvedValue({ Items: undefined });

    const result = await listMyClaims({ userId: 'user-001' }, client, CLAIMS_TABLE);

    expect(result.success).toBe(true);
    expect(result.claims).toEqual([]);
  });
});
