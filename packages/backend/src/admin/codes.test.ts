import { describe, it, expect, vi } from 'vitest';
import {
  batchGeneratePointsCodes,
  generateProductCodes,
  listCodes,
  disableCode,
  generateCodeValue,
  type BatchGeneratePointsCodesInput,
  type GenerateProductCodesInput,
} from './codes';

function createMockDynamoClient() {
  return {
    send: vi.fn().mockResolvedValue({}),
  } as any;
}

const tableName = 'Codes';

// ---- generateCodeValue ----

describe('generateCodeValue', () => {
  it('should generate a 12-character string', () => {
    const code = generateCodeValue();
    expect(code).toHaveLength(12);
  });

  it('should only contain alphanumeric characters', () => {
    const code = generateCodeValue();
    expect(code).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it('should generate unique values on successive calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCodeValue()));
    expect(codes.size).toBe(50);
  });
});

// ---- batchGeneratePointsCodes ----

describe('batchGeneratePointsCodes', () => {
  const input: BatchGeneratePointsCodesInput = {
    count: 3,
    pointsValue: 100,
    maxUses: 5,
  };

  it('should generate the correct number of codes', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes(input, client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
  });

  it('should set correct fields on each generated code', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes(input, client, tableName);

    for (const code of result.data!) {
      expect(code.type).toBe('points');
      expect(code.pointsValue).toBe(100);
      expect(code.maxUses).toBe(5);
      expect(code.currentUses).toBe(0);
      expect(code.status).toBe('active');
      expect(code.usedBy).toEqual([]);
      expect(code.codeId).toBeDefined();
      expect(code.codeValue).toHaveLength(12);
      expect(code.createdAt).toBeDefined();
    }
  });

  it('should generate unique codeIds and codeValues', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes({ count: 10, pointsValue: 50, maxUses: 1 }, client, tableName);

    const ids = result.data!.map((c) => c.codeId);
    const values = result.data!.map((c) => c.codeValue);
    expect(new Set(ids).size).toBe(10);
    expect(new Set(values).size).toBe(10);
  });

  it('should write to DynamoDB in batches of 25', async () => {
    const client = createMockDynamoClient();
    await batchGeneratePointsCodes({ count: 30, pointsValue: 10, maxUses: 1 }, client, tableName);

    // 30 items = 2 batches (25 + 5)
    expect(client.send).toHaveBeenCalledTimes(2);
    const firstBatch = client.send.mock.calls[0][0];
    expect(firstBatch.constructor.name).toBe('BatchWriteCommand');
    expect(firstBatch.input.RequestItems[tableName]).toHaveLength(25);
    const secondBatch = client.send.mock.calls[1][0];
    expect(secondBatch.input.RequestItems[tableName]).toHaveLength(5);
  });

  it('should store usedBy as empty object in DynamoDB item', async () => {
    const client = createMockDynamoClient();
    await batchGeneratePointsCodes({ count: 1, pointsValue: 10, maxUses: 1 }, client, tableName);

    const command = client.send.mock.calls[0][0];
    const item = command.input.RequestItems[tableName][0].PutRequest.Item;
    expect(item.usedBy).toEqual({});
  });

  it('should reject count <= 0', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes({ count: 0, pointsValue: 10, maxUses: 1 }, client, tableName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_COUNT');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject pointsValue <= 0', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes({ count: 1, pointsValue: 0, maxUses: 1 }, client, tableName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_POINTS_VALUE');
  });

  it('should reject maxUses <= 0', async () => {
    const client = createMockDynamoClient();
    const result = await batchGeneratePointsCodes({ count: 1, pointsValue: 10, maxUses: -1 }, client, tableName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_MAX_USES');
  });
});

// ---- generateProductCodes ----

describe('generateProductCodes', () => {
  const input: GenerateProductCodesInput = {
    productId: 'prod-abc123',
    count: 2,
  };

  it('should generate the correct number of product codes', async () => {
    const client = createMockDynamoClient();
    const result = await generateProductCodes(input, client, tableName);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('should set correct fields on each product code', async () => {
    const client = createMockDynamoClient();
    const result = await generateProductCodes(input, client, tableName);

    for (const code of result.data!) {
      expect(code.type).toBe('product');
      expect(code.productId).toBe('prod-abc123');
      expect(code.maxUses).toBe(1);
      expect(code.currentUses).toBe(0);
      expect(code.status).toBe('active');
      expect(code.usedBy).toEqual([]);
      expect(code.codeId).toBeDefined();
      expect(code.codeValue).toHaveLength(12);
      expect(code.createdAt).toBeDefined();
    }
  });

  it('should write to DynamoDB using BatchWriteCommand', async () => {
    const client = createMockDynamoClient();
    await generateProductCodes(input, client, tableName);

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('BatchWriteCommand');
    expect(command.input.RequestItems[tableName]).toHaveLength(2);
  });

  it('should reject count <= 0', async () => {
    const client = createMockDynamoClient();
    const result = await generateProductCodes({ productId: 'p1', count: 0 }, client, tableName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_COUNT');
  });

  it('should reject empty productId', async () => {
    const client = createMockDynamoClient();
    const result = await generateProductCodes({ productId: '', count: 5 }, client, tableName);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PRODUCT_ID');
  });

  it('should batch product codes in groups of 25', async () => {
    const client = createMockDynamoClient();
    await generateProductCodes({ productId: 'p1', count: 50 }, client, tableName);

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls[0][0].input.RequestItems[tableName]).toHaveLength(25);
    expect(client.send.mock.calls[1][0].input.RequestItems[tableName]).toHaveLength(25);
  });
});

// ---- listCodes ----

describe('listCodes', () => {
  it('should return codes from DynamoDB scan', async () => {
    const items = [
      { codeId: 'c1', codeValue: 'ABC123DEF456', type: 'points', status: 'active' },
      { codeId: 'c2', codeValue: 'XYZ789GHI012', type: 'product', status: 'disabled' },
    ];
    const client = { send: vi.fn().mockResolvedValue({ Items: items }) } as any;

    const result = await listCodes(client, tableName);

    expect(result.codes).toHaveLength(2);
    expect(result.lastKey).toBeUndefined();
  });

  it('should return empty array when no codes exist', async () => {
    const client = { send: vi.fn().mockResolvedValue({ Items: undefined }) } as any;

    const result = await listCodes(client, tableName);

    expect(result.codes).toEqual([]);
  });

  it('should pass pageSize as Limit', async () => {
    const client = { send: vi.fn().mockResolvedValue({ Items: [] }) } as any;

    await listCodes(client, tableName, { pageSize: 10 });

    const command = client.send.mock.calls[0][0];
    expect(command.input.Limit).toBe(10);
  });

  it('should pass lastKey as ExclusiveStartKey', async () => {
    const lastKey = { codeId: 'c1' };
    const client = { send: vi.fn().mockResolvedValue({ Items: [] }) } as any;

    await listCodes(client, tableName, { lastKey });

    const command = client.send.mock.calls[0][0];
    expect(command.input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('should return lastKey from DynamoDB response for pagination', async () => {
    const nextKey = { codeId: 'c5' };
    const client = {
      send: vi.fn().mockResolvedValue({ Items: [{ codeId: 'c1' }], LastEvaluatedKey: nextKey }),
    } as any;

    const result = await listCodes(client, tableName, { pageSize: 1 });

    expect(result.lastKey).toEqual(nextKey);
  });

  it('should use ScanCommand on the correct table', async () => {
    const client = { send: vi.fn().mockResolvedValue({ Items: [] }) } as any;

    await listCodes(client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('ScanCommand');
    expect(command.input.TableName).toBe(tableName);
  });
});

// ---- disableCode ----

describe('disableCode', () => {
  it('should update code status to disabled', async () => {
    const client = createMockDynamoClient();
    const result = await disableCode('code-123', client, tableName);

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);

    const command = client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input.TableName).toBe(tableName);
    expect(command.input.Key).toEqual({ codeId: 'code-123' });
    expect(command.input.ExpressionAttributeValues[':disabled']).toBe('disabled');
  });

  it('should reject empty codeId', async () => {
    const client = createMockDynamoClient();
    const result = await disableCode('', client, tableName);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_CODE_ID');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should use correct update expression with status alias', async () => {
    const client = createMockDynamoClient();
    await disableCode('code-456', client, tableName);

    const command = client.send.mock.calls[0][0];
    expect(command.input.UpdateExpression).toBe('SET #s = :disabled');
    expect(command.input.ExpressionAttributeNames['#s']).toBe('status');
  });
});
