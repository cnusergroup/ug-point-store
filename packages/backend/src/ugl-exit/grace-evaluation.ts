// UGL grace-period evaluation module — pure functions + DynamoDB query.
// See design.md Components and Interfaces section 4 ("grace-evaluation.ts") and
// Correctness Properties (Property 6, Property 7) for full interface definitions and semantics.
//
// Consumed_Quarter_Marker is set at grace-period evaluation time, never at record-creation
// time (Req 5.3, 5.4) — this module only decides *which* record (if any) should be marked
// consumed; the actual write happens in grace-period-job.ts.

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ExitQualifyingRecord } from './eligibility';

// ============================================================
// Pure Functions
// ============================================================

/**
 * Selects, among candidate qualifying records that fall within a user's grace-period
 * window (by createdAt — Assumption 3) and are not yet consumed, the single earliest
 * one by createdAt (Req 5.4). Returns null when candidates is empty.
 *
 * Property 7: for a non-empty set of candidates with distinct createdAt values, the
 * returned record's createdAt is the minimum among all candidates.
 */
export function selectEarliestMakeupRecord(
  candidates: ExitQualifyingRecord[],
): ExitQualifyingRecord | null {
  if (candidates.length === 0) return null;

  let earliest = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].createdAt < earliest.createdAt) {
      earliest = candidates[i];
    }
  }
  return earliest;
}

export type GracePeriodOutcome =
  | { remedied: true; record: ExitQualifyingRecord }
  | { remedied: false };

/**
 * Combines "does a Makeup_Record exist" (Req 5.2) with "select the earliest one" (Req 5.4)
 * into a single outcome (Req 5.3, 5.5): remedied when a candidate exists, not-remedied otherwise.
 *
 * Property 6: returns remedied: true iff candidates is non-empty (and the returned record
 * is a member of candidates); returns remedied: false iff candidates is empty.
 */
export function evaluateGracePeriodOutcome(
  candidates: ExitQualifyingRecord[],
): GracePeriodOutcome {
  const earliest = selectEarliestMakeupRecord(candidates);
  if (earliest === null) {
    return { remedied: false };
  }
  return { remedied: true, record: earliest };
}

// ============================================================
// DynamoDB Query Function
// ============================================================

/**
 * Queries PointsRecords for the given user with targetRole='UserGroupLeader',
 * consumedForQuarter unset, createdAt in [sentAt, deadline] (inclusive boundaries),
 * via the userId-createdAt-index GSI. Paginated — aggregates all pages.
 *
 * Mirrors the KeyConditionExpression range-query + FilterExpression shape used
 * elsewhere in the codebase (e.g. credentials/eligibility.ts, points/records.ts)
 * against this same GSI, but is an independent implementation.
 */
export async function queryMakeupCandidates(
  userId: string,
  sentAt: string,
  deadline: string,
  dynamoClient: DynamoDBDocumentClient,
  pointsRecordsTable: string,
): Promise<ExitQualifyingRecord[]> {
  const records: ExitQualifyingRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: pointsRecordsTable,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :uid AND createdAt BETWEEN :sentAt AND :deadline',
        FilterExpression: 'targetRole = :ugl AND attribute_not_exists(consumedForQuarter)',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':sentAt': sentAt,
          ':deadline': deadline,
          ':ugl': 'UserGroupLeader',
        },
        ProjectionExpression: 'recordId, userId, targetRole, activityDate, createdAt, consumedForQuarter',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      records.push({
        recordId: item.recordId as string,
        userId: item.userId as string,
        targetRole: item.targetRole as string | undefined,
        activityDate: item.activityDate as string | undefined,
        createdAt: (item.createdAt as string) ?? '',
        consumedForQuarter: item.consumedForQuarter as string | undefined,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return records;
}
