import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createReservation, getDownloadUrl } from './reservation';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock @aws-sdk/s3-request-presigner ────────────────────

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-download-url'),
}));

// ─── Stateful Mock DynamoDB ────────────────────────────────
// Tracks reservations, points, and points records in-memory.

interface PointsRecord {
  recordId: string;
  userId: string;
  type: string;
  amount: number;
  source: string;
  balanceAfter: number;
  createdAt: string;
}

interface MockState {
  reservations: Map<string, { pk: string; userId: string; contentId: string; createdAt: string }>;
  contentItems: Map<string, { contentId: string; uploaderId: string; fileKey: string; status: string; reservationCount: number }>;
  users: Map<string, { userId: string; points: number }>;
  pointsRecords: PointsRecord[];
}

function createStatefulMockDynamoClient(state: MockState) {
  return {
    send: vi.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor.name;

      if (name === 'GetCommand') {
        const tableName = cmd.input.TableName;

        if (tableName === 'ContentItems') {
          const contentId = cmd.input.Key.contentId as string;
          const item = state.contentItems.get(contentId);
          return Promise.resolve({ Item: item ?? undefined });
        }

        if (tableName === 'Users') {
          const userId = cmd.input.Key.userId as string;
          const user = state.users.get(userId);
          return Promise.resolve({ Item: user ?? undefined });
        }

        if (tableName === 'ContentReservations') {
          const pk = cmd.input.Key.pk as string;
          const item = state.reservations.get(pk);
          return Promise.resolve({ Item: item ?? undefined });
        }
      }

      if (name === 'TransactWriteCommand') {
        const items = cmd.input.TransactItems;
        // Check the reservation put condition
        const putItem = items[0].Put;
        const pk = putItem.Item.pk as string;

        if (state.reservations.has(pk)) {
          // Simulate ConditionalCheckFailed
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

        // Apply all transaction operations atomically
        // a. Put reservation
        state.reservations.set(pk, { ...putItem.Item });

        // b. Increment reservationCount
        const contentId = items[1].Update.Key.contentId as string;
        const content = state.contentItems.get(contentId);
        if (content) {
          content.reservationCount = (content.reservationCount ?? 0) + 1;
        }

        // c. Increment uploader points
        const uploaderId = items[2].Update.Key.userId as string;
        const rewardPoints = items[2].Update.ExpressionAttributeValues[':pv'] as number;
        const user = state.users.get(uploaderId);
        if (user) {
          user.points += rewardPoints;
        }

        // d. Create points record
        const pointsRecord = items[3].Put.Item;
        state.pointsRecords.push(pointsRecord as PointsRecord);

        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;
}

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

function createMockS3Client() {
  return {} as any;
}

// ─── Arbitraries ───────────────────────────────────────────

const userIdArb = fc.uuid();
const contentIdArb = fc.uuid();
const uploaderIdArb = fc.uuid();
const rewardPointsArb = fc.integer({ min: 1, max: 100 });
const initialPointsArb = fc.integer({ min: 0, max: 10000 });


// ─── Property 9 ────────────────────────────────────────────

// Feature: content-hub, Property 9: 预约与下载权限联动（Round-Trip）
// 对于任何用户和已审核通过的 ContentItem，未预约时请求下载应返回 RESERVATION_REQUIRED；
// 完成预约后请求下载应成功返回下载 URL。
// **Validates: Requirements 4.5, 5.1, 5.2**

describe('Property 9: 预约与下载权限联动（Round-Trip）', () => {
  it('未预约时下载返回 RESERVATION_REQUIRED，预约后下载成功', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        rewardPointsArb,
        initialPointsArb,
        async (userId, contentId, uploaderId, rewardPoints, initialPoints) => {
          // Ensure userId !== uploaderId to simulate a different user reserving
          fc.pre(userId !== uploaderId);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId, {
                contentId,
                uploaderId,
                fileKey: `content/${uploaderId}/abc/test.pdf`,
                status: 'approved',
                reservationCount: 0,
              }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: initialPoints }]]),
            pointsRecords: [],
          };
          const dynamo = createStatefulMockDynamoClient(state);
          const s3 = createMockS3Client();

          // Step 1: Download without reservation → RESERVATION_REQUIRED
          const downloadBefore = await getDownloadUrl(
            contentId, userId, dynamo, s3, downloadTables, 'test-bucket',
          );
          expect(downloadBefore.success).toBe(false);
          expect(downloadBefore.error!.code).toBe(ErrorCodes.RESERVATION_REQUIRED);

          // Step 2: Create reservation
          const reserveResult = await createReservation(
            { contentId, userId }, dynamo, tables, rewardPoints,
          );
          expect(reserveResult.success).toBe(true);
          expect(reserveResult.alreadyReserved).toBeUndefined();

          // Step 3: Download after reservation → success
          const downloadAfter = await getDownloadUrl(
            contentId, userId, dynamo, s3, downloadTables, 'test-bucket',
          );
          expect(downloadAfter.success).toBe(true);
          expect(downloadAfter.downloadUrl).toBeDefined();
          expect(typeof downloadAfter.downloadUrl).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10 ───────────────────────────────────────────

// Feature: content-hub, Property 10: 预约幂等性
// 对于任何用户和 ContentItem 的组合，重复执行预约操作后，
// Reservations 表中该组合的记录应最多存在一条，且上传者仅获得一次积分奖励。
// **Validates: Requirement 6.4**

describe('Property 10: 预约幂等性', () => {
  it('重复预约后 Reservations 表最多一条记录且上传者仅获得一次积分', async () => {
    const repeatCountArb = fc.integer({ min: 2, max: 5 });

    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        rewardPointsArb,
        initialPointsArb,
        repeatCountArb,
        async (userId, contentId, uploaderId, rewardPoints, initialPoints, repeatCount) => {
          fc.pre(userId !== uploaderId);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId, {
                contentId,
                uploaderId,
                fileKey: `content/${uploaderId}/abc/test.pdf`,
                status: 'approved',
                reservationCount: 0,
              }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: initialPoints }]]),
            pointsRecords: [],
          };
          const dynamo = createStatefulMockDynamoClient(state);

          // Execute reservation multiple times
          for (let i = 0; i < repeatCount; i++) {
            const result = await createReservation(
              { contentId, userId }, dynamo, tables, rewardPoints,
            );
            expect(result.success).toBe(true);

            if (i === 0) {
              expect(result.alreadyReserved).toBeUndefined();
            } else {
              expect(result.alreadyReserved).toBe(true);
            }
          }

          // Verify: at most one reservation record for this user/content pair
          const pk = `${userId}#${contentId}`;
          const reservationEntries = [...state.reservations.entries()].filter(([k]) => k === pk);
          expect(reservationEntries.length).toBeLessThanOrEqual(1);

          // Verify: uploader got points only once
          const uploaderPoints = state.users.get(uploaderId)!.points;
          expect(uploaderPoints).toBe(initialPoints + rewardPoints);

          // Verify: only one points record was created
          const records = state.pointsRecords.filter(
            (r) => r.source === 'content_hub_reservation' && r.userId === uploaderId,
          );
          expect(records.length).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11 ───────────────────────────────────────────

// Feature: content-hub, Property 11: 预约积分发放正确性
// 对于任何新建的 Reservation，上传者的积分余额应增加配置的奖励积分数，
// 且系统应生成一条 type=earn、source="content_hub_reservation" 的积分记录。
// **Validates: Requirements 6.1, 6.3**

describe('Property 11: 预约积分发放正确性', () => {
  it('预约成功后上传者积分增加且生成正确的积分记录', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        rewardPointsArb,
        initialPointsArb,
        async (userId, contentId, uploaderId, rewardPoints, initialPoints) => {
          fc.pre(userId !== uploaderId);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId, {
                contentId,
                uploaderId,
                fileKey: `content/${uploaderId}/abc/test.pdf`,
                status: 'approved',
                reservationCount: 0,
              }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: initialPoints }]]),
            pointsRecords: [],
          };
          const dynamo = createStatefulMockDynamoClient(state);

          const result = await createReservation(
            { contentId, userId }, dynamo, tables, rewardPoints,
          );
          expect(result.success).toBe(true);
          expect(result.alreadyReserved).toBeUndefined();

          // Verify: uploader's points increased by rewardPoints
          const uploaderPoints = state.users.get(uploaderId)!.points;
          expect(uploaderPoints).toBe(initialPoints + rewardPoints);

          // Verify: a points record with type=earn, source="content_hub_reservation" was created
          const records = state.pointsRecords.filter(
            (r) => r.userId === uploaderId && r.source === 'content_hub_reservation',
          );
          expect(records.length).toBe(1);

          const record = records[0];
          expect(record.type).toBe('earn');
          expect(record.source).toBe('content_hub_reservation');
          expect(record.amount).toBe(rewardPoints);
          expect(record.userId).toBe(uploaderId);
          expect(record.createdAt).toBeDefined();
          expect(typeof record.createdAt).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });
});
