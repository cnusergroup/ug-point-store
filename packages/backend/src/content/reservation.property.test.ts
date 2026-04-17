import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createReservation, getDownloadUrl } from './reservation';
import { ErrorCodes } from '@points-mall/shared';

// ─── Mock @aws-sdk/s3-request-presigner ────────────────────

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-download-url'),
}));

// ─── Stateful Mock DynamoDB ────────────────────────────────
// Tracks reservations and content items in-memory.

interface ReservationRecord {
  pk: string;
  userId: string;
  contentId: string;
  activityId: string;
  activityType: string;
  activityUG: string;
  activityTopic: string;
  activityDate: string;
  status: string;
  createdAt: string;
}

interface MockState {
  reservations: Map<string, ReservationRecord>;
  contentItems: Map<string, { contentId: string; uploaderId: string; fileKey: string; status: string; reservationCount: number }>;
  users: Map<string, { userId: string; points: number }>;
  activities: Map<string, { activityId: string; topic: string }>;
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

        if (tableName === 'Activities') {
          const activityId = cmd.input.Key.activityId as string;
          const item = state.activities.get(activityId);
          return Promise.resolve({ Item: item ?? undefined });
        }
      }

      if (name === 'QueryCommand') {
        // userId-activityId-index GSI check
        const userId = cmd.input.ExpressionAttributeValues[':userId'] as string;
        const activityId = cmd.input.ExpressionAttributeValues[':activityId'] as string;
        const matches = [...state.reservations.values()].filter(
          r => r.userId === userId && r.activityId === activityId,
        );
        return Promise.resolve({ Items: matches });
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
          ];
          return Promise.reject(err);
        }

        // Apply all transaction operations atomically
        // a. Put reservation
        state.reservations.set(pk, { ...putItem.Item } as ReservationRecord);

        // b. Increment reservationCount
        const contentId = items[1].Update.Key.contentId as string;
        const content = state.contentItems.get(contentId);
        if (content) {
          content.reservationCount = (content.reservationCount ?? 0) + 1;
        }

        return Promise.resolve({});
      }

      return Promise.resolve({});
    }),
  } as any;
}

const tables = {
  reservationsTable: 'ContentReservations',
  contentItemsTable: 'ContentItems',
  activitiesTable: 'Activities',
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
const activityIdArb = fc.uuid();
const activityTypeArb = fc.constantFrom('线上活动', '线下活动');
const activityUGArb = fc.string({ minLength: 1, maxLength: 20 });
const activityTopicArb = fc.string({ minLength: 1, maxLength: 50 });
const activityDateArb = fc.integer({ min: 2020, max: 2030 }).chain(year =>
  fc.integer({ min: 1, max: 12 }).chain(month =>
    fc.integer({ min: 1, max: 28 }).map(day =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ),
  ),
);
const initialPointsArb = fc.integer({ min: 0, max: 10000 });

// ─── Property 1: Reservation creation produces correct record ────

// Feature: content-reservation-approval, Property 1: Reservation creation produces correct record
// For any valid reservation input, the created reservation record SHALL contain all input fields,
// have status=pending, and have pk formatted as `{userId}#{contentId}`.
// **Validates: Requirements 1.1, 1.2, 1.3, 3.1**

describe('Property 1: Reservation creation produces correct record', () => {
  it('created reservation contains all input fields, status=pending, and correct pk format', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        initialPointsArb,
        async (userId, contentId, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate, initialPoints) => {
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
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
          };
          const dynamo = createStatefulMockDynamoClient(state);

          const result = await createReservation(
            { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result.success).toBe(true);
          expect(result.alreadyReserved).toBeUndefined();

          // Verify the reservation record
          const pk = `${userId}#${contentId}`;
          const record = state.reservations.get(pk);
          expect(record).toBeDefined();
          expect(record!.pk).toBe(pk);
          expect(record!.userId).toBe(userId);
          expect(record!.contentId).toBe(contentId);
          expect(record!.activityId).toBe(activityId);
          expect(record!.activityType).toBe(activityType);
          expect(record!.activityUG).toBe(activityUG);
          expect(record!.activityTopic).toBe(activityTopic);
          expect(record!.activityDate).toBe(activityDate);
          expect(record!.status).toBe('pending');
          expect(record!.createdAt).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: No points awarded on reservation creation ────

// Feature: content-reservation-approval, Property 2: No points awarded on reservation creation
// For any newly created reservation, the content uploader's points balance SHALL remain unchanged
// and no PointsRecord SHALL be created. Only the content's reservationCount SHALL increment by 1.
// **Validates: Requirements 3.2**

describe('Property 2: No points awarded on reservation creation', () => {
  it('uploader points unchanged and reservationCount increments by 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        initialPointsArb,
        async (userId, contentId, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate, initialPoints) => {
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
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
          };
          const dynamo = createStatefulMockDynamoClient(state);

          const result = await createReservation(
            { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result.success).toBe(true);

          // Verify: uploader's points remain unchanged
          const uploaderPoints = state.users.get(uploaderId)!.points;
          expect(uploaderPoints).toBe(initialPoints);

          // Verify: reservationCount incremented by 1
          const content = state.contentItems.get(contentId)!;
          expect(content.reservationCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: User+content duplicate prevention ────

// Feature: content-reservation-approval, Property 3: User+content duplicate prevention
// For any userId and contentId pair, attempting to create a second reservation SHALL return
// alreadyReserved=true without creating a duplicate record or incrementing reservationCount again.
// **Validates: Requirements 3.3**

describe('Property 3: User+content duplicate prevention', () => {
  it('duplicate reservation returns alreadyReserved or DUPLICATE_ACTIVITY_RESERVATION without double-incrementing count', async () => {
    const repeatCountArb = fc.integer({ min: 2, max: 5 });

    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        repeatCountArb,
        async (userId, contentId, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate, repeatCount) => {
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
            users: new Map([[uploaderId, { userId: uploaderId, points: 100 }]]),
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
          };
          const dynamo = createStatefulMockDynamoClient(state);

          // First reservation succeeds
          const firstResult = await createReservation(
            { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(firstResult.success).toBe(true);
          expect(firstResult.alreadyReserved).toBeUndefined();

          // Subsequent attempts are blocked (either by GSI duplicate check or TransactWrite condition)
          for (let i = 1; i < repeatCount; i++) {
            const result = await createReservation(
              { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
              dynamo,
              tables,
            );
            // Either alreadyReserved=true (TransactWrite condition) or DUPLICATE_ACTIVITY_RESERVATION (GSI check)
            const isIdempotent = result.success === true && result.alreadyReserved === true;
            const isDuplicateActivity = result.success === false && result.error?.code === ErrorCodes.DUPLICATE_ACTIVITY_RESERVATION;
            expect(isIdempotent || isDuplicateActivity).toBe(true);
          }

          // Verify: at most one reservation record
          const pk = `${userId}#${contentId}`;
          const reservationEntries = [...state.reservations.entries()].filter(([k]) => k === pk);
          expect(reservationEntries.length).toBeLessThanOrEqual(1);

          // Verify: reservationCount only incremented once
          const content = state.contentItems.get(contentId)!;
          expect(content.reservationCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: User+activity uniqueness constraint ────

// Feature: content-reservation-approval, Property 4: User+activity uniqueness constraint
// For any userId and activityId pair, if a reservation already exists for that combination
// (regardless of contentId), a new reservation attempt SHALL return DUPLICATE_ACTIVITY_RESERVATION.
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

describe('Property 4: User+activity uniqueness constraint', () => {
  it('same user+activity across different content returns DUPLICATE_ACTIVITY_RESERVATION', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        async (userId, contentId1, contentId2, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate) => {
          fc.pre(userId !== uploaderId);
          fc.pre(contentId1 !== contentId2);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId1, { contentId: contentId1, uploaderId, fileKey: 'f1', status: 'approved', reservationCount: 0 }],
              [contentId2, { contentId: contentId2, uploaderId, fileKey: 'f2', status: 'approved', reservationCount: 0 }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: 100 }]]),
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
          };
          const dynamo = createStatefulMockDynamoClient(state);

          // First reservation succeeds
          const result1 = await createReservation(
            { contentId: contentId1, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result1.success).toBe(true);

          // Second reservation with same user+activity but different content fails
          const result2 = await createReservation(
            { contentId: contentId2, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result2.success).toBe(false);
          expect(result2.error!.code).toBe(ErrorCodes.DUPLICATE_ACTIVITY_RESERVATION);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different users with same activity succeed independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        contentIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        async (userId1, userId2, contentId1, contentId2, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate) => {
          fc.pre(userId1 !== userId2);
          fc.pre(userId1 !== uploaderId && userId2 !== uploaderId);
          fc.pre(contentId1 !== contentId2);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId1, { contentId: contentId1, uploaderId, fileKey: 'f1', status: 'approved', reservationCount: 0 }],
              [contentId2, { contentId: contentId2, uploaderId, fileKey: 'f2', status: 'approved', reservationCount: 0 }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: 100 }]]),
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
          };
          const dynamo = createStatefulMockDynamoClient(state);

          // Both users can reserve the same activity
          const result1 = await createReservation(
            { contentId: contentId1, userId: userId1, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result1.success).toBe(true);

          const result2 = await createReservation(
            { contentId: contentId2, userId: userId2, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result2.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Reservation input validation ────

// Feature: content-reservation-approval, Property 12: Reservation input validation
// For any request with an activityId that does not exist in the Activities table,
// the system SHALL return ACTIVITY_NOT_FOUND error.
// **Validates: Requirements 12.1, 12.3, 12.4, 12.5**

describe('Property 12: Reservation input validation', () => {
  it('non-existent activityId returns ACTIVITY_NOT_FOUND', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        contentIdArb,
        uploaderIdArb,
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        async (userId, contentId, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate) => {
          fc.pre(userId !== uploaderId);

          const state: MockState = {
            reservations: new Map(),
            contentItems: new Map([
              [contentId, { contentId, uploaderId, fileKey: 'f1', status: 'approved', reservationCount: 0 }],
            ]),
            users: new Map([[uploaderId, { userId: uploaderId, points: 100 }]]),
            activities: new Map(), // No activities — activityId won't be found
          };
          const dynamo = createStatefulMockDynamoClient(state);

          const result = await createReservation(
            { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
          );
          expect(result.success).toBe(false);
          expect(result.error!.code).toBe(ErrorCodes.ACTIVITY_NOT_FOUND);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9 (updated): 预约与下载权限联动（Round-Trip）────

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
        activityIdArb,
        activityTypeArb,
        activityUGArb,
        activityTopicArb,
        activityDateArb,
        async (userId, contentId, uploaderId, activityId, activityType, activityUG, activityTopic, activityDate) => {
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
            users: new Map([[uploaderId, { userId: uploaderId, points: 100 }]]),
            activities: new Map([[activityId, { activityId, topic: activityTopic }]]),
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
            { contentId, userId, activityId, activityType, activityUG, activityTopic, activityDate },
            dynamo,
            tables,
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
