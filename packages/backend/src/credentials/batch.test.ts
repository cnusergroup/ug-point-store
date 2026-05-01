import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchCreateCredentials, type BatchCreateParams } from './batch';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomUUID: vi.fn(() => 'test-batch-uuid-001'),
    },
  };
});

const CREDENTIALS_TABLE = 'PointsMall-Credentials';
const SEQUENCES_TABLE = 'PointsMall-CredentialSequences';

function createMockDynamoClient() {
  return {
    send: vi.fn(),
  } as any;
}

function makeParams(overrides: Partial<BatchCreateParams> = {}): BatchCreateParams {
  return {
    dynamoClient: createMockDynamoClient(),
    credentialsTableName: CREDENTIALS_TABLE,
    sequencesTableName: SEQUENCES_TABLE,
    eventPrefix: 'ACD-BASE',
    year: '2026',
    season: 'Summer',
    csvContent: 'recipientName,role,eventName,locale\n张三,Volunteer,AWS Community Day,zh\nJohn,Speaker,AWS Community Day,en',
    ...overrides,
  };
}

describe('batchCreateCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create credentials for all valid CSV rows', async () => {
    const params = makeParams();
    const client = params.dynamoClient;

    // Mock sequence generator: first call for VOL (1 row), second for SPK (1 row)
    let callCount = 0;
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        callCount++;
        // VOL gets sequence starting at 1, SPK gets sequence starting at 1
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      // PutCommand — credential write
      return Promise.resolve({});
    });

    const result = await batchCreateCredentials(params);

    expect(result.batchId).toBe('test-batch-uuid-001');
    expect(result.summary.total).toBe(2);
    expect(result.summary.success).toBe(2);
    expect(result.summary.failed).toBe(0);
    expect(result.credentials).toHaveLength(2);
    expect(result.errors).toHaveLength(0);

    // Verify credential IDs are correctly formatted
    const ids = result.credentials.map((c) => c.credentialId);
    expect(ids).toContain('ACD-BASE-2026-Summer-VOL-0001');
    expect(ids).toContain('ACD-BASE-2026-Summer-SPK-0001');
  });

  it('should handle empty CSV content', async () => {
    const params = makeParams({ csvContent: '' });

    const result = await batchCreateCredentials(params);

    expect(result.summary.total).toBe(0);
    expect(result.summary.success).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.credentials).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle header-only CSV', async () => {
    const params = makeParams({ csvContent: 'recipientName,role,eventName,locale' });

    const result = await batchCreateCredentials(params);

    expect(result.summary.total).toBe(0);
    expect(result.summary.success).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.credentials).toHaveLength(0);
  });

  it('should collect errors for invalid rows without affecting valid rows', async () => {
    const csvContent = [
      'recipientName,role,eventName,locale',
      '张三,Volunteer,AWS Community Day,zh',
      ',Speaker,AWS Community Day,en',       // missing recipientName
      'John,InvalidRole,AWS Community Day,en', // invalid role
      'Jane,Organizer,AWS Community Day,en',
    ].join('\n');

    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      return Promise.resolve({});
    });

    const result = await batchCreateCredentials(params);

    // 2 valid rows + 2 invalid rows = 4 total
    expect(result.summary.total).toBe(4);
    expect(result.summary.success).toBe(2);
    expect(result.summary.failed).toBe(2);
    expect(result.credentials).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
  });

  it('should assign contiguous sequences for same role', async () => {
    const csvContent = [
      'recipientName,role,eventName',
      'Alice,Volunteer,Event A',
      'Bob,Volunteer,Event A',
      'Charlie,Volunteer,Event A',
    ].join('\n');

    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    // Reserve 3 sequences for VOL, starting at 5 (endSequence=7, count=3, start=5)
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 7 } });
      }
      return Promise.resolve({});
    });

    const result = await batchCreateCredentials(params);

    expect(result.summary.success).toBe(3);
    const ids = result.credentials.map((c) => c.credentialId);
    expect(ids).toEqual([
      'ACD-BASE-2026-Summer-VOL-0005',
      'ACD-BASE-2026-Summer-VOL-0006',
      'ACD-BASE-2026-Summer-VOL-0007',
    ]);
  });

  it('should set batchId on each credential written to DynamoDB', async () => {
    const csvContent = 'recipientName,role,eventName\nAlice,Speaker,Event A';
    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    const putItems: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      if (cmdName === 'PutCommand') {
        putItems.push(cmd.input.Item);
      }
      return Promise.resolve({});
    });

    await batchCreateCredentials(params);

    expect(putItems).toHaveLength(1);
    expect(putItems[0].batchId).toBe('test-batch-uuid-001');
    expect(putItems[0].status).toBe('active');
    expect(putItems[0].issuingOrganization).toBe('AWS User Group China');
  });

  it('should use custom issuingOrganization from CSV when provided', async () => {
    const csvContent = 'recipientName,role,eventName,issuingOrganization\nAlice,Speaker,Event A,Custom Org';
    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    const putItems: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      if (cmdName === 'PutCommand') {
        putItems.push(cmd.input.Item);
      }
      return Promise.resolve({});
    });

    await batchCreateCredentials(params);

    expect(putItems[0].issuingOrganization).toBe('Custom Org');
  });

  it('should default locale to zh when not specified', async () => {
    const csvContent = 'recipientName,role,eventName\nAlice,Speaker,Event A';
    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    const putItems: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      if (cmdName === 'PutCommand') {
        putItems.push(cmd.input.Item);
      }
      return Promise.resolve({});
    });

    await batchCreateCredentials(params);

    expect(putItems[0].locale).toBe('zh');
  });

  it('should handle DynamoDB write failure for individual rows gracefully', async () => {
    const csvContent = [
      'recipientName,role,eventName',
      'Alice,Volunteer,Event A',
      'Bob,Volunteer,Event A',
    ].join('\n');

    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    let putCallCount = 0;
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 2 } });
      }
      if (cmdName === 'PutCommand') {
        putCallCount++;
        if (putCallCount === 1) {
          return Promise.reject(new Error('ConditionalCheckFailedException'));
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await batchCreateCredentials(params);

    // First row fails DynamoDB write, second succeeds
    expect(result.summary.total).toBe(2);
    expect(result.summary.success).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.credentials).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('ConditionalCheckFailedException');
  });

  it('should include optional fields in credential when provided in CSV', async () => {
    const csvContent = 'recipientName,role,eventName,eventDate,eventLocation,contribution\nAlice,Speaker,Event A,2026-06-15,Shanghai,Keynote talk';
    const params = makeParams({ csvContent });
    const client = params.dynamoClient;

    const putItems: any[] = [];
    client.send.mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor.name;
      if (cmdName === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { currentValue: 1 } });
      }
      if (cmdName === 'PutCommand') {
        putItems.push(cmd.input.Item);
      }
      return Promise.resolve({});
    });

    await batchCreateCredentials(params);

    expect(putItems[0].eventDate).toBe('2026-06-15');
    expect(putItems[0].eventLocation).toBe('Shanghai');
    expect(putItems[0].contribution).toBe('Keynote talk');
  });
});
