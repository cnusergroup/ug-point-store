// Sequence generator for credential IDs using DynamoDB atomic counters

import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Get the next sequence number(s) for a credential ID via DynamoDB atomic increment.
 *
 * Uses DynamoDB `ADD` operation to atomically increment the counter for the given
 * combination of eventPrefix, year, season, and roleCode. This ensures concurrent
 * batch operations never produce duplicate sequence numbers.
 *
 * @param dynamoClient - DynamoDB Document Client instance
 * @param tableName - Name of the CredentialSequences DynamoDB table
 * @param eventPrefix - Event prefix, e.g. "ACD-BASE"
 * @param year - Four-digit year, e.g. "2026"
 * @param season - Season identifier: Spring | Summer | Fall | Winter
 * @param roleCode - Role code: VOL | SPK | WKS | ORG
 * @param count - Number of sequence numbers to reserve (for batch operations)
 * @returns The starting sequence number of the reserved range
 */
export async function getNextSequence(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
  eventPrefix: string,
  year: string,
  season: string,
  roleCode: string,
  count: number,
): Promise<number> {
  const result = await dynamoClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sequenceKey: `${eventPrefix}-${year}-${season}-${roleCode}` },
      UpdateExpression: 'ADD currentValue :inc',
      ExpressionAttributeValues: { ':inc': count },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  const endSequence = result.Attributes!.currentValue as number;
  const startSequence = endSequence - count + 1;
  return startSequence;
}
