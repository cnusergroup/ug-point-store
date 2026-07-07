import { describe, it, expect, vi } from 'vitest';
import {
  computeGracePeriodDeadline,
  claimReminderSlot,
  queryDueReminderRecords,
  ReminderTrackingRecord,
} from './reminder-tracking';

describe('computeGracePeriodDeadline', () => {
  it('returns exactly sentAt + 30*24h', () => {
    const sentAt = '2025-04-01T12:00:00.000Z';
    const deadline = computeGracePeriodDeadline(sentAt);
    const expected = new Date(new Date(sentAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(deadline).toBe(expected);
    expect(deadline).toBe('2025-05-01T12:00:00.000Z');
  });

  it('correctly crosses month/year boundaries', () => {
    const sentAt = '2025-12-15T00:00:00.000Z';
    const deadline = computeGracePeriodDeadline(sentAt);
    expect(deadline).toBe('2026-01-14T00:00:00.000Z');
  });
});

describe('claimReminderSlot', () => {
  it('claims the slot and writes a record when none exists', async () => {
    const send = vi.fn().mockResolvedValue({});
    const dynamoClient = { send } as any;

    const result = await claimReminderSlot('u1', '2025-Q2', '2025-04-01T00:00:00.000Z', dynamoClient, 'trackingTable');

    expect(result.claimed).toBe(true);
    expect(result.record).toMatchObject({
      userId: 'u1',
      quarter: '2025-Q2',
      reminderSentAt: '2025-04-01T00:00:00.000Z',
      gracePeriodDeadline: '2025-05-01T00:00:00.000Z',
      outcome: 'pending',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const putCommandArg = send.mock.calls[0][0];
    expect(putCommandArg.input.ConditionExpression).toBe('attribute_not_exists(userId)');
    expect(putCommandArg.input.TableName).toBe('trackingTable');
  });

  it('returns claimed: false without issuing a second write when a record already exists', async () => {
    const err: Error & { name: string } = new Error('ConditionalCheckFailedException') as any;
    err.name = 'ConditionalCheckFailedException';
    const send = vi.fn().mockRejectedValue(err);
    const dynamoClient = { send } as any;

    const result = await claimReminderSlot('u1', '2025-Q2', '2025-04-01T00:00:00.000Z', dynamoClient, 'trackingTable');

    expect(result).toEqual({ claimed: false });
    // Only the one conditional PutCommand attempt — no follow-up write issued.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rethrows unexpected errors other than ConditionalCheckFailedException', async () => {
    const err = new Error('SomeOtherError');
    const send = vi.fn().mockRejectedValue(err);
    const dynamoClient = { send } as any;

    await expect(
      claimReminderSlot('u1', '2025-Q2', '2025-04-01T00:00:00.000Z', dynamoClient, 'trackingTable'),
    ).rejects.toThrow('SomeOtherError');
  });
});

describe('queryDueReminderRecords', () => {
  it('queries the outcome-gracePeriodDeadline-index GSI with the correct key condition', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });
    const dynamoClient = { send } as any;

    await queryDueReminderRecords('2025-05-01T00:00:00.000Z', dynamoClient, 'trackingTable');

    expect(send).toHaveBeenCalledTimes(1);
    const queryCommandArg = send.mock.calls[0][0];
    expect(queryCommandArg.input.TableName).toBe('trackingTable');
    expect(queryCommandArg.input.IndexName).toBe('outcome-gracePeriodDeadline-index');
    expect(queryCommandArg.input.KeyConditionExpression).toBe('#outcome = :pending AND gracePeriodDeadline <= :now');
    expect(queryCommandArg.input.ExpressionAttributeValues[':pending']).toBe('pending');
    expect(queryCommandArg.input.ExpressionAttributeValues[':now']).toBe('2025-05-01T00:00:00.000Z');
  });

  it('aggregates all pages when the query is paginated', async () => {
    const recordA: ReminderTrackingRecord = {
      userId: 'u1',
      quarter: '2025-Q1',
      reminderSentAt: '2025-01-01T00:00:00.000Z',
      gracePeriodDeadline: '2025-01-31T00:00:00.000Z',
      outcome: 'pending',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const recordB: ReminderTrackingRecord = {
      userId: 'u2',
      quarter: '2025-Q1',
      reminderSentAt: '2025-01-02T00:00:00.000Z',
      gracePeriodDeadline: '2025-02-01T00:00:00.000Z',
      outcome: 'pending',
      createdAt: '2025-01-02T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    };

    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [recordA], LastEvaluatedKey: { userId: 'u1', quarter: '2025-Q1' } })
      .mockResolvedValueOnce({ Items: [recordB], LastEvaluatedKey: undefined });
    const dynamoClient = { send } as any;

    const result = await queryDueReminderRecords('2025-05-01T00:00:00.000Z', dynamoClient, 'trackingTable');

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual([recordA, recordB]);

    // Second call must carry the ExclusiveStartKey from the first page's LastEvaluatedKey.
    const secondCallArg = send.mock.calls[1][0];
    expect(secondCallArg.input.ExclusiveStartKey).toEqual({ userId: 'u1', quarter: '2025-Q1' });
  });
});
