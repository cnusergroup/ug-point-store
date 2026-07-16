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
  originalRole?: string;    // Role_Change_Adjustment: Original_Role, when resolvable
  originalPoints?: number;  // Role_Change_Adjustment: Original_Points, when resolvable
  newPoints?: number;       // Role_Change_Adjustment: New_Points, when resolvable
}

export interface AnnouncementResult {
  success: boolean;
  items?: AnnouncementItem[];
  lastKey?: string | null;
  error?: { code: string; message: string };
}

/**
 * Result of resolving the role-transition data for a `积分调整:` correction record.
 * `resolvable` is true iff the Original_Role was determined (and differs from the
 * correction's New_Role / targetRole). When false, callers render the existing
 * new-role + net-delta wording only.
 */
export interface RoleTransition {
  originalRole?: string;
  originalPoints?: number;
  newPoints?: number;
  resolvable: boolean;
}

// ============================================================
// Constants
// ============================================================

const BATCH_PREFIX = '批量发放:';
const RESERVATION_PREFIX = '预约审批:';

/**
 * Prefixes used by `packages/backend/src/admin/batch-points-adjust.ts` for
 * `type: 'adjust'` correction records written to PointsRecords.
 */
const ADJUST_PREFIX = '积分调整:';
const DELETION_ADJUST_PREFIX = '发放删除:';
const SKILL_RELEASE_PREFIX = '技能释放:';
const SKILL_RELEASE_DELETION_PREFIX = '技能释放(删除):';
const SKILL_ASSIGN_PREFIX = '技能指派:';

/** All source prefixes that identify a `type: 'adjust'` correction record. */
const ADJUST_PREFIXES = [
  ADJUST_PREFIX,
  DELETION_ADJUST_PREFIX,
  SKILL_RELEASE_PREFIX,
  SKILL_RELEASE_DELETION_PREFIX,
  SKILL_ASSIGN_PREFIX,
];

/** Prefixes for adjust records generated as part of a full distribution deletion. */
const DELETION_ADJUST_PREFIXES = [DELETION_ADJUST_PREFIX, SKILL_RELEASE_DELETION_PREFIX];

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

/**
 * Returns true if the source starts with any of the batch-points-adjust
 * correction prefixes: "积分调整:", "发放删除:", "技能释放:", "技能释放(删除):", "技能指派:".
 */
export function isAdjustmentRecord(source: string): boolean {
  return ADJUST_PREFIXES.some(prefix => source.startsWith(prefix));
}

/**
 * Returns true if the source is an adjust record generated as part of a full
 * distribution deletion ("发放删除:" or "技能释放(删除):"). For these records the
 * BatchDistributions record has already been hard-deleted, so no distributor
 * nickname can be resolved.
 */
export function isDeletionAdjustmentRecord(source: string): boolean {
  return DELETION_ADJUST_PREFIXES.some(prefix => source.startsWith(prefix));
}

// ============================================================
// Role-transition resolution (read-time)
// ============================================================

/**
 * Determine role-transition data for a `积分调整:` correction record.
 *
 * - Option A: use persisted `originalRole`/`originalPoints`/`newPoints` if present.
 * - Option B: else infer `originalRole`/`originalPoints` from the earliest-created
 *   matching Retained_Earn_Record (linked by `distributionId`, preferred, or
 *   `activityId`), deriving `newPoints` from the net delta.
 * - Else: unresolvable (`resolvable: false`) — caller renders new-role + delta only.
 *
 * A record is only treated as a role transition when the resolved Original_Role
 * DIFFERS from the correction's `targetRole` (New_Role). Same-role adjustments and
 * non-`积分调整:` records (deletion / skill) return `resolvable: false` so they keep
 * their existing wording.
 *
 * This is a pure function — it performs no I/O. The `retainedEarnRecords` for
 * Option B are supplied by the caller (see the read-time lookup in `getAnnouncements`).
 */
export function resolveRoleTransition(
  correction: Record<string, any>,
  retainedEarnRecords: Record<string, any>[],
): RoleTransition {
  const source = (correction.source as string) ?? '';

  // Only `积分调整:` corrections can be role transitions. Deletion ("发放删除:",
  // "技能释放(删除):") and skill ("技能释放:", "技能指派:") records are handled by
  // their own wording and are never presented as a role change.
  if (!source.startsWith(ADJUST_PREFIX)) {
    return { resolvable: false };
  }

  const targetRole = (correction.targetRole as string) ?? '';
  const amount = (correction.amount as number) ?? 0;

  // --- Option A: persisted original-role data on the correction record itself. ---
  const persistedOriginalRole = correction.originalRole as string | undefined;
  if (persistedOriginalRole && persistedOriginalRole !== targetRole) {
    let originalPoints = typeof correction.originalPoints === 'number' ? correction.originalPoints : undefined;
    let newPoints = typeof correction.newPoints === 'number' ? correction.newPoints : undefined;

    // Derive a missing numeric field from the other and the net delta (amount).
    if (newPoints === undefined && originalPoints !== undefined) {
      newPoints = originalPoints + amount;
    } else if (originalPoints === undefined && newPoints !== undefined) {
      originalPoints = newPoints - amount;
    }

    return { originalRole: persistedOriginalRole, originalPoints, newPoints, resolvable: true };
  }

  // --- Option B: infer from the earliest-created matching Retained_Earn_Record. ---
  const distributionId = correction.distributionId as string | undefined;
  const activityId = correction.activityId as string | undefined;
  const earns = retainedEarnRecords ?? [];

  // `distributionId` is the precise link and is preferred; `activityId` is the
  // documented fallback (Requirement 2.3).
  let matches = distributionId
    ? earns.filter(earn => earn && earn.type === 'earn' && earn.distributionId === distributionId)
    : [];
  if (matches.length === 0 && activityId) {
    matches = earns.filter(earn => earn && earn.type === 'earn' && earn.activityId === activityId);
  }

  if (matches.length > 0) {
    // Earliest-created match wins (Requirement 2.4).
    const earliest = matches.reduce((a, b) => {
      const aDate = (a.createdAt as string) ?? '';
      const bDate = (b.createdAt as string) ?? '';
      return aDate <= bDate ? a : b;
    });

    const originalRole = earliest.targetRole as string | undefined;
    if (originalRole && originalRole !== targetRole) {
      const originalPoints = typeof earliest.amount === 'number' ? earliest.amount : undefined;
      const newPoints = originalPoints !== undefined ? originalPoints + amount : undefined;
      return { originalRole, originalPoints, newPoints, resolvable: true };
    }
  }

  return { resolvable: false };
}

/**
 * Best-effort read-time lookup of Retained_Earn_Records for Option B inference.
 *
 * For `积分调整:` correction records that lack a persisted `originalRole`
 * (Historical_Adjustments predating write-time capture), the Original_Role must be
 * inferred from the recipient's original `type='earn'` PointsRecords. This queries
 * the existing `userId-createdAt-index` GSI once per userId (`userId = :uid`) with a
 * `FilterExpression` restricting to `type='earn'` (the `type` attribute name is
 * reserved, so it is aliased as `#type`), then groups the matching earn records by
 * `userId` in memory. `resolveRoleTransition` later picks the earliest match.
 *
 * Best-effort (Requirement 3.4): a transient query failure for any userId is
 * swallowed so that userId simply yields no earn records and the affected adjust
 * record falls back to `resolvable: false` rather than failing the whole feed. No
 * new GSI is required.
 */
async function fetchRetainedEarnRecords(
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
  userIds: string[],
): Promise<Map<string, Record<string, any>[]>> {
  const byUserId = new Map<string, Record<string, any>[]>();

  await Promise.all(
    userIds.map(async userId => {
      try {
        const earns: Record<string, any>[] = [];
        let exclusiveStartKey: Record<string, any> | undefined;
        do {
          const result = await dynamoClient.send(
            new QueryCommand({
              TableName: pointsRecordsTable,
              IndexName: 'userId-createdAt-index',
              KeyConditionExpression: 'userId = :uid',
              FilterExpression: '#type = :earn',
              ExpressionAttributeNames: { '#type': 'type' },
              ExpressionAttributeValues: { ':uid': userId, ':earn': 'earn' },
              ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
            }),
          );
          for (const item of result.Items ?? []) {
            earns.push(item);
          }
          exclusiveStartKey = result.LastEvaluatedKey;
        } while (exclusiveStartKey);
        byUserId.set(userId, earns);
      } catch {
        // Best-effort (Requirement 3.4): leave this userId without earn records so
        // the affected adjust record resolves to resolvable:false; never abort the feed.
      }
    }),
  );

  return byUserId;
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
 * Query a single page from the type-createdAt-index GSI for a given type.
 * `startKey` semantics (mirrors queryPointsDetail's per-type cursor handling):
 * - `undefined`: no cursor yet, start from the beginning
 * - `null`: this type is already exhausted, skip the query entirely
 * - object: DynamoDB ExclusiveStartKey to resume from
 */
async function queryAnnouncementPage(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  type: 'earn' | 'adjust',
  limit: number,
  startKey: Record<string, any> | null | undefined,
): Promise<{ items: Record<string, any>[]; lastEvaluatedKey?: Record<string, any> }> {
  if (startKey === null) {
    return { items: [] };
  }

  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'type-createdAt-index',
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':type': type },
      ScanIndexForward: false,
      Limit: limit,
      ...(startKey && { ExclusiveStartKey: startKey }),
    }),
  );

  return {
    items: result.Items ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

/**
 * Query the announcements feed.
 * 1. Query PointsRecords table type-createdAt-index GSI for BOTH type="earn" and
 *    type="adjust" (ScanIndexForward=false), merge, sort by createdAt descending,
 *    and paginate with a per-type cursor (mirrors queryPointsDetail's earn/spend
 *    merge pattern in reports/query.ts, adapted to earn/adjust here).
 * 2. BatchGet Users table to get recipient nicknames (by userId)
 * 3. For batch distribution AND non-deletion adjust records, query BatchDistributions
 *    table to get distributor nicknames (deletion adjust records resolve to '' since
 *    their distribution has already been hard-deleted)
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

  // Decode pagination cursor — new shape is { earnKey, adjustKey } (each undefined |
  // null | DynamoDB key object), mirroring queryPointsDetail's { earnKey, spendKey }.
  // For backward compatibility, an old flat cursor (e.g. { type: 'earn', createdAt, recordId })
  // is treated as an earnKey with no adjust progress yet (adjustKey undefined).
  let earnStartKey: Record<string, any> | null | undefined;
  let adjustStartKey: Record<string, any> | null | undefined;
  if (lastKey) {
    try {
      const decoded = JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8'));
      if (decoded && (('earnKey' in decoded) || ('adjustKey' in decoded))) {
        earnStartKey = decoded.earnKey;
        adjustStartKey = decoded.adjustKey;
      } else {
        // Legacy flat cursor shape — resume earn query from it, adjust starts fresh.
        earnStartKey = decoded;
      }
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_PAGINATION_KEY', message: '分页参数无效' },
      };
    }
  }

  // 1. Query PointsRecords table type-createdAt-index GSI for earn + adjust in parallel
  const [earnResult, adjustResult] = await Promise.all([
    queryAnnouncementPage(dynamoClient, tables.pointsRecordsTable, 'earn', limit, earnStartKey),
    queryAnnouncementPage(dynamoClient, tables.pointsRecordsTable, 'adjust', limit, adjustStartKey),
  ]);

  // Merge and sort by createdAt descending
  const merged = [...earnResult.items, ...adjustResult.items].sort((a, b) => {
    const aDate = (a.createdAt as string) ?? '';
    const bDate = (b.createdAt as string) ?? '';
    return bDate.localeCompare(aDate);
  });
  const records = merged.slice(0, limit);

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

  // 3. For batch distribution records AND non-deletion adjust records, get distributor
  //    nicknames from BatchDistributions table — both use the same activityId lookup.
  //    Deletion adjust records ("发放删除:" / "技能释放(删除):") are skipped since their
  //    BatchDistributions record has already been hard-deleted.
  const distributorLookupRecords = records.filter(r => {
    const source = (r.source as string) ?? '';
    return isBatchRecord(source) || (isAdjustmentRecord(source) && !isDeletionAdjustmentRecord(source));
  });
  const distributorNicknameMap = new Map<string, string>(); // activityId → distributorNickname

  if (distributorLookupRecords.length > 0) {
    const uniqueActivityIds = [...new Set(distributorLookupRecords.map(r => r.activityId as string).filter(Boolean))];

    if (uniqueActivityIds.length > 0) {
      // Query BatchDistributions by createdAt-index to find matching distributions
      // We use the time range from our records to narrow the query
      const createdAts = records.map(r => r.createdAt as string).filter(Boolean).sort();
      const oldestCreatedAt = createdAts[0];
      const newestCreatedAt = createdAts[createdAts.length - 1];

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

  // 3b. Option B lookup: for `积分调整:` adjust records that lack persisted
  //     originalRole (Historical_Adjustments), fetch the recipient's
  //     Retained_Earn_Records so resolveRoleTransition can infer the Original_Role
  //     at read time. Records that already carry persisted originalRole (Option A,
  //     the common case after deployment) are excluded, bounding this cost to
  //     historical records only. The lookup is best-effort — a failure yields an
  //     empty map rather than failing the feed (Requirement 3.4).
  const earnLookupUserIds = [
    ...new Set(
      records
        .filter(r => {
          const source = (r.source as string) ?? '';
          return source.startsWith(ADJUST_PREFIX) && !r.originalRole;
        })
        .map(r => r.userId as string)
        .filter(Boolean),
    ),
  ];

  const retainedEarnRecordsByUserId = earnLookupUserIds.length > 0
    ? await fetchRetainedEarnRecords(dynamoClient, tables.pointsRecordsTable, earnLookupUserIds)
    : new Map<string, Record<string, any>[]>();

  // 4. Assemble AnnouncementItem list.
  //
  // Fault isolation (Requirement 3.4): each record is assembled inside a try/catch.
  // A record that cannot produce a valid AnnouncementItem — e.g. a malformed
  // Historical_Adjustment that throws during construction or transition resolution —
  // is mapped to `null` and filtered out, so the remaining records are still returned
  // and the whole page never aborts. Constructing an item does not throw for a
  // record that merely lacks the new original-role fields: those simply keep the
  // New_Role + Net_Delta wording (Requirement 3.3).
  const items: AnnouncementItem[] = records
    .map((record): AnnouncementItem | null => {
      try {
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

        // Add distributorNickname for batch distribution records and non-deletion adjust records.
        // Deletion adjust records fall back to '' since no distribution record remains to look up.
        if (isBatchRecord(source) || isAdjustmentRecord(source)) {
          const activityId = record.activityId as string;
          item.distributorNickname = distributorNicknameMap.get(activityId) ?? '';
        }

        // Role-transition fields (Option A persisted, else Option B inferred from the
        // Retained_Earn_Records looked up above). Only set when resolvable so
        // Historical_Adjustments / unresolvable records keep new-role + delta wording.
        if (source.startsWith(ADJUST_PREFIX)) {
          const transition = resolveRoleTransition(
            record,
            retainedEarnRecordsByUserId.get(record.userId as string) ?? [],
          );
          if (transition.resolvable) {
            item.originalRole = transition.originalRole;
            item.originalPoints = transition.originalPoints;
            item.newPoints = transition.newPoints;
          }
        }

        return item;
      } catch {
        // This record could not be turned into a valid AnnouncementItem — omit it
        // from the feed without aborting the remaining records (Requirement 3.4).
        return null;
      }
    })
    .filter((item): item is AnnouncementItem => item !== null);

  // 5. Determine pagination lastKey — build per-type cursors (earnKey/adjustKey),
  // mirroring queryPointsDetail's { earnKey, spendKey } cursor construction in reports/query.ts.
  let nextCursor: Record<string, any> | undefined;
  const hasMore = merged.length > limit || !!earnResult.lastEvaluatedKey || !!adjustResult.lastEvaluatedKey;

  if (records.length === limit && hasMore) {
    const consumedEarn = records.filter(r => r.type === 'earn');
    const consumedAdjust = records.filter(r => r.type === 'adjust');

    let nextEarnKey: Record<string, any> | null | undefined;
    if (consumedEarn.length < earnResult.items.length) {
      // Not all fetched earn items were consumed this page — resume from the last consumed one
      const lastEarn = consumedEarn[consumedEarn.length - 1];
      if (lastEarn) {
        nextEarnKey = { type: 'earn', createdAt: lastEarn.createdAt as string, recordId: lastEarn.recordId as string };
      }
    } else if (earnResult.lastEvaluatedKey) {
      nextEarnKey = earnResult.lastEvaluatedKey;
    } else if (consumedEarn.length > 0) {
      // All fetched earn items consumed and DynamoDB reports no more — exhausted
      nextEarnKey = null;
    }

    let nextAdjustKey: Record<string, any> | null | undefined;
    if (consumedAdjust.length < adjustResult.items.length) {
      const lastAdjust = consumedAdjust[consumedAdjust.length - 1];
      if (lastAdjust) {
        nextAdjustKey = { type: 'adjust', createdAt: lastAdjust.createdAt as string, recordId: lastAdjust.recordId as string };
      }
    } else if (adjustResult.lastEvaluatedKey) {
      nextAdjustKey = adjustResult.lastEvaluatedKey;
    } else if (consumedAdjust.length > 0) {
      nextAdjustKey = null;
    }

    if (nextEarnKey !== undefined || nextAdjustKey !== undefined) {
      nextCursor = { earnKey: nextEarnKey ?? null, adjustKey: nextAdjustKey ?? null };
    }
  }

  let nextLastKey: string | null = null;
  if (nextCursor) {
    nextLastKey = Buffer.from(JSON.stringify(nextCursor)).toString('base64');
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
