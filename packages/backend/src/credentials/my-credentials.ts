// "My credentials" query module for self-applied credentials.
//
// Task 7.1: implement `getMyCredentials` — returns ALL self-applied credentials
// belonging to the authenticated user (both `active` and `revoked`), sorted by
// `issueDate` descending, each assembled with its public page URL.
//
// Data isolation (Req 9.5): the function uses ONLY the `userId` argument as the
// partition key for the `appliedByUserId-index` GSI; any client-supplied
// identifier is never consulted here.

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Credential, CredentialStatus, SourceRole, CredentialRole } from './types';

// ============================================================
// Types
// ============================================================

/** Table names required by the "my credentials" query. */
export interface MyCredentialsTables {
  /** Name of the `PointsMall-Credentials` table. */
  credentialsTable: string;
}

/** A single self-applied credential as returned to the "我的-获得证书管理" view. */
export interface MyCredentialItem {
  credentialId: string;
  eventName: string;
  /** 证书展示身份文案；自助证书优先使用 `identityText`，缺失时回退到 `role`。 */
  identityText: string;
  issueDate: string;
  status: CredentialStatus;
  /** 公开页面完整 URL：`{baseUrl}/c/{credentialId}` */
  url: string;
}

export interface MyCredentialsResult {
  items: MyCredentialItem[];
}

// GSI on PointsMall-Credentials: PK=appliedByUserId, SK=issueDate
const APPLIED_BY_USER_ID_INDEX = 'appliedByUserId-index';

// ============================================================
// Core query logic
// ============================================================

/**
 * Fetch all self-applied credentials for a user, newest first.
 *
 * 1. Query the `appliedByUserId-index` GSI with partition key
 *    `appliedByUserId = userId`. This returns every self-applied credential the
 *    user owns regardless of status (`active` or `revoked`), since status is not
 *    part of the index key.
 * 2. Page through all results (DynamoDB may paginate large result sets).
 * 3. Sort by `issueDate` descending (the GSI sort key already orders within a
 *    single partition, but we sort explicitly to remain correct across pages and
 *    for any items missing a sortable `issueDate`).
 * 4. Assemble each item with its public page URL `{baseUrl}/c/{credentialId}`.
 *
 * On a DynamoDB read failure the underlying error is allowed to propagate so the
 * handler can return a descriptive error rather than an empty list (Req 8.3).
 *
 * @param userId - Authenticated user's id (the ONLY identity source; Req 9.5)
 * @param dynamoClient - DynamoDB Document Client instance
 * @param tables - Table names (requires `credentialsTable`)
 * @param baseUrl - Public base URL used to build `/c/{credentialId}` links
 */
export async function getMyCredentials(
  userId: string,
  dynamoClient: DynamoDBDocumentClient,
  tables: MyCredentialsTables,
  baseUrl: string,
): Promise<MyCredentialsResult> {
  const credentials: Credential[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: tables.credentialsTable,
        IndexName: APPLIED_BY_USER_ID_INDEX,
        KeyConditionExpression: 'appliedByUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false, // newest issueDate first
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      credentials.push(item as Credential);
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  // Sort by issueDate descending. ISO `YYYY-MM-DD` strings sort correctly
  // lexicographically; localeCompare keeps the ordering stable across pages.
  credentials.sort((a, b) => (b.issueDate ?? '').localeCompare(a.issueDate ?? ''));

  const items: MyCredentialItem[] = credentials.map((cred) => ({
    credentialId: cred.credentialId,
    eventName: cred.eventName,
    identityText: resolveIdentityText(cred),
    issueDate: cred.issueDate,
    status: cred.status,
    url: `${baseUrl}/c/${cred.credentialId}`,
  }));

  return { items };
}

/**
 * Resolve the display identity for a credential. Self-applied credentials
 * persist an explicit `identityText`; fall back to the stored `role` value when
 * absent so the field is always populated.
 */
function resolveIdentityText(cred: Credential): string {
  if (cred.identityText && cred.identityText.trim().length > 0) {
    return cred.identityText;
  }
  return (cred.role as SourceRole | CredentialRole) ?? '';
}
