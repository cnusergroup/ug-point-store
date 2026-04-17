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
  activitiesTable: 'Activities',
};

const downloadTables = {
  contentItemsTable: 'ContentItems',
  reservationsTable: 'ContentReservations',
};

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
  activityExists?: boolean;
  duplicateActivity?: boolean;
  reservationExists?: boolean;
}) {
  const contentItem = opts?.contentItemMissing ? undefined : (opts?.contentItem ?? makeContentItem());
  const activityExists = opts?.activityExists ?? true;
  const duplicateActivity = opts?.duplicateActivity ?? false;
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

        if (tableName === 'Activities') {
          return Promise.resolve({
            Item: activityExists ? { activityId: 'activity-1', topic: 'Test Activity' } : undefined,
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

      if (name === 'QueryCommand') {
        // userId-activityId-index GSI check
        return Promise.resolve({
          Items: duplicateActivity ? [{ pk: 'user-1#content-2', userId: 'user-1', activityId: 'activity-1' }] : [],
        });
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
  activityId: 'activity-1',
  activityType: '线上活动',
  activityUG: 'UG-Test',
  activityTopic: 'Test Topic',
  activityDate: '2024-06-15',
};

// ─── createReservation tests ───────────────────────────────

describe('createReservation', () => {
  it('should create reservation successfully with status=pending and activity fields', async () => {
    const dynamo = createMockDynamoClient();
    const result = await createReservation(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.alreadyReserved).toBeUndefined();

    // Verify TransactWriteCommand was called
    const calls = dynamo.send.mock.calls;
    const transactCall = calls.find((c: any) => c[0].constructor.name === 'TransactWriteCommand');
    expect(transactCall).toBeDefined();

    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(2);

    // a. Reservation put with condition, status=pending, and activity fields
    expect(transactItems[0].Put.TableName).toBe('ContentReservations');
    expect(transactItems[0].Put.Item.userId).toBe('user-1');
    expect(transactItems[0].Put.Item.contentId).toBe('content-1');
    expect(transactItems[0].Put.Item.activityId).toBe('activity-1');
    expect(transactItems[0].Put.Item.activityType).toBe('线上活动');
    expect(transactItems[0].Put.Item.activityUG).toBe('UG-Test');
    expect(transactItems[0].Put.Item.activityTopic).toBe('Test Topic');
    expect(transactItems[0].Put.Item.activityDate).toBe('2024-06-15');
    expect(transactItems[0].Put.Item.status).toBe('pending');
    expect(transactItems[0].Put.ConditionExpression).toBe('attribute_not_exists(pk)');

    // b. Increment reservationCount
    expect(transactItems[1].Update.TableName).toBe('ContentItems');
    expect(transactItems[1].Update.UpdateExpression).toContain('reservationCount');
  });

  it('should NOT award points on reservation creation (only 2 transaction items)', async () => {
    const dynamo = createMockDynamoClient();
    await createReservation(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    const transactCall = calls.find((c: any) => c[0].constructor.name === 'TransactWriteCommand');
    expect(transactCall).toBeDefined();

    // Only 2 operations: Put reservation + Update reservationCount (no points operations)
    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(2);
    expect(transactItems[0]).toHaveProperty('Put');   // reservation
    expect(transactItems[1]).toHaveProperty('Update'); // reservationCount
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
        if (tableName === 'Activities') {
          return Promise.resolve({ Item: { activityId: 'activity-1' } });
        }
      }

      if (name === 'QueryCommand') {
        return Promise.resolve({ Items: [] });
      }

      if (name === 'TransactWriteCommand') {
        const err: any = new Error('Transaction cancelled');
        err.name = 'TransactionCanceledException';
        err.CancellationReasons = [
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
        ];
        return Promise.reject(err);
      }

      return Promise.resolve({});
    });

    const result = await createReservation(validInput, dynamo, tables);

    expect(result.success).toBe(true);
    expect(result.alreadyReserved).toBe(true);
  });

  it('should return CONTENT_NOT_FOUND when content does not exist', async () => {
    const dynamo = createMockDynamoClient({ contentItemMissing: true });
    const result = await createReservation(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONTENT_NOT_FOUND');
  });

  it('should return ACTIVITY_NOT_FOUND when activity does not exist', async () => {
    const dynamo = createMockDynamoClient({ activityExists: false });
    const result = await createReservation(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ACTIVITY_NOT_FOUND');
  });

  it('should return DUPLICATE_ACTIVITY_RESERVATION when user already reserved same activity', async () => {
    const dynamo = createMockDynamoClient({ duplicateActivity: true });
    const result = await createReservation(validInput, dynamo, tables);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DUPLICATE_ACTIVITY_RESERVATION');
  });

  it('should use TransactWriteCommand for atomic operations', async () => {
    const dynamo = createMockDynamoClient();
    await createReservation(validInput, dynamo, tables);

    const calls = dynamo.send.mock.calls;
    const transactCall = calls.find((c: any) => c[0].constructor.name === 'TransactWriteCommand');
    expect(transactCall).toBeDefined();

    // Verify only 2 operations are in a single transaction
    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(2);
    expect(transactItems[0]).toHaveProperty('Put');   // reservation
    expect(transactItems[1]).toHaveProperty('Update'); // reservationCount
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
