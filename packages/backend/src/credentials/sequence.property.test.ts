import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { getNextSequence } from './sequence';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Feature: credential-self-application, Property 7: 序号分配唯一且单调递增
//
// For any sequence of N allocations under the same
// `{eventPrefix}-{year}-{season}-{roleCode}` partition key, the sequence
// numbers handed out by `getNextSequence` are pairwise distinct and form a
// contiguous, strictly increasing interval starting at the current maximum
// value plus 1 — so no two credential IDs ever collide. Allocations under
// DIFFERENT partition keys advance independent counters: an allocation under
// one key never shifts the numbers handed out under another.
//
// This is a model-based test: an in-memory atomic counter faithfully models
// DynamoDB's `ADD currentValue :inc` semantics (an `ADD` on a missing
// attribute starts from 0). `getNextSequence` issues exactly that UpdateCommand
// and returns `startSequence = newValue - count + 1`, so the reserved range for
// an allocation of `count` is `[startSequence, startSequence + count - 1]`.
//
// Validates: Requirements 6.3

const SEQUENCES_TABLE = 'PointsMall-CredentialSequences';

interface SequenceComponents {
  eventPrefix: string;
  year: string;
  season: string;
  roleCode: string;
}

/** Derive the partition key exactly as `getNextSequence` does internally. */
function sequenceKeyOf(c: SequenceComponents): string {
  return `${c.eventPrefix}-${c.year}-${c.season}-${c.roleCode}`;
}

/**
 * Build an in-memory fake DynamoDBDocumentClient that faithfully models the
 * `ADD currentValue :inc` atomic-counter semantics used by `getNextSequence`:
 *
 *   - State is a `Map<sequenceKey, number>` (the persisted `currentValue`).
 *   - An `UpdateCommand` with `UpdateExpression: 'ADD currentValue :inc'`
 *     reads the current value (defaulting to 0 when the attribute/item is
 *     absent — exactly DynamoDB's behaviour for `ADD` on a missing number),
 *     adds `:inc`, persists it, and returns `{ Attributes: { currentValue } }`
 *     because `ReturnValues` is `'UPDATED_NEW'`.
 *
 * The backing `store` is returned so tests can pre-seed a "current maximum"
 * and assert per-key independence.
 */
function createFakeSequenceClient(store: Map<string, number> = new Map()): {
  client: DynamoDBDocumentClient;
  store: Map<string, number>;
} {
  const client = {
    send: vi.fn(
      (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const cmdName = cmd?.constructor?.name;
        if (cmdName !== 'UpdateCommand') {
          return Promise.reject(new Error(`Unexpected command: ${cmdName}`));
        }
        const input = cmd.input as {
          TableName?: string;
          Key?: { sequenceKey?: string };
          UpdateExpression?: string;
          ExpressionAttributeValues?: Record<string, number>;
          ReturnValues?: string;
        };

        // The implementation must speak the exact atomic-counter dialect.
        expect(input.TableName).toBe(SEQUENCES_TABLE);
        expect(input.UpdateExpression).toBe('ADD currentValue :inc');
        expect(input.ReturnValues).toBe('UPDATED_NEW');

        const key = input.Key!.sequenceKey as string;
        const inc = input.ExpressionAttributeValues![':inc'];

        const current = store.get(key) ?? 0; // ADD on missing attribute starts at 0
        const newValue = current + inc;
        store.set(key, newValue);

        return Promise.resolve({ Attributes: { currentValue: newValue } });
      },
    ),
  };
  return { client: client as unknown as DynamoDBDocumentClient, store };
}

// --- Generators ----------------------------------------------------------

const UPPER_AND_DASH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-';

// `eventPrefix`: 1–20 chars of A–Z and '-', matching the credential-ID prefix rule.
const eventPrefixArb = fc.string({
  unit: fc.constantFrom(...UPPER_AND_DASH.split('')),
  minLength: 1,
  maxLength: 20,
});

const yearArb = fc.integer({ min: 2000, max: 2100 }).map(String);
const seasonArb = fc.constantFrom('Spring', 'Summer', 'Fall', 'Winter');
const roleCodeArb = fc.constantFrom('SPK', 'VOL', 'UGL', 'WKS', 'ORG');

const componentsArb: fc.Arbitrary<SequenceComponents> = fc.record({
  eventPrefix: eventPrefixArb,
  year: yearArb,
  season: seasonArb,
  roleCode: roleCodeArb,
});

// Per-allocation reservation size: mostly 1 (self-apply uses count=1), with some
// count>1 to model batch-import reservations sharing the same counter.
const countArb = fc.integer({ min: 1, max: 8 });

describe('Property 7: 序号分配唯一且单调递增', () => {
  it('同一分区键下 N 次分配序号互不重复，且构成自 currentMax+1 起的连续递增区间', async () => {
    await fc.assert(
      fc.asyncProperty(
        componentsArb,
        // A pre-existing "current maximum" (e.g. from prior batch imports);
        // 0 models a brand-new counter.
        fc.integer({ min: 0, max: 5000 }),
        fc.array(countArb, { minLength: 1, maxLength: 30 }),
        async (comp, initialMax, counts) => {
          const seqKey = sequenceKeyOf(comp);
          const seed = new Map<string, number>();
          if (initialMax > 0) seed.set(seqKey, initialMax);
          const { client, store } = createFakeSequenceClient(seed);

          const ranges: Array<{ start: number; count: number; end: number }> = [];
          for (const count of counts) {
            const start = await getNextSequence(
              client,
              SEQUENCES_TABLE,
              comp.eventPrefix,
              comp.year,
              comp.season,
              comp.roleCode,
              count,
            );
            ranges.push({ start, count, end: start + count - 1 });
          }

          // (1) Strictly contiguous & monotonic: allocation k starts at the
          // running cumulative total + 1, and ends at the new cumulative total.
          let cumulative = initialMax;
          for (const r of ranges) {
            expect(r.start).toBe(cumulative + 1);
            cumulative += r.count;
            expect(r.end).toBe(cumulative);
          }

          // (2) The union of all reserved sequence numbers is exactly the
          // contiguous interval {initialMax+1, ..., initialMax+total} with no
          // gaps and no duplicates.
          const allSeqs: number[] = [];
          for (const r of ranges) {
            for (let s = r.start; s <= r.end; s++) allSeqs.push(s);
          }
          const total = counts.reduce((a, b) => a + b, 0);

          // Uniqueness: no sequence number reserved twice.
          expect(new Set(allSeqs).size).toBe(allSeqs.length);
          expect(allSeqs.length).toBe(total);

          // Exact contiguous interval starting at currentMax+1.
          const expectedInterval = Array.from(
            { length: total },
            (_, i) => initialMax + 1 + i,
          );
          expect([...allSeqs].sort((a, b) => a - b)).toEqual(expectedInterval);

          // (3) The persisted counter equals the final cumulative maximum.
          expect(store.get(seqKey)).toBe(initialMax + total);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不同分区键维护各自独立的计数器，互不影响', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(componentsArb, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({ keySeed: fc.nat(), count: countArb }),
          { minLength: 1, maxLength: 40 },
        ),
        async (rawKeys, ops) => {
          // Deduplicate keys by their derived partition key so each tracked
          // counter is genuinely distinct.
          const seen = new Set<string>();
          const keys: SequenceComponents[] = [];
          for (const k of rawKeys) {
            const s = sequenceKeyOf(k);
            if (!seen.has(s)) {
              seen.add(s);
              keys.push(k);
            }
          }

          const { client, store } = createFakeSequenceClient();
          const expectedCumulative = keys.map(() => 0);

          for (const op of ops) {
            const idx = op.keySeed % keys.length;
            const k = keys[idx];
            const start = await getNextSequence(
              client,
              SEQUENCES_TABLE,
              k.eventPrefix,
              k.year,
              k.season,
              k.roleCode,
              op.count,
            );
            // Independence: this key's start depends ONLY on this key's own
            // prior allocations, never on activity under any other key.
            expect(start).toBe(expectedCumulative[idx] + 1);
            expectedCumulative[idx] += op.count;
          }

          // Each counter persisted exactly its own independent total. A key
          // that received no allocations has no persisted item yet (DynamoDB
          // only materializes the counter on the first ADD), modelled as 0.
          keys.forEach((k, i) => {
            expect(store.get(sequenceKeyOf(k)) ?? 0).toBe(expectedCumulative[i]);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
