// Credential revocation logic for community credentials module

import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Types
// ============================================================

export interface RevokeCredentialParams {
  dynamoClient: DynamoDBDocumentClient;
  tableName: string;
  credentialId: string;
  revokedBy: string;
  revokeReason: string;
  callerRole: string;
}

export type RevokeResult =
  | {
      success: true;
      credential: {
        credentialId: string;
        status: string;
        revokedAt: string;
        revokedBy: string;
        revokeReason: string;
      };
    }
  | { success: false; code: string; message: string };

// ============================================================
// Core revocation logic
// ============================================================

/**
 * Revoke an active credential.
 *
 * 1. Validate caller has SuperAdmin role
 * 2. Fetch the credential from DynamoDB
 * 3. Verify credential exists and is currently active
 * 4. Update status to 'revoked' with revokedAt, revokedBy, revokeReason
 */
export async function revokeCredential(
  params: RevokeCredentialParams,
): Promise<RevokeResult> {
  const { dynamoClient, tableName, credentialId, revokedBy, revokeReason, callerRole } =
    params;

  // 1. Validate caller has SuperAdmin role
  if (callerRole !== 'SuperAdmin') {
    return {
      success: false,
      code: 'FORBIDDEN',
      message: '权限不足：仅 SuperAdmin 可执行撤销操作',
    };
  }

  // 2. Fetch the credential
  const getResult = await dynamoClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { credentialId },
    }),
  );

  // 3. Verify credential exists
  if (!getResult.Item) {
    return {
      success: false,
      code: 'CREDENTIAL_NOT_FOUND',
      message: '凭证不存在',
    };
  }

  // 4. Verify credential is currently active
  if (getResult.Item.status === 'revoked') {
    return {
      success: false,
      code: 'ALREADY_REVOKED',
      message: '凭证已被撤销',
    };
  }

  // 5. Update credential status to revoked
  const revokedAt = new Date().toISOString();

  await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { credentialId },
      UpdateExpression:
        'SET #status = :status, revokedAt = :revokedAt, revokedBy = :revokedBy, revokeReason = :revokeReason',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'revoked',
        ':revokedAt': revokedAt,
        ':revokedBy': revokedBy,
        ':revokeReason': revokeReason,
      },
    }),
  );

  return {
    success: true,
    credential: {
      credentialId,
      status: 'revoked',
      revokedAt,
      revokedBy,
      revokeReason,
    },
  };
}
