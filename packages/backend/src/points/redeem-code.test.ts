import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redeemCode, RedeemCodeTableNames } from './redeem-code';
import { ErrorCodes } from '@points-mall/shared';

const tables: RedeemCodeTableNames = {
  codesTable: 'Codes',
  usersTable: 'Users',
  pointsRecordsTable: 'PointsRecords',
};

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makeCodeItem(overrides: Record<string, any> = {}) {
  return {
    codeId: 'code-001',
    codeValue: 'ABC123',
    type: 'points',
    pointsValue: 50,
    maxUses: 3,
    currentUses: 0,
    status: 'active',
    usedBy: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('redeemCode', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return INVALID_CODE when code does not exist', async () => {
    client.send.mockResolvedValueOnce({ Items: [] }); // query returns empty

    const result = await redeemCode({ code: 'NONEXIST', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code status is disabled', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ status: 'disabled' })],
    });

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code status is exhausted', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ status: 'exhausted' })],
    });

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return INVALID_CODE when code type is product', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ type: 'product' })],
    });

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_CODE);
  });

  it('should return CODE_EXHAUSTED when currentUses >= maxUses', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ currentUses: 3, maxUses: 3 })],
    });

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_EXHAUSTED);
  });

  it('should return CODE_ALREADY_USED when user already used the code', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ usedBy: { 'user-1': '2024-01-01T00:00:00.000Z' } })],
    });

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.CODE_ALREADY_USED);
  });

  it('should succeed and return earned points for a valid redemption', async () => {
    // Query code
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ pointsValue: 100 })],
    });
    // Get user
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-1', points: 200 } });
    // TransactWrite
    client.send.mockResolvedValueOnce({});

    const result = await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(result.success).toBe(true);
    expect(result.pointsEarned).toBe(100);
  });

  it('should issue TransactWriteCommand with correct items', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ pointsValue: 50, currentUses: 1, maxUses: 3 })],
    });
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-1', points: 100 } });
    client.send.mockResolvedValueOnce({});

    await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    expect(client.send).toHaveBeenCalledTimes(3);
    const txCmd = client.send.mock.calls[2][0];
    expect(txCmd.constructor.name).toBe('TransactWriteCommand');

    const items = txCmd.input.TransactItems;
    expect(items).toHaveLength(3);

    // Code update
    expect(items[0].Update.TableName).toBe('Codes');
    expect(items[0].Update.Key).toEqual({ codeId: 'code-001' });

    // User update
    expect(items[1].Update.TableName).toBe('Users');
    expect(items[1].Update.Key).toEqual({ userId: 'user-1' });
    expect(items[1].Update.ExpressionAttributeValues[':pv']).toBe(50);

    // Points record
    expect(items[2].Put.TableName).toBe('PointsRecords');
    expect(items[2].Put.Item.type).toBe('earn');
    expect(items[2].Put.Item.amount).toBe(50);
    expect(items[2].Put.Item.source).toBe('ABC123');
    expect(items[2].Put.Item.balanceAfter).toBe(150);
    expect(items[2].Put.Item.userId).toBe('user-1');
  });

  it('should set code status to exhausted when reaching maxUses', async () => {
    // currentUses=2, maxUses=3 → after redemption currentUses=3 → exhausted
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ currentUses: 2, maxUses: 3 })],
    });
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-1', points: 0 } });
    client.send.mockResolvedValueOnce({});

    await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    const txCmd = client.send.mock.calls[2][0];
    const codeUpdate = txCmd.input.TransactItems[0].Update;
    expect(codeUpdate.ExpressionAttributeValues[':newStatus']).toBe('exhausted');
  });

  it('should keep code status active when not reaching maxUses', async () => {
    // currentUses=0, maxUses=3 → after redemption currentUses=1 → still active
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ currentUses: 0, maxUses: 3 })],
    });
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-1', points: 0 } });
    client.send.mockResolvedValueOnce({});

    await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    const txCmd = client.send.mock.calls[2][0];
    const codeUpdate = txCmd.input.TransactItems[0].Update;
    expect(codeUpdate.ExpressionAttributeValues[':newStatus']).toBe('active');
  });

  it('should default user points to 0 when user has no points field', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ pointsValue: 25 })],
    });
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-1' } }); // no points field
    client.send.mockResolvedValueOnce({});

    await redeemCode({ code: 'ABC123', userId: 'user-1' }, client, tables);

    const txCmd = client.send.mock.calls[2][0];
    const record = txCmd.input.TransactItems[2].Put.Item;
    expect(record.balanceAfter).toBe(25); // 0 + 25
  });

  it('should allow different user to use same code', async () => {
    client.send.mockResolvedValueOnce({
      Items: [makeCodeItem({ usedBy: { 'user-1': '2024-01-01T00:00:00.000Z' }, currentUses: 1 })],
    });
    client.send.mockResolvedValueOnce({ Item: { userId: 'user-2', points: 10 } });
    client.send.mockResolvedValueOnce({});

    const result = await redeemCode({ code: 'ABC123', userId: 'user-2' }, client, tables);

    expect(result.success).toBe(true);
    expect(result.pointsEarned).toBe(50);
  });
});
