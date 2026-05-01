// Batch credential creation logic for community credentials module

import crypto from 'node:crypto';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { parseCsv } from './csv';
import { getNextSequence } from './sequence';
import { formatCredentialId } from './credential-id';
import type { Credential, CredentialRole } from './types';
import { ROLE_CODES } from './types';

// ============================================================
// Interfaces
// ============================================================

export interface BatchCreateParams {
  dynamoClient: DynamoDBDocumentClient;
  credentialsTableName: string;
  sequencesTableName: string;
  eventPrefix: string;
  year: string;
  season: string;
  csvContent: string;
}

export interface BatchResult {
  batchId: string;
  summary: { total: number; success: number; failed: number };
  credentials: Array<{ credentialId: string; recipientName: string }>;
  errors: Array<{ line: number; message: string }>;
}

// ============================================================
// Core batch creation logic
// ============================================================

/**
 * Batch-create credentials from CSV content.
 *
 * 1. Parse CSV into rows (collecting parse errors)
 * 2. Group valid rows by roleCode to batch-reserve sequence numbers
 * 3. For each valid row, build a Credential and write to DynamoDB
 * 4. Return summary with created credentials and any errors
 */
export async function batchCreateCredentials(
  params: BatchCreateParams,
): Promise<BatchResult> {
  const {
    dynamoClient,
    credentialsTableName,
    sequencesTableName,
    eventPrefix,
    year,
    season,
    csvContent,
  } = params;

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const issueDate = now.slice(0, 10); // ISO date portion

  // 1. Parse CSV
  const parseResult = parseCsv(csvContent);
  const errors: Array<{ line: number; message: string }> = [...parseResult.errors];
  const validRows = parseResult.rows;

  const total = validRows.length + errors.length;

  // If no valid rows, return early
  if (validRows.length === 0) {
    return {
      batchId,
      summary: { total, success: 0, failed: errors.length },
      credentials: [],
      errors,
    };
  }

  // 2. Group valid rows by roleCode to batch-reserve sequences
  // We need to preserve the original order for assigning sequences, so we track
  // each row's index within its role group.
  const roleGroups = new Map<string, number[]>(); // roleCode → array of indices into validRows

  for (let i = 0; i < validRows.length; i++) {
    const role = validRows[i].role as CredentialRole;
    const roleCode = ROLE_CODES[role];
    if (!roleGroups.has(roleCode)) {
      roleGroups.set(roleCode, []);
    }
    roleGroups.get(roleCode)!.push(i);
  }

  // Reserve sequence ranges for each role group
  const sequenceStarts = new Map<string, number>(); // roleCode → startSequence

  for (const [roleCode, indices] of roleGroups) {
    const count = indices.length;
    const startSequence = await getNextSequence(
      dynamoClient,
      sequencesTableName,
      eventPrefix,
      year,
      season,
      roleCode,
      count,
    );
    sequenceStarts.set(roleCode, startSequence);
  }

  // 3. Build credentials and write to DynamoDB
  // Track per-role offset to assign sequences within the reserved range
  const roleOffsets = new Map<string, number>(); // roleCode → current offset
  for (const roleCode of roleGroups.keys()) {
    roleOffsets.set(roleCode, 0);
  }

  const credentials: Array<{ credentialId: string; recipientName: string }> = [];

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const role = row.role as CredentialRole;
    const roleCode = ROLE_CODES[role];
    const startSeq = sequenceStarts.get(roleCode)!;
    const offset = roleOffsets.get(roleCode)!;
    const sequence = startSeq + offset;
    roleOffsets.set(roleCode, offset + 1);

    const credentialId = formatCredentialId({
      eventPrefix,
      year,
      season,
      roleCode,
      sequence,
    });

    const credential: Credential = {
      credentialId,
      recipientName: row.recipientName,
      eventName: row.eventName,
      role,
      issueDate,
      issuingOrganization: row.issuingOrganization || 'AWS User Group China',
      status: 'active',
      locale: row.locale || 'zh',
      createdAt: now,
      batchId,
      ...(row.eventLocation && { eventLocation: row.eventLocation }),
      ...(row.eventDate && { eventDate: row.eventDate }),
      ...(row.contribution && { contribution: row.contribution }),
    };

    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: credentialsTableName,
          Item: credential,
        }),
      );
      credentials.push({ credentialId, recipientName: row.recipientName });
    } catch (err) {
      // DynamoDB write failure for this row — record error, continue with others
      const message = err instanceof Error ? err.message : 'DynamoDB write failed';
      errors.push({ line: i + 2, message: `Failed to write credential: ${message}` });
    }
  }

  return {
    batchId,
    summary: {
      total,
      success: credentials.length,
      failed: total - credentials.length,
    },
    credentials,
    errors,
  };
}
