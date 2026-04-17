import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

// ============================================================
// Interfaces
// ============================================================

export interface AnnouncementQueryOptions {
  limit: number;    // 1~50, 默认 20
  lastKey?: string;  // base64 编码的分页游标
}

export interface AnnouncementItem {
  recordId: string;
  recipientNickname: string;
  amount: number;
  source: string;
  createdAt: string;
  targetRole: string;
  activityUG?: string;
  activityDate?: string;
  activityTopic?: string;
  activityType?: string;
  distributorNickname?: string;  // 仅批量发放记录
}

export interface AnnouncementResult {
  success: boolean;
  items?: AnnouncementItem[];
  lastKey?: string | null;
  error?: { code: string; message: string };
}

// ============================================================
// Constants
// ============================================================

const BATCH_PREFIX = '批量发放:';
const RESERVATION_PREFIX = '预约审批:';

// ============================================================
// Source type helpers
// ============================================================

/**
 * Returns true if the source starts with "批量发放:".
 */
export function isBatchRecord(source: string): boolean {
  return source.startsWith(BATCH_PREFIX);
}

/**
 * Returns true if the source starts with "预约审批:".
 */
export function isReservationRecord(source: string): boolean {
  return source.startsWith(RESERVATION_PREFIX);
}

// ============================================================
// Validation
// ============================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_LIMIT = 1;

/**
 * Validate and normalize announcement query parameters.
 * - limit: 1~50, default 20
 * - lastKey: optional base64 pagination cursor
 */
export function validateAnnouncementParams(query: Record<string, string | undefined>): {
  valid: boolean;
  options?: AnnouncementQueryOptions;
  error?: { code: string; message: string };
} {
  // Validate limit
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== '') {
    const parsed = parseInt(query.limit, 10);
    if (isNaN(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      return {
        valid: false,
        error: { code: 'INVALID_REQUEST', message: `limit 参数无效，取值范围为 ${MIN_LIMIT}~${MAX_LIMIT}` },
      };
    }
    limit = parsed;
  }

  // Validate lastKey (optional base64 pagination cursor)
  let lastKey: string | undefined;
  if (query.lastKey !== undefined && query.lastKey !== '') {
    try {
      const decoded = Buffer.from(query.lastKey, 'base64').toString('utf-8');
      JSON.parse(decoded); // Validate it's valid JSON
      lastKey = query.lastKey;
    } catch {
      return {
        valid: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  return {
    valid: true,
    options: {
      limit,
      ...(lastKey && { lastKey }),
    },
  };
}

// ============================================================
// Main announcements query
// ============================================================

/**
 * Query the announcements feed.
 * 1. Query PointsRecords table type-createdAt-index GSI (type="earn", ScanIndexForward=false)
 * 2. BatchGet Users table to get recipient nicknames (by userId)
 * 3. For batch distribution records, query BatchDistributions table to get distributor nicknames
 * 4. Assemble AnnouncementItem and return paginated results
 */
export async function getAnnouncements(
  options: AnnouncementQueryOptions,
  dynamoClient: DynamoDBDocumentClient,
  tables: {
    pointsRecordsTable: string;
    usersTable: string;
    batchDistributionsTable: string;
  },
): Promise<AnnouncementResult> {
  const { limit, lastKey } = options;

  // Decode pagination cursor
  let exclusiveStartKey: Record<string, any> | undefined;
  if (lastKey) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8'));
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  // 1. Query PointsRecords table type-createdAt-index GSI
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: tables.pointsRecordsTable,
      IndexName: 'type-createdAt-index',
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':type': 'earn' },
      ScanIndexForward: false,
      Limit: limit,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }),
  );

  const records = queryResult.Items ?? [];

  if (records.length === 0) {
    return {
      success: true,
      items: [],
      lastKey: null,
    };
  }

  // 2. BatchGet Users table to get recipient nicknames
  const uniqueUserIds = [...new Set(records.map(r => r.userId as string))];
  const userNicknameMap = new Map<string, string>();

  const userChunks = chunkArray(uniqueUserIds, 100);
  for (const chunk of userChunks) {
    const batchResult = await dynamoClient.send(
      new BatchGetCommand({
        RequestItems: {
          [tables.usersTable]: {
            Keys: chunk.map(userId => ({ userId })),
            ProjectionExpression: 'userId, nickname',
          },
        },
      }),
    );
    const items = batchResult.Responses?.[tables.usersTable] ?? [];
    for (const item of items) {
      userNicknameMap.set(item.userId as string, (item.nickname as string) ?? '');
    }
  }

  // 3. For batch distribution records, get distributor nicknames from BatchDistributions table
  //    We match by activityId — collect unique activityIds from batch records
  const batchRecords = records.filter(r => isBatchRecord((r.source as string) ?? ''));
  const distributorNicknameMap = new Map<string, string>(); // activityId → distributorNickname

  if (batchRecords.length > 0) {
    const uniqueActivityIds = [...new Set(batchRecords.map(r => r.activityId as string).filter(Boolean))];

    if (uniqueActivityIds.length > 0) {
      // Query BatchDistributions by createdAt-index to find matching distributions
      // We use the time range from our records to narrow the query
      const oldestCreatedAt = records[records.length - 1].createdAt as string;
      const newestCreatedAt = records[0].createdAt as string;

      const distResult = await dynamoClient.send(
        new QueryCommand({
          TableName: tables.batchDistributionsTable,
          IndexName: 'createdAt-index',
          KeyConditionExpression: 'pk = :pk AND createdAt BETWEEN :start AND :end',
          ExpressionAttributeValues: {
            ':pk': 'ALL',
            ':start': oldestCreatedAt,
            ':end': newestCreatedAt,
          },
          ProjectionExpression: 'activityId, distributorNickname',
          ScanIndexForward: false,
        }),
      );

      const distributions = distResult.Items ?? [];
      for (const dist of distributions) {
        const activityId = dist.activityId as string;
        if (activityId && !distributorNicknameMap.has(activityId)) {
          distributorNicknameMap.set(activityId, (dist.distributorNickname as string) ?? '');
        }
      }
    }
  }

  // 4. Assemble AnnouncementItem list
  const items: AnnouncementItem[] = records.map(record => {
    const source = (record.source as string) ?? '';
    const item: AnnouncementItem = {
      recordId: (record.recordId as string) ?? '',
      recipientNickname: userNicknameMap.get(record.userId as string) ?? '',
      amount: (record.amount as number) ?? 0,
      source,
      createdAt: (record.createdAt as string) ?? '',
      targetRole: (record.targetRole as string) ?? '',
      activityUG: record.activityUG as string | undefined,
      activityDate: record.activityDate as string | undefined,
      activityTopic: record.activityTopic as string | undefined,
      activityType: record.activityType as string | undefined,
    };

    // Add distributorNickname for batch distribution records
    if (isBatchRecord(source)) {
      const activityId = record.activityId as string;
      item.distributorNickname = distributorNicknameMap.get(activityId) ?? '';
    }

    return item;
  });

  // 5. Determine pagination lastKey
  let nextLastKey: string | null = null;
  if (queryResult.LastEvaluatedKey) {
    nextLastKey = Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64');
  }

  return {
    success: true,
    items,
    lastKey: nextLastKey,
  };
}

// ============================================================
// Utility
// ============================================================

/** Split an array into chunks of the given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
