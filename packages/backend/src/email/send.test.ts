import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, sendBulkEmail } from './send';
import type { SendEmailInput, SendBulkEmailInput } from './send';

// ============================================================
// Helpers
// ============================================================

function createMockSESClient(options?: { failOnBatch?: number[] }) {
  let callCount = 0;
  const send = vi.fn().mockImplementation(() => {
    const currentCall = callCount++;
    if (options?.failOnBatch?.includes(currentCall)) {
      return Promise.reject(new Error(`SES error on call ${currentCall}`));
    }
    return Promise.resolve({ MessageId: `msg-${currentCall}` });
  });
  return { send } as any;
}

function makeRecipients(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `user${i + 1}@example.com`);
}

// ============================================================
// sendEmail
// ============================================================

describe('sendEmail', () => {
  it('should send a single email with TO field', async () => {
    const ses = createMockSESClient();
    const input: SendEmailInput = {
      to: 'test@example.com',
      subject: 'Test Subject',
      htmlBody: '<p>Hello</p>',
    };

    await sendEmail(ses, input);

    expect(ses.send).toHaveBeenCalledOnce();
    const command = ses.send.mock.calls[0][0];
    expect(command.input.Destination.ToAddresses).toEqual(['test@example.com']);
    expect(command.input.Source).toBe('store@awscommunity.cn');
    expect(command.input.Message.Subject.Data).toBe('Test Subject');
    expect(command.input.Message.Body.Html.Data).toBe('<p>Hello</p>');
  });

  it('should use custom sender when provided', async () => {
    const ses = createMockSESClient();
    const input: SendEmailInput = {
      to: 'test@example.com',
      subject: 'Test',
      htmlBody: '<p>Hi</p>',
    };

    await sendEmail(ses, input, 'custom@example.com');

    const command = ses.send.mock.calls[0][0];
    expect(command.input.Source).toBe('custom@example.com');
  });

  it('should propagate SES errors', async () => {
    const ses = createMockSESClient({ failOnBatch: [0] });
    const input: SendEmailInput = {
      to: 'test@example.com',
      subject: 'Test',
      htmlBody: '<p>Hi</p>',
    };

    await expect(sendEmail(ses, input)).rejects.toThrow('SES error on call 0');
  });
});

// ============================================================
// sendBulkEmail
// ============================================================

describe('sendBulkEmail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should send a single batch for <= 49 recipients', async () => {
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(10),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(ses.send).toHaveBeenCalledOnce();

    const command = ses.send.mock.calls[0][0];
    expect(command.input.Destination.BccAddresses).toHaveLength(10);
  });

  it('should split into multiple batches for > 49 recipients', async () => {
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(120),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(3); // ceil(120/49) = 3
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(ses.send).toHaveBeenCalledTimes(3);

    // Verify batch sizes
    expect(ses.send.mock.calls[0][0].input.Destination.BccAddresses).toHaveLength(49);
    expect(ses.send.mock.calls[1][0].input.Destination.BccAddresses).toHaveLength(49);
    expect(ses.send.mock.calls[2][0].input.Destination.BccAddresses).toHaveLength(22);
  });

  it('should keep total destinations (To + Bcc) within the SES limit of 50', async () => {
    // Regression guard: the sender occupies one ToAddresses slot, so a 50-address
    // BCC batch produced 51 destinations and SES rejected it with
    // "Recipient count exceeds 50." Every batch must stay at or under 50 total.
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(145),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    await resultPromise;

    for (const call of ses.send.mock.calls) {
      const dest = call[0].input.Destination;
      const total =
        (dest.ToAddresses?.length ?? 0) +
        (dest.CcAddresses?.length ?? 0) +
        (dest.BccAddresses?.length ?? 0);
      expect(total).toBeLessThanOrEqual(50);
    }
  });

  it('should handle exactly 49 recipients as a single batch', async () => {
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(49),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(1);
    expect(result.successCount).toBe(1);
    expect(ses.send).toHaveBeenCalledOnce();
  });

  it('should continue processing after a batch failure', async () => {
    const ses = createMockSESClient({ failOnBatch: [1] });
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(147),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(3); // ceil(147/49) = 3
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].batchIndex).toBe(1);
    expect(result.errors[0].error).toContain('SES error');
    // All 3 batches were attempted
    expect(ses.send).toHaveBeenCalledTimes(3);
  });

  it('should satisfy successCount + failureCount === totalBatches', async () => {
    const ses = createMockSESClient({ failOnBatch: [0, 2] });
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(147),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.successCount + result.failureCount).toBe(result.totalBatches);
  });

  it('should use BCC field with sender in TO field', async () => {
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: makeRecipients(5),
      subject: 'Bulk Test',
      htmlBody: '<p>Bulk</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    await resultPromise;

    const command = ses.send.mock.calls[0][0];
    expect(command.input.Destination.ToAddresses).toEqual(['store@awscommunity.cn']);
    expect(command.input.Destination.BccAddresses).toHaveLength(5);
  });

  it('should handle a single recipient', async () => {
    const ses = createMockSESClient();
    const input: SendBulkEmailInput = {
      recipients: ['solo@example.com'],
      subject: 'Solo',
      htmlBody: '<p>Solo</p>',
    };

    const resultPromise = sendBulkEmail(ses, input);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalBatches).toBe(1);
    expect(result.successCount).toBe(1);
    expect(ses.send).toHaveBeenCalledOnce();
  });
});
