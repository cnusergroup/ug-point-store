import { describe, it, expect, vi } from 'vitest';
import { createReservation, getDownloadUrl } from './reservation';

// ─── Mock @aws-sdk/s3-request-presigner ────────────────────

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-download-url'),
}));

// ─── Mock helpers ──────────────────────────────────────────

const tables = {
  reservationsTable: 'ContentReservations',
  contentItemsTable: 'ContentItems',
  usersTable: 'Users',
  pointsRecordsTable: 'PointsRecords',
};

const downloadTables = {
  contentItemsTable: 'ContentItems',
  reservationsTable: 'ContentReservations',
};

const REWARD_POINTS = 10;

function makeContentItem(overrides?: Partial<Record<string, any>>) {
  return {
    contentId: 'content-1',
    title: 'Test Content',
    uploaderId: 'uploader-1',
    fileKey: 'content/uploader-1/abc/test.pdf',
    status: 'approved',
    ...overrides,
  };
}

function createMockDynamoClient(opts?: {
  contentItem?: any;
  contentItemMissing?: boolean;
  uploaderPoints?: number;
  reservationExists?: boolean;
}) {
  const contentItem = opts?.contentItemMissing ? undefined : (opts?.contentItem ?? makeContentItem());
  const uploaderPoints = opts?.uploaderPoints ?? 100;
  const reservationExists = opts?.reservationExists ?? false;

  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;

      if (name === 'GetCommand') {
        const tableName = cmd.input.TableName;

        if (tableName === 'ContentItems') {
          return Promise.resolve({
            Item: contentItem,
          });
        }

        if (tableName === 'Users') {
          return Promise.resolve({
            Item: { userId: 'uploader-1', points: uploaderPoints },
          });
        }

        if (tableName === 'ContentReservations') {
          return Promise.resolve({
            Item: reservationExists
              ? { pk: 'user-1#content-1', userId: 'user-1', contentId: 'content-1', createdAt: '2024-01-01T00:00:00Z' }
              : undefined,
          });
        }
      }

      if (name === 'TransactWriteCommand') {
        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;
}

function createMockS3Client() {
  return {} as any;
}

const validInput = {
  contentId: 'content-1',
  userId: 'user-1',
};

// ─── createReservation tests ───────────────────────────────

describe('createReservation', () => {
  it('should create reservation successfully and award points', async () => {
    const dynamo = createMockDynamoClient();
    const result = await createReservation(validInput, dynamo, tables, REWARD_POINTS);

    expect(result.success).toBe(true);
    expect(result.alreadyReserved).toBeUndefined();

    // Verify TransactWriteCommand was called
    const calls = dynamo.send.mock.calls;
    const transactCall = calls.find((c: any) => c[0].constructor.name === 'TransactWriteCommand');
    expect(transactCall).toBeDefined();

    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(4);

    // a. Reservation put with condition
    expect(transactItems[0].Put.TableName).toBe('ContentReservations');
    expect(transactItems[0].Put.Item.userId).toBe('user-1');
    expect(transactItems[0].Put.Item.contentId).toBe('content-1');
    expect(transactItems[0].Put.ConditionExpression).toBe('attribute_not_exists(pk)');

    // b. Increment reservationCount
    expect(transactItems[1].Update.TableName).toBe('ContentItems');
    expect(transactItems[1].Update.UpdateExpression).toContain('reservationCount');

    // c. Increment uploader points
    expect(transactItems[2].Update.TableName).toBe('Users');
    expect(transactItems[2].Update.Key.userId).toBe('uploader-1');
    expect(transactItems[2].Update.ExpressionAttributeValues[':pv']).toBe(REWARD_POINTS);

    // d. Points record
    expect(transactItems[3].Put.TableName).toBe('PointsRecords');
    expect(transactItems[3].Put.Item.type).toBe('earn');
    expect(transactItems[3].Put.Item.source).toBe('content_hub_reservation');
    expect(transactItems[3].Put.Item.amount).toBe(REWARD_POINTS);
    expect(transactItems[3].Put.Item.balanceAfter).toBe(110); // 100 + 10
  });

  it('should return alreadyReserved=true for duplicate reservation (idempotent)', async () => {
    const dynamo = createMockDynamoClient();

    // Simulate TransactionCanceledException with ConditionalCheckFailed
    dynamo.send.mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;

      if (name === 'GetCommand') {
        const tableName = cmd.input.TableName;
        if (tableName === 'ContentItems') {
          return Promise.resolve({ Item: makeContentItem() });
        }
        if (tableName === 'Users') {
          return Promise.resolve({ Item: { userId: 'uploader-1', points: 100 } });
        }
      }

      if (name === 'TransactWriteCommand') {
        const err: any = new Error('Transaction cancelled');
        err.name = 'TransactionCanceledException';
        err.CancellationReasons = [
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
          { Code: 'None' },
          { Code: 'None' },
        ];
        return Promise.reject(err);
      }

      return Promise.resolve({});
    });

    const result = await createReservation(validInput, dynamo, tables, REWARD_POINTS);

    expect(result.success).toBe(true);
    expect(result.alreadyReserved).toBe(true);
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    const dynamo = createMockDynamoClient({ contentItemMissing: true });
    const result = await createReservation(validInput, dynamo, tables, REWARD_POINTS);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONTENT_NOT_FOUND');
  });

  it('should use TransactWriteCommand for atomic operations', async () => {
    const dynamo = createMockDynamoClient();
    await createReservation(validInput, dynamo, tables, REWARD_POINTS);

    const calls = dynamo.send.mock.calls;
    const transactCall = calls.find((c: any) => c[0].constructor.name === 'TransactWriteCommand');
    expect(transactCall).toBeDefined();

    // Verify all 4 operations are in a single transaction
    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(4);
    expect(transactItems[0]).toHaveProperty('Put');   // reservation
    expect(transactItems[1]).toHaveProperty('Update'); // reservationCount
    expect(transactItems[2]).toHaveProperty('Update'); // uploader points
    expect(transactItems[3]).toHaveProperty('Put');   // points record
  });
});

// ─── getDownloadUrl tests ──────────────────────────────────

describe('getDownloadUrl', () => {
  it('should return RESERVATION_REQUIRED when user has no reservation', async () => {
    const dynamo = createMockDynamoClient({ reservationExists: false });
    const s3 = createMockS3Client();

    const result = await getDownloadUrl(
      'content-1', 'user-1', dynamo, s3, downloadTables, 'test-bucket',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RESERVATION_REQUIRED');
  });

  it('should return downloadUrl when user has reservation', async () => {
    const dynamo = createMockDynamoClient({ reservationExists: true });
    const s3 = createMockS3Client();

    const result = await getDownloadUrl(
      'content-1', 'user-1', dynamo, s3, downloadTables, 'test-bucket',
    );

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe('https://s3.example.com/presigned-download-url');
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    // Reservation exists but content doesn't
    const dynamo = {
      send: vi.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'GetCommand') {
          const tableName = cmd.input.TableName;
          if (tableName === 'ContentReservations') {
            return Promise.resolve({
              Item: { pk: 'user-1#content-1', userId: 'user-1', contentId: 'content-1' },
            });
          }
          if (tableName === 'ContentItems') {
            return Promise.resolve({ Item: undefined });
          }
        }
        return Promise.resolve({});
      }),
    } as any;

    const s3 = createMockS3Client();

    const result = await getDownloadUrl(
      'content-1', 'user-1', dynamo, s3, downloadTables, 'test-bucket',
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONTENT_NOT_FOUND');
  });
});
