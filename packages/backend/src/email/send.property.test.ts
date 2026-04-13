import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { replaceVariables, validateTemplateInput } from './templates';

// Feature: email-notification
// File contains property-based tests for the email utility module.

// ============================================================
// Generators
// ============================================================

/** Arbitrary for a valid variable name (word characters only, 1–20 chars) */
const variableNameArb = fc.stringMatching(/^\w{1,20}$/);

/**
 * Arbitrary for a template string containing `{{variableName}}` placeholders
 * interspersed with literal text. Generates 0–5 placeholders embedded in text.
 */
const templateWithPlaceholdersArb = fc
  .array(
    fc.oneof(
      // Literal text segment (no braces)
      fc.string({ minLength: 0, maxLength: 30 }).map((s) => s.replace(/[{}]/g, '')),
      // A proper {{variableName}} placeholder
      variableNameArb.map((name) => `{{${name}}}`),
    ),
    { minLength: 1, maxLength: 10 },
  )
  .map((parts) => parts.join(''));

/**
 * Arbitrary for a values map — a Record<string, string> with 0–5 entries.
 * Keys are valid variable names, values are arbitrary strings.
 */
const valuesMapArb = fc.dictionary(variableNameArb, fc.string({ maxLength: 50 }), {
  minKeys: 0,
  maxKeys: 5,
});

// ============================================================
// Property 1: Template variable replacement completeness
// ============================================================

describe('Property 1: Template variable replacement completeness', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any template string containing {{variableName}} placeholders and any
   * values map (possibly incomplete), after calling replaceVariables(template, values),
   * the result SHALL contain no {{...}} patterns — all placeholders are replaced
   * with their corresponding value or an empty string if the value is missing.
   */
  it('should replace all {{variableName}} placeholders, leaving none in the output', () => {
    fc.assert(
      fc.property(templateWithPlaceholdersArb, valuesMapArb, (template, values) => {
        const result = replaceVariables(template, values);

        // No {{...}} patterns should remain in the output
        expect(result).not.toMatch(/\{\{\w+\}\}/);
      }),
      { numRuns: 100 },
    );
  });

  it('should replace provided variables with their values and missing variables with empty string', () => {
    fc.assert(
      fc.property(
        variableNameArb,
        variableNameArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        (presentVar, missingVar, value) => {
          // Ensure the two variable names are different
          fc.pre(presentVar !== missingVar);

          const template = `Hello {{${presentVar}}}, welcome {{${missingVar}}}!`;
          // Use Object.create(null) to avoid prototype pollution from names like "toString"
          const values: Record<string, string> = Object.create(null);
          values[presentVar] = value;
          const result = replaceVariables(template, values);

          // Present variable should be replaced with its value
          expect(result).toContain(value);
          // No placeholders should remain
          expect(result).not.toMatch(/\{\{\w+\}\}/);
          // Missing variable should have been replaced with empty string
          expect(result).toBe(`Hello ${value}, welcome !`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 2: Template validation accepts valid and rejects invalid lengths
// ============================================================

describe('Property 2: Template validation accepts valid and rejects invalid lengths', () => {
  /**
   * **Validates: Requirements 1.3, 3.4**
   *
   * For any subject string of length 1–200 and body string of length 1–10000,
   * validateTemplateInput(subject, body) SHALL return { valid: true }.
   * For any subject of length 0 or >200, or body of length 0 or >10000,
   * it SHALL return { valid: false }.
   */

  it('should accept valid subject (1–200 chars) and valid body (1–10000 chars)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 10000 }),
        (subject, body) => {
          const result = validateTemplateInput(subject, body);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject empty subject (length 0)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10000 }),
        (body) => {
          const result = validateTemplateInput('', body);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject subject longer than 200 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 201, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 10000 }),
        (subject, body) => {
          const result = validateTemplateInput(subject, body);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject empty body (length 0)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (subject) => {
          const result = validateTemplateInput(subject, '');
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject body longer than 10000 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10001, maxLength: 15000 }),
        (subject, body) => {
          const result = validateTemplateInput(subject, body);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: Bulk send batch splitting correctness
// ============================================================

import { vi, beforeEach, afterEach } from 'vitest';
import { sendBulkEmail } from './send';

describe('Property 3: Bulk send batch splitting correctness', () => {
  /**
   * **Validates: Requirements 5.5, 5.6, 13.1, 13.2**
   *
   * For any recipient list of size N (where N ≥ 1), `sendBulkEmail` SHALL split
   * recipients into `Math.ceil(N / 50)` batches, each batch containing at most
   * 50 recipients, and the total number of recipients across all batches SHALL
   * equal N.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Arbitrary for a recipient list of size 1–300 with unique email addresses */
  const recipientListArb = fc
    .integer({ min: 1, max: 300 })
    .chain((n) =>
      fc.constant(
        Array.from({ length: n }, (_, i) => `user${i}@example.com`),
      ),
    );

  it('should split recipients into correct number of batches with at most 50 per batch', async () => {
    await fc.assert(
      fc.asyncProperty(recipientListArb, async (recipients) => {
        const N = recipients.length;
        const expectedBatches = Math.ceil(N / 50);

        // Track all BCC batches sent through the mock SES client
        const capturedBatches: string[][] = [];

        const mockSesClient = {
          send: vi.fn().mockImplementation(async (command: unknown) => {
            const cmd = command as { input: { Destination: { BccAddresses?: string[] } } };
            const bcc = cmd.input.Destination.BccAddresses ?? [];
            capturedBatches.push([...bcc]);
            return {};
          }),
        };

        // Run sendBulkEmail and advance timers for inter-batch delays
        const resultPromise = sendBulkEmail(
          mockSesClient as any,
          {
            recipients,
            subject: 'Test',
            htmlBody: '<p>Test</p>',
          },
        );

        // Advance timers to flush all inter-batch delays
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        // 1. Total batches should equal Math.ceil(N / 50)
        expect(result.totalBatches).toBe(expectedBatches);
        expect(capturedBatches.length).toBe(expectedBatches);

        // 2. Each batch should contain at most 50 recipients
        for (const batch of capturedBatches) {
          expect(batch.length).toBeLessThanOrEqual(50);
          expect(batch.length).toBeGreaterThan(0);
        }

        // 3. Total recipients across all batches should equal N
        const totalRecipients = capturedBatches.reduce(
          (sum, batch) => sum + batch.length,
          0,
        );
        expect(totalRecipients).toBe(N);
      }),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 7: Bulk send resilience and summary accuracy
// ============================================================

describe('Property 7: Bulk send resilience and summary accuracy', () => {
  /**
   * **Validates: Requirements 13.5, 13.6**
   *
   * For any bulk send operation where some SES batch calls succeed and some fail,
   * the system SHALL attempt all batches (not stop on first failure), and the
   * returned BulkSendResult SHALL have successCount + failureCount === totalBatches.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Arbitrary that generates a recipient list (1–300) together with a set of
   * batch indices that should fail. The fail set is a subset of [0, totalBatches).
   */
  const bulkSendWithFailuresArb = fc
    .integer({ min: 1, max: 300 })
    .chain((recipientCount) => {
      const totalBatches = Math.ceil(recipientCount / 50);
      const recipients = Array.from(
        { length: recipientCount },
        (_, i) => `user${i}@example.com`,
      );

      // Generate an arbitrary subset of batch indices that should fail
      const failIndicesArb = fc
        .subarray(
          Array.from({ length: totalBatches }, (_, i) => i),
          { minLength: 0, maxLength: totalBatches },
        )
        .map((indices) => new Set(indices));

      return fc.tuple(fc.constant(recipients), failIndicesArb);
    });

  it('should attempt all batches even when some fail, and successCount + failureCount === totalBatches', async () => {
    await fc.assert(
      fc.asyncProperty(bulkSendWithFailuresArb, async ([recipients, failIndices]) => {
        const totalBatches = Math.ceil(recipients.length / 50);
        let batchCallCount = 0;

        const mockSesClient = {
          send: vi.fn().mockImplementation(async () => {
            const currentBatch = batchCallCount;
            batchCallCount++;
            if (failIndices.has(currentBatch)) {
              throw new Error(`Simulated SES failure for batch ${currentBatch}`);
            }
            return {};
          }),
        };

        const resultPromise = sendBulkEmail(
          mockSesClient as any,
          {
            recipients,
            subject: 'Resilience Test',
            htmlBody: '<p>Test</p>',
          },
        );

        // Advance timers to flush all inter-batch delays
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        // 1. All batches must be attempted (system does not stop on first failure)
        expect(batchCallCount).toBe(totalBatches);
        expect(mockSesClient.send).toHaveBeenCalledTimes(totalBatches);

        // 2. successCount + failureCount must equal totalBatches
        expect(result.successCount + result.failureCount).toBe(result.totalBatches);
        expect(result.totalBatches).toBe(totalBatches);

        // 3. failureCount must match the number of indices we told to fail
        expect(result.failureCount).toBe(failIndices.size);
        expect(result.successCount).toBe(totalBatches - failIndices.size);

        // 4. Each failed batch should be recorded in the errors array
        expect(result.errors.length).toBe(failIndices.size);
        for (const err of result.errors) {
          expect(failIndices.has(err.batchIndex)).toBe(true);
          expect(err.error).toContain('Simulated SES failure');
        }
      }),
      { numRuns: 100 },
    );
  });
});
