import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// ============================================================
// Types
// ============================================================

export type NotificationType =
  | 'pointsEarned'
  | 'newOrder'
  | 'orderShipped'
  | 'newProduct'
  | 'newContent';

export type EmailLocale = 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW';

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlBody: string;
}

export interface SendBulkEmailInput {
  recipients: string[]; // BCC recipients
  subject: string;
  htmlBody: string;
}

export interface BulkSendResult {
  totalBatches: number;
  successCount: number;
  failureCount: number;
  errors: { batchIndex: number; error: string }[];
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_SENDER = 'store@awscommunity.cn';
const MAX_BCC_RECIPIENTS = 50;
const INTER_BATCH_DELAY_MS = 100;

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Core email sending functions
// ============================================================

/**
 * Send a single transactional email using the TO field.
 */
export async function sendEmail(
  sesClient: SESClient,
  input: SendEmailInput,
  senderEmail: string = DEFAULT_SENDER,
): Promise<void> {
  const command = new SendEmailCommand({
    Source: senderEmail,
    Destination: {
      ToAddresses: [input.to],
    },
    Message: {
      Subject: { Data: input.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: input.htmlBody, Charset: 'UTF-8' },
      },
    },
  });

  await sesClient.send(command);
  console.log(`[Email] Sent to ${input.to}, subject: ${input.subject.slice(0, 50)}`);
}

/**
 * Send bulk emails using BCC field, batched at 50 recipients max.
 * Introduces 100ms delay between batches. Continues on failure.
 * Returns a summary of successful and failed batches.
 */
export async function sendBulkEmail(
  sesClient: SESClient,
  input: SendBulkEmailInput,
  senderEmail: string = DEFAULT_SENDER,
): Promise<BulkSendResult> {
  const { recipients, subject, htmlBody } = input;
  const totalBatches = Math.ceil(recipients.length / MAX_BCC_RECIPIENTS);

  const result: BulkSendResult = {
    totalBatches,
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  for (let i = 0; i < totalBatches; i++) {
    const start = i * MAX_BCC_RECIPIENTS;
    const batch = recipients.slice(start, start + MAX_BCC_RECIPIENTS);

    try {
      const command = new SendEmailCommand({
        Source: senderEmail,
        Destination: {
          ToAddresses: [senderEmail],
          BccAddresses: batch,
        },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: htmlBody, Charset: 'UTF-8' },
          },
        },
      });

      await sesClient.send(command);
      result.successCount++;
      console.log(
        `[BulkEmail] Batch ${i + 1}/${totalBatches} sent successfully (${batch.length} recipients)`,
      );
    } catch (err: unknown) {
      result.failureCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push({ batchIndex: i, error: errorMessage });
      console.error(
        `[BulkEmail] Batch ${i + 1}/${totalBatches} failed (${batch.length} recipients): ${errorMessage}`,
      );
    }

    // Delay between batches to avoid SES throttling (skip after last batch)
    if (i < totalBatches - 1) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  return result;
}
